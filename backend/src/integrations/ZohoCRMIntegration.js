const { IntegrationBase } = require('@friggframework/core');

class ZohoCRMIntegration extends IntegrationBase {
    static Definition = {
        name: 'zoho-crm',
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
            zoho: {
                definition: require('/Users/sean/Documents/GitHub/api-module-library/packages/v1-ready/zoho-crm').Definition,
            },
            quo: {
                definition: require('../api-modules/quo').Definition,
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

    constructor() {
        super();
        this.events = {
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
            SYNC_LEADS_TO_QUO: {
                type: 'USER_ACTION',
                handler: this.syncLeadsToQuo,
                title: 'Sync Leads to Quo',
                description: 'Synchronize Zoho CRM leads with Quo CRM',
                userActionType: 'DATA',
            },
            SYNC_CONTACTS_TO_QUO: {
                type: 'USER_ACTION',
                handler: this.syncContactsToQuo,
                title: 'Sync Contacts to Quo',
                description: 'Synchronize Zoho CRM contacts with Quo CRM',
                userActionType: 'DATA',
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

    async listLeads({ req, res }) {
        try {
            const params = {
                per_page: req.query.per_page ? parseInt(req.query.per_page) : 50,
                page: req.query.page ? parseInt(req.query.page) : 1,
                sort_order: req.query.sort_order || 'asc',
                sort_by: req.query.sort_by || 'Created_Time',
            };
            
            const leads = await this.zoho.api.leads.getAll(params);
            res.json(leads);
        } catch (error) {
            console.error('Failed to list Zoho leads:', error);
            res.status(500).json({ error: 'Failed to list leads', details: error.message });
        }
    }

    async listContacts({ req, res }) {
        try {
            const params = {
                per_page: req.query.per_page ? parseInt(req.query.per_page) : 50,
                page: req.query.page ? parseInt(req.query.page) : 1,
                sort_order: req.query.sort_order || 'asc',
                sort_by: req.query.sort_by || 'Created_Time',
            };
            
            const contacts = await this.zoho.api.contacts.getAll(params);
            res.json(contacts);
        } catch (error) {
            console.error('Failed to list Zoho contacts:', error);
            res.status(500).json({ error: 'Failed to list contacts', details: error.message });
        }
    }

    async listDeals({ req, res }) {
        try {
            const params = {
                per_page: req.query.per_page ? parseInt(req.query.per_page) : 50,
                page: req.query.page ? parseInt(req.query.page) : 1,
                sort_order: req.query.sort_order || 'asc',
                sort_by: req.query.sort_by || 'Created_Time',
            };
            
            const deals = await this.zoho.api.deals.getAll(params);
            res.json(deals);
        } catch (error) {
            console.error('Failed to list Zoho deals:', error);
            res.status(500).json({ error: 'Failed to list deals', details: error.message });
        }
    }

    async listAccounts({ req, res }) {
        try {
            const params = {
                per_page: req.query.per_page ? parseInt(req.query.per_page) : 50,
                page: req.query.page ? parseInt(req.query.page) : 1,
                sort_order: req.query.sort_order || 'asc',
                sort_by: req.query.sort_by || 'Created_Time',
            };
            
            const accounts = await this.zoho.api.accounts.getAll(params);
            res.json(accounts);
        } catch (error) {
            console.error('Failed to list Zoho accounts:', error);
            res.status(500).json({ error: 'Failed to list accounts', details: error.message });
        }
    }

    async syncLeadsToQuo(args) {
        try {
            // Get leads from Zoho CRM
            const zohoLeads = await this.zoho.api.leads.getAll({
                per_page: args.per_page || 50,
                page: args.page || 1,
                sort_order: args.sort_order || 'desc',
                sort_by: args.sort_by || 'Created_Time',
            });

            const syncResults = [];

            for (const lead of zohoLeads.data?.slice(0, args.maxLeads || 10) || []) {
                try {
                    // Transform lead data for Quo
                    const quoLeadData = await this.transformLeadForQuo(lead);
                    
                    // Create or update in Quo if available
                    let quoResult = null;
                    if (this.quo?.api) {
                        quoResult = await this.createQuoLead(quoLeadData);
                    }

                    syncResults.push({
                        zohoLead: {
                            id: lead.id,
                            First_Name: lead.First_Name,
                            Last_Name: lead.Last_Name,
                            Lead_Source: lead.Lead_Source,
                            Email: lead.Email,
                            Phone: lead.Phone,
                            Company: lead.Company,
                            Lead_Status: lead.Lead_Status,
                        },
                        quoLead: quoResult,
                        syncStatus: quoResult ? 'success' : 'quo_unavailable',
                        timestamp: new Date().toISOString(),
                    });
                } catch (leadError) {
                    syncResults.push({
                        zohoLead: lead,
                        error: leadError.message,
                        syncStatus: 'error',
                        timestamp: new Date().toISOString(),
                    });
                }
            }

            return {
                label: 'Lead Sync Results',
                data: {
                    totalLeadsProcessed: syncResults.length,
                    syncSummary: syncResults.reduce((summary, result) => {
                        summary[result.syncStatus] = (summary[result.syncStatus] || 0) + 1;
                        return summary;
                    }, {}),
                    syncResults,
                    timestamp: new Date().toISOString(),
                }
            };
        } catch (error) {
            console.error('Lead sync failed:', error);
            throw new Error(`Lead sync failed: ${error.message}`);
        }
    }

    async syncContactsToQuo(args) {
        try {
            // Get contacts from Zoho CRM
            const zohoContacts = await this.zoho.api.contacts.getAll({
                per_page: args.per_page || 50,
                page: args.page || 1,
                sort_order: args.sort_order || 'desc',
                sort_by: args.sort_by || 'Created_Time',
            });

            const syncResults = [];

            for (const contact of zohoContacts.data?.slice(0, args.maxContacts || 10) || []) {
                try {
                    // Transform contact data for Quo
                    const quoContactData = await this.transformContactForQuo(contact);
                    
                    // Create or update in Quo if available
                    await this.createQuoContact(quoContactData);

                    syncResults.push({
                        zohoContact: {
                            id: contact.id,
                            First_Name: contact.First_Name,
                            Last_Name: contact.Last_Name,
                            Email: contact.Email,
                            Phone: contact.Phone,
                            Account_Name: contact.Account_Name,
                            Lead_Source: contact.Lead_Source,
                        },
                        quoContact: quoResult,
                        syncStatus: quoResult ? 'success' : 'quo_unavailable',
                        timestamp: new Date().toISOString(),
                    });
                } catch (contactError) {
                    syncResults.push({
                        zohoContact: contact,
                        error: contactError.message,
                        syncStatus: 'error',
                        timestamp: new Date().toISOString(),
                    });
                }
            }

            return {
                label: 'Contact Sync Results',
                data: {
                    totalContactsProcessed: syncResults.length,
                    syncSummary: syncResults.reduce((summary, result) => {
                        summary[result.syncStatus] = (summary[result.syncStatus] || 0) + 1;
                        return summary;
                    }, {}),
                    syncResults,
                    timestamp: new Date().toISOString(),
                }
            };
        } catch (error) {
            console.error('Contact sync failed:', error);
            throw new Error(`Contact sync failed: ${error.message}`);
        }
    }

    async createRecord(args) {
        try {
            const { module, data } = args;
            
            if (!module || !data) {
                throw new Error('Module and data are required');
            }

            let result;
            switch (module.toLowerCase()) {
                case 'leads':
                    result = await this.zoho.api.leads.insert(data);
                    break;
                case 'contacts':
                    result = await this.zoho.api.contacts.insert(data);
                    break;
                case 'deals':
                    result = await this.zoho.api.deals.insert(data);
                    break;
                case 'accounts':
                    result = await this.zoho.api.accounts.insert(data);
                    break;
                default:
                    throw new Error(`Unsupported module: ${module}`);
            }

            return {
                label: `${module} Record Created`,
                data: {
                    module,
                    recordId: result.data?.details?.id,
                    data,
                    result,
                    timestamp: new Date().toISOString(),
                }
            };
        } catch (error) {
            console.error('Failed to create record:', error);
            throw new Error(`Failed to create record: ${error.message}`);
        }
    }

    async searchData(args) {
        try {
            const { term, module, criteria } = args;
            
            if (!term) {
                throw new Error('Search term is required');
            }

            let results = [];
            let searchPromises = [];

            if (!module || module === 'all' || module === 'leads') {
                searchPromises.push(
                    this.zoho.api.leads.search(term, criteria)
                        .then(res => res.data?.details?.map(item => ({ ...item, _module: 'leads' })) || [])
                        .catch(err => [])
                );
            }

            if (!module || module === 'all' || module === 'contacts') {
                searchPromises.push(
                    this.zoho.api.contacts.search(term, criteria)
                        .then(res => res.data?.details?.map(item => ({ ...item, _module: 'contacts' })) || [])
                        .catch(err => [])
                );
            }

            if (!module || module === 'all' || module === 'deals') {
                searchPromises.push(
                    this.zoho.api.deals.search(term, criteria)
                        .then(res => res.data?.details?.map(item => ({ ...item, _module: 'deals' })) || [])
            .catch(err => [])
            );
        }

        if (!module || module === 'all' || module === 'accounts') {
            searchPromises.push(
                this.zoho.api.accounts.search(term, criteria)
                    .then(res => res.data?.details?.map(item => ({ ...item, _module: 'accounts' })) || [])
                    .catch(err => [])
            );
        }

        const searchResults = await Promise.all(searchPromises);
        results = searchResults.flat();

        return {
            label: `Search Results for "${term}"`,
            data: {
                query: term,
                module: module || 'all',
                criteria: criteria || {},
                totalResults: results.length,
                results: results.map(result => ({
                    id: result.id,
                    module: result._module,
                    name: this.getSearchResultName(result),
                    details: this.getSearchResultDetails(result),
                })),
                timestamp: new Date().toISOString(),
            }
        };
    } catch (error) {
        console.error('Search failed:', error);
        throw new Error(`Search failed: ${error.message}`);
    }
}

async getModules(args) {
    try {
        // List all modules with their fields
        const modules = await this.zoho.api.getModules();
        
        // Get field details for each module
        const moduleData = [];
        
        for (const module of modules.data?.details?.slice(0, args.maxModules || 10) || []) {
            try {
                const fields = await this.zoho.api.getFields(module.api_name);
                
                moduleData.push({
                    moduleName: module.display_label,
                    apiName: module.api_name,
                    singularLabel: module.singular_label,
                    pluralLabel: module.plural_label,
                    modifiedTime: module.modified_time,
                    hasRecords: module.num_records > 0,
                    fields: fields.data?.details?.slice(0, args.maxFields || 20) || [],
                    fieldCount: fields.data?.count || 0,
                });
            } catch (fieldError) {
                moduleData.push({
                    moduleName: module.display_label,
                    apiName: module.api_name,
                    singularLabel: module.singular_label,
                    pluralLabel: module.plural_label,
                    error: fieldError.message,
                    fields: [],
                });
            }
        }

        return {
            label: 'Available Zoho CRM Modules',
            data: {
                summary: {
                    totalModules: moduleData.length,
                    modulesWithFields: moduleData.filter(m => !m.error).length,
                    totalFields: moduleData.reduce((sum, m) => sum + (m.fieldCount || 0), 0),
                },
                moduleData,
                timestamp: new Date().toISOString(),
            }
        };
    } catch (error) {
        console.error('Failed to get modules:', error);
        throw new Error(`Failed to get modules: ${error.message}`);
    }
}

getSearchResultName(result) {
    const module = result._module;
    
    switch (module) {
        case 'leads':
            return `${result.First_Name || ''} ${result.Last_Name || ''}`.trim() || result.Company || 'Unknown Lead';
        case 'contacts':
            return `${result.First_Name || ''} ${result.Last_Name || ''}`.trim() || 'Unknown Contact';
        case 'deals':
            return result.Deal_Name || 'Unknown Deal';
        case 'accounts':
            return result.Account_Name || 'Unknown Account';
        default:
            return result.name || result.Name || 'Unknown';
    }
}

getSearchResultDetails(result) {
    const module = result._module;
    
    switch (module) {
        case 'leads':
            return {
                email: result.Email || 'No email',
                phone: result.Phone || 'No phone',
                company: result.Company || 'No company',
                source: result.Lead_Source || 'Unknown source',
                status: result.Lead_Status || 'Unknown status',
            };

, 'contacts': {
                email: result.Email || 'No email',
                phone: result.Phone || 'No phone',
                account: result.Account_Name || 'No account',
                source: result.Lead_Source || 'Unknown source',
            },
        case 'deals':
            return {
                amount: result.Amount || 'No amount',
                stage: result.Stage || 'Unknown stage',
                account: result.Account_Name || 'No account',
                contact: result.Contact_Name || 'No contact',
            };
        case 'accounts':
            return {
                industry: result.Industry || 'No industry',
                website: result.Website || 'No website',
                phone: result.Phone || 'No phone',
                annualRevenue: result.Annual_Revenue || 'No revenue',
            };
        default:
            return {};
    }
}

async transformLeadForQuo(zohoLead) {
    return {
        firstName: zohoLead.First_Name,
        lastName: zohoLead.Last_Name,
        email: zohoLead.Email,
        phone: zohoLead.Phone,
        company: zohoLead.Company,
        title: zohoLead.Designation || zohoLead.Title,
        source: zohoLead.Lead_Source,
        status: zohoLead.Lead_Status,
        rating: zohoLead.Rating,
        description: zohoLead.Description,
        website: zohoLead.Website,
        customFields: {
            zohoId: zohoLead.id,
            source: 'Zoho CRM',
            noOfEmployees: zohoLead.No_of_Employees,
            industry: zohoLead.Industry,
        },
    };
}

async transformContactForQuo(zohoContact) {
    return {
        firstName: zohoContact.First_Name,
        lastName: zohoContact.Last_Name,
        email: zohoContact.Email,
        phone: zohoContact.Phone,
        accountName: zohoContact.Account_Name,
        title: zohoContact.Designation || zohoContact.Title,
        source: zohoContact.Lead_Source,
        mailingStreet: zohoContact.Mailing_Street,
        mailingCity: zohoContact.Mailing_City,
        mailingState: zohoContact.Mailing_State,
        mailingZip: zohoContact.Mailing_Zip,
        customFields: {
            zohoId: zohoContact.id,
            source: 'Zoho CRM',
            description: zohoContact.Description,
        },
    };
}

async createQuoLead(leadData) {
    if (!this.quo?.api) {
        return { message: 'Quo API not available', status: 'simulated' };
    }

    try {
        const quoLead = await this.quo.api.createLead(leadData);
        return {
            quoId: quoLead.id || quoLead.lead_id,
            name: `${leadData.firstName} ${leadData.lastName}`,
            email: leadData.email,
            company: leadData.company,
            status: 'created',
        };
    } catch (error) {
        throw new Error(`Failed to create Quo lead: ${error.message}`);
    }
}

async createQuoContact(contactData) {
    if (!this.quo?.api) {
        return { message: 'Quo API not available', status: 'simulated' };
    }

    try {
        const quoContact = await this.quo.api.createContact(contactData);
        return {
            quoId: quoContact.id || quoContact.contact_id,
            name: `${contactData.firstName} ${contactData.lastName}`,
            email: contactData.email,
            account: contactData.accountName,
            status: 'created',
        };
    } catch (error) {
        throw new Error(`Failed to create Quo contact: ${error.message}`);
    }
}

async onCreate(params) {
    this.record.status = 'ENABLED';
    await this.record.save();
    return this.record;
}

async onUpdate(params) {
    await this.record.save();
    return this.validateConfig();
}

async getConfigOptions() {
    return {
        syncInterval: {
            type: 'number',
            title: 'Sync Interval (minutes)',
            description: 'How often to sync data between Zoho CRM and Quo',
            default: 30,
            minimum: 5,
            maximum: 1440,
        },
        defaultRecordsPerPage: {
            type: 'number',
            title: 'Default Records per Page',
            description: 'Default number of records to fetch per page',
            default: 50,
            minimum: 10,
            maximum: 200,
        },
    };
}

async getActionOptions({ actionId, data }) {
    switch (actionId) {
        case 'SYNC_LEADS_TO_QUO':
            return {
                jsonSchema: {
                    type: 'object',
                    properties: {
                        per_page: {
                            type: 'number',
                            title: 'Records per Page',
                            description: 'Number of records to fetch per page',
                            minimum: 10,
                            maximum: 200,
                            default: 50,
                        },
                        maxLeads: {
                            type: 'number',
                            title: 'Max Leads to Sync',
                            description: 'Maximum leads to actually sync',
                            minimum: 1,
                            maximum: 100,
                            default: 10,
                        },
                        sort_by: {
                            type: 'string',
                            title: 'Sort By',
                            description: 'Field to sort by',
                            enum: ['Created_Time', 'Modified_Time', 'First_Name', 'Company'],
                            default: 'Created_Time',
                        },
                        sort_order: {
                            type: 'string',
                            title: 'Sort Order',
                            description: 'Sort order',
                            enum: ['asc', 'desc'],
                            default: 'desc',
                        },
                    },
                    required: [],
                },
                uiSchema: {
                    type: 'VerticalLayout',
                    elements: [
                        {
                            type: 'Control',
                            scope: '#/properties/per_page',
                        },
                        {
                            type: 'Control',
                            scope: '#/properties/maxLeads',
                        },
                        {
                            type: 'Control',
                            scope: '#/properties/sort_by',
                        },
                        {
                            type: 'Control',
                            scope: '#/properties/sort_order',
                        },
                    ],
                },
            };
        case 'SYNC_CONTACTS_TO_QUO':
            return {
                jsonSchema: {
                    type: 'object',
                    properties: {
                        per_page: {
                            type: 'number',
                            title: 'Records per page',
                            description: 'Number of records to fetch per page',
                            minimum: 10,
                            maximum: 200,
                            default: 50,
                        },
                        maxContacts: {
                            type: 'number',
                            title: 'Max Contacts to Sync',
                            description: 'Maximum contacts to actually sync',
                            minimum: 1,
                            maximum: 100,
                            default: 10,
                        },
                        sort_by: {
                            type: 'string',
                            title: 'Sort By',
                            description: 'Field to sort by',
                            enum: ['Created_Time', 'Modified_Time', 'First_Name', 'Account_Name'],
                            default: 'Created_Time',
                        },
                        sort_order: {
                            type: 'string',
                            title: 'Sort Order',
                            description: 'Sort order',
                            enum: ['asc', 'desc'],
                            default: 'desc',
                        },
                    },
                    required: [],
                },
                uiSchema: {
                    type: 'VerticalLayout',
                    elements: [
                        {
                            type: 'Control',
                            scope: '#/properties/per_page',
                        },
                        {
                            type: 'Control',
                            scope: '#/properties/maxContacts',
                        },
                        {
                            type: 'Control',
                            scope: '#/properties/sort_by',
                        },
                        {
                            type: 'Control',
                            scope: '#/properties/sort_order',
                        },
                    ],
                },
            };
        case 'CREATE_ZOHO_RECORD':
            return {
                jsonSchema: {
                    type: 'object',
                    properties: {
                        module: {
                            type: 'string',
                            title: 'Module',
                            description: 'Zoho CRM module to create record in',
                            enum: ['leads', 'contacts', 'deals', 'accounts'],
                            default: 'leads',
                        },
                        data: {
                            type: 'object',
                            title: 'Record Data',
                            description: 'Record data in JSON format',
                        },
                    },
                    required: ['module', 'data'],
                },
                uiSchema: {
                    type: 'VerticalLayout',
                    elements: [
                        {
                            type: 'Control',
                            scope: '#/properties/module',
                        },
                        {
                            type: 'Control',
                            scope: '#/properties/data',
                            options: {
                                format: 'textarea',
                                rows: 10,
                            },
                        },
                    ],
                },
            };
        case 'SEARCH_ZOHO_DATA':
            return {
                jsonSchema: {
                    type: 'object',
                    properties: {
                        term: {
                            type: 'string',
                            title: 'Search Term',
                            description: 'Search term or phrase',
                            minLength: 1,
                        },
                        module: {
                            type: 'string',
                            title: 'Module',
                            description: 'Specific module to search (leave empty for all)',
                            enum: ['', 'leads', 'contacts', 'deals', 'accounts'],
                        },
                        criteria: {
                            type: 'object',
                            title: 'Search Criteria',
                            description: 'Additional search criteria in JSON format',
                        },
                    },
                    required: ['term'],
                },
                uiSchema: {
                    type: 'VerticalLayout',
                    elements: [
                        {
                            type: 'Control',
                            scope: '#/properties/term',
                        },
                        {
                            type: 'Control',
                            scope: '#/properties/module',
                        },
                        {
                            type: 'Control',
                            scope: '#/properties/criteria',
                            options: {
                                format: 'textarea',
                                rows: 5,
                            },
                        },
                    ],
                },
            };
        case 'GET_ZOHO_MODULES':
            return {
                jsonSchema: {
                    type: 'object',
                    properties: {
                        maxModules: {
                            type: 'number',
                            title: 'Max Modules',
                            description: 'Maximum number of modules to process',
                            minimum: 1,
                            maximum: 50,
                            default: 10,
                        },
                        maxFields: {
                            type: 'number',
                            title: 'Max Fields per Module',
                            description: 'Maximum fields to retrieve per module',
                            minimum: 5,
                            maximum: 100,
                            default: 20,
                        },
                    },
                    required: [],
                },
                uiSchema: {
                    type: 'VerticalLayout',
                    elements: [
                        {
                            type: 'Control',
                            scope: '#/properties/maxModules',
                        },
                        {
                            type: 'Control',
                            scope: '#/properties/maxFields',
                        },
                    ],
                },
            };
    }
    return null;
}

module.exports = ZohoCRMIntegration;
