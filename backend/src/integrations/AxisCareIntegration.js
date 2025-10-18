const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');
const axisCare = require('../api-modules/axiscare');
const quo = require('../api-modules/quo');

/**
 * AxisCareIntegration - Refactored to extend BaseCRMIntegration
 *
 * AxisCare-specific implementation for syncing clients/contacts with Quo.
 * AxisCare is a home care management platform, so "clients" are the person objects.
 */
class AxisCareIntegration extends BaseCRMIntegration {
    static Definition = {
        name: 'axisCare',
        version: '1.0.0',
        supportedVersions: ['1.0.0'],
        hasUserConfig: true,

        display: {
            label: 'AxisCare',
            description:
                'Home care management platform integration with Quo API',
            category: 'Healthcare, CRM',
            detailsUrl: 'https://static.axiscare.com/api/documentation.html',
            icon: '',
        },
        modules: {
            axisCare: { definition: axisCare.Definition },
            quo: { definition: quo.Definition },
        },
        routes: [
            {
                path: '/axiscare/clients',
                method: 'GET',
                event: 'LIST_AXISCARE_CLIENTS',
            },
        ],
    };

    /**
     * CRM Configuration - Required by BaseCRMIntegration
     */
    static CRMConfig = {
        personObjectTypes: [
            { crmObjectName: 'Client', quoContactType: 'contact' },
        ],
        syncConfig: {
            reverseChronological: true,
            initialBatchSize: 50,
            ongoingBatchSize: 25,
            supportsWebhooks: false, // AxisCare has limited webhook support
            pollIntervalMinutes: 60,
        },
        queueConfig: {
            maxWorkers: 10,
            provisioned: 3,
            maxConcurrency: 30,
            batchSize: 1,
            timeout: 600,
        },
    };

    constructor(params) {
        super(params);

        this.events = {
            ...this.events, // BaseCRMIntegration events

            // Existing AxisCare-specific events
            LIST_AXISCARE_CLIENTS: {
                handler: this.listClients,
            },
            SYNC_CLIENTS_TO_QUO: {
                type: 'USER_ACTION',
                handler: this.syncClientsToQuo,
                title: 'Sync Clients to Quo',
                description: 'Synchronize AxisCare clients with Quo CRM',
                userActionType: 'DATA',
            },
        };
    }

    /**
     * Fetch a page of clients from AxisCare
     * @param {Object} params
     * @param {string} params.objectType - CRM object type (Client)
     * @param {number} params.page - Page number (0-indexed)
     * @param {number} params.limit - Records per page
     * @param {Date} [params.modifiedSince] - Filter by modification date
     * @param {boolean} [params.sortDesc=true] - Sort descending
     * @returns {Promise<{data: Array, total: number, hasMore: boolean}>}
     */
    async fetchPersonPage({
        objectType,
        page,
        limit,
        modifiedSince,
        sortDesc = true,
    }) {
        try {
            const params = {
                page: page + 1, // AxisCare uses 1-indexed pages
                per_page: limit,
                sort_by: 'updated_at',
                sort_order: sortDesc ? 'desc' : 'asc',
            };

            // Add modification filter if provided
            if (modifiedSince) {
                params.updated_since = modifiedSince.toISOString();
            }

            const response = await this.axiscare.api.listClients(params);

            return {
                data: response.results?.clients || [],
                total: response.total_count || null,
                hasMore: response.nextPage ? true : false,
            };
        } catch (error) {
            console.error(`Error fetching ${objectType} page ${page}:`, error);
            throw error;
        }
    }

