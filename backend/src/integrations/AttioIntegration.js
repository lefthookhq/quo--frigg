const { IntegrationBase } = require('@friggframework/core');

class AttioIntegration extends IntegrationBase {
    static Definition = {
        name: 'attio',
        version: '1.0.0',
        supportedVersions: ['1.0.0'],
        hasUserConfig: true,

        display: {
            label: 'Attio',
            description: 'Modern CRM platform integration with Quo API',
            category: 'CRM, Sales',
            detailsUrl: 'https://app.attio.com',
            icon: '',
        },
        modules: {
            attio: {
                definition: require('/Users/danielklotz/projects/lefthook/api-module-library/packages/v1-ready/attio').Definition,
            },
            quo: {
                definition: require('../api-modules/quo').Definition,
            },
        },
        routes: [
            {
                path: '/attio/workspaces',
                method: 'GET',
                event: 'LIST_ATTIO_WORKSPACES',
            },
            {
                path: '/attio/objects',
                method: 'GET',
                event: 'LIST_ATTIO_OBJECTS',
            },
            {
                path: '/attio/company',
                method: 'GET',
                event: 'LIST_ATTIO_COMPANIES',
            },
            {
                path: '/attio/people',
                method: 'GET',
                event: 'LIST_ATTIO_PEOPLE',
            },
        ],
    };

    constructor() {
        super();
        this.events = {
            LIST_ATTIO_WORKSPACES: {
                handler: this.listWorkspaces,
            },
            LIST_ATTIO_OBJECTS: {
                handler: this.listObjects,
            },
            LIST_ATTIO_COMPANIES: {
                handler: this.listCompanies,
            },
            LIST_ATTIO_PEOPLE: {
                handler: this.listPeople,
            },
            GET_ATTIO_CUSTOM_OBJECTS: {
                type: 'USER_ACTION',
                handler: this.getCustomObjects,
                title: 'Get Custom Objects',
                description: 'Retrieve custom object types from Attio',
                userActionType: 'DATA',
            },
            SYNC_COMPANIES_TO_QUO: {
                type: 'USER_ACTION',
                handler: this.syncCompaniesToQuo,
                title: 'Sync Companies to Quo',
                description: 'Synchronize Attio companies with Quo CRM',
                userActionType: 'DATA',
            },
            SYNC_PEOPLE_TO_QUO: {
                type: 'USER_ACTION',
                handler: this.syncPeopleToQuo,
                title: 'Sync People to Quo',
                description: 'Synchronize Attio people with Quo CRM',
                userActionType: 'DATA',
            },
            CREATE_ATTIO_RECORD: {
                type: 'USER_ACTION',
                handler: this.createRecord,
                title: 'Create Attio Record',
                description: 'Create a new record in Attio',
                userActionType: 'DATA',
            },
            SEARCH_ATTIO_RECORDS: {
                type: 'USER_ACTION',
                handler: this.searchRecords,
                title: 'Search Attio Records',
                description: 'Search for records across Attio accounts',
                userActionType: 'SEARCH',
            },
        };
    }

    async listWorkspaces({ req, res }) {
        try {
            const workspaces = await this.attio.api.listWorkspaces();
            res.json(workspaces);
        } catch (error) {
            console.error('Failed to list Attio workspaces:', error);
            res.status(500).json({ error: 'Failed to list workspaces', details: error.message });
        }
    }

    async listObjects({ req, res }) {
        try {
            const objects = await this.attio.api.listObjectTypes();
            res.json(objects);
        } catch (error) {
            console.error('Failed to list Attio objects:', error);
            res.status(500).json({ error: 'Failed to list objects', details: error.message });
        }
    }

    async listCompanies({ req, res }) {
        try {
            const params = {
                limit: req.query.limit ? parseInt(req.query.limit) : 50,
                cursor: req.query.cursor,
                filter: req.query.filter ? JSON.parse(req.query.filter) : null,
            };

            const companies = await this.attio.api.listCompanies(params);
            res.json(companies);
        } catch (error) {
            console.error('Failed to list Attio companies:', error);
            res.status(500).json({ error: 'Failed to list companies', details: error.message });
        }
    }

