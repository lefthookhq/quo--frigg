require('dotenv').config();
const { Api } = require('./api');
const { get } = require('@friggframework/core');
const config = require('./defaultConfig.json');

const Definition = {
    API: Api,
    getName: () => config.name,
    moduleName: config.name,
    modelName: 'Pipedrive',
    requiredAuthMethods: {
        getToken: async (api, params) => {
            // For Pipedrive API, use API token authentication
            const apiKey =
                get(params.data, 'apiKey') ||
                get(params.data, 'access_token') ||
                get(params.data, 'api_token');

            if (!apiKey) {
                throw new Error(
                    'API token is required for Pipedrive authentication',
                );
            }
            return { access_token: apiKey };
        },
        getEntityDetails: async (
            api,
            callbackParams,
            tokenResponse,
            userId,
        ) => {
            try {
                const userDetails = await api.getCurrentUser();
                return {
                    identifiers: {
                        externalId: userDetails.id || 'pipedrive-user',
                        user: userId,
                    },
                    details: {
                        name: userDetails.name || 'Pipedrive User',
                        email: userDetails.email,
                    },
                };
            } catch (error) {
                // If we can't get user details, use a generic identifier
                return {
                    identifiers: { externalId: 'pipedrive-user', user: userId },
                    details: { name: 'Pipedrive User' },
                };
            }
        },
        apiPropertiesToPersist: {
            credential: ['access_token'],
            entity: [],
        },
        getCredentialDetails: async (api, userId) => {
            try {
                const userDetails = await api.getCurrentUser();
                return {
                    identifiers: {
                        externalId: userDetails.id || 'pipedrive-user',
                        user: userId,
                    },
                    details: {},
                };
            } catch (error) {
                return {
                    identifiers: { externalId: 'pipedrive-user', user: userId },
                    details: {},
                };
            }
        },
        testAuthRequest: async (api) => {
            try {
                // Test authentication by fetching current user
                const user = await api.getCurrentUser();
                return { success: true, user };
            } catch (error) {
                throw new Error(
                    'Pipedrive authentication test failed: ' + error.message,
                );
            }
        },
        setAuthParams: async (api, params) => {
            // For API token authentication, set the token on the API instance
            const apiKey = params.apiKey || params.access_token || params.api_token;

            console.log(
                '[Pipedrive setAuthParams] Received params:',
                JSON.stringify({ ...params, apiKey: apiKey ? '***' : undefined }, null, 2),
            );

            if (!apiKey) {
                throw new Error(
                    'API token is required for Pipedrive authentication',
                );
            }

            api.setApiKey(apiKey);
            console.log('[Pipedrive setAuthParams] API token set on API instance');
            return { access_token: apiKey };
        },
    },
    env: {
        apiKey: process.env.PIPEDRIVE_API_KEY,
    },
};

module.exports = { Definition };
