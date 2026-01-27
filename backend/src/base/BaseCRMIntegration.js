const { IntegrationBase } = require('@friggframework/core');
const {
    CreateProcess,
    UpdateProcessState,
    UpdateProcessMetrics,
    GetProcess,
} = require('@friggframework/core');
const {
    createProcessRepository,
} = require('@friggframework/core/integrations/repositories/process-repository-factory');

const ProcessManager = require('./services/ProcessManager');
const QueueManager = require('./services/QueueManager');
const SyncOrchestrator = require('./services/SyncOrchestrator');
const { QueuerUtilWrapper } = require('./services/QueuerUtilWrapper');

/**
 * BaseCRMIntegration
 *
 * Base class for all CRM integrations targeting Quo (OpenPhone).
 * Provides automatic sync orchestration, process management, and queue handling.
 *
 * Supports two pagination strategies:
 * - PAGE_BASED: APIs with known total count (Salesforce, Zoho, HubSpot)
 * - CURSOR_BASED: APIs using cursor/nextPage without total (AxisCare, Attio, GraphQL)
 *
 * Design Philosophy:
 * - Child classes implement 5 core methods
 * - Auto-generates sync events and handlers
 * - Service composition for testability
 * - Lazy initialization with factory methods for DI
 *
 * Child classes must:
 * 1. Define static CRMConfig
 * 2. Implement 5 abstract methods
 * 3. Optionally override lifecycle and helper methods
 *
 * @example Page-Based Pagination (Zoho)
 * class ZohoCRMIntegration extends BaseCRMIntegration {
 *   static CRMConfig = {
 *     personObjectTypes: [{ crmObjectName: 'Contact', quoContactType: 'contact' }],
 *     syncConfig: {
 *       paginationType: 'PAGE_BASED',
 *       supportsTotal: true,
 *       returnFullRecords: false,
 *       reverseChronological: true,
 *       initialBatchSize: 100
 *     },
 *     queueConfig: { maxWorkers: 25 }
 *   };
 *
 *   async fetchPersonPage({ page, limit }) {
 *     const response = await this.api.listContacts({ page, limit });
 *     return { data: response.contacts, total: response.total, hasMore: true };
 *   }
 *   // ... implement other methods
 * }
 *
 * @example Cursor-Based Pagination (AxisCare)
 * class AxisCareIntegration extends BaseCRMIntegration {
 *   static CRMConfig = {
 *     personObjectTypes: [{ crmObjectName: 'Client', quoContactType: 'contact' }],
 *     syncConfig: {
 *       paginationType: 'CURSOR_BASED',
 *       supportsTotal: false,
 *       returnFullRecords: true,
 *       reverseChronological: true,
 *       initialBatchSize: 50
 *     }
 *   };
 *
 *   async fetchPersonPage({ cursor, limit }) {
 *     const params = { limit };
 *     if (cursor) params.startAfterId = cursor;
 *     const response = await this.api.listClients(params);
 *     const nextCursor = response.nextPage ? extractCursor(response.nextPage) : null;
 *     return { data: response.clients, cursor: nextCursor, hasMore: !!response.nextPage };
 *   }
 *   // ... implement other methods
 * }
 */
class BaseCRMIntegration extends IntegrationBase {
    /**
     * CRM Configuration - MUST be overridden by child classes
     * Defines person object types, sync settings, and queue configuration
     *
     * @typedef {Object} CRMConfig
     * @property {Array<{crmObjectName: string, quoContactType: string}>} personObjectTypes - Person object mappings
     * @property {Object} syncConfig - Sync behavior configuration
     * @property {'PAGE_BASED'|'CURSOR_BASED'} syncConfig.paginationType - Pagination strategy
     * @property {boolean} syncConfig.supportsTotal - Does API return total count upfront?
     * @property {boolean} syncConfig.returnFullRecords - Does list API return full objects or just IDs?
     * @property {boolean} syncConfig.reverseChronological - Fetch newest records first
     * @property {number} syncConfig.initialBatchSize - Records per page for initial sync
     * @property {number} syncConfig.ongoingBatchSize - Records per page for delta sync
     * @property {number} syncConfig.pollIntervalMinutes - Polling interval if no webhooks
     * @property {number} [onCreateDelaySeconds=35] - Delay before webhook setup and initial sync (TEMPORARY: works around Quo API key propagation delay, will be removed once Quo fixes this)
     * @property {Object} queueConfig - SQS queue configuration
     * @property {number} queueConfig.maxWorkers - Maximum concurrent queue workers
     * @property {number} queueConfig.provisioned - Provisioned concurrency for Lambda
     * @property {number} queueConfig.maxConcurrency - Max concurrent executions
     * @property {number} queueConfig.batchSize - Messages processed per invocation
     * @property {number} queueConfig.timeout - Function timeout in seconds
     */
    static CRMConfig = {
        personObjectTypes: [],
        syncConfig: {
            paginationType: 'PAGE_BASED',
            supportsTotal: true,
            returnFullRecords: false,
            reverseChronological: true,
            initialBatchSize: 100,
            ongoingBatchSize: 50,
            pollIntervalMinutes: 60,
        },
        onCreateDelaySeconds: 35, // TEMPORARY: Default delay for Quo API key propagation - remove once Quo fixes this
        queueConfig: {
            maxWorkers: 5,
            provisioned: 0,
            maxConcurrency: 100,
            batchSize: 1,
            timeout: 600,
        },
    };

    constructor(params = {}) {
        super(params);

        // Initialize service references (lazy loaded)
        this._processManager = null;
        this._queueManager = null;
        this._syncOrchestrator = null;

        // Auto-generate CRM-specific events
        this.events = {
            ...this.events,

            // Post-creation setup: webhook registration and initial sync
            // Delayed to handle Quo API key propagation (~30 seconds)
            POST_CREATE_SETUP: {
                handler: this.handlePostCreateSetup.bind(this),
            },

            // User-triggered initial sync
            INITIAL_SYNC: {
                type: 'USER_ACTION',
                handler: this.startInitialSync.bind(this),
                title: 'Start Initial Sync',
                description: 'Sync all contacts from CRM to Quo',
                userActionType: 'SYNC_ACTION',
            },

            // Cron-triggered ongoing sync
            ONGOING_SYNC: {
                type: 'CRON',
                handler: this.startOngoingSync.bind(this),
            },

            // Process orchestration events (queue handlers)
            FETCH_PERSON_PAGE: {
                handler: this.fetchPersonPageHandler.bind(this),
            },

            PROCESS_PERSON_BATCH: {
                handler: this.processPersonBatchHandler.bind(this),
            },

            COMPLETE_SYNC: {
                handler: this.completeSyncHandler.bind(this),
            },

            // Outbound activity logging (from Quo webhooks)
            LOG_SMS: {
                handler: this.logSMS.bind(this),
            },

            LOG_CALL: {
                handler: this.logCall.bind(this),
            },
        };
    }

    // ============================================================================
    // SERVICE GETTERS (Lazy Initialization for DI in Tests)
    // ============================================================================

    get processManager() {
        if (!this._processManager) {
            this._processManager = this._createProcessManager();
        }
        return this._processManager;
    }

    get queueManager() {
        if (!this._queueManager) {
            this._queueManager = this._createQueueManager();
        }
        return this._queueManager;
    }

    get syncOrchestrator() {
        if (!this._syncOrchestrator) {
            this._syncOrchestrator = this._createSyncOrchestrator();
        }
        return this._syncOrchestrator;
    }

