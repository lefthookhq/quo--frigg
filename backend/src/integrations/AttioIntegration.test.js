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

            async onDelete() {
                // Mock implementation - does nothing
            }
        },
    };
});

const AttioIntegration = require('./AttioIntegration');

describe('AttioIntegration (Refactored)', () => {
    let integration;
    let mockAttioApi;
    let mockQuoApi;

    beforeEach(() => {
        // Create mock APIs
        mockAttioApi = {
            api: {
                listObjects: jest.fn(),
                listRecords: jest.fn(),
                getRecord: jest.fn(),
                createRecord: jest.fn(),
                listNotes: jest.fn(),
                getNote: jest.fn(),
                createNote: jest.fn(),
                deleteNote: jest.fn(),
                listWebhooks: jest.fn(),
                getWebhook: jest.fn(),
                createWebhook: jest.fn(),
                deleteWebhook: jest.fn(),
                searchRecords: jest.fn(),
                objects: {
                    getRecord: jest.fn(),
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
                updateWebhook: jest.fn(),
                deleteWebhook: jest.fn(),
                getContact: jest.fn(),
                updateContact: jest.fn(),
            },
        };

        // Create integration instance
        integration = new AttioIntegration();
        integration.attio = mockAttioApi;
        integration.quo = mockQuoApi;
        integration.id = 'test-integration-id';
        integration.userId = 'test-user-id';

        // Mock base class methods that are called by AttioIntegration
        integration._fetchAndStoreEnabledPhoneIds = jest.fn().mockResolvedValue(['phone-1', 'phone-2']);
        integration._createQuoWebhooksWithPhoneIds = jest.fn().mockResolvedValue({
            messageWebhookId: 'quo-msg-wh-456',
            messageWebhookKey: 'quo-msg-key',
            callWebhookId: 'quo-call-wh-789',
            callWebhookKey: 'quo-call-key',
            callSummaryWebhookId: 'quo-summary-wh-abc',
            callSummaryWebhookKey: 'quo-summary-key',
        });
        integration._findAttioContactFromQuoWebhook = jest.fn();
        integration._getExternalIdFromMappingByPhone = jest.fn();
        integration.getMapping = jest.fn();
        integration._upsertContactMapping = jest.fn().mockResolvedValue({});
    });

    describe('Static Configuration', () => {
        it('should have correct Definition', () => {
            expect(AttioIntegration.Definition).toBeDefined();
            expect(AttioIntegration.Definition.name).toBe('attio');
            expect(AttioIntegration.Definition.version).toBe('1.0.0');
            expect(AttioIntegration.Definition.display.label).toBe('Attio');
        });

        it('should have quo module with correct name and label overrides', () => {
            expect(AttioIntegration.Definition.modules.quo).toBeDefined();
            expect(AttioIntegration.Definition.modules.quo.definition).toBeDefined();
            
            // Test name override
            expect(AttioIntegration.Definition.modules.quo.definition.getName()).toBe('quo-attio');
            expect(AttioIntegration.Definition.modules.quo.definition.moduleName).toBe('quo-attio');
            
            // Test label override (if display property exists)
            if (AttioIntegration.Definition.modules.quo.definition.display) {
                expect(AttioIntegration.Definition.modules.quo.definition.display.label).toBe('Quo (Attio)');
            }
        });

        it('should have correct CRMConfig', () => {
            expect(AttioIntegration.CRMConfig).toBeDefined();
            expect(AttioIntegration.CRMConfig.personObjectTypes).toHaveLength(
                1,
            );
            expect(
                AttioIntegration.CRMConfig.personObjectTypes[0].crmObjectName,
            ).toBe('people');
            expect(AttioIntegration.CRMConfig.syncConfig.paginationType).toBe(
                'CURSOR_BASED',
            );
            expect(AttioIntegration.CRMConfig.syncConfig.supportsTotal).toBe(
                false,
            );
            expect(
                AttioIntegration.CRMConfig.syncConfig.returnFullRecords,
            ).toBe(true);
            expect(AttioIntegration.CRMConfig.syncConfig.supportsWebhooks).toBe(
                true,
            );
            expect(AttioIntegration.CRMConfig.syncConfig.initialBatchSize).toBe(
                50,
            );
        });

        it('should have queue configuration', () => {
            expect(AttioIntegration.CRMConfig.queueConfig).toBeDefined();
            expect(AttioIntegration.CRMConfig.queueConfig.maxWorkers).toBe(15);
            expect(AttioIntegration.CRMConfig.queueConfig.provisioned).toBe(5);
        });
    });

    describe('Required Methods - BaseCRMIntegration', () => {
        describe('fetchPersonPage', () => {
            it('should fetch people page correctly with cursor', async () => {
                const mockResponse = {
                    data: [
                        {
                            id: { record_id: 'rec1', object_id: 'people' },
                            values: {
                                name: [
                                    { first_name: 'John', last_name: 'Doe' },
                                ],
                                email_addresses: [
                                    {
                                        email_address: 'john@example.com',
                                        is_primary: true,
                                        attribute_type: 'work',
                                    },
                                ],
                            },
                            created_at: '2025-01-01T00:00:00Z',
                            updated_at: '2025-01-10T00:00:00Z',
                        },
                    ],
                };

                mockAttioApi.api.listRecords.mockResolvedValue(mockResponse);

                const result = await integration.fetchPersonPage({
                    objectType: 'people',
                    cursor: null,
                    limit: 10,
                    sortDesc: true,
                });

                expect(result).toEqual({
                    data: mockResponse.data,
                    cursor: null, // Only 1 record, less than limit
                    hasMore: false,
                });

                expect(mockAttioApi.api.listRecords).toHaveBeenCalledWith(
                    'people',
                    {
                        limit: 10,
                        offset: 0,
                    },
                );
            });

            it('should calculate next cursor when full page returned', async () => {
                // Create a full page of 50 records
                const mockData = Array.from({ length: 50 }, (_, i) => ({
                    id: { record_id: `rec${i}`, object_id: 'people' },
                    values: {},
                }));

                const mockResponse = {
                    data: mockData,
                };

                mockAttioApi.api.listRecords.mockResolvedValue(mockResponse);

                const result = await integration.fetchPersonPage({
                    objectType: 'people',
                    cursor: 100,
                    limit: 50,
                    sortDesc: false,
                });

                expect(result.data).toHaveLength(50);
                expect(result.cursor).toBe(150); // cursor (100) + limit (50)
                expect(result.hasMore).toBe(true);

                expect(mockAttioApi.api.listRecords).toHaveBeenCalledWith(
                    'people',
                    {
                        limit: 50,
                        offset: 100,
                    },
                );
            });
        });

        describe('transformPersonToQuo', () => {
            it('should transform Attio person to Quo format', async () => {
                const attioPerson = {
                    id: { record_id: 'rec123', object_id: 'people' },
                    values: {
                        name: [
                            {
                                first_name: 'John',
                                last_name: 'Doe',
                                active_until: null,
                            },
                        ],
                        email_addresses: [
                            {
                                email_address: 'john@example.com',
                                active_until: null,
                            },
                            {
                                email_address: 'john.doe@personal.com',
                                active_until: null,
                            },
                        ],
                        phone_numbers: [
                            { phone_number: '555-1234', active_until: null },
                            { phone_number: '555-5678', active_until: null },
                        ],
                        company: [],
                    },
                    created_at: '2025-01-01T00:00:00Z',
                    updated_at: '2025-01-10T00:00:00Z',
                };

                const result =
                    await integration.transformPersonToQuo(attioPerson);

                expect(result).toEqual({
                    externalId: 'rec123',
                    source: 'openphone-attio',
                    sourceUrl: 'https://app.attio.com/people/rec123',
                    defaultFields: {
                        firstName: 'John',
                        lastName: 'Doe',
                        company: null,
                        role: null,
                        phoneNumbers: [
                            { name: 'Phone', value: '555-1234' },
                            { name: 'Phone', value: '555-5678' },
                        ],
                        emails: [
                            { name: 'Email', value: 'john@example.com' },
                            { name: 'Email', value: 'john.doe@personal.com' },
                        ],
                    },
                    customFields: [],
                });
            });

            it('should fetch company when company reference exists', async () => {
                const attioPerson = {
                    id: { record_id: 'rec123', object_id: 'people' },
                    values: {
                        name: [
                            {
                                first_name: 'Jane',
                                last_name: 'Smith',
                                active_until: null,
                            },
                        ],
                        email_addresses: [],
                        phone_numbers: [],
                        company: [
                            { target_record_id: 'comp123', active_until: null },
                        ],
                    },
                    created_at: '2025-01-01T00:00:00Z',
                    updated_at: '2025-01-10T00:00:00Z',
                };

                // Mock the company fetch (implementation uses api.getRecord, not api.objects.getRecord)
                mockAttioApi.api.getRecord.mockResolvedValue({
                    data: {
                        values: {
                            name: [{ value: 'Acme Corp' }],
                        },
                    },
                });

                const result =
                    await integration.transformPersonToQuo(attioPerson);

                // Verify company was fetched and set
                expect(result.defaultFields.company).toBe('Acme Corp');
                expect(mockAttioApi.api.getRecord).toHaveBeenCalledWith(
                    'companies',
                    'comp123',
                );
            });

            it('should handle missing company gracefully', async () => {
                const attioPerson = {
                    id: { record_id: 'rec123', object_id: 'people' },
                    values: {
                        name: [
                            {
                                first_name: 'Jane',
                                last_name: 'Smith',
                                active_until: null,
                            },
                        ],
                        email_addresses: [],
                        phone_numbers: [],
                        // No company attribute
                    },
                    created_at: '2025-01-01T00:00:00Z',
                    updated_at: '2025-01-10T00:00:00Z',
                };

                const result =
                    await integration.transformPersonToQuo(attioPerson);

                // Company should be null when attribute doesn't exist
                expect(result.defaultFields.company).toBeNull();
                expect(mockAttioApi.api.getRecord).not.toHaveBeenCalled();
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

                const result =
                    await integration.transformPersonToQuo(minimalPerson);

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
                mockAttioApi.api.getRecord.mockResolvedValue({
                    data: mockPerson,
                });
                mockAttioApi.api.createNote.mockResolvedValue({
                    id: 'note123',
                });

                const activity = {
                    contactExternalId: 'rec123',
                    direction: 'outbound',
                    content: 'Test SMS message',
                    timestamp: '2025-01-10T15:30:00Z',
                };

                await integration.logSMSToActivity(activity);

                expect(mockAttioApi.api.getRecord).toHaveBeenCalledWith(
                    'people',
                    'rec123',
                );
                expect(mockAttioApi.api.createNote).toHaveBeenCalledWith({
                    parent_object: 'people',
                    parent_record_id: 'rec123',
                    title: 'SMS: outbound',
                    format: 'markdown',
                    content: 'Test SMS message',
                    created_at: '2025-01-10T15:30:00Z',
                });
            });

            it('should handle person not found gracefully', async () => {
                mockAttioApi.api.getRecord.mockResolvedValue(null);

                const activity = {
                    contactExternalId: 'rec999',
                    direction: 'inbound',
                    content: 'Test SMS',
                    timestamp: '2025-01-10T15:30:00Z',
                };

                const consoleSpy = jest
                    .spyOn(console, 'warn')
                    .mockImplementation();

                await integration.logSMSToActivity(activity);

                expect(consoleSpy).toHaveBeenCalledWith(
                    'Person not found for SMS logging: rec999',
                );
                expect(mockAttioApi.api.createNote).not.toHaveBeenCalled();

                consoleSpy.mockRestore();
            });
        });

        describe('logCallToActivity', () => {
            it('should log call activity to Attio as a note', async () => {
                const mockPerson = {
                    id: { record_id: 'rec123', object_id: 'people' },
                };
                mockAttioApi.api.getRecord.mockResolvedValue({
                    data: mockPerson,
                });
                mockAttioApi.api.createNote.mockResolvedValue({
                    id: 'note123',
                });

                const activity = {
                    contactExternalId: 'rec123',
                    direction: 'outbound',
                    duration: 300,
                    summary: 'Discussed project proposal',
                    timestamp: '2025-01-10T15:30:00Z',
                };

                await integration.logCallToActivity(activity);

                expect(mockAttioApi.api.createNote).toHaveBeenCalledWith({
                    parent_object: 'people',
                    parent_record_id: 'rec123',
                    title: 'Call: outbound (300s)',
                    format: 'markdown',
                    content: 'Discussed project proposal',
                    created_at: '2025-01-10T15:30:00Z',
                });
            });
        });

        describe('setupWebhooks', () => {
            beforeEach(() => {
                // Mock integration dependencies
                integration.commands = {
                    updateIntegrationConfig: jest.fn().mockResolvedValue({}),
                };
                integration.updateIntegrationMessages = {
                    execute: jest.fn().mockResolvedValue({}),
                };
                integration.config = {}; // Start with empty config

                // Reset base class method mocks to default values
                integration._fetchAndStoreEnabledPhoneIds.mockResolvedValue(['phone-1', 'phone-2']);
                integration._createQuoWebhooksWithPhoneIds.mockResolvedValue({
                    messageWebhookId: 'quo-msg-wh-456',
                    messageWebhookKey: 'quo-msg-key',
                    callWebhookId: 'quo-call-wh-789',
                    callWebhookKey: 'quo-call-key',
                    callSummaryWebhookId: 'quo-summary-wh-abc',
                    callSummaryWebhookKey: 'quo-summary-key',
                });
            });

            it('should setup both Attio and Quo webhooks', async () => {
                process.env.BASE_URL = 'https://api.example.com';

                // Mock Attio webhook response
                mockAttioApi.api.createWebhook.mockResolvedValue({
                    data: {
                        id: { webhook_id: 'attio-wh-123' },
                        secret: 'attio-secret-xyz',
                    },
                });

                const result = await integration.setupWebhooks();

                // Verify Attio webhook creation
                expect(mockAttioApi.api.createWebhook).toHaveBeenCalledWith({
                    target_url: expect.stringContaining('/webhooks/'),
                    subscriptions: [
                        { event_type: 'record.created', filter: null },
                        { event_type: 'record.updated', filter: null },
                        { event_type: 'record.deleted', filter: null },
                    ],
                });

                // Verify base class methods were called for Quo webhooks
                expect(integration._fetchAndStoreEnabledPhoneIds).toHaveBeenCalled();
                expect(integration._createQuoWebhooksWithPhoneIds).toHaveBeenCalledWith(
                    expect.stringContaining('/webhooks/')
                );

                // Verify config was updated
                expect(
                    integration.commands.updateIntegrationConfig,
                ).toHaveBeenCalled();

                // Verify result structure
                expect(result).toEqual({
                    attio: expect.objectContaining({ status: 'configured' }),
                    quo: expect.objectContaining({ status: 'configured' }),
                    overallStatus: 'success',
                });
            });

            it('should handle already configured webhooks', async () => {
                integration.config = {
                    attioWebhookId: 'existing-attio-wh',
                    quoMessageWebhookId: 'existing-quo-msg-wh',
                    quoCallWebhookId: 'existing-quo-call-wh',
                    quoCallSummaryWebhookId: 'existing-quo-summary-wh',
                };

                const result = await integration.setupWebhooks();

                expect(mockAttioApi.api.createWebhook).not.toHaveBeenCalled();
                expect(
                    mockQuoApi.api.createMessageWebhook,
                ).not.toHaveBeenCalled();
                expect(result.attio.status).toBe('already_configured');
                expect(result.quo.status).toBe('already_configured');
            });

            it('should rollback Quo webhooks on partial failure', async () => {
                process.env.BASE_URL = 'https://api.example.com';

                mockAttioApi.api.createWebhook.mockResolvedValue({
                    data: {
                        id: { webhook_id: 'attio-wh' },
                        secret: 'secret',
                    },
                });

                // Simulate base class method throwing error (webhook creation failure)
                integration._createQuoWebhooksWithPhoneIds.mockRejectedValue(
                    new Error('Webhook creation failed'),
                );

                await expect(integration.setupWebhooks()).rejects.toThrow(
                    'Webhook setup failed for: Quo',
                );

                // Verify the base class method was called
                expect(integration._createQuoWebhooksWithPhoneIds).toHaveBeenCalled();
                // Note: Rollback logic is handled inside _createQuoWebhooksWithPhoneIds in base class
            });

            it('should handle missing BASE_URL', async () => {
                delete process.env.BASE_URL;

                await expect(integration.setupWebhooks()).rejects.toThrow(
                    'Webhook setup failed for: Attio, Quo',
                );
            });

            it('should log errors and update integration messages on failure', async () => {
                process.env.BASE_URL = 'https://api.example.com';
                mockAttioApi.api.createWebhook.mockRejectedValue(
                    new Error('Network error'),
                );

                const consoleSpy = jest
                    .spyOn(console, 'error')
                    .mockImplementation();

                await expect(integration.setupWebhooks()).rejects.toThrow(
                    'Webhook setup failed for: Attio',
                );

                expect(consoleSpy).toHaveBeenCalled();
                expect(
                    integration.updateIntegrationMessages.execute,
                ).toHaveBeenCalledWith(
                    integration.id,
                    'errors',
                    'Webhook Setup Failed',
                    expect.stringContaining('Failed to setup webhooks'),
                    expect.any(Number),
                );

                consoleSpy.mockRestore();
            });
        });
    });

    describe('Webhook Setup - Private Methods', () => {
        beforeEach(() => {
            integration.commands = {
                updateIntegrationConfig: jest.fn().mockResolvedValue({}),
            };
            integration.updateIntegrationMessages = {
                execute: jest.fn().mockResolvedValue({}),
            };
            integration.config = {};
            process.env.BASE_URL = 'https://api.example.com';
        });

        afterEach(() => {
            delete process.env.BASE_URL;
        });

        describe('setupAttioWebhook', () => {
            it('should create Attio webhook with correct subscriptions', async () => {
                mockAttioApi.api.createWebhook.mockResolvedValue({
                    data: {
                        id: { webhook_id: 'wh-123' },
                        secret: 'secret-xyz',
                    },
                });

                const result = await integration.setupAttioWebhook();

                expect(result.status).toBe('configured');
                expect(result.webhookId).toBe('wh-123');
                expect(mockAttioApi.api.createWebhook).toHaveBeenCalledWith({
                    target_url: expect.stringContaining('/webhooks/'),
                    subscriptions: [
                        { event_type: 'record.created', filter: null },
                        { event_type: 'record.updated', filter: null },
                        { event_type: 'record.deleted', filter: null },
                    ],
                });
                expect(
                    integration.commands.updateIntegrationConfig,
                ).toHaveBeenCalled();
            });

            it('should skip if webhook already configured', async () => {
                integration.config.attioWebhookId = 'existing-wh-123';

                const result = await integration.setupAttioWebhook();

                expect(result.status).toBe('already_configured');
                expect(mockAttioApi.api.createWebhook).not.toHaveBeenCalled();
            });

            it('should handle invalid webhook response', async () => {
                mockAttioApi.api.createWebhook.mockResolvedValue({
                    data: {
                        /* missing id and secret */
                    },
                });

                const result = await integration.setupAttioWebhook();

                expect(result.status).toBe('failed');
                expect(result.error).toContain(
                    'Invalid Attio webhook response',
                );
            });
        });

        describe('setupQuoWebhook', () => {
            beforeEach(() => {
                integration.commands = {
                    updateIntegrationConfig: jest.fn().mockResolvedValue({}),
                };
                integration.updateIntegrationMessages = {
                    execute: jest.fn().mockResolvedValue({}),
                };
                integration.config = {};
                mockQuoApi.api.deleteWebhook = jest.fn().mockResolvedValue({});
            });

            it('should create all three Quo webhooks atomically', async () => {
                // Mock base class methods
                integration._fetchAndStoreEnabledPhoneIds.mockResolvedValue(['phone-1', 'phone-2']);
                integration._createQuoWebhooksWithPhoneIds.mockResolvedValue({
                    messageWebhookId: 'msg-wh',
                    messageWebhookKey: 'msg-key',
                    callWebhookId: 'call-wh',
                    callWebhookKey: 'call-key',
                    callSummaryWebhookId: 'summary-wh',
                    callSummaryWebhookKey: 'summary-key',
                });

                const result = await integration.setupQuoWebhook();

                expect(result.status).toBe('configured');
                expect(result.messageWebhookId).toBe('msg-wh');
                expect(result.callWebhookId).toBe('call-wh');
                expect(result.callSummaryWebhookId).toBe('summary-wh');
                expect(integration._fetchAndStoreEnabledPhoneIds).toHaveBeenCalled();
                expect(integration._createQuoWebhooksWithPhoneIds).toHaveBeenCalled();
            });

            it('should cleanup partial config before retry', async () => {
                integration.config = {
                    quoMessageWebhookId: 'orphaned-msg-wh',
                };

                integration._fetchAndStoreEnabledPhoneIds.mockResolvedValue(['phone-1']);
                integration._createQuoWebhooksWithPhoneIds.mockResolvedValue({
                    messageWebhookId: 'new-msg-wh',
                    messageWebhookKey: 'key',
                    callWebhookId: 'new-call-wh',
                    callWebhookKey: 'key',
                    callSummaryWebhookId: 'new-summary-wh',
                    callSummaryWebhookKey: 'key',
                });

                await integration.setupQuoWebhook();

                expect(mockQuoApi.api.deleteWebhook).toHaveBeenCalledWith(
                    'orphaned-msg-wh',
                );
            });

            it('should rollback on failure and return error', async () => {
                integration._fetchAndStoreEnabledPhoneIds.mockResolvedValue(['phone-1']);
                integration._createQuoWebhooksWithPhoneIds.mockRejectedValue(
                    new Error('API error'),
                );

                const result = await integration.setupQuoWebhook();

                expect(result.status).toBe('failed');
                // Note: Rollback is handled inside _createQuoWebhooksWithPhoneIds
            });
        });

        describe('_generateWebhookUrl', () => {
            it('should throw if BASE_URL not set', () => {
                delete process.env.BASE_URL;

                expect(() => integration._generateWebhookUrl('/test')).toThrow(
                    'BASE_URL environment variable is required',
                );
            });

            it('should generate correct webhook URL', () => {
                integration.id = 'int-123';

                const url = integration._generateWebhookUrl('/webhooks/test');

                expect(url).toBe(
                    'https://api.example.com/api/attio-integration/webhooks/test',
                );
            });
        });
    });

    describe('Webhook Signature Verification', () => {
        const crypto = require('crypto');

        describe('_verifyWebhookSignature (Attio)', () => {
            it('should verify valid HMAC-SHA256 signature', () => {
                const secret = 'test-secret';
                const payload = JSON.stringify({ test: 'data' });
                const hmac = crypto.createHmac('sha256', secret);
                hmac.update(payload);
                const signature = hmac.digest('hex');

                const result = integration._verifyWebhookSignature({
                    signature,
                    payload,
                    secret,
                });

                expect(result).toBe(true);
            });

            it('should reject invalid signature', () => {
                const result = integration._verifyWebhookSignature({
                    signature: 'invalid-signature',
                    payload: JSON.stringify({ test: 'data' }),
                    secret: 'test-secret',
                });

                expect(result).toBe(false);
            });

            it('should reject if signature missing', () => {
                const result = integration._verifyWebhookSignature({
                    signature: null,
                    payload: JSON.stringify({ test: 'data' }),
                    secret: 'test-secret',
                });

                expect(result).toBe(false);
            });

            it('should reject if secret missing', () => {
                const result = integration._verifyWebhookSignature({
                    signature: 'some-signature',
                    payload: JSON.stringify({ test: 'data' }),
                    secret: null,
                });

                expect(result).toBe(false);
            });

            it('should use timing-safe comparison', () => {
                const timingSafeSpy = jest.spyOn(crypto, 'timingSafeEqual');

                const secret = 'test-secret';
                const payload = JSON.stringify({ test: 'data' });
                const hmac = crypto.createHmac('sha256', secret);
                hmac.update(payload);
                const signature = hmac.digest('hex');

                integration._verifyWebhookSignature({
                    signature,
                    payload,
                    secret,
                });

                expect(timingSafeSpy).toHaveBeenCalled();
                timingSafeSpy.mockRestore();
            });
        });

        describe('_verifyQuoWebhookSignature (OpenPhone)', () => {
            beforeEach(() => {
                integration.config = {};
            });

            it('should parse and verify Quo signature format', async () => {
                const webhookKey = 'test-key';
                const timestamp = '1640000000000';
                const body = { type: 'call.completed', data: {} };
                const payload = timestamp + JSON.stringify(body);

                const hmac = crypto.createHmac('sha256', webhookKey);
                hmac.update(payload);
                const signature = hmac.digest('base64');

                integration.config = { quoCallWebhookKey: webhookKey };

                const headers = {
                    'openphone-signature': `hmac;v1;${timestamp};${signature}`,
                };

                await expect(
                    integration._verifyQuoWebhookSignature(
                        headers,
                        body,
                        'call.completed',
                    ),
                ).resolves.not.toThrow();
            });

            it('should throw on missing signature header', async () => {
                await expect(
                    integration._verifyQuoWebhookSignature(
                        {},
                        {},
                        'call.completed',
                    ),
                ).rejects.toThrow('Missing Openphone-Signature header');
            });

            it('should throw on invalid signature format', async () => {
                const headers = { 'openphone-signature': 'invalid-format' };

                await expect(
                    integration._verifyQuoWebhookSignature(
                        headers,
                        {},
                        'call.completed',
                    ),
                ).rejects.toThrow('Invalid Openphone-Signature format');
            });

            it('should select correct webhook key by event type', async () => {
                integration.config = {
                    quoMessageWebhookKey: 'msg-key',
                    quoCallWebhookKey: 'call-key',
                    quoCallSummaryWebhookKey: 'summary-key',
                };

                const timestamp = '1640000000000';
                const body = { type: 'message.received' };

                const hmac = crypto.createHmac('sha256', 'msg-key');
                hmac.update(timestamp + JSON.stringify(body));
                const signature = hmac.digest('base64');

                const headers = {
                    'openphone-signature': `hmac;v1;${timestamp};${signature}`,
                };

                await expect(
                    integration._verifyQuoWebhookSignature(
                        headers,
                        body,
                        'message.received',
                    ),
                ).resolves.not.toThrow();
            });

            it('should throw if webhook key not found', async () => {
                integration.config = {};
                const headers = {
                    'openphone-signature': 'hmac;v1;123;sig',
                };

                await expect(
                    integration._verifyQuoWebhookSignature(
                        headers,
                        {},
                        'call.completed',
                    ),
                ).rejects.toThrow('Webhook key not found in config');
            });
        });
    });

    describe('Quo Webhook Event Handlers', () => {
        beforeEach(() => {
            integration.config = {
                quoCallWebhookKey: 'call-key',
                quoMessageWebhookKey: 'msg-key',
            };
            integration._findAttioContactByPhone = jest
                .fn()
                .mockResolvedValue('attio-rec-123');
            mockQuoApi.api.getPhoneNumber = jest.fn().mockResolvedValue({
                name: 'Main Line',
                phoneNumber: '+15551234567',
            });
            mockQuoApi.api.getUser = jest.fn().mockResolvedValue({
                name: 'John Agent',
                firstName: 'John',
                lastName: 'Agent',
            });
        });

        describe('_handleQuoCallEvent', () => {
            it('should log outgoing call to Attio', async () => {
                const webhookData = {
                    type: 'call.completed',
                    data: {
                        object: {
                            id: 'call-123',
                            direction: 'outgoing',
                            participants: ['+15551111111', '+15552222222'],
                            phoneNumberId: 'pn-456',
                            userId: 'user-789',
                            duration: 180,
                            status: 'completed',
                            createdAt: '2025-01-10T15:30:00Z',
                        },
                        deepLink: 'https://quo.app/call/123',
                    },
                };

                // Mock the new method chain
                integration._findAttioContactFromQuoWebhook.mockResolvedValue('attio-rec-123');
                mockAttioApi.api.getRecord.mockResolvedValue({
                    data: { id: { record_id: 'attio-rec-123' } },
                });
                mockAttioApi.api.createNote.mockResolvedValue({
                    id: 'note-123',
                });
                mockQuoApi.api.getPhoneNumber = jest.fn().mockResolvedValue({
                    data: { name: 'Main Line' }
                });

                const result =
                    await integration._handleQuoCallEvent(webhookData);

                expect(
                    integration._findAttioContactFromQuoWebhook,
                ).toHaveBeenCalledWith('+15552222222');
                expect(mockAttioApi.api.createNote).toHaveBeenCalledWith({
                    parent_object: 'people',
                    parent_record_id: 'attio-rec-123',
                    title: expect.stringContaining('Call:'),
                    title: expect.stringContaining('→'),
                    format: 'markdown',
                    content: expect.stringContaining('☎️'),
                    created_at: '2025-01-10T15:30:00Z',
                });
                expect(result).toEqual({
                    logged: true,
                    contactId: 'attio-rec-123',
                });
            });

            it('should log incoming call to Attio with recording info', async () => {
                const webhookData = {
                    data: {
                        object: {
                            direction: 'incoming',
                            participants: ['+15552222222', '+15551111111'],
                            phoneNumberId: 'pn-456',
                            userId: 'user-789',
                            duration: 240,
                            status: 'completed',
                            createdAt: '2025-01-10T16:00:00Z',
                        },
                        deepLink: 'https://quo.app/call/456',
                    },
                };

                integration._findAttioContactFromQuoWebhook.mockResolvedValue('attio-rec-123');
                mockAttioApi.api.getRecord.mockResolvedValue({
                    data: { id: { record_id: 'attio-rec-123' } },
                });
                mockAttioApi.api.createNote.mockResolvedValue({
                    id: 'note-456',
                });
                mockQuoApi.api.getPhoneNumber = jest.fn().mockResolvedValue({
                    data: { name: 'Main Line' }
                });

                const result =
                    await integration._handleQuoCallEvent(webhookData);

                expect(
                    integration._findAttioContactFromQuoWebhook,
                ).toHaveBeenCalledWith('+15552222222');
                const noteCall = mockAttioApi.api.createNote.mock.calls[0][0];
                expect(noteCall.content).toContain('▶️ Recording');
            });

            it('should throw if less than 2 participants', async () => {
                const webhookData = {
                    data: {
                        object: {
                            participants: ['+15551111111'],
                            direction: 'outgoing',
                        },
                    },
                };

                await expect(
                    integration._handleQuoCallEvent(webhookData),
                ).rejects.toThrow('Call must have at least 2 participants');
            });
        });

        describe('_handleQuoMessageEvent', () => {
            it('should log outgoing message to Attio', async () => {
                const webhookData = {
                    data: {
                        object: {
                            id: 'msg-123',
                            direction: 'outgoing',
                            from: '+15551111111',
                            to: '+15552222222',
                            text: 'Hello, world!',
                            phoneNumberId: 'pn-456',
                            userId: 'user-789',
                            createdAt: '2025-01-10T17:00:00Z',
                        },
                        deepLink: 'https://quo.app/msg/123',
                    },
                };

                integration._findAttioContactFromQuoWebhook.mockResolvedValue('attio-rec-123');
                mockAttioApi.api.getRecord.mockResolvedValue({
                    data: { id: { record_id: 'attio-rec-123' } },
                });
                mockAttioApi.api.createNote.mockResolvedValue({
                    id: 'note-789',
                });
                mockQuoApi.api.getPhoneNumber = jest.fn().mockResolvedValue({
                    data: { name: 'Main Line' }
                });

                const result =
                    await integration._handleQuoMessageEvent(webhookData);

                expect(
                    integration._findAttioContactFromQuoWebhook,
                ).toHaveBeenCalledWith('+15552222222');
                expect(mockAttioApi.api.createNote).toHaveBeenCalledWith({
                    parent_object: 'people',
                    parent_record_id: 'attio-rec-123',
                    title: expect.stringContaining('Message:'),
                    title: expect.stringContaining('→'),
                    format: 'markdown',
                    content: expect.stringContaining('💬'),
                    created_at: '2025-01-10T17:00:00Z',
                });
                expect(result).toEqual({
                    logged: true,
                    contactId: 'attio-rec-123',
                });
            });

            it('should log incoming message to Attio', async () => {
                const webhookData = {
                    data: {
                        object: {
                            direction: 'incoming',
                            from: '+15552222222',
                            to: '+15551111111',
                            text: 'Hi there!',
                            phoneNumberId: 'pn-456',
                            userId: 'user-789',
                            createdAt: '2025-01-10T18:00:00Z',
                        },
                        deepLink: 'https://quo.app/msg/456',
                    },
                };

                integration._findAttioContactFromQuoWebhook.mockResolvedValue('attio-rec-123');
                mockAttioApi.api.getRecord.mockResolvedValue({
                    data: { id: { record_id: 'attio-rec-123' } },
                });
                mockAttioApi.api.createNote.mockResolvedValue({
                    id: 'note-abc',
                });
                mockQuoApi.api.getPhoneNumber = jest.fn().mockResolvedValue({
                    data: { name: 'Main Line' }
                });

                const result =
                    await integration._handleQuoMessageEvent(webhookData);

                expect(
                    integration._findAttioContactFromQuoWebhook,
                ).toHaveBeenCalledWith('+15552222222');
                const noteCall = mockAttioApi.api.createNote.mock.calls[0][0];
                expect(noteCall.content).toContain('💬 Message');
                expect(noteCall.content).toContain('Received: Hi there!');
            });
        });

        describe('_handleQuoCallSummaryEvent', () => {
            it('should acknowledge call summary receipt', async () => {
                const webhookData = {
                    data: {
                        object: {
                            callId: 'call-123',
                            summary: [
                                'Discussed pricing',
                                'Next meeting scheduled',
                            ],
                            nextSteps: ['Send proposal', 'Follow up Monday'],
                            status: 'completed',
                        },
                    },
                };

                const result =
                    await integration._handleQuoCallSummaryEvent(webhookData);

                expect(result).toEqual({
                    received: true,
                    callId: 'call-123',
                    summaryPoints: 2,
                    nextStepsCount: 2,
                });
            });
        });
    });

    describe('Phone Number Utilities', () => {
        describe('_normalizePhoneNumber', () => {
            it('should remove formatting characters', () => {
                expect(
                    integration._normalizePhoneNumber('(555) 123-4567'),
                ).toBe('5551234567');
                expect(integration._normalizePhoneNumber('555 123 4567')).toBe(
                    '5551234567',
                );
                expect(integration._normalizePhoneNumber('555-123-4567')).toBe(
                    '5551234567',
                );
            });

            it('should preserve + for international format', () => {
                expect(
                    integration._normalizePhoneNumber('+1 (555) 123-4567'),
                ).toBe('+15551234567');
            });

            it('should handle null/undefined', () => {
                expect(integration._normalizePhoneNumber(null)).toBeNull();
                expect(
                    integration._normalizePhoneNumber(undefined),
                ).toBeUndefined();
            });
        });

        describe('_findAttioContactByPhone', () => {
            beforeEach(() => {
                integration.getMapping = jest.fn();
                mockAttioApi.api.queryRecords = jest.fn();
                mockAttioApi.api.searchRecords = jest.fn();
            });

            it('should find contact using exact filter', async () => {
                mockAttioApi.api.queryRecords.mockResolvedValue({
                    data: [
                        {
                            id: { record_id: 'rec-123' },
                            values: {
                                phone_numbers: [
                                    { phone_number: '+15551234567' },
                                ],
                            },
                        },
                    ],
                });
                integration.getMapping.mockResolvedValue({
                    externalId: 'rec-123',
                });

                const recordId =
                    await integration._findAttioContactByPhone(
                        '+1 (555) 123-4567',
                    );

                expect(recordId).toBe('rec-123');
                expect(mockAttioApi.api.queryRecords).toHaveBeenCalledWith(
                    'people',
                    {
                        filter: { phone_numbers: '+15551234567' },
                        limit: 10,
                    },
                );
            });

            it('should throw if no contact found', async () => {
                mockAttioApi.api.queryRecords.mockResolvedValue({ data: [] });
                mockAttioApi.api.searchRecords.mockResolvedValue({ data: [] });

                await expect(
                    integration._findAttioContactByPhone('+15551111111'),
                ).rejects.toThrow('No Attio contact found');
            });

            it('should return contact found in Attio even if not synced (no mapping)', async () => {
                // TDD: This test should fail with current implementation
                // Current code requires a mapping, but new requirement is to accept any contact in Attio
                mockAttioApi.api.queryRecords.mockResolvedValue({
                    data: [
                        {
                            id: { record_id: 'rec-unsynced-456' },
                            values: {
                                phone_numbers: [
                                    { phone_number: '+16048027941' },
                                ],
                            },
                        },
                    ],
                });
                // No mapping exists for this contact (not synced)
                integration.getMapping.mockResolvedValue(null);

                const recordId = await integration._findAttioContactByPhone('+16048027941');

                expect(recordId).toBe('rec-unsynced-456');
                expect(mockAttioApi.api.queryRecords).toHaveBeenCalledWith(
                    'people',
                    {
                        filter: { phone_numbers: '+16048027941' },
                        limit: 10,
                    },
                );
            });

            it('should prefer synced contact if multiple contacts found', async () => {
                // TDD: If multiple contacts match, prefer one with mapping (synced)
                mockAttioApi.api.queryRecords.mockResolvedValue({
                    data: [
                        {
                            id: { record_id: 'rec-unsynced-111' },
                            values: {
                                phone_numbers: [{ phone_number: '+15551234567' }],
                            },
                        },
                        {
                            id: { record_id: 'rec-synced-222' },
                            values: {
                                phone_numbers: [{ phone_number: '+15551234567' }],
                            },
                        },
                    ],
                });

                // First contact has no mapping, second has mapping
                integration.getMapping
                    .mockResolvedValueOnce(null)  // First contact: no mapping
                    .mockResolvedValueOnce({ externalId: 'rec-synced-222' }); // Second: has mapping

                const recordId = await integration._findAttioContactByPhone('+15551234567');

                expect(recordId).toBe('rec-synced-222');
            });

            it('should return first contact if none are synced', async () => {
                // TDD: If no contacts have mappings, return the first one
                mockAttioApi.api.queryRecords.mockResolvedValue({
                    data: [
                        {
                            id: { record_id: 'rec-first-333' },
                            values: {
                                phone_numbers: [{ phone_number: '+15559999999' }],
                            },
                        },
                        {
                            id: { record_id: 'rec-second-444' },
                            values: {
                                phone_numbers: [{ phone_number: '+15559999999' }],
                            },
                        },
                    ],
                });

                // Neither contact has a mapping
                integration.getMapping.mockResolvedValue(null);

                const recordId = await integration._findAttioContactByPhone('+15559999999');

                expect(recordId).toBe('rec-first-333');
            });
        });
    });

    describe('Attio Webhook Event Handlers', () => {
        beforeEach(() => {
            integration.config = { attioWebhookSecret: 'test-secret' };
            integration.updateIntegrationMessages = {
                execute: jest.fn().mockResolvedValue({}),
            };
            integration.upsertMapping = jest.fn().mockResolvedValue({});
            integration.getMapping = jest.fn().mockResolvedValue(null);
            integration._resolveObjectType = jest
                .fn()
                .mockResolvedValue('people');
            mockQuoApi.api.listContacts = jest.fn();
            mockQuoApi.api.createContact = jest.fn();
            mockQuoApi.api.updateContact = jest.fn();
            mockQuoApi.api.deleteContact = jest.fn();
        });

        describe('_handleRecordCreated', () => {
            it('should fetch record and sync person to Quo', async () => {
                const eventData = {
                    record_id: 'rec-123',
                    object_id: 'obj-people',
                };

                mockAttioApi.api.getRecord.mockResolvedValue({
                    data: {
                        id: { record_id: 'rec-123' },
                        values: {
                            name: [
                                {
                                    first_name: 'John',
                                    last_name: 'Doe',
                                    active_until: null,
                                },
                            ],
                            phone_numbers: [
                                { phone_number: '+15551234567' }
                            ],
                        },
                    },
                });
                mockQuoApi.api.createContact.mockResolvedValue({
                    data: {
                        id: 'quo-contact-123',
                        defaultFields: {
                            phoneNumbers: [
                                { value: '+15551234567' }
                            ]
                        }
                    },
                });

                await integration._handleRecordCreated(eventData);

                expect(mockAttioApi.api.getRecord).toHaveBeenCalledWith(
                    'obj-people',
                    'rec-123',
                );
                expect(mockQuoApi.api.createContact).toHaveBeenCalled();
                expect(integration._upsertContactMapping).toHaveBeenCalledWith(
                    'rec-123',
                    '+15551234567',
                    expect.objectContaining({
                        action: 'created',
                        syncMethod: 'webhook',
                    }),
                );
            });

            it('should handle record not found', async () => {
                const eventData = {
                    record_id: 'rec-404',
                    object_id: 'obj-people',
                };
                mockAttioApi.api.getRecord.mockResolvedValue({ data: null });

                const consoleSpy = jest
                    .spyOn(console, 'warn')
                    .mockImplementation();

                await integration._handleRecordCreated(eventData);

                expect(consoleSpy).toHaveBeenCalledWith(
                    expect.stringContaining('Record rec-404 not found'),
                );
                expect(mockQuoApi.api.createContact).not.toHaveBeenCalled();

                consoleSpy.mockRestore();
            });

            it('should skip non-people object types', async () => {
                integration._resolveObjectType.mockResolvedValue('companies');
                const eventData = {
                    record_id: 'rec-123',
                    object_id: 'obj-companies',
                };
                mockAttioApi.api.getRecord.mockResolvedValue({
                    data: { id: { record_id: 'rec-123' } },
                });

                const consoleSpy = jest
                    .spyOn(console, 'log')
                    .mockImplementation();

                await integration._handleRecordCreated(eventData);

                expect(consoleSpy).toHaveBeenCalledWith(
                    expect.stringContaining(
                        "'companies' not configured for sync",
                    ),
                );
                expect(mockQuoApi.api.createContact).not.toHaveBeenCalled();

                consoleSpy.mockRestore();
            });
        });

        describe('_handleRecordUpdated', () => {
            it('should update existing contact in Quo', async () => {
                const eventData = {
                    record_id: 'rec-123',
                    object_id: 'obj-people',
                };
                mockAttioApi.api.getRecord.mockResolvedValue({
                    data: {
                        id: { record_id: 'rec-123' },
                        values: {
                            name: [
                                {
                                    first_name: 'Jane',
                                    last_name: 'Smith',
                                    active_until: null,
                                },
                            ],
                        },
                    },
                });
                mockQuoApi.api.listContacts.mockResolvedValue({
                    data: [{ id: 'quo-123', externalId: 'rec-123' }],
                });
                mockQuoApi.api.updateContact.mockResolvedValue({
                    data: { id: 'quo-123' },
                });

                await integration._handleRecordUpdated(eventData);

                expect(mockQuoApi.api.updateContact).toHaveBeenCalledWith(
                    'quo-123',
                    expect.objectContaining({
                        defaultFields: expect.any(Object),
                    }),
                );
            });

            it('should throw error if contact not found in Quo', async () => {
                const eventData = {
                    record_id: 'rec-123',
                    object_id: 'obj-people',
                };
                mockAttioApi.api.getRecord.mockResolvedValue({
                    data: {
                        id: { record_id: 'rec-123' },
                        values: {
                            name: [
                                {
                                    first_name: 'Jane',
                                    last_name: 'Doe',
                                    active_until: null,
                                },
                            ],
                        },
                    },
                });
                mockQuoApi.api.listContacts.mockResolvedValue({ data: [] });

                await expect(
                    integration._handleRecordUpdated(eventData),
                ).rejects.toThrow(
                    'Contact with externalId rec-123 not found in Quo',
                );
            });
        });

        describe('_handleRecordDeleted', () => {
            it('should delete contact from Quo', async () => {
                const eventData = {
                    record_id: 'rec-123',
                    object_id: 'obj-people',
                };
                mockQuoApi.api.listContacts.mockResolvedValue({
                    data: [{ id: 'quo-123', externalId: 'rec-123' }],
                });
                mockQuoApi.api.deleteContact.mockResolvedValue({ status: 204 });

                await integration._handleRecordDeleted(eventData);

                expect(mockQuoApi.api.deleteContact).toHaveBeenCalledWith(
                    'quo-123',
                );
            });

            it('should handle contact not found in Quo', async () => {
                const eventData = {
                    record_id: 'rec-404',
                    object_id: 'obj-people',
                };
                mockQuoApi.api.listContacts.mockResolvedValue({ data: [] });

                const consoleSpy = jest
                    .spyOn(console, 'warn')
                    .mockImplementation();

                await integration._handleRecordDeleted(eventData);

                expect(mockQuoApi.api.deleteContact).not.toHaveBeenCalled();
                expect(consoleSpy).toHaveBeenCalledWith(
                    expect.stringContaining('not found in Quo'),
                );

                consoleSpy.mockRestore();
            });
        });

        describe('_resolveObjectType', () => {
            beforeEach(() => {
                // Reset the mock for this describe block
                integration._resolveObjectType =
                    AttioIntegration.prototype._resolveObjectType;
                mockAttioApi.api.getObject = jest.fn();
            });

            it('should resolve object ID to type and cache result', async () => {
                mockAttioApi.api.getObject.mockResolvedValue({
                    data: {
                        api_slug: 'people',
                        plural_noun: 'People',
                    },
                });

                const type1 = await integration._resolveObjectType('obj-123');
                const type2 = await integration._resolveObjectType('obj-123');

                expect(type1).toBe('people');
                expect(type2).toBe('people');
                expect(mockAttioApi.api.getObject).toHaveBeenCalledTimes(1);
            });

            it('should fallback to plural_noun if api_slug missing', async () => {
                mockAttioApi.api.getObject.mockResolvedValue({
                    data: { plural_noun: 'Companies' },
                });

                const type = await integration._resolveObjectType('obj-456');

                expect(type).toBe('companies');
            });
        });
    });

    describe('Webhook Processing & Lifecycle', () => {
        beforeEach(() => {
            integration.config = {
                attioWebhookSecret: 'attio-secret',
                quoCallWebhookKey: 'quo-key',
            };
            integration.updateIntegrationMessages = {
                execute: jest.fn().mockResolvedValue({}),
            };
            integration.queueWebhook = jest.fn().mockResolvedValue({});
        });

        describe('onWebhookReceived', () => {
            it('should accept Attio webhook with signature', async () => {
                const req = {
                    body: { events: [] },
                    headers: { 'x-attio-signature': 'test-signature' },
                    params: { integrationId: 'int-123' },
                };
                const res = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn(),
                };

                await integration.onWebhookReceived({ req, res });

                expect(integration.queueWebhook).toHaveBeenCalledWith(
                    expect.objectContaining({
                        source: 'attio',
                        signature: 'test-signature',
                    }),
                );
                expect(res.status).toHaveBeenCalledWith(200);
            });

            it('should accept Quo webhook with signature', async () => {
                const req = {
                    body: { type: 'call.completed' },
                    headers: { 'openphone-signature': 'hmac;v1;123;sig' },
                    params: { integrationId: 'int-123' },
                };
                const res = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn(),
                };

                await integration.onWebhookReceived({ req, res });

                expect(integration.queueWebhook).toHaveBeenCalledWith(
                    expect.objectContaining({
                        source: 'quo',
                        signature: 'hmac;v1;123;sig',
                    }),
                );
            });

            it('should allow Quo webhook without signature (v2 svix compatibility)', async () => {
                // Quo webhooks are allowed without signatures because Quo doesn't support
                // OpenPhone-Signature headers with v2 svix webhooks yet
                const req = {
                    body: { type: 'message.received', data: {} },
                    headers: {
                        // No openphone-signature header - this is expected for Quo v2 webhooks
                        'content-type': 'application/json',
                    },
                    params: { integrationId: 'test-id' },
                };
                const res = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn(),
                };

                await integration.onWebhookReceived({ req, res });

                // Should accept the webhook (200) even without signature for Quo
                expect(res.status).toHaveBeenCalledWith(200);
                expect(integration.queueWebhook).toHaveBeenCalled();
            });
        });

        describe('onDelete', () => {
            beforeEach(() => {
                integration.config = {
                    attioWebhookId: 'attio-wh-123',
                    quoMessageWebhookId: 'quo-msg-wh-456',
                    quoCallWebhookId: 'quo-call-wh-789',
                    quoCallSummaryWebhookId: 'quo-summary-wh-abc',
                };
                mockAttioApi.api.deleteWebhook = jest
                    .fn()
                    .mockResolvedValue({});
                mockQuoApi.api.deleteWebhook = jest.fn().mockResolvedValue({});
            });

            it('should delete all webhooks on integration deletion', async () => {
                await integration.onDelete({});

                expect(mockAttioApi.api.deleteWebhook).toHaveBeenCalledWith(
                    'attio-wh-123',
                );
                expect(mockQuoApi.api.deleteWebhook).toHaveBeenCalledWith(
                    'quo-msg-wh-456',
                );
                expect(mockQuoApi.api.deleteWebhook).toHaveBeenCalledWith(
                    'quo-call-wh-789',
                );
                expect(mockQuoApi.api.deleteWebhook).toHaveBeenCalledWith(
                    'quo-summary-wh-abc',
                );
            });

            it('should continue on webhook deletion errors', async () => {
                mockAttioApi.api.deleteWebhook.mockRejectedValue(
                    new Error('Not found'),
                );
                const consoleSpy = jest
                    .spyOn(console, 'error')
                    .mockImplementation();

                await integration.onDelete({});

                expect(consoleSpy).toHaveBeenCalled();
                expect(mockQuoApi.api.deleteWebhook).toHaveBeenCalled();

                consoleSpy.mockRestore();
            });
        });
    });

    describe('Backward Compatibility - Existing Events', () => {
        it('should have LIST_ATTIO_OBJECTS event', () => {
            expect(integration.events.LIST_ATTIO_OBJECTS).toBeDefined();
            expect(
                integration.events.LIST_ATTIO_OBJECTS.handler,
            ).toBeInstanceOf(Function);
        });

        it('should have LIST_ATTIO_COMPANIES event', () => {
            expect(integration.events.LIST_ATTIO_COMPANIES).toBeDefined();
            expect(
                integration.events.LIST_ATTIO_COMPANIES.handler,
            ).toBeInstanceOf(Function);
        });

        it('should have LIST_ATTIO_PEOPLE event', () => {
            expect(integration.events.LIST_ATTIO_PEOPLE).toBeDefined();
            expect(integration.events.LIST_ATTIO_PEOPLE.handler).toBeInstanceOf(
                Function,
            );
        });
    });

    describe('Helper Methods', () => {
        describe('fetchPersonById', () => {
            it('should fetch person by ID', async () => {
                const mockPerson = {
                    id: { record_id: 'rec123', object_id: 'people' },
                    values: {
                        name: [{ first_name: 'John', last_name: 'Doe' }],
                    },
                };
                mockAttioApi.api.objects.getRecord.mockResolvedValue(
                    mockPerson,
                );

                const result = await integration.fetchPersonById('rec123');

                expect(result).toEqual(mockPerson);
                expect(mockAttioApi.api.objects.getRecord).toHaveBeenCalledWith(
                    'people',
                    'rec123',
                );
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

                const result = await integration.fetchPersonsByIds([
                    'rec1',
                    'rec2',
                ]);

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

                const consoleSpy = jest
                    .spyOn(console, 'error')
                    .mockImplementation();

                const result = await integration.fetchPersonsByIds([
                    'rec1',
                    'rec2',
                ]);

                expect(result).toHaveLength(1); // Only successfully fetched person
                expect(result[0].id.record_id).toBe('rec1');
                expect(consoleSpy).toHaveBeenCalled();

                consoleSpy.mockRestore();
            });
        });
    });
});
