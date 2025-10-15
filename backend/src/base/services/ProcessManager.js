/**
 * ProcessManager Service
 * 
 * Encapsulates process state management logic for CRM integrations.
 * Acts as a facade over Frigg Core use cases, providing CRM-specific context.
 * 
 * Design Philosophy:
 * - Service layer between BaseCRMIntegration and Frigg Core use cases
 * - Handles CRM-specific process initialization and state management
 * - Provides high-level methods that abstract use case complexity
 * - Testable through dependency injection of use cases
 * 
 * @example
 * const processManager = new ProcessManager({
 *   createProcessUseCase,
 *   updateProcessStateUseCase,
 *   updateProcessMetricsUseCase,
 *   getProcessUseCase
 * });
 * 
 * const process = await processManager.createSyncProcess({
 *   integrationId: 'int123',
 *   userId: 'user456',
 *   syncType: 'INITIAL',
 *   personObjectType: 'Contact',
 *   state: 'INITIALIZING'
 * });
 */
class ProcessManager {
    /**
     * @param {Object} params
     * @param {Object} params.createProcessUseCase - CreateProcess use case from Frigg Core
     * @param {Object} params.updateProcessStateUseCase - UpdateProcessState use case
     * @param {Object} params.updateProcessMetricsUseCase - UpdateProcessMetrics use case
     * @param {Object} params.getProcessUseCase - GetProcess use case
     */
    constructor({
        createProcessUseCase,
        updateProcessStateUseCase,
        updateProcessMetricsUseCase,
        getProcessUseCase,
    }) {
        if (!createProcessUseCase) {
            throw new Error('createProcessUseCase is required');
        }
        if (!updateProcessStateUseCase) {
            throw new Error('updateProcessStateUseCase is required');
        }
        if (!updateProcessMetricsUseCase) {
            throw new Error('updateProcessMetricsUseCase is required');
        }
        if (!getProcessUseCase) {
            throw new Error('getProcessUseCase is required');
        }

        this.createProcessUseCase = createProcessUseCase;
        this.updateProcessStateUseCase = updateProcessStateUseCase;
        this.updateProcessMetricsUseCase = updateProcessMetricsUseCase;
        this.getProcessUseCase = getProcessUseCase;
    }

    /**
     * Create a new CRM sync process with appropriate context structure
     * @param {Object} params
     * @param {string} params.integrationId - Integration ID
     * @param {string} params.userId - User ID
     * @param {string} params.syncType - Type of sync (INITIAL, ONGOING, WEBHOOK)
     * @param {string} params.personObjectType - CRM object type (Contact, Lead, etc.)
     * @param {string} [params.state='INITIALIZING'] - Initial state
     * @param {Date} [params.lastSyncedTimestamp] - Last sync timestamp for ongoing syncs
     * @param {number} [params.totalRecords=0] - Total records to sync (if known)
     * @param {number} [params.pageSize=100] - Page size for pagination
     * @returns {Promise<Object>} Created process record
     */
    async createSyncProcess({
        integrationId,
        userId,
        syncType,
        personObjectType,
        state = 'INITIALIZING',
        lastSyncedTimestamp = null,
        totalRecords = 0,
        pageSize = 100,
    }) {
        // Construct process name
        const processName = `${integrationId}-${personObjectType}-sync`;

        // Build CRM sync context structure
        const context = {
            syncType,
            personObjectType,
            totalRecords,
            processedRecords: 0,
            currentPage: 0,
            pagination: {
                pageSize,
                currentCursor: null,
                nextPage: 0,
                hasMore: true,
            },
            startTime: new Date().toISOString(),
            endTime: null,
            estimatedCompletion: null,
            lastSyncedTimestamp: lastSyncedTimestamp ? lastSyncedTimestamp.toISOString() : null,
            metadata: {},
        };

        // Build CRM sync results structure
        const results = {
            aggregateData: {
                totalSynced: 0,
                totalFailed: 0,
                duration: 0,
                recordsPerSecond: 0,
                errors: [],
            },
            pages: {
                totalPages: 0,
                processedPages: 0,
                failedPages: 0,
            },
        };

        // Create process via use case
        const process = await this.createProcessUseCase.execute({
            userId,
            integrationId,
            name: processName,
            type: 'CRM_SYNC',
            state,
            context,
            results,
        });

        return process;
    }