    // ============================================================================
    // PROTECTED FACTORY METHODS (Override in Tests for DI)
    // ============================================================================

    /**
     * Create ProcessManager instance
     * Override this in tests to inject mock
     * @protected
     */
    _createProcessManager() {
        const processRepository = createProcessRepository();

        return new ProcessManager({
            createProcessUseCase: new CreateProcess({ processRepository }),
            updateProcessStateUseCase: new UpdateProcessState({
                processRepository,
            }),
            updateProcessMetricsUseCase: new UpdateProcessMetrics({
                processRepository,
            }),
            getProcessUseCase: new GetProcess({ processRepository }),
        });
    }

    /**
     * Create QueueManager instance
     * Override this in tests to inject mock
     * @protected
     */
    _createQueueManager() {
        return new QueueManager({
            queuerUtil: QueuerUtilWrapper,
            queueUrl: this.getQueueUrl(),
        });
    }

    /**
     * Create SyncOrchestrator instance
     * Override this in tests to inject mock
     * @protected
     */
    _createSyncOrchestrator() {
        return new SyncOrchestrator({
            processManager: this.processManager,
            queueManager: this.queueManager,
        });
    }

    // ============================================================================
    // ABSTRACT METHODS - Child Classes MUST Implement
    // ============================================================================

    /**
     * Fetch a page of persons from the CRM
     *
     * Implementation depends on pagination strategy:
     * - PAGE_BASED: Use `page` param, return `{ data, total, hasMore }`
     * - CURSOR_BASED: Use `cursor` param, return `{ data, cursor, hasMore }`
     *
     * @abstract
     * @param {Object} params
     * @param {string} params.objectType - CRM object type (Contact, Lead, etc.)
     * @param {number} [params.page] - Page number (0-indexed) - for PAGE_BASED only
     * @param {string|null} [params.cursor] - Cursor for pagination - for CURSOR_BASED only
     * @param {number} params.limit - Records per page
     * @param {Date} [params.modifiedSince] - Filter by modification date
     * @param {boolean} [params.sortDesc=true] - Sort descending (newest first)
     * @returns {Promise<Object>} PAGE_BASED: {data: Array, total: number, hasMore: boolean} | CURSOR_BASED: {data: Array, cursor: string|null, hasMore: boolean}
     */
    async fetchPersonPage(params) {
        throw new Error('fetchPersonPage must be implemented by child class');
    }

    /**
     * Transform CRM person object to Quo contact format
     * @abstract
     * @param {Object} person - CRM person object
     * @returns {Promise<Object>} Quo contact format
     */
    async transformPersonToQuo(person) {
        throw new Error(
            'transformPersonToQuo must be implemented by child class',
        );
    }

    /**
     * Transform multiple CRM persons to Quo contacts (batch operation)
     * Default implementation: calls individual transformPersonToQuo for each
     * Child classes can override for batch optimizations (e.g., pre-fetch related data)
     *
     * @param {Array<Object>} persons - Array of CRM person objects
     * @returns {Promise<Array<Object>>} Array of Quo contact objects
     */
    async transformPersonsToQuo(persons) {
        return Promise.all(persons.map((p) => this.transformPersonToQuo(p)));
    }

    /**
     * Log SMS message to CRM as an activity
     * @abstract
     * @param {Object} activity - SMS activity
     * @param {string} activity.type - 'sms'
     * @param {string} activity.direction - 'inbound' or 'outbound'
     * @param {string} activity.content - SMS content
     * @param {string} activity.contactExternalId - CRM contact ID
     * @param {string} activity.timestamp - ISO timestamp
     * @returns {Promise<void>}
     */
    async logSMSToActivity(activity) {
        throw new Error('logSMSToActivity must be implemented by child class');
    }

    /**
     * Log phone call to CRM as an activity
     * @abstract
     * @param {Object} activity - Call activity
     * @param {string} activity.type - 'call'
     * @param {string} activity.direction - 'inbound' or 'outbound'
     * @param {number} activity.duration - Call duration in seconds
     * @param {string} activity.summary - AI-generated call summary
     * @param {string} activity.contactExternalId - CRM contact ID
     * @param {string} activity.timestamp - ISO timestamp
     * @returns {Promise<void>}
     */
    async logCallToActivity(activity) {
        throw new Error('logCallToActivity must be implemented by child class');
    }

    /**
     * Setup webhooks with the CRM (if supported)
     * @abstract
     * @returns {Promise<void>}
     */
    async setupWebhooks() {
        throw new Error('setupWebhooks must be implemented by child class');
    }

    // ============================================================================
    // OPTIONAL HELPER METHODS - Override for Optimization
    // ============================================================================

    /**
     * Fetch a single person by ID
     * Override if CRM has efficient single-record API
     * @param {string} id - Person ID
     * @returns {Promise<Object>}
     */
    async fetchPersonById(id) {
        throw new Error(
            'fetchPersonById must be implemented or override fetchPersonsByIds',
        );
    }

    /**
     * Fetch multiple persons by IDs (bulk fetch)
     * Override if CRM has bulk fetch API
     * @param {string[]} ids - Array of person IDs
     * @returns {Promise<Array>}
     */
    async fetchPersonsByIds(ids) {
        // Default: fetch one-by-one (inefficient, recommend overriding)
        const persons = await Promise.all(
            ids.map((id) => this.fetchPersonById(id)),
        );
        return persons;
    }

    // ============================================================================
    // LIFECYCLE METHODS - Override to Customize Behavior
    // ============================================================================

    /**
     * Called when integration is created
     * Override to customize behavior
     *
     * IMPORTANT: This method handles Quo (OpenPhone) API key propagation delay (~30 seconds).
     * Webhook setup and initial sync are delayed by 35 seconds to ensure API key is active.
     *
     * @param {Object} params
     * @param {string} params.integrationId - Integration ID
     */
    async onCreate({ integrationId }) {
        const integrationName = this.constructor.Definition?.name;
        if (!integrationName) {
            throw new Error(
                'Integration Definition.name is required but not defined',
            );
        }

        console.log(
            `[${integrationName}] onCreate called for ${integrationId}`,
        );

        // Check if we need user configuration
        const needsConfig = await this.checkIfNeedsConfig();

        if (needsConfig) {
            console.log(
                `[${integrationName}] Integration ${integrationId} needs configuration`,
            );
            await this.updateIntegrationStatus.execute(
                integrationId,
                'NEEDS_CONFIG',
            );
            return;
        }

        // Update status to ENABLED immediately
        console.log(
            `[${integrationName}] Marking integration ${integrationId} as ENABLED`,
        );
        await this.updateIntegrationStatus.execute(integrationId, 'ENABLED');

        // ⚠️ TEMPORARY WORKAROUND - SCHEDULED FOR REMOVAL ⚠️
        // Queue delayed webhook setup + initial sync to allow Quo API key propagation
        // Quo (OpenPhone) API keys take ~30 seconds to activate after creation
        // Without this delay, webhook creation fails with 401/403 errors
        // TODO: Remove this delay mechanism (and QueuerUtilWrapper) once Quo implements instant API key propagation
        const delaySeconds =
            this.constructor.CRMConfig?.onCreateDelaySeconds || 35;
        console.log(
            `[${integrationName}] Queueing delayed webhook setup + initial sync for ${integrationId} (${delaySeconds} second delay for Quo API key propagation)`,
        );

        try {
            await this.queueManager.queueMessage({
                action: 'POST_CREATE_SETUP',
                integrationId,
                delaySeconds,
            });
            console.log(
                `[${integrationName}] Delayed webhook setup + initial sync queued successfully for ${integrationId}`,
            );
        } catch (error) {
            console.error(
                `[${integrationName}] Failed to queue delayed webhook setup for ${integrationId}:`,
                error,
            );
            // Non-fatal - webhooks and sync can be triggered manually later
        }
    }

