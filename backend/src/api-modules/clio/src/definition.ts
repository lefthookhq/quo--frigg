import { Api } from './api';
import { get, FriggModuleAuthDefinition } from '@friggframework/core';
import config from '../defaultConfig.json';
import { ClioRegion } from './types';

const Definition: FriggModuleAuthDefinition = {
    API: Api,
    getName: () => config.name,
    moduleName: config.name,
    modelName: 'Clio',
    requiredAuthMethods: {
        getAuthorizationRequirements: (api: Api) => {
            // Note: api parameter is undefined when called by framework
            // Query parameters (e.g., ?region=us) are not passed to this method
            // For manual testing via curl: defaults to US region
            // For UI flow: user selects region in form, calls setAuthParams, then redirects
            const clientId = process.env.CLIO_CLIENT_ID;
            const redirectUri = `${process.env.REDIRECT_URI}/clio`;
            const authUrl = 'https://app.clio.com'; // Default to US region

            const url = encodeURI(
                `${authUrl}/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code`
            );

            return {
                type: 'oauth2',
                url,
                data: {
                    jsonSchema: {
                        title: 'Clio Authorization',
                        type: 'object',
                        required: ['region'],
                        properties: {
                            region: {
                                type: 'string',
                                title: 'Region',
                                enum: ['us', 'eu', 'ca', 'au'],
                                enumNames: [
                                    'United States',
                                    'Europe',
                                    'Canada',
                                    'Australia',
                                ],
                                default: 'us',
                            },
                        },
                    },
                    uiSchema: {
                        region: {
                            'ui:widget': 'select',
                            'ui:help':
                                'Select the Clio region where your account is located',
                            'ui:placeholder': 'Select your region...',
                        },
                    },
                },
            };
        },

        getToken: async (api: Api, params: { code: string }) => {
            const code = get(params, 'code');

            if (!code) {
                throw new Error('Authorization code is required');
            }

            try {
                return await api.getTokenFromCode(code);
            } catch (error: any) {
                const message = error.message || 'Unknown error';
                throw new Error(`Clio OAuth token exchange failed: ${message}`);
            }
        },

        getEntityDetails: async (
            api: Api,
            callbackParams: any,
            tokenResponse: any,
            userId: string,
        ) => {
            try {
                const userResponse = await api.getUser();

                if (!userResponse || !userResponse.data) {
                    throw new Error(
                        `Clio /users/who_am_i failed to return valid user info. Response: ${JSON.stringify(
                            userResponse,
                        )}`,
                    );
                }

                const userData = userResponse.data;

                return {
                    identifiers: {
                        externalId: String(userData.id),
                        user: userId,
                    },
                    details: {
                        name:
                            userData.name ||
                            `${userData.first_name} ${userData.last_name}`,
                        email: userData.email,
                        region: api.region,
                    },
                };
            } catch (error: any) {
                throw new Error(
                    `Failed to get Clio entity details: ${error.message}`,
                );
            }
        },

        apiPropertiesToPersist: {
            credential: ['access_token', 'refresh_token', 'region'],
            entity: [],
        },

        getCredentialDetails: async (api: Api, userId: string) => {
            try {
                const userResponse = await api.getUser();

                if (!userResponse || !userResponse.data) {
                    throw new Error(
                        `Clio /users/who_am_i failed to return valid user info. Response: ${JSON.stringify(
                            userResponse,
                        )}`,
                    );
                }

                return {
                    identifiers: {
                        externalId: String(userResponse.data.id),
                        user: userId,
                    },
                    details: {},
                };
            } catch (error: any) {
                throw new Error(
                    `Failed to get Clio credential details: ${error.message}`,
                );
            }
        },

        testAuthRequest: async (api: Api) => api.getUser(),

        setAuthParams: async (api: Api, params: { region?: ClioRegion }) => {
            if (params.region) {
                api.setRegion(params.region);
            }
            return { region: api.region };
        },
    },

    env: {
        client_id: process.env.CLIO_CLIENT_ID,
        client_secret: process.env.CLIO_CLIENT_SECRET,
        redirect_uri: `${process.env.REDIRECT_URI}/clio`,
        // Note: Clio scopes are configured directly in the Developer Portal, not via OAuth scope.
    },
};

export { Definition };
