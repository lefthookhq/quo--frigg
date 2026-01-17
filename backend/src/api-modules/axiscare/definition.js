require('dotenv').config();
const crypto = require('crypto');
const { Api } = require('./api');
const { get } = require('@friggframework/core');
const config = require('./defaultConfig.json');

const hashAccessToken = (accessToken) => {
    return crypto.createHash('sha256').update(accessToken).digest('hex');
};

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
            const apiKey = get(params.data, 'apiKey');
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

            return { api_key, siteNumber };
        },
        getEntityDetails: async (
            api,
            callbackParams,
            tokenResponse,
            userId,
        ) => {
            const externalId = hashAccessToken(tokenResponse.api_key);

            return {
                identifiers: {
                    externalId,
                    userId: userId,
                },
                details: {
                    name: 'AxisCare Account',
                    email: null,
                },
            };
        },
        apiPropertiesToPersist: {
            credential: ['api_key', 'siteNumber'],
            entity: [],
        },
        getCredentialDetails: async (api, userId) => {
            const apiKey = api.api_key;

            if (!apiKey) {
                throw new Error(
                    'API key is required for AxisCare credential details',
                );
            }

            const externalId = hashAccessToken(apiKey);
            try {
                const credentialTest = await api.listClients();

                if (credentialTest && credentialTest.errors.length > 0) {
                    throw new Error('Invalid AxisCare credentials');
                }

                return {
                    identifiers: {
                        externalId,
                        userId: userId,
                    },
                    details: {
                        api_key: apiKey, // Explicitly include api_key in details to be persisted
                    },
                };
            } catch (error) {
                return {
                    identifiers: { externalId, userId: userId },
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
            const apiKey = params.apiKey;
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

            return { api_key: apiKey, siteNumber };
        },
    },
    env: {},
};

module.exports = { Definition };