    /**
     * Check if integration needs additional configuration
     * Override to implement custom configuration logic
     * @returns {Promise<boolean>}
     */
    async checkIfNeedsConfig() {
        return false;
    }

    /**
     * Get configuration options for the integration
     * Override to provide custom configuration UI
     * @returns {Promise<Object>} Configuration schema
     */
    async getConfigOptions() {
        return {
            jsonSchema: {
                type: 'object',
                properties: {
                    triggerInitialSync: {
                        type: 'boolean',
                        title: 'Trigger Initial Sync Now?',
                        default: false,
                    },
                },
            },
            uiSchema: {
                type: 'VerticalLayout',
                elements: [
                    {
                        type: 'Control',
                        scope: '#/properties/triggerInitialSync',
                    },
                ],
            },
        };
    }

    /**
     * Called when user updates config
     * @param {Object} params
     * @param {string} params.integrationId - Integration ID
     * @param {Object} params.config - Updated config
     */
    async onUpdate({ integrationId, config }) {
        if (config && config.triggerInitialSync) {
            await this.startInitialSync({ integrationId });
        }
    }

    /**
     * Handle post-creation setup: webhook registration and initial sync
     * This is triggered by the POST_CREATE_SETUP queue message from onCreate
     *
     * Runs after a delay (default 35 seconds) to handle Quo API key propagation (~30 seconds).
     * By the time this runs, the API key should be active.
     *
     * IMPORTANT: This handler is called from a queue worker context where the integration
     * instance is NOT hydrated (no entities, userId, or API instances). The integration
     * is passed through as integrationId only, which the caller must use to hydrate if needed.
     *
     * For POST_CREATE_SETUP, we rely on the integrationId parameter being passed to
     * startInitialSync, which handles its own hydration through SyncOrchestrator.
     * setupWebhooks() should also handle integration lookup internally if it needs
     * the full integration record.
     *
     * @param {Object} event - Queue event with integrationId
     * @param {Object} event.data - Event data
     * @param {string} event.data.integrationId - Integration ID to setup
     * @returns {Promise<Object>} Setup result with webhooks and initialSync status
     */
    async handlePostCreateSetup({ data }) {
        const { integrationId } = data;
        const integrationName = this.constructor.Definition?.name;
        if (!integrationName) {
            throw new Error(
                'Integration Definition.name is required but not defined',
            );
        }

        console.log(
            `[${integrationName}] Starting post-create setup (webhook + sync) for ${integrationId}`,
        );

        const results = {
            webhooks: null,
            initialSync: null,
        };

        if (this.constructor.Definition?.webhooks?.enabled) {
            try {
                // Pass integrationId to setupWebhooks so it can hydrate if needed
                results.webhooks = await this.setupWebhooks({ integrationId });
                console.log(
                    `[${integrationName}] Webhook setup completed for ${integrationId}:`,
                    results.webhooks,
                );
            } catch (error) {
                console.error(
                    `[${integrationName}] Webhook setup failed for ${integrationId}:`,
                    error,
                );
                results.webhooks = {
                    status: 'failed',
                    error: error.message,
                };
                // Continue to try initial sync even if webhooks fail
            }
        } else {
            console.log(
                `[${integrationName}] Webhooks not enabled, skipping webhook setup`,
            );
            results.webhooks = {
                status: 'skipped',
                message: 'Webhooks not enabled',
            };
        }

        try {
            console.log(
                `[${integrationName}] Starting initial sync for ${integrationId}`,
            );
            results.initialSync = await this.startInitialSync({
                integrationId,
            });
            console.log(
                `[${integrationName}] Initial sync started for ${integrationId}:`,
                results.initialSync,
            );
        } catch (error) {
            console.error(
                `[${integrationName}] Failed to start initial sync for ${integrationId}:`,
                error,
            );
            results.initialSync = {
                status: 'failed',
                error: error.message,
            };
        }

        return results;
    }

    // ============================================================================
    // PUBLIC ORCHESTRATION METHODS
    // ============================================================================

    /**
     * Start initial sync for all person object types
     * @param {Object} params
     * @param {string} params.integrationId - Integration ID
     * @returns {Promise<Object>} Sync start result
     */
    async startInitialSync({ integrationId } = {}) {
        // Defensive: use integrationId parameter or fall back to this.id
        const id = integrationId || this.id;

        if (!id) {
            throw new Error('Cannot start sync: integration ID not available');
        }

        return await this.syncOrchestrator.startInitialSync({
            integration: this,
            integrationId: id,
            personObjectTypes: this.constructor.CRMConfig.personObjectTypes,
        });
    }

    /**
     * Start ongoing sync (delta sync)
     * @param {Object} params
     * @param {string} params.integrationId - Integration ID
     * @returns {Promise<Object>} Sync start result
     */
    async startOngoingSync({ integrationId } = {}) {
        // Defensive: use integrationId parameter or fall back to this.id
        const id = integrationId || this.id;

        if (!id) {
            throw new Error('Cannot start sync: integration ID not available');
        }

        return await this.syncOrchestrator.startOngoingSync({
            integration: this,
            integrationId: id,
            personObjectTypes: this.constructor.CRMConfig.personObjectTypes,
        });
    }

    // ============================================================================
    // QUEUE HANDLERS - Called by Queue Workers
    // ============================================================================

    /**
     * Handler: Fetch a page of persons
     * Routes to appropriate pagination strategy based on CRMConfig
     */
    async fetchPersonPageHandler({ data }) {
        const {
            processId,
            personObjectType,
            page,
            cursor,
            limit,
            modifiedSince,
            sortDesc,
        } = data;

        const syncConfig = this.constructor.CRMConfig.syncConfig;

        try {
            if (syncConfig.paginationType === 'CURSOR_BASED') {
                return await this._handleCursorBasedPagination({
                    processId,
                    personObjectType,
                    cursor,
                    limit,
                    modifiedSince,
                    sortDesc,
                });
            } else {
                return await this._handlePageBasedPagination({
                    processId,
                    personObjectType,
                    page,
                    limit,
                    modifiedSince,
                    sortDesc,
                });
            }
        } catch (error) {
            console.error(`Error in fetchPersonPageHandler:`, error);
            await this.processManager.handleError(processId, error);
            throw error;
        }
    }

