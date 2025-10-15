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
 * @example
 * class ZohoCRMIntegration extends BaseCRMIntegration {
 *   static CRMConfig = {
 *     personObjectTypes: [{ crmObjectName: 'Contact', quoContactType: 'contact' }],
 *     syncConfig: { reverseChronological: true, initialBatchSize: 100 },
 *     queueConfig: { maxWorkers: 25 }
 *   };
 *
 *   async fetchPersonPage(params) { / * ... * / }
 *   async transformPersonToQuo(person) { / * ... * / }
 *   // ... implement other 3 methods
 * }
 */
class BaseCRMIntegration extends IntegrationBase {
    /**
     * CRM Configuration - MUST be overridden by child classes
     * Defines person object types, sync settings, and queue configuration
     */
    static CRMConfig = {
        personObjectTypes: [],
        syncConfig: {
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
     * @abstract
     * @param {Object} params
     * @param {string} params.objectType - CRM object type (Contact, Lead, etc.)
     * @param {number} params.page - Page number (0-indexed)
     * @param {number} params.limit - Records per page
     * @param {Date} [params.modifiedSince] - Filter by modification date
     * @param {boolean} [params.sortDesc=true] - Sort descending (newest first)
     * @returns {Promise<{data: Array, total: number, hasMore: boolean}>}
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
     * 1. Fetch page from CRM
     * 2. If first page: Determine total, queue all remaining pages
     * 3. Queue batch for processing
     */
    async fetchPersonPageHandler({ data }) {
        const {
            processId,
            personObjectType,
            page,
            limit,
            modifiedSince,
            sortDesc,
        } = data;

        try {
            // Update state
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

            // If first page, determine total and fan-out queue all pages
            if (page === 0 && personPage.total) {
                const totalPages = Math.ceil(personPage.total / limit);

                // Update process with total
                await this.processManager.updateTotal(
                    processId,
                    personPage.total,
                    totalPages,
                );
                await this.processManager.updateState(
                    processId,
                    'QUEUING_PAGES',
                );

                // Queue all remaining pages at once (fan-out)
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

            // If no more pages and no total was provided, complete
            if (page > 0 && persons.length < limit) {
                await this.queueManager.queueCompleteSync(processId);
            }
        } catch (error) {
            console.error(`Error fetching page ${page}:`, error);
            await this.processManager.handleError(processId, error);
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
            const quoContacts = await Promise.all(
                persons.map((p) => this.transformPersonToQuo(p)),
            );

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
                contactId: contact.externalId,
                error: error.message,
                timestamp: new Date().toISOString(),
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
