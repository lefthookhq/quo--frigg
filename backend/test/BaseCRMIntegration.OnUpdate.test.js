const { BaseCRMIntegration } = require('../src/base/BaseCRMIntegration');

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

    let webhookIdCounter;

    beforeEach(() => {
        webhookIdCounter = 0;

        mockQuoApi = {
            updateWebhook: jest
                .fn()
                .mockResolvedValue({ data: { id: 'updated' } }),
            deleteWebhook: jest.fn().mockResolvedValue({ success: true }),
            createMessageWebhook: jest.fn().mockImplementation(() => {
                const id = `new-msg-webhook-${++webhookIdCounter}`;
                return Promise.resolve({ data: { id, key: `key-${id}` } });
            }),
            createCallWebhook: jest.fn().mockImplementation(() => {
                const id = `new-call-webhook-${++webhookIdCounter}`;
                return Promise.resolve({ data: { id, key: `key-${id}` } });
            }),
            createCallSummaryWebhook: jest.fn().mockImplementation(() => {
                const id = `new-summary-webhook-${++webhookIdCounter}`;
                return Promise.resolve({ data: { id, key: `key-${id}` } });
            }),
            listPhoneNumbers: jest.fn().mockResolvedValue({
                data: [
                    { id: 'phone-1', number: '+15551111111', name: 'Phone 1' },
                    { id: 'phone-2', number: '+15552222222', name: 'Phone 2' },
                    { id: 'phone-3', number: '+15553333333', name: 'Phone 3' },
                    { id: 'phone-4', number: '+15554444444', name: 'Phone 4' },
                ],
            }),
        };

        mockCommands = {
            updateIntegrationConfig: jest.fn().mockResolvedValue({}),
        };

        integration = new TestCRMIntegration({});
        integration.quo = { api: mockQuoApi };
        integration.commands = mockCommands;
        integration.id = 'test-integration-id';
        integration.config = {
            existingField: 'should-be-preserved',
            enabledPhoneIds: ['phone-1', 'phone-2'],
            phoneNumbersMetadata: [
                { id: 'phone-1', number: '+15551111111', name: 'Phone 1' },
                { id: 'phone-2', number: '+15552222222', name: 'Phone 2' },
            ],
            quoMessageWebhookId: 'webhook-msg-123',
            quoMessageWebhookKey: 'key-webhook-msg-123',
            quoCallWebhookId: 'webhook-call-123',
            quoCallWebhookKey: 'key-webhook-call-123',
            quoCallSummaryWebhookId: 'webhook-summary-123',
            quoCallSummaryWebhookKey: 'key-webhook-summary-123',
        };

        integration.validateConfig = jest.fn().mockResolvedValue(true);
        integration._generateWebhookUrl = jest
            .fn()
            .mockReturnValue('https://example.com/webhooks/test-integration-id');
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
                    existingField: 'should-be-preserved',
                    newField: 'new-value',
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
                    existingField: 'updated-value',
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
                        field1: 'value1',
                        field2: 'updated-value2',
                        field3: 'value3',
                    },
                },
            });
        });
    });

    describe('Phone ID change detection and webhook updates', () => {
        it('should detect enabledPhoneIds changes and recreate webhooks', async () => {
            // Arrange
            const updateParams = {
                config: {
                    enabledPhoneIds: ['phone-1', 'phone-3'],
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledWith(
                'webhook-msg-123',
            );
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledWith(
                'webhook-call-123',
            );
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledWith(
                'webhook-summary-123',
            );
            expect(mockQuoApi.createMessageWebhook).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceIds: ['phone-1', 'phone-3'],
                }),
            );
            expect(mockQuoApi.createCallWebhook).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceIds: ['phone-1', 'phone-3'],
                }),
            );
            expect(mockQuoApi.createCallSummaryWebhook).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceIds: ['phone-1', 'phone-3'],
                }),
            );
        });

        it('should not update webhooks if enabledPhoneIds unchanged', async () => {
            // Arrange
            const updateParams = {
                config: {
                    enabledPhoneIds: ['phone-1', 'phone-2'],
                    otherField: 'changed',
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(mockQuoApi.deleteWebhook).not.toHaveBeenCalled();
            expect(mockQuoApi.createMessageWebhook).not.toHaveBeenCalled();
            expect(mockQuoApi.createCallWebhook).not.toHaveBeenCalled();
            expect(mockQuoApi.createCallSummaryWebhook).not.toHaveBeenCalled();
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
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledTimes(3);
            expect(mockQuoApi.createMessageWebhook).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceIds: ['phone-1', 'phone-2', 'phone-3', 'phone-4'],
                }),
            );
            expect(mockQuoApi.createCallWebhook).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceIds: ['phone-1', 'phone-2', 'phone-3', 'phone-4'],
                }),
            );
            expect(mockQuoApi.createCallSummaryWebhook).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceIds: ['phone-1', 'phone-2', 'phone-3', 'phone-4'],
                }),
            );
        });

        it('should handle removal of phone IDs', async () => {
            // Arrange
            const updateParams = {
                config: {
                    enabledPhoneIds: ['phone-1'],
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(mockQuoApi.createMessageWebhook).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceIds: ['phone-1'],
                }),
            );
        });

        it('should handle empty enabledPhoneIds array', async () => {
            // Arrange
            const updateParams = {
                config: {
                    enabledPhoneIds: [],
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert - resourceIds should be omitted when no phones selected
            expect(mockQuoApi.createMessageWebhook).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: expect.any(String),
                    status: 'enabled',
                }),
            );
            const callArgs =
                mockQuoApi.createMessageWebhook.mock.calls[0][0];
            expect(callArgs).not.toHaveProperty('resourceIds');
        });
    });

    describe('Webhook rollback behavior on creation failure', () => {
        it('should rollback message webhook if call webhook creation fails', async () => {
            // Arrange
            let createdMessageWebhookId;
            mockQuoApi.createMessageWebhook = jest.fn().mockImplementation(() => {
                createdMessageWebhookId = `msg-webhook-${Date.now()}`;
                return Promise.resolve({
                    data: { id: createdMessageWebhookId, key: 'test-key' },
                });
            });
            mockQuoApi.createCallWebhook = jest
                .fn()
                .mockRejectedValue(new Error('Call webhook API error'));

            const updateParams = {
                config: {
                    enabledPhoneIds: ['phone-3'],
                },
            };

            // Act & Assert
            await expect(integration.onUpdate(updateParams)).rejects.toThrow(
                'Call webhook API error',
            );
            expect(mockQuoApi.createMessageWebhook).toHaveBeenCalledTimes(1);
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledWith(
                createdMessageWebhookId,
            );
        });

        it('should rollback message and call webhooks if call summary webhook creation fails', async () => {
            // Arrange
            let createdMessageWebhookId;
            let createdCallWebhookId;

            mockQuoApi.createMessageWebhook = jest.fn().mockImplementation(() => {
                createdMessageWebhookId = `msg-webhook-${Date.now()}`;
                return Promise.resolve({
                    data: { id: createdMessageWebhookId, key: 'test-key' },
                });
            });
            mockQuoApi.createCallWebhook = jest.fn().mockImplementation(() => {
                createdCallWebhookId = `call-webhook-${Date.now()}`;
                return Promise.resolve({
                    data: { id: createdCallWebhookId, key: 'test-key' },
                });
            });
            mockQuoApi.createCallSummaryWebhook = jest
                .fn()
                .mockRejectedValue(new Error('Call summary webhook API error'));

            const updateParams = {
                config: {
                    enabledPhoneIds: ['phone-3'],
                },
            };

            // Act & Assert
            await expect(integration.onUpdate(updateParams)).rejects.toThrow(
                'Call summary webhook API error',
            );
            expect(mockQuoApi.createMessageWebhook).toHaveBeenCalledTimes(1);
            expect(mockQuoApi.createCallWebhook).toHaveBeenCalledTimes(1);
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledWith(
                createdMessageWebhookId,
            );
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledWith(
                createdCallWebhookId,
            );
        });

        it('should not save config to database if webhook creation fails', async () => {
            // Arrange
            mockQuoApi.createMessageWebhook = jest
                .fn()
                .mockRejectedValue(new Error('Webhook creation failed'));

            const updateParams = {
                config: {
                    enabledPhoneIds: ['phone-3'],
                },
            };

            // Act & Assert
            await expect(integration.onUpdate(updateParams)).rejects.toThrow(
                'Webhook creation failed',
            );
            expect(mockCommands.updateIntegrationConfig).not.toHaveBeenCalled();
        });

        it('should continue rollback even if rollback deletion fails', async () => {
            // Arrange
            let createdMessageWebhookId;
            mockQuoApi.createMessageWebhook = jest.fn().mockImplementation(() => {
                createdMessageWebhookId = `msg-webhook-${Date.now()}`;
                return Promise.resolve({
                    data: { id: createdMessageWebhookId, key: 'test-key' },
                });
            });
            mockQuoApi.createCallWebhook = jest
                .fn()
                .mockRejectedValue(new Error('Call webhook API error'));
            mockQuoApi.deleteWebhook = jest
                .fn()
                .mockRejectedValue(new Error('Deletion failed'));

            const updateParams = {
                config: {
                    enabledPhoneIds: ['phone-3'],
                },
            };

            // Act & Assert - should throw original error, not rollback error
            await expect(integration.onUpdate(updateParams)).rejects.toThrow(
                'Call webhook API error',
            );
            expect(mockQuoApi.deleteWebhook).toHaveBeenCalledWith(
                createdMessageWebhookId,
            );
        });

        it('should preserve original config when webhook recreation fails', async () => {
            // Arrange
            const originalConfig = { ...integration.config };
            mockQuoApi.createMessageWebhook = jest
                .fn()
                .mockRejectedValue(new Error('API Error'));

            const updateParams = {
                config: {
                    enabledPhoneIds: ['phone-3'],
                },
            };

            // Act
            try {
                await integration.onUpdate(updateParams);
            } catch (e) {}

            // Assert
            expect(integration.config).toEqual(originalConfig);
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
            expect(mockQuoApi.deleteWebhook).not.toHaveBeenCalled();
            expect(mockQuoApi.createMessageWebhook).not.toHaveBeenCalled();
            expect(mockQuoApi.createCallWebhook).not.toHaveBeenCalled();
            expect(mockQuoApi.createCallSummaryWebhook).not.toHaveBeenCalled();
        });
    });

    describe('Config persistence', () => {
        it('should persist config to database', async () => {
            // Arrange
            const updateParams = {
                config: {
                    newField: 'value',
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(mockCommands.updateIntegrationConfig).toHaveBeenCalledWith({
                integrationId: 'test-integration-id',
                config: expect.objectContaining({
                    newField: 'value',
                }),
            });
        });

        it('should update local config after persisting', async () => {
            // Arrange
            const updateParams = {
                config: {
                    newField: 'new-value',
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(integration.config.newField).toBe('new-value');
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
            expect(integration.config).toEqual(
                expect.objectContaining({
                    existingField: 'should-be-preserved',
                    enabledPhoneIds: ['phone-1', 'phone-2'],
                    quoMessageWebhookId: 'webhook-msg-123',
                    quoCallWebhookId: 'webhook-call-123',
                    quoCallSummaryWebhookId: 'webhook-summary-123',
                }),
            );
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

        it('should throw error if webhooks not configured when phone IDs change', async () => {
            // Arrange
            integration.config = {
                enabledPhoneIds: ['phone-1'],
                phoneNumbersMetadata: [
                    { id: 'phone-1', number: '+15551111111', name: 'Phone 1' },
                ],
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
        it('should return success status and updated config', async () => {
            // Arrange
            const updateParams = {
                config: {
                    newField: 'value',
                },
            };

            // Act
            const result = await integration.onUpdate(updateParams);

            // Assert
            expect(result).toEqual({
                success: true,
                config: expect.objectContaining({
                    newField: 'value',
                }),
            });
        });
    });

    describe('phoneNumbersMetadata sync', () => {
        let webhookIdCounter;

        beforeEach(() => {
            webhookIdCounter = 1000;

            integration.config = {
                enabledPhoneIds: ['phone-1', 'phone-2'],
                phoneNumbersMetadata: [
                    { id: 'phone-1', number: '+11111111111', name: 'Main Line' },
                    { id: 'phone-2', number: '+12222222222', name: 'Support Line' },
                ],
                phoneNumbersFetchedAt: '2024-01-01T00:00:00.000Z',
                quoMessageWebhookId: 'webhook-msg-123',
                quoCallWebhookId: 'webhook-call-123',
                quoCallSummaryWebhookId: 'webhook-summary-123',
            };

            mockQuoApi.getPhoneNumber = jest.fn().mockImplementation((phoneId) => {
                const phones = {
                    'phone-1': { data: { id: 'phone-1', number: '+11111111111', name: 'Main Line' } },
                    'phone-2': { data: { id: 'phone-2', number: '+12222222222', name: 'Support Line' } },
                    'phone-3': { data: { id: 'phone-3', number: '+13333333333', name: 'Sales Line' } },
                    'phone-4': { data: { id: 'phone-4', number: '+14444444444', name: 'Marketing Line' } },
                };
                return Promise.resolve(phones[phoneId] || { data: null });
            });

            mockQuoApi.listPhoneNumbers = jest.fn().mockImplementation(({ maxResults, ids } = {}) => {
                const allPhones = [
                    { id: 'phone-1', number: '+11111111111', name: 'Main Line' },
                    { id: 'phone-2', number: '+12222222222', name: 'Support Line' },
                    { id: 'phone-3', number: '+13333333333', name: 'Sales Line' },
                    { id: 'phone-4', number: '+14444444444', name: 'Marketing Line' },
                ];
                if (ids && Array.isArray(ids)) {
                    return Promise.resolve({ data: allPhones.filter(p => ids.includes(p.id)) });
                }
                return Promise.resolve({ data: allPhones });
            });

            mockQuoApi.createMessageWebhook = jest.fn().mockImplementation(() => {
                const id = `new-msg-webhook-${++webhookIdCounter}`;
                return Promise.resolve({
                    data: { id, key: `key-${id}` },
                });
            });
            mockQuoApi.createCallWebhook = jest.fn().mockImplementation(() => {
                const id = `new-call-webhook-${++webhookIdCounter}`;
                return Promise.resolve({
                    data: { id, key: `key-${id}` },
                });
            });
            mockQuoApi.createCallSummaryWebhook = jest.fn().mockImplementation(() => {
                const id = `new-summary-webhook-${++webhookIdCounter}`;
                return Promise.resolve({
                    data: { id, key: `key-${id}` },
                });
            });
            mockQuoApi.deleteWebhook = jest.fn().mockResolvedValue({ success: true });

            integration._generateWebhookUrl = jest.fn().mockReturnValue(
                'https://example.com/webhooks/test-integration-id'
            );
        });

        it('should update phoneNumbersMetadata when adding a new phone number', async () => {
            // Arrange
            const updateParams = {
                config: {
                    enabledPhoneIds: ['phone-1', 'phone-2', 'phone-3'],
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(integration.config.phoneNumbersMetadata).toHaveLength(3);
            expect(integration.config.phoneNumbersMetadata).toContainEqual(
                expect.objectContaining({ id: 'phone-3', number: '+13333333333' })
            );
        });

        it('should update phoneNumbersMetadata when removing a phone number', async () => {
            // Arrange
            const updateParams = {
                config: {
                    enabledPhoneIds: ['phone-1'],
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(integration.config.phoneNumbersMetadata).toHaveLength(1);
            expect(integration.config.phoneNumbersMetadata).not.toContainEqual(
                expect.objectContaining({ id: 'phone-2' })
            );
            expect(integration.config.phoneNumbersMetadata).toContainEqual(
                expect.objectContaining({ id: 'phone-1', number: '+11111111111' })
            );
        });

        it('should update phoneNumbersMetadata when replacing all phone numbers', async () => {
            // Arrange
            const updateParams = {
                config: {
                    enabledPhoneIds: ['phone-3', 'phone-4'],
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(integration.config.phoneNumbersMetadata).toHaveLength(2);
            expect(integration.config.phoneNumbersMetadata).toContainEqual(
                expect.objectContaining({ id: 'phone-3', number: '+13333333333' })
            );
            expect(integration.config.phoneNumbersMetadata).toContainEqual(
                expect.objectContaining({ id: 'phone-4', number: '+14444444444' })
            );
            expect(integration.config.phoneNumbersMetadata).not.toContainEqual(
                expect.objectContaining({ id: 'phone-1' })
            );
            expect(integration.config.phoneNumbersMetadata).not.toContainEqual(
                expect.objectContaining({ id: 'phone-2' })
            );
        });

        it('should clear phoneNumbersMetadata when all phone numbers are removed', async () => {
            // Arrange
            const updateParams = {
                config: {
                    enabledPhoneIds: [],
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(integration.config.phoneNumbersMetadata).toHaveLength(0);
        });

        it('should update phoneNumbersFetchedAt timestamp when phone IDs change', async () => {
            // Arrange
            const originalTimestamp = integration.config.phoneNumbersFetchedAt;
            const updateParams = {
                config: {
                    enabledPhoneIds: ['phone-1', 'phone-3'],
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(integration.config.phoneNumbersFetchedAt).not.toBe(originalTimestamp);
            expect(new Date(integration.config.phoneNumbersFetchedAt).getTime())
                .toBeGreaterThan(new Date(originalTimestamp).getTime());
        });

        it('should persist updated phoneNumbersMetadata to database', async () => {
            // Arrange
            const updateParams = {
                config: {
                    enabledPhoneIds: ['phone-1', 'phone-3'],
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(mockCommands.updateIntegrationConfig).toHaveBeenCalledWith(
                expect.objectContaining({
                    config: expect.objectContaining({
                        phoneNumbersMetadata: expect.arrayContaining([
                            expect.objectContaining({ id: 'phone-3' }),
                        ]),
                    }),
                })
            );
        });

        it('should call Quo API to fetch phone metadata when phone IDs change', async () => {
            // Arrange
            const updateParams = {
                config: {
                    enabledPhoneIds: ['phone-1', 'phone-3'],
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            const apiWasCalled =
                mockQuoApi.listPhoneNumbers.mock.calls.length > 0 ||
                mockQuoApi.getPhoneNumber.mock.calls.length > 0;
            expect(apiWasCalled).toBe(true);
        });

        it('should NOT refetch phoneNumbersMetadata when phone IDs are unchanged', async () => {
            // Arrange
            const updateParams = {
                config: {
                    enabledPhoneIds: ['phone-1', 'phone-2'],
                    someOtherField: 'changed',
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(mockQuoApi.listPhoneNumbers).not.toHaveBeenCalled();
            expect(mockQuoApi.getPhoneNumber).not.toHaveBeenCalled();
        });

        it('should handle initially undefined phoneNumbersMetadata', async () => {
            // Arrange
            integration.config = {
                enabledPhoneIds: ['phone-1'],
                quoMessageWebhookId: 'webhook-msg-123',
                quoCallWebhookId: 'webhook-call-123',
                quoCallSummaryWebhookId: 'webhook-summary-123',
            };

            const updateParams = {
                config: {
                    enabledPhoneIds: ['phone-1', 'phone-2'],
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            expect(integration.config.phoneNumbersMetadata).toBeDefined();
            expect(integration.config.phoneNumbersMetadata).toHaveLength(2);
            expect(integration.config.phoneNumbersMetadata).toContainEqual(
                expect.objectContaining({ id: 'phone-1' })
            );
            expect(integration.config.phoneNumbersMetadata).toContainEqual(
                expect.objectContaining({ id: 'phone-2' })
            );
        });

        it('should handle phone IDs not found in Quo API', async () => {
            // Arrange
            const updateParams = {
                config: {
                    enabledPhoneIds: ['phone-3', 'non-existent-phone'],
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            const validPhones = integration.config.phoneNumbersMetadata.filter(
                (p) => p && p.id
            );
            expect(validPhones).toContainEqual(
                expect.objectContaining({ id: 'phone-3' })
            );
            expect(validPhones).not.toContainEqual(
                expect.objectContaining({ id: 'non-existent-phone' })
            );
            expect(validPhones).not.toContainEqual(
                expect.objectContaining({ id: 'phone-1' })
            );
            expect(validPhones).not.toContainEqual(
                expect.objectContaining({ id: 'phone-2' })
            );
        });

        it('should save updated metadata to database in single call with complete config', async () => {
            // Arrange
            const updateParams = {
                config: {
                    enabledPhoneIds: ['phone-1', 'phone-3'],
                },
            };

            // Act
            await integration.onUpdate(updateParams);

            // Assert
            const dbCalls = mockCommands.updateIntegrationConfig.mock.calls;
            const finalConfig = dbCalls[dbCalls.length - 1][0].config;

            expect(finalConfig.enabledPhoneIds).toEqual(['phone-1', 'phone-3']);
            expect(finalConfig.phoneNumbersMetadata).toHaveLength(2);
            expect(finalConfig.phoneNumbersMetadata).toContainEqual(
                expect.objectContaining({ id: 'phone-1' })
            );
            expect(finalConfig.phoneNumbersMetadata).toContainEqual(
                expect.objectContaining({ id: 'phone-3' })
            );
        });
    });
});