    /**
     * Handle page-based pagination (existing behavior)
     * - Fetch page
     * - Fan out if page 0 and has total
     * - Queue person IDs for batch processing
     */
    async _handlePageBasedPagination({
        processId,
        personObjectType,
        page,
        limit,
        modifiedSince,
        sortDesc,
    }) {
        try {
            await this.processManager.updateState(processId, 'FETCHING_TOTAL');

            // Fetch page
            const personPage = await this.fetchPersonPage({
                objectType: personObjectType,
                page,
                limit,
                modifiedSince: modifiedSince ? new Date(modifiedSince) : null,
                sortDesc,
            });

            const persons = personPage.data || [];

            // If first page and has total, fan out all pages
            if (page === 0 && personPage.total) {
                const totalPages = Math.ceil(personPage.total / limit);

                await this.processManager.updateTotal(
                    processId,
                    personPage.total,
                    totalPages,
                );
                await this.processManager.updateState(
                    processId,
                    'QUEUING_PAGES',
                );

                // Fan out pages 1...N for parallel processing
                await this.queueManager.fanOutPages({
                    processId,
                    personObjectType,
                    totalPages,
                    startPage: 1,
                    limit,
                    modifiedSince: modifiedSince
                        ? new Date(modifiedSince)
                        : null,
                    sortDesc,
                });

                await this.processManager.updateState(
                    processId,
                    'PROCESSING_BATCHES',
                );
            }

            // Queue this page's persons for processing
            if (persons.length > 0) {
                await this.queueManager.queueProcessPersonBatch({
                    processId,
                    crmPersonIds: persons.map((p) => p.id),
                    page,
                    totalInPage: persons.length,
                });
            }

            // If no more pages and no total provided, complete
            if (page > 0 && persons.length < limit) {
                await this.queueManager.queueCompleteSync(processId);
            }
        } catch (error) {
            console.error(`Error fetching page ${page}:`, error);
            await this.processManager.handleError(processId, error);
            throw error;
        }
    }

    /**
     * Handle cursor-based pagination (new behavior)
     * - Fetch page with cursor
     * - Process immediately (fetch full data, transform, sync)
     * - Queue next page if more exist
     *
     * @param {Object} params
     * @param {string} params.processId - Process ID
     * @param {string} params.personObjectType - CRM object type
     * @param {string|null} params.cursor - Cursor for pagination (null for first page)
     * @param {number} params.limit - Records per page
     * @param {string} [params.modifiedSince] - Filter by modification date
     * @param {boolean} [params.sortDesc] - Sort descending
     */
    async _handleCursorBasedPagination({
        processId,
        personObjectType,
        cursor,
        limit,
        modifiedSince,
        sortDesc,
    }) {
        const syncConfig = this.constructor.CRMConfig.syncConfig;

        try {
            console.log(`[BaseCRM] Cursor-based pagination: cursor=${cursor}`);

            await this.processManager.updateState(processId, 'FETCHING_PAGE');

            // Fetch page (child class implements fetchPersonPage)
            const personPage = await this.fetchPersonPage({
                objectType: personObjectType,
                cursor,
                limit,
                modifiedSince: modifiedSince ? new Date(modifiedSince) : null,
                sortDesc,
            });

            const persons = personPage.data || [];
            const nextCursor = personPage.cursor || null;
            const hasMore = personPage.hasMore || false;

            console.log(
                `[BaseCRM] Fetched ${persons.length} records, hasMore=${hasMore}`,
            );

            // Handle empty first page
            if (!cursor && persons.length === 0) {
                console.log('[BaseCRM] No records found, completing sync');
                await this.processManager.updateTotal(processId, 0, 0);
                await this.queueManager.queueCompleteSync(processId);
                return;
            }

            // Update process totals (estimated)
            const metadata = await this.processManager.getMetadata(processId);
            const totalFetched = (metadata.totalFetched || 0) + persons.length;
            const pageCount = (metadata.pageCount || 0) + 1;

            await this.processManager.updateMetadata(processId, {
                totalFetched,
                pageCount,
                lastCursor: cursor,
            });

            // First page: provide initial estimate
            if (!cursor) {
                await this.processManager.updateTotal(
                    processId,
                    totalFetched,
                    1,
                );
                await this.processManager.updateState(
                    processId,
                    'PROCESSING_BATCHES',
                );
            } else {
                // Update running total
                await this.processManager.updateTotal(
                    processId,
                    totalFetched,
                    pageCount,
                );
            }

            console.log(
                `[BaseCRM] Progress: ${totalFetched} records across ${pageCount} pages`,
            );

            // Process records immediately (no separate queue)
            if (persons.length > 0) {
                console.log(
                    `[BaseCRM] Processing ${persons.length} records inline`,
                );

                try {
                    // If API returns full records, use them directly
                    let fullPersons;
                    if (syncConfig.returnFullRecords) {
                        fullPersons = persons;
                    } else {
                        // Must fetch full data by IDs
                        fullPersons = await this.fetchPersonsByIds(
                            persons.map((p) => p.id),
                        );
                    }

                    // Transform to Quo format
                    const quoContacts =
                        await this.transformPersonsToQuo(fullPersons);

                    // Bulk upsert to Quo
                    const results = await this.bulkUpsertToQuo(quoContacts);

                    // Update metrics
                    await this.processManager.updateMetrics(processId, {
                        processed: persons.length,
                        success: results.successCount,
                        errors: results.errorCount,
                        errorDetails: results.errors,
                    });

                    console.log(
                        `[BaseCRM] Synced ${results.successCount}/${persons.length} successfully`,
                    );
                } catch (error) {
                    console.error(`[BaseCRM] Error processing records:`, error);

                    // Update metrics with error
                    await this.processManager.updateMetrics(processId, {
                        processed: 0,
                        success: 0,
                        errors: persons.length,
                        errorDetails: [{ error: error.message, cursor }],
                    });
                }
            }

            // Queue next page OR complete sync
            if (hasMore && nextCursor) {
                console.log(
                    `[BaseCRM] Queuing next page with cursor=${nextCursor}`,
                );

                await this.queueManager.queueFetchPersonPage({
                    processId,
                    personObjectType,
                    cursor: nextCursor,
                    limit,
                    modifiedSince,
                    sortDesc,
                });
            } else {
                console.log(`[BaseCRM] All pages fetched, completing sync`);
                await this.queueManager.queueCompleteSync(processId);
            }
        } catch (error) {
            console.error(`[BaseCRM] Error in cursor-based pagination:`, error);
            await this.processManager.handleError(processId, error);
            throw error;
        }
    }

    /**
     * Handler: Process a batch of persons
     * 1. Retrieve full person data using IDs
     * 2. Transform to Quo format
     * 3. Bulk upsert to Quo
     * 4. Update metrics
     */
    async processPersonBatchHandler({ data }) {
        const { processId, crmPersonIds, page, isWebhook } = data;

        try {
            // Retrieve full person data from CRM
            const persons = await this.fetchPersonsByIds(crmPersonIds);

            // Transform to Quo format
            const quoContacts = await this.transformPersonsToQuo(persons);

            // Bulk upsert to Quo
            const results = await this.bulkUpsertToQuo(quoContacts);

            // Update metrics
            await this.processManager.updateMetrics(processId, {
                processed: crmPersonIds.length,
                success: results.successCount,
                errors: results.errorCount,
                errorDetails: results.errors,
            });
        } catch (error) {
            console.error(`Error processing batch:`, error);
            await this.processManager.updateMetrics(processId, {
                processed: 0,
                success: 0,
                errors: crmPersonIds.length,
                errorDetails: [{ error: error.message, batch: page }],
            });
        }
    }

    /**
     * Handler: Complete sync process
     */
    async completeSyncHandler({ data }) {
        const { processId } = data;

        await this.processManager.completeProcess(processId);
    }

    // ============================================================================
    // OUTBOUND ACTIVITY LOGGING
    // ============================================================================

