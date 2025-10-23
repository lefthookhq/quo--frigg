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
        getAuthorizationRequirements: (api) => {
            return {
                type: 'apiKey',
                data: {
                    jsonSchema: {
                        title: 'AxisCare API Authorization',
                        type: 'object',
                        required: ['apiKey', 'siteNumber'],
                        properties: {
                            apiKey: {
                                type: 'string',
                                title: 'API Key',
                            },
                            siteNumber: {
                                type: 'string',
                                title: 'Site Number',
                            },
                        },
                    },
                    uiSchema: {
                        apiKey: {
                            'ui:widget': 'password',
                            'ui:help': 'Your AxisCare API key',
                            'ui:placeholder': 'Enter your API key...',
                        },
                        siteNumber: {
                            'ui:help':
                                'Your AxisCare site number (e.g., agency123)',
                            'ui:placeholder': 'Enter your site number...',
                        },
                    },
                },
            };
        },
        getToken: async (api, params) => {
            // For AxisCare API, use API key authentication
            const apiKey =
                get(params.data, 'apiKey') || get(params.data, 'access_token');
            const siteNumber = get(params.data, 'siteNumber');

            if (!apiKey) {
                throw new Error(
                    'API key is required for AxisCare authentication',
                );
            }
            if (!siteNumber) {
                throw new Error(
                    'Site number is required for AxisCare authentication',
                );
            }

            return { access_token: apiKey, siteNumber };
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
            credential: ['access_token', 'siteNumber'],
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
            const apiKey = params.apiKey || params.access_token;
            const siteNumber = params.siteNumber;

            console.log(
                '[AxisCare setAuthParams] Received params:',
                JSON.stringify(params, null, 2),
            );
            console.log('[AxisCare setAuthParams] Using apiKey:', apiKey);
            console.log(
                '[AxisCare setAuthParams] Using siteNumber:',
                siteNumber,
            );

            if (!apiKey) {
                throw new Error(
                    'API key is required for AxisCare authentication',
                );
            }
            if (!siteNumber) {
                throw new Error(
                    'Site number is required for AxisCare authentication',
                );
            }

            //todo: do we really need these methods?
            api.setApiKey(apiKey);
            api.setSiteNumber(siteNumber);

            console.log(
                '[AxisCare setAuthParams] API key and site number set on API instance',
            );

            return { access_token: apiKey, siteNumber };
        },
    },
    env: {},
};

module.exports = { Definition };
