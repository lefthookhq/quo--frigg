/**
 * Jest test for refactored PipedriveIntegration
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

const PipedriveIntegration = require('./PipedriveIntegration');

describe('PipedriveIntegration (Refactored)', () => {
    let integration;
    let mockPipedriveApi;
    let mockQuoApi;

    beforeEach(() => {
        // Create mock APIs
        mockPipedriveApi = {
            api: {
                persons: {
                    getAll: jest.fn(),
                    get: jest.fn(),
                },
                deals: {
                    getAll: jest.fn(),
                    create: jest.fn(),
                },
                organizations: {
                    getAll: jest.fn(),
                    get: jest.fn(),
                },
                activities: {
                    getAll: jest.fn(),
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
        integration = new PipedriveIntegration();
        integration.pipedrive = mockPipedriveApi;
        integration.quo = mockQuoApi;
        integration.id = 'test-integration-id';
        integration.userId = 'test-user-id';
    });

    describe('Static Configuration', () => {
        it('should have correct Definition', () => {
            expect(PipedriveIntegration.Definition).toBeDefined();
            expect(PipedriveIntegration.Definition.name).toBe('pipedrive');
            expect(PipedriveIntegration.Definition.version).toBe('1.0.0');
            expect(PipedriveIntegration.Definition.display.label).toBe('Pipedrive');
        });

        it('should have correct CRMConfig', () => {
            expect(PipedriveIntegration.CRMConfig).toBeDefined();
            expect(PipedriveIntegration.CRMConfig.personObjectTypes).toHaveLength(1);
            expect(PipedriveIntegration.CRMConfig.personObjectTypes[0].crmObjectName).toBe('Person');
            expect(PipedriveIntegration.CRMConfig.syncConfig.supportsWebhooks).toBe(true);
            expect(PipedriveIntegration.CRMConfig.syncConfig.initialBatchSize).toBe(100);
        });

        it('should have queue configuration', () => {
            expect(PipedriveIntegration.CRMConfig.queueConfig).toBeDefined();
            expect(PipedriveIntegration.CRMConfig.queueConfig.maxWorkers).toBe(20);
            expect(PipedriveIntegration.CRMConfig.queueConfig.provisioned).toBe(8);
        });
    });

    describe('Required Methods - BaseCRMIntegration', () => {
        describe('fetchPersonPage', () => {
            it('should fetch persons page correctly', async () => {
                const mockResponse = {
                    data: [
                        {
                            id: 1,
                            first_name: 'John',
                            last_name: 'Doe',
                            email: [{ value: 'john@example.com', primary: true, label: 'work' }],
                            phone: [{ value: '555-1234', primary: true, label: 'work' }],
                        },
                        {
                            id: 2,
                            first_name: 'Jane',
                            last_name: 'Smith',
                            email: [{ value: 'jane@example.com', primary: true, label: 'work' }],
                        },
                    ],
                    additional_data: {
                        pagination: {
                            total: 2,
                            more_items_in_collection: false,
                        },
                    },
                };

                mockPipedriveApi.api.persons.getAll.mockResolvedValue(mockResponse);

                const result = await integration.fetchPersonPage({
                    objectType: 'Person',
                    page: 0,
                    limit: 10,
                    sortDesc: true,
                });

                expect(result).toEqual({
                    data: mockResponse.data,
                    total: 2,
                    hasMore: false,
                });

                expect(mockPipedriveApi.api.persons.getAll).toHaveBeenCalledWith({
                    start: 0, // Page 0 * limit 10
                    limit: 10,
                    sort: 'update_time DESC',
                });
            });

            it('should handle pagination with offset', async () => {
                const mockResponse = {
                    data: [],
                    additional_data: {
                        pagination: {
                            total: 250,
                            more_items_in_collection: true,
                        },
                    },
                };

                mockPipedriveApi.api.persons.getAll.mockResolvedValue(mockResponse);

                await integration.fetchPersonPage({
                    objectType: 'Person',
                    page: 2,
                    limit: 50,
                    sortDesc: false,
                });

                expect(mockPipedriveApi.api.persons.getAll).toHaveBeenCalledWith({
                    start: 100, // Page 2 * limit 50
                    limit: 50,
                    sort: 'update_time ASC',
                });
            });

            it('should include modifiedSince filter when provided', async () => {
                const mockDate = new Date('2025-01-01T00:00:00Z');
                const mockResponse = {
                    data: [],
                    additional_data: { pagination: { total: 0, more_items_in_collection: false } },
                };

                mockPipedriveApi.api.persons.getAll.mockResolvedValue(mockResponse);

                await integration.fetchPersonPage({
                    objectType: 'Person',
                    page: 0,
                    limit: 10,
                    modifiedSince: mockDate,
                });

                expect(mockPipedriveApi.api.persons.getAll).toHaveBeenCalledWith(
                    expect.objectContaining({
                        since: '2025-01-01',
                    })
                );
            });
        });

        describe('transformPersonToQuo', () => {
            it('should transform Pipedrive person to Quo format', async () => {
                const pipedrivePerson = {
                    id: 123,
                    first_name: 'John',
                    last_name: 'Doe',
                    email: [
                        { value: 'john@example.com', primary: true, label: 'work' },
                        { value: 'john.doe@personal.com', primary: false, label: 'home' },
                    ],
                    phone: [
                        { value: '555-1234', primary: true, label: 'work' },
                        { value: '555-5678', primary: false, label: 'mobile' },
                    ],
                    org_name: 'Acme Corp',
                    label: 3, // Hot lead
                    open_deals_count: 2,
                    closed_deals_count: 5,
                    won_deals_count: 4,
                    lost_deals_count: 1,
                    next_activity_date: '2025-01-15',
                    last_activity_date: '2025-01-01',
                    update_time: '2025-01-10 12:00:00',
                    add_time: '2024-01-01 10:00:00',
                    visible_to: '3',
                    owner_id: { id: 456, name: 'Sales Rep' },
                };

                const result = await integration.transformPersonToQuo(pipedrivePerson);

                expect(result).toEqual({
                    externalId: '123',
                    source: 'pipedrive',
                    defaultFields: {
                        firstName: 'John',
                        lastName: 'Doe',
                        company: 'Acme Corp',
                        phoneNumbers: [
                            { name: 'work', value: '555-1234', primary: true },
                            { name: 'mobile', value: '555-5678', primary: false },
                        ],
                        emails: [
                            { name: 'work', value: 'john@example.com', primary: true },
                            { name: 'home', value: 'john.doe@personal.com', primary: false },
                        ],
                    },
                    customFields: {
                        crmId: 123,
                        crmType: 'pipedrive',
                        label: 3,
                        openDealsCount: 2,
                        closedDealsCount: 5,
                        wonDealsCount: 4,
                        lostDealsCount: 1,
                        nextActivityDate: '2025-01-15',
                        lastActivityDate: '2025-01-01',
                        updateTime: '2025-01-10 12:00:00',
                        addTime: '2024-01-01 10:00:00',
                        visibleTo: '3',
                        ownerId: 456,
                        ownerName: 'Sales Rep',
                    },
                });
            });

            it('should fetch organization name if org_id is provided', async () => {
                const pipedrivePerson = {
                    id: 123,
                    first_name: 'Jane',
                    last_name: 'Smith',
                    org_id: { value: 789 },
                    email: [],
                    phone: [],
                };

                const mockOrg = {
                    data: { id: 789, name: 'Smith Industries' },
                };

                mockPipedriveApi.api.organizations.get.mockResolvedValue(mockOrg);

                const result = await integration.transformPersonToQuo(pipedrivePerson);

                expect(result.defaultFields.company).toBe('Smith Industries');
                expect(mockPipedriveApi.api.organizations.get).toHaveBeenCalledWith(789);
            });

            it('should handle minimal person data', async () => {
                const minimalPerson = {
                    id: 123,
                    first_name: 'Test',
                    last_name: 'User',
                };

                const result = await integration.transformPersonToQuo(minimalPerson);

                expect(result.externalId).toBe('123');
                expect(result.defaultFields.phoneNumbers).toEqual([]);
                expect(result.defaultFields.emails).toEqual([]);
                expect(result.defaultFields.company).toBeNull();
            });
        });

        describe('logSMSToActivity', () => {
            it('should log SMS activity to Pipedrive', async () => {
                const mockPerson = {
                    data: { id: 123, first_name: 'John', last_name: 'Doe' },
                };
                mockPipedriveApi.api.persons.get.mockResolvedValue(mockPerson);
                mockPipedriveApi.api.activities.create.mockResolvedValue({ data: { id: 456 } });

                const activity = {
                    contactExternalId: '123',
                    direction: 'outbound',
                    content: 'Test SMS message',
                    timestamp: '2025-01-10T15:30:00Z',
                };

                await integration.logSMSToActivity(activity);

                expect(mockPipedriveApi.api.persons.get).toHaveBeenCalledWith('123');
                expect(mockPipedriveApi.api.activities.create).toHaveBeenCalledWith({
                    subject: 'SMS: outbound',
                    type: 'sms',
                    done: 1,
                    note: 'Test SMS message',
                    person_id: 123,
                    due_date: '2025-01-10',
                    due_time: '15:30',
                });
            });

            it('should handle person not found gracefully', async () => {
                mockPipedriveApi.api.persons.get.mockResolvedValue({ data: null });

                const activity = {
                    contactExternalId: '999',
                    direction: 'inbound',
                    content: 'Test SMS',
                    timestamp: '2025-01-10T15:30:00Z',
                };

                const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

                await integration.logSMSToActivity(activity);

                expect(consoleSpy).toHaveBeenCalledWith(
                    'Person not found for SMS logging: 999'
                );
                expect(mockPipedriveApi.api.activities.create).not.toHaveBeenCalled();

                consoleSpy.mockRestore();
            });
        });

        describe('logCallToActivity', () => {
            it('should log call activity to Pipedrive', async () => {
                const mockPerson = {
                    data: { id: 123, first_name: 'John', last_name: 'Doe' },
                };
                mockPipedriveApi.api.persons.get.mockResolvedValue(mockPerson);
                mockPipedriveApi.api.activities.create.mockResolvedValue({ data: { id: 456 } });

                const activity = {
                    contactExternalId: '123',
                    direction: 'outbound',
                    duration: 300,
                    summary: 'Discussed project proposal',
                    timestamp: '2025-01-10T15:30:00Z',
                };

                await integration.logCallToActivity(activity);

                expect(mockPipedriveApi.api.activities.create).toHaveBeenCalledWith({
                    subject: 'Call: outbound (300s)',
                    type: 'call',
                    done: 1,
                    note: 'Discussed project proposal',
                    person_id: 123,
                    due_date: '2025-01-10',
                    due_time: '15:30',
                    duration: 5, // 300 seconds = 5 minutes
                });
            });
        });

        describe('setupWebhooks', () => {
            it('should create webhooks for person events', async () => {
                process.env.BASE_URL = 'https://api.example.com';
                mockPipedriveApi.api.webhooks.create.mockResolvedValue({ data: { id: 1 } });

                await integration.setupWebhooks();

                expect(mockPipedriveApi.api.webhooks.create).toHaveBeenCalledTimes(3);
                expect(mockPipedriveApi.api.webhooks.create).toHaveBeenCalledWith({
                    subscription_url: `https://api.example.com/integrations/${integration.id}/webhook`,
                    event_action: 'added',
                    event_object: 'person',
                });
                expect(mockPipedriveApi.api.webhooks.create).toHaveBeenCalledWith({
                    subscription_url: `https://api.example.com/integrations/${integration.id}/webhook`,
                    event_action: 'updated',
                    event_object: 'person',
                });
                expect(mockPipedriveApi.api.webhooks.create).toHaveBeenCalledWith({
                    subscription_url: `https://api.example.com/integrations/${integration.id}/webhook`,
                    event_action: 'deleted',
                    event_object: 'person',
                });
            });

            it('should handle webhook setup failure gracefully', async () => {
                mockPipedriveApi.api.webhooks.create.mockRejectedValue(new Error('Webhook creation failed'));

                const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

                await integration.setupWebhooks();

                expect(consoleSpy).toHaveBeenCalledWith(
                    'Failed to setup Pipedrive webhooks:',
                    expect.any(Error)
                );

                consoleSpy.mockRestore();
            });
        });
    });

    describe('Backward Compatibility - Existing Events', () => {
        it('should have LIST_PIPEDRIVE_DEALS event', () => {
            expect(integration.events.LIST_PIPEDRIVE_DEALS).toBeDefined();
            expect(integration.events.LIST_PIPEDRIVE_DEALS.handler).toBeInstanceOf(Function);
        });

        it('should have LIST_PIPEDRIVE_PERSONS event', () => {
            expect(integration.events.LIST_PIPEDRIVE_PERSONS).toBeDefined();
            expect(integration.events.LIST_PIPEDRIVE_PERSONS.handler).toBeInstanceOf(Function);
        });

        it('should have LIST_PIPEDRIVE_ORGANIZATIONS event', () => {
            expect(integration.events.LIST_PIPEDRIVE_ORGANIZATIONS).toBeDefined();
            expect(integration.events.LIST_PIPEDRIVE_ORGANIZATIONS.handler).toBeInstanceOf(Function);
        });

        it('should have LIST_PIPEDRIVE_ACTIVITIES event', () => {
            expect(integration.events.LIST_PIPEDRIVE_ACTIVITIES).toBeDefined();
            expect(integration.events.LIST_PIPEDRIVE_ACTIVITIES.handler).toBeInstanceOf(Function);
        });
    });

    describe('Helper Methods', () => {
        describe('fetchPersonById', () => {
            it('should fetch person by ID', async () => {
                const mockPerson = { id: 123, first_name: 'John', last_name: 'Doe' };
                mockPipedriveApi.api.persons.get.mockResolvedValue({ data: mockPerson });

                const result = await integration.fetchPersonById('123');

                expect(result).toEqual(mockPerson);
                expect(mockPipedriveApi.api.persons.get).toHaveBeenCalledWith('123');
            });
        });

        describe('fetchPersonsByIds', () => {
            it('should fetch multiple persons by IDs', async () => {
                mockPipedriveApi.api.persons.get
                    .mockResolvedValueOnce({ data: { id: 1, first_name: 'John' } })
                    .mockResolvedValueOnce({ data: { id: 2, first_name: 'Jane' } });

                const result = await integration.fetchPersonsByIds(['1', '2']);

                expect(result).toHaveLength(2);
                expect(result[0].id).toBe(1);
                expect(result[1].id).toBe(2);
            });

            it('should handle fetch errors gracefully', async () => {
                mockPipedriveApi.api.persons.get
                    .mockResolvedValueOnce({ data: { id: 1, first_name: 'John' } })
                    .mockRejectedValueOnce(new Error('Not found'));

                const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

                const result = await integration.fetchPersonsByIds(['1', '2']);

                expect(result).toHaveLength(1); // Only successfully fetched person
                expect(result[0].id).toBe(1);
                expect(consoleSpy).toHaveBeenCalled();

                consoleSpy.mockRestore();
            });
        });
    });
});

