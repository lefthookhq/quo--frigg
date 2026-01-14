const ZohoCRMIntegration = require('../src/integrations/ZohoCRMIntegration');

describe('ZohoCRMIntegration - Backwards Compatibility', () => {
    let integration;
    let mockQuoApi;
    let mockZohoApi;
    let mockCommands;

    beforeEach(() => {
        mockQuoApi = {
            createMessageWebhook: jest.fn().mockResolvedValue({
                data: { id: 'new-msg-webhook', key: 'new-msg-key' },
            }),
            createCallWebhook: jest.fn().mockResolvedValue({
                data: { id: 'new-call-webhook', key: 'new-call-key' },
            }),
            createCallSummaryWebhook: jest.fn().mockResolvedValue({
                data: {
                    id: 'new-summary-webhook',
                    key: 'new-summary-key',
                },
            }),
            deleteWebhook: jest.fn().mockResolvedValue({ success: true }),
            listPhoneNumbers: jest.fn().mockResolvedValue({
                data: [
                    { id: 'phone-1', number: '+15551111111', name: 'Phone 1' },
                    { id: 'phone-2', number: '+15552222222', name: 'Phone 2' },
                ],
            }),
        };

        mockZohoApi = {
            enableNotification: jest.fn().mockResolvedValue({
                watch: [{ channel_id: 'zoho-channel-123' }],
            }),
            disableNotification: jest.fn().mockResolvedValue({ success: true }),
        };

        mockCommands = {
            updateIntegrationConfig: jest.fn().mockResolvedValue({}),
        };

        integration = new ZohoCRMIntegration({});
        integration.quo = { api: mockQuoApi };
        integration.zoho = { api: mockZohoApi };
        integration.commands = mockCommands;
        integration.id = 'test-integration-id';

        integration._generateWebhookUrl = jest
            .fn()
            .mockReturnValue('https://example.com/webhooks/test-integration-id');

        // Mock updateConfig method (used by _migrateOldWebhooksToNewStructure)
        integration.updateConfig = jest.fn().mockImplementation(async (config) => {
            integration.config = { ...integration.config, ...config };
            // Also call commands.updateIntegrationConfig to match real behavior
            await mockCommands.updateIntegrationConfig({
                integrationId: integration.id,
                config,
            });
            return config;
        });

        // Mock IntegrationBase parent onDelete method
        // Since ZohoCRMIntegration calls super.onDelete(params) at the end
        Object.getPrototypeOf(Object.getPrototypeOf(integration)).onDelete = jest
            .fn()
            .mockResolvedValue(undefined);
    });

    describe('_migrateOldWebhooksToNewStructure', () => {
        it('should migrate old single-webhook structure to new array structure', async () => {
            // Arrange - Integration with OLD structure
            integration.config = {
                quoMessageWebhookId: 'old-msg-webhook-123',
                quoMessageWebhookKey: 'old-msg-key-abc',
                quoCallWebhookId: 'old-call-webhook-456',
                quoCallWebhookKey: 'old-call-key-def',
                quoCallSummaryWebhookId: 'old-summary-webhook-789',
                quoCallSummaryWebhookKey: 'old-summary-key-ghi',
                enabledPhoneIds: ['phone-1', 'phone-2'],
                otherField: 'should-be-preserved',
            };

            // Act
            const migrated = await integration._migrateOldWebhooksToNewStructure();

            // Assert
            expect(migrated).toBe(true);
            expect(mockCommands.updateIntegrationConfig).toHaveBeenCalledWith({
                integrationId: 'test-integration-id',
                config: expect.objectContaining({
                    // NEW structure (arrays)
                    quoMessageWebhooks: [
                        {
                            id: 'old-msg-webhook-123',
                            key: 'old-msg-key-abc',
                            resourceIds: ['phone-1', 'phone-2'],
                        },
                    ],
                    quoCallWebhooks: [
                        {
                            id: 'old-call-webhook-456',
                            key: 'old-call-key-def',
                            resourceIds: ['phone-1', 'phone-2'],
                        },
                    ],
                    quoCallSummaryWebhooks: [
                        {
                            id: 'old-summary-webhook-789',
                            key: 'old-summary-key-ghi',
                            resourceIds: ['phone-1', 'phone-2'],
                        },
                    ],
                    // OLD fields removed
                    quoMessageWebhookId: undefined,
                    quoMessageWebhookKey: undefined,
                    quoCallWebhookId: undefined,
                    quoCallWebhookKey: undefined,
                    quoCallSummaryWebhookId: undefined,
                    quoCallSummaryWebhookKey: undefined,
                    // Other fields preserved
                    otherField: 'should-be-preserved',
                }),
            });
        });

        it('should migrate partial old structure (only some webhook types)', async () => {
            // Arrange - Only message webhook in old structure
            integration.config = {
                quoMessageWebhookId: 'old-msg-webhook-123',
                quoMessageWebhookKey: 'old-msg-key-abc',
                enabledPhoneIds: ['phone-1'],
            };

            // Act
            const migrated = await integration._migrateOldWebhooksToNewStructure();

            // Assert
            expect(migrated).toBe(true);
            expect(mockCommands.updateIntegrationConfig).toHaveBeenCalledWith({
                integrationId: 'test-integration-id',
                config: expect.objectContaining({
                    quoMessageWebhooks: [
                        {
                            id: 'old-msg-webhook-123',
                            key: 'old-msg-key-abc',
                            resourceIds: ['phone-1'],
                        },
                    ],
                    quoCallWebhooks: [],
                    quoCallSummaryWebhooks: [],
                }),
            });
        });

        it('should return false when no old structure exists', async () => {
            // Arrange - Already using new structure
            integration.config = {
                quoMessageWebhooks: [
                    { id: 'wh-1', key: 'key-1', resourceIds: ['phone-1'] },
                ],
                quoCallWebhooks: [],
                quoCallSummaryWebhooks: [],
            };

            // Act
            const migrated = await integration._migrateOldWebhooksToNewStructure();

            // Assert
            expect(migrated).toBe(false);
            expect(mockCommands.updateIntegrationConfig).not.toHaveBeenCalled();
        });

        it('should handle empty enabledPhoneIds during migration', async () => {
            // Arrange
            integration.config = {
                quoMessageWebhookId: 'old-msg-webhook-123',
                quoMessageWebhookKey: 'old-msg-key-abc',
                enabledPhoneIds: [],
            };

            // Act
            const migrated = await integration._migrateOldWebhooksToNewStructure();

            // Assert
            expect(migrated).toBe(true);
            expect(mockCommands.updateIntegrationConfig).toHaveBeenCalledWith({
                integrationId: 'test-integration-id',
                config: expect.objectContaining({
                    quoMessageWebhooks: [
                        {
                            id: 'old-msg-webhook-123',
                            key: 'old-msg-key-abc',
                            resourceIds: [],
                        },
                    ],
                }),
            });
        });
    });

    describe('setupQuoWebhook - Old Structure Detection', () => {
        beforeEach(() => {
            mockQuoApi.listPhoneNumbers.mockResolvedValue({
                data: [
                    { id: 'phone-1', number: '+15551111111', name: 'Phone 1' },
                    { id: 'phone-2', number: '+15552222222', name: 'Phone 2' },
                ],
            });
        });

        it('should detect old structure and trigger migration', async () => {
            // Arrange - Integration with OLD structure
            integration.config = {
                quoMessageWebhookId: 'old-msg-webhook-123',
                quoMessageWebhookKey: 'old-msg-key-abc',
                quoCallWebhookId: 'old-call-webhook-456',
                quoCallWebhookKey: 'old-call-key-def',
                quoCallSummaryWebhookId: 'old-summary-webhook-789',
                quoCallSummaryWebhookKey: 'old-summary-key-ghi',
                enabledPhoneIds: ['phone-1', 'phone-2'],
            };

            // Spy on migration method
            const migrateSpy = jest.spyOn(
                integration,
                '_migrateOldWebhooksToNewStructure',
            );

            // Act
            const result = await integration.setupQuoWebhook();

            // Assert
            expect(migrateSpy).toHaveBeenCalled();
            expect(result.status).toBe('migrated');
            expect(result.messageWebhooks).toBeDefined();
            expect(result.callWebhooks).toBeDefined();
            expect(result.callSummaryWebhooks).toBeDefined();

            // Should NOT create new webhooks
            expect(mockQuoApi.createMessageWebhook).not.toHaveBeenCalled();
            expect(mockQuoApi.createCallWebhook).not.toHaveBeenCalled();
            expect(mockQuoApi.createCallSummaryWebhook).not.toHaveBeenCalled();
        });

        it('should proceed normally when no old structure exists', async () => {
            // Arrange - Empty config (new integration)
            integration.config = {};

            // Act
            const result = await integration.setupQuoWebhook();

            // Assert - When config is fresh, setupQuoWebhook creates webhooks and returns success
            // Note: The method might return 'configured' if webhooks already exist, or 'success' if newly created
            expect(['success', 'configured']).toContain(result.status);

            // Should attempt to create webhooks since no old or new structure exists
            expect(mockQuoApi.createMessageWebhook).toHaveBeenCalled();
            expect(mockQuoApi.createCallWebhook).toHaveBeenCalled();
            expect(mockQuoApi.createCallSummaryWebhook).toHaveBeenCalled();
        });

        it('should not create duplicate webhooks when old structure exists', async () => {
            // Arrange - Old structure present
            integration.config = {
                quoMessageWebhookId: 'old-msg-webhook-123',
                quoMessageWebhookKey: 'old-msg-key-abc',
            };

            // Act
            await integration.setupQuoWebhook();

            // Assert - Migration should happen, no new webhooks created
            expect(mockQuoApi.createMessageWebhook).not.toHaveBeenCalled();
            expect(mockQuoApi.createCallWebhook).not.toHaveBeenCalled();
            expect(mockQuoApi.createCallSummaryWebhook).not.toHaveBeenCalled();
        });
    });

    describe('_verifyQuoWebhookSignature - Old Structure Support', () => {
        beforeEach(() => {
            // Mock crypto verification
            integration._verifySignatureWithKey = jest.fn();
        });

        it('should verify signature using old webhook key for message events', async () => {
            // Arrange - Integration with OLD structure
            integration.config = {
                quoMessageWebhookKey: 'old-msg-key-abc',
            };

            const headers = {
                'openphone-signature': 'hmac;v1;1234567890;signature-hash',
            };
            const body = { id: 'event-123', type: 'message.created' };

            // Act
            await integration._verifyQuoWebhookSignature(
                headers,
                body,
                'message.created',
            );

            // Assert - Should use old key
            expect(integration._verifySignatureWithKey).toHaveBeenCalledWith(
                'old-msg-key-abc',
                '1234567890',
                body,
                'signature-hash',
            );
        });

        it('should verify signature using old webhook key for call events', async () => {
            // Arrange
            integration.config = {
                quoCallWebhookKey: 'old-call-key-def',
            };

            const headers = {
                'openphone-signature': 'hmac;v1;1234567890;signature-hash',
            };
            const body = { id: 'event-456', type: 'call.completed' };

            // Act
            await integration._verifyQuoWebhookSignature(
                headers,
                body,
                'call.completed',
            );

            // Assert
            expect(integration._verifySignatureWithKey).toHaveBeenCalledWith(
                'old-call-key-def',
                '1234567890',
                body,
                'signature-hash',
            );
        });

        it('should verify signature using old webhook key for call summary events', async () => {
            // Arrange
            integration.config = {
                quoCallSummaryWebhookKey: 'old-summary-key-ghi',
            };

            const headers = {
                'openphone-signature': 'hmac;v1;1234567890;signature-hash',
            };
            const body = { id: 'event-789', type: 'call.summary.created' };

            // Act
            await integration._verifyQuoWebhookSignature(
                headers,
                body,
                'call.summary.created',
            );

            // Assert
            expect(integration._verifySignatureWithKey).toHaveBeenCalledWith(
                'old-summary-key-ghi',
                '1234567890',
                body,
                'signature-hash',
            );
        });

        it('should use new structure when old keys are not present', async () => {
            // Arrange - NEW structure (array)
            integration.config = {
                quoMessageWebhooks: [
                    {
                        id: 'wh-1',
                        key: 'new-key-1',
                        resourceIds: ['phone-1'],
                    },
                ],
            };

            const headers = {
                'openphone-signature': 'hmac;v1;1234567890;signature-hash',
            };
            const body = { id: 'wh-1', type: 'message.created' };

            // Act
            await integration._verifyQuoWebhookSignature(
                headers,
                body,
                'message.created',
            );

            // Assert - Should use new key from array
            expect(integration._verifySignatureWithKey).toHaveBeenCalledWith(
                'new-key-1',
                '1234567890',
                body,
                'signature-hash',
            );
        });

        it('should return early after verifying with old key (not check new structure)', async () => {
            // Arrange - Both old and new structures present (during migration transition)
            integration.config = {
                quoMessageWebhookKey: 'old-msg-key-abc', // OLD
                quoMessageWebhooks: [
                    // NEW (should not be used)
                    {
                        id: 'wh-1',
                        key: 'new-key-1',
                        resourceIds: ['phone-1'],
                    },
                ],
            };

            const headers = {
                'openphone-signature': 'hmac;v1;1234567890;signature-hash',
            };
            const body = { id: 'event-123', type: 'message.created' };

            // Act
            await integration._verifyQuoWebhookSignature(
                headers,
                body,
                'message.created',
            );

            // Assert - Should ONLY verify with old key, not try new keys
            expect(integration._verifySignatureWithKey).toHaveBeenCalledTimes(
                1,
            );
            expect(integration._verifySignatureWithKey).toHaveBeenCalledWith(
                'old-msg-key-abc',
                expect.any(String),
                body,
                expect.any(String),
            );
        });
    });

    describe('onDelete - Old Structure Cleanup', () => {
        it('should delete old structure webhooks along with new structure', async () => {
            // Arrange - Integration with BOTH old and new structures
            integration.config = {
                // OLD structure
                quoMessageWebhookId: 'old-msg-webhook-123',
                quoCallWebhookId: 'old-call-webhook-456',
                quoCallSummaryWebhookId: 'old-summary-webhook-789',
                // NEW structure
                quoMessageWebhooks: [
                    {
                        id: 'new-msg-webhook-1',
                        key: 'key-1',
                        resourceIds: ['phone-1'],
                    },
                ],
                quoCallWebhooks: [
                    {
                        id: 'new-call-webhook-1',
                        key: 'key-2',
                        resourceIds: ['phone-1'],
                    },
                ],
                quoCallSummaryWebhooks: [
                    {
                        id: 'new-summary-webhook-1',
                        key: 'key-3',
                        resourceIds: ['phone-1'],
                    },
                ],
            };

            // Act
            await integration.onDelete({});

            // Assert - Should delete ALL webhooks (old + new)
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledWith(
                'new-msg-webhook-1',
            );
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledWith(
                'new-call-webhook-1',
            );
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledWith(
                'new-summary-webhook-1',
            );
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledWith(
                'old-msg-webhook-123',
            );
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledWith(
                'old-call-webhook-456',
            );
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledWith(
                'old-summary-webhook-789',
            );
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledTimes(6);
        });

        it('should delete only old webhooks when only old structure exists', async () => {
            // Arrange - Only OLD structure
            integration.config = {
                quoMessageWebhookId: 'old-msg-webhook-123',
                quoCallWebhookId: 'old-call-webhook-456',
                quoCallSummaryWebhookId: 'old-summary-webhook-789',
            };

            // Act
            await integration.onDelete({});

            // Assert
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledWith(
                'old-msg-webhook-123',
            );
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledWith(
                'old-call-webhook-456',
            );
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledWith(
                'old-summary-webhook-789',
            );
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledTimes(3);
        });

        it('should handle partial old structure during deletion', async () => {
            // Arrange - Only message webhook in old structure
            integration.config = {
                quoMessageWebhookId: 'old-msg-webhook-123',
            };

            // Act
            await integration.onDelete({});

            // Assert - Should only try to delete what exists
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledWith(
                'old-msg-webhook-123',
            );
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledTimes(1);
        });

        it('should not fail if old webhook deletion fails', async () => {
            // Arrange
            integration.config = {
                quoMessageWebhookId: 'old-msg-webhook-123',
            };

            mockQuoApi.deleteWebhook.mockRejectedValue(
                new Error('Webhook not found'),
            );

            // Act & Assert - Should not throw
            await expect(integration.onDelete({})).resolves.not.toThrow();
        });

        it('should proceed with new webhook deletion even if old deletion fails', async () => {
            // Arrange
            integration.config = {
                quoMessageWebhookId: 'old-msg-webhook-123',
                quoMessageWebhooks: [
                    {
                        id: 'new-msg-webhook-1',
                        key: 'key-1',
                        resourceIds: ['phone-1'],
                    },
                ],
                quoCallWebhooks: [],
                quoCallSummaryWebhooks: [],
            };

            mockQuoApi.deleteWebhook
                .mockRejectedValueOnce(new Error('Old webhook not found'))
                .mockResolvedValueOnce({ success: true });

            // Act
            await integration.onDelete({});

            // Assert - Should attempt to delete both
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledWith(
                'new-msg-webhook-1',
            );
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledWith(
                'old-msg-webhook-123',
            );
        });
    });

    describe('End-to-End Backwards Compatibility Flow', () => {
        it('should support full lifecycle: old structure -> migration -> deletion', async () => {
            // Step 1: Start with OLD structure
            integration.config = {
                quoMessageWebhookId: 'old-msg-webhook-123',
                quoMessageWebhookKey: 'old-msg-key-abc',
                quoCallWebhookId: 'old-call-webhook-456',
                quoCallWebhookKey: 'old-call-key-def',
                quoCallSummaryWebhookId: 'old-summary-webhook-789',
                quoCallSummaryWebhookKey: 'old-summary-key-ghi',
                enabledPhoneIds: ['phone-1', 'phone-2'],
            };

            // Step 2: Setup webhook triggers migration
            const setupResult = await integration.setupQuoWebhook();

            expect(setupResult.status).toBe('migrated');
            expect(setupResult.messageWebhooks).toHaveLength(1);
            expect(setupResult.messageWebhooks[0].id).toBe(
                'old-msg-webhook-123',
            );

            // Step 3: Verify signature works with old key (during transition)
            integration._verifySignatureWithKey = jest.fn();
            const headers = {
                'openphone-signature': 'hmac;v1;1234567890;signature-hash',
            };
            const body = { id: 'event-123', type: 'message.created' };

            await integration._verifyQuoWebhookSignature(
                headers,
                body,
                'message.created',
            );

            expect(integration._verifySignatureWithKey).toHaveBeenCalledWith(
                'old-msg-key-abc',
                expect.any(String),
                body,
                expect.any(String),
            );

            // Step 4: Deletion cleans up old webhooks
            await integration.onDelete({});

            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledWith(
                'old-msg-webhook-123',
            );
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledWith(
                'old-call-webhook-456',
            );
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledWith(
                'old-summary-webhook-789',
            );
        });
    });
});