    /**
     * Log SMS from Quo to CRM
     * @param {Object} params
     * @param {Object} params.data - SMS data from Quo
     */
    async logSMS({ data: sms }) {
        if (!this.logSMSToActivity) {
            console.warn('SMS logging not supported');
            return;
        }

        const activity = this.transformQuoSMSToActivity(sms);
        await this.logSMSToActivity(activity);
    }

    /**
     * Log call from Quo to CRM
     * @param {Object} params
     * @param {Object} params.data - Call data from Quo
     */
    async logCall({ data: call }) {
        if (!this.logCallToActivity) {
            console.warn('Call logging not supported');
            return;
        }

        const activity = this.transformQuoCallToActivity(call);
        await this.logCallToActivity(activity);
    }

    /**
     * Transform Quo SMS to activity format
     * @param {Object} sms - Quo SMS object
     * @returns {Object} Activity format
     */
    transformQuoSMSToActivity(sms) {
        return {
            type: 'sms',
            direction: sms.direction,
            content: sms.body,
            timestamp: sms.createdAt,
            contactExternalId: sms.contactId,
        };
    }

    /**
     * Transform Quo call to activity format
     * @param {Object} call - Quo call object
     * @returns {Object} Activity format
     */
    transformQuoCallToActivity(call) {
        return {
            type: 'call',
            direction: call.direction,
            duration: call.duration,
            summary: call.aiSummary,
            timestamp: call.createdAt,
            contactExternalId: call.contactId,
        };
    }

    // ============================================================================
    // HELPER METHODS
    // ============================================================================

    /**
     * Upsert a single contact to Quo using Frigg-authenticated endpoints
     *
     * This method implements the lookup-then-create/update pattern:
     * 1. Look up contact by externalId using listContacts
     * 2. If found, update using updateFriggContact
     * 3. If not found, create using createFriggContact
     * 4. Store mapping by phone number
     *
     * Uses /frigg/contacts endpoints which require x-frigg-api-key header.
     *
     * @param {Object} quoContact - Contact data in Quo format
     * @param {string} quoContact.externalId - External CRM ID (required)
     * @param {Object} quoContact.defaultFields - Contact fields
     * @returns {Promise<{action: 'created'|'updated', quoContactId: string, externalId: string}>}
     */
    async upsertContactToQuo(quoContact) {
        if (!this.quo?.api) {
            throw new Error('Quo API not available');
        }

        if (!quoContact.externalId) {
            throw new Error('Contact must have an externalId');
        }

        const existingContacts = await this.quo.api.listContacts({
            externalIds: [quoContact.externalId],
            maxResults: 1,
        });

        const existingContact =
            existingContacts?.data?.length > 0
                ? existingContacts.data[0]
                : null;

        let result;
        let action;

        if (existingContact) {
            const response = await this.quo.api.updateFriggContact(
                existingContact.id,
                quoContact,
            );
            result = response.data;
            action = 'updated';
        } else {
            const response = await this.quo.api.createFriggContact(quoContact);
            result = response.data;
            action = 'created';
        }

        const quoContactId = result.id;
        const phoneNumber = quoContact.defaultFields?.phoneNumbers?.[0]?.value;

        if (phoneNumber) {
            const mappingData = {
                externalId: quoContact.externalId,
                quoContactId,
                phoneNumber,
                entityType: 'people',
                lastSyncedAt: new Date().toISOString(),
                syncMethod: 'upsert',
                action,
            };

            await this.upsertMapping(phoneNumber, mappingData);
        } else {
            console.warn(
                `No phone number for ${quoContact.externalId}, skipping mapping`,
            );
        }

        return {
            action,
            quoContactId,
            externalId: quoContact.externalId,
        };
    }

    /**
     * Fetch contacts by external IDs with automatic pagination to respect API limits
     *
     * The Quo API has a maxResults limit of 50. This method automatically handles
     * pagination when fetching more than 50 contacts. All pages are fetched in parallel
     * for optimal performance.
     *
     * @param {string[]} externalIds - Array of external IDs to fetch
     * @param {number} pageSize - Page size (default: 50, max: 50)
     * @returns {Promise<Object[]>} Array of fetched contacts
     * @private
     */
    async _fetchContactsByExternalIds(externalIds, pageSize = 50) {
        const maxPageSize = 50; // Quo API limit
        const effectivePageSize = Math.min(pageSize, maxPageSize);

        // Split externalIds into chunks
        const chunks = [];
        for (let i = 0; i < externalIds.length; i += effectivePageSize) {
            chunks.push(externalIds.slice(i, i + effectivePageSize));
        }

        // Fetch all pages in parallel for better performance
        const fetchPromises = chunks.map((chunk, index) =>
            this.quo.api
                .listContacts({
                    externalIds: chunk,
                    maxResults: effectivePageSize,
                })
                .catch((error) => {
                    // Log error with page info
                    console.error(
                        `Failed to fetch page ${index + 1}:`,
                        error.message,
                    );
                    // Rethrow to fail the entire operation
                    throw error;
                }),
        );

        try {
            const responses = await Promise.all(fetchPromises);

            // Combine all results
            const allContacts = responses.flatMap(
                (response) => response?.data || [],
            );

            return allContacts;
        } catch (error) {
            // If any page fails, the error will bubble up from Promise.all
            throw error;
        }
    }

    /**
     * Bulk upsert contacts to Quo and create mappings
     *
     * @param {Array} contacts - Array of Quo contact objects
     * @returns {Promise<Object>} Upsert results with successCount, errorCount, errors
     */
    async bulkUpsertToQuo(contacts) {
        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        try {
            // Call bulkCreateContacts with contacts
            await this.quo.api.bulkCreateContacts(contacts);

            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Fetch created contacts using paginated helper
            const externalIds = contacts.map((c) => c.externalId);
            const fetchedContactsData =
                await this._fetchContactsByExternalIds(externalIds);

            if (fetchedContactsData) {
                for (const createdContact of fetchedContactsData) {
                    try {
                        const phoneNumber =
                            createdContact.defaultFields?.phoneNumbers?.[0]
                                ?.value;

                        if (phoneNumber) {
                            const originalContact = contacts.find(
                                (c) =>
                                    c.externalId === createdContact.externalId,
                            );

                            // Store mapping by phone number (contains both IDs)
                            const mappingData = {
                                externalId: createdContact.externalId,
                                quoContactId: createdContact.id,
                                phoneNumber: phoneNumber,
                                entityType:
                                    originalContact?.sourceEntityType ||
                                    'people',
                                lastSyncedAt: new Date().toISOString(),
                                syncMethod: 'bulk',
                                action: 'created',
                            };

                            await this.upsertMapping(phoneNumber, mappingData);
                            successCount++;
                        } else {
                            console.warn(
                                `No phone number for ${createdContact.externalId}, skipping mapping`,
                            );
                            errorCount++;
                            errors.push({
                                error: 'No phone number available',
                                externalId: createdContact.externalId,
                            });
                        }
                    } catch (mappingError) {
                        console.error(
                            `Failed to create mapping for ${createdContact.externalId}:`,
                            mappingError,
                        );
                        errorCount++;
                        errors.push({
                            error: mappingError.message,
                            externalId: createdContact.externalId,
                        });
                    }
                }
            }

            if (fetchedContactsData?.length < contacts.length) {
                const createdExternalIds = new Set(
                    fetchedContactsData.map((c) => c.externalId),
                );
                const failedContacts = contacts.filter(
                    (c) => !createdExternalIds.has(c.externalId),
                );

                errorCount += failedContacts.length;
                failedContacts.forEach((c) => {
                    errors.push({
                        error: 'Contact not found after bulk create',
                        externalId: c.externalId,
                    });
                });
            }
        } catch (error) {
            errorCount = contacts.length;
            console.error('Bulk upsert error:', error);
            errors.push({
                error: error.message,
                timestamp: new Date().toISOString(),
                contactCount: contacts.length,
            });
        }

        return { successCount, errorCount, errors };
    }

