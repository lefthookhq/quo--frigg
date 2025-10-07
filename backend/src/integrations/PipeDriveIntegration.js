const { IntegrationBase } = require('@friggframework/core');

class PipeDriveIntegration extends IntegrationBase {
    static Definition = {
        name: 'pipedrive',
        version: '1.0.0',
        supportedVersions: ['1.0.0'],
        hasUserConfig: true,

        display: {
            label: 'PipeDrive',
            description: 'Pipeline management platform integration with Quo API',
            category: 'CRM & Sales',
            detailsUrl: 'https://www.pipedrive.com',
            icon: '',
        },
        modules: {
            pipedrive: {
                definition: require('/Users/sean/Documents/GitHub/api-module-library/packages/needs-updating/pipedrive').Definition,
            },
            quo: {
                definition: require('../api-modules/quo').Definition,
            },
        },
        routes: [
            {
                path: '/pipedrive/deals',
                method: 'GET',
                event: 'LIST_PIPEDRIVE_DEALS',
            },
            {
                path: '/pipedrive/persons',
                method: 'GET',
                event: 'LIST_PIPEDRIVE_PERSONS',
            },
            {
                path: '/pipedrive/organizations',
                method: 'GET',
                event: 'LIST_PIPEDRIVE_ORGANIZATIONS',
            },
            {
                path: '/pipedrive/activities',
                method: 'GET',
                event: 'LIST_PIPEDRIVE_ACTIVITIES',
            },
        ],
    };

    constructor() {
        super();
        this.events = {
            LIST_PIPEDRIVE_DEALS: {
                handler: this.listDeals,
            },
            LIST_PIPEDRIVE_PERSONS: {
                handler: this.listPersons,
            },
            LIST_PIPEDRIVE_ORGANIZATIONS: {
                handler: this.listOrganizations,
            },
            LIST_PIPEDRIVE_ACTIVITIES: {
                handler: this.listActivities,
            },
            SYNC_DEALS_TO_QUO: {
                type: 'USER_ACTION',
                handler: this.syncDealsToQuo,
                title: 'Sync Deals to Quo',
                description: 'Synchronize PipeDrive deals with Quo CRM',
                userActionType: 'DATA',
            },
            SYNC_PERSONS_TO_QUO: {
                type: 'USER_ACTION',
                handler: this.syncPersonsToQuo,
                title: 'Sync Persons to Quo',
                description: 'Synchronize PipeDrive persons with Quo CRM',
                userActionType: 'DATA',
            },
            CREATE_PIPEDRIVE_DEAL: {
                type: 'USER_ACTION',
                handler: this.createDeal,
                title: 'Create PipeDrive Deal',
                description: 'Create a new deal in PipeDrive',
                userActionType: 'DATA',
            },
            SEARCH_PIPEDRIVE_DATA: {
                type: 'USER_ACTION',
                handler: this.searchData,
                title: 'Search PipeDrive Data',
                description: 'Search for deals, persons, and organizations',
                userActionType: 'SEARCH',
            },
            GET_PIPEDRIVE_STATS: {
                type: 'USER_ACTION',
                handler: this.getStats,
                title: 'Get PipeDrive Stats',
                description: 'Get statistics and performance metrics from PipeDrive',
                userActionType: 'REPORT',
            },
        };
    }

    async listDeals({ req, res }) {
        try {
            const params = {
                limit: req.query.limit ? parseInt(req.query.limit) : 50,
                start: req.query.start ? parseInt(req.query.start) : 0,
                status: req.query.status,
                filter_id: req.query.filter_id,
            };

            const deals = await this.pipedrive.api.deals.getAll(params);
            res.json(deals);
        } catch (error) {
            console.error('Failed to list PipeDrive deals:', error);
            res.status(500).json({ error: 'Failed to list deals', details: error.message });
        }
    }

    async listPersons({ req, res }) {
        try {
            const params = {
                limit: req.query.limit ? parseInt(req.query.limit) : 50,
                start: req.query.start ? parseInt(req.query.start) : 0,
                search: req.query.search,
            };

            const persons = await this.pipedrive.api.persons.getAll(params);
            res.json(persons);
        } catch (error) {
            console.error('Failed to list PipeDrive persons:', error);
            res.status(500).json({ error: 'Failed to list persons', details: error.message });
        }
    }