    /**
     * Update process state with optional context updates
     * @param {string} processId - Process ID to update
     * @param {string} state - New state
     * @param {Object} [contextUpdates={}] - Context fields to merge
     * @returns {Promise<Object>} Updated process
     */
    async updateState(processId, state, contextUpdates = {}) {
        return await this.updateProcessStateUseCase.execute(processId, state, contextUpdates);
    }

    /**
     * Update process metrics (cumulative)
     * @param {string} processId - Process ID to update
     * @param {Object} metricsUpdate - Metrics to add
     * @param {number} [metricsUpdate.processed=0] - Records processed
     * @param {number} [metricsUpdate.success=0] - Successful records
     * @param {number} [metricsUpdate.errors=0] - Failed records
     * @param {Array} [metricsUpdate.errorDetails=[]] - Error details
     * @returns {Promise<Object>} Updated process
     */
    async updateMetrics(processId, metricsUpdate) {
        return await this.updateProcessMetricsUseCase.execute(processId, metricsUpdate);
    }

    /**
     * Get a process by ID
     * @param {string} processId - Process ID to retrieve
     * @returns {Promise<Object|null>} Process record or null if not found
     */
    async getProcess(processId) {
        return await this.getProcessUseCase.execute(processId);
    }

    /**
     * Handle process error by updating state and recording error details
     * @param {string} processId - Process ID to update
     * @param {Error} error - Error object
     * @returns {Promise<Object>} Updated process
     */
    async handleError(processId, error) {
        const errorContext = {
            error: error.message,
            errorStack: error.stack,
            errorTimestamp: new Date().toISOString(),
        };

        return await this.updateState(processId, 'ERROR', errorContext);
    }

    /**
     * Update process with total records count (after first page fetch)
     * @param {string} processId - Process ID to update
     * @param {number} totalRecords - Total number of records
     * @param {number} totalPages - Total number of pages
     * @returns {Promise<Object>} Updated process
     */
    async updateTotal(processId, totalRecords, totalPages) {
        const process = await this.getProcess(processId);
        if (!process) {
            throw new Error(`Process not found: ${processId}`);
        }

        const contextUpdates = {
            totalRecords,
        };

        const resultsUpdate = {
            ...process.results,
            pages: {
                ...(process.results?.pages || {}),
                totalPages,
            },
        };

        // Update both context and results
        const updatedProcess = await this.updateState(processId, process.state, contextUpdates);

        // Manually update results since updateState doesn't touch results
        return await this.updateProcessStateUseCase.processRepository.update(processId, {
            results: resultsUpdate,
        });
    }

    /**
     * Get process metadata
     * Lambda-compatible: Always fetches fresh from database
     * @param {string} processId - Process ID
     * @returns {Promise<Object>} Metadata object (empty object if not found)
     */
    async getMetadata(processId) {
        const process = await this.getProcess(processId);
        return process?.context?.metadata || {};
    }

    /**
     * Update process metadata (merge with existing)
     * Lambda-compatible: Fetches current state, merges, then persists
     * @param {string} processId - Process ID
     * @param {Object} metadataUpdate - Metadata fields to merge
     * @returns {Promise<Object>} Updated process
     */
    async updateMetadata(processId, metadataUpdate) {
        const process = await this.getProcess(processId);
        if (!process) {
            throw new Error(`Process not found: ${processId}`);
        }

        // Merge with existing metadata (Lambda-safe: no in-memory state)
        const updatedMetadata = {
            ...(process.context?.metadata || {}),
            ...metadataUpdate,
        };

        // Persist via updateState (uses repository, Lambda-compatible)
        return await this.updateState(processId, process.state, {
            metadata: updatedMetadata,
        });
    }

    /**
     * Mark process as completed
     * @param {string} processId - Process ID to complete
     * @returns {Promise<Object>} Updated process
     */
    async completeProcess(processId) {
        const contextUpdates = {
            endTime: new Date().toISOString(),
        };

        return await this.updateState(processId, 'COMPLETED', contextUpdates);
    }
}

module.exports = ProcessManager;

