/**
 * Jest test for refactored ZohoCRMIntegration
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
                this.processManager = {
                    createSyncProcess: jest.fn(),
                    updateState: jest.fn(),
                    updateMetrics: jest.fn(),
                    getProcess: jest.fn(),
                };
                this.queueManager = {
                    queueFetchPersonPage: jest.fn(),
                    queueProcessPersonBatch: jest.fn(),
                    fanOutPages: jest.fn(),
                };
                this.syncOrchestrator = {
                    startInitialSync: jest.fn(),
                    startOngoingSync: jest.fn(),
                    handleWebhook: jest.fn(),
                };
            }
        },
    };
});

const ZohoCRMIntegration = require('./ZohoCRMIntegration');
const QuoWebhookEventProcessor = require('../base/services/QuoWebhookEventProcessor');

describe('ZohoCRMIntegration (Refactored)', () => {
    let integration;
    let mockZohoCrm;
    let mockQuoApi;

    beforeEach(() => {
        // Create mock APIs
        mockZohoCrm = {
            api: {
                listContacts: jest.fn(),
                listAccounts: jest.fn(),
                getContact: jest.fn(),
                getAccount: jest.fn(),
                searchContacts: jest.fn(),
                createNote: jest.fn(),
                enableNotification: jest.fn(),
                disableNotification: jest.fn(),
                getOrg: jest
                    .fn()
                    .mockResolvedValue({ org: [{ domain_name: 'org12345' }] }),
                getCrmBaseUrl: jest
                    .fn()
                    .mockReturnValue('https://crm.zoho.com'),
                leads: {
                    getAll: jest.fn(),
                    get: jest.fn(),
                },
                contacts: {
                    getAll: jest.fn(),
                    get: jest.fn(),
                },
                deals: {
                    getAll: jest.fn(),
                },
                accounts: {
                    getAll: jest.fn(),
                },
                activities: {
                    create: jest.fn(),
                },
                modules: {
                    getAll: jest.fn(),
                },
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
                getCallRecordings: jest.fn().mockResolvedValue({ data: [] }),
            },
        };

        // Create integration instance
        integration = new ZohoCRMIntegration();
        integration.zoho = mockZohoCrm;
        integration.quo = mockQuoApi;
        integration.id = 'test-integration-id';
        integration.userId = 'test-user-id';

        // Mock base class methods
        integration._fetchAndStoreEnabledPhoneIds = jest
            .fn()
            .mockResolvedValue(['phone-1', 'phone-2']);
        integration._createQuoWebhooksWithPhoneIds = jest
            .fn()
            .mockResolvedValue({
                messageWebhooks: [
                    {
                        id: 'quo-msg-wh',
                        key: 'quo-msg-key',
                        resourceIds: [],
                    },
                ],
                callWebhooks: [
                    {
                        id: 'quo-call-wh',
                        key: 'quo-call-key',
                        resourceIds: [],
                    },
                ],
                callSummaryWebhooks: [
                    {
                        id: 'quo-summary-wh',
                        key: 'quo-summary-key',
                        resourceIds: [],
                    },
                ],
            });
    });

    describe('Static Configuration', () => {
        it('should have correct Definition', () => {
            expect(ZohoCRMIntegration.Definition).toBeDefined();
            expect(ZohoCRMIntegration.Definition.name).toBe('zoho');
            expect(ZohoCRMIntegration.Definition.version).toBe('1.0.0');
            expect(ZohoCRMIntegration.Definition.display.label).toBe(
                'Zoho CRM',
            );
        });

        it('should have quo module with correct name and label overrides', () => {
            expect(ZohoCRMIntegration.Definition.modules.quo).toBeDefined();
            expect(
                ZohoCRMIntegration.Definition.modules.quo.definition,
            ).toBeDefined();

            // Test name override
            expect(
                ZohoCRMIntegration.Definition.modules.quo.definition.getName(),
            ).toBe('quo-zoho');
            expect(
                ZohoCRMIntegration.Definition.modules.quo.definition.moduleName,
            ).toBe('quo-zoho');

            // Test label override (if display property exists)
            if (ZohoCRMIntegration.Definition.modules.quo.definition.display) {
                expect(
                    ZohoCRMIntegration.Definition.modules.quo.definition.display
                        .label,
                ).toBe('Quo (Zoho CRM)');
            }
        });

        it('should have zoho module with moduleName override for entityType matching', () => {
            // This test ensures the zoho module's moduleName is overridden from 'zohoCrm' to 'zoho'
            // so that authorize requests with entityType: 'zoho' work correctly
            expect(ZohoCRMIntegration.Definition.modules.zoho).toBeDefined();
            expect(
                ZohoCRMIntegration.Definition.modules.zoho.definition,
            ).toBeDefined();

            // Test moduleName override - must match the entityType sent in authorize requests
            expect(
                ZohoCRMIntegration.Definition.modules.zoho.definition.getName(),
            ).toBe('zoho');
            expect(
                ZohoCRMIntegration.Definition.modules.zoho.definition
                    .moduleName,
            ).toBe('zoho');

            // Test redirect_uri override - should use /zoho instead of /zohoCrm
            expect(
                ZohoCRMIntegration.Definition.modules.zoho.definition.env
                    .redirect_uri,
            ).toMatch(/\/zoho$/);
        });

        it('should have correct CRMConfig', () => {
            expect(ZohoCRMIntegration.CRMConfig).toBeDefined();
            expect(ZohoCRMIntegration.CRMConfig.personObjectTypes).toHaveLength(
                2,
            );
            expect(
                ZohoCRMIntegration.CRMConfig.personObjectTypes[0].crmObjectName,
            ).toBe('Contact');
            expect(
                ZohoCRMIntegration.CRMConfig.personObjectTypes[1].crmObjectName,
            ).toBe('Account');
            expect(
                ZohoCRMIntegration.CRMConfig.syncConfig.reverseChronological,
            ).toBe(true);
            expect(
                ZohoCRMIntegration.CRMConfig.syncConfig.initialBatchSize,
            ).toBe(50);
        });

        it('should have queue configuration', () => {
            expect(ZohoCRMIntegration.CRMConfig.queueConfig).toBeDefined();
            expect(ZohoCRMIntegration.CRMConfig.queueConfig.maxWorkers).toBe(
                15,
            );
            expect(ZohoCRMIntegration.CRMConfig.queueConfig.provisioned).toBe(
                5,
            );
        });
    });

    describe('Required Methods - BaseCRMIntegration', () => {
        describe('fetchPersonPage', () => {
            it('should fetch contacts page correctly', async () => {
                const mockResponse = {
                    data: [
                        {
                            id: '1',
                            First_Name: 'John',
                            Last_Name: 'Doe',
                            Email: 'john@example.com',
                        },
                        {
                            id: '2',
                            First_Name: 'Jane',
                            Last_Name: 'Smith',
                            Email: 'jane@example.com',
                        },
                    ],
                    info: { more_records: false, page_token: null },
                };

                mockZohoCrm.api.listContacts.mockResolvedValue(mockResponse);

                const result = await integration.fetchPersonPage({
                    objectType: 'Contact',
                    cursor: null,
                    limit: 10,
                    sortDesc: true,
                });

                expect(result.data).toHaveLength(2);
                expect(result.data[0]._objectType).toBe('Contact');
                expect(result.hasMore).toBe(false);

                expect(mockZohoCrm.api.listContacts).toHaveBeenCalledWith({
                    per_page: 10,
                    sort_order: 'desc',
                    sort_by: 'Modified_Time',
                });
            });

            it('should fetch accounts page correctly', async () => {
                const mockResponse = {
                    data: [{ id: '1', Account_Name: 'Test Company' }],
                    info: { more_records: true, page_token: 'next-token' },
                };

                mockZohoCrm.api.listAccounts.mockResolvedValue(mockResponse);

                const result = await integration.fetchPersonPage({
                    objectType: 'Account',
                    cursor: null,
                    limit: 25,
                    sortDesc: false,
                });

                expect(result.data).toHaveLength(1);
                expect(result.data[0]._objectType).toBe('Account');
                expect(result.hasMore).toBe(true);

                expect(mockZohoCrm.api.listAccounts).toHaveBeenCalledWith({
                    per_page: 25,
                    sort_order: 'asc',
                    sort_by: 'Modified_Time',
                });
            });

            it('should include modifiedSince filter when provided', async () => {
                const mockDate = new Date('2025-01-01T00:00:00Z');
                const mockResponse = {
                    data: [],
                    info: { more_records: false },
                };

                mockZohoCrm.api.listContacts.mockResolvedValue(mockResponse);

                await integration.fetchPersonPage({
                    objectType: 'Contact',
                    cursor: null,
                    limit: 10,
                    modifiedSince: mockDate,
                });

                expect(mockZohoCrm.api.listContacts).toHaveBeenCalledWith(
                    expect.objectContaining({
                        modified_since: '2025-01-01',
                    }),
                );
            });
        });

        describe('transformPersonToQuo', () => {
            it('should transform Zoho contact to Quo format', async () => {
                const zohoContact = {
                    id: 'contact-123',
                    First_Name: 'John',
                    Last_Name: 'Doe',
                    Email: 'john@example.com',
                    Phone: '555-1234',
                    Mobile: '555-5678',
                    Account_Name: 'Acme Corp',
                    Industry: 'Technology',
                    Annual_Revenue: 1000000,
                    Rating: 'Hot',
                    Modified_Time: '2025-01-01T12:00:00Z',
                    Created_Time: '2024-01-01T12:00:00Z',
                    Owner: { name: 'Sales Rep', id: 'owner-123' },
                };

                const result =
                    await integration.transformPersonToQuo(zohoContact);

                expect(result.externalId).toBe('contact-123');
                expect(result.source).toBe('openphone-zoho');
                expect(result.sourceUrl).toBe(
                    'https://crm.zoho.com/crm/org12345/tab/Contacts/contact-123',
                );
                expect(result.defaultFields.firstName).toBe('John');
                expect(result.defaultFields.lastName).toBe('Doe');
                expect(result.defaultFields.phoneNumbers).toEqual([
                    { name: 'Work', value: '555-1234' },
                    { name: 'Mobile', value: '555-5678' },
                ]);
                expect(result.defaultFields.emails).toEqual([
                    { name: 'Work', value: 'john@example.com' },
                ]);
                expect(result.customFields).toEqual([]);
            });

            it('should transform Zoho account to Quo format', async () => {
                const zohoAccount = {
                    id: 'account-456',
                    Account_Name: 'Smith Industries',
                    Phone: '555-9999',
                    _objectType: 'Account',
                };

                const result =
                    await integration.transformPersonToQuo(zohoAccount);

                expect(result.source).toBe('openphone-zoho');
                expect(result.sourceUrl).toBe(
                    'https://crm.zoho.com/crm/org12345/tab/Accounts/account-456',
                );
                expect(result.externalId).toBe('account-456');
                expect(result.defaultFields.firstName).toBe('Smith Industries');
            });

            it('should handle minimal contact data', async () => {
                const minimalContact = {
                    id: 'minimal-789',
                    First_Name: 'Test',
                    Last_Name: 'User',
                };

                const result =
                    await integration.transformPersonToQuo(minimalContact);

                expect(result.externalId).toBe('minimal-789');
                expect(result.defaultFields.phoneNumbers).toEqual([]);
                expect(result.defaultFields.emails).toEqual([]);
            });

            it('should use Last_Name as firstName and empty lastName when First_Name is absent', async () => {
                const contactNoFirstName = {
                    id: 'contact-nofirst',
                    Last_Name: 'Smith',
                };

                const result =
                    await integration.transformPersonToQuo(contactNoFirstName);

                expect(result.defaultFields.firstName).toBe('Smith');
                expect(result.defaultFields.lastName).toBe('');
            });
        });

        describe('logSMSToActivity', () => {
            it('should log warning that SMS logging is not supported', async () => {
                const consoleSpy = jest
                    .spyOn(console, 'warn')
                    .mockImplementation();

                const activity = {
                    contactExternalId: 'contact-123',
                    direction: 'outbound',
                    content: 'Test SMS message',
                    timestamp: '2025-01-01T12:00:00Z',
                };

                await integration.logSMSToActivity(activity);

                expect(consoleSpy).toHaveBeenCalledWith(
                    'SMS activity logging not supported - Zoho CRM API module lacks activities endpoint',
                );

                consoleSpy.mockRestore();
            });
        });

        describe('logCallToActivity', () => {
            it('should log warning that call logging is not supported', async () => {
                const consoleSpy = jest
                    .spyOn(console, 'warn')
                    .mockImplementation();

                const activity = {
                    contactExternalId: 'contact-123',
                    direction: 'outbound',
                    duration: 300,
                    summary: 'Discussed project proposal',
                    timestamp: '2025-01-01T12:00:00Z',
                };

                await integration.logCallToActivity(activity);

                expect(consoleSpy).toHaveBeenCalledWith(
                    'Call activity logging not supported - Zoho CRM API module lacks activities endpoint',
                );

                consoleSpy.mockRestore();
            });
        });

        describe('_handleQuoCallEvent - Voice_Recording__s', () => {
            let mockWebhookData;

            beforeEach(() => {
                mockWebhookData = {
                    type: 'call.completed',
                    data: {
                        object: {
                            id: 'call-123',
                            status: 'completed',
                            direction: 'inbound',
                            duration: 120,
                            createdAt: '2025-01-01T12:00:00Z',
                            answeredAt: '2025-01-01T12:00:05Z',
                            phoneNumberId: 'phone-id-1',
                            userId: 'user-id-1',
                            participants: [
                                { phoneNumber: '+15550001111', type: 'user' },
                                {
                                    phoneNumber: '+15550002222',
                                    type: 'external',
                                },
                            ],
                        },
                        deepLink: 'https://app.openphone.com/calls/call-123',
                    },
                };

                integration.config = {
                    phoneNumbersMetadata: [{ phoneNumber: '+15550001111' }],
                };
                integration._findZohoContactByPhone = jest
                    .fn()
                    .mockResolvedValue('zoho-contact-id');
                integration.upsertMapping = jest.fn().mockResolvedValue({});
                integration._verifyQuoWebhookSignature = jest
                    .fn()
                    .mockResolvedValue();

                mockQuoApi.api.getCall = jest.fn().mockResolvedValue({
                    data: mockWebhookData.data.object,
                });
                mockQuoApi.api.getPhoneNumber = jest.fn().mockResolvedValue({
                    data: { number: '+15550001111', name: 'Sales' },
                });
                mockQuoApi.api.getUser = jest.fn().mockResolvedValue({
                    data: { firstName: 'John', lastName: 'Doe' },
                });
                mockZohoCrm.api.logCall = jest.fn().mockResolvedValue({
                    data: [
                        { details: { id: 'zoho-call-id' }, code: 'SUCCESS' },
                    ],
                });
            });

            it('should set Voice_Recording__s when a recording URL is available', async () => {
                mockQuoApi.api.getCallRecordings = jest.fn().mockResolvedValue({
                    data: [
                        {
                            id: 'rec-1',
                            url: 'https://recordings.example.com/rec-1.mp3',
                            duration: 120,
                        },
                    ],
                });

                await integration._handleQuoCallEvent(mockWebhookData);

                expect(mockZohoCrm.api.logCall).toHaveBeenCalledWith(
                    expect.objectContaining({
                        Voice_Recording__s:
                            'https://recordings.example.com/rec-1.mp3',
                    }),
                );
            });

            it('should not set Voice_Recording__s when no recording is available', async () => {
                mockQuoApi.api.getCallRecordings = jest
                    .fn()
                    .mockResolvedValue({ data: [] });

                await integration._handleQuoCallEvent(mockWebhookData);

                const logCallArg = mockZohoCrm.api.logCall.mock.calls[0][0];
                expect(logCallArg.Voice_Recording__s).toBeUndefined();
            });

            it('should set Voice_Recording__s from voicemail URL for missed calls', async () => {
                mockWebhookData.data.object.direction = 'inbound';
                mockWebhookData.data.object.answeredAt = null;
                mockWebhookData.data.object.duration = 0;
                mockWebhookData.data.object.voicemail = {
                    url: 'https://recordings.example.com/vm-1.mp3',
                    duration: 30,
                };

                mockQuoApi.api.getCall = jest.fn().mockResolvedValue({
                    data: mockWebhookData.data.object,
                });
                mockQuoApi.api.getCallRecordings = jest.fn();

                await integration._handleQuoCallEvent(mockWebhookData);

                expect(mockQuoApi.api.getCallRecordings).not.toHaveBeenCalled();
                expect(mockZohoCrm.api.logCall).toHaveBeenCalledWith(
                    expect.objectContaining({
                        Voice_Recording__s:
                            'https://recordings.example.com/vm-1.mp3',
                    }),
                );
            });

            it('should not crash when getCallRecordings fails', async () => {
                mockQuoApi.api.getCallRecordings = jest
                    .fn()
                    .mockRejectedValue(new Error('API error'));
                const consoleSpy = jest
                    .spyOn(console, 'warn')
                    .mockImplementation();

                await integration._handleQuoCallEvent(mockWebhookData);

                expect(consoleSpy).toHaveBeenCalledWith(
                    expect.stringContaining('Could not fetch recordings'),
                );
                const logCallArg = mockZohoCrm.api.logCall.mock.calls[0][0];
                expect(logCallArg.Voice_Recording__s).toBeUndefined();

                consoleSpy.mockRestore();
            });
        });

        describe('setupWebhooks', () => {
            it('should setup Zoho notifications and Quo webhooks', async () => {
                // Setup enabledPhoneIds for webhook creation
                integration.config = {
                    enabledPhoneIds: ['phone-1', 'phone-2'],
                };

                // Mock Zoho notification setup
                mockZohoCrm.api.enableNotification = jest
                    .fn()
                    .mockResolvedValue({
                        watch: [
                            {
                                status: 'success',
                                details: {
                                    events: [
                                        { resource_name: 'Accounts' },
                                        { resource_name: 'Contacts' },
                                    ],
                                },
                            },
                        ],
                    });

                // Mock Quo API methods
                mockQuoApi.api.getPhoneNumber = jest
                    .fn()
                    .mockImplementation((phoneId) => {
                        const phones = {
                            'phone-1': {
                                data: {
                                    id: 'phone-1',
                                    number: '+15551111111',
                                    name: 'Phone 1',
                                },
                            },
                            'phone-2': {
                                data: {
                                    id: 'phone-2',
                                    number: '+15552222222',
                                    name: 'Phone 2',
                                },
                            },
                        };
                        return Promise.resolve(
                            phones[phoneId] || { data: null },
                        );
                    });
                mockQuoApi.api.createMessageWebhook = jest
                    .fn()
                    .mockResolvedValue({
                        data: { id: 'msg-wh-123', key: 'msg-key' },
                    });
                mockQuoApi.api.createCallWebhook = jest.fn().mockResolvedValue({
                    data: { id: 'call-wh-123', key: 'call-key' },
                });
                mockQuoApi.api.createCallSummaryWebhook = jest
                    .fn()
                    .mockResolvedValue({
                        data: { id: 'summary-wh-123', key: 'summary-key' },
                    });

                integration.commands = {
                    updateIntegrationConfig: jest.fn().mockResolvedValue({}),
                };
                integration.updateIntegrationMessages = {
                    execute: jest.fn().mockResolvedValue({}),
                };

                process.env.BASE_URL = 'https://test.com';

                const result = await integration.setupWebhooks();

                expect(result.zoho.status).toBe('configured');
                expect(result.quo.status).toBe('configured');

                delete process.env.BASE_URL;
            });
        });
    });

    describe('Backward Compatibility - Existing Events', () => {
        it('should have LIST_ZOHO_CONTACTS event', () => {
            expect(integration.events.LIST_ZOHO_CONTACTS).toBeDefined();
            expect(
                integration.events.LIST_ZOHO_CONTACTS.handler,
            ).toBeInstanceOf(Function);
        });

        it('should have LIST_ZOHO_ACCOUNTS event', () => {
            expect(integration.events.LIST_ZOHO_ACCOUNTS).toBeDefined();
            expect(
                integration.events.LIST_ZOHO_ACCOUNTS.handler,
            ).toBeInstanceOf(Function);
        });
    });

    describe('Helper Methods', () => {
        describe('fetchPersonById', () => {
            it('should fetch contact by ID', async () => {
                const mockContact = { id: 'contact-123', First_Name: 'John' };
                mockZohoCrm.api.getContact.mockResolvedValue({
                    data: mockContact,
                });

                const result = await integration.fetchPersonById('contact-123');

                expect(result).toEqual({
                    ...mockContact,
                    _objectType: 'Contact',
                });
                expect(mockZohoCrm.api.getContact).toHaveBeenCalledWith(
                    'contact-123',
                );
            });

            it('should try account if contact not found', async () => {
                const mockAccount = {
                    id: 'account-456',
                    Account_Name: 'Test Company',
                };
                mockZohoCrm.api.getContact.mockRejectedValue(
                    new Error('Not found'),
                );
                mockZohoCrm.api.getAccount.mockResolvedValue({
                    data: mockAccount,
                });

                const result = await integration.fetchPersonById('account-456');

                expect(result).toEqual({
                    ...mockAccount,
                    _objectType: 'Account',
                });
            });

            it('should throw error if neither contact nor account found', async () => {
                mockZohoCrm.api.getContact.mockRejectedValue(
                    new Error('Not found'),
                );
                mockZohoCrm.api.getAccount.mockRejectedValue(
                    new Error('Not found'),
                );

                await expect(
                    integration.fetchPersonById('invalid-id'),
                ).rejects.toThrow('Person not found: invalid-id');
            });
        });

        describe('_syncPersonToQuo with upsertContactToQuo', () => {
            beforeEach(() => {
                mockQuoApi.api.createContact = jest.fn();
                mockQuoApi.api.updateContact = jest.fn();
                mockQuoApi.api.listContacts = jest.fn();
                integration._fetchZohoObject = jest.fn();
                integration.transformPersonToQuo = jest.fn();
                integration.commands.findOrganizationUserById = jest
                    .fn()
                    .mockResolvedValue({
                        id: 'user-123',
                        appOrgId: 'org-123',
                    });
            });

            it('should use upsertContactToQuo for insert operation', async () => {
                const recordId = 'zoho-123';
                const objectType = 'Contacts';
                const operation = 'insert';

                const mockZohoPerson = {
                    id: recordId,
                    First_Name: 'John',
                    Last_Name: 'Doe',
                };

                const mockQuoContact = {
                    externalId: recordId,
                    source: 'openphone-zoho',
                    defaultFields: {
                        firstName: 'John',
                        lastName: 'Doe',
                        phoneNumbers: [{ name: 'Work', value: '+15551234567' }],
                    },
                };

                integration._fetchZohoObject.mockResolvedValue(mockZohoPerson);
                integration.transformPersonToQuo.mockResolvedValue(
                    mockQuoContact,
                );
                integration.upsertContactToQuo = jest.fn().mockResolvedValue({
                    action: 'created',
                    quoContactId: 'quo-contact-123',
                    externalId: recordId,
                });

                await integration._syncPersonToQuo(
                    objectType,
                    recordId,
                    operation,
                );

                expect(integration.upsertContactToQuo).toHaveBeenCalledWith(
                    expect.objectContaining({
                        externalId: recordId,
                    }),
                );
                expect(mockQuoApi.api.createContact).not.toHaveBeenCalled();
            });

            it('should handle upsertContactToQuo errors for insert', async () => {
                const recordId = 'zoho-error';
                const objectType = 'Contacts';
                const operation = 'insert';

                integration._fetchZohoObject.mockResolvedValue({
                    id: recordId,
                });
                integration.transformPersonToQuo.mockResolvedValue({
                    externalId: recordId,
                    defaultFields: { firstName: 'Test' },
                });
                integration.upsertContactToQuo = jest
                    .fn()
                    .mockRejectedValue(new Error('Failed to create contact'));

                await expect(
                    integration._syncPersonToQuo(
                        objectType,
                        recordId,
                        operation,
                    ),
                ).rejects.toThrow('Failed to create contact');
            });

            it('should use upsertContactToQuo for update operation', async () => {
                const recordId = 'zoho-456';
                const objectType = 'Contacts';
                const operation = 'update';

                const mockQuoContact = {
                    externalId: recordId,
                    defaultFields: {
                        firstName: 'Jane',
                        lastName: 'Smith',
                        phoneNumbers: [
                            { name: 'Mobile', value: '+15559999999' },
                        ],
                    },
                };

                integration._fetchZohoObject.mockResolvedValue({
                    id: recordId,
                });
                integration.transformPersonToQuo.mockResolvedValue(
                    mockQuoContact,
                );

                integration.upsertContactToQuo = jest.fn().mockResolvedValue({
                    action: 'updated',
                    quoContactId: 'quo-contact-456',
                    externalId: recordId,
                });

                await integration._syncPersonToQuo(
                    objectType,
                    recordId,
                    operation,
                );

                expect(integration.upsertContactToQuo).toHaveBeenCalledWith(
                    expect.objectContaining({
                        externalId: recordId,
                    }),
                );
                expect(mockQuoApi.api.updateContact).not.toHaveBeenCalled();
            });

            it('should handle upsertContactToQuo errors for update', async () => {
                const recordId = 'zoho-789';
                const objectType = 'Contacts';
                const operation = 'update';

                integration._fetchZohoObject.mockResolvedValue({
                    id: recordId,
                });
                integration.transformPersonToQuo.mockResolvedValue({
                    externalId: recordId,
                    defaultFields: { firstName: 'Test' },
                });

                integration.upsertContactToQuo = jest
                    .fn()
                    .mockRejectedValue(new Error('Contact update failed'));

                await expect(
                    integration._syncPersonToQuo(
                        objectType,
                        recordId,
                        operation,
                    ),
                ).rejects.toThrow('Contact update failed');
            });
        });

        describe('_handleQuoMessageEvent', () => {
            it('should use HTML formatting without emoji for message content', async () => {
                const processMessageEventSpy = jest
                    .spyOn(QuoWebhookEventProcessor, 'processMessageEvent')
                    .mockResolvedValue({
                        received: true,
                        logged: true,
                    });

                const webhookData = {
                    data: {
                        object: {
                            id: 'msg-123',
                            direction: 'incoming',
                            from: '+15551234567',
                            to: '+15559876543',
                            text: 'Test message',
                        },
                    },
                };

                await integration._handleQuoMessageEvent(webhookData);

                expect(processMessageEventSpy).toHaveBeenCalledWith(
                    expect.objectContaining({
                        webhookData,
                        crmAdapter: expect.objectContaining({
                            formatMethod: 'html',
                            useEmoji: false,
                        }),
                    }),
                );

                processMessageEventSpy.mockRestore();
            });
        });
    });

    describe('_findZohoContactByPhone', () => {
        beforeEach(() => {
            integration.zoho = mockZohoCrm;
            integration._normalizePhoneNumber = jest
                .fn()
                .mockReturnValue('+15550001111');
        });

        it('should return contact ID when criteria search succeeds', async () => {
            mockZohoCrm.api.searchContacts.mockResolvedValue({
                data: [{ id: 'zoho-contact-123' }],
            });

            const result =
                await integration._findZohoContactByPhone('+15550001111');

            expect(result).toBe('zoho-contact-123');
            expect(mockZohoCrm.api.searchContacts).toHaveBeenCalledWith({
                criteria:
                    '((Phone:equals:+15550001111)or(Mobile:equals:+15550001111))',
            });
        });

        it('should return null when no contacts found', async () => {
            mockZohoCrm.api.searchContacts.mockResolvedValue({
                data: [],
            });

            const result =
                await integration._findZohoContactByPhone('+15550001111');

            expect(result).toBeNull();
        });

        it('should fall back to phone param when INVALID_QUERY error occurs', async () => {
            mockZohoCrm.api.searchContacts
                .mockRejectedValueOnce(
                    new Error(
                        'INVALID_QUERY: the field is not available for search',
                    ),
                )
                .mockResolvedValueOnce({
                    data: [{ id: 'zoho-contact-456' }],
                });

            const result =
                await integration._findZohoContactByPhone('+15550001111');

            expect(result).toBe('zoho-contact-456');
            expect(mockZohoCrm.api.searchContacts).toHaveBeenCalledTimes(2);
            expect(mockZohoCrm.api.searchContacts).toHaveBeenNthCalledWith(1, {
                criteria:
                    '((Phone:equals:+15550001111)or(Mobile:equals:+15550001111))',
            });
            expect(mockZohoCrm.api.searchContacts).toHaveBeenNthCalledWith(2, {
                phone: '+15550001111',
            });
        });

        it('should return null when phone param fallback also finds nothing', async () => {
            mockZohoCrm.api.searchContacts
                .mockRejectedValueOnce(
                    new Error(
                        'INVALID_QUERY: the field is not available for search',
                    ),
                )
                .mockResolvedValueOnce({ data: [] });

            const result =
                await integration._findZohoContactByPhone('+15550001111');

            expect(result).toBeNull();
        });

        it('should re-throw transient errors to allow SQS retry', async () => {
            const originalError = new Error('500 Internal Server Error');
            mockZohoCrm.api.searchContacts.mockRejectedValue(originalError);

            await expect(
                integration._findZohoContactByPhone('+15550001111'),
            ).rejects.toBe(originalError);
        });

        it('should re-throw when phone param fallback also fails', async () => {
            const fallbackError = new Error('Network timeout');
            mockZohoCrm.api.searchContacts
                .mockRejectedValueOnce(
                    new Error(
                        'INVALID_QUERY: the field is not available for search',
                    ),
                )
                .mockRejectedValueOnce(fallbackError);

            await expect(
                integration._findZohoContactByPhone('+15550001111'),
            ).rejects.toBe(fallbackError);
        });
    });
});
