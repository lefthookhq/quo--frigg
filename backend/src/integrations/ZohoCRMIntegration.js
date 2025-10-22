const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');
const { Definition: QuoDefinition } = require('../api-modules/quo/definition');
const zohoCrm = require('@friggframework/api-module-zoho-crm');

/**
 * ZohoCRMIntegration - Refactored to extend BaseCRMIntegration
 *
 * This refactored version demonstrates how to migrate from the old IntegrationBase
 * to the new BaseCRMIntegration framework. It maintains backward compatibility
 * while leveraging the new sync orchestration capabilities.
 */
class ZohoCRMIntegration extends BaseCRMIntegration {
    static Definition = {
        name: 'zohocrm',
        version: '1.0.0',
        supportedVersions: ['1.0.0'],
        hasUserConfig: true,

        display: {
            label: 'Zoho CRM',
            description: 'Zoho CRM platform integration with Quo API',
            category: 'CRM & Sales',
            detailsUrl: 'https://www.zoho.com/crm',
            icon: '',
        },
        modules: {
            quo: { definition: QuoDefinition },
            'zoho-crm': {
                definition: zohoCrm.Definition,
            },
        },
        routes: [
            {
                path: '/zoho/leads',
                method: 'GET',
                event: 'LIST_ZOHO_LEADS',
            },
            {
                path: '/zoho/contacts',
                method: 'GET',
                event: 'LIST_ZOHO_CONTACTS',
            },
            {
                path: '/zoho/deals',
                method: 'GET',
                event: 'LIST_ZOHO_DEALS',
            },
            {
                path: '/zoho/accounts',
                method: 'GET',
                event: 'LIST_ZOHO_ACCOUNTS',
            },
        ],
    };

    /**
     * CRM Configuration - Required by BaseCRMIntegration
     */
    static CRMConfig = {
        personObjectTypes: [
            { crmObjectName: 'Contact', quoContactType: 'contact' },
            { crmObjectName: 'Lead', quoContactType: 'contact' },
        ],
        syncConfig: {
            paginationType: 'PAGE_BASED',
            supportsTotal: true,
            returnFullRecords: false,
            reverseChronological: true,
            initialBatchSize: 50,
            ongoingBatchSize: 25,
            supportsWebhooks: false,
            pollIntervalMinutes: 60,
        },
        queueConfig: {
            maxWorkers: 15,
            provisioned: 5,
            maxConcurrency: 50,
            batchSize: 1,
            timeout: 600,
        },
    };

    constructor(params) {
        super(params);

        // Add existing events (backward compatibility)
        this.events = {
            ...this.events, // BaseCRMIntegration events (INITIAL_SYNC, etc.)

            // Existing Zoho-specific events
            LIST_ZOHO_LEADS: {
                handler: this.listLeads,
            },
            LIST_ZOHO_CONTACTS: {
                handler: this.listContacts,
            },
            LIST_ZOHO_DEALS: {
                handler: this.listDeals,
            },
            LIST_ZOHO_ACCOUNTS: {
                handler: this.listAccounts,
            },
            CREATE_ZOHO_RECORD: {
                type: 'USER_ACTION',
                handler: this.createRecord,
                title: 'Create Zoho Record',
                description: 'Create a new record in Zoho CRM',
                userActionType: 'DATA',
            },
            SEARCH_ZOHO_DATA: {
                type: 'USER_ACTION',
                handler: this.searchData,
                title: 'Search Zoho Records',
                description: 'Search across Zoho CRM records',
                userActionType: 'SEARCH',
            },
            GET_ZOHO_MODULES: {
                type: 'USER_ACTION',
                handler: this.getModules,
                title: 'Get Available Modules',
                description: 'List all available Zoho CRM modules',
                userActionType: 'DATA',
            },
        };
    }

    // ============================================================================
    // REQUIRED METHODS - BaseCRMIntegration Abstract Methods
    // ============================================================================

