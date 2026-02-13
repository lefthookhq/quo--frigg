const AttioIntegration = require('../src/integrations/AttioIntegration');

describe('BaseCRMIntegration - Phone Number ID Webhook Subscriptions', () => {
    let integration;
    let mockQuoApi;
    let mockCommands;

    beforeEach(() => {
        // Mock Quo API
        mockQuoApi = {
            listPhoneNumbers: jest.fn(),
            getPhoneNumber: jest.fn().mockImplementation((phoneId) => {
                const phones = {
                    'phone-id-1': {
                        data: {
                            id: 'phone-id-1',
                            phoneNumber: '+12125551234',
                            name: 'Main Line',
                        },
                    },
                    'phone-id-2': {
                        data: {
                            id: 'phone-id-2',
                            phoneNumber: '+19175555678',
                            name: 'Support Line',
                        },
                    },
                    'phone-id-3': {
                        data: {
                            id: 'phone-id-3',
                            phoneNumber: '+14155559999',
                            name: 'Sales Line',
                        },
                    },
                };
                return Promise.resolve(phones[phoneId] || { data: null });
            }),
            createMessageWebhook: jest.fn(),
            createCallWebhook: jest.fn(),
            createCallSummaryWebhook: jest.fn(),
            updateWebhook: jest.fn(),
        };

        // Mock Commands (Frigg framework)
        mockCommands = {
            updateIntegrationConfig: jest.fn().mockResolvedValue({}),
        };

        // Create integration instance (testing via AttioIntegration which extends BaseCRMIntegration)
        integration = new AttioIntegration({});
        integration.quo = { api: mockQuoApi };
        integration.commands = mockCommands;
        integration.id = 'test-integration-id';
        integration.config = {};
    });

    describe('_fetchAndStoreEnabledPhoneIds', () => {
        it('should fetch phone numbers from Quo API during setup', async () => {
            // Arrange
            const mockPhoneNumbers = {
                data: [
                    {
                        id: 'phone-id-1',
                        phoneNumber: '+12125551234',
                        name: 'Main Line',
                    },
                    {
                        id: 'phone-id-2',
                        phoneNumber: '+19175555678',
                        name: 'Support Line',
                    },
                    {
                        id: 'phone-id-3',
                        phoneNumber: '+14155559999',
                        name: 'Sales Line',
                    },
                ],
            };

            mockQuoApi.listPhoneNumbers.mockResolvedValue(mockPhoneNumbers);

            // Act
            const phoneIds = await integration._fetchAndStoreEnabledPhoneIds();

            // Assert
            expect(mockQuoApi.listPhoneNumbers).toHaveBeenCalledWith({
                maxResults: 100,
            });
            expect(phoneIds).toEqual([
                'phone-id-1',
                'phone-id-2',
                'phone-id-3',
            ]);
        });

        it('should store enabledPhoneIds in integration config', async () => {
            // Arrange
            const mockPhoneNumbers = {
                data: [
                    { id: 'phone-id-1', phoneNumber: '+12125551234' },
                    { id: 'phone-id-2', phoneNumber: '+19175555678' },
                ],
            };

            mockQuoApi.listPhoneNumbers.mockResolvedValue(mockPhoneNumbers);

            // Act
            await integration._fetchAndStoreEnabledPhoneIds();

            // Assert
            expect(mockCommands.updateIntegrationConfig).toHaveBeenCalledWith({
                integrationId: 'test-integration-id',
                config: expect.objectContaining({
                    enabledPhoneIds: ['phone-id-1', 'phone-id-2'],
                }),
            });
        });

        it('should handle empty phone numbers list', async () => {
            // Arrange
            mockQuoApi.listPhoneNumbers.mockResolvedValue({ data: [] });

            // Act
            const phoneIds = await integration._fetchAndStoreEnabledPhoneIds();

            // Assert
            expect(phoneIds).toEqual([]);
            expect(mockCommands.updateIntegrationConfig).toHaveBeenCalledWith({
                integrationId: 'test-integration-id',
                config: expect.objectContaining({
                    enabledPhoneIds: [],
                }),
            });
        });

        it('should handle API errors gracefully', async () => {
            // Arrange
            mockQuoApi.listPhoneNumbers.mockRejectedValue(
                new Error('Quo API error: Unauthorized'),
            );

            // Act & Assert
            await expect(
                integration._fetchAndStoreEnabledPhoneIds(),
            ).rejects.toThrow('Quo API error');
        });

        it('should store phone numbers metadata in config', async () => {
            // Arrange
            const mockPhoneNumbers = {
                data: [
                    {
                        id: 'phone-id-1',
                        phoneNumber: '+12125551234',
                        name: 'Main',
                    },
                ],
            };

            mockQuoApi.listPhoneNumbers.mockResolvedValue(mockPhoneNumbers);

            // Act
            await integration._fetchAndStoreEnabledPhoneIds();

            // Assert
            expect(mockCommands.updateIntegrationConfig).toHaveBeenCalledWith({
                integrationId: 'test-integration-id',
                config: expect.objectContaining({
                    phoneNumbersMetadata: mockPhoneNumbers.data,
                }),
            });
        });
    });

    describe('_createQuoWebhooksWithPhoneIds', () => {
        beforeEach(() => {
            integration.config = {
                enabledPhoneIds: ['phone-id-1', 'phone-id-2'],
            };
        });

        it('should pass resourceIds to message webhook creation', async () => {
            // Arrange
            const webhookUrl = 'https://test.example.com/webhooks/quo';

            mockQuoApi.createMessageWebhook.mockResolvedValue({
                data: { id: 'webhook-msg-123', key: 'test-key' },
            });
            mockQuoApi.createCallWebhook.mockResolvedValue({
                data: { id: 'webhook-call-123', key: 'test-key' },
            });
            mockQuoApi.createCallSummaryWebhook.mockResolvedValue({
                data: { id: 'webhook-summary-123', key: 'test-key' },
            });

            // Act
            await integration._createQuoWebhooksWithPhoneIds(
                webhookUrl,
                integration.config.enabledPhoneIds,
            );

            // Assert
            expect(mockQuoApi.createMessageWebhook).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: webhookUrl,
                    resourceIds: ['phone-id-1', 'phone-id-2'],
                }),
            );
        });

        it('should pass resourceIds to call webhook creation', async () => {
            // Arrange
            const webhookUrl = 'https://test.example.com/webhooks/quo';

            mockQuoApi.createMessageWebhook.mockResolvedValue({
                data: { id: 'webhook-msg-123', key: 'test-key' },
            });
            mockQuoApi.createCallWebhook.mockResolvedValue({
                data: { id: 'webhook-call-123', key: 'test-key' },
            });
            mockQuoApi.createCallSummaryWebhook.mockResolvedValue({
                data: { id: 'webhook-summary-123', key: 'test-key' },
            });

            // Act
            await integration._createQuoWebhooksWithPhoneIds(
                webhookUrl,
                integration.config.enabledPhoneIds,
            );

            // Assert
            expect(mockQuoApi.createCallWebhook).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: webhookUrl,
                    resourceIds: ['phone-id-1', 'phone-id-2'],
                }),
            );
        });

        it('should pass resourceIds to call summary webhook creation', async () => {
            // Arrange
            const webhookUrl = 'https://test.example.com/webhooks/quo';

            mockQuoApi.createMessageWebhook.mockResolvedValue({
                data: { id: 'webhook-msg-123', key: 'test-key' },
            });
            mockQuoApi.createCallWebhook.mockResolvedValue({
                data: { id: 'webhook-call-123', key: 'test-key' },
            });
            mockQuoApi.createCallSummaryWebhook.mockResolvedValue({
                data: { id: 'webhook-summary-123', key: 'test-key' },
            });

            // Act
            await integration._createQuoWebhooksWithPhoneIds(
                webhookUrl,
                integration.config.enabledPhoneIds,
            );

            // Assert
            expect(mockQuoApi.createCallSummaryWebhook).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: webhookUrl,
                    resourceIds: ['phone-id-1', 'phone-id-2'],
                }),
            );
        });

        it('should handle no phone IDs configured', async () => {
            // Arrange
            integration.config.enabledPhoneIds = [];
            const webhookUrl = 'https://test.example.com/webhooks/quo';

            mockQuoApi.createMessageWebhook.mockResolvedValue({
                data: { id: 'webhook-msg-123', key: 'test-key' },
            });
            mockQuoApi.createCallWebhook.mockResolvedValue({
                data: { id: 'webhook-call-123', key: 'test-key' },
            });
            mockQuoApi.createCallSummaryWebhook.mockResolvedValue({
                data: { id: 'webhook-summary-123', key: 'test-key' },
            });

            // Act
            const result = await integration._createQuoWebhooksWithPhoneIds(
                webhookUrl,
                integration.config.enabledPhoneIds,
            );

            // Assert - Should skip webhook creation and return empty arrays
            expect(mockQuoApi.createMessageWebhook).not.toHaveBeenCalled();
            expect(result).toEqual({
                messageWebhooks: [],
                callWebhooks: [],
                callSummaryWebhooks: [],
            });
        });

        it('should return created webhook IDs', async () => {
            // Arrange
            const webhookUrl = 'https://test.example.com/webhooks/quo';

            mockQuoApi.createMessageWebhook.mockResolvedValue({
                data: { id: 'webhook-msg-123', key: 'msg-key' },
            });
            mockQuoApi.createCallWebhook.mockResolvedValue({
                data: { id: 'webhook-call-456', key: 'call-key' },
            });
            mockQuoApi.createCallSummaryWebhook.mockResolvedValue({
                data: { id: 'webhook-summary-789', key: 'summary-key' },
            });

            // Act
            const result = await integration._createQuoWebhooksWithPhoneIds(
                webhookUrl,
                integration.config.enabledPhoneIds,
            );

            // Assert
            expect(result).toEqual({
                messageWebhooks: [
                    {
                        id: 'webhook-msg-123',
                        key: 'msg-key',
                        resourceIds: ['phone-id-1', 'phone-id-2'],
                    },
                ],
                callWebhooks: [
                    {
                        id: 'webhook-call-456',
                        key: 'call-key',
                        resourceIds: ['phone-id-1', 'phone-id-2'],
                    },
                ],
                callSummaryWebhooks: [
                    {
                        id: 'webhook-summary-789',
                        key: 'summary-key',
                        resourceIds: ['phone-id-1', 'phone-id-2'],
                    },
                ],
            });
        });
    });

    describe('Integration during delayed setup hook', () => {
        it('should fetch phone IDs and create webhooks with resourceIds', async () => {
            // Arrange
            const mockPhoneNumbers = {
                data: [
                    { id: 'phone-id-1', phoneNumber: '+12125551234' },
                    { id: 'phone-id-2', phoneNumber: '+19175555678' },
                ],
            };

            mockQuoApi.listPhoneNumbers.mockResolvedValue(mockPhoneNumbers);
            mockQuoApi.createMessageWebhook.mockResolvedValue({
                data: { id: 'webhook-msg-123', key: 'test-key' },
            });
            mockQuoApi.createCallWebhook.mockResolvedValue({
                data: { id: 'webhook-call-123', key: 'test-key' },
            });
            mockQuoApi.createCallSummaryWebhook.mockResolvedValue({
                data: { id: 'webhook-summary-123', key: 'test-key' },
            });

            integration._createQuoWebhooksWithPhoneIds = jest
                .fn()
                .mockResolvedValue({
                    messageWebhookId: 'webhook-msg-123',
                    callWebhookId: 'webhook-call-123',
                    callSummaryWebhookId: 'webhook-summary-123',
                });

            // Act
            await integration._fetchAndStoreEnabledPhoneIds();
            await integration._createQuoWebhooksWithPhoneIds(
                'https://test.example.com/webhook',
            );

            // Assert
            expect(mockQuoApi.listPhoneNumbers).toHaveBeenCalled();
            expect(
                integration._createQuoWebhooksWithPhoneIds,
            ).toHaveBeenCalledWith(expect.any(String));
        });
    });
});
