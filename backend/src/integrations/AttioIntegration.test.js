/**
 * Jest test for refactored AttioIntegration
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
                    LOG_SMS: { handler: jest.fn() },
                    LOG_CALL: { handler: jest.fn() },
                };
            }
        },
    };
});

const AttioIntegration = require('./AttioIntegration.refactored');

describe('AttioIntegration (Refactored)', () => {
    let integration;
    let mockAttioApi;
    let mockQuoApi;

    beforeEach(() => {
        // Create mock APIs
        mockAttioApi = {
            api: {
                objects: {
                    list: jest.fn(),
                    listRecords: jest.fn(),
                    getRecord: jest.fn(),
                    createRecord: jest.fn(),
                },
                workspaces: {
                    list: jest.fn(),
                },
                notes: {
                    create: jest.fn(),
                },
                webhooks: {
                    create: jest.fn(),
                },
                search: jest.fn(),
            },
        };

        mockQuoApi = {
            api: {
                upsertContact: jest.fn(),
                logActivity: jest.fn(),
            },
        };

        // Create integration instance
        integration = new AttioIntegration();
        integration.attio = mockAttioApi;
        integration.quo = mockQuoApi;
        integration.id = 'test-integration-id';
        integration.userId = 'test-user-id';
    });

    describe('Static Configuration', () => {
        it('should have correct Definition', () => {
            expect(AttioIntegration.Definition).toBeDefined();
            expect(AttioIntegration.Definition.name).toBe('attio');
            expect(AttioIntegration.Definition.version).toBe('1.0.0');
            expect(AttioIntegration.Definition.display.label).toBe('Attio');
        });

        it('should have correct CRMConfig', () => {
            expect(AttioIntegration.CRMConfig).toBeDefined();
            expect(AttioIntegration.CRMConfig.personObjectTypes).toHaveLength(1);
            expect(AttioIntegration.CRMConfig.personObjectTypes[0].crmObjectName).toBe('people');
            expect(AttioIntegration.CRMConfig.syncConfig.supportsWebhooks).toBe(true);
            expect(AttioIntegration.CRMConfig.syncConfig.initialBatchSize).toBe(50);
        });

        it('should have queue configuration', () => {
            expect(AttioIntegration.CRMConfig.queueConfig).toBeDefined();
            expect(AttioIntegration.CRMConfig.queueConfig.maxWorkers).toBe(15);
            expect(AttioIntegration.CRMConfig.queueConfig.provisioned).toBe(5);
        });
    });

    describe('Required Methods - BaseCRMIntegration', () => {
        describe('fetchPersonPage', () => {
            it('should fetch people page correctly', async () => {
                const mockResponse = {
                    data: [
                        {
                            id: { record_id: 'rec1', object_id: 'people' },
                            values: {
                                name: [{ first_name: 'John', last_name: 'Doe' }],
                                email_addresses: [
                                    { email_address: 'john@example.com', is_primary: true, attribute_type: 'work' }
                                ],
                            },
                            created_at: '2025-01-01T00:00:00Z',
                            updated_at: '2025-01-10T00:00:00Z',
                        },
                    ],
                    total: 1,
                    has_more: false,
                };

                mockAttioApi.api.objects.listRecords.mockResolvedValue(mockResponse);

                const result = await integration.fetchPersonPage({
                    objectType: 'people',
                    page: 0,
                    limit: 10,
                    sortDesc: true,
                });

                expect(result).toEqual({
                    data: mockResponse.data,
                    total: 1,
                    hasMore: false,
                });

                expect(mockAttioApi.api.objects.listRecords).toHaveBeenCalledWith('people', {
                    limit: 10,
                    offset: 0,
                    sort: {
                        attribute: 'updated_at',
                        direction: 'desc',
                    },
                });
            });

            it('should handle pagination with offset', async () => {
                const mockResponse = {
                    data: [],
                    total: 250,
                    has_more: true,
                };

                mockAttioApi.api.objects.listRecords.mockResolvedValue(mockResponse);

                await integration.fetchPersonPage({
                    objectType: 'people',
                    page: 2,
                    limit: 50,
                    sortDesc: false,
                });

                expect(mockAttioApi.api.objects.listRecords).toHaveBeenCalledWith('people', {
                    limit: 50,
                    offset: 100, // Page 2 * limit 50
                    sort: {
                        attribute: 'updated_at',
                        direction: 'asc',
                    },
                });
            });

            it('should include modifiedSince filter when provided', async () => {
                const mockDate = new Date('2025-01-01T00:00:00Z');
                const mockResponse = {
                    data: [],
                    total: 0,
                    has_more: false,
                };

                mockAttioApi.api.objects.listRecords.mockResolvedValue(mockResponse);

                await integration.fetchPersonPage({
                    objectType: 'people',
                    page: 0,
                    limit: 10,
                    modifiedSince: mockDate,
                });

                expect(mockAttioApi.api.objects.listRecords).toHaveBeenCalledWith('people',
                    expect.objectContaining({
                        filter: {
                            attribute: 'updated_at',
                            gte: '2025-01-01T00:00:00.000Z',
                        },
                    })
                );
            });
        });

        describe('transformPersonToQuo', () => {
            it('should transform Attio person to Quo format', async () => {
                const attioPerson = {
                    id: { record_id: 'rec123', object_id: 'people' },
                    values: {
                        name: [{ first_name: 'John', last_name: 'Doe' }],
                        email_addresses: [
                            { email_address: 'john@example.com', is_primary: true, attribute_type: 'work' },
                            { email_address: 'john.doe@personal.com', is_primary: false, attribute_type: 'personal' },
                        ],
                        phone_numbers: [
                            { phone_number: '555-1234', is_primary: true, attribute_type: 'work' },
                            { phone_number: '555-5678', is_primary: false, attribute_type: 'mobile' },
                        ],
                        primary_company: [],
                    },
                    created_at: '2025-01-01T00:00:00Z',
                    updated_at: '2025-01-10T00:00:00Z',
                };

                const result = await integration.transformPersonToQuo(attioPerson);

                expect(result).toEqual({
                    externalId: 'rec123',
                    source: 'attio',
                    defaultFields: {
                        firstName: 'John',
                        lastName: 'Doe',
                        company: null,
                        phoneNumbers: [
                            { name: 'work', value: '555-1234', primary: true },
                            { name: 'mobile', value: '555-5678', primary: false },
                        ],
                        emails: [
                            { name: 'work', value: 'john@example.com', primary: true },
                            { name: 'personal', value: 'john.doe@personal.com', primary: false },
                        ],
                    },
                    customFields: {
                        crmId: 'rec123',
                        crmType: 'attio',
                        objectId: 'people',
                        createdAt: '2025-01-01T00:00:00Z',
                        updatedAt: '2025-01-10T00:00:00Z',
                        attioAttributes: attioPerson.values,
                    },
                });
            });

            it('should fetch company name if primary_company is provided', async () => {
                const attioPerson = {
                    id: { record_id: 'rec123', object_id: 'people' },
                    values: {
                        name: [{ first_name: 'Jane', last_name: 'Smith' }],
                        email_addresses: [],
                        phone_numbers: [],
                        primary_company: [{ target_record_id: 'comp123' }],
                    },
                    created_at: '2025-01-01T00:00:00Z',
                    updated_at: '2025-01-10T00:00:00Z',
                };

                const mockCompany = {
                    values: {
                        name: [{ value: 'Smith Industries' }],
                    },
                };

                mockAttioApi.api.objects.getRecord.mockResolvedValue(mockCompany);

                const result = await integration.transformPersonToQuo(attioPerson);

                expect(result.defaultFields.company).toBe('Smith Industries');
                expect(mockAttioApi.api.objects.getRecord).toHaveBeenCalledWith('companies', 'comp123');
            });

            it('should handle minimal person data', async () => {
                const minimalPerson = {
                    id: { record_id: 'rec123', object_id: 'people' },
                    values: {
                        name: [{ first_name: 'Test', last_name: 'User' }],
                    },
                    created_at: '2025-01-01T00:00:00Z',
                    updated_at: '2025-01-10T00:00:00Z',
                };

                const result = await integration.transformPersonToQuo(minimalPerson);

                expect(result.externalId).toBe('rec123');
                expect(result.defaultFields.phoneNumbers).toEqual([]);
                expect(result.defaultFields.emails).toEqual([]);
                expect(result.defaultFields.company).toBeNull();
            });
        });

        describe('logSMSToActivity', () => {
            it('should log SMS activity to Attio as a note', async () => {
                const mockPerson = {
                    id: { record_id: 'rec123', object_id: 'people' },
                };
                mockAttioApi.api.objects.getRecord.mockResolvedValue(mockPerson);
                mockAttioApi.api.notes.create.mockResolvedValue({ id: 'note123' });

                const activity = {
                    contactExternalId: 'rec123',
                    direction: 'outbound',
                    content: 'Test SMS message',
                    timestamp: '2025-01-10T15:30:00Z',
                };

                await integration.logSMSToActivity(activity);

                expect(mockAttioApi.api.objects.getRecord).toHaveBeenCalledWith('people', 'rec123');
                expect(mockAttioApi.api.notes.create).toHaveBeenCalledWith({
                    parent_object: 'people',
                    parent_record_id: 'rec123',
                    title: 'SMS: outbound',
                    content: 'Test SMS message',
                    created_at: '2025-01-10T15:30:00Z',
                });
            });

            it('should handle person not found gracefully', async () => {
                mockAttioApi.api.objects.getRecord.mockResolvedValue(null);

                const activity = {
                    contactExternalId: 'rec999',
                    direction: 'inbound',
                    content: 'Test SMS',
                    timestamp: '2025-01-10T15:30:00Z',
                };

                const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

                await integration.logSMSToActivity(activity);

                expect(consoleSpy).toHaveBeenCalledWith(
                    'Person not found for SMS logging: rec999'
                );
                expect(mockAttioApi.api.notes.create).not.toHaveBeenCalled();

                consoleSpy.mockRestore();
            });
        });

        describe('logCallToActivity', () => {
            it('should log call activity to Attio as a note', async () => {
                const mockPerson = {
                    id: { record_id: 'rec123', object_id: 'people' },
                };
                mockAttioApi.api.objects.getRecord.mockResolvedValue(mockPerson);
                mockAttioApi.api.notes.create.mockResolvedValue({ id: 'note123' });

                const activity = {
                    contactExternalId: 'rec123',
                    direction: 'outbound',
                    duration: 300,
                    summary: 'Discussed project proposal',
                    timestamp: '2025-01-10T15:30:00Z',
                };

                await integration.logCallToActivity(activity);

                expect(mockAttioApi.api.notes.create).toHaveBeenCalledWith({
                    parent_object: 'people',
                    parent_record_id: 'rec123',
                    title: 'Call: outbound (300s)',
                    content: 'Discussed project proposal',
                    created_at: '2025-01-10T15:30:00Z',
                });
            });
        });

        describe('setupWebhooks', () => {
            it('should create webhooks for record events', async () => {
                process.env.BASE_URL = 'https://api.example.com';
                mockAttioApi.api.webhooks.create.mockResolvedValue({ id: 'webhook123' });

                await integration.setupWebhooks();

                expect(mockAttioApi.api.webhooks.create).toHaveBeenCalledWith({
                    url: `https://api.example.com/integrations/${integration.id}/webhook`,
                    subscribed_events: [
                        'record.created',
                        'record.updated',
                        'record.deleted',
                    ],
                    object_types: ['people'],
                });
            });

            it('should handle webhook setup failure gracefully', async () => {
                mockAttioApi.api.webhooks.create.mockRejectedValue(new Error('Webhook creation failed'));

                const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

                await integration.setupWebhooks();

                expect(consoleSpy).toHaveBeenCalledWith(
                    'Failed to setup Attio webhooks:',
                    expect.any(Error)
                );

                consoleSpy.mockRestore();
            });
        });
    });

    describe('Backward Compatibility - Existing Events', () => {
        it('should have LIST_ATTIO_WORKSPACES event', () => {
            expect(integration.events.LIST_ATTIO_WORKSPACES).toBeDefined();
            expect(integration.events.LIST_ATTIO_WORKSPACES.handler).toBeInstanceOf(Function);
        });

        it('should have LIST_ATTIO_OBJECTS event', () => {
            expect(integration.events.LIST_ATTIO_OBJECTS).toBeDefined();
            expect(integration.events.LIST_ATTIO_OBJECTS.handler).toBeInstanceOf(Function);
        });

        it('should have LIST_ATTIO_COMPANIES event', () => {
            expect(integration.events.LIST_ATTIO_COMPANIES).toBeDefined();
            expect(integration.events.LIST_ATTIO_COMPANIES.handler).toBeInstanceOf(Function);
        });

        it('should have LIST_ATTIO_PEOPLE event', () => {
            expect(integration.events.LIST_ATTIO_PEOPLE).toBeDefined();
            expect(integration.events.LIST_ATTIO_PEOPLE.handler).toBeInstanceOf(Function);
        });
    });

    describe('Helper Methods', () => {
        describe('fetchPersonById', () => {
            it('should fetch person by ID', async () => {
                const mockPerson = {
                    id: { record_id: 'rec123', object_id: 'people' },
                    values: { name: [{ first_name: 'John', last_name: 'Doe' }] },
                };
                mockAttioApi.api.objects.getRecord.mockResolvedValue(mockPerson);

                const result = await integration.fetchPersonById('rec123');

                expect(result).toEqual(mockPerson);
                expect(mockAttioApi.api.objects.getRecord).toHaveBeenCalledWith('people', 'rec123');
            });
        });

        describe('fetchPersonsByIds', () => {
            it('should fetch multiple persons by IDs', async () => {
                mockAttioApi.api.objects.getRecord
                    .mockResolvedValueOnce({
                        id: { record_id: 'rec1', object_id: 'people' },
                        values: { name: [{ first_name: 'John' }] },
                    })
                    .mockResolvedValueOnce({
                        id: { record_id: 'rec2', object_id: 'people' },
                        values: { name: [{ first_name: 'Jane' }] },
                    });

                const result = await integration.fetchPersonsByIds(['rec1', 'rec2']);

                expect(result).toHaveLength(2);
                expect(result[0].id.record_id).toBe('rec1');
                expect(result[1].id.record_id).toBe('rec2');
            });

            it('should handle fetch errors gracefully', async () => {
                mockAttioApi.api.objects.getRecord
                    .mockResolvedValueOnce({
                        id: { record_id: 'rec1', object_id: 'people' },
                        values: { name: [{ first_name: 'John' }] },
                    })
                    .mockRejectedValueOnce(new Error('Not found'));

                const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

                const result = await integration.fetchPersonsByIds(['rec1', 'rec2']);

                expect(result).toHaveLength(1); // Only successfully fetched person
                expect(result[0].id.record_id).toBe('rec1');
                expect(consoleSpy).toHaveBeenCalled();

                consoleSpy.mockRestore();
            });
        });
    });
});

