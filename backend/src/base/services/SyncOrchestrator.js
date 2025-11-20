/**
 * SyncOrchestrator Service
 *
 * Orchestrates CRM sync workflows by coordinating ProcessManager and QueueManager.
 * Implements high-level sync patterns: initial sync, ongoing sync, webhook handling.
 *
 * Design Philosophy:
 * - Composes ProcessManager and QueueManager services
 * - Implements sync workflow business logic
 * - Stateless service (state managed through ProcessManager)
 * - Testable through service injection
 *
 * Sync Patterns:
 * 1. Initial Sync: Full data sync, reverse chronological, fan-out pages
 * 2. Ongoing Sync: Delta sync using modifiedSince filter
 * 3. Webhook Sync: Real-time updates from CRM webhooks
 *
 * @example
 * const syncOrchestrator = new SyncOrchestrator({
 *   processManager,
 *   queueManager
 * });
 *
 * await syncOrchestrator.startInitialSync({
 *   integration,
 *   integrationId: 'int123',
 *   personObjectTypes: [
 *     { crmObjectName: 'Contact', quoContactType: 'contact' }
 *   ]
 * });
 */
class SyncOrchestrator {
    /**
     * @param {Object} params
     * @param {ProcessManager} params.processManager - Process management service
     * @param {QueueManager} params.queueManager - Queue management service
     */
    constructor({ processManager, queueManager }) {
        if (!processManager) {
            throw new Error('processManager is required');
        }
        if (!queueManager) {
            throw new Error('queueManager is required');
        }

        this.processManager = processManager;
        this.queueManager = queueManager;
    }

    /**
     * Start initial sync for all person object types
     * @param {Object} params
     * @param {Object} params.integration - Integration instance (for userId)
     * @param {string} params.integrationId - Integration ID
     * @param {Array} params.personObjectTypes - Person types to sync
     * @returns {Promise<Object>} Sync start result with process IDs
     */
    async startInitialSync({ integration, integrationId, personObjectTypes }) {
        if (!personObjectTypes || personObjectTypes.length === 0) {
            throw new Error('No personObjectTypes configured for sync');
        }

        // Defensive: Resolve userId from multiple sources
        const userId =
            integration.userId || integration.record?.userId || integration.id;
        if (!userId) {
            throw new Error(
                `Cannot start sync: userId not available on integration ${integrationId}`,
            );
        }

        const processIds = [];
        const syncConfig = integration.constructor.CRMConfig.syncConfig;

        // Loop through each person type (Contact, Lead, etc.)
        for (const personType of personObjectTypes) {
            // Create sync process
            const process = await this.processManager.createSyncProcess({
                integrationId,
                userId,
                syncType: 'INITIAL',
                personObjectType: personType.crmObjectName,
                state: 'INITIALIZING',
                pageSize: syncConfig.initialBatchSize || 100,
            });

            processIds.push(process.id);

            // Queue first page fetch to determine total
            await this.queueManager.queueFetchPersonPage({
                processId: process.id,
                personObjectType: personType.crmObjectName,
                page: 0,
                limit: syncConfig.initialBatchSize || 100,
                sortDesc: syncConfig.reverseChronological !== false,
            });
        }

        return {
            message: `Initial sync started for ${personObjectTypes.length} person type(s)`,
            processIds,
            personObjectTypes: personObjectTypes.map((pt) => pt.crmObjectName),
            estimatedCompletion: new Date(Date.now() + 10 * 60 * 1000), // 10 min estimate
        };
    }