    /**
     * Fetch a page of persons from Zoho CRM
     * @param {Object} params
     * @param {string} params.objectType - CRM object type (Contact, Lead)
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
            const zohoPage = page + 1;
            const apiEndpoint = objectType === 'Lead' ? 'leads' : 'contacts';

            const params = {
                per_page: limit,
                page: zohoPage,
                sort_order: sortDesc ? 'desc' : 'asc',
                sort_by: 'Modified_Time',
            };

            if (modifiedSince) {
                params.modified_since = modifiedSince
                    .toISOString()
                    .split('T')[0];
            }

            const response = await this.zoho.api[apiEndpoint].getAll(params);

            return {
                data: response.data || [],
                total: response.info?.count || null,
                hasMore: response.info?.more_records || false,
            };
        } catch (error) {
            console.error(`Error fetching ${objectType} page ${page}:`, error);
            throw error;
        }
    }

    /**
     * Transform Zoho person object to Quo contact format
     * @param {Object} person - Zoho person object (Contact or Lead)
     * @returns {Object} Quo contact format
     */
    transformPersonToQuo(person) {
        const phoneNumbers = [];
        if (person.Phone) {
            phoneNumbers.push({ name: 'work', value: person.Phone });
        }
        if (person.Mobile) {
            phoneNumbers.push({ name: 'mobile', value: person.Mobile });
        }

        const emails = [];
        if (person.Email) {
            emails.push({ name: 'work', value: person.Email });
        }

        const isLead = person.Lead_Source !== undefined;

        return {
            externalId: person.id,
            source: isLead ? 'zoho-lead' : 'zoho-contact',
            defaultFields: {
                firstName: person.First_Name,
                lastName: person.Last_Name,
                company: person.Account_Name || person.Company,
                phoneNumbers,
                emails,
            },
            customFields: [],
        };
    }

    /**
     * Log SMS message to Zoho CRM as an activity
     * @param {Object} activity - SMS activity
     * @returns {Promise<void>}
     */
    async logSMSToActivity(activity) {
        try {
            const person = await this.findPersonByExternalId(
                activity.contactExternalId,
            );
            if (!person) {
                console.warn(
                    `Person not found for SMS logging: ${activity.contactExternalId}`,
                );
                return;
            }

            const activityData = {
                Subject: `SMS: ${activity.direction}`,
                Description: activity.content,
                Who_Id: person.id,
                Activity_Type: 'SMS',
                Status: 'Completed',
                Start_DateTime: activity.timestamp,
            };

            await this.zoho.api.activities.create(activityData);
        } catch (error) {
            console.error('Failed to log SMS activity to Zoho:', error);
            throw error;
        }
    }

    /**
     * Log phone call to Zoho CRM as an activity
     * @param {Object} activity - Call activity
     * @returns {Promise<void>}
     */
    async logCallToActivity(activity) {
        try {
            const person = await this.findPersonByExternalId(
                activity.contactExternalId,
            );
            if (!person) {
                console.warn(
                    `Person not found for call logging: ${activity.contactExternalId}`,
                );
                return;
            }

            const activityData = {
                Subject: `Call: ${activity.direction} (${activity.duration}s)`,
                Description: activity.summary || 'Phone call',
                Who_Id: person.id,
                Activity_Type: 'Call',
                Status: 'Completed',
                Start_DateTime: activity.timestamp,
                Duration: activity.duration,
            };

            await this.zoho.api.activities.create(activityData);
        } catch (error) {
            console.error('Failed to log call activity to Zoho:', error);
            throw error;
        }
    }

    /**
     * Setup webhooks with Zoho CRM (if supported)
     * @returns {Promise<void>}
     */
    async setupWebhooks() {
        console.log(
            'Zoho CRM webhooks not configured - using polling fallback',
        );
    }

    // ============================================================================
    // OPTIONAL HELPER METHODS
    // ============================================================================

    /**
     * Fetch a single person by ID
     * @param {string} id - Person ID
     * @returns {Promise<Object>}
     */
    async fetchPersonById(id) {
        try {
            const contact = await this.zoho.api.contacts.get(id);
            return contact.data;
        } catch (contactError) {
            try {
                const lead = await this.zoho.api.leads.get(id);
                return lead.data;
            } catch (leadError) {
                throw new Error(`Person not found: ${id}`);
            }
        }
    }