    async listPeople({ req, res }) {
        try {
            const params = {
                limit: req.query.limit ? parseInt(req.query.limit) : 50,
                cursor: req.query.cursor,
                filter: req.query.filter ? JSON.parse(req.query.filter) : null,
            };

            const people = await this.attio.api.listPeople(params);
            res.json(people);
        } catch (error) {
            console.error('Failed to list Attio people:', error);
            res.status(500).json({ error: 'Failed to list people', details: error.message });
        }
    }

    async getCustomObjects(args) {
        try {
            // Get all object types
            const objectTypes = await this.attio.api.listObjectTypes();

            // Filter for custom objects (non-standard ones)
            const customObjects = objectTypes.data?.filter(obj =>
                !['company', 'person', 'workspace'].includes(obj.object_type)
            ) || [];

            // Get sample records for each custom object
            const objectData = [];

            for (const objectType of customObjects.slice(0, args.maxObjects || 5)) {
                try {
                    const records = await this.attio.api.listRecords(objectType.object_type, {
                        limit: args.sampleLimit || 3,
                    });

                    objectData.push({
                        objectType: objectType.object_type,
                        displayName: objectType.display_name,
                        description: objectType.description,
                        properties: objectType.properties,
                        sampleRecords: records.data?.slice(0, args.sampleLimit || 3) || [],
                        recordCount: records.meta?.count || 0,
                    });
                } catch (error) {
                    objectData.push({
                        objectType: objectType.object_type,
                        displayName: objectType.display_name,
                        error: error.message,
                        sampleRecords: [],
                    });
                }
            }

            return {
                label: 'Attio Custom Objects',
                data: {
                    summary: {
                        totalCustomObjects: customObjects.length,
                        objectsWithSampleData: objectData.filter(obj => !obj.error).length,
                        totalRecords: objectData.reduce((sum, obj) => sum + (obj.recordCount || 0), 0),
                    },
                    objectData,
                    timestamp: new Date().toISOString(),
                }
            };
        } catch (error) {
            console.error('Failed to get custom objects:', error);
            throw new Error(`Failed to get custom objects: ${error.message}`);
        }
    }

    async syncCompaniesToQuo(args) {
        try {
            // Get companies from Attio
            const attioCompanies = await this.attio.api.listCompanies({
                limit: args.limit || 50,
                cursor: args.cursor,
                filter: args.filter ? JSON.parse(args.filter) : null,
            });

            const syncResults = [];

            for (const company of attioCompanies.data?.slice(0, args.maxCompanies || 10) || []) {
                try {
                    // Transform company data for Quo
                    const quoCompanyData = await this.transformCompanyForQuo(company);

                    // Create or update in Quo if available
                    let quoResult = null;
                    if (this.quo?.api) {
                        quoResult = await this.createQuoCompany(quoCompanyData);
                    }

                    syncResults.push({
                        attioCompany: {
                            id: company.id,
                            name: this.getCompanyName(company),
                            domain: this.getCompanyDomain(company),
                            status: company.company_status?.values?.[0]?.value,
                        },
                        quoCompany: quoResult,
                        syncStatus: quoResult ? 'success' : 'quo_unavailable',
                        timestamp: new Date().toISOString(),
                    });
                } catch (companyError) {
                    syncResults.push({
                        attioCompany: company,
                        error: companyError.message,
                        syncStatus: 'error',
                        timestamp: new Date().toISOString(),
                    });
                }
            }

            return {
                label: 'Company Sync Results',
                data: {
                    totalCompaniesProcessed: syncResults.length,
                    syncSummary: syncResults.reduce((summary, result) => {
                        summary[result.syncStatus] = (summary[result.syncStatus] || 0) + 1;
                        return summary;
                    }, {}),
                    syncResults,
                    timestamp: new Date().toISOString(),
                }
            };
        } catch (error) {
            console.error('Company sync failed:', error);
            throw new Error(`Company sync failed: ${error.message}`);
        }
    }