    /**
     * Start ongoing sync (delta sync)
     * Fetches only records modified since last sync
     *
     * @param {Object} params
     * @param {Object} params.integration - Integration instance
     * @param {string} params.integrationId - Integration ID
     * @param {Array} params.personObjectTypes - Person types to sync
     * @param {Date} [params.lastSyncTime] - Last sync timestamp (optional)
     * @returns {Promise<Object>} Sync start result
     */
    async startOngoingSync({
        integration,
        integrationId,
        personObjectTypes,
        lastSyncTime = null,
    }) {
        if (!personObjectTypes || personObjectTypes.length === 0) {
            throw new Error('No personObjectTypes configured for sync');
        }

        // Defensive: Resolve userId from multiple sources
        const userId =
            integration.userId || integration.record?.userId || integration.id;
        if (!userId) {
            throw new Error(
                `Cannot start sync: userId not available on integration ${integrationId}`,
            );
        }

        // If no lastSyncTime provided, try to get it from previous sync
        if (!lastSyncTime) {
            lastSyncTime = await this.getLastSyncTime(integrationId);
        }

        const processIds = [];
        const syncConfig = integration.constructor.CRMConfig.syncConfig;

        for (const personType of personObjectTypes) {
            // Create ongoing sync process
            const process = await this.processManager.createSyncProcess({
                integrationId,
                userId,
                syncType: 'ONGOING',
                personObjectType: personType.crmObjectName,
                state: 'FETCHING_TOTAL',
                lastSyncedTimestamp: lastSyncTime,
                pageSize: syncConfig.ongoingBatchSize || 50,
            });

            processIds.push(process.id);

            // Queue first page fetch
            await this.queueManager.queueFetchPersonPage({
                processId: process.id,
                personObjectType: personType.crmObjectName,
                page: 0,
                limit: syncConfig.ongoingBatchSize || 50,
                modifiedSince: lastSyncTime,
                sortDesc: false, // Ongoing sync can be ascending
            });
        }

        return {
            message: 'Ongoing sync started',
            processIds,
            lastSyncTime: lastSyncTime ? lastSyncTime.toISOString() : null,
        };
    }

    /**
     * Handle webhook from CRM
     * @param {Object} params
     * @param {Object} params.integration - Integration instance
     * @param {Array|Object} params.data - Webhook data (single or array of records)
     * @returns {Promise<Object>} Webhook handling result
     */
    async handleWebhook({ integration, data }) {
        // Handle null/undefined data
        if (!data || (Array.isArray(data) && data.length === 0)) {
            return {
                status: 'skipped',
                message: 'No data in webhook',
                count: 0,
            };
        }

        const webhookData = Array.isArray(data) ? data : [data];

        // Defensive: Resolve userId from multiple sources
        const userId =
            integration.userId || integration.record?.userId || integration.id;
        if (!userId) {
            throw new Error(
                `Cannot process webhook: userId not available on integration ${integration.id}`,
            );
        }

        // Create mini-process for webhook
        const process = await this.processManager.createSyncProcess({
            integrationId: integration.id,
            userId,
            syncType: 'WEBHOOK',
            personObjectType: 'webhook',
            state: 'PROCESSING_BATCHES',
            totalRecords: webhookData.length,
        });

        // Queue for processing
        await this.queueManager.queueProcessPersonBatch({
            processId: process.id,
            crmPersonIds: webhookData.map((p) => p.id),
            isWebhook: true,
        });

        return {
            status: 'queued',
            processId: process.id,
            count: webhookData.length,
        };
    }

    /**
     * Get last sync time for an integration
     * Queries for most recent completed CRM_SYNC process
     *
     * @param {string} integrationId - Integration ID
     * @returns {Promise<Date|null>} Last sync time or null
     */
    async getLastSyncTime(integrationId) {
        // This would query the ProcessRepository for the most recent completed sync
        // For now, return null (will be implemented with repository access)
        // TODO: Implement by injecting processRepository and querying:
        // - findByIntegrationAndType(integrationId, 'CRM_SYNC')
        // - Filter for state='COMPLETED'
        // - Get most recent
        // - Return context.endTime
        return null;
    }

    /**
     * Check if there are any active syncs for an integration
     * @param {string} integrationId - Integration ID
     * @returns {Promise<boolean>} True if active syncs exist
     */
    async hasActiveSyncs(integrationId) {
        // TODO: Implement using processRepository.findActiveProcesses(integrationId)
        return false;
    }

    /**
     * Cancel all active syncs for an integration
     * @param {string} integrationId - Integration ID
     * @returns {Promise<Object>} Cancellation result
     */
    async cancelActiveSyncs(integrationId) {
        // TODO: Implement by finding active processes and updating to CANCELLED state
        return {
            message: 'Active sync cancellation not yet implemented',
            cancelledCount: 0,
        };
    }
}

module.exports = SyncOrchestrator;
