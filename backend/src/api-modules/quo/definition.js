require('dotenv').config();
const { Api } = require('./api');
const { get } = require("@friggframework/core");
const config = require('./defaultConfig.json');

const Definition = {
    API: Api,
    getName: () => config.name,
    moduleName: config.name,
    modelName: 'OpenPhone',
    requiredAuthMethods: {
        getToken: async (api, params) => {
            // For OpenPhone API, use API key authentication
            const apiKey = get(params.data, 'apiKey') || get(params.data, 'access_token');
            if (!apiKey) {
                throw new Error('API key is required for OpenPhone authentication');
            }
            return { access_token: apiKey };
        },
        getEntityDetails: async (api, callbackParams, tokenResponse, userId) => {
            try {
                // Get the first user as a way to validate the connection
                const usersResponse = await api.listUsers({ maxResults: 1 });
                const firstUser = usersResponse?.data?.[0];

                return {
                    identifiers: {
                        externalId: firstUser?.id || 'openphone-workspace',
                        user: userId
                    },
                    details: {
                        name: firstUser?.name || firstUser?.email || 'OpenPhone Workspace',
                        email: firstUser?.email
                    },
                };
            } catch (error) {
                // If we can't get user details, use a generic identifier
                return {
                    identifiers: { externalId: 'openphone-workspace', user: userId },
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
                        user: userId
                    },
                    details: {}
                };
            } catch (error) {
                return {
                    identifiers: { externalId: 'openphone-workspace', user: userId },
                    details: {}
                };
            }
        },
        testAuthRequest: async (api) => {
            try {
                // Test authentication by listing users
                const response = await api.listUsers({ maxResults: 1 });
                return response;
            } catch (error) {
                throw new Error('OpenPhone authentication test failed: ' + error.message);
            }
        },
    },
    env: {
        api_key: process.env.OPENPHONE_API_KEY || process.env.QUO_API_KEY,
    }
};

module.exports = { Definition };