    /**
     * Find person by external ID (helper for activity logging)
     * @param {string} externalId - External ID
     * @returns {Promise<Object|null>}
     */
    async findPersonByExternalId(externalId) {
        try {
            const contact = await this.zoho.api.contacts.get(externalId);
            return contact.data;
        } catch (contactError) {
            try {
                const lead = await this.zoho.api.leads.get(externalId);
                return lead.data;
            } catch (leadError) {
                return null;
            }
        }
    }

    // ============================================================================
    // EXISTING METHODS - Backward Compatibility
    // ============================================================================

    async listLeads({ req, res }) {
        try {
            const params = {
                per_page: req.query.per_page
                    ? parseInt(req.query.per_page)
                    : 50,
                page: req.query.page ? parseInt(req.query.page) : 1,
                sort_order: req.query.sort_order || 'asc',
                sort_by: req.query.sort_by || 'Created_Time',
            };

            const leads = await this.zoho.api.leads.getAll(params);
            res.json(leads);
        } catch (error) {
            console.error('Failed to list Zoho leads:', error);
            res.status(500).json({
                error: 'Failed to list leads',
                details: error.message,
            });
        }
    }

    async listContacts({ req, res }) {
        try {
            const params = {
                per_page: req.query.per_page
                    ? parseInt(req.query.per_page)
                    : 50,
                page: req.query.page ? parseInt(req.query.page) : 1,
                sort_order: req.query.sort_order || 'asc',
                sort_by: req.query.sort_by || 'Created_Time',
            };

            const contacts = await this.zoho.api.contacts.getAll(params);
            res.json(contacts);
        } catch (error) {
            console.error('Failed to list Zoho contacts:', error);
            res.status(500).json({
                error: 'Failed to list contacts',
                details: error.message,
            });
        }
    }

    async listDeals({ req, res }) {
        try {
            const params = {
                per_page: req.query.per_page
                    ? parseInt(req.query.per_page)
                    : 50,
                page: req.query.page ? parseInt(req.query.page) : 1,
                sort_order: req.query.sort_order || 'asc',
                sort_by: req.query.sort_by || 'Created_Time',
            };

            const deals = await this.zoho.api.deals.getAll(params);
            res.json(deals);
        } catch (error) {
            console.error('Failed to list Zoho deals:', error);
            res.status(500).json({
                error: 'Failed to list deals',
                details: error.message,
            });
        }
    }

    async listAccounts({ req, res }) {
        try {
            const params = {
                per_page: req.query.per_page
                    ? parseInt(req.query.per_page)
                    : 50,
                page: req.query.page ? parseInt(req.query.page) : 1,
                sort_order: req.query.sort_order || 'asc',
                sort_by: req.query.sort_by || 'Created_Time',
            };

            const accounts = await this.zoho.api.accounts.getAll(params);
            res.json(accounts);
        } catch (error) {
            console.error('Failed to list Zoho accounts:', error);
            res.status(500).json({
                error: 'Failed to list accounts',
                details: error.message,
            });
        }
    }

    async createRecord({ req, res }) {
        try {
            const { module, data } = req.body;

            if (!module || !data) {
                return res.status(400).json({
                    error: 'Module and data are required',
                });
            }

            const result =
                await this.zoho.api[module.toLowerCase()].create(data);
            res.json(result);
        } catch (error) {
            console.error('Failed to create Zoho record:', error);
            res.status(500).json({
                error: 'Failed to create record',
                details: error.message,
            });
        }
    }

    async searchData({ req, res }) {
        try {
            const { module, criteria } = req.body;

            if (!module || !criteria) {
                return res.status(400).json({
                    error: 'Module and criteria are required',
                });
            }

            const result =
                await this.zoho.api[module.toLowerCase()].search(criteria);
            res.json(result);
        } catch (error) {
            console.error('Failed to search Zoho data:', error);
            res.status(500).json({
                error: 'Failed to search data',
                details: error.message,
            });
        }
    }

    async getModules({ req, res }) {
        try {
            const modules = await this.zoho.api.modules.getAll();
            res.json(modules);
        } catch (error) {
            console.error('Failed to get Zoho modules:', error);
            res.status(500).json({
                error: 'Failed to get modules',
                details: error.message,
            });
        }
    }
}

module.exports = ZohoCRMIntegration;