    /**
     * Transform AxisCare client object to Quo contact format
     * @param {Object} client - AxisCare client object (from API - uses camelCase)
     * @returns {Promise<Object>} Quo contact format
     */
    async transformPersonToQuo(client) {
        // Extract phone numbers (AxisCare uses camelCase: homePhone, mobilePhone, otherPhone)
        const phoneNumbers = [];
        if (client.homePhone) {
            phoneNumbers.push({
                name: 'home',
                value: client.homePhone,
                primary: true,
            });
        }
        if (client.mobilePhone) {
            phoneNumbers.push({
                name: 'mobile',
                value: client.mobilePhone,
                primary: false,
            });
        }
        if (client.otherPhone) {
            phoneNumbers.push({
                name: 'other',
                value: client.otherPhone,
                primary: false,
            });
        }

        // Extract emails (AxisCare uses personalEmail, billingEmail)
        const emails = [];
        if (client.personalEmail) {
            emails.push({
                name: 'primary',
                value: client.personalEmail,
                primary: true,
            });
        }
        if (client.billingEmail && client.billingEmail !== client.personalEmail) {
            emails.push({
                name: 'billing',
                value: client.billingEmail,
                primary: false,
            });
        }

        // Use "Goes By" if available, otherwise firstName (per mapping spec)
        const displayFirstName = client.goesBy || client.firstName;

        return {
            externalId: String(client.id),
            source: 'axiscare',
            defaultFields: {
                firstName: displayFirstName,
                lastName: client.lastName,
                company: null, // Healthcare clients typically don't have companies
                phoneNumbers,
                emails,
                role: 'Client', // Contact type per mapping spec
            },
            customFields: {
                crmId: client.id,
                crmType: 'axiscare',
                status: client.status?.label || client.status,
                dateOfBirth: client.dateOfBirth,
                ssn: client.ssn, // Only included if requested via requestedSensitiveFields
                gender: client.gender,
                goesBy: client.goesBy,
                // Address from residentialAddress object
                residentialAddress: client.residentialAddress
                    ? {
                          name: client.residentialAddress.name,
                          streetAddress1: client.residentialAddress.streetAddress1,
                          streetAddress2: client.residentialAddress.streetAddress2,
                          locality: client.residentialAddress.locality,
                          region: client.residentialAddress.region,
                          postalCode: client.residentialAddress.postalCode,
                          latitude: client.residentialAddress.latitude,
                          longitude: client.residentialAddress.longitude,
                      }
                    : null,
                billingAddress: client.billingAddress
                    ? {
                          name: client.billingAddress.name,
                          streetAddress1: client.billingAddress.streetAddress1,
                          streetAddress2: client.billingAddress.streetAddress2,
                          locality: client.billingAddress.locality,
                          region: client.billingAddress.region,
                          postalCode: client.billingAddress.postalCode,
                      }
                    : null,
                // Additional AxisCare-specific fields
                medicaidNumber: client.medicaidNumber,
                priorityNote: client.priorityNote,
                classes:
                    client.classes?.map((c) => ({
                        code: c.code,
                        name: c.name,
                    })) || [],
                region: client.region
                    ? { id: client.region.id, name: client.region.name }
                    : null,
                administrators:
                    client.administrators?.map((a) => ({
                        id: a.id,
                        name: a.name,
                        username: a.username,
                    })) || [],
                preferredCaregiver: client.preferredCaregiver
                    ? {
                          id: client.preferredCaregiver.id,
                          firstName: client.preferredCaregiver.firstName,
                          lastName: client.preferredCaregiver.lastName,
                      }
                    : null,
                referredBy: client.referredBy
                    ? { type: client.referredBy.type, name: client.referredBy.name }
                    : null,
                // Important dates
                createdDate: client.createdDate,
                assessmentDate: client.assessmentDate,
                conversionDate: client.conversionDate,
                startDate: client.startDate,
                effectiveEndDate: client.effectiveEndDate,
            },
        };
    }

    /**
     * Setup webhooks with AxisCare
     * @returns {Promise<void>}
     */
    async setupWebhooks() {
        // AxisCare has limited webhook support, use polling fallback
        console.log(
            'AxisCare webhooks not configured - using polling fallback',
        );
    }

    async getConfigOptions() {
        return {
            syncInterval: {
                type: 'number',
                title: 'Sync Interval (minutes)',
                description: 'How often to sync data between AxisCare and Quo',
                default: 60,
                minimum: 5,
                maximum: 1440,
            },
            maxClientsPerSync: {
                type: 'number',
                title: 'Max Clients per Sync',
                description:
                    'Maximum number of clients to sync in one operation',
                default: 50,
                minimum: 1,
                maximum: 1000,
            },
            maxAppointmentsPerSync: {
                type: 'number',
                title: 'Max Appointments per Sync',
                description:
                    'Maximum number of appointments to sync in one operation',
                default: 100,
                minimum: 1,
                maximum: 1000,
            },
        };
    }

