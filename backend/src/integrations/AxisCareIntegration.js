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
            { crmObjectName: 'Lead', quoContactType: 'contact' },
            { crmObjectName: 'Caregiver', quoContactType: 'contact' },
        ],
        syncConfig: {
            paginationType: 'CURSOR_BASED',
            supportsTotal: false,
            returnFullRecords: true,
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
     * Fetch a page of persons from AxisCare (Clients, Leads, or Caregivers)
     * @param {Object} params
     * @param {string} params.objectType - CRM object type (Client, Lead, or Caregiver)
     * @param {string|null} [params.cursor] - Cursor for pagination (startAfterId)
     * @param {number} params.limit - Records per page
     * @param {Date} [params.modifiedSince] - Filter by modification date
     * @param {boolean} [params.sortDesc=true] - Sort descending (ignored by AxisCare)
     * @returns {Promise<{data: Array, cursor: string|null, hasMore: boolean}>}
     */
    async fetchPersonPage({
        objectType,
        cursor = null,
        limit,
        modifiedSince,
        sortDesc = true,
    }) {
        try {
            const params = {
                limit: limit || 50,
            };

            // Add cursor if provided (not first page)
            if (cursor) {
                params.startAfterId = cursor;
            }

            // Add modification filter if provided
            if (modifiedSince) {
                params.updated_since = modifiedSince.toISOString();
            }

            // Route to correct API endpoint based on objectType
            let response, persons;

            console.log(`[AxisCare] Fetching ${objectType} page with cursor=${cursor}`);

            switch (objectType) {
                case 'Client':
                    response = await this.axisCare.api.listClients(params);
                    persons = response.results?.clients || [];
                    break;

                case 'Lead':
                    response = await this.axisCare.api.listLeads(params);
                    persons = response.results?.leads || [];
                    break;

                case 'Caregiver':
                    response = await this.axisCare.api.listCaregivers(params);
                    // ⚠️ Caregivers use different structure (no results wrapper)
                    persons = response.caregivers || [];
                    break;

                default:
                    throw new Error(`Unknown objectType: ${objectType}`);
            }

            // Parse nextPage URL to extract cursor (handle both response structures)
            let nextCursor = null;
            const nextPageUrl = response.results?.nextPage || response.nextPage;

            if (nextPageUrl) {
                console.log('[AxisCare] DEBUG nextPage:', nextPageUrl);
                try {
                    const url = new URL(nextPageUrl);
                    console.log(
                        '[AxisCare] DEBUG parsed URL searchParams:',
                        url.searchParams.toString(),
                    );
                    nextCursor = url.searchParams.get('startAfterId');
                    console.log('[AxisCare] DEBUG extracted cursor:', nextCursor);
                } catch (error) {
                    console.warn(
                        '[AxisCare] Failed to parse nextPage URL:',
                        error.message,
                        'Raw nextPage:',
                        nextPageUrl,
                    );
                }
            } else {
                console.log('[AxisCare] DEBUG no nextPage in response');
            }

            // Tag each person with objectType for transformation
            const taggedPersons = persons.map((person) => ({
                ...person,
                _objectType: objectType,
            }));

            console.log(
                `[AxisCare] Fetched ${taggedPersons.length} ${objectType}(s), hasMore=${!!nextPageUrl}`,
            );

            return {
                data: taggedPersons,
                cursor: nextCursor,
                hasMore: !!nextPageUrl,
            };
        } catch (error) {
            console.error(
                `Error fetching ${objectType} with cursor ${cursor}:`,
                error,
            );
            throw error;
        }
    }

    /**
     * Transform AxisCare person object to Quo contact format
     * Handles Clients, Leads, and Caregivers with type-specific field mappings
     * @param {Object} person - AxisCare person object (from API - uses camelCase)
     * @returns {Object} Quo contact format
     */
    transformPersonToQuo(person) {
        const objectType = person._objectType || 'Client'; // Default to Client for backward compatibility

        // Extract phone numbers (type-specific)
        const phoneNumbers = this._extractPhoneNumbers(person, objectType);

        // Extract emails (same for all types)
        const emails = this._extractEmails(person);

        // Extract firstName (type-specific)
        const firstName = this._extractFirstName(person, objectType);

        // Build customFields array
        const customFields = this._buildCustomFields(person, objectType);

        return {
            externalId: `${person.id}_${Date.now()}`,
            source: 'axiscare',
            defaultFields: {
                firstName,
                lastName: person.lastName,
                company: null,
                phoneNumbers,
                emails,
                role: objectType, // 'Client', 'Lead', or 'Caregiver'
            },
            customFields,
        };
    }

    /**
     * Extract firstName based on person type
     * @private
     * @param {Object} person - AxisCare person object
     * @param {string} objectType - Person type (Client, Lead, Caregiver)
     * @returns {string} First name
     */
    _extractFirstName(person, objectType) {
        if (objectType === 'Lead') {
            return person.firstName; // Leads don't have goesBy
        }
        return person.goesBy || person.firstName; // Client/Caregiver
    }

    /**
     * Extract phone numbers based on person type
     * @private
     * @param {Object} person - AxisCare person object
     * @param {string} objectType - Person type (Client, Lead, Caregiver)
     * @returns {Array<{name: string, value: string, primary: boolean}>} Phone numbers
     */
    _extractPhoneNumbers(person, objectType) {
        const phones = [];

        if (objectType === 'Lead') {
            // Leads use: phone, mobilePhone
            if (person.phone) {
                phones.push({
                    name: 'phone',
                    value: person.phone,
                    primary: true,
                });
            }
            if (person.mobilePhone) {
                phones.push({
                    name: 'mobile',
                    value: person.mobilePhone,
                    primary: false,
                });
            }
        } else {
            // Client/Caregiver use: homePhone, mobilePhone, otherPhone
            if (person.homePhone) {
                phones.push({
                    name: 'home',
                    value: person.homePhone,
                    primary: true,
                });
            }
            if (person.mobilePhone) {
                phones.push({
                    name: 'mobile',
                    value: person.mobilePhone,
                    primary: false,
                });
            }
            if (person.otherPhone) {
                phones.push({
                    name: 'other',
                    value: person.otherPhone,
                    primary: false,
                });
            }
        }

        return phones;
    }

    /**
     * Extract emails (same for all types)
     * @private
     * @param {Object} person - AxisCare person object
     * @returns {Array<{name: string, value: string, primary: boolean}>} Emails
     */
    _extractEmails(person) {
        const emails = [];

        if (person.personalEmail) {
            emails.push({
                name: 'primary',
                value: person.personalEmail,
                primary: true,
            });
        }
        if (person.billingEmail && person.billingEmail !== person.personalEmail) {
            emails.push({
                name: 'billing',
                value: person.billingEmail,
                primary: false,
            });
        }

        return emails;
    }

    /**
     * Build customFields array with type-specific logic
     * @private
     * @param {Object} person - AxisCare person object
     * @param {string} objectType - Person type (Client, Lead, Caregiver)
     * @returns {Array<{key: string, value: string}>} Custom fields array
     */
    _buildCustomFields(person, objectType) {
        const customFields = [];

        const addField = (key, value) => {
            if (value !== null && value !== undefined && value !== '') {
                customFields.push({
                    key,
                    value:
                        typeof value === 'object'
                            ? JSON.stringify(value)
                            : String(value),
                });
            }
        };

        addField('crmId', person.id);
        addField('crmType', 'axiscare');
        addField('objectType', objectType); // Track which type this is
        addField('status', person.status?.label || person.status);
        addField('dateOfBirth', person.dateOfBirth);
        addField('gender', person.gender);
        addField('goesBy', person.goesBy);
        addField('priorityNote', person.priorityNote);

        // Addresses (all types have these)
        if (person.residentialAddress) {
            addField('residentialAddress', person.residentialAddress);
        }
        if (person.billingAddress) {
            addField('billingAddress', person.billingAddress);
        }

        // Classes (Client and Caregiver only)
        if (person.classes && person.classes.length > 0) {
            addField('classes', person.classes);
        }

        // Other Client/Caregiver specific fields
        if (objectType !== 'Lead') {
            addField('medicaidNumber', person.medicaidNumber);
            addField('region', person.region);
            addField('administrators', person.administrators);
            addField('preferredCaregiver', person.preferredCaregiver);
            addField('referredBy', person.referredBy);
        }

        // Date fields
        addField('createdDate', person.createdDate);
        addField('assessmentDate', person.assessmentDate);
        addField('conversionDate', person.conversionDate);
        addField('startDate', person.startDate);
        addField('effectiveEndDate', person.effectiveEndDate);

        return customFields;
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
                    const quoContactData = this.transformPersonToQuo(client);

                    // Create or update in Quo if available
                    let quoResult = null;
                    if (this.quo?.api) {
                        quoResult =
                            await this.quo.api.createContact(quoContactData);
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
}

module.exports = AxisCareIntegration;
