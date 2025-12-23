require('dotenv').config();
const crypto = require('crypto');
const { Api } = require('./api');
const { get } = require('@friggframework/core');
const config = require('./defaultConfig.json');

const hashApiKey = (apiKey) => {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
};

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
            // For Quo API, use API key authentication
            const apiKey = get(params.data, 'apiKey');
            if (!apiKey) {
                throw new Error('API key is required for Quo authentication');
            }
            return { api_key: apiKey };
        },
        getEntityDetails: async (
            api,
            callbackParams,
            tokenResponse,
            userId,
        ) => {
            const apiKey = api.API_KEY_VALUE;

            const externalId = hashApiKey(apiKey);

            return {
                identifiers: {
                    externalId,
                    user: userId,
                },
                details: {
                    name: 'Quo Workspace (API Key Hash)',
                },
            };
        },
        apiPropertiesToPersist: {
            // TODO: Currently api_key is NOT auto-encrypted by Frigg core
            // See GitHub issue: https://github.com/friggframework/frigg/issues/500
            // Once fixed, api_key will be automatically encrypted like access_token
            credential: ['api_key'],
            entity: [],
        },
        getCredentialDetails: async (api, userId) => {
            const apiKey = api.API_KEY_VALUE;

            if (!apiKey) {
                throw new Error(
                    'API key is required for Quo credential details',
                );
            }

            const externalId = hashApiKey(apiKey);

            return {
                identifiers: {
                    externalId,
                    user: userId,
                },
                details: {
                    api_key: apiKey, // Explicitly include api_key in details to be persisted
                },
            };
        },
        testAuthRequest: async (api) => {
            return api.listContacts({ maxResults: 1 });
        },
        setAuthParams: async (api, params) => {
            // For API key authentication, set the key on the API instance
            // Accept both apiKey (from UI) and api_key (from persisted credential)
            const apiKey = params.apiKey || params.api_key;

            if (!apiKey) {
                throw new Error('API key is required for Quo authentication');
            }

            api.setApiKey(apiKey);

            return { api_key: apiKey };
        },
    },
    env: {},
};

module.exports = { Definition };