    async getActionOptions({ actionId, data }) {
        switch (actionId) {
            case 'SYNC_CLIENTS_TO_QUO':
                return {
                    jsonSchema: {
                        type: 'object',
                        properties: {
                            limit: {
                                type: 'number',
                                title: 'Client Limit',
                                description:
                                    'Maximum clients to retrieve for sync',
                                minimum: 1,
                                maximum: 1000,
                                default: 50,
                            },
                            maxClients: {
                                type: 'number',
                                title: 'Max Clients to Sync',
                                description: 'Maximum clients to actually sync',
                                minimum: 1,
                                maximum: 100,
                                default: 10,
                            },
                            status: {
                                type: 'string',
                                title: 'Client Status Filter',
                                description:
                                    'Only sync clients with this status',
                                enum: [
                                    'active',
                                    'inactive',
                                    'pending',
                                    'archived',
                                ],
                            },
                        },
                        required: [],
                    },
                    uiSchema: {
                        type: 'VerticalLayout',
                        elements: [
                            {
                                type: 'Control',
                                scope: '#/properties/limit',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/maxClients',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/status',
                            },
                        ],
                    },
                };
        }
        return null;
    }

    async syncClientsToQuo(args) {
        try {
            // Get clients from AxisCare
            const axiscareClients = await this.axiscare.api.listClients({
                limit: args.limit || 50,
                statuses: args.status,
            });

            const syncResults = [];

            for (const client of axiscareClients.results?.clients?.slice(
                0,
                args.maxClients || 10,
            ) || []) {
                try {
                    // Transform client data for Quo using the correct method
                    const quoContactData = await this.transformPersonToQuo(client);

                    // Create or update in Quo if available
                    let quoResult = null;
                    if (this.quo?.api) {
                        quoResult = await this.quo.api.createContact(quoContactData);
                    }

                    syncResults.push({
                        axisCareClient: {
                            id: client.id,
                            name: `${client.goesBy || client.firstName} ${client.lastName}`,
                            email: client.personalEmail,
                            phone: client.homePhone || client.mobilePhone,
                            status: client.status?.label || client.status,
                        },
                        quoContact: quoResult,
                        syncStatus: quoResult ? 'success' : 'quo_unavailable',
                        timestamp: new Date().toISOString(),
                    });
                } catch (clientError) {
                    syncResults.push({
                        axisCareClient: client,
                        error: clientError.message,
                        syncStatus: 'error',
                        timestamp: new Date().toISOString(),
                    });
                }
            }

            return {
                label: 'Client Sync Results',
                data: {
                    totalClientsProcessed: syncResults.length,
                    syncSummary: syncResults.reduce((summary, result) => {
                        summary[result.syncStatus] =
                            (summary[result.syncStatus] || 0) + 1;
                        return summary;
                    }, {}),
                    syncResults,
                    timestamp: new Date().toISOString(),
                },
            };
        } catch (error) {
            console.error('Client sync failed:', error);
            throw new Error(`Client sync failed: ${error.message}`);
        }
    }

    /**
     * Fetch a single client by ID
     * @param {string} id - Client ID
     * @returns {Promise<Object>}
     */
    async fetchPersonById(id) {
        return await this.axiscare.api.getClient(id);
    }

    /**
     * Fetch multiple clients by IDs (for webhook batch processing)
     * Optimized: Uses bulk API call when possible, falls back to sequential
     * @param {string[]} ids - Array of client IDs
     * @returns {Promise<Object[]>}
     */
    async fetchPersonsByIds(ids) {
        if (!ids || ids.length === 0) {
            return [];
        }

        try {
            // Use bulk API call (much faster than sequential)
            const response = await this.axiscare.api.listClients({
                clientIds: ids.join(','),
                limit: ids.length,
            });

            return response.results?.clients || [];
        } catch (error) {
            console.warn(
                `Bulk fetch failed for ${ids.length} clients, falling back to sequential:`,
                error.message,
            );

            // Fallback: Fetch one-by-one (slower but more resilient)
            return await this._fetchPersonsByIdsSequential(ids);
        }
    }

