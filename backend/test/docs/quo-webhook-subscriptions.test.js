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

        it('should NOT include resourceIds when enabledPhoneIds is empty', async () => {
            // Setup: No phone IDs configured
            integration.config.enabledPhoneIds = [];

            // Execute
            await integration.setupQuoWebhook();

            // Verify: resourceIds should NOT be present
            expect(mockQuoApi.api.createMessageWebhook).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: expect.any(String),
                    status: 'enabled',
                    events: expect.any(Array),
                    label: expect.any(String),
                }),
            );

            const messageCall =
                mockQuoApi.api.createMessageWebhook.mock.calls[0][0];
            expect(messageCall).not.toHaveProperty('resourceIds');
        });

        it('should NOT include resourceIds when enabledPhoneIds is undefined', async () => {
            // Setup: enabledPhoneIds not configured at all
            integration.config = {};

            // Execute
            await integration.setupQuoWebhook();

            // Verify: resourceIds should NOT be present
            const messageCall =
                mockQuoApi.api.createMessageWebhook.mock.calls[0][0];
            expect(messageCall).not.toHaveProperty('resourceIds');
        });

        it('should preserve existing cleanup logic when using base class method', async () => {
            // Setup: Partial config (orphaned webhooks)
            integration.config = {
                quoMessageWebhookId: 'old-msg-webhook',
                // quoCallWebhookId is missing
                // quoCallSummaryWebhookId is missing
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
                    quoMessageWebhookId: 'msg-webhook-123',
                    quoMessageWebhookKey: 'msg-key-abc',
                    quoCallWebhookId: 'call-webhook-456',
                    quoCallWebhookKey: 'call-key-def',
                    quoCallSummaryWebhookId: 'summary-webhook-789',
                    quoCallSummaryWebhookKey: 'summary-key-ghi',
                    quoWebhooksUrl: expect.any(String),
                    quoWebhooksCreatedAt: expect.any(String),
                    enabledPhoneIds: ['PHmR5aU'], // Should preserve phone IDs
                }),
            });

            // Verify: Return value includes webhook IDs
            expect(result).toEqual({
                status: 'configured',
                messageWebhookId: 'msg-webhook-123',
                callWebhookId: 'call-webhook-456',
                callSummaryWebhookId: 'summary-webhook-789',
                webhookUrl: expect.any(String),
            });
        });
    });
});
