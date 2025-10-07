const { IntegrationBase } = require('@friggframework/core');

class ScalingTestIntegration extends IntegrationBase {
    static Definition = {
        name: 'scalingtest',
        version: '1.0.0',
        supportedVersions: ['1.0.0'],
        hasUserConfig: true,

        display: {
            label: 'Scaling Test Integration',
            description:
                'Integration for testing scalability using Quo API and Frigg Scale Test API',
            category: 'Testing',
            detailsUrl: '',
            icon: '',
        },
        modules: {
            quo: {
                definition: require('../api-modules/quo').Definition,
            },
            scaleTest: {
                definition: {
                    name: 'scale-test',
                    version: '1.0.0',
                    API: require('/Users/danielklotz/projects/lefthook/api-module-library/packages/v1-ready/api-module-frigg-scale-test')
                        .FriggScaleTestAPI,
                    getName: () => 'Frgg Scale Test API',
                    moduleName: 'scale-test',
                    modelName: 'ScaleTest',
                    requiredAuthMethods: {
                        getToken: async (api, params) => {
                            // For scale test API, use API key authentication
                            const apiKey =
                                params.data?.apiKey ||
                                params.data?.access_token;
                            return { access_token: apiKey };
                        },
                        getEntityDetails: async (
                            api,
                            callbackParams,
                            tokenResponse,
                            userId,
                        ) => {
                            const healthCheck = await api.health();
                            return {
                                identifiers: {
                                    externalId: 'scale-test-account',
                                    user: userId,
                                },
                                details: {
                                    name: 'Scale Test Account',
                                    status: healthCheck.ok
                                        ? 'healthy'
                                        : 'error',
                                },
                            };
                        },
                        apiPropertiesToPersist: {
                            credential: ['access_token'],
                            entity: [],
                        },
                        getCredentialDetails: async (api, userId) => {
                            return {
                                identifiers: {
                                    externalId: 'scale-test-account',
                                    user: userId,
                                },
                                details: {},
                            };
                        },
                        testAuthRequest: async (api) => api.health(),
                    },
                    env: {
                        apiKey: process.env.SCALE_TEST_API_KEY,
                    },
                },
            },
        },
        routes: [
            {
                path: '/scale-test/health',
                method: 'GET',
                event: 'SCALE_TEST_HEALTH_CHECK',
            },
            {
                path: '/scale-test/config',
                method: 'GET',
                event: 'GET_SCALE_TEST_CONFIG',
            },
            {
                path: '/scale-test/contacts',
                method: 'GET',
                event: 'LIST_SCALE_TEST_CONTACTS',
            },
            {
                path: '/scale-test/activities',
                method: 'GET',
                event: 'LIST_SCALE_TEST_ACTIVITIES',
            },
        ],
    };

    constructor() {
        super();
        this.events = {
            SCALE_TEST_HEALTH_CHECK: {
                handler: this.checkHealth,
            },
            GET_SCALE_TEST_CONFIG: {
                handler: this.getConfig,
            },
            LIST_SCALE_TEST_CONTACTS: {
                handler: this.listContacts,
            },
            LIST_SCALE_TEST_ACTIVITIES: {
                handler: this.listActivities,
            },
            RUN_SCALE_PERFORMANCE_TEST: {
                type: 'USER_ACTION',
                handler: this.runPerformanceTest,
                title: 'Run Performance Test',
                description:
                    'Execute a scalability performance test with Quo and Scale Test APIs',
                userActionType: 'TEST',
            },
            SYNC_CONTACT_DATA: {
                type: 'USER_ACTION',
                handler: this.syncContactData,
                title: 'Sync Contact Data',
                description:
                    'Synchronize contact data between Quo and Scale Test systems',
                userActionType: 'DATA',
            },
        };
    }

    async checkHealth({ req, res }) {
        try {
            const health = await this.scaleTest.api.health();
            res.json(health);
        } catch (error) {
            console.error('Health check failed:', error);
            res.status(500).json({
                error: 'Health check failed',
                details: error.message,
            });
        }
    }