    /**
     * Get queue URL for this integration
     * @returns {string} Queue URL
     */
    getQueueUrl() {
        const integrationName = this.constructor.Definition.name;
        return process.env[`${integrationName.toUpperCase()}_QUEUE_URL`];
    }

    // ============================================================================
    // WEBHOOK LOOKUP OPTIMIZATION (Mapping-First Pattern)
    // ============================================================================

    /**
     * Get external CRM ID from mapping by phone number (for webhook → CRM lookup)
     *
     * Uses Frigg's integrationMappingRepository for O(1) lookup.
     * Quo webhooks provide phone numbers, not contact IDs, so we use phone as the lookup key.
     *
     * @param {string} phoneNumber - Normalized phone number from Quo webhook
     * @returns {Promise<string|null>} External CRM ID or null if not found
     */
    async _getExternalIdFromMappingByPhone(phoneNumber) {
        try {
            // Use Frigg's mapping repository with phone number as sourceId
            const mapping = await this.getMapping(phoneNumber);

            if (mapping?.externalId) {
                console.log(
                    `[Mapping Lookup] ✓ Found externalId: ${mapping.externalId} for phone: ${phoneNumber}`,
                );
                return mapping.externalId;
            }

            console.log(
                `[Mapping Lookup] ✗ No mapping found for phone: ${phoneNumber}`,
            );
            return null;
        } catch (error) {
            console.error(`[Mapping Lookup] Error: ${error.message}`);
            return null;
        }
    }

    /**
     * Find external contact by phone number (OVERRIDE IN CHILD CLASSES)
     *
     * Default implementation throws error. Integrations that support
     * phone-based contact lookup should override this method.
     *
     * Examples:
     * - Attio: Implements phone search via queryRecords API
     * - AxisCare: Does NOT support phone search, throws error
     *
     * @param {string} phoneNumber - Phone number to search
     * @returns {Promise<string>} External CRM ID
     * @throws {Error} If contact not found or search not supported
     */
    async _findContactByPhone(phoneNumber) {
        throw new Error(
            `${this.constructor.name} does not support phone-based contact lookup for ${phoneNumber}. ` +
                `Contact mapping is required for webhook activity logging.`,
        );
    }

    /**
     * Fetch phone numbers from Quo API and store their IDs in config
     * This is called during the delayed setup hook to prepare for webhook subscriptions
     * with resourceIds filtering.
     *
     * All CRM integrations can use this method to enable phone-number-specific
     * webhook subscriptions.
     *
     * @returns {Promise<string[]>} Array of phone number IDs
     * @throws {Error} If Quo API is not configured
     */
    async _fetchAndStoreEnabledPhoneIds() {
        if (!this.quo?.api) {
            throw new Error(
                'Quo API not configured - cannot fetch phone numbers',
            );
        }

        console.log('[Quo] Fetching phone numbers for webhook subscriptions');

        const response = await this.quo.api.listPhoneNumbers({
            maxResults: 100,
        });

        const phoneIds = response.data.map((phone) => phone.id);

        console.log(
            `[Quo] Found ${phoneIds.length} phone number(s): ${phoneIds.join(', ')}`,
        );

        // Store both phone IDs and metadata in config
        const updatedConfig = {
            ...this.config,
            enabledPhoneIds: phoneIds,
            phoneNumbersMetadata: response.data,
            phoneNumbersFetchedAt: new Date().toISOString(),
        };

        await this.commands.updateIntegrationConfig({
            integrationId: this.id,
            config: updatedConfig,
        });

        this.config = updatedConfig;

        console.log('[Quo] ✓ Phone number IDs stored in config');

        return phoneIds;
    }

    /**
     * Fetch phone metadata for specific phone IDs from Quo API
     */
    async _fetchPhoneMetadataForIds(phoneIds) {
        if (!this.quo?.api) {
            throw new Error(
                'Quo API not configured - cannot fetch phone metadata',
            );
        }

        if (!phoneIds || phoneIds.length === 0) {
            console.log(
                '[Quo] No phone IDs provided, returning empty metadata',
            );
            return [];
        }

        console.log(
            `[Quo] Fetching metadata for ${phoneIds.length} phone number(s)`,
        );

        // Fetch all phone numbers from Quo API
        // Note: Quo API doesn't support filtering by IDs, so we fetch all and filter locally
        const response = await this.quo.api.listPhoneNumbers({
            maxResults: 100,
        });

        const allPhones = response.data || [];
        const phoneIdSet = new Set(phoneIds);
        const matchedPhones = allPhones.filter((phone) =>
            phoneIdSet.has(phone.id),
        );

        const foundIds = new Set(matchedPhones.map((p) => p.id));
        const missingIds = phoneIds.filter((id) => !foundIds.has(id));
        if (missingIds.length > 0) {
            console.warn(
                `[Quo] ${missingIds.length} phone ID(s) not found in Quo: ${missingIds.join(', ')}`,
            );
        }

        console.log(
            `[Quo] ✓ Fetched metadata for ${matchedPhones.length}/${phoneIds.length} phone number(s)`,
        );

        return matchedPhones;
    }

    /**
     * Split an array into chunks of specified size
     * Used for batching phone IDs when creating webhooks (Quo API max: 10 resourceIds per webhook)
     *
     * @private
     * @param {Array} array - Array to split into chunks
     * @param {number} chunkSize - Maximum size of each chunk (default: 10)
     * @returns {Array<Array>} Array of chunks, or [] if input is empty
     */
    _chunkArray(array, chunkSize = 10) {
        const chunks = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }

