const { Api } = require('../src/api-modules/quo/api');
const { Definition } = require('../src/api-modules/quo/definition');

describe('Quo API Module - API Key Authentication', () => {
    describe('Api class', () => {
        describe('constructor', () => {
            it('should extend ApiKeyRequester', () => {
                const { ApiKeyRequester } = require('@friggframework/core');
                const api = new Api({});
                expect(api).toBeInstanceOf(ApiKeyRequester);
            });

            it('should set baseUrl correctly', () => {
                const api = new Api({});
                expect(api.baseUrl).toBe(
                    'https://dev-public-api.openphone.dev',
                );
            });

            it('should set api_key_name to Authorization', () => {
                const api = new Api({});
                // frigg framework uses snake_case (api_key_name, not API_KEY_NAME)
                expect(api.api_key_name).toBe('Authorization');
            });

            it('should NOT reference access_token in constructor', () => {
                // API key should be passed as api_key or apiKey, not access_token
                const api = new Api({ api_key: 'test-key' });
                expect(api.API_KEY_VALUE).toBe('test-key');
                expect(api.access_token).toBeUndefined();
            });

            it('should accept apiKey parameter and set API_KEY_VALUE', () => {
                const testKey = 'test-api-key-123';
                const api = new Api({ api_key: testKey });
                expect(api.API_KEY_VALUE).toBe(testKey);
            });

            it('should call setApiKey if api_key is provided', () => {
                const testKey = 'test-api-key-456';
                const api = new Api({ api_key: testKey });
                expect(api.API_KEY_VALUE).toBe(testKey);
            });

            it('should not set API_KEY_VALUE if no api_key provided', () => {
                const api = new Api({});
                expect(api.API_KEY_VALUE).toBeNull();
            });
        });

        describe('setApiKey', () => {
            it('should set API_KEY_VALUE correctly', () => {
                const api = new Api({});
                const testKey = 'new-api-key-789';
                api.setApiKey(testKey);
                expect(api.API_KEY_VALUE).toBe(testKey);
            });

            it('should update API_KEY_VALUE when called multiple times', () => {
                const api = new Api({ api_key: 'initial-key' });
                expect(api.API_KEY_VALUE).toBe('initial-key');

                api.setApiKey('updated-key');
                expect(api.API_KEY_VALUE).toBe('updated-key');
            });
        });

        describe('isAuthenticated', () => {
            it('should return false when API_KEY_VALUE is null', () => {
                const api = new Api({});
                expect(api.isAuthenticated()).toBe(false);
            });

            it('should return false when API_KEY_VALUE is undefined', () => {
                const api = new Api({});
                api.API_KEY_VALUE = undefined;
                expect(api.isAuthenticated()).toBe(false);
            });

            it('should return false when API_KEY_VALUE is empty string', () => {
                const api = new Api({});
                api.setApiKey('');
                expect(api.isAuthenticated()).toBe(false);
            });

            it('should return false when API_KEY_VALUE is whitespace only', () => {
                const api = new Api({});
                api.setApiKey('   ');
                expect(api.isAuthenticated()).toBe(false);
            });

            it('should return true when API_KEY_VALUE is set with valid key', () => {
                const api = new Api({ api_key: 'valid-api-key' });
                expect(api.isAuthenticated()).toBe(true);
            });
        });

        describe('addAuthHeaders', () => {
            it('should add Authorization header when authenticated', async () => {
                const api = new Api({ api_key: 'test-key-123' });
                const headers = {};
                const result = await api.addAuthHeaders(headers);

                expect(result.Authorization).toBe('test-key-123');
            });

            it('should not add Authorization header when not authenticated', async () => {
                const api = new Api({});
                const headers = {};
                const result = await api.addAuthHeaders(headers);

                expect(result.Authorization).toBeUndefined();
            });

            it('should preserve existing headers', async () => {
                const api = new Api({ api_key: 'test-key-123' });
                const headers = { 'Content-Type': 'application/json' };
                const result = await api.addAuthHeaders(headers);

                expect(result['Content-Type']).toBe('application/json');
                expect(result.Authorization).toBe('test-key-123');
            });
        });
    });

    describe('Definition object', () => {
        it('should have correct API reference', () => {
            expect(Definition.API).toBe(Api);
        });

        it('should have correct module name', () => {
            expect(Definition.moduleName).toBe('quo');
            expect(Definition.getName()).toBe('quo');
        });

        it('should have correct model name', () => {
            expect(Definition.modelName).toBe('Quo');
        });

        describe('requiredAuthMethods', () => {
            describe('getAuthorizationRequirements', () => {
                it('should return type apiKey', () => {
                    const api = new Api({});
                    const result =
                        Definition.requiredAuthMethods.getAuthorizationRequirements(
                            api,
                        );

                    expect(result.type).toBe('apiKey');
                });

                it('should have jsonSchema with apiKey property', () => {
                    const api = new Api({});
                    const result =
                        Definition.requiredAuthMethods.getAuthorizationRequirements(
                            api,
                        );

                    expect(
                        result.data.jsonSchema.properties.apiKey,
                    ).toBeDefined();
                    expect(result.data.jsonSchema.required).toContain('apiKey');
                });

                it('should have uiSchema with password widget', () => {
                    const api = new Api({});
                    const result =
                        Definition.requiredAuthMethods.getAuthorizationRequirements(
                            api,
                        );

                    expect(result.data.uiSchema.apiKey['ui:widget']).toBe(
                        'password',
                    );
                });
            });

            describe('getToken', () => {
                it('should extract apiKey from params.data', async () => {
                    const api = new Api({});
                    const params = { data: { apiKey: 'test-key-123' } };

                    const result =
                        await Definition.requiredAuthMethods.getToken(
                            api,
                            params,
                        );

                    expect(result.api_key).toBe('test-key-123');
                });

                it('should throw error if apiKey is missing', async () => {
                    const api = new Api({});
                    const params = { data: {} };

                    await expect(
                        Definition.requiredAuthMethods.getToken(api, params),
                    ).rejects.toThrow('API key is required');
                });

                it('should NOT return access_token', async () => {
                    const api = new Api({});
                    const params = { data: { apiKey: 'test-key-123' } };

                    const result =
                        await Definition.requiredAuthMethods.getToken(
                            api,
                            params,
                        );

                    expect(result.access_token).toBeUndefined();
                    expect(result.api_key).toBe('test-key-123');
                });
            });

            describe('setAuthParams', () => {
                it('should set API key on API instance', async () => {
                    const api = new Api({});
                    const params = { apiKey: 'test-key-789' };

                    await Definition.requiredAuthMethods.setAuthParams(
                        api,
                        params,
                    );

                    expect(api.API_KEY_VALUE).toBe('test-key-789');
                });

                it('should return api_key in response', async () => {
                    const api = new Api({});
                    const params = { apiKey: 'test-key-789' };

                    const result =
                        await Definition.requiredAuthMethods.setAuthParams(
                            api,
                            params,
                        );

                    expect(result.api_key).toBe('test-key-789');
                });

                it('should throw error if apiKey is missing', async () => {
                    const api = new Api({});
                    const params = {};

                    await expect(
                        Definition.requiredAuthMethods.setAuthParams(
                            api,
                            params,
                        ),
                    ).rejects.toThrow('API key is required');
                });
            });

            describe('getEntityDetails', () => {
                it('should return hashed externalId based on API key', async () => {
                    const api = new Api({ api_key: 'test-key-123' });
                    const tokenResponse = { api_key: 'test-key-123' };
                    const userId = 'user-123';

                    const result =
                        await Definition.requiredAuthMethods.getEntityDetails(
                            api,
                            {},
                            tokenResponse,
                            userId,
                        );

                    expect(result.identifiers.externalId).toBeDefined();
                    expect(typeof result.identifiers.externalId).toBe('string');
                    expect(result.identifiers.externalId.length).toBe(64); // SHA256 hash length
                    expect(result.identifiers.user).toBe(userId);
                });

                it('should have consistent hash for same API key', async () => {
                    const api = new Api({ api_key: 'test-key-123' });
                    const tokenResponse = { api_key: 'test-key-123' };
                    const userId = 'user-123';

                    const result1 =
                        await Definition.requiredAuthMethods.getEntityDetails(
                            api,
                            {},
                            tokenResponse,
                            userId,
                        );

                    const result2 =
                        await Definition.requiredAuthMethods.getEntityDetails(
                            api,
                            {},
                            tokenResponse,
                            userId,
                        );

                    expect(result1.identifiers.externalId).toBe(
                        result2.identifiers.externalId,
                    );
                });

                it('should return proper details structure', async () => {
                    const api = new Api({ api_key: 'test-key-123' });
                    const tokenResponse = { api_key: 'test-key-123' };
                    const userId = 'user-123';

                    const result =
                        await Definition.requiredAuthMethods.getEntityDetails(
                            api,
                            {},
                            tokenResponse,
                            userId,
                        );

                    expect(result.details).toBeDefined();
                    expect(result.details.name).toBe(
                        'Quo Workspace (API Key Hash)',
                    );
                });
            });

            describe('getCredentialDetails', () => {
                it('should return hashed externalId from API instance', async () => {
                    const api = new Api({ api_key: 'test-key-456' });
                    const userId = 'user-456';

                    const result =
                        await Definition.requiredAuthMethods.getCredentialDetails(
                            api,
                            userId,
                        );

                    expect(result.identifiers.externalId).toBeDefined();
                    expect(typeof result.identifiers.externalId).toBe('string');
                    expect(result.identifiers.externalId.length).toBe(64);
                    expect(result.identifiers.user).toBe(userId);
                });

                it('should throw error if API key is not set', async () => {
                    const api = new Api({});
                    const userId = 'user-456';

                    await expect(
                        Definition.requiredAuthMethods.getCredentialDetails(
                            api,
                            userId,
                        ),
                    ).rejects.toThrow('API key is required');
                });
            });

            describe('testAuthRequest', () => {
                it('should skip actual API test due to propagation delay', async () => {
                    const api = new Api({ api_key: 'test-key-123' });

                    const result =
                        await Definition.requiredAuthMethods.testAuthRequest(
                            api,
                        );

                    expect(result.status).toBe('success');
                    expect(result.message).toContain('API key propagation');
                });
            });

            describe('apiPropertiesToPersist', () => {
                it('should persist api_key in credential', () => {
                    const props =
                        Definition.requiredAuthMethods.apiPropertiesToPersist;

                    expect(props.credential).toContain('api_key');
                    expect(props.credential).not.toContain('access_token');
                });

                it('should have empty entity array', () => {
                    const props =
                        Definition.requiredAuthMethods.apiPropertiesToPersist;

                    expect(props.entity).toEqual([]);
                });
            });
        });

        describe('env', () => {
            it('should have empty env object', () => {
                expect(Definition.env).toEqual({});
            });
        });
    });
});