    /**
     * Fallback method: Fetch clients sequentially
     * @private
     * @param {string[]} ids - Array of client IDs
     * @returns {Promise<Object[]>}
     */
    async _fetchPersonsByIdsSequential(ids) {
        const clients = [];
        for (const id of ids) {
            try {
                const client = await this.fetchPersonById(id);
                clients.push(client);
            } catch (error) {
                console.error(`Failed to fetch client ${id}:`, error.message);
            }
        }
        return clients;
    }

    async listClients({ req, res }) {
        try {
            const params = {
                startAfterId: req.query.startAfterId
                    ? parseInt(req.query.startAfterId)
                    : undefined,
                limit: req.query.limit ? parseInt(req.query.limit) : 100,
            };

            const clients = await this.axiscare.api.listClients(params);
            res.json(clients);
        } catch (error) {
            console.error('Failed to list AxisCare clients:', error);
            res.status(500).json({
                error: 'Failed to list clients',
                details: error.message,
            });
        }
    }

    /**
     * Handler: Fetch a page of clients from AxisCare
     *
     * OVERRIDE: This overrides BaseCRMIntegration.fetchPersonPageHandler to handle
     * AxisCare's cursor-based pagination (nextPage URLs) instead of page-based.
     *
     * Flow:
     * 1. Get nextPageUrl from process metadata (null for first page)
     * 2. Fetch from AxisCare (use URL if available, else first page)
     * 3. Store nextPage URL in metadata for next iteration
     * 4. Queue batch processing for this page's clients
     * 5. Queue next page OR complete sync if no more pages
     *
     * Metadata stored:
     * - nextPageUrl: URL for next fetch (null when no more pages)
     * - totalFetched: Running count of all clients fetched
     * - pageCount: Number of pages processed
     *
     * @param {Object} params
     * @param {Object} params.data - Event data from queue
     * @param {string} params.data.processId - Process tracking ID
     * @param {string} params.data.personObjectType - "Client"
     * @param {number} params.data.page - Page counter (0-indexed, just for logging)
     * @param {number} params.data.limit - Records per page
     */
    async fetchPersonPageHandler({ data }) {
        const { processId, personObjectType, page, limit } = data;

        try {
            console.log(
                `[AxisCare] Fetching page ${page} (processId: ${processId})`,
            );

            // Update process state
            await this.processManager.updateState(processId, 'FETCHING_PAGE');

            // ═══════════════════════════════════════════════════════════
            // STEP 1: Get nextPageUrl from metadata
            // ═══════════════════════════════════════════════════════════
            const metadata = await this.processManager.getMetadata(processId);
            const nextPageUrl = metadata?.nextPageUrl;

            console.log(
                `[AxisCare] Using ${nextPageUrl ? 'stored nextPage URL' : 'initial listClients'}`,
            );

            // ═══════════════════════════════════════════════════════════
            // STEP 2: Fetch from AxisCare API (with retry)
            // ═══════════════════════════════════════════════════════════
            let response;

            if (nextPageUrl) {
                // Subsequent pages: use stored URL with retry
                response = await this._fetchWithRetry(() =>
                    this.axiscare.api.getFromUrl(nextPageUrl),
                );
            } else {
                // First page: use listClients with limit and retry
                response = await this._fetchWithRetry(() =>
                    this.axiscare.api.listClients({
                        limit: limit || 50,
                    }),
                );
            }

            // Validate API response for errors
            if (response.errors && response.errors.length > 0) {
                const errorMessage = `AxisCare API returned errors: ${JSON.stringify(response.errors)}`;
                console.error(`[AxisCare] ${errorMessage}`);
                throw new Error(errorMessage);
            }

            const clients = response.results?.clients || [];
            console.log(`[AxisCare] Fetched ${clients.length} clients`);

            // Handle empty first page (edge case: no clients exist)
            if (page === 0 && clients.length === 0) {
                console.log('[AxisCare] No clients found, queuing completion');
                await this.processManager.updateTotal(processId, 0, 0);
                await this.queueManager.queueCompleteSync(processId);
                return;
            }

            // ═══════════════════════════════════════════════════════════
            // STEP 3: Update metadata with next URL and totals
            // ═══════════════════════════════════════════════════════════
            const totalFetched = (metadata?.totalFetched || 0) + clients.length;
            const pageCount = page + 1;

            await this.processManager.updateMetadata(processId, {
                nextPageUrl: response.nextPage || null,
                totalFetched,
                pageCount,
            });

            // Update process totals (estimated, will be corrected as we go)
            if (page === 0) {
                // First page: provide initial estimate
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
                // Update with actual count so far
                await this.processManager.updateTotal(
                    processId,
                    totalFetched,
                    pageCount,
                );
            }

            console.log(
                `[AxisCare] Progress: ${totalFetched} clients fetched across ${pageCount} pages`,
            );

            // ═══════════════════════════════════════════════════════════
            // STEP 4: Queue batch processing for this page's clients
            // ═══════════════════════════════════════════════════════════
            if (clients.length > 0) {
                console.log(
                    `[AxisCare] Queuing batch processing for ${clients.length} clients`,
                );
                await this.queueManager.queueProcessPersonBatch({
                    processId,
                    crmPersonIds: clients.map((c) => String(c.id)),
                    page,
                    totalInPage: clients.length,
                });
            }

            // ═══════════════════════════════════════════════════════════
            // STEP 5: Queue next page OR complete sync
            // ═══════════════════════════════════════════════════════════
            if (response.nextPage) {
                // More pages exist
                console.log(
                    `[AxisCare] More pages available, queuing page ${page + 1}`,
                );
                await this.queueManager.queueFetchPersonPage({
                    processId,
                    personObjectType,
                    page: page + 1,
                    limit,
                });
            } else {
                // No more pages - all data fetched
                console.log(
                    `[AxisCare] All pages fetched. Total: ${totalFetched} clients`,
                );
                console.log(
                    '[AxisCare] Queuing sync completion (will complete after all batches process)',
                );
                await this.queueManager.queueCompleteSync(processId);
            }
        } catch (error) {
            console.error(`[AxisCare] Error fetching page ${page}:`, error);
            await this.processManager.handleError(processId, error);
            throw error;
        }
    }

