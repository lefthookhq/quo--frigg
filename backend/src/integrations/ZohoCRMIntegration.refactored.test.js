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

const ZohoCRMIntegration = require('./ZohoCRMIntegration.refactored');

describe('ZohoCRMIntegration (Refactored)', () => {
    let integration;
    let mockZohoApi;
    let mockQuoApi;

    beforeEach(() => {
        // Create mock APIs
        mockZohoApi = {
            api: {
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
            },
        };

        // Create integration instance
        integration = new ZohoCRMIntegration();
        integration.zoho = mockZohoApi;
        integration.quo = mockQuoApi;
        integration.id = 'test-integration-id';
        integration.userId = 'test-user-id';
    });

    describe('Static Configuration', () => {
        it('should have correct Definition', () => {
            expect(ZohoCRMIntegration.Definition).toBeDefined();
            expect(ZohoCRMIntegration.Definition.name).toBe('zohocrm');
            expect(ZohoCRMIntegration.Definition.version).toBe('1.0.0');
            expect(ZohoCRMIntegration.Definition.display.label).toBe('Zoho CRM');
        });

        it('should have correct CRMConfig', () => {
            expect(ZohoCRMIntegration.CRMConfig).toBeDefined();
            expect(ZohoCRMIntegration.CRMConfig.personObjectTypes).toHaveLength(2);
            expect(ZohoCRMIntegration.CRMConfig.personObjectTypes[0].crmObjectName).toBe('Contact');
            expect(ZohoCRMIntegration.CRMConfig.personObjectTypes[1].crmObjectName).toBe('Lead');
            expect(ZohoCRMIntegration.CRMConfig.syncConfig.reverseChronological).toBe(true);
            expect(ZohoCRMIntegration.CRMConfig.syncConfig.initialBatchSize).toBe(50);
        });

        it('should have queue configuration', () => {
            expect(ZohoCRMIntegration.CRMConfig.queueConfig).toBeDefined();
            expect(ZohoCRMIntegration.CRMConfig.queueConfig.maxWorkers).toBe(15);
            expect(ZohoCRMIntegration.CRMConfig.queueConfig.provisioned).toBe(5);
        });
    });

    describe('Required Methods - BaseCRMIntegration', () => {
        describe('fetchPersonPage', () => {
            it('should fetch contacts page correctly', async () => {
                const mockResponse = {
                    data: [
                        { id: '1', First_Name: 'John', Last_Name: 'Doe', Email: 'john@example.com' },
                        { id: '2', First_Name: 'Jane', Last_Name: 'Smith', Email: 'jane@example.com' },
                    ],
                    info: { count: 2, more_records: false },
                };

                mockZohoApi.api.contacts.getAll.mockResolvedValue(mockResponse);

                const result = await integration.fetchPersonPage({
                    objectType: 'Contact',
                    page: 0,
                    limit: 10,
                    sortDesc: true,
                });

                expect(result).toEqual({
                    data: mockResponse.data,
                    total: 2,
                    hasMore: false,
                });

                expect(mockZohoApi.api.contacts.getAll).toHaveBeenCalledWith({
                    per_page: 10,
                    page: 1, // Converted from 0-indexed to 1-indexed
                    sort_order: 'desc',
                    sort_by: 'Modified_Time',
                });
            });

            it('should fetch leads page correctly', async () => {
                const mockResponse = {
                    data: [{ id: '1', First_Name: 'Test', Last_Name: 'Lead' }],
                    info: { count: 1, more_records: true },
                };

                mockZohoApi.api.leads.getAll.mockResolvedValue(mockResponse);

                const result = await integration.fetchPersonPage({
                    objectType: 'Lead',
                    page: 2,
                    limit: 25,
                    sortDesc: false,
                });

                expect(result).toEqual({
                    data: mockResponse.data,
                    total: 1,
                    hasMore: true,
                });

                expect(mockZohoApi.api.leads.getAll).toHaveBeenCalledWith({
                    per_page: 25,
                    page: 3, // Converted from 0-indexed to 1-indexed
                    sort_order: 'asc',
                    sort_by: 'Modified_Time',
                });
            });

            it('should include modifiedSince filter when provided', async () => {
                const mockDate = new Date('2025-01-01T00:00:00Z');
                const mockResponse = {
                    data: [],
                    info: { count: 0, more_records: false },
                };

                mockZohoApi.api.contacts.getAll.mockResolvedValue(mockResponse);

                await integration.fetchPersonPage({
                    objectType: 'Contact',
                    page: 0,
                    limit: 10,
                    modifiedSince: mockDate,
                });

                expect(mockZohoApi.api.contacts.getAll).toHaveBeenCalledWith(
                    expect.objectContaining({
                        modified_since: '2025-01-01',
                    })
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

                const result = await integration.transformPersonToQuo(zohoContact);

                expect(result).toEqual({
                    externalId: 'contact-123',
                    source: 'zoho-contact',
                    defaultFields: {
                        firstName: 'John',
                        lastName: 'Doe',
                        company: 'Acme Corp',
                        phoneNumbers: [
                            { name: 'work', value: '555-1234' },
                            { name: 'mobile', value: '555-5678' },
                        ],
                        emails: [{ name: 'work', value: 'john@example.com' }],
                    },
                    customFields: {
                        crmId: 'contact-123',
                        crmType: 'zoho',
                        leadSource: undefined,
                        industry: 'Technology',
                        annualRevenue: 1000000,
                        rating: 'Hot',
                        lastModified: '2025-01-01T12:00:00Z',
                        createdTime: '2024-01-01T12:00:00Z',
                        owner: 'Sales Rep',
                        ownerId: 'owner-123',
                    },
                });
            });

            it('should transform Zoho lead to Quo format', async () => {
                const zohoLead = {
                    id: 'lead-456',
                    First_Name: 'Jane',
                    Last_Name: 'Smith',
                    Email: 'jane@example.com',
                    Company: 'Smith Industries',
                    Lead_Source: 'Website',
                    Modified_Time: '2025-01-01T12:00:00Z',
                    Created_Time: '2024-01-01T12:00:00Z',
                };

                const result = await integration.transformPersonToQuo(zohoLead);

                expect(result.source).toBe('zoho-lead');
                expect(result.externalId).toBe('lead-456');
                expect(result.defaultFields.company).toBe('Smith Industries');
                expect(result.customFields.leadSource).toBe('Website');
            });

            it('should handle minimal contact data', async () => {
                const minimalContact = {
                    id: 'minimal-789',
                    First_Name: 'Test',
                    Last_Name: 'User',
                };

                const result = await integration.transformPersonToQuo(minimalContact);

                expect(result.externalId).toBe('minimal-789');
                expect(result.defaultFields.phoneNumbers).toEqual([]);
                expect(result.defaultFields.emails).toEqual([]);
            });
        });

        describe('logSMSToActivity', () => {
            it('should log SMS activity to Zoho', async () => {
                const mockContact = { id: 'contact-123', First_Name: 'John', Last_Name: 'Doe' };
                mockZohoApi.api.contacts.get.mockResolvedValue({ data: mockContact });
                mockZohoApi.api.activities.create.mockResolvedValue({ id: 'activity-123' });

                const activity = {
                    contactExternalId: 'contact-123',
                    direction: 'outbound',
                    content: 'Test SMS message',
                    timestamp: '2025-01-01T12:00:00Z',
                };

                await integration.logSMSToActivity(activity);

                expect(mockZohoApi.api.contacts.get).toHaveBeenCalledWith('contact-123');
                expect(mockZohoApi.api.activities.create).toHaveBeenCalledWith({
                    Subject: 'SMS: outbound',
                    Description: 'Test SMS message',
                    Who_Id: 'contact-123',
                    Activity_Type: 'SMS',
                    Status: 'Completed',
                    Start_DateTime: '2025-01-01T12:00:00Z',
                });
            });

            it('should try lead if contact not found', async () => {
                const mockLead = { id: 'lead-456', First_Name: 'Jane', Last_Name: 'Smith' };
                mockZohoApi.api.contacts.get.mockRejectedValue(new Error('Not found'));
                mockZohoApi.api.leads.get.mockResolvedValue({ data: mockLead });
                mockZohoApi.api.activities.create.mockResolvedValue({ id: 'activity-456' });

                const activity = {
                    contactExternalId: 'lead-456',
                    direction: 'inbound',
                    content: 'Test SMS',
                    timestamp: '2025-01-01T12:00:00Z',
                };

                await integration.logSMSToActivity(activity);

                expect(mockZohoApi.api.leads.get).toHaveBeenCalledWith('lead-456');
                expect(mockZohoApi.api.activities.create).toHaveBeenCalled();
            });
        });

        describe('logCallToActivity', () => {
            it('should log call activity to Zoho', async () => {
                const mockContact = { id: 'contact-123', First_Name: 'John', Last_Name: 'Doe' };
                mockZohoApi.api.contacts.get.mockResolvedValue({ data: mockContact });
                mockZohoApi.api.activities.create.mockResolvedValue({ id: 'activity-123' });

                const activity = {
                    contactExternalId: 'contact-123',
                    direction: 'outbound',
                    duration: 300,
                    summary: 'Discussed project proposal',
                    timestamp: '2025-01-01T12:00:00Z',
                };

                await integration.logCallToActivity(activity);

                expect(mockZohoApi.api.activities.create).toHaveBeenCalledWith({
                    Subject: 'Call: outbound (300s)',
                    Description: 'Discussed project proposal',
                    Who_Id: 'contact-123',
                    Activity_Type: 'Call',
                    Status: 'Completed',
                    Start_DateTime: '2025-01-01T12:00:00Z',
                    Duration: 300,
                });
            });
        });

        describe('setupWebhooks', () => {
            it('should log that webhooks are not configured', async () => {
                const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

                await integration.setupWebhooks();

                expect(consoleSpy).toHaveBeenCalledWith(
                    'Zoho CRM webhooks not configured - using polling fallback'
                );

                consoleSpy.mockRestore();
            });
        });
    });

    describe('Backward Compatibility - Existing Events', () => {
        it('should have LIST_ZOHO_LEADS event', () => {
            expect(integration.events.LIST_ZOHO_LEADS).toBeDefined();
            expect(integration.events.LIST_ZOHO_LEADS.handler).toBeInstanceOf(Function);
        });

        it('should have LIST_ZOHO_CONTACTS event', () => {
            expect(integration.events.LIST_ZOHO_CONTACTS).toBeDefined();
            expect(integration.events.LIST_ZOHO_CONTACTS.handler).toBeInstanceOf(Function);
        });

        it('should have LIST_ZOHO_DEALS event', () => {
            expect(integration.events.LIST_ZOHO_DEALS).toBeDefined();
            expect(integration.events.LIST_ZOHO_DEALS.handler).toBeInstanceOf(Function);
        });

        it('should have LIST_ZOHO_ACCOUNTS event', () => {
            expect(integration.events.LIST_ZOHO_ACCOUNTS).toBeDefined();
            expect(integration.events.LIST_ZOHO_ACCOUNTS.handler).toBeInstanceOf(Function);
        });
    });

    describe('Helper Methods', () => {
        describe('fetchPersonById', () => {
            it('should fetch contact by ID', async () => {
                const mockContact = { id: 'contact-123', First_Name: 'John' };
                mockZohoApi.api.contacts.get.mockResolvedValue({ data: mockContact });

                const result = await integration.fetchPersonById('contact-123');

                expect(result).toEqual(mockContact);
                expect(mockZohoApi.api.contacts.get).toHaveBeenCalledWith('contact-123');
            });

            it('should try lead if contact not found', async () => {
                const mockLead = { id: 'lead-456', First_Name: 'Jane' };
                mockZohoApi.api.contacts.get.mockRejectedValue(new Error('Not found'));
                mockZohoApi.api.leads.get.mockResolvedValue({ data: mockLead });

                const result = await integration.fetchPersonById('lead-456');

                expect(result).toEqual(mockLead);
            });

            it('should throw error if neither contact nor lead found', async () => {
                mockZohoApi.api.contacts.get.mockRejectedValue(new Error('Not found'));
                mockZohoApi.api.leads.get.mockRejectedValue(new Error('Not found'));

                await expect(integration.fetchPersonById('invalid-id')).rejects.toThrow(
                    'Person not found: invalid-id'
                );
            });
        });
    });
});