    /**
     * Create Quo webhooks with phone number IDs as resourceIds
     * Batches phone IDs into groups of 10 (Quo API limit) and creates multiple webhooks per type if needed.
     * Implements all-or-nothing rollback: if any webhook creation fails, all created webhooks are deleted.
     *
     * Examples:
     * - 9 phone IDs → 1 webhook per type (3 total)
     * - 14 phone IDs → 2 webhooks per type (6 total)
     * - 21 phone IDs → 3 webhooks per type (9 total)
     *
     * @param {string} webhookUrl - The URL to receive webhook events
     * @param {string[]} phoneIds - Array of phone IDs to filter webhooks by
     * @returns {Promise<{messageWebhooks: Array, callWebhooks: Array, callSummaryWebhooks: Array}>}
     * @throws {Error} If Quo API is not configured or webhook creation fails
     */
    async _createQuoWebhooksWithPhoneIds(webhookUrl, phoneIds = []) {
        if (!this.quo?.api) {
            throw new Error('Quo API not configured - cannot create webhooks');
        }

        if (phoneIds.length === 0) {
            console.log('[Quo] No phone IDs configured, skipping webhook creation', {integrationId: this.id});
            return {
                messageWebhooks: [],
                callWebhooks: [],
                callSummaryWebhooks: [],
            };
        }

        const phoneIdBatches = this._chunkArray(phoneIds, 10);

        console.log(
            `[Quo] Creating webhooks for ${phoneIds.length} phone ID(s) in ${phoneIdBatches.length} batch(es)`,
        );

        const WEBHOOK_EVENTS = this.constructor.WEBHOOK_EVENTS;
        const WEBHOOK_LABELS = this.constructor.WEBHOOK_LABELS;

        if (!WEBHOOK_EVENTS || !WEBHOOK_LABELS) {
            throw new Error(
                `${this.constructor.name} must define static WEBHOOK_EVENTS and WEBHOOK_LABELS constants`,
            );
        }

        const createdWebhooks = {
            message: [],
            call: [],
            callSummary: [],
        };

        try {
            // Create all message webhooks (one per batch)
            for (let i = 0; i < phoneIdBatches.length; i++) {
                const batch = phoneIdBatches[i];
                const webhookData = {
                    url: webhookUrl,
                    status: 'enabled',
                    events: WEBHOOK_EVENTS.QUO_MESSAGES,
                    label:
                        phoneIdBatches.length > 1
                            ? `${WEBHOOK_LABELS.QUO_MESSAGES} (batch ${i + 1})`
                            : WEBHOOK_LABELS.QUO_MESSAGES,
                };

                if (batch.length > 0) {
                    webhookData.resourceIds = batch;
                }

                const response =
                    await this.quo.api.createMessageWebhook(webhookData);

                if (!response?.data?.id || !response.data.key) {
                    throw new Error(
                        'Invalid Quo message webhook response: missing id or key',
                    );
                }

                createdWebhooks.message.push({
                    id: response.data.id,
                    key: response.data.key,
                    resourceIds: batch,
                });
            }

            // Create all call webhooks (one per batch)
            for (let i = 0; i < phoneIdBatches.length; i++) {
                const batch = phoneIdBatches[i];
                const webhookData = {
                    url: webhookUrl,
                    status: 'enabled',
                    events: WEBHOOK_EVENTS.QUO_CALLS,
                    label:
                        phoneIdBatches.length > 1
                            ? `${WEBHOOK_LABELS.QUO_CALLS} (batch ${i + 1})`
                            : WEBHOOK_LABELS.QUO_CALLS,
                };

                if (batch.length > 0) {
                    webhookData.resourceIds = batch;
                }

                const response =
                    await this.quo.api.createCallWebhook(webhookData);

                if (!response?.data?.id || !response.data.key) {
                    throw new Error(
                        'Invalid Quo call webhook response: missing id or key',
                    );
                }

                createdWebhooks.call.push({
                    id: response.data.id,
                    key: response.data.key,
                    resourceIds: batch,
                });
            }

            // Create all call summary webhooks (one per batch)
            for (let i = 0; i < phoneIdBatches.length; i++) {
                const batch = phoneIdBatches[i];
                const webhookData = {
                    url: webhookUrl,
                    status: 'enabled',
                    events: WEBHOOK_EVENTS.QUO_CALL_SUMMARIES,
                    label:
                        phoneIdBatches.length > 1
                            ? `${WEBHOOK_LABELS.QUO_CALL_SUMMARIES} (batch ${i + 1})`
                            : WEBHOOK_LABELS.QUO_CALL_SUMMARIES,
                };

                if (batch.length > 0) {
                    webhookData.resourceIds = batch;
                }

                const response =
                    await this.quo.api.createCallSummaryWebhook(webhookData);

                if (!response?.data?.id || !response.data.key) {
                    throw new Error(
                        'Invalid Quo call-summary webhook response: missing id or key',
                    );
                }

                createdWebhooks.callSummary.push({
                    id: response.data.id,
                    key: response.data.key,
                    resourceIds: batch,
                });
            }

            const totalWebhooks =
                createdWebhooks.message.length +
                createdWebhooks.call.length +
                createdWebhooks.callSummary.length;

            console.log(`[Quo] ✓ Created ${totalWebhooks} webhook(s) total`);

            return {
                messageWebhooks: createdWebhooks.message,
                callWebhooks: createdWebhooks.call,
                callSummaryWebhooks: createdWebhooks.callSummary,
            };
        } catch (error) {
            console.error(
                '[Quo] Webhook creation failed, rolling back...',
                {
                    integrationId: this.id,
                    error
                },
            );

            // Rollback: Delete all successfully created webhooks
            const allCreated = [
                ...createdWebhooks.message,
                ...createdWebhooks.call,
                ...createdWebhooks.callSummary,
            ];

            if (allCreated.length > 0) {
                console.warn(
                    `[Quo] Rolling back ${allCreated.length} webhook(s)`,
                    { integrationId: this.id }
                );

                for (const webhook of allCreated) {
                    try {
                        await this.quo.api.deleteWebhook(webhook.id);
                        console.log(
                            `[Quo] ✓ Rolled back webhook ${webhook.id}`,
                            { integrationId: this.id }
                        );
                    } catch (deleteError) {
                        console.error(
                            `[Quo] Failed to rollback webhook ${webhook.id}:`,
                            { integrationId: this.id, error: deleteError.message }
                        );
                    }
                }
            }

            throw error;
        }
    }