    async syncPeopleToQuo(args) {
        try {
            // Get people from Attio
            const attioPeople = await this.attio.api.listPeople({
                limit: args.limit || 50,
                cursor: args.cursor,
                filter: args.filter ? JSON.parse(args.filter) : null,
            });

            const syncResults = [];

            for (const person of attioPeople.data?.slice(0, args.maxPeople || 10) || []) {
                try {
                    // Transform person data for Quo
                    const quoPersonData = await this.transformPersonForQuo(person);

                    // Create or update in Quo if available
                    let quoResult = null;
                    if (this.quo?.api) {
                        quoResult = await this.createQuoPerson(quoPersonData);
                    }

                    syncResults.push({
                        attioPerson: {
                            id: person.id,
                            firstName: this.getPersonFirstName(person),
                            lastName: this.getPersonLastName(person),
                            email: this.getPersonEmail(person),
                            companyName: this.getPersonCompany(person),
                        },
                        quoPerson: quoResult,
                        syncStatus: quoResult ? 'success' : 'quo_unavailable',
                        timestamp: new Date().toISOString(),
                    });
                } catch (personError) {
                    syncResults.push({
                        attioPerson: person,
                        error: personError.message,
                        syncStatus: 'error',
                        timestamp: new Date().toISOString(),
                    });
                }
            }

            return {
                label: 'People Sync Results',
                data: {
                    totalPeopleProcessed: syncResults.length,
                    syncSummary: syncResults.reduce((summary, result) => {
                        summary[result.syncStatus] = (summary[result.syncStatus] || 0) + 1;
                        return summary;
                    }, {}),
                    syncResults,
                    timestamp: new Date().toISOString(),
                }
            };
        } catch (error) {
            console.error('People sync failed:', error);
            throw new Error(`People sync failed: ${error.message}`);
        }
    }

    async createRecord(args) {
        try {
            const { objectType, attributes } = args;

            if (!objectType) {
                throw new Error('Object type is required');
            }

            let result;
            switch (objectType.toLowerCase()) {
                case 'company':
                    result = await this.attio.api.createCompany(attributes);
                    break;
                case 'person':
                    result = await this.attio.api.createPerson(attributes);
                    break;
                default:
                    result = await this.attio.api.createRecord(objectType, attributes);
            }

            return {
                label: `Created ${objectType} Record`,
                data: {
                    objectType,
                    recordId: result.data?.id?.record_id,
                    attributes: attributes,
                    result,
                    timestamp: new Date().toISOString(),
                }
            };
        } catch (error) {
            console.error('Failed to create record:', error);
            throw new Error(`Failed to create record: ${error.message}`);
        }
    }

    async searchRecords(args) {
        try {
            const { query, objectType, limit } = args;

            let results = [];

            if (objectType && objectType.toLowerCase() === 'company') {
                const companies = await this.attio.api.searchCompanies(query, { limit: limit || 20 });
                results = companies.data || [];
            } else if (objectType && objectType.toLowerCase() === 'person') {
                const people = await this.attio.api.searchPeople(query, { limit: limit || 20 });
                results = people.data || [];
            } else {
                // Search across multiple object types
                const [companies, people] = await Promise.all([
                    this.attio.api.searchCompanies(query, { limit: limit ? Math.floor(limit / 2) : 10 }),
                    this.attio.api.searchPeople(query, { limit: limit ? Math.floor(limit / 2) : 10 }),
                ]);

                results = [
                    ...(companies.data || []).map(item => ({ ...item, _object_type: 'company' })),
                    ...(people.data || []).map(item => ({ ...item, _object_type: 'person' })),
                ];
            }

            return {
                label: `Search Results for "${query}"`,
                data: {
                    query,
                    objectType: objectType || 'all',
                    totalResults: results.length,
                    results: results.map(result => ({
                        id: result.id,
                        objectType: result._object_type || objectType,
                        name: this.getRecordName(result),
                        attributes: this.flattenRecordAttributes(result),
                    })),
                    timestamp: new Date().toISOString(),
                }
            };
        } catch (error) {
            console.error('Search failed:', error);
            throw new Error(`Search failed: ${error.message}`);
        }
    }

    // Helper methods to extract data from Attio's attribute structure
    getCompanyName(company) {
        return company.company_name?.values?.[0]?.value ||
            company.company_name_alternative?.values?.[0]?.value ||
            company.company_name_legal?.values?.[0]?.value ||
            'Unknown Company';
    }

    getCompanyDomain(company) {
        return company.company_domain?.values?.[0]?.value ||
            company.company_website?.values?.[0]?.value ||
            null;
    }

