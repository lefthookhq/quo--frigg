/**
 * QueueManager Service
 * 
 * Encapsulates queue operations for CRM sync processes.
 * Handles message formatting, batching, and fan-out patterns.
 * 
 * Design Philosophy:
 * - Abstract away QueuerUtil complexity
 * - Provide CRM-specific queue message structures
 * - Support fan-out pattern for concurrent page processing
 * - Testable through QueuerUtil injection
 * 
 * Fan-Out Pattern:
 * After fetching first page and determining total pages, this service
 * queues all remaining pages at once for concurrent processing.
 * 
 * @example
 * const queueManager = new QueueManager({
 *   queuerUtil: QueuerUtil,
 *   queueUrl: process.env.INTEGRATION_QUEUE_URL
 * });
 * 
 * await queueManager.fanOutPages({
 *   processId: 'proc123',
 *   personObjectType: 'Contact',
 *   totalPages: 15,
 *   limit: 100,
 *   modifiedSince: null,
 *   sortDesc: true
 * });
 */
class QueueManager {
    /**
     * @param {Object} params
     * @param {Object} params.queuerUtil - QueuerUtil from @friggframework/core
     * @param {string} params.queueUrl - SQS queue URL
     */
    constructor({ queuerUtil, queueUrl }) {
        if (!queuerUtil) {
            throw new Error('queuerUtil is required');
        }
        if (!queueUrl) {
            throw new Error('queueUrl is required');
        }

        this.queuerUtil = queuerUtil;
        this.queueUrl = queueUrl;
    }

    /**
     * Queue a fetch person page job
     * @param {Object} params
     * @param {string} params.processId - Process ID
     * @param {string} params.personObjectType - CRM object type
     * @param {number} [params.page] - Page number (for page-based pagination)
     * @param {string|null} [params.cursor] - Cursor (for cursor-based pagination)
     * @param {number} params.limit - Records per page
     * @param {Date} [params.modifiedSince] - Filter by modification date
     * @param {boolean} [params.sortDesc=true] - Sort descending
     * @returns {Promise<void>}
     */
    async queueFetchPersonPage({
        processId,
        personObjectType,
        page = null,
        cursor = null,
        limit,
        modifiedSince = null,
        sortDesc = true,
    }) {
        const message = {
            event: 'FETCH_PERSON_PAGE',
            data: {
                processId,
                personObjectType,
                page,
                cursor,
                limit,
                modifiedSince: modifiedSince ? modifiedSince.toISOString() : null,
                sortDesc,
            },
        };

        await this.queuerUtil.batchSend([message], this.queueUrl);
    }

    /**
     * Queue a process person batch job
     * @param {Object} params
     * @param {string} params.processId - Process ID
     * @param {string[]} params.crmPersonIds - Array of CRM person IDs
     * @param {number} [params.page] - Page number (for tracking)
     * @param {number} [params.totalInPage] - Total records in this batch
     * @param {boolean} [params.isWebhook=false] - Is this from a webhook
     * @returns {Promise<void>}
     */
    async queueProcessPersonBatch({
        processId,
        crmPersonIds,
        page = null,
        totalInPage = null,
        isWebhook = false,
    }) {
        const message = {
            event: 'PROCESS_PERSON_BATCH',
            data: {
                processId,
                crmPersonIds,
                page,
                totalInPage,
                isWebhook,
            },
        };

        await this.queuerUtil.batchSend([message], this.queueUrl);
    }

    /**
     * Queue a complete sync job
     * @param {string} processId - Process ID to complete
     * @returns {Promise<void>}
     */
    async queueCompleteSync(processId) {
        const message = {
            event: 'COMPLETE_SYNC',
            data: {
                processId,
            },
        };

        await this.queuerUtil.batchSend([message], this.queueUrl);
    }

    /**
     * Fan out: Queue all pages at once for concurrent processing
     * This is the key optimization for fast initial sync
     * 
     * @param {Object} params
     * @param {string} params.processId - Process ID
     * @param {string} params.personObjectType - CRM object type
     * @param {number} params.totalPages - Total number of pages
     * @param {number} params.startPage - Start page (typically 1, since 0 is already fetched)
     * @param {number} params.limit - Records per page
     * @param {Date} [params.modifiedSince] - Filter by modification date
     * @param {boolean} [params.sortDesc=true] - Sort descending
     * @returns {Promise<void>}
     */
    async fanOutPages({
        processId,
        personObjectType,
        totalPages,
        startPage = 1,
        limit,
        modifiedSince = null,
        sortDesc = true,
    }) {
        // Build array of messages for all pages
        const messages = [];

        for (let page = startPage; page < totalPages; page++) {
            messages.push({
                event: 'FETCH_PERSON_PAGE',
                data: {
                    processId,
                    personObjectType,
                    page,
                    limit,
                    modifiedSince: modifiedSince ? modifiedSince.toISOString() : null,
                    sortDesc,
                },
            });
        }

        // Send all messages at once (QueuerUtil handles batching internally)
        if (messages.length > 0) {
            await this.queuerUtil.batchSend(messages, this.queueUrl);
        }
    }

    /**
     * Queue multiple person batches at once
     * @param {Array} batches - Array of batch objects
     * @param {string} batches[].processId - Process ID
     * @param {string[]} batches[].crmPersonIds - Person IDs
     * @param {number} [batches[].page] - Page number
     * @returns {Promise<void>}
     */
    async queueMultipleBatches(batches) {
        const messages = batches.map((batch) => ({
            event: 'PROCESS_PERSON_BATCH',
            data: {
                processId: batch.processId,
                crmPersonIds: batch.crmPersonIds,
                page: batch.page || null,
                totalInPage: batch.crmPersonIds.length,
                isWebhook: batch.isWebhook || false,
            },
        }));

        if (messages.length > 0) {
            await this.queuerUtil.batchSend(messages, this.queueUrl);
        }
    }

    /**
     * Get queue URL (for debugging/logging)
     * @returns {string} Queue URL
     */
    getQueueUrl() {
        return this.queueUrl;
    }
}

module.exports = QueueManager;