    async listOrganizations({ req, res }) {
        try {
            const params = {
                limit: req.query.limit ? parseInt(req.query.limit) : 50,
                start: req.query.start ? parseInt(req.query.start) : 0,
                search: req.query.search,
            };

            const organizations = await this.pipedrive.api.organizations.getAll(params);
            res.json(organizations);
        } catch (error) {
            console.error('Failed to list PipeDrive organizations:', error);
            res.status(500).json({ error: 'Failed to list organizations', details: error.message });
        }
    }

    async listActivities({ req, res }) {
        try {
            const params = {
                limit: req.query.limit ? parseInt(req.query.limit) : 50,
                start: req.query.start ? parseInt(req.query.start) : 0,
                done: req.query.done,
                type: req.query.type,
            };

            const activities = await this.pipedrive.api.activities.getAll(params);
            res.json(activities);
        } catch (error) {
            console.error('Failed to list PipeDrive activities:', error);
            res.status(500).json({ error: 'Failed to list activities', details: error.message });
        }
    }

    async syncDealsToQuo(args) {
        try {
            // Get deals from PipeDrive
            const pipedriveDeals = await this.pipedrive.api.deals.getAll({
                limit: args.limit || 50,
                start: args.start || 0,
                status: args.status,
                filter_id: args.filter_id,
            });

            const syncResults = [];

            for (const deal of pipedriveDeals.data?.slice(0, args.maxDeals || 10) || []) {
                try {
                    // Transform deal data for Quo
                    const quoDealData = await this.transformDealForQuo(deal);

                    // Create or update in Quo if available
                    let quoResult = null;
                    if (this.quo?.api) {
                        quoResult = await this.createQuoDeal(quoDealData);
                    }

                    syncResults.push({
                        pipedriveDeal: {
                            id: deal.id,
                            title: deal.title,
                            value: deal.value,
                            currency: deal.currency,
                            status: deal.status,
                            person_name: deal.person_name,
                            org_name: deal.org_name,
                        },
                        quoDeal: quoResult,
                        syncStatus: quoResult ? 'success' : 'quo_unavailable',
                        timestamp: new Date().toISOString(),
                    });
                } catch (dealError) {
                    syncResults.push({
                        pipedriveDeal: deal,
                        error: dealError.message,
                        syncStatus: 'error',
                        timestamp: new Date().toISOString(),
                    });
                }
            }

            return {
                label: 'Deal Sync Results',
                data: {
                    totalDealsProcessed: syncResults.length,
                    syncSummary: syncResults.reduce((summary, result) => {
                        summary[result.syncStatus] = (summary[result.syncStatus] || 0) + 1;
                        return summary;
                    }, {}),
                    syncResults,
                    timestamp: new Date().toISOString(),
                }
            };
        } catch (error) {
            console.error('Deal sync failed:', error);
            throw new Error(`Deal sync failed: ${error.message}`);
        }
    }

    async syncPersonsToQuo(args) {
        try {
            // Get persons from PipeDrive
            const pipedrivePersons = await this.pipedrive.api.persons.getAll({
                limit: args.limit || 50,
                start: args.start || 0,
                search: args.search,
            });

            const syncResults = [];

            for (const person of pipedrivePersons.data?.slice(0, args.maxPersons || 10) || []) {
                try {
                    // Transform person data for Quo
                    const quoPersonData = await this.transformPersonForQuo(person);

                    // Create or update in Quo if available
                    let quoResult = null;
                    if (this.quo?.api) {
                        quoResult = await this.createQuoPerson(quoPersonData);
                    }

                    syncResults.push({
                        pipedrivePerson: {
                            id: person.id,
                            name: person.name,
                            first_name: person.first_name,
                            last_name: person.last_name,
                            email: person.email?.[0]?.value,
                            phone: person.phone?.[0]?.value,
                            org_name: person.org_name,
                        },
                        quoPerson: quoResult,
                        syncStatus: quoResult ? 'success' : 'quo_unavailable',
                        timestamp: new Date().toISOString(),
                    });
                } catch (personError) {
                    syncResults.push({
                        pipedrivePerson: person,
                        error: personError.message,
                        syncStatus: 'error',
                        timestamp: new Date().toISOString(),
                    });
                }
            }

            return {
                label: 'Person Sync Results',
                data: {
                    totalPersonsProcessed: syncResults.length,
                    syncSummary: syncResults.reduce((summary, result) => {
                        summary[result.syncStatus] = (summary[result.syncStatus] || 0) + 1;
                        return summary;
                    }, {}),
                    syncResults,
                    timestamp: new Date().toISOString(),
                }
            };
        } catch (error) {
            console.error('Person sync failed:', error);
            throw new Error(`Person sync failed: ${error.message}`);
        }
    }

