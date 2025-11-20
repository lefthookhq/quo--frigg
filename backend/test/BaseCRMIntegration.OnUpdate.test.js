const { BaseCRMIntegration } = require('../src/base/BaseCRMIntegration');

// Create a test integration class
class TestCRMIntegration extends BaseCRMIntegration {
    static WEBHOOK_EVENTS = {
        QUO_MESSAGES: ['message.created'],
        QUO_CALLS: ['call.completed'],
        QUO_CALL_SUMMARIES: ['call.summary.created'],
    };

    static WEBHOOK_LABELS = {
        QUO_MESSAGES: 'Test Messages',
        QUO_CALLS: 'Test Calls',
        QUO_CALL_SUMMARIES: 'Test Call Summaries',
    };
}

describe('BaseCRMIntegration - onUpdate Handler', () => {
    let integration;
    let mockQuoApi;
    let mockCommands;

    beforeEach(() => {
        // Mock Quo API
        mockQuoApi = {
            updateWebhook: jest
                .fn()
                .mockResolvedValue({ data: { id: 'updated' } }),
        };

        // Mock Commands
        mockCommands = {
            updateIntegrationConfig: jest.fn().mockResolvedValue({}),
        };

        // Create integration instance
        integration = new TestCRMIntegration({});
        integration.quo = { api: mockQuoApi };
        integration.commands = mockCommands;
        integration.id = 'test-integration-id';
        integration.config = {
            existingField: 'should-be-preserved',
            enabledPhoneIds: ['phone-1', 'phone-2'],
            quoMessageWebhookId: 'webhook-msg-123',
            quoCallWebhookId: 'webhook-call-123',
            quoCallSummaryWebhookId: 'webhook-summary-123',
        };

        // Mock validateConfig
        integration.validateConfig = jest.fn().mockResolvedValue(true);
    });

    describe('Config patching behavior', () => {
        it('should preserve fields not referenced in update', async () => {
            // Arrange
            const updateParams = {
                config: {
                    newField: 'new-value',
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(mockCommands.updateIntegrationConfig).toHaveBeenCalledWith({
                integrationId: 'test-integration-id',
                config: expect.objectContaining({
                    existingField: 'should-be-preserved', // Preserved
                    newField: 'new-value', // Added
                }),
            });
        });

        it('should update fields that are referenced in update', async () => {
            // Arrange
            const updateParams = {
                config: {
                    existingField: 'updated-value',
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(mockCommands.updateIntegrationConfig).toHaveBeenCalledWith({
                integrationId: 'test-integration-id',
                config: expect.objectContaining({
                    existingField: 'updated-value', // Updated
                }),
            });
        });

        it('should handle deep merge of nested objects', async () => {
            // Arrange
            integration.config = {
                nested: {
                    field1: 'value1',
                    field2: 'value2',
                },
            };

            const updateParams = {
                config: {
                    nested: {
                        field2: 'updated-value2',
                        field3: 'value3',
                    },
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(mockCommands.updateIntegrationConfig).toHaveBeenCalledWith({
                integrationId: 'test-integration-id',
                config: {
                    nested: {
                        field1: 'value1', // Preserved
                        field2: 'updated-value2', // Updated
                        field3: 'value3', // Added
                    },
                },
            });
        });
    });

    describe('Phone ID change detection and webhook updates', () => {
        it('should detect enabledPhoneIds changes and update webhooks', async () => {
            // Arrange
            const updateParams = {
                config: {
                    enabledPhoneIds: ['phone-1', 'phone-3'], // Changed
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(mockQuoApi.updateWebhook).toHaveBeenCalledWith(
                'webhook-msg-123',
                expect.objectContaining({
                    resourceIds: ['phone-1', 'phone-3'],
                }),
            );
            expect(mockQuoApi.updateWebhook).toHaveBeenCalledWith(
                'webhook-call-123',
                expect.objectContaining({
                    resourceIds: ['phone-1', 'phone-3'],
                }),
            );
            expect(mockQuoApi.updateWebhook).toHaveBeenCalledWith(
                'webhook-summary-123',
                expect.objectContaining({
                    resourceIds: ['phone-1', 'phone-3'],
                }),
            );
        });

        it('should not update webhooks if enabledPhoneIds unchanged', async () => {
            // Arrange
            const updateParams = {
                config: {
                    enabledPhoneIds: ['phone-1', 'phone-2'], // Same as before
                    otherField: 'changed',
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(mockQuoApi.updateWebhook).not.toHaveBeenCalled();
        });

        it('should handle addition of phone IDs', async () => {
            // Arrange
            const updateParams = {
                config: {
                    enabledPhoneIds: [
                        'phone-1',
                        'phone-2',
                        'phone-3',
                        'phone-4',
                    ],
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(mockQuoApi.updateWebhook).toHaveBeenCalledTimes(3);
            expect(mockQuoApi.updateWebhook).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    resourceIds: ['phone-1', 'phone-2', 'phone-3', 'phone-4'],
                }),
            );
        });

        it('should handle removal of phone IDs', async () => {
            // Arrange
            const updateParams = {
                config: {
                    enabledPhoneIds: ['phone-1'], // Removed phone-2
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(mockQuoApi.updateWebhook).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    resourceIds: ['phone-1'],
                }),
            );
        });

        it('should handle empty enabledPhoneIds array', async () => {
            // Arrange
            const updateParams = {
                config: {
                    enabledPhoneIds: [], // Removed all
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(mockQuoApi.updateWebhook).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    resourceIds: [],
                }),
            );
        });
    });

    describe('Update without phone ID changes', () => {
        it('should only update config when no phone changes', async () => {
            // Arrange
            const updateParams = {
                config: {
                    someOtherField: 'new-value',
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(mockCommands.updateIntegrationConfig).toHaveBeenCalled();
            expect(mockQuoApi.updateWebhook).not.toHaveBeenCalled();
        });
    });

    describe('Validation', () => {
        it('should call validateConfig after patching', async () => {
            // Arrange
            const updateParams = {
                config: {
                    newField: 'value',
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(integration.validateConfig).toHaveBeenCalled();
        });

        it('should throw if validateConfig fails', async () => {
            // Arrange
            integration.validateConfig = jest
                .fn()
                .mockRejectedValue(new Error('Validation failed'));

            const updateParams = {
                config: {
                    invalidField: 'bad-value',
                },
            };

            // Act & Assert
            await expect(integration.onUpdate(updateParams)).rejects.toThrow(
                'Validation failed',
            );
        });
    });

    describe('Edge cases', () => {
        it('should handle update with no config parameter', async () => {
            // Arrange
            const updateParams = {};

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(mockCommands.updateIntegrationConfig).toHaveBeenCalled();
            expect(integration.config).toEqual({
                existingField: 'should-be-preserved',
                enabledPhoneIds: ['phone-1', 'phone-2'],
                quoMessageWebhookId: 'webhook-msg-123',
                quoCallWebhookId: 'webhook-call-123',
                quoCallSummaryWebhookId: 'webhook-summary-123',
            });
        });

        it('should handle update with null config', async () => {
            // Arrange
            const updateParams = {
                config: null,
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(mockCommands.updateIntegrationConfig).toHaveBeenCalled();
        });

        it('should skip phone ID update if webhooks not configured', async () => {
            // Arrange
            integration.config = {
                enabledPhoneIds: ['phone-1'],
                // No webhook IDs
            };

            const updateParams = {
                config: {
                    enabledPhoneIds: ['phone-2'],
                },
            };

            // Act & Assert
            await expect(integration.onUpdate(updateParams)).rejects.toThrow(
                'Webhooks not configured',
            );
        });
    });

    describe('Return value', () => {
        it('should return validation result', async () => {
            // Arrange
            integration.validateConfig = jest.fn().mockResolvedValue({
                valid: true,
                message: 'Config is valid',
            });

            const updateParams = {
                config: {
                    newField: 'value',
                },
            };

            // Act
            const result = await integration.onUpdate(updateParams);

            // Assert
            expect(result).toEqual({
                valid: true,
                message: 'Config is valid',
            });
        });
    });
});
