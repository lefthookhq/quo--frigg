require('dotenv').config();
const { Api } = require('./api');
const { get } = require('@friggframework/core');
const config = require('./defaultConfig.json');

const Definition = {
    API: Api,
    getName: () => config.name,
    moduleName: config.name,
    modelName: 'AxisCare',
    requiredAuthMethods: {
        getToken: async (api, params) => {
            // For AxisCare API, use API key authentication
            const apiKey =
                get(params.data, 'apiKey') || get(params.data, 'access_token');
            if (!apiKey) {
                throw new Error(
                    'API key is required for AxisCare authentication',
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
                        externalId: userDetails.id || 'axiscare-user',
                        user: userId,
                    },
                    details: {
                        name:
                            userDetails.name ||
                            userDetails.email ||
                            'AxisCare User',
                        email: userDetails.email,
                    },
                };
            } catch (error) {
                // If we can't get user details, use a generic identifier
                return {
                    identifiers: { externalId: 'axiscare-user', user: userId },
                    details: { name: 'AxisCare User' },
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
                        externalId: userDetails.id || 'axiscare-user',
                        user: userId,
                    },
                    details: {},
                };
            } catch (error) {
                return {
                    identifiers: { externalId: 'axiscare-user', user: userId },
                    details: {},
                };
            }
        },
        testAuthRequest: async (api) => {
            try {
                return await api.listClients();
            } catch (error) {
                try {
                    return await api.listLeads();
                } catch (healthError) {
                    throw new Error(
                        'AxisCare authentication test failed: ' + error.message,
                    );
                }
            }
        },
        setAuthParams: async (api, params) => {
            // For API key authentication, set the key on the API instance
            // params IS the data object, so access apiKey directly
            const apiKey = params.apiKey || params.access_token;
            console.log(
                '[AxisCare setAuthParams] Received params:',
                JSON.stringify(params, null, 2),
            );
            console.log('[AxisCare setAuthParams] Using apiKey:', apiKey);
            if (!apiKey) {
                throw new Error(
                    'API key is required for AxisCare authentication',
                );
            }
            api.setApiKey(apiKey);
            console.log('[AxisCare setAuthParams] API key set on API instance');
            return { access_token: apiKey };
        },
    },
    env: {
        apiKey: process.env.AXISCARE_API_KEY,
        baseUrl: process.env.AXISCARE_BASE_URL,
    },
};

module.exports = { Definition };
