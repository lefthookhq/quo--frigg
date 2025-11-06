require('dotenv').config();
const { Api } = require('./api');
const { get } = require('@friggframework/core');
const config = require('./defaultConfig.json');

const Definition = {
    API: Api,
    getName: () => config.name,
    moduleName: config.name,
    modelName: 'Quo',
    requiredAuthMethods: {
        getAuthorizationRequirements: (api) => {
            return {
                type: 'apiKey',
                data: {
                    jsonSchema: {
                        title: 'Quo API Authorization',
                        type: 'object',
                        required: ['apiKey'],
                        properties: {
                            apiKey: {
                                type: 'string',
                                title: 'API Key',
                            },
                        },
                    },
                    uiSchema: {
                        apiKey: {
                            'ui:widget': 'password',
                            'ui:help': 'Your Quo API key',
                            'ui:placeholder': 'Enter your API key...',
                        },
                    },
                },
            };
        },
        getToken: async (api, params) => {
            // For OpenPhone API, use API key authentication
            const apiKey =
                get(params.data, 'apiKey') || get(params.data, 'access_token');
            if (!apiKey) {
                throw new Error(
                    'API key is required for OpenPhone authentication',
                );
            }
            return { access_token: apiKey };
        },
        setAuthParams: async (api, params) => {
            // For API key authentication, set the key on the API instance
            // params IS the data object, so access apiKey directly
            const apiKey = params.apiKey || params.access_token;
            console.log(
                '[Quo setAuthParams] Received params:',
                JSON.stringify(params, null, 2),
            );
            console.log('[Quo setAuthParams] Using apiKey:', apiKey);
            if (!apiKey) {
                throw new Error('API key is required for Quo authentication');
            }
            api.setApiKey(apiKey);
            console.log('[Quo setAuthParams] API key set on API instance');
            return { access_token: apiKey };
        },
        getEntityDetails: async (
            api,
            callbackParams,
            tokenResponse,
            userId,
        ) => {
            try {
                // Get the first user as a way to validate the connection
                const usersResponse = await api.listUsers({ maxResults: 1 });
                const firstUser = usersResponse?.data?.[0];

                return {
                    identifiers: {
                        externalId: firstUser?.id || 'openphone-workspace',
                        user: userId,
                    },
                    details: {
                        name:
                            firstUser?.name ||
                            firstUser?.email ||
                            'OpenPhone Workspace',
                        email: firstUser?.email,
                    },
                };
            } catch (error) {
                // If we can't get user details, use a generic identifier
                return {
                    identifiers: {
                        externalId: 'openphone-workspace',
                        user: userId,
                    },
                    details: { name: 'OpenPhone Workspace' },
                };
            }
        },
        apiPropertiesToPersist: {
            credential: ['access_token'],
            entity: [],
        },
        getCredentialDetails: async (api, userId) => {
            try {
                const usersResponse = await api.listUsers({ maxResults: 1 });
                const firstUser = usersResponse?.data?.[0];

                return {
                    identifiers: {
                        externalId: firstUser?.id || 'openphone-workspace',
                        user: userId,
                    },
                    details: {},
                };
            } catch (error) {
                return {
                    identifiers: {
                        externalId: 'openphone-workspace',
                        user: userId,
                    },
                    details: {},
                };
            }
        },
        testAuthRequest: async (api) => {
            // Skip actual API test due to 30-second API key propagation delay
            // The key will be validated when webhooks are set up (delayed by 35 seconds in onCreate)
            console.log('[Quo testAuthRequest] Skipping API test - API key propagation takes ~30 seconds');
            return { status: 'success', message: 'Auth test skipped - will validate during webhook setup' };
        },
    },
    env: {
        api_key: process.env.OPENPHONE_API_KEY || process.env.QUO_API_KEY,
    },
};

module.exports = { Definition };