    /**
     * Fetch with exponential backoff retry
     * Lambda-compatible: Handles transient failures gracefully
     * @private
     * @param {Function} fetchFn - Async function to execute
     * @param {number} maxRetries - Maximum retry attempts (default: 3)
     * @param {number} baseDelay - Base delay in ms (default: 1000)
     * @returns {Promise<*>} Result from fetchFn
     */
    async _fetchWithRetry(fetchFn, maxRetries = 3, baseDelay = 1000) {
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await fetchFn();
            } catch (error) {
                lastError = error;

                // Check if error is retryable (network/timeout errors)
                const isRetryable =
                    error.code === 'ECONNRESET' ||
                    error.code === 'ETIMEDOUT' ||
                    error.code === 'ENOTFOUND' ||
                    error.message?.includes('timeout') ||
                    error.message?.includes('network') ||
                    (error.response?.status >= 500 &&
                        error.response?.status < 600) || // Server errors
                    error.response?.status === 429; // Rate limit

                // Don't retry on last attempt or non-retryable errors
                if (attempt === maxRetries || !isRetryable) {
                    throw error;
                }

                // Calculate exponential backoff with jitter
                const delay = Math.min(
                    baseDelay * Math.pow(2, attempt - 1) +
                        Math.random() * 1000,
                    10000, // Max 10 seconds
                );

                console.log(
                    `[AxisCare] Retry ${attempt}/${maxRetries} after ${Math.round(delay)}ms (${error.message})`,
                );

                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }

        throw lastError;
    }
}

module.exports = AxisCareIntegration;