    /**
     * Recreate Quo webhooks with updated phone IDs (delete + create pattern)
     * Creates new webhooks first, then deletes old ones for minimal downtime.
     * Rolls back on failure.
     */
    async _recreateQuoWebhooks(newPhoneIds) {
        // Support both new array structure and old single-value structure
        const oldWebhooks = {
            message: this.config?.quoMessageWebhooks || [],
            call: this.config?.quoCallWebhooks || [],
            callSummary: this.config?.quoCallSummaryWebhooks || [],
        };

        // Check for old single-value webhook IDs (legacy structure)
        const legacyWebhookIds = {
            message: this.config?.quoMessageWebhookId,
            call: this.config?.quoCallWebhookId,
            callSummary: this.config?.quoCallSummaryWebhookId,
        };

        const areWebhooksConfigured =
            oldWebhooks.message.length > 0 ||
            oldWebhooks.call.length > 0 ||
            oldWebhooks.callSummary.length > 0;

        const areWebhooksConfiguredLegacy =
            legacyWebhookIds.message ||
            legacyWebhookIds.call ||
            legacyWebhookIds.callSummary;

        // If no existing webhooks but we have new phone IDs, check if webhooks were ever configured
        if (!areWebhooksConfigured && !areWebhooksConfiguredLegacy) {
            if (newPhoneIds.length === 0) {
                // No old webhooks and no new phone IDs - nothing to do
                console.log('[Quo] No webhooks configured and no phone IDs - skipping', {integrationId: this.id});
                return {
                    messageWebhooks: [],
                    callWebhooks: [],
                    callSummaryWebhooks: [],
                };
            }
        }

        // Handle empty phone IDs (delete only, no create)
        if (newPhoneIds.length === 0) {
            console.log('[Quo] Deleting webhooks (all phones opted out)...');

            const oldWebhookIds = [
                ...oldWebhooks.message.map((wh) => wh.id),
                ...oldWebhooks.call.map((wh) => wh.id),
                ...oldWebhooks.callSummary.map((wh) => wh.id),
                ...(legacyWebhookIds.message ? [legacyWebhookIds.message] : []),
                ...(legacyWebhookIds.call ? [legacyWebhookIds.call] : []),
                ...(legacyWebhookIds.callSummary
                    ? [legacyWebhookIds.callSummary]
                    : []),
            ];

            const deletionResults = await Promise.allSettled(
                oldWebhookIds.map((id) => this.quo.api.deleteWebhook(id)),
            );

            deletionResults.forEach((result, index) => {
                if (result.status === 'rejected') {
                    console.warn(
                        `[Quo] Could not delete webhook ${oldWebhookIds[index]}: ${result.reason?.message}`,
                        {integrationId: this.id},
                    );
                } else {
                    console.log(
                        `[Quo] ✓ Deleted webhook ${oldWebhookIds[index]}`,
                        {integrationId: this.id},
                    );
                }
            });

            console.log(
                '[Quo] ✓ Webhooks deleted (no new webhooks created)',
                {integrationId: this.id},
            );

            return {
                messageWebhooks: [],
                callWebhooks: [],
                callSummaryWebhooks: [],
            };
        }

        console.log(
            `[Quo] Recreating webhooks with ${newPhoneIds.length} phone number ID(s)`,
            {integrationId: this.id},
        );

        try {
            // Create new webhooks FIRST to minimize downtime
            console.log('[Quo] Creating new webhooks...');
            const webhookUrl = this._generateWebhookUrl(`/webhooks/${this.id}`);
            const newWebhooks = await this._createQuoWebhooksWithPhoneIds(webhookUrl, newPhoneIds);

            console.log('[Quo] ✓ New webhooks created successfully for integration:', {integrationId: this.id});

            // Delete old webhooks (best effort - collect IDs from both new and legacy structures)
            console.log('[Quo] Deleting old webhooks...');

            const oldWebhookIds = [
                // New array structure
                ...oldWebhooks.message.map((wh) => wh.id),
                ...oldWebhooks.call.map((wh) => wh.id),
                ...oldWebhooks.callSummary.map((wh) => wh.id),
                // Legacy single-value structure
                ...(legacyWebhookIds.message ? [legacyWebhookIds.message] : []),
                ...(legacyWebhookIds.call ? [legacyWebhookIds.call] : []),
                ...(legacyWebhookIds.callSummary
                    ? [legacyWebhookIds.callSummary]
                    : []),
            ];

            const deletionResults = await Promise.allSettled(
                oldWebhookIds.map((id) => this.quo.api.deleteWebhook(id)),
            );

            deletionResults.forEach((result, index) => {
                if (result.status === 'rejected') {
                    console.warn(
                        `[Quo] Could not delete old webhook ${oldWebhookIds[index]} (may already be deleted): ${result.reason?.message}`,
                        {integrationId: this.id},
                    );
                } else {
                    console.log(
                        `[Quo] ✓ Deleted old webhook ${oldWebhookIds[index]}`,
                        {integrationId: this.id},
                    );
                }
            });

            console.log('[Quo] ✓ Old webhooks cleanup complete', {integrationId: this.id});

            return newWebhooks;
        } catch (error) {
            console.error(`[Quo] Webhook recreation failed: ${error.message}`, {integrationId: this.id});
            throw error;
        }
    }

    /**
     * Handle integration configuration updates (PATCH semantics)
     * When phone IDs change, fetches fresh metadata and recreates webhooks
     * before persisting config.
     */
    async onUpdate(params) {
        const updateConfig = params?.config || {};

        console.log('[Config Update] Processing configuration update');

        // Translate resourceIds → enabledPhoneIds
        const translatedConfig = this._translateConfigFields(updateConfig);
        const patchedConfig = this._deepMerge(this.config, translatedConfig);

        const oldPhoneIds = this.config?.enabledPhoneIds || [];
        const newPhoneIds = patchedConfig?.enabledPhoneIds || [];
        const phoneIdsChanged =
            JSON.stringify([...oldPhoneIds].sort()) !==
            JSON.stringify([...newPhoneIds].sort());

        // Handle phone ID changes before persisting config
        if (phoneIdsChanged) {
            if (!this.quo?.api) {
                console.warn(
                    '[Config Update] Phone IDs changed but Quo API not configured, skipping phone update',
                );
            } else {
                console.log(
                    `[Config Update] Phone IDs changed: ${oldPhoneIds.length} → ${newPhoneIds.length}`,
                );

                try {
                    console.log(
                        '[Config Update] Fetching fresh phone metadata...',
                    );
                    const freshMetadata =
                        await this._fetchPhoneMetadataForIds(newPhoneIds);

                    patchedConfig.phoneNumbersMetadata = freshMetadata;
                    patchedConfig.phoneNumbersFetchedAt =
                        new Date().toISOString();

                    console.log(
                        `[Config Update] ✓ Phone metadata updated (${freshMetadata.length} phones)`,
                    );

                    // Recreate webhooks (Quo API doesn't support PATCH)
                    console.log('[Config Update] Recreating webhooks...');
                    const newWebhooks =
                        await this._recreateQuoWebhooks(newPhoneIds);

                    patchedConfig.quoMessageWebhooks =
                        newWebhooks.messageWebhooks;
                    patchedConfig.quoCallWebhooks = newWebhooks.callWebhooks;
                    patchedConfig.quoCallSummaryWebhooks =
                        newWebhooks.callSummaryWebhooks;
                    patchedConfig.quoWebhooksCreatedAt =
                        new Date().toISOString();

                    // Clean up legacy single-value webhook fields after migration
                    delete patchedConfig.quoMessageWebhookId;
                    delete patchedConfig.quoMessageWebhookKey;
                    delete patchedConfig.quoCallWebhookId;
                    delete patchedConfig.quoCallWebhookKey;
                    delete patchedConfig.quoCallSummaryWebhookId;
                    delete patchedConfig.quoCallSummaryWebhookKey;

                    console.log(
                        '[Config Update] ✓ Webhooks recreated successfully',
                    );
                } catch (error) {
                    console.error(
                        '[Config Update] Failed to update phone configuration:',
                        error,
                    );
                    throw error;
                }
            }
        }

        await this.commands.updateIntegrationConfig({
            integrationId: this.id,
            config: patchedConfig,
        });
        this.config = patchedConfig;

        console.log('[Config Update] ✓ Configuration patched and persisted');
        console.log('[Config Update] ✓ Update complete');

        return { success: true, config: patchedConfig };
    }

    /**
     * Translate external config field names to internal field names
     * (e.g., resourceIds → enabledPhoneIds)
     * @private
     */
    _translateConfigFields(config) {
        if (!config) {
            return {};
        }

        const translated = { ...config };

        // Translate resourceIds → enabledPhoneIds
        if ('resourceIds' in translated) {
            translated.enabledPhoneIds = translated.resourceIds;
            delete translated.resourceIds;
        }

        return translated;
    }

    /**
     * Deep merge two objects (helper for PATCH semantics)
     * @private
     * @param {Object} target - Target object (existing config)
     * @param {Object} source - Source object (update config)
     * @returns {Object} Merged object
     */
    _deepMerge(target, source) {
        const output = { ...target };

        if (!source) {
            return output;
        }

        for (const key in source) {
            if (source.hasOwnProperty(key)) {
                if (
                    source[key] &&
                    typeof source[key] === 'object' &&
                    !Array.isArray(source[key])
                ) {
                    // Recursively merge nested objects
                    output[key] = this._deepMerge(
                        target[key] || {},
                        source[key],
                    );
                } else {
                    // Overwrite primitives and arrays
                    output[key] = source[key];
                }
            }
        }

        return output;
    }
}

module.exports = { BaseCRMIntegration };