    getPersonFirstName(person) {
        return person.person_first_name?.values?.[0]?.value ||
            person.person_name_first?.values?.[0]?.value;
    }

    getPersonLastName(person) {
        return person.person_last_name?.values?.[0]?.value ||
            person.person_name_last?.values?.[0]?.value;
    }

    getPersonEmail(person) {
        return person.person_email?.values?.[0]?.value ||
            person.person_email_work?.values?.[0]?.value ||
            person.person_email_personal?.values?.[0]?.value;
    }

    getPersonCompany(person) {
        return person.company?.values?.[0]?.value ||
            person.person_company?.values?.[0]?.value;
    }

    getRecordName(record) {
        const objectType = record._object_type || 'unknown';

        if (objectType === 'company') {
            return this.getCompanyName(record);
        } else if (objectType === 'person') {
            const firstName = this.getPersonFirstName(record);
            const lastName = this.getPersonLastName(record);
            return `${firstName || ''} ${lastName || ''}`.trim() || 'Unknown Person';
        }

        return 'Unknown Record';
    }

    flattenRecordAttributes(record) {
        const flattened = {};

        for (const [key, value] of Object.entries(record)) {
            if (key.startsWith('_') || !value) continue;

            if (value.values && Array.isArray(value.values)) {
                flattened[key] = value.values.map(v => v.value).join(', ');
            } else if (typeof value === 'object') {
                flattened[key] = JSON.stringify(value);
            } else {
                flattened[key] = value;
            }
        }

        return flattened;
    }

    async transformCompanyForQuo(attioCompany) {
        return {
            name: this.getCompanyName(attioCompany),
            domain: this.getCompanyDomain(attioCompany),
            website: attioCompany.company_website?.values?.[0]?.value,
            industry: attioCompany.company_industry?.values?.[0]?.value,
            size: attioCompany.company_size?.values?.[0]?.value,
            status: attioCompany.company_status?.values?.[0]?.value,
            description: attioCompany.company_description?.values?.[0]?.value,
            customFields: {
                attioId: attioCompany.id,
                source: 'Attio',
                foundedYear: attioCompany.company_founded_year?.values?.[0]?.value,
            },
        };
    }

    async transformPersonForQuo(attioPerson) {
        return {
            firstName: this.getPersonFirstName(attioPerson),
            lastName: this.getPersonLastName(attioPerson),
            email: this.getPersonEmail(attioPerson),
            title: attioPerson.person_title?.values?.[0]?.value,
            phone: attioPerson.person_phone?.values?.[0]?.value,
            company: this.getPersonCompany(attioPerson),
            customFields: {
                attioId: attioPerson.id,
                source: 'Attio',
                location: attioPerson.person_location?.values?.[0]?.value,
            },
        };
    }

    async createQuoCompany(companyData) {
        if (!this.quo?.api) {
            return { message: 'Quo API not available', status: 'simulated' };
        }

        try {
            const quoCompany = await this.quo.api.createCompany(companyData);
            return {
                quoId: quoCompany.id || quoCompany.company_id,
                name: companyData.name,
                domain: companyData.domain,
                status: 'created',
            };
        } catch (error) {
            throw new Error(`Failed to create Quo company: ${error.message}`);
        }
    }

