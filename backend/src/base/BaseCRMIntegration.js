const { IntegrationBase } = require('@friggframework/core');
const { QueuerUtil } = require('@friggframework/core');
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
     * @property {boolean} syncConfig.supportsWebhooks - Does CRM support webhooks?
     * @property {number} syncConfig.pollIntervalMinutes - Polling interval if no webhooks
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
            supportsWebhooks: false,
            pollIntervalMinutes: 60,
        },
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

            // Webhook from CRM
            WEBHOOK_RECEIVED: {
                handler: this.handleWebhook.bind(this),
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
            queuerUtil: QueuerUtil,
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
     * @returns {Object} Quo contact format
     */
    transformPersonToQuo(person) {
        throw new Error(
            'transformPersonToQuo must be implemented by child class',
        );
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
     * @param {Object} params
     * @param {string} params.integrationId - Integration ID
     */
    async onCreate({ integrationId }) {
        // Setup webhooks immediately (before any sync)
        if (this.constructor.CRMConfig.syncConfig.supportsWebhooks) {
            try {
                await this.setupWebhooks();
            } catch (error) {
                console.error('Failed to setup webhooks:', error);
                // Non-fatal, continue with polling fallback
            }
        }

        // Check if we need user configuration
        const needsConfig = await this.checkIfNeedsConfig();

        if (needsConfig) {
            await this.updateIntegrationStatus.execute(
                integrationId,
                'NEEDS_CONFIG',
            );
        } else {
            await this.updateIntegrationStatus.execute(
                integrationId,
                'ENABLED',
            );
            // Optionally trigger initial sync automatically
            // await this.startInitialSync({ integrationId });
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

    /**
     * Handle webhook from CRM
     * @param {Object} params
     * @param {Array|Object} params.data - Webhook data
     * @returns {Promise<Object>} Webhook handling result
     */
    async handleWebhook({ data }) {
        return await this.syncOrchestrator.handleWebhook({
            integration: this,
            data,
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
            console.log(
                `[BaseCRM] Cursor-based pagination: cursor=${cursor}`,
            );

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
            const metadata =
                await this.processManager.getMetadata(processId);
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
                    const quoContacts = fullPersons.map((p) => this.transformPersonToQuo(p));

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
                    console.error(
                        `[BaseCRM] Error processing records:`,
                        error,
                    );

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
            const quoContacts = persons.map((p) => this.transformPersonToQuo(p));

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
     * Bulk upsert contacts to Quo
     * @param {Array} contacts - Array of Quo contact objects
     * @returns {Promise<Object>} Upsert results
     */
    async bulkUpsertToQuo(contacts) {
        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        try {
            await this.quo.api.bulkCreateContacts(contacts);
            successCount = contacts.length;
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
}

module.exports = { BaseCRMIntegration };