    async createDeal(args) {
        try {
            const { title, value, currency, person_id, org_id, status, stage_id } = args;

            if (!title) {
                throw new Error('Deal title is required');
            }

            const dealData = {
                title,
                value: parseFloat(value) || null,
                currency: currency || 'USD',
                person_id: parseInt(person_id) || null,
                org_id: parseInt(org_id) || null,
                status: status || 'open',
                stage_id: parseInt(stage_id) || null,
            };

            const result = await this.pipedrive.api.deals.add(dealData);

            return {
                label: 'Created PipeDrive Deal',
                data: {
                    dealId: result.data.id,
                    dealData: dealData,
                    result,
                    timestamp: new Date().toISOString(),
                }
            };
        } catch (error) {
            console.error('Failed to create deal:', error);
            throw new Error(`Failed to create deal: ${error.message}`);
        }
    }

    async searchData(args) {
        try {
            const { query, type } = args;

            let results = [];
            let searchPromises = [];

            if (!type || type === 'all' || type === 'deal') {
                searchPromises.push(
                    this.pipedrive.api.deals.getAll({ term: query, limit: 20 })
                        .then(res => res.data.map(item => ({ ...item, _type: 'deal' })))
                        .catch(err => [])
                );
            }

            if (!type || type === 'all' || type === 'person') {
                searchPromises.push(
                    this.pipedrive.api.persons.getAll({ search: query, limit: 20 })
                        .then(res => res.data.map(item => ({ ...item, _type: 'person' })))
                        .catch(err => [])
                );
            }

            if (!type || type === 'all' || type === 'organization') {
                searchPromises.push(
                    this.pipedrive.api.organizations.getAll({ search: query, limit: 20 })
                        .then(res => res.data.map(item => ({ ...item, _type: 'organization' })))
                        .catch(err => [])
                );
            }

            const searchResults = await Promise.all(searchPromises);
            results = searchResults.flat();

            return {
                label: `Search Results for "${query}"`,
                data: {
                    query,
                    type: type || 'all',
                    totalResults: results.length,
                    results: results.map(result => ({
                        id: result.id,
                        type: result._type,
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

    async getStats(args) {
        try {
            // Get deals statistics
            const deals = await this.pipedrive.api.deals.getAll({ limit: 1000 });
            const persons = await this.pipedrive.api.persons.getAll({ limit: 1000 });
            const organizations = await this.pipedrive.api.organizations.getAll({ limit: 1000 });

            // Calculate basic statistics
            const totalDeals = deals.data?.length || 0;
            const totalValue = deals.data?.reduce((sum, deal) => sum + (parseFloat(!) || 0), 0) || 0;

            const openDeals = deals.data?.filter(deal => deal.status === 'open') || [];
            const wonDeals = deals.data?.filter(deal => deal.status === 'won') || [];
            const lostDeals = deals.data?.filter(deal => deal.status === 'lost') || [];

            const wonValue = wonDeals.reduce((sum, deal) => sum + (!) || 0), 0);
            const openValue = openDeals.reduce((sum, deal) => sum + (!) || 0), 0);

            const stats = {
                deals: {
                    total: totalDeals,
                    open: openDeals.length,
                    won: wonDeals.length,
                    lost: lostDeals.length,
                    totalValue: totalValue,
                    wonValue: wonValue,
                    openValue: openValue,
                    winRate: totalDeals > 0 ? ((wonDeals.length / totalDeals) * 100).toFixed(1) : 0,
                },
                contacts: {
                    totalPersons: persons.data?.length || 0,
                    totalOrganizations: organizations.data?.length || 0,
                },
                activity: {
                    lastUpdated: Math.max(
                        deals.data?.map(d => new Date(!).getTime()).max() || 0,
                        persons.data?.map(p => new Date(!).getTime()).max() || 0,
                        organizations.data?.map(o => new Date(!).getTime()).max() || 0
                    ),
                }
            };

            return {
                label: 'PipeDrive Statistics',
                data: {
                    stats,
                    summary: {
                        totalDeals: stats.deals.total,
                        totalValue: stats.deals.totalValue.toLocaleString(),
                        winRate: `${stats.deals.winRate}%`,
                        totalContacts: stats.contacts.totalPersons + stats.contacts.totalOrganizations,
                    },
                    timestamp: new Date().toISOString(),
                }
            };
        } catch (error) {
            console.error('Failed to get stats:', error);
            throw new Error(`Failed to get stats: ${error.message}`);
        }
    }

    getSearchResultName(result) {
        switch (result._type) {
            case 'deal':
                return result.title || 'Untitled Deal';
            case 'person':
                return result.name || `${result.first_name} ${result.last_name}` || 'Unknown Person';
            case 'organization':
                return result.name || 'Unknown Organization';
            default:
                return result.name || result.title || 'Unknown';
        }
    }

    getSearchResultDetails(result) {
        switch (result._type) {
            case 'deal':
                return {
                    value: result.value ? `${result.currency} ${result.value}` : 'No value',
                    status: result.status,
                    person: result.person_name,
                    organization: result.org_name,
                };
            case 'person':
                return {
                    email: result.email?.[0]?.value || 'No email',
                    phone: result.phone?.[0]?.value || 'No phone',
                    organization: result.org_name || 'No organization',
                };
            case 'organization':
                return {
                    address: result.address || 'No address',
                    phone: result.phone || 'No phone',
                    email: result.email || 'No email',
                };
            default:
                return {};
        }
    }

    async transformDealForQuo(pipedriveDeal) {
        return {
            name: pipedriveDeal.title,
            value: parseFloat(pipedriveDeal.value) || 0,
            currency: pipedriveDeal.currency || 'USD',
            stage: pipedriveDeal.stage_name || pipedriveDeal.status,
            status: pipedriveDeal.status,
            probability: pipedriveDeal.probability,
            expectedCloseDate: pipedriveDeal.expected_close_date,
            actualCloseDate: pipedriveDeal.close_time,
            personName: pipedriveDeal.person_name,
            organizationName: pipedriveDeal.org_name,
            customFields: {
                pipedriveId: pipedriveDeal.id,
                source: 'PipeDrive',
                stageId: pipedriveDeal.stage_id,
            },
        };
    }

    async transformPersonForQuo(pipedrivePerson) {
        return {
            firstName: pipedrivePerson.first_name,
            lastName: pipedrivePerson.last_name,
            email: pipedrivePerson.email?.[0]?.value,
            phone: pipedrivePerson.phone?.[0]?.value,
            company: pipedrivePerson.org_name,
            title: pipedrivePerson.label || pipedrivePerson.job_title,
            customFields: {
                pipedriveId: pipedrivePerson.id,
                source: 'PipeDrive',
                owner: pipedrivePerson.owner_name,
            },
        };
    }

    async createQuoDeal(dealData) {
        if (!this.quo?.api) {
            return { message: 'Quo API not available', status: 'simulated' };
        }

        try {
            const quoDeal = await this.quo.api.createDeal(dealData);
            return {
                quoId: quoDeal.id || quoDeal.deal_id,
                name: dealData.name,
                value: dealData.value,
                status: 'created',
            };
        } catch (error) {
            throw new Error(`Failed to create Quo deal: ${error.message}`);
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
                description: 'How often to sync data between PipeDrive and Quo',
                default: 15,
                minimum: 5,
                maximum: 1440,
            },
            defaultLimit: {
                type: 'number',
                title: 'Default List Limit',
                description: 'Default limit for listing records',
                default: 50,
                minimum: 10,
                maximum: 1000,
            },
        };
    }

    async getActionOptions({ actionId, data }) {
        switch (actionId) {
            case 'SYNC_DEALS_TO_QUO':
                return {
                    jsonSchema: {
                        type: 'object',
                        properties: {
                            limit: {
                                type: 'number',
                                title: 'Deal Limit',
                                description: 'Maximum deals to retrieve for sync',
                                minimum: 1,
                                maximum: 1000,
                                default: 50,
                            },
                            maxDeals: {
                                type: 'number',
                                title: 'Max Deals to Sync',
                                description: 'Maximum deals to actually sync',
                                minimum: 1,
                                maximum: 100,
                                default: 10,
                            },
                            status: {
                                type: 'string',
                                title: 'Deal Status Filter',
                                description: 'Only sync deals with this status',
                                enum: ['open', 'won', 'lost'],
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
                                scope: '#/properties/maxDeals',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/status',
                            },
                        ],
                    },
                };
            case 'SYNC_PERSONS_TO_QUO':
                return {
                    jsonSchema: {
                        type: 'object',
                        properties: {
                            limit: {
                                type: 'number',
                                title: 'Person Limit',
                                description: 'Maximum persons to retrieve for sync',
                                minimum: 1,
                                maximum: 1000,
                                default: 50,
                            },
                            maxPersons: {
                                type: 'number',
                                title: 'Max Persons to Sync',
                                description: 'Maximum persons to actually sync',
                                minimum: 1,
                                maximum: 100,
                                default: 10,
                            },
                            search: {
                                type: 'string',
                                title: 'Search Filter',
                                description: 'Filter persons by name',
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
                                scope: '#/properties/maxPersons',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/search',
                            },
                        ],
                    },
                };
            case 'CREATE_PIPEDRIVE_DEAL':
                return {
                    jsonSchema: {
                        type: 'object',
                        properties: {
                            title: {
                                type: 'string',
                                title: 'Deal Title',
                                description: 'Name of the deal',
                                minLength: 1,
                            },
                            value: {
                                type: 'number',
                                title: 'Deal Value',
                                description: 'Value of the deal',
                                minimum: 0,
                            },
                            currency: {
                                type: 'string',
                                title: 'Currency',
                                description: 'Currency code (USD, EUR, etc.)',
                                default: 'USD',
                            },
                            person_id: {
                                type: 'number',
                                title: 'Person ID',
                                description: 'ID of associated person',
                                minimum: 1,
                            },
                            org_id: {
                                type: 'number',
                                title: 'Organization ID',
                                description: 'ID of associated organization',
                                minimum: 1,
                            },
                            status: {
                                type: 'string',
                                title: 'Deal Status',
                                description: 'Status of the deal',
                                enum: ['open', 'won', 'lost'],
                                default: 'open',
                            },
                            stage_id: {
                                type: 'number',
                                title: 'Stage ID',
                                description: 'ID of deal stage',
                                minimum: 1,
                            },
                        },
                        required: ['title'],
                    },
                    uiSchema: {
                        type: 'VerticalLayout',
                        elements: [
                            {
                                type: 'Control',
                                scope: '#/properties/title',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/value',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/currency',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/person_id',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/org_id',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/status',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/stage_id',
                            },
                        ],
                    },
                };
            case 'SEARCH_PIPEDRIVE_DATA':
                return {
                    jsonSchema: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                title: 'Search Query',
                                description: 'Search term',
                                minLength: 1,
                            },
                            type: {
                                type: 'string',
                                title: 'Search Type',
                                description: 'What to search for',
                                enum: ['all', 'deal', 'person', 'organization'],
                                default: 'all',
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
                                scope: '#/properties/type',
                            },
                        ],
                    },
                };
        }
        return null;
    }
}

module.exports = PipeDriveIntegration;