    async getConfig({ req, res }) {
        try {
            const accountId = req.query.accountId || 'default-account';
            const config = await this.scaleTest.api.getConfig(accountId);
            res.json(config);
        } catch (error) {
            console.error('Failed to get config:', error);
            res.status(500).json({
                error: 'Failed to get config',
                details: error.message,
            });
        }
    }

    async listContacts({ req, res }) {
        try {
            const params = {
                accountId: req.query.accountId || 'default-account',
                limit: req.query.limit ? parseInt(req.query.limit) : 50,
                cursor: req.query.cursor,
                updatedSince: req.query.updatedSince,
            };

            const result = await this.scaleTest.api.listContacts(params);
            res.json(result);
        } catch (error) {
            console.error('Failed to list contacts:', error);
            res.status(500).json({
                error: 'Failed to list contacts',
                details: error.message,
            });
        }
    }

    async listActivities({ req, res }) {
        try {
            const params = {
                accountId: req.query.accountId || 'default-account',
                limit: req.query.limit ? parseInt(req.query.limit) : 50,
                cursor: req.query.cursor,
                updatedSince: req.query.updatedSince,
                type: req.query.type,
                contactId: req.query.contactId,
            };

            const result = await this.scaleTest.api.listActivities(params);
            res.json(result);
        } catch (error) {
            console.error('Failed to list activities:', error);
            res.status(500).json({
                error: 'Failed to list activities',
                details: error.message,
            });
        }
    }

    async runPerformanceTest(args) {
        try {
            const startTime = Date.now();

            // Simulate a performance test by making concurrent requests
            const promises = [];

            // Test scaling by listing contacts with various parameters
            for (let i = 0; i < (args.concurrentRequests || 10); i++) {
                promises.push(
                    this.scaleTest.api.listContacts({
                        accountId: args.accountId || 'test-account',
                        limit: args.contactLimit || 10,
                    }),
                );
            }

            const results = await Promise.all(promises);
            const endTime = Date.now();
            const duration = endTime - startTime;

            // Also test Quo API if available
            let quoTestResult = null;
            if (this.quo?.api) {
                try {
                    // Test a simple Quo API call if available
                    quoTestResult = await this.testQuoAPICall();
                } catch (quoError) {
                    console.warn('Quo API test failed:', quoError.message);
                }
            }

            return {
                data: {
                    performanceMetrics: {
                        concurrentRequests: args.concurrentRequests || 10,
                        totalDurationMs: duration,
                        avgResponseTimeMs:
                            duration / (args.concurrentRequests || 10),
                        totalContactsRetrieved: results.reduce(
                            (sum, result) => sum + result.items.length,
                            0,
                        ),
                        successRate: `${((results.length / promises.length) * 100).toFixed(1)}%`,
                    },
                    testResults: results.map((result, index) => ({
                        requestIndex: index + 1,
                        contactsReturned: result.items.length,
                        nextCursor: result.nextCursor,
                    })),
                    quoTestResult,
                    timestamp: new Date().toISOString(),
                },
            };
        } catch (error) {
            console.error('Performance test failed:', error);
            throw new Error(`Performance test failed: ${error.message}`);
        }
    }

    async syncContactData(args) {
        try {
            // First, get contacts from Scale Test API
            const scaleTestContacts = await this.scaleTest.api.listContacts({
                accountId: args.accountId || 'default-account',
                limit: args.limit || 100,
                updatedSince: args.updatedSince,
            });

            // Process and sync the data
            const syncResults = [];

            for (const contact of scaleTestContacts.items.slice(
                0,
                args.maxContacts || 10,
            )) {
                try {
                    // Transform contact data for Quo (if Quo API is available)
                    let quoContactData = null;
                    if (this.quo?.api) {
                        quoContactData = await this.syncContactToQuo(contact);
                    }

                    syncResults.push({
                        originalContact: {
                            id: contact.id,
                            name: contact.name,
                            email: contact.email,
                        },
                        quoData: quoContactData,
                        syncStatus: quoContactData
                            ? 'success'
                            : 'quo_unavailable',
                        timestamp: new Date().toISOString(),
                    });
                } catch (contactError) {
                    syncResults.push({
                        originalContact: contact,
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
                        summary[result.syncStatus] =
                            (summary[result.syncStatus] || 0) + 1;
                        return summary;
                    }, {}),
                    syncResults,
                    timestamp: new Date().toISOString(),
                },
            };
        } catch (error) {
            console.error('Contact sync failed:', error);
            throw new Error(`Contact sync failed: ${error.message}`);
        }
    }

