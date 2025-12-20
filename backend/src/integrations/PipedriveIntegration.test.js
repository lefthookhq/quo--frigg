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
                listPersons: jest.fn(), // Used by fetchPersonPage
                getPerson: jest.fn(),
                getOrganization: jest.fn(),
                createWebhook: jest.fn(),
                deleteWebhook: jest.fn(),
                createNote: jest.fn(),
                createActivity: jest.fn(),
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
                listPhoneNumbers: jest.fn(),
                createMessageWebhook: jest.fn(),
                createCallWebhook: jest.fn(),
                createCallSummaryWebhook: jest.fn(),
                deleteWebhook: jest.fn(),
            },
        };

        // Create integration instance
        integration = new PipedriveIntegration();
        integration.pipedrive = mockPipedriveApi;
        integration.quo = mockQuoApi;
        integration.id = 'test-integration-id';
        integration.userId = 'test-user-id';
        integration.config = {}; // Initialize config

        // Mock base class dependencies
        integration.commands = {
            updateIntegrationConfig: jest.fn().mockResolvedValue({}),
        };
        integration.updateIntegrationMessages = {
            execute: jest.fn().mockResolvedValue({}),
        };
    });

    describe('Static Configuration', () => {
        it('should have correct Definition', () => {
            expect(PipedriveIntegration.Definition).toBeDefined();
            expect(PipedriveIntegration.Definition.name).toBe('pipedrive');
            expect(PipedriveIntegration.Definition.version).toBe('1.0.0');
            expect(PipedriveIntegration.Definition.display.label).toBe(
                'Pipedrive',
            );
        });

        it('should have quo module with correct name and label overrides', () => {
            expect(PipedriveIntegration.Definition.modules.quo).toBeDefined();
            expect(
                PipedriveIntegration.Definition.modules.quo.definition,
            ).toBeDefined();

            // Test name override
            expect(
                PipedriveIntegration.Definition.modules.quo.definition.getName(),
            ).toBe('quo-pipedrive');
            expect(
                PipedriveIntegration.Definition.modules.quo.definition
                    .moduleName,
            ).toBe('quo-pipedrive');

            // Test label override (if display property exists)
            if (
                PipedriveIntegration.Definition.modules.quo.definition.display
            ) {
                expect(
                    PipedriveIntegration.Definition.modules.quo.definition
                        .display.label,
                ).toBe('Quo (Pipedrive)');
            }
        });

        it('should have correct CRMConfig', () => {
            expect(PipedriveIntegration.CRMConfig).toBeDefined();
            expect(
                PipedriveIntegration.CRMConfig.personObjectTypes,
            ).toHaveLength(1);
            expect(
                PipedriveIntegration.CRMConfig.personObjectTypes[0]
                    .crmObjectName,
            ).toBe('Person');
            expect(
                PipedriveIntegration.CRMConfig.syncConfig.supportsWebhooks,
            ).toBe(true);
            expect(
                PipedriveIntegration.CRMConfig.syncConfig.initialBatchSize,
            ).toBe(100);
        });

        it('should have queue configuration', () => {
            expect(PipedriveIntegration.CRMConfig.queueConfig).toBeDefined();
            expect(PipedriveIntegration.CRMConfig.queueConfig.maxWorkers).toBe(
                20,
            );
            expect(PipedriveIntegration.CRMConfig.queueConfig.provisioned).toBe(
                8,
            );
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
                            emails: [
                                {
                                    value: 'john@example.com',
                                    primary: true,
                                    label: 'work',
                                },
                            ],
                            phones: [
                                {
                                    value: '555-1234',
                                    primary: true,
                                    label: 'work',
                                },
                            ],
                        },
                        {
                            id: 2,
                            first_name: 'Jane',
                            last_name: 'Smith',
                            emails: [
                                {
                                    value: 'jane@example.com',
                                    primary: true,
                                    label: 'work',
                                },
                            ],
                        },
                    ],
                    additional_data: {
                        next_cursor: null, // No more pages
                    },
                };

                mockPipedriveApi.api.listPersons.mockResolvedValue(
                    mockResponse,
                );

                const result = await integration.fetchPersonPage({
                    objectType: 'Person',
                    cursor: null,
                    limit: 10,
                    sortDesc: true,
                });

                expect(result).toEqual({
                    data: mockResponse.data,
                    cursor: null,
                    hasMore: false,
                });

                expect(mockPipedriveApi.api.listPersons).toHaveBeenCalledWith({
                    limit: 10,
                    sort_by: 'update_time',
                    sort_direction: 'desc',
                });
            });

            it('should handle pagination with cursor', async () => {
                const mockResponse = {
                    data: [],
                    additional_data: {
                        next_cursor: 'next_page_token_123',
                    },
                };

                mockPipedriveApi.api.listPersons.mockResolvedValue(
                    mockResponse,
                );

                const result = await integration.fetchPersonPage({
                    objectType: 'Person',
                    cursor: 'current_page_token',
                    limit: 50,
                    sortDesc: false,
                });

                expect(result).toEqual({
                    data: [],
                    cursor: 'next_page_token_123',
                    hasMore: true,
                });

                expect(mockPipedriveApi.api.listPersons).toHaveBeenCalledWith({
                    cursor: 'current_page_token',
                    limit: 50,
                    sort_by: 'update_time',
                    sort_direction: 'asc',
                });
            });

            it('should include modifiedSince filter when provided', async () => {
                const mockDate = new Date('2025-01-01T00:00:00Z');
                const mockResponse = {
                    data: [],
                    additional_data: { next_cursor: null },
                };

                mockPipedriveApi.api.listPersons.mockResolvedValue(
                    mockResponse,
                );

                await integration.fetchPersonPage({
                    objectType: 'Person',
                    cursor: null,
                    limit: 10,
                    modifiedSince: mockDate,
                });

                expect(mockPipedriveApi.api.listPersons).toHaveBeenCalledWith(
                    expect.objectContaining({
                        updated_since: '2025-01-01T00:00:00.000Z',
                    }),
                );
            });
        });

        describe('transformPersonToQuo', () => {
            it('should transform Pipedrive person to Quo format', async () => {
                const pipedrivePerson = {
                    id: 123,
                    first_name: 'John',
                    last_name: 'Doe',
                    emails: [
                        {
                            value: 'john@example.com',
                            primary: true,
                            label: 'work',
                        },
                        {
                            value: 'john.doe@personal.com',
                            primary: false,
                            label: 'home',
                        },
                    ],
                    phones: [
                        { value: '555-1234', primary: true, label: 'work' },
                        { value: '555-5678', primary: false, label: 'mobile' },
                    ],
                    org_id: 999,
                };

                // Mock organization fetch
                mockPipedriveApi.api.getOrganization = jest
                    .fn()
                    .mockResolvedValue({
                        data: { name: 'Acme Corp' },
                    });

                const result =
                    await integration.transformPersonToQuo(pipedrivePerson);

                expect(result).toEqual({
                    externalId: '123',
                    source: 'openphone-pipedrive',
                    sourceEntityType: 'person',
                    sourceUrl: 'https://app.pipedrive.com/person/123',
                    defaultFields: {
                        firstName: 'John',
                        lastName: 'Doe',
                        company: 'Acme Corp',
                        phoneNumbers: [
                            { name: 'Work', value: '555-1234', primary: true },
                            {
                                name: 'Mobile',
                                value: '555-5678',
                                primary: false,
                            },
                        ],
                        emails: [
                            {
                                name: 'Work',
                                value: 'john@example.com',
                                primary: true,
                            },
                            {
                                name: 'Home',
                                value: 'john.doe@personal.com',
                                primary: false,
                            },
                        ],
                    },
                    customFields: [],
                });
            });

            it('should handle person without org_id', async () => {
                const pipedrivePerson = {
                    id: 123,
                    first_name: 'Jane',
                    last_name: 'Smith',
                    emails: [],
                    phones: [],
                };

                const result =
                    await integration.transformPersonToQuo(pipedrivePerson);

                expect(result.defaultFields.company).toBe(null);
            });

            it('should handle minimal person data', async () => {
                const minimalPerson = {
                    id: 123,
                    first_name: 'Test',
                    last_name: 'User',
                };

                const result =
                    await integration.transformPersonToQuo(minimalPerson);

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
                mockPipedriveApi.api.getPerson.mockResolvedValue(mockPerson);
                mockPipedriveApi.api.createNote.mockResolvedValue({
                    data: { id: 456 },
                });

                const activity = {
                    contactExternalId: '123',
                    direction: 'outbound',
                    content: 'Test SMS message',
                    timestamp: '2025-01-10T15:30:00Z',
                };

                await integration.logSMSToActivity(activity);

                expect(mockPipedriveApi.api.getPerson).toHaveBeenCalledWith(
                    '123',
                );
                expect(mockPipedriveApi.api.createNote).toHaveBeenCalledWith({
                    content: 'Test SMS message',
                    person_id: 123,
                });
            });

            it('should handle person not found gracefully', async () => {
                mockPipedriveApi.api.getPerson.mockResolvedValue({
                    data: null,
                });

                const activity = {
                    contactExternalId: '999',
                    direction: 'inbound',
                    content: 'Test SMS',
                    timestamp: '2025-01-10T15:30:00Z',
                };

                const consoleSpy = jest
                    .spyOn(console, 'warn')
                    .mockImplementation();

                await integration.logSMSToActivity(activity);

                expect(consoleSpy).toHaveBeenCalledWith(
                    'Person not found for SMS logging: 999',
                );
                expect(
                    mockPipedriveApi.api.activities.create,
                ).not.toHaveBeenCalled();

                consoleSpy.mockRestore();
            });
        });

        describe('logCallToActivity', () => {
            it('should log call activity to Pipedrive', async () => {
                const mockPerson = {
                    data: { id: 123, first_name: 'John', last_name: 'Doe' },
                };
                mockPipedriveApi.api.getPerson.mockResolvedValue(mockPerson);
                mockPipedriveApi.api.createActivity.mockResolvedValue({
                    data: { id: 456 },
                });

                const activity = {
                    contactExternalId: '123',
                    direction: 'outbound',
                    duration: 300,
                    summary: 'Discussed project proposal',
                    timestamp: '2025-01-10T15:30:00Z',
                };

                await integration.logCallToActivity(activity);

                expect(
                    mockPipedriveApi.api.createActivity,
                ).toHaveBeenCalledWith({
                    subject: 'Call: outbound (300s)',
                    type: 'call',
                    done: 1,
                    note: 'Discussed project proposal',
                    participants: [{ person_id: 123, primary: true }], // v2 API uses participants instead of person_id
                    duration: 5, // 300 seconds = 5 minutes
                });
            });
        });

        describe('setupWebhooks', () => {
            it('should create webhooks for person events', async () => {
                process.env.BASE_URL = 'https://api.example.com';

                // Ensure config is properly initialized
                integration.config = {};
                integration.id = 'test-integration-id'; // Ensure ID is set

                mockPipedriveApi.api.createWebhook.mockResolvedValue({
                    data: { id: 1 },
                });
                mockQuoApi.api.createMessageWebhook.mockResolvedValue({
                    data: { id: 'msg-wh', key: 'msg-key' },
                });
                mockQuoApi.api.createCallWebhook.mockResolvedValue({
                    data: { id: 'call-wh', key: 'call-key' },
                });
                mockQuoApi.api.createCallSummaryWebhook.mockResolvedValue({
                    data: { id: 'summary-wh', key: 'summary-key' },
                });

                // Ensure commands and updateIntegrationMessages are mocked
                integration.commands = {
                    updateIntegrationConfig: jest.fn().mockResolvedValue({}),
                };
                integration.updateIntegrationMessages = {
                    execute: jest.fn().mockResolvedValue({}),
                };

                // Mock _generateWebhookUrl since it's called by setupQuoWebhook
                integration._generateWebhookUrl = jest.fn(
                    (path) =>
                        `https://api.example.com/api/pipedrive-integration${path}`,
                );

                // Mock the base class helper method that's called by setupQuoWebhook
                integration._createQuoWebhooksWithPhoneIds = jest
                    .fn()
                    .mockResolvedValue({
                        messageWebhookId: 'msg-wh',
                        messageWebhookKey: 'msg-key',
                        callWebhookId: 'call-wh',
                        callWebhookKey: 'call-key',
                        callSummaryWebhookId: 'summary-wh',
                        callSummaryWebhookKey: 'summary-key',
                    });

                const result = await integration.setupWebhooks();

                expect(
                    mockPipedriveApi.api.createWebhook,
                ).toHaveBeenCalledTimes(4); // added, updated, deleted, merged
                expect(mockPipedriveApi.api.createWebhook).toHaveBeenCalledWith(
                    {
                        subscription_url: expect.stringContaining('/webhooks/'),
                        event_action: 'added',
                        event_object: 'person',
                        name: 'Quo - Person Added',
                        version: '1.0',
                    },
                );
                expect(mockPipedriveApi.api.createWebhook).toHaveBeenCalledWith(
                    {
                        subscription_url: expect.stringContaining('/webhooks/'),
                        event_action: 'updated',
                        event_object: 'person',
                        name: 'Quo - Person Updated',
                        version: '1.0',
                    },
                );
            });

            it('should handle webhook setup failure gracefully', async () => {
                // Both Pipedrive and Quo fail (new behavior with Promise.allSettled)
                mockPipedriveApi.api.createWebhook.mockRejectedValue(
                    new Error('Webhook creation failed'),
                );
                mockQuoApi.api.createMessageWebhook.mockRejectedValue(
                    new Error('Quo API error'),
                );
                mockQuoApi.api.createCallWebhook.mockRejectedValue(
                    new Error('Quo API error'),
                );
                mockQuoApi.api.createCallSummaryWebhook.mockRejectedValue(
                    new Error('Quo API error'),
                );

                const consoleSpy = jest
                    .spyOn(console, 'error')
                    .mockImplementation();

                // New error message when BOTH fail
                await expect(integration.setupWebhooks()).rejects.toThrow(
                    'Both Pipedrive and Quo webhook setups failed',
                );

                expect(consoleSpy).toHaveBeenCalledWith(
                    '[Webhook Setup] ✗ Failed - Both webhook setups failed',
                );

                consoleSpy.mockRestore();
            });
        });
    });

    describe('Backward Compatibility - Existing Events', () => {
        it('should have LIST_PIPEDRIVE_DEALS event', () => {
            expect(integration.events.LIST_PIPEDRIVE_DEALS).toBeDefined();
            expect(
                integration.events.LIST_PIPEDRIVE_DEALS.handler,
            ).toBeInstanceOf(Function);
        });

        it('should have LIST_PIPEDRIVE_PERSONS event', () => {
            expect(integration.events.LIST_PIPEDRIVE_PERSONS).toBeDefined();
            expect(
                integration.events.LIST_PIPEDRIVE_PERSONS.handler,
            ).toBeInstanceOf(Function);
        });

        it('should have LIST_PIPEDRIVE_ORGANIZATIONS event', () => {
            expect(
                integration.events.LIST_PIPEDRIVE_ORGANIZATIONS,
            ).toBeDefined();
            expect(
                integration.events.LIST_PIPEDRIVE_ORGANIZATIONS.handler,
            ).toBeInstanceOf(Function);
        });

        it('should have LIST_PIPEDRIVE_ACTIVITIES event', () => {
            expect(integration.events.LIST_PIPEDRIVE_ACTIVITIES).toBeDefined();
            expect(
                integration.events.LIST_PIPEDRIVE_ACTIVITIES.handler,
            ).toBeInstanceOf(Function);
        });
    });

    describe('Helper Methods', () => {
        describe('fetchPersonById', () => {
            it('should fetch person by ID', async () => {
                const mockPerson = {
                    id: 123,
                    first_name: 'John',
                    last_name: 'Doe',
                };
                mockPipedriveApi.api.getPerson.mockResolvedValue({
                    data: mockPerson,
                });

                const result = await integration.fetchPersonById('123');

                expect(result).toEqual(mockPerson);
                expect(mockPipedriveApi.api.getPerson).toHaveBeenCalledWith(
                    '123',
                );
            });
        });

        describe('fetchPersonsByIds', () => {
            it('should fetch multiple persons by IDs', async () => {
                mockPipedriveApi.api.getPerson
                    .mockResolvedValueOnce({
                        data: { id: 1, first_name: 'John' },
                    })
                    .mockResolvedValueOnce({
                        data: { id: 2, first_name: 'Jane' },
                    });

                const result = await integration.fetchPersonsByIds(['1', '2']);

                expect(result).toHaveLength(2);
                expect(result[0].id).toBe(1);
                expect(result[1].id).toBe(2);
            });

            it('should handle fetch errors gracefully', async () => {
                mockPipedriveApi.api.getPerson
                    .mockResolvedValueOnce({
                        data: { id: 1, first_name: 'John' },
                    })
                    .mockRejectedValueOnce(new Error('Not found'));

                const consoleSpy = jest
                    .spyOn(console, 'error')
                    .mockImplementation();

                const result = await integration.fetchPersonsByIds(['1', '2']);

                expect(result).toHaveLength(1); // Only successfully fetched person
                expect(result[0].id).toBe(1);
                expect(consoleSpy).toHaveBeenCalled();

                consoleSpy.mockRestore();
            });
        });

        describe('_syncPersonToQuo with upsertContactToQuo', () => {
            beforeEach(() => {
                mockQuoApi.api.createContact = jest.fn();
                mockQuoApi.api.updateContact = jest.fn();
                mockQuoApi.api.listContacts = jest.fn();
                integration.transformPersonToQuo = jest.fn();
                integration.commands.findOrganizationUserById = jest.fn().mockResolvedValue({
                    id: 'user-123',
                    appOrgId: 'org-123',
                });
            });

            it('should use upsertContactToQuo for added action', async () => {
                const person = {
                    id: 123,
                    first_name: 'John',
                    last_name: 'Doe',
                    phones: [{ value: '+15551234567', primary: true }],
                };

                const mockQuoContact = {
                    externalId: '123',
                    source: 'openphone-pipedrive',
                    defaultFields: {
                        firstName: 'John',
                        lastName: 'Doe',
                        phoneNumbers: [{ name: 'Work', value: '+15551234567' }],
                    },
                };

                integration.transformPersonToQuo.mockResolvedValue(
                    mockQuoContact,
                );
                integration.upsertContactToQuo = jest.fn().mockResolvedValue({
                    action: 'created',
                    quoContactId: 'quo-contact-123',
                    externalId: '123',
                });

                await integration._syncPersonToQuo(person, 'added');

                expect(integration.upsertContactToQuo).toHaveBeenCalledWith(
                    expect.objectContaining({
                        externalId: '123',
                    }),
                );
                expect(mockQuoApi.api.createContact).not.toHaveBeenCalled();
            });

            it('should handle upsertContactToQuo errors for added action', async () => {
                const person = {
                    id: 456,
                    first_name: 'Error',
                    last_name: 'Test',
                };

                integration.transformPersonToQuo.mockResolvedValue({
                    externalId: '456',
                    defaultFields: { firstName: 'Error' },
                });
                integration.upsertContactToQuo = jest
                    .fn()
                    .mockRejectedValue(new Error('Failed to create contact'));

                await expect(
                    integration._syncPersonToQuo(person, 'added'),
                ).rejects.toThrow('Failed to create contact');
            });

            it('should use upsertContactToQuo for updated action', async () => {
                const person = {
                    id: 789,
                    first_name: 'Jane',
                    last_name: 'Smith',
                    phones: [{ value: '+15559999999', primary: true }],
                };

                const mockQuoContact = {
                    externalId: '789',
                    defaultFields: {
                        firstName: 'Jane',
                        lastName: 'Smith',
                        phoneNumbers: [
                            { name: 'Mobile', value: '+15559999999' },
                        ],
                    },
                };

                integration.transformPersonToQuo.mockResolvedValue(
                    mockQuoContact,
                );
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
                const person = {
                    id: 999,
                    first_name: 'Update',
                    last_name: 'Error',
                };

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
    });
});
