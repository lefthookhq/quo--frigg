/**
 * Test: Quo Webhook Subscriptions (resourceIds) Support
 *
 * Verifies that when creating Quo webhooks, the integration properly includes
 * resourceIds (phone number IDs) to subscribe to specific phone numbers only.
 *
 * Issue: Quo webhooks were being created WITHOUT resourceIds, causing no events
 * to be delivered because there were no subscriptions.
 */

const PipedriveIntegration = require('../../src/integrations/PipedriveIntegration');

describe('Quo Webhook Subscriptions', () => {
    let integration;
    let mockQuoApi;
    let mockPipedriveApi;
    let mockCommands;

    beforeEach(() => {
        // Mock Quo API
        mockQuoApi = {
            api: {
                createMessageWebhook: jest.fn().mockResolvedValue({
                    data: { id: 'msg-webhook-123', key: 'msg-key-abc' },
                }),
                createCallWebhook: jest.fn().mockResolvedValue({
                    data: { id: 'call-webhook-456', key: 'call-key-def' },
                }),
                createCallSummaryWebhook: jest.fn().mockResolvedValue({
                    data: { id: 'summary-webhook-789', key: 'summary-key-ghi' },
                }),
                deleteWebhook: jest.fn().mockResolvedValue({}),
                listPhoneNumbers: jest.fn().mockResolvedValue({ data: [] }),
                getPhoneNumber: jest.fn().mockImplementation((phoneId) => {
                    const phones = {
                        'phone-1': { data: { id: 'phone-1', number: '+15551111111', name: 'Phone 1' } },
                        'phone-2': { data: { id: 'phone-2', number: '+15552222222', name: 'Phone 2' } },
                    };
                    return Promise.resolve(phones[phoneId] || { data: null });
                }),
            },
        };

        // Mock Pipedrive API
        mockPipedriveApi = {
            api: {
                createWebhook: jest.fn().mockResolvedValue({
                    data: { id: 1 },
                }),
            },
        };

        // Mock commands
        mockCommands = {
            updateIntegrationConfig: jest.fn().mockResolvedValue({}),
        };

        // Create integration instance
        integration = new PipedriveIntegration({
            id: 'integration-123',
            userId: 'user-456',
        });

        integration.quo = mockQuoApi;
        integration.pipedrive = mockPipedriveApi;
        integration.commands = mockCommands;
        integration.config = {};
        integration.id = 'integration-123'; // Ensure ID is set
        integration.updateIntegrationMessages = { execute: jest.fn() };
        integration._fetchAndStoreEnabledPhoneIds = jest
            .fn()
            .mockResolvedValue();

        // Mock environment
        process.env.BASE_URL = 'https://api.example.com';
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete process.env.BASE_URL;
    });

    describe('setupQuoWebhook with resourceIds', () => {
        it('should include resourceIds when enabledPhoneIds are configured', async () => {
            // Setup: Configure phone IDs
            integration.config.enabledPhoneIds = ['PHmR5aU', 'PHxY7bZ'];

            // Execute
            await integration.setupQuoWebhook();

            // Verify: All three webhook types should include resourceIds
            expect(mockQuoApi.api.createMessageWebhook).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceIds: ['PHmR5aU', 'PHxY7bZ'],
                    url: expect.any(String),
                    status: 'enabled',
                    events: expect.any(Array),
                    label: expect.any(String),
                }),
            );

            expect(mockQuoApi.api.createCallWebhook).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceIds: ['PHmR5aU', 'PHxY7bZ'],
                    url: expect.any(String),
                    status: 'enabled',
                    events: expect.any(Array),
                    label: expect.any(String),
                }),
            );

            expect(
                mockQuoApi.api.createCallSummaryWebhook,
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceIds: ['PHmR5aU', 'PHxY7bZ'],
                    url: expect.any(String),
                    status: 'enabled',
                    events: expect.any(Array),
                    label: expect.any(String),
                }),
            );
        });

        it('should skip webhook creation when enabledPhoneIds is empty', async () => {
            // Setup: No phone IDs configured
            integration.config.enabledPhoneIds = [];

            // Execute
            const result = await integration.setupQuoWebhook();

            // Verify: No webhooks should be created when no phone IDs
            expect(mockQuoApi.api.createMessageWebhook).not.toHaveBeenCalled();
            expect(mockQuoApi.api.createCallWebhook).not.toHaveBeenCalled();
            expect(mockQuoApi.api.createCallSummaryWebhook).not.toHaveBeenCalled();
        });

        it('should skip webhook creation when enabledPhoneIds is undefined', async () => {
            // Setup: enabledPhoneIds not configured at all
            integration.config = {};

            // Execute
            const result = await integration.setupQuoWebhook();

            // Verify: No webhooks should be created when no phone IDs
            expect(mockQuoApi.api.createMessageWebhook).not.toHaveBeenCalled();
            expect(mockQuoApi.api.createCallWebhook).not.toHaveBeenCalled();
            expect(mockQuoApi.api.createCallSummaryWebhook).not.toHaveBeenCalled();
        });

        it('should preserve existing cleanup logic when using base class method', async () => {
            // Setup: Partial config (orphaned webhooks) with phone IDs to create new webhooks
            integration.config = {
                enabledPhoneIds: ['PHmR5aU'],
                quoMessageWebhooks: [
                    {
                        id: 'old-msg-webhook',
                        key: 'old-key',
                        resourceIds: [],
                    },
                ],
                // quoCallWebhooks is missing
                // quoCallSummaryWebhooks is missing
            };

            // Execute
            await integration.setupQuoWebhook();

            // Verify: Should attempt cleanup of orphaned webhook
            expect(mockQuoApi.api.deleteWebhook).toHaveBeenCalledWith(
                'old-msg-webhook',
            );

            // Verify: Should create new webhooks after cleanup
            expect(mockQuoApi.api.createMessageWebhook).toHaveBeenCalled();
            expect(mockQuoApi.api.createCallWebhook).toHaveBeenCalled();
            expect(mockQuoApi.api.createCallSummaryWebhook).toHaveBeenCalled();
        });

        it('should store webhook keys securely after creation', async () => {
            // Setup
            integration.config.enabledPhoneIds = ['PHmR5aU'];

            // Execute
            const result = await integration.setupQuoWebhook();

            // Verify: Config should be updated with webhook IDs and keys
            expect(mockCommands.updateIntegrationConfig).toHaveBeenCalledWith({
                integrationId: 'integration-123',
                config: expect.objectContaining({
                    quoMessageWebhooks: expect.arrayContaining([
                        expect.objectContaining({
                            id: 'msg-webhook-123',
                            key: 'msg-key-abc',
                        }),
                    ]),
                    quoCallWebhooks: expect.arrayContaining([
                        expect.objectContaining({
                            id: 'call-webhook-456',
                            key: 'call-key-def',
                        }),
                    ]),
                    quoCallSummaryWebhooks: expect.arrayContaining([
                        expect.objectContaining({
                            id: 'summary-webhook-789',
                            key: 'summary-key-ghi',
                        }),
                    ]),
                    quoWebhooksUrl: expect.any(String),
                    quoWebhooksCreatedAt: expect.any(String),
                    enabledPhoneIds: ['PHmR5aU'], // Should preserve phone IDs
                }),
            });

            // Verify: Return value includes webhook arrays
            expect(result).toEqual({
                status: 'configured',
                messageWebhooks: expect.arrayContaining([
                    expect.objectContaining({
                        id: 'msg-webhook-123',
                    }),
                ]),
                callWebhooks: expect.arrayContaining([
                    expect.objectContaining({
                        id: 'call-webhook-456',
                    }),
                ]),
                callSummaryWebhooks: expect.arrayContaining([
                    expect.objectContaining({
                        id: 'summary-webhook-789',
                    }),
                ]),
                webhookUrl: expect.any(String),
            });
        });
    });
});