    async testQuoAPICall() {
        // Placeholder for testing Quo API - implement specific Quo API calls as needed
        return {
            status: 'success',
            message: 'Quo API call successful (placeholder)',
            timestamp: new Date().toISOString(),
        };
    }

    async syncContactToQuo(contact) {
        // Placeholder for syncing contact to Quo - implement specific Quo API calls as needed
        return {
            quoId: `quo-${contact.id}`,
            name: contact.name,
            email: contact.email,
            syncStatus: 'created',
            timestamp: new Date().toISOString(),
        };
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
            accountId: {
                type: 'string',
                title: 'Account ID',
                description: 'Default account ID for scaling tests',
                default: 'default-account',
            },
            concurrentRequests: {
                type: 'number',
                title: 'Concurrent Requests',
                description:
                    'Number of concurrent requests for performance testing',
                default: 10,
                minimum: 1,
                maximum: 100,
            },
            maxContacts: {
                type: 'number',
                title: 'Max Contacts to Sync',
                description: 'Maximum number of contacts to sync per operation',
                default: 10,
                minimum: 1,
                maximum: 1000,
            },
        };
    }

    async getActionOptions({ actionId, data }) {
        switch (actionId) {
            case 'RUN_SCALE_PERFORMANCE_TEST':
                return {
                    jsonSchema: {
                        type: 'object',
                        properties: {
                            accountId: {
                                type: 'string',
                                title: 'Account ID',
                                description: 'Account ID for the test',
                            },
                            concurrentRequests: {
                                type: 'number',
                                title: 'Concurrent Requests',
                                description:
                                    'Number of concurrent requests to make',
                                minimum: 1,
                                maximum: 100,
                                default: 10,
                            },
                            contactLimit: {
                                type: 'number',
                                title: 'Contact Limit',
                                description:
                                    'Maximum contacts to retrieve per request',
                                minimum: 1,
                                maximum: 1000,
                                default: 10,
                            },
                        },
                        required: [],
                    },
                    uiSchema: {
                        type: 'VerticalLayout',
                        elements: [
                            {
                                type: 'Control',
                                scope: '#/properties/accountId',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/concurrentRequests',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/contactLimit',
                            },
                        ],
                    },
                };
            case 'SYNC_CONTACT_DATA':
                return {
                    jsonSchema: {
                        type: 'object',
                        properties: {
                            accountId: {
                                type: 'string',
                                title: 'Account ID',
                                description: 'Account ID for contact sync',
                            },
                            limit: {
                                type: 'number',
                                title: 'Contact Limit',
                                description:
                                    'Maximum contacts to retrieve for sync',
                                minimum: 1,
                                maximum: 1000,
                                default: 100,
                            },
                            maxContacts: {
                                type: 'number',
                                title: 'Max Contacts to Sync',
                                description:
                                    'Maximum contacts to actually sync',
                                minimum: 1,
                                maximum: 100,
                                default: 10,
                            },
                            updatedSince: {
                                type: 'string',
                                title: 'Updated Since',
                                description:
                                    'Only sync contacts updated since this date (ISO format)',
                                format: 'date-time',
                            },
                        },
                        required: [],
                    },
                    uiSchema: {
                        type: 'VerticalLayout',
                        elements: [
                            {
                                type: 'Control',
                                scope: '#/properties/accountId',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/limit',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/maxContacts',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/updatedSince',
                            },
                        ],
                    },
                };
        }
        return null;
    }
}

module.exports = ScalingTestIntegration;
