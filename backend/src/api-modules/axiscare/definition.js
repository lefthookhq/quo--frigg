require('dotenv').config();
const { Api } = require('./api');
const { get } = require("@friggframework/core");
const config = require('./defaultConfig.json');

const Definition = {
    API: Api,
    getName: () => config.name,
    moduleName: config.name,
    modelName: 'AxisCare',
    requiredAuthMethods: {
        getToken: async (api, params) => {
            // For AxisCare API, use API key authentication
            const apiKey = get(params.data, 'apiKey') || get(params.data, 'access_token');
            if (!apiKey) {
                throw new Error('API key is required for AxisCare authentication');
            }
            return { access_token: apiKey };
        },
        getEntityDetails: async (api, callbackParams, tokenResponse, userId) => {
            try {
                const userDetails = await api.getCurrentUser();
                return {
                    identifiers: { externalId: userDetails.id || 'axiscare-user', user: userId },
                    details: {
                        name: userDetails.name || userDetails.email || 'AxisCare User',
                        email: userDetails.email
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
                    identifiers: { externalId: userDetails.id || 'axiscare-user', user: userId },
                    details: {}
                };
            } catch (error) {
                return {
                    identifiers: { externalId: 'axiscare-user', user: userId },
                    details: {}
                };
            }
        },
        testAuthRequest: async (api) => {
            try {
                return await api.getCurrentUser();
            } catch (error) {
                try {
                    return await api.healthCheck();
                } catch (healthError) {
                    throw new Error('AxisCare authentication test failed: ' + error.message);
                }
            }
        },
    },
    env: {
        api_key: process.env.AXISCARE_API_KEY,
        base_url: process.env.AXISCARE_BASE_URL || config.baseUrl,
    }
};

module.exports = { Definition };