    async createQuoPerson(personData) {
        if (!this.quo?.api) {
            return { message: 'Quo API not available', status: 'simulated' };
        }

        try {
            const quoPerson = await this.quo.api.createPerson(personData);
            return {
                quoId: quoPerson.id || quoPerson.person_id,
                name: `${personData.firstName} ${personData.lastName}`,
                email: personData.email,
                status: 'created',
            };
        } catch (error) {
            throw new Error(`Failed to create Quo person: ${error.message}`);
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
                description: 'How often to sync data between Attio and Quo',
                default: 30,
                minimum: 5,
                maximum: 1440,
            },
            defaultObjectLimit: {
                type: 'number',
                title: 'Default Object Limit',
                description: 'Default limit for listing objects',
                default: 50,
                minimum: 10,
                maximum: 1000,
            },
        };
    }

    async getActionOptions({ actionId, data }) {
        switch (actionId) {
            case 'GET_ATTIO_CUSTOM_OBJECTS':
                return {
                    jsonSchema: {
                        type: 'object',
                        properties: {
                            maxObjects: {
                                type: 'number',
                                title: 'Max Objects',
                                description: 'Maximum number of custom objects to process',
                                minimum: 1,
                                maximum: 20,
                                default: 5,
                            },
                            sampleLimit: {
                                type: 'number',
                                title: 'Sample Records Limit',
                                description: 'Maximum number of sample records per object',
                                minimum: 1,
                                maximum: 10,
                                default: 3,
                            },
                        },
                        required: [],
                    },
                    uiSchema: {
                        type: 'VerticalLayout',
                        elements: [
                            {
                                type: 'Control',
                                scope: '#/properties/maxObjects',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/sampleLimit',
                            },
                        ],
                    },
                };
            case 'SYNC_COMPANIES_TO_QUO':
                return {
                    jsonSchema: {
                        type: 'object',
                        properties: {
                            limit: {
                                type: 'number',
                                title: 'Company Limit',
                                description: 'Maximum companies to retrieve for sync',
                                minimum: 1,
                                maximum: 1000,
                                default: 50,
                            },
                            maxCompanies: {
                                type: 'number',
                                title: 'Max Companies to Sync',
                                description: 'Maximum companies to actually sync',
                                minimum: 1,
                                maximum: 100,
                                default: 10,
                            },
                            filter: {
                                type: 'string',
                                title: 'Filter (JSON)',
                                description: 'Optional filter criteria in JSON format',
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
                                scope: '#/properties/maxCompanies',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/filter',
                            },
                        ],
                    },
                };
            case 'SYNC_PEOPLE_TO_QUO':
                return {
                    jsonSchema: {
                        type: 'object',
                        properties: {
                            limit: {
                                type: 'number',
                                title: 'Person Limit',
                                description: 'Maximum people to retrieve for sync',
                                minimum: 1,
                                maximum: 1000,
                                default: 50,
                            },
                            maxPeople: {
                                type: 'number',
                                title: 'Max People to Sync',
                                description: 'Maximum people to actually sync',
                                minimum: 1,
                                maximum: 100,
                                default: 10,
                            },
                            filter: {
                                type: 'string',
                                title: 'Filter (JSON)',
                                description: 'Optional filter criteria in JSON format',
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
                                scope: '#/properties/maxPeople',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/filter',
                            },
                        ],
                    },
                };
            case 'CREATE_ATTIO_RECORD':
                return {
                    jsonSchema: {
                        type: 'object',
                        properties: {
                            objectType: {
                                type: 'string',
                                title: 'Object Type',
                                description: 'Type of record to create',
                                enum: ['company', 'person', 'opportunity', 'deal'],
                                default: 'company',
                            },
                            attributes: {
                                type: 'object',
                                title: 'Attributes',
                                description: 'Attributes for the record (JSON object)',
                            },
                        },
                        required: ['objectType'],
                    },
                    uiSchema: {
                        type: 'VerticalLayout',
                        elements: [
                            {
                                type: 'Control',
                                scope: '#/properties/objectType',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/attributes',
                                options: {
                                    format: 'textarea',
                                    rows: 10,
                                },
                            },
                        ],
                    },
                };
            case 'SEARCH_ATTIO_RECORDS':
                return {
                    jsonSchema: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                title: 'Search Query',
                                description: 'Search term or phrase',
                                minLength: 1,
                            },
                            objectType: {
                                type: 'string',
                                title: 'Object Type',
                                description: 'Specific object type to search (leave empty for all)',
                                enum: ['', 'company', 'person', 'opportunity', 'deal'],
                            },
                            limit: {
                                type: 'number',
                                title: 'Result Limit',
                                description: 'Maximum number of results to return',
                                minimum: 1,
                                maximum: 100,
                                default: 20,
                            },
                        },
                        required: ['query'],
                    },
                    uiSchema: {
                        type: 'VerticalLayout',
                        elements: [
                            {
                                type: 'Control',
                                scope: '#/properties/query',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/objectType',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/limit',
                            },
                        ],
                    },
                };
            default:
                return null;
        }
    }
}

module.exports = AttioIntegration;
