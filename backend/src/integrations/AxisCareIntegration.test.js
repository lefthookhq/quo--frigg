/**
 * Jest test for refactored AxisCareIntegration
 * Tests that the integration properly extends BaseCRMIntegration
 */

// Mock BaseCRMIntegration before importing
jest.mock('../base/BaseCRMIntegration', () => {
    return {
        BaseCRMIntegration: class MockBaseCRMIntegration {
            constructor() {
                this.events = {
                    INITIAL_SYNC: { handler: jest.fn() },
                    ONGOING_SYNC: { handler: jest.fn() },
                    WEBHOOK_RECEIVED: { handler: jest.fn() },
                    FETCH_PERSON_PAGE: { handler: jest.fn() },
                    PROCESS_PERSON_BATCH: { handler: jest.fn() },
                    COMPLETE_SYNC: { handler: jest.fn() },
                    LOG_CALL: { handler: jest.fn() },
                };
            }
        },
    };
});

const AxisCareIntegration = require('./AxisCareIntegration');

describe('AxisCareIntegration', () => {
    let integration;
    let mockAxisCareApi;
    let mockQuoApi;

    beforeEach(() => {
        // Mock Date.now() for deterministic externalId testing
        jest.spyOn(Date, 'now').mockReturnValue(1640000000000); // Fixed timestamp

        mockAxisCareApi = {
            api: {
                clients: {
                    getAll: jest.fn(),
                    get: jest.fn(),
                },
                appointments: {
                    getAll: jest.fn(),
                },
                services: {
                    getAll: jest.fn(),
                },
                communications: {
                    create: jest.fn(),
                },
                reports: {
                    get: jest.fn(),
                },
                listClients: jest.fn(),
                getClient: jest.fn(),
                getFromUrl: jest.fn(),
            },
        };

        mockQuoApi = {
            api: {
                upsertContact: jest.fn(),
                logActivity: jest.fn(),
            },
        };

        integration = new AxisCareIntegration();
        // Using camelCase 'axisCare' per Definition (AxisCareIntegration.js:27)
        integration.axisCare = mockAxisCareApi;
        integration.quo = mockQuoApi;
        integration.id = 'test-integration-id';
        integration.userId = 'test-user-id';

        // Mock managers for pagination tests
        integration.processManager = {
            getMetadata: jest.fn(),
            updateMetadata: jest.fn(),
            updateState: jest.fn(),
            updateTotal: jest.fn(),
            handleError: jest.fn(),
        };
        integration.queueManager = {
            queueFetchPersonPage: jest.fn(),
            queueProcessPersonBatch: jest.fn(),
            queueCompleteSync: jest.fn(),
        };
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Static Configuration', () => {
        it('should have correct Definition', () => {
            expect(AxisCareIntegration.Definition.name).toBe('axisCare');
            expect(AxisCareIntegration.Definition.display.label).toBe(
                'AxisCare',
            );
        });

        it('should have quo module with correct name and label overrides', () => {
            expect(AxisCareIntegration.Definition.modules.quo).toBeDefined();
            expect(
                AxisCareIntegration.Definition.modules.quo.definition,
            ).toBeDefined();

            // Test name override
            expect(
                AxisCareIntegration.Definition.modules.quo.definition.getName(),
            ).toBe('quo-axisCare');
            expect(
                AxisCareIntegration.Definition.modules.quo.definition
                    .moduleName,
            ).toBe('quo-axisCare');

            // Test label override (if display property exists)
            if (AxisCareIntegration.Definition.modules.quo.definition.display) {
                expect(
                    AxisCareIntegration.Definition.modules.quo.definition
                        .display.label,
                ).toBe('Quo (AxisCare)');
            }
        });

        it('should have correct CRMConfig', () => {
            expect(
                AxisCareIntegration.CRMConfig.personObjectTypes,
            ).toHaveLength(4);
            expect(
                AxisCareIntegration.CRMConfig.personObjectTypes[0]
                    .crmObjectName,
            ).toBe('Client');
            expect(
                AxisCareIntegration.CRMConfig.personObjectTypes[1]
                    .crmObjectName,
            ).toBe('Lead');
            expect(
                AxisCareIntegration.CRMConfig.personObjectTypes[2]
                    .crmObjectName,
            ).toBe('Caregiver');
            expect(
                AxisCareIntegration.CRMConfig.personObjectTypes[3]
                    .crmObjectName,
            ).toBe('Applicant');
            expect(
                AxisCareIntegration.CRMConfig.syncConfig.supportsWebhooks,
            ).toBe(true);
        });
    });

    describe('Required Methods', () => {
        describe('fetchPersonPage', () => {
            it('should fetch clients page correctly', async () => {
                const mockResponse = {
                    results: {
                        clients: [
                            { id: 1, firstName: 'John', lastName: 'Doe' },
                        ],
                    },
                };

                mockAxisCareApi.api.listClients.mockResolvedValue(mockResponse);

                const result = await integration.fetchPersonPage({
                    objectType: 'Client',
                    cursor: null,
                    limit: 10,
                    sortDesc: true,
                });

                expect(result.data).toHaveLength(1);
                expect(result.data[0].objectType).toBe('Client');
                expect(result.cursor).toBe(null);
                expect(result.hasMore).toBe(false);
            });
        });

        describe('transformPersonToQuo', () => {
            it('should transform AxisCare client to Quo format', async () => {
                const client = {
                    id: 123,
                    firstName: 'John',
                    lastName: 'Doe',
                    personalEmail: 'john@example.com',
                    homePhone: '555-1234',
                    mobilePhone: '555-5678',
                    status: 'active',
                    dateOfBirth: '1950-01-01',
                    residentialAddress: '123 Main St',
                    objectType: 'Client',
                };

                const result = await integration.transformPersonToQuo(client);

                expect(result.externalId).toBe('123');
                expect(result.source).toBe('axiscare');
                expect(result.defaultFields.firstName).toBe('John');
                expect(result.defaultFields.lastName).toBe('Doe');
                expect(result.defaultFields.phoneNumbers).toHaveLength(2);
                expect(result.defaultFields.emails).toHaveLength(1);
                expect(result.customFields).toEqual([]);
                expect(result.sourceEntityType).toBe('client');
            });
        });

        describe('setupWebhooks', () => {
            it('should setup Quo webhooks', async () => {
                // Mock _fetchAndStoreEnabledPhoneIds (inherited from BaseCRMIntegration)
                integration._fetchAndStoreEnabledPhoneIds = jest
                    .fn()
                    .mockResolvedValue(['phone-id-1', 'phone-id-2']);

                // Mock the Quo API webhook creation
                mockQuoApi.api.createCallWebhook = jest.fn().mockResolvedValue({
                    data: {
                        id: 'call-webhook-123',
                        key: 'call-webhook-key',
                    },
                });
                mockQuoApi.api.createCallSummaryWebhook = jest
                    .fn()
                    .mockResolvedValue({
                        data: {
                            id: 'callsummary-webhook-123',
                            key: 'callsummary-webhook-key',
                        },
                    });

                // Mock commands.updateIntegrationConfig
                integration.commands.updateIntegrationConfig = jest
                    .fn()
                    .mockResolvedValue({});

                // Set BASE_URL for webhook URL generation
                process.env.BASE_URL = 'https://test.com';

                const result = await integration.setupWebhooks();

                expect(result.overallStatus).toBe('success');
                expect(result.quo.status).toBe('configured');
                expect(
                    integration._fetchAndStoreEnabledPhoneIds,
                ).toHaveBeenCalled();
                expect(mockQuoApi.api.createCallWebhook).toHaveBeenCalled();
                expect(
                    mockQuoApi.api.createCallSummaryWebhook,
                ).toHaveBeenCalled();

                // Cleanup
                delete process.env.BASE_URL;
            });
        });
    });

    describe('Backward Compatibility', () => {
        it('should have LIST_AXISCARE_CLIENTS event', () => {
            expect(integration.events.LIST_AXISCARE_CLIENTS).toBeDefined();
        });
    });

    describe('updatePhoneMapping', () => {
        let mockReq;
        let mockRes;

        beforeEach(() => {
            mockRes = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };
            integration.commands = {
                updateIntegrationConfig: jest.fn().mockResolvedValue({}),
            };
            integration.config = {};
        });

        it('should have UPDATE_PHONE_MAPPING event registered', () => {
            expect(integration.events.UPDATE_PHONE_MAPPING).toBeDefined();
            expect(integration.events.UPDATE_PHONE_MAPPING.handler).toBe(
                integration.updatePhoneMapping,
            );
        });

        it('should return 400 when phoneNumberSiteMappings is missing', async () => {
            mockReq = { body: {} };

            await integration.updatePhoneMapping({ req: mockReq, res: mockRes });

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: 'phoneNumberSiteMappings is required',
            });
        });

        it('should return 400 when phoneNumberSiteMappings is an array', async () => {
            mockReq = { body: { phoneNumberSiteMappings: [] } };

            await integration.updatePhoneMapping({ req: mockReq, res: mockRes });

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: 'phoneNumberSiteMappings must be an object',
            });
        });

        it('should return 400 when mapping is missing axisCareSiteNumber', async () => {
            mockReq = {
                body: {
                    phoneNumberSiteMappings: {
                        '256787567092': { label: 'Test Site' },
                    },
                },
            };

            await integration.updatePhoneMapping({ req: mockReq, res: mockRes });

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: "axisCareSiteNumber is required for phone number '256787567092'",
            });
        });

        it('should return 400 when mapping is missing label', async () => {
            mockReq = {
                body: {
                    phoneNumberSiteMappings: {
                        '256787567092': { axisCareSiteNumber: 'demomark' },
                    },
                },
            };

            await integration.updatePhoneMapping({ req: mockReq, res: mockRes });

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: "label is required for phone number '256787567092'",
            });
        });

        it('should store phone mappings and return success (no Quo API)', async () => {
            // When Quo API is not available, webhook sync is skipped
            integration.quo = null;

            mockReq = {
                body: {
                    phoneNumberSiteMappings: {
                        '256787567092': {
                            axisCareSiteNumber: 'demomark',
                            label: 'Demo Mark Site',
                        },
                    },
                },
            };

            await integration.updatePhoneMapping({ req: mockReq, res: mockRes });

            expect(
                integration.commands.updateIntegrationConfig,
            ).toHaveBeenCalledWith({
                integrationId: 'test-integration-id',
                config: expect.objectContaining({
                    phoneNumberSiteMappings: {
                        '256787567092': {
                            axisCareSiteNumber: 'demomark',
                            label: 'Demo Mark Site',
                        },
                    },
                }),
            });
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                message: 'Phone mappings updated successfully',
                mappingsCount: 1,
                updatedMappings: ['256787567092'],
                webhookSync: {
                    status: 'skipped',
                    reason: 'quo_api_not_available',
                },
            });
        });

        it('should trigger webhook sync when Quo API is available', async () => {
            // Mock Quo API
            integration.quo = {
                api: {
                    listPhoneNumbers: jest.fn().mockResolvedValue({ data: [] }),
                },
            };

            // Mock the webhook management method to avoid full execution
            integration._managePhoneWebhookSubscriptions = jest
                .fn()
                .mockResolvedValue({
                    status: 'no_phones',
                    subscriptions: { call: [], callSummary: [] },
                });

            mockReq = {
                body: {
                    phoneNumberSiteMappings: {
                        '256787567092': {
                            axisCareSiteNumber: 'demomark',
                            label: 'Demo Mark Site',
                        },
                    },
                },
            };

            await integration.updatePhoneMapping({ req: mockReq, res: mockRes });

            expect(
                integration._managePhoneWebhookSubscriptions,
            ).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    webhookSync: {
                        status: 'no_phones',
                        subscriptions: { call: [], callSummary: [] },
                    },
                }),
            );
        });

        it('should handle webhook sync failures gracefully', async () => {
            integration.quo = {
                api: {
                    listPhoneNumbers: jest.fn().mockResolvedValue({ data: [] }),
                },
            };

            integration._managePhoneWebhookSubscriptions = jest
                .fn()
                .mockRejectedValue(new Error('Webhook creation failed'));

            mockReq = {
                body: {
                    phoneNumberSiteMappings: {
                        '256787567092': {
                            axisCareSiteNumber: 'demomark',
                            label: 'Demo Mark Site',
                        },
                    },
                },
            };

            const consoleErrorSpy = jest
                .spyOn(console, 'error')
                .mockImplementation();

            await integration.updatePhoneMapping({ req: mockReq, res: mockRes });

            // Mappings should still be saved
            expect(
                integration.commands.updateIntegrationConfig,
            ).toHaveBeenCalled();

            // Response should indicate webhook sync failed
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    webhookSync: {
                        status: 'failed',
                        error: 'Webhook creation failed',
                    },
                }),
            );

            consoleErrorSpy.mockRestore();
        });

        it('should merge new mappings with existing mappings (PATCH semantics)', async () => {
            integration.quo = null; // Skip webhook sync for this test
            integration.config = {
                existingField: 'preserved',
                phoneNumberSiteMappings: {
                    '111111111': {
                        axisCareSiteNumber: 'existing',
                        label: 'Existing Site',
                    },
                },
            };

            mockReq = {
                body: {
                    phoneNumberSiteMappings: {
                        '256787567092': {
                            axisCareSiteNumber: 'demomark',
                            label: 'Demo Mark Site',
                        },
                    },
                },
            };

            await integration.updatePhoneMapping({ req: mockReq, res: mockRes });

            expect(
                integration.commands.updateIntegrationConfig,
            ).toHaveBeenCalledWith({
                integrationId: 'test-integration-id',
                config: {
                    existingField: 'preserved',
                    phoneNumberSiteMappings: {
                        '111111111': {
                            axisCareSiteNumber: 'existing',
                            label: 'Existing Site',
                        },
                        '256787567092': {
                            axisCareSiteNumber: 'demomark',
                            label: 'Demo Mark Site',
                        },
                    },
                },
            });
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    mappingsCount: 2,
                    updatedMappings: ['256787567092'],
                }),
            );
        });

        it('should return 500 when updateIntegrationConfig throws', async () => {
            integration.commands.updateIntegrationConfig = jest
                .fn()
                .mockRejectedValue(new Error('Database error'));

            mockReq = {
                body: {
                    phoneNumberSiteMappings: {
                        '256787567092': {
                            axisCareSiteNumber: 'demomark',
                            label: 'Demo Mark Site',
                        },
                    },
                },
            };

            await integration.updatePhoneMapping({ req: mockReq, res: mockRes });

            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: 'Failed to update phone mappings',
                details: 'Database error',
            });
        });
    });

    describe('fetchPersonsByIds', () => {
        it('should use bulk API call for efficiency', async () => {
            const ids = ['1', '2', '3', '4', '5'];
            const mockResponse = {
                results: {
                    clients: [
                        { id: 1, firstName: 'John' },
                        { id: 2, firstName: 'Jane' },
                        { id: 3, firstName: 'Bob' },
                        { id: 4, firstName: 'Alice' },
                        { id: 5, firstName: 'Charlie' },
                    ],
                },
            };

            mockAxisCareApi.api.listClients.mockResolvedValue(mockResponse);

            const result = await integration.fetchPersonsByIds(ids);

            expect(mockAxisCareApi.api.listClients).toHaveBeenCalledWith({
                clientIds: '1,2,3,4,5',
                limit: 5,
            });

            expect(result).toHaveLength(5);
            expect(result[0].firstName).toBe('John');
        });

        it('should fallback to sequential fetch if bulk fails', async () => {
            const ids = ['1', '2'];
            const bulkError = new Error('Bulk fetch not supported');

            mockAxisCareApi.api.listClients.mockRejectedValue(bulkError);
            mockAxisCareApi.api.getClient
                .mockResolvedValueOnce({ id: 1, firstName: 'John' })
                .mockResolvedValueOnce({ id: 2, firstName: 'Jane' });

            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

            const result = await integration.fetchPersonsByIds(ids);

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Bulk fetch failed'),
                expect.any(String),
            );

            expect(mockAxisCareApi.api.getClient).toHaveBeenCalledTimes(2);
            expect(result).toHaveLength(2);

            consoleSpy.mockRestore();
        });

        it('should return empty array for empty input', async () => {
            const result = await integration.fetchPersonsByIds([]);
            expect(result).toEqual([]);
        });

        it('should handle individual fetch failures gracefully', async () => {
            const ids = ['1', '2', '3'];

            mockAxisCareApi.api.listClients.mockRejectedValue(
                new Error('Bulk not supported'),
            );
            mockAxisCareApi.api.getClient
                .mockResolvedValueOnce({ id: 1, firstName: 'John' })
                .mockRejectedValueOnce(new Error('Not found'))
                .mockResolvedValueOnce({ id: 3, firstName: 'Bob' });

            const consoleErrorSpy = jest
                .spyOn(console, 'error')
                .mockImplementation();
            const consoleWarnSpy = jest
                .spyOn(console, 'warn')
                .mockImplementation();

            const result = await integration.fetchPersonsByIds(ids);

            expect(result).toHaveLength(2);
            expect(result[0].id).toBe(1);
            expect(result[1].id).toBe(3);

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Failed to fetch client 2'),
                expect.any(String),
            );

            consoleErrorSpy.mockRestore();
            consoleWarnSpy.mockRestore();
        });
    });

    describe('_syncPersonToQuo with upsertContactToQuo', () => {
        beforeEach(() => {
            mockQuoApi.api.createContact = jest.fn();
            mockQuoApi.api.updateContact = jest.fn();
            mockQuoApi.api.listContacts = jest.fn();
            integration.transformPersonToQuo = jest.fn();
        });

        it('should use upsertContactToQuo for created action', async () => {
            const person = {
                id: 123,
                firstName: 'John',
                lastName: 'Doe',
                cellPhone: '+15551234567',
            };

            const mockQuoContact = {
                externalId: '123',
                source: 'openphone-axiscare',
                defaultFields: {
                    firstName: 'John',
                    lastName: 'Doe',
                    phoneNumbers: [{ name: 'Mobile', value: '+15551234567' }],
                },
            };

            integration.transformPersonToQuo.mockResolvedValue(mockQuoContact);
            integration.upsertContactToQuo = jest.fn().mockResolvedValue({
                action: 'created',
                quoContactId: 'quo-contact-123',
                externalId: '123',
            });

            await integration._syncPersonToQuo(person, 'created');

            expect(integration.upsertContactToQuo).toHaveBeenCalledWith(
                expect.objectContaining({
                    externalId: '123',
                }),
            );
            expect(mockQuoApi.api.createContact).not.toHaveBeenCalled();
        });

        it('should handle upsertContactToQuo errors for created action', async () => {
            const person = { id: 456, firstName: 'Error', lastName: 'Test' };

            integration.transformPersonToQuo.mockResolvedValue({
                externalId: '456',
                defaultFields: { firstName: 'Error' },
            });
            integration.upsertContactToQuo = jest
                .fn()
                .mockRejectedValue(new Error('Failed to create contact'));

            await expect(
                integration._syncPersonToQuo(person, 'created'),
            ).rejects.toThrow('Failed to create contact');
        });

        it('should use upsertContactToQuo for updated action', async () => {
            const person = {
                id: 789,
                firstName: 'Jane',
                lastName: 'Smith',
                cellPhone: '+15559999999',
            };

            const mockQuoContact = {
                externalId: '789',
                defaultFields: {
                    firstName: 'Jane',
                    lastName: 'Smith',
                    phoneNumbers: [{ name: 'Mobile', value: '+15559999999' }],
                },
            };

            integration.transformPersonToQuo.mockResolvedValue(mockQuoContact);
            integration.upsertContactToQuo = jest.fn().mockResolvedValue({
                action: 'updated',
                quoContactId: 'quo-contact-789',
                externalId: '789',
            });

            await integration._syncPersonToQuo(person, 'updated');

            expect(integration.upsertContactToQuo).toHaveBeenCalledWith(
                expect.objectContaining({
                    externalId: '789',
                }),
            );
            expect(mockQuoApi.api.updateContact).not.toHaveBeenCalled();
        });

        it('should handle upsertContactToQuo errors for updated action', async () => {
            const person = { id: 999, firstName: 'Update', lastName: 'Error' };

            integration.transformPersonToQuo.mockResolvedValue({
                externalId: '999',
                defaultFields: { firstName: 'Update' },
            });
            integration.upsertContactToQuo = jest
                .fn()
                .mockRejectedValue(new Error('Contact update failed'));

            await expect(
                integration._syncPersonToQuo(person, 'updated'),
            ).rejects.toThrow('Contact update failed');
        });
    });

    describe('_chunkArray', () => {
        it('should split array into chunks of specified size', () => {
            const array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
            const result = integration._chunkArray(array, 5);

            expect(result).toHaveLength(3);
            expect(result[0]).toEqual([1, 2, 3, 4, 5]);
            expect(result[1]).toEqual([6, 7, 8, 9, 10]);
            expect(result[2]).toEqual([11, 12]);
        });

        it('should return single chunk when array is smaller than chunk size', () => {
            const array = [1, 2, 3];
            const result = integration._chunkArray(array, 10);

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual([1, 2, 3]);
        });

        it('should return empty array for empty input', () => {
            const result = integration._chunkArray([], 10);
            expect(result).toEqual([]);
        });

        it('should handle exact chunk size divisions', () => {
            const array = [1, 2, 3, 4, 5, 6];
            const result = integration._chunkArray(array, 2);

            expect(result).toHaveLength(3);
            expect(result[0]).toEqual([1, 2]);
            expect(result[1]).toEqual([3, 4]);
            expect(result[2]).toEqual([5, 6]);
        });
    });

    describe('_resolvePhoneToQuoId', () => {
        it('should find phone ID from metadata with exact match', () => {
            integration.config = {
                phoneNumbersMetadata: [
                    { id: 'phone-1', phoneNumber: '+15551234567' },
                    { id: 'phone-2', phoneNumber: '+15559876543' },
                ],
            };

            const result = integration._resolvePhoneToQuoId('+15551234567');
            expect(result).toBe('phone-1');
        });

        it('should normalize phone numbers for matching', () => {
            integration.config = {
                phoneNumbersMetadata: [
                    { id: 'phone-1', phoneNumber: '+15551234567' },
                ],
            };

            // Test with different formats
            expect(integration._resolvePhoneToQuoId('(555) 123-4567')).toBe(
                'phone-1',
            );
            expect(integration._resolvePhoneToQuoId('555-123-4567')).toBe(
                'phone-1',
            );
            expect(integration._resolvePhoneToQuoId('5551234567')).toBe(
                'phone-1',
            );
        });

        it('should return null when phone not found', () => {
            integration.config = {
                phoneNumbersMetadata: [
                    { id: 'phone-1', phoneNumber: '+15551234567' },
                ],
            };

            const result = integration._resolvePhoneToQuoId('+19999999999');
            expect(result).toBeNull();
        });

        it('should handle missing metadata gracefully', () => {
            integration.config = {};
            const result = integration._resolvePhoneToQuoId('+15551234567');
            expect(result).toBeNull();
        });
    });

    describe('_planSubscriptionOperations', () => {
        it('should plan creates for new chunks', () => {
            const requiredChunks = [['phone-1', 'phone-2'], ['phone-3']];
            const existingSubs = [];

            const result = integration._planSubscriptionOperations(
                requiredChunks,
                existingSubs,
            );

            expect(result.create).toHaveLength(2);
            expect(result.create[0]).toEqual({
                phoneIds: ['phone-1', 'phone-2'],
                chunkIndex: 0,
            });
            expect(result.create[1]).toEqual({
                phoneIds: ['phone-3'],
                chunkIndex: 1,
            });
            expect(result.update).toHaveLength(0);
            expect(result.delete).toHaveLength(0);
        });

        it('should plan updates for changed chunks', () => {
            const requiredChunks = [['phone-1', 'phone-2', 'phone-3']];
            const existingSubs = [
                {
                    webhookId: 'wh-1',
                    webhookKey: 'key-1',
                    phoneIds: ['phone-1', 'phone-2'],
                    chunkIndex: 0,
                },
            ];

            const result = integration._planSubscriptionOperations(
                requiredChunks,
                existingSubs,
            );

            expect(result.update).toHaveLength(1);
            expect(result.update[0]).toEqual({
                webhookId: 'wh-1',
                webhookKey: 'key-1',
                phoneIds: ['phone-1', 'phone-2', 'phone-3'],
                chunkIndex: 0,
            });
            expect(result.create).toHaveLength(0);
            expect(result.delete).toHaveLength(0);
        });

        it('should plan deletes for orphaned subscriptions', () => {
            const requiredChunks = [['phone-1']];
            const existingSubs = [
                {
                    webhookId: 'wh-1',
                    phoneIds: ['phone-1'],
                    chunkIndex: 0,
                },
                {
                    webhookId: 'wh-2',
                    phoneIds: ['phone-2'],
                    chunkIndex: 1,
                },
            ];

            const result = integration._planSubscriptionOperations(
                requiredChunks,
                existingSubs,
            );

            expect(result.keep).toHaveLength(1);
            expect(result.delete).toHaveLength(1);
            expect(result.delete[0]).toEqual({
                webhookId: 'wh-2',
                reason: 'chunk_no_longer_needed',
            });
        });

        it('should keep unchanged subscriptions', () => {
            const requiredChunks = [['phone-1', 'phone-2']];
            const existingSubs = [
                {
                    webhookId: 'wh-1',
                    phoneIds: ['phone-1', 'phone-2'],
                    chunkIndex: 0,
                },
            ];

            const result = integration._planSubscriptionOperations(
                requiredChunks,
                existingSubs,
            );

            expect(result.keep).toHaveLength(1);
            expect(result.create).toHaveLength(0);
            expect(result.update).toHaveLength(0);
            expect(result.delete).toHaveLength(0);
        });
    });

    describe('syncPhoneWebhooks', () => {
        let mockReq;
        let mockRes;

        beforeEach(() => {
            mockRes = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn(),
            };
            mockReq = { body: {} };
        });

        it('should have SYNC_PHONE_WEBHOOKS event registered', () => {
            expect(integration.events.SYNC_PHONE_WEBHOOKS).toBeDefined();
            expect(integration.events.SYNC_PHONE_WEBHOOKS.handler).toBe(
                integration.syncPhoneWebhooks,
            );
        });

        it('should return 503 when Quo API is not available', async () => {
            integration.quo = null;

            await integration.syncPhoneWebhooks({ req: mockReq, res: mockRes });

            expect(mockRes.status).toHaveBeenCalledWith(503);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: 'Quo API not available',
                message: expect.stringContaining('Quo module'),
            });
        });

        it('should return success with empty subscriptions when no mappings', async () => {
            integration.quo = { api: {} };
            integration.config = {};

            await integration.syncPhoneWebhooks({ req: mockReq, res: mockRes });

            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                message: 'No phone mappings configured - nothing to sync',
                subscriptions: { call: [], callSummary: [] },
            });
        });

        it('should call _managePhoneWebhookSubscriptions and return results', async () => {
            integration.quo = { api: {} };
            integration.config = {
                phoneNumberSiteMappings: {
                    '5551234567': {
                        axisCareSiteNumber: 'demo',
                        label: 'Demo',
                    },
                },
            };

            integration._managePhoneWebhookSubscriptions = jest
                .fn()
                .mockResolvedValue({
                    status: 'success',
                    subscriptions: {
                        call: [
                            {
                                webhookId: 'wh-call-1',
                                chunkIndex: 0,
                                phoneIds: ['phone-1'],
                            },
                        ],
                        callSummary: [
                            {
                                webhookId: 'wh-summary-1',
                                chunkIndex: 0,
                                phoneIds: ['phone-1'],
                            },
                        ],
                    },
                });

            const consoleLogSpy = jest
                .spyOn(console, 'log')
                .mockImplementation();

            await integration.syncPhoneWebhooks({ req: mockReq, res: mockRes });

            expect(
                integration._managePhoneWebhookSubscriptions,
            ).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    status: 'success',
                    totalCallWebhooks: 1,
                    totalCallSummaryWebhooks: 1,
                }),
            );

            consoleLogSpy.mockRestore();
        });

        it('should return 500 when webhook sync fails', async () => {
            integration.quo = { api: {} };
            integration.config = {
                phoneNumberSiteMappings: {
                    '5551234567': {
                        axisCareSiteNumber: 'demo',
                        label: 'Demo',
                    },
                },
            };

            integration._managePhoneWebhookSubscriptions = jest
                .fn()
                .mockRejectedValue(new Error('API rate limit exceeded'));

            const consoleErrorSpy = jest
                .spyOn(console, 'error')
                .mockImplementation();
            const consoleLogSpy = jest
                .spyOn(console, 'log')
                .mockImplementation();

            await integration.syncPhoneWebhooks({ req: mockReq, res: mockRes });

            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: 'Failed to sync phone webhooks',
                details: 'API rate limit exceeded',
            });

            consoleErrorSpy.mockRestore();
            consoleLogSpy.mockRestore();
        });
    });

    describe('MAX_RESOURCE_IDS_PER_WEBHOOK constant', () => {
        it('should be defined as 10', () => {
            const AxisCareIntegration = require('./AxisCareIntegration');
            expect(AxisCareIntegration.MAX_RESOURCE_IDS_PER_WEBHOOK).toBe(10);
        });
    });
});
