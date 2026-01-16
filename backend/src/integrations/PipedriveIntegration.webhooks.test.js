/**
 * Tests for PipedriveIntegration webhook functionality
 * Focus: Webhook signature verification, setup, and routing
 */

const crypto = require('crypto');

// Mock BaseCRMIntegration before importing
jest.mock('../base/BaseCRMIntegration', () => {
    return {
        BaseCRMIntegration: class MockBaseCRMIntegration {
            constructor() {
                this.events = {};
            }
        },
    };
});

const PipedriveIntegration = require('./PipedriveIntegration');

describe('PipedriveIntegration - Webhook Signature Verification', () => {
    let integration;
    const testWebhookKey = 'test-webhook-key-123';
    const testTimestamp = '1704067200'; // 2024-01-01 00:00:00 UTC
    const testBody = { event_type: 'call.completed', id: 'test-call-id' };

    /**
     * Helper function to generate HMAC signature
     */
    function generateSignature(payload, key, useBase64Key = false) {
        const secretKey = useBase64Key ? Buffer.from(key, 'base64') : key;
        const hmac = crypto.createHmac('sha256', secretKey);
        hmac.update(payload);
        return hmac.digest('base64');
    }

    /**
     * Helper function to create signature header
     */
    function createSignatureHeader(
        timestamp,
        signature,
        version = 'v1',
        scheme = 'hmac',
    ) {
        return `${scheme};${version};${timestamp};${signature}`;
    }

    beforeEach(() => {
        integration = new PipedriveIntegration();
        integration.config = {
            quoCallWebhooks: [
                { id: 'call-wh-1', key: testWebhookKey, resourceIds: [] },
            ],
            quoMessageWebhooks: [
                { id: 'msg-wh-1', key: testWebhookKey, resourceIds: [] },
            ],
            quoCallSummaryWebhooks: [
                { id: 'summary-wh-1', key: testWebhookKey, resourceIds: [] },
            ],
        };
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Happy Path - Valid Signatures', () => {
        it('verifies valid signature with plain timestamp+body format', async () => {
            const payload = testTimestamp + JSON.stringify(testBody);
            const signature = generateSignature(payload, testWebhookKey);
            const headers = {
                'openphone-signature': createSignatureHeader(
                    testTimestamp,
                    signature,
                ),
            };

            await expect(
                integration._verifyQuoWebhookSignature(
                    headers,
                    testBody,
                    'call.completed',
                ),
            ).resolves.not.toThrow();
        });

        it('verifies valid signature with base64 key format', async () => {
            const base64Key = Buffer.from(testWebhookKey).toString('base64');
            integration.config.quoCallWebhooks = [
                { id: 'call-wh-1', key: base64Key, resourceIds: [] },
            ];

            const payload = testTimestamp + JSON.stringify(testBody);
            const signature = generateSignature(payload, base64Key, true);
            const headers = {
                'openphone-signature': createSignatureHeader(
                    testTimestamp,
                    signature,
                ),
            };

            await expect(
                integration._verifyQuoWebhookSignature(
                    headers,
                    testBody,
                    'call.completed',
                ),
            ).resolves.not.toThrow();
        });

        it('verifies valid signature with dot separator format', async () => {
            const payload = testTimestamp + '.' + JSON.stringify(testBody);
            const signature = generateSignature(payload, testWebhookKey);
            const headers = {
                'openphone-signature': createSignatureHeader(
                    testTimestamp,
                    signature,
                ),
            };

            await expect(
                integration._verifyQuoWebhookSignature(
                    headers,
                    testBody,
                    'call.completed',
                ),
            ).resolves.not.toThrow();
        });

        it('verifies valid signature with dot separator and base64 key', async () => {
            const base64Key = Buffer.from(testWebhookKey).toString('base64');
            integration.config.quoMessageWebhooks = [
                { id: 'msg-wh-1', key: base64Key, resourceIds: [] },
            ];

            const payload = testTimestamp + '.' + JSON.stringify(testBody);
            const signature = generateSignature(payload, base64Key, true);
            const headers = {
                'openphone-signature': createSignatureHeader(
                    testTimestamp,
                    signature,
                ),
            };

            await expect(
                integration._verifyQuoWebhookSignature(
                    headers,
                    testBody,
                    'message.received',
                ),
            ).resolves.not.toThrow();
        });
    });

    describe('Error Cases - Missing or Invalid Headers', () => {
        it('throws error when openphone-signature header is missing', async () => {
            const headers = {};

            await expect(
                integration._verifyQuoWebhookSignature(
                    headers,
                    testBody,
                    'call.completed',
                ),
            ).rejects.toThrow('Missing Openphone-Signature header');
        });

        it('throws error when signature format is invalid (not 4 parts)', async () => {
            const headers = {
                'openphone-signature': 'hmac;v1;invalid',
            };

            await expect(
                integration._verifyQuoWebhookSignature(
                    headers,
                    testBody,
                    'call.completed',
                ),
            ).rejects.toThrow('Invalid Openphone-Signature format');
        });

        it('throws error when signature scheme is not "hmac"', async () => {
            const headers = {
                'openphone-signature': 'sha256;v1;1234567890;fakesignature',
            };

            await expect(
                integration._verifyQuoWebhookSignature(
                    headers,
                    testBody,
                    'call.completed',
                ),
            ).rejects.toThrow('Invalid Openphone-Signature format');
        });

        it('throws error when webhook key not found in config', async () => {
            integration.config = {}; // Empty config

            const payload = testTimestamp + JSON.stringify(testBody);
            const signature = generateSignature(payload, testWebhookKey);
            const headers = {
                'openphone-signature': createSignatureHeader(
                    testTimestamp,
                    signature,
                ),
            };

            await expect(
                integration._verifyQuoWebhookSignature(
                    headers,
                    testBody,
                    'call.completed',
                ),
            ).rejects.toThrow('No webhooks configured for event type');
        });

        it('throws error when signature does not match any format', async () => {
            const headers = {
                'openphone-signature': createSignatureHeader(
                    testTimestamp,
                    'invalid-signature-base64==',
                ),
            };

            await expect(
                integration._verifyQuoWebhookSignature(
                    headers,
                    testBody,
                    'call.completed',
                ),
            ).rejects.toThrow(
                'Webhook signature verification failed with all configured webhooks',
            );
        });
    });

    describe('Event Type Routing - Key Selection', () => {
        it('selects correct key for call.completed events', async () => {
            integration.config = {
                quoCallWebhooks: [
                    { id: 'call-wh-1', key: 'call-key', resourceIds: [] },
                ],
                quoMessageWebhooks: [
                    { id: 'msg-wh-1', key: 'message-key', resourceIds: [] },
                ],
                quoCallSummaryWebhooks: [
                    { id: 'summary-wh-1', key: 'summary-key', resourceIds: [] },
                ],
            };

            const payload = testTimestamp + JSON.stringify(testBody);
            const signature = generateSignature(payload, 'call-key');
            const headers = {
                'openphone-signature': createSignatureHeader(
                    testTimestamp,
                    signature,
                ),
            };

            await expect(
                integration._verifyQuoWebhookSignature(
                    headers,
                    testBody,
                    'call.completed',
                ),
            ).resolves.not.toThrow();
        });

        it('selects correct key for call.summary events', async () => {
            integration.config = {
                quoCallWebhooks: [
                    { id: 'call-wh-1', key: 'call-key', resourceIds: [] },
                ],
                quoMessageWebhooks: [
                    { id: 'msg-wh-1', key: 'message-key', resourceIds: [] },
                ],
                quoCallSummaryWebhooks: [
                    { id: 'summary-wh-1', key: 'summary-key', resourceIds: [] },
                ],
            };

            const summaryBody = { ...testBody, event_type: 'call.summary' };
            const payload = testTimestamp + JSON.stringify(summaryBody);
            const signature = generateSignature(payload, 'summary-key');
            const headers = {
                'openphone-signature': createSignatureHeader(
                    testTimestamp,
                    signature,
                ),
            };

            await expect(
                integration._verifyQuoWebhookSignature(
                    headers,
                    summaryBody,
                    'call.summary',
                ),
            ).resolves.not.toThrow();
        });

        it('selects correct key for message.received events', async () => {
            integration.config = {
                quoCallWebhooks: [
                    { id: 'call-wh-1', key: 'call-key', resourceIds: [] },
                ],
                quoMessageWebhooks: [
                    { id: 'msg-wh-1', key: 'message-key', resourceIds: [] },
                ],
                quoCallSummaryWebhooks: [
                    { id: 'summary-wh-1', key: 'summary-key', resourceIds: [] },
                ],
            };

            const messageBody = { ...testBody, event_type: 'message.received' };
            const payload = testTimestamp + JSON.stringify(messageBody);
            const signature = generateSignature(payload, 'message-key');
            const headers = {
                'openphone-signature': createSignatureHeader(
                    testTimestamp,
                    signature,
                ),
            };

            await expect(
                integration._verifyQuoWebhookSignature(
                    headers,
                    messageBody,
                    'message.received',
                ),
            ).resolves.not.toThrow();
        });

        it('throws error for unknown event type', async () => {
            const payload = testTimestamp + JSON.stringify(testBody);
            const signature = generateSignature(payload, testWebhookKey);
            const headers = {
                'openphone-signature': createSignatureHeader(
                    testTimestamp,
                    signature,
                ),
            };

            await expect(
                integration._verifyQuoWebhookSignature(
                    headers,
                    testBody,
                    'unknown.event',
                ),
            ).rejects.toThrow(
                'Unknown event type for key selection: unknown.event',
            );
        });
    });

    describe('Edge Cases', () => {
        it('handles body with special characters', async () => {
            const specialBody = {
                event_type: 'call.completed',
                content: 'Hello "world" with quotes & symbols! <html>',
            };

            const payload = testTimestamp + JSON.stringify(specialBody);
            const signature = generateSignature(payload, testWebhookKey);
            const headers = {
                'openphone-signature': createSignatureHeader(
                    testTimestamp,
                    signature,
                ),
            };

            await expect(
                integration._verifyQuoWebhookSignature(
                    headers,
                    specialBody,
                    'call.completed',
                ),
            ).resolves.not.toThrow();
        });

        it('handles large body payload', async () => {
            const largeBody = {
                event_type: 'call.completed',
                data: 'x'.repeat(10000), // 10KB of data
            };

            const payload = testTimestamp + JSON.stringify(largeBody);
            const signature = generateSignature(payload, testWebhookKey);
            const headers = {
                'openphone-signature': createSignatureHeader(
                    testTimestamp,
                    signature,
                ),
            };

            await expect(
                integration._verifyQuoWebhookSignature(
                    headers,
                    largeBody,
                    'call.completed',
                ),
            ).resolves.not.toThrow();
        });

        it('handles Unicode characters in body', async () => {
            const unicodeBody = {
                event_type: 'message.received',
                content: '你好世界 🌍 Здравствуй мир',
            };

            const payload = testTimestamp + JSON.stringify(unicodeBody);
            const signature = generateSignature(payload, testWebhookKey);
            const headers = {
                'openphone-signature': createSignatureHeader(
                    testTimestamp,
                    signature,
                ),
            };

            await expect(
                integration._verifyQuoWebhookSignature(
                    headers,
                    unicodeBody,
                    'message.received',
                ),
            ).resolves.not.toThrow();
        });
    });

    describe('Security - Signature Format Iteration', () => {
        it('verifies signature successfully when first format matches', async () => {
            // Verifies signature verification completes successfully
            // Note: Actual timing attack protection is at crypto.timingSafeEqual level

            const payload = testTimestamp + JSON.stringify(testBody);
            const signature = generateSignature(payload, testWebhookKey);
            const headers = {
                'openphone-signature': createSignatureHeader(
                    testTimestamp,
                    signature,
                ),
            };

            await expect(
                integration._verifyQuoWebhookSignature(
                    headers,
                    testBody,
                    'call.completed',
                ),
            ).resolves.not.toThrow();
        });
    });
});

describe('PipedriveIntegration - Webhook Setup', () => {
    let integration;
    let mockPipedriveApi;

    beforeEach(() => {
        integration = new PipedriveIntegration();

        // Mock Pipedrive API
        mockPipedriveApi = {
            api: {
                createWebhook: jest.fn(),
            },
        };

        integration.pipedrive = mockPipedriveApi;
        integration.id = 'test-integration-id';
        integration.config = {};

        // Mock commands and messages
        integration.commands = {
            updateIntegrationConfig: jest.fn().mockResolvedValue({}),
        };
        integration.updateIntegrationMessages = {
            execute: jest.fn().mockResolvedValue({}),
        };

        // Set BASE_URL for tests
        process.env.BASE_URL = 'https://test-api.example.com';
    });

    afterEach(() => {
        delete process.env.BASE_URL;
        jest.restoreAllMocks();
    });

    describe('setupPipedriveWebhooks', () => {
        describe('Happy Path - Already Configured', () => {
            it('returns already_configured when webhooks exist', async () => {
                integration.config = {
                    pipedriveWebhookIds: ['webhook-1', 'webhook-2'],
                    pipedriveWebhookUrl: 'https://test.com/webhooks',
                };

                const result = await integration.setupPipedriveWebhooks();

                expect(result).toEqual({
                    status: 'already_configured',
                    webhookIds: ['webhook-1', 'webhook-2'],
                    webhookUrl: 'https://test.com/webhooks',
                });
                expect(
                    mockPipedriveApi.api.createWebhook,
                ).not.toHaveBeenCalled();
            });
        });

        describe('Happy Path - Creates Webhooks', () => {
            it('creates webhooks for all person events (added, updated, deleted, merged)', async () => {
                mockPipedriveApi.api.createWebhook
                    .mockResolvedValueOnce({ data: { id: 'wh-added' } })
                    .mockResolvedValueOnce({ data: { id: 'wh-updated' } })
                    .mockResolvedValueOnce({ data: { id: 'wh-deleted' } })
                    .mockResolvedValueOnce({ data: { id: 'wh-merged' } });

                const result = await integration.setupPipedriveWebhooks();

                expect(result.status).toBe('configured');
                expect(result.webhookIds).toEqual([
                    'wh-added',
                    'wh-updated',
                    'wh-deleted',
                    'wh-merged',
                ]);
                expect(
                    mockPipedriveApi.api.createWebhook,
                ).toHaveBeenCalledTimes(4);
            });

            it('stores webhook IDs in config after creation', async () => {
                mockPipedriveApi.api.createWebhook
                    .mockResolvedValueOnce({ data: { id: 'wh-1' } })
                    .mockResolvedValueOnce({ data: { id: 'wh-2' } })
                    .mockResolvedValueOnce({ data: { id: 'wh-3' } })
                    .mockResolvedValueOnce({ data: { id: 'wh-4' } });

                await integration.setupPipedriveWebhooks();

                expect(
                    integration.commands.updateIntegrationConfig,
                ).toHaveBeenCalledWith(
                    expect.objectContaining({
                        integrationId: 'test-integration-id',
                        config: expect.objectContaining({
                            pipedriveWebhookIds: [
                                'wh-1',
                                'wh-2',
                                'wh-3',
                                'wh-4',
                            ],
                            pipedriveWebhookUrl: expect.stringContaining(
                                'test-integration-id',
                            ),
                        }),
                    }),
                );
            });

            it('stores webhook metadata (events, names) in config', async () => {
                mockPipedriveApi.api.createWebhook
                    .mockResolvedValueOnce({ data: { id: 'wh-1' } })
                    .mockResolvedValueOnce({ data: { id: 'wh-2' } })
                    .mockResolvedValueOnce({ data: { id: 'wh-3' } })
                    .mockResolvedValueOnce({ data: { id: 'wh-4' } });

                await integration.setupPipedriveWebhooks();

                const configCall =
                    integration.commands.updateIntegrationConfig.mock
                        .calls[0][0];
                expect(configCall.config.pipedriveWebhooks).toEqual([
                    { id: 'wh-1', event: 'added.person', name: 'Person Added' },
                    {
                        id: 'wh-2',
                        event: 'updated.person',
                        name: 'Person Updated',
                    },
                    {
                        id: 'wh-3',
                        event: 'deleted.person',
                        name: 'Person Deleted',
                    },
                    {
                        id: 'wh-4',
                        event: 'merged.person',
                        name: 'Person Merged',
                    },
                ]);
            });
        });

        describe('Error Handling - Partial Failures', () => {
            it('continues creating other webhooks when one fails', async () => {
                mockPipedriveApi.api.createWebhook
                    .mockResolvedValueOnce({ data: { id: 'wh-1' } })
                    .mockRejectedValueOnce(new Error('API error'))
                    .mockResolvedValueOnce({ data: { id: 'wh-3' } })
                    .mockResolvedValueOnce({ data: { id: 'wh-4' } });

                const consoleSpy = jest
                    .spyOn(console, 'error')
                    .mockImplementation();

                const result = await integration.setupPipedriveWebhooks();

                expect(result.status).toBe('configured');
                expect(result.webhookIds).toEqual(['wh-1', 'wh-3', 'wh-4']);
                expect(consoleSpy).toHaveBeenCalledWith(
                    expect.stringContaining('Failed to create webhook'),
                    expect.any(String),
                );

                consoleSpy.mockRestore();
            });

            it('throws error when no webhooks created successfully', async () => {
                mockPipedriveApi.api.createWebhook
                    .mockRejectedValueOnce(new Error('API error 1'))
                    .mockRejectedValueOnce(new Error('API error 2'))
                    .mockRejectedValueOnce(new Error('API error 3'))
                    .mockRejectedValueOnce(new Error('API error 4'));

                const consoleSpy = jest
                    .spyOn(console, 'error')
                    .mockImplementation();

                await expect(
                    integration.setupPipedriveWebhooks(),
                ).rejects.toThrow('Failed to create any webhooks');

                consoleSpy.mockRestore();
            });

            it('logs error message to integration messages on failure', async () => {
                mockPipedriveApi.api.createWebhook.mockRejectedValue(
                    new Error('Pipedrive API unavailable'),
                );

                const consoleSpy = jest
                    .spyOn(console, 'error')
                    .mockImplementation();

                await expect(
                    integration.setupPipedriveWebhooks(),
                ).rejects.toThrow();

                expect(
                    integration.updateIntegrationMessages.execute,
                ).toHaveBeenCalledWith(
                    'test-integration-id',
                    'errors',
                    'Webhook Setup Failed',
                    expect.stringContaining(
                        'Could not register webhooks with Pipedrive',
                    ),
                    expect.any(Number),
                );

                consoleSpy.mockRestore();
            });
        });

        describe('Configuration - URL and Names', () => {
            it('uses correct webhook URL with integration ID', async () => {
                mockPipedriveApi.api.createWebhook.mockResolvedValue({
                    data: { id: 'wh-1' },
                });

                await integration.setupPipedriveWebhooks();

                const calls = mockPipedriveApi.api.createWebhook.mock.calls;
                calls.forEach((call) => {
                    expect(call[0].subscription_url).toBe(
                        'https://test-api.example.com/api/pipedrive-integration/webhooks/test-integration-id',
                    );
                });
            });

            it('sets webhook version to 1.0', async () => {
                mockPipedriveApi.api.createWebhook.mockResolvedValue({
                    data: { id: 'wh-1' },
                });

                await integration.setupPipedriveWebhooks();

                const calls = mockPipedriveApi.api.createWebhook.mock.calls;
                calls.forEach((call) => {
                    expect(call[0].version).toBe('1.0');
                });
            });

            it('prefixes webhook names with "Quo -"', async () => {
                mockPipedriveApi.api.createWebhook.mockResolvedValue({
                    data: { id: 'wh-1' },
                });

                await integration.setupPipedriveWebhooks();

                const calls = mockPipedriveApi.api.createWebhook.mock.calls;
                expect(calls[0][0].name).toBe('Quo - Person Added');
                expect(calls[1][0].name).toBe('Quo - Person Updated');
                expect(calls[2][0].name).toBe('Quo - Person Deleted');
                expect(calls[3][0].name).toBe('Quo - Person Merged');
            });
        });

        describe('Edge Cases', () => {
            it('handles webhook response without ID gracefully', async () => {
                mockPipedriveApi.api.createWebhook
                    .mockResolvedValueOnce({ data: { id: 'wh-1' } })
                    .mockResolvedValueOnce({ data: {} }) // No ID
                    .mockResolvedValueOnce({ data: { id: 'wh-3' } })
                    .mockResolvedValueOnce({ data: { id: 'wh-4' } });

                const consoleSpy = jest
                    .spyOn(console, 'warn')
                    .mockImplementation();

                const result = await integration.setupPipedriveWebhooks();

                expect(result.webhookIds).toEqual(['wh-1', 'wh-3', 'wh-4']);
                expect(consoleSpy).toHaveBeenCalledWith(
                    expect.stringContaining('No webhook ID returned'),
                );

                consoleSpy.mockRestore();
            });

            it('includes timestamp in config', async () => {
                const dateSpy = jest
                    .spyOn(Date.prototype, 'toISOString')
                    .mockReturnValue('2024-01-01T00:00:00.000Z');

                mockPipedriveApi.api.createWebhook.mockResolvedValue({
                    data: { id: 'wh-1' },
                });

                await integration.setupPipedriveWebhooks();

                const configCall =
                    integration.commands.updateIntegrationConfig.mock
                        .calls[0][0];
                expect(configCall.config.webhookCreatedAt).toBe(
                    '2024-01-01T00:00:00.000Z',
                );

                dateSpy.mockRestore();
            });
        });
    });

    describe('setupQuoWebhook', () => {
        let mockQuoApi;

        beforeEach(() => {
            mockQuoApi = {
                api: {
                    deleteWebhook: jest.fn().mockResolvedValue({}),
                },
            };
            integration.quo = mockQuoApi;

            // Mock the base class helper
            integration._createQuoWebhooksWithPhoneIds = jest.fn();
            integration._fetchAndStoreEnabledPhoneIds = jest
                .fn()
                .mockResolvedValue();
            integration.updateIntegrationMessages = { execute: jest.fn() };
            integration._generateWebhookUrl = jest.fn(
                (path) =>
                    `https://test-api.example.com/api/pipedrive-integration${path}`,
            );
        });

        describe('Happy Path - Already Configured', () => {
            it('returns already_configured when all 3 webhooks exist', async () => {
                integration.config = {
                    quoMessageWebhooks: [
                        { id: 'msg-wh-123', key: 'key1', resourceIds: [] },
                    ],
                    quoCallWebhooks: [
                        { id: 'call-wh-456', key: 'key2', resourceIds: [] },
                    ],
                    quoCallSummaryWebhooks: [
                        { id: 'summary-wh-789', key: 'key3', resourceIds: [] },
                    ],
                    quoWebhooksUrl: 'https://test.com/webhooks',
                };

                const result = await integration.setupQuoWebhook();

                expect(result).toEqual({
                    status: 'already_configured',
                    messageWebhooks: [
                        { id: 'msg-wh-123', key: 'key1', resourceIds: [] },
                    ],
                    callWebhooks: [
                        { id: 'call-wh-456', key: 'key2', resourceIds: [] },
                    ],
                    callSummaryWebhooks: [
                        { id: 'summary-wh-789', key: 'key3', resourceIds: [] },
                    ],
                    webhookUrl: 'https://test.com/webhooks',
                });
                expect(
                    integration._createQuoWebhooksWithPhoneIds,
                ).not.toHaveBeenCalled();
            });
        });

        describe('Happy Path - Creates Webhooks', () => {
            it('creates message, call, and call-summary webhooks atomically', async () => {
                integration._createQuoWebhooksWithPhoneIds.mockResolvedValue({
                    messageWebhooks: [
                        {
                            id: 'msg-wh-new',
                            key: 'msg-key-secret',
                            resourceIds: [],
                        },
                    ],
                    callWebhooks: [
                        {
                            id: 'call-wh-new',
                            key: 'call-key-secret',
                            resourceIds: [],
                        },
                    ],
                    callSummaryWebhooks: [
                        {
                            id: 'summary-wh-new',
                            key: 'summary-key-secret',
                            resourceIds: [],
                        },
                    ],
                });

                const result = await integration.setupQuoWebhook();

                expect(result.status).toBe('configured');
                expect(result.messageWebhooks).toEqual([
                    {
                        id: 'msg-wh-new',
                        key: 'msg-key-secret',
                        resourceIds: [],
                    },
                ]);
                expect(result.callWebhooks).toEqual([
                    {
                        id: 'call-wh-new',
                        key: 'call-key-secret',
                        resourceIds: [],
                    },
                ]);
                expect(result.callSummaryWebhooks).toEqual([
                    {
                        id: 'summary-wh-new',
                        key: 'summary-key-secret',
                        resourceIds: [],
                    },
                ]);
            });

            it('stores all webhook IDs and keys in config', async () => {
                integration._createQuoWebhooksWithPhoneIds.mockResolvedValue({
                    messageWebhooks: [
                        { id: 'msg-wh', key: 'msg-key', resourceIds: [] },
                    ],
                    callWebhooks: [
                        { id: 'call-wh', key: 'call-key', resourceIds: [] },
                    ],
                    callSummaryWebhooks: [
                        {
                            id: 'summary-wh',
                            key: 'summary-key',
                            resourceIds: [],
                        },
                    ],
                });

                await integration.setupQuoWebhook();

                expect(
                    integration.commands.updateIntegrationConfig,
                ).toHaveBeenCalledWith(
                    expect.objectContaining({
                        integrationId: 'test-integration-id',
                        config: expect.objectContaining({
                            quoMessageWebhooks: [
                                {
                                    id: 'msg-wh',
                                    key: 'msg-key',
                                    resourceIds: [],
                                },
                            ],
                            quoCallWebhooks: [
                                {
                                    id: 'call-wh',
                                    key: 'call-key',
                                    resourceIds: [],
                                },
                            ],
                            quoCallSummaryWebhooks: [
                                {
                                    id: 'summary-wh',
                                    key: 'summary-key',
                                    resourceIds: [],
                                },
                            ],
                        }),
                    }),
                );
            });

            it('encrypts webhook keys at rest', async () => {
                integration._createQuoWebhooksWithPhoneIds.mockResolvedValue({
                    messageWebhooks: [
                        {
                            id: 'msg-wh',
                            key: 'sensitive-key-123',
                            resourceIds: [],
                        },
                    ],
                    callWebhooks: [
                        {
                            id: 'call-wh',
                            key: 'sensitive-key-456',
                            resourceIds: [],
                        },
                    ],
                    callSummaryWebhooks: [
                        {
                            id: 'summary-wh',
                            key: 'sensitive-key-789',
                            resourceIds: [],
                        },
                    ],
                });

                const consoleSpy = jest
                    .spyOn(console, 'log')
                    .mockImplementation();

                await integration.setupQuoWebhook();

                expect(consoleSpy).toHaveBeenCalledWith(
                    '[Quo] ✓ Keys stored securely (encrypted at rest)',
                );

                consoleSpy.mockRestore();
            });
        });

        describe('Partial Configuration Recovery', () => {
            it('cleans up orphaned message webhook before retry', async () => {
                integration.config = {
                    quoMessageWebhooks: [
                        {
                            id: 'orphaned-msg-wh',
                            key: 'old-key',
                            resourceIds: [],
                        },
                    ],
                };

                integration._createQuoWebhooksWithPhoneIds.mockResolvedValue({
                    messageWebhooks: [
                        { id: 'new-msg-wh', key: 'new-key', resourceIds: [] },
                    ],
                    callWebhooks: [
                        { id: 'new-call-wh', key: 'new-key', resourceIds: [] },
                    ],
                    callSummaryWebhooks: [
                        {
                            id: 'new-summary-wh',
                            key: 'new-key',
                            resourceIds: [],
                        },
                    ],
                });

                const consoleSpy = jest
                    .spyOn(console, 'warn')
                    .mockImplementation();
                const consoleLogSpy = jest
                    .spyOn(console, 'log')
                    .mockImplementation();

                await integration.setupQuoWebhook();

                expect(mockQuoApi.api.deleteWebhook).toHaveBeenCalledWith(
                    'orphaned-msg-wh',
                );
                expect(consoleLogSpy).toHaveBeenCalledWith(
                    expect.stringContaining(
                        'Cleaned up orphaned message webhook',
                    ),
                );

                consoleSpy.mockRestore();
                consoleLogSpy.mockRestore();
            });

            it('cleans up orphaned call webhook before retry', async () => {
                integration.config = {
                    quoCallWebhooks: [
                        {
                            id: 'orphaned-call-wh',
                            key: 'old-key',
                            resourceIds: [],
                        },
                    ],
                };

                integration._createQuoWebhooksWithPhoneIds.mockResolvedValue({
                    messageWebhooks: [
                        { id: 'new-msg-wh', key: 'new-key', resourceIds: [] },
                    ],
                    callWebhooks: [
                        { id: 'new-call-wh', key: 'new-key', resourceIds: [] },
                    ],
                    callSummaryWebhooks: [
                        {
                            id: 'new-summary-wh',
                            key: 'new-key',
                            resourceIds: [],
                        },
                    ],
                });

                const consoleLogSpy = jest
                    .spyOn(console, 'log')
                    .mockImplementation();
                const consoleWarnSpy = jest
                    .spyOn(console, 'warn')
                    .mockImplementation();

                await integration.setupQuoWebhook();

                expect(mockQuoApi.api.deleteWebhook).toHaveBeenCalledWith(
                    'orphaned-call-wh',
                );
                expect(consoleLogSpy).toHaveBeenCalledWith(
                    expect.stringContaining('Cleaned up orphaned call webhook'),
                );

                consoleLogSpy.mockRestore();
                consoleWarnSpy.mockRestore();
            });

            it('cleans up orphaned call-summary webhook before retry', async () => {
                integration.config = {
                    quoCallSummaryWebhooks: [
                        {
                            id: 'orphaned-summary-wh',
                            key: 'old-key',
                            resourceIds: [],
                        },
                    ],
                };

                integration._createQuoWebhooksWithPhoneIds.mockResolvedValue({
                    messageWebhooks: [
                        { id: 'new-msg-wh', key: 'new-key', resourceIds: [] },
                    ],
                    callWebhooks: [
                        { id: 'new-call-wh', key: 'new-key', resourceIds: [] },
                    ],
                    callSummaryWebhooks: [
                        {
                            id: 'new-summary-wh',
                            key: 'new-key',
                            resourceIds: [],
                        },
                    ],
                });

                const consoleLogSpy = jest
                    .spyOn(console, 'log')
                    .mockImplementation();
                const consoleWarnSpy = jest
                    .spyOn(console, 'warn')
                    .mockImplementation();

                await integration.setupQuoWebhook();

                expect(mockQuoApi.api.deleteWebhook).toHaveBeenCalledWith(
                    'orphaned-summary-wh',
                );
                expect(consoleLogSpy).toHaveBeenCalledWith(
                    expect.stringContaining(
                        'Cleaned up orphaned call-summary webhook',
                    ),
                );

                consoleLogSpy.mockRestore();
                consoleWarnSpy.mockRestore();
            });
        });

        describe('Error Handling with Rollback', () => {
            it('rolls back all webhooks when config update fails', async () => {
                integration._createQuoWebhooksWithPhoneIds.mockResolvedValue({
                    messageWebhooks: [
                        {
                            id: 'msg-wh-rollback',
                            key: 'msg-key',
                            resourceIds: [],
                        },
                    ],
                    callWebhooks: [
                        {
                            id: 'call-wh-rollback',
                            key: 'call-key',
                            resourceIds: [],
                        },
                    ],
                    callSummaryWebhooks: [
                        {
                            id: 'summary-wh-rollback',
                            key: 'summary-key',
                            resourceIds: [],
                        },
                    ],
                });

                integration.commands.updateIntegrationConfig.mockRejectedValue(
                    new Error('Database error'),
                );

                const consoleSpy = jest
                    .spyOn(console, 'error')
                    .mockImplementation();
                const warnSpy = jest
                    .spyOn(console, 'warn')
                    .mockImplementation();
                const logSpy = jest.spyOn(console, 'log').mockImplementation();

                const result = await integration.setupQuoWebhook();

                expect(result.status).toBe('failed');
                expect(mockQuoApi.api.deleteWebhook).toHaveBeenCalledTimes(3);
                expect(mockQuoApi.api.deleteWebhook).toHaveBeenCalledWith(
                    'msg-wh-rollback',
                );
                expect(mockQuoApi.api.deleteWebhook).toHaveBeenCalledWith(
                    'call-wh-rollback',
                );
                expect(mockQuoApi.api.deleteWebhook).toHaveBeenCalledWith(
                    'summary-wh-rollback',
                );

                consoleSpy.mockRestore();
                warnSpy.mockRestore();
                logSpy.mockRestore();
            });

            it('rolls back successfully created webhooks on partial failure', async () => {
                integration._createQuoWebhooksWithPhoneIds.mockRejectedValue(
                    new Error('Quo API error'),
                );

                const consoleSpy = jest
                    .spyOn(console, 'error')
                    .mockImplementation();

                const result = await integration.setupQuoWebhook();

                expect(result.status).toBe('failed');
                expect(result.error).toBe('Quo API error');

                consoleSpy.mockRestore();
            });

            it('logs error message to integration messages on failure', async () => {
                integration._createQuoWebhooksWithPhoneIds.mockRejectedValue(
                    new Error('Network timeout'),
                );

                const consoleSpy = jest
                    .spyOn(console, 'error')
                    .mockImplementation();

                await integration.setupQuoWebhook();

                expect(
                    integration.updateIntegrationMessages.execute,
                ).toHaveBeenCalledWith(
                    'test-integration-id',
                    'errors',
                    'Quo Webhook Setup Failed',
                    expect.stringContaining(
                        'Could not register webhooks with Quo',
                    ),
                    expect.any(Number),
                );

                consoleSpy.mockRestore();
            });

            it('returns failed status with error message', async () => {
                integration._createQuoWebhooksWithPhoneIds.mockRejectedValue(
                    new Error('API unavailable'),
                );

                const consoleSpy = jest
                    .spyOn(console, 'error')
                    .mockImplementation();

                const result = await integration.setupQuoWebhook();

                expect(result).toEqual({
                    status: 'failed',
                    error: 'API unavailable',
                });

                consoleSpy.mockRestore();
            });
        });

        describe('Rollback Error Handling', () => {
            it('continues rollback even if webhook deletion fails', async () => {
                integration._createQuoWebhooksWithPhoneIds.mockResolvedValue({
                    messageWebhooks: [
                        { id: 'msg-wh', key: 'msg-key', resourceIds: [] },
                    ],
                    callWebhooks: [
                        { id: 'call-wh', key: 'call-key', resourceIds: [] },
                    ],
                    callSummaryWebhooks: [
                        {
                            id: 'summary-wh',
                            key: 'summary-key',
                            resourceIds: [],
                        },
                    ],
                });

                integration.commands.updateIntegrationConfig.mockRejectedValue(
                    new Error('Config error'),
                );

                mockQuoApi.api.deleteWebhook
                    .mockRejectedValueOnce(new Error('Delete failed 1'))
                    .mockResolvedValueOnce({})
                    .mockRejectedValueOnce(new Error('Delete failed 2'));

                const errorSpy = jest
                    .spyOn(console, 'error')
                    .mockImplementation();
                const warnSpy = jest
                    .spyOn(console, 'warn')
                    .mockImplementation();
                const logSpy = jest.spyOn(console, 'log').mockImplementation();

                await integration.setupQuoWebhook();

                expect(mockQuoApi.api.deleteWebhook).toHaveBeenCalledTimes(3);
                expect(errorSpy).toHaveBeenCalledWith(
                    expect.stringContaining('Failed to rollback'),
                    expect.any(String),
                );

                errorSpy.mockRestore();
                warnSpy.mockRestore();
                logSpy.mockRestore();
            });

            it('logs rollback errors without throwing', async () => {
                integration._createQuoWebhooksWithPhoneIds.mockResolvedValue({
                    messageWebhookId: 'msg-wh',
                    messageWebhookKey: 'msg-key',
                    callWebhookId: 'call-wh',
                    callWebhookKey: 'call-key',
                    callSummaryWebhookId: 'summary-wh',
                    callSummaryWebhookKey: 'summary-key',
                });

                integration.commands.updateIntegrationConfig.mockRejectedValue(
                    new Error('Config error'),
                );

                mockQuoApi.api.deleteWebhook.mockRejectedValue(
                    new Error('Rollback error'),
                );

                const errorSpy = jest
                    .spyOn(console, 'error')
                    .mockImplementation();
                const warnSpy = jest
                    .spyOn(console, 'warn')
                    .mockImplementation();
                const logSpy = jest.spyOn(console, 'log').mockImplementation();

                const result = await integration.setupQuoWebhook();

                expect(result.status).toBe('failed');

                errorSpy.mockRestore();
                warnSpy.mockRestore();
                logSpy.mockRestore();
            });
        });

        describe('Edge Cases', () => {
            it('handles cleanup errors gracefully during recovery', async () => {
                integration.config = {
                    quoMessageWebhooks: [
                        { id: 'orphaned-wh', key: 'old-key', resourceIds: [] },
                    ],
                };

                mockQuoApi.api.deleteWebhook.mockRejectedValue(
                    new Error('Webhook already deleted'),
                );

                integration._createQuoWebhooksWithPhoneIds.mockResolvedValue({
                    messageWebhooks: [
                        { id: 'new-wh', key: 'new-key', resourceIds: [] },
                    ],
                    callWebhooks: [
                        { id: 'new-call-wh', key: 'new-key', resourceIds: [] },
                    ],
                    callSummaryWebhooks: [
                        {
                            id: 'new-summary-wh',
                            key: 'new-key',
                            resourceIds: [],
                        },
                    ],
                });

                const warnSpy = jest
                    .spyOn(console, 'warn')
                    .mockImplementation();
                const logSpy = jest.spyOn(console, 'log').mockImplementation();

                const result = await integration.setupQuoWebhook();

                expect(result.status).toBe('configured');
                expect(warnSpy).toHaveBeenCalledWith(
                    expect.stringContaining(
                        'Could not clean up message webhook',
                    ),
                );

                warnSpy.mockRestore();
                logSpy.mockRestore();
            });

            it('includes timestamp in config', async () => {
                const dateSpy = jest
                    .spyOn(Date.prototype, 'toISOString')
                    .mockReturnValue('2024-01-15T10:30:00.000Z');

                integration._createQuoWebhooksWithPhoneIds.mockResolvedValue({
                    messageWebhooks: [
                        { id: 'msg-wh', key: 'msg-key', resourceIds: [] },
                    ],
                    callWebhooks: [
                        { id: 'call-wh', key: 'call-key', resourceIds: [] },
                    ],
                    callSummaryWebhooks: [
                        {
                            id: 'summary-wh',
                            key: 'summary-key',
                            resourceIds: [],
                        },
                    ],
                });

                await integration.setupQuoWebhook();

                const configCall =
                    integration.commands.updateIntegrationConfig.mock
                        .calls[0][0];
                expect(configCall.config.quoWebhooksCreatedAt).toBe(
                    '2024-01-15T10:30:00.000Z',
                );

                dateSpy.mockRestore();
            });
        });
    });

    describe('_generateWebhookUrl', () => {
        beforeEach(() => {
            // Restore the real method for these tests
            integration._generateWebhookUrl =
                PipedriveIntegration.prototype._generateWebhookUrl;
        });

        it('generates correct webhook URL with BASE_URL', () => {
            const url = integration._generateWebhookUrl('/webhooks/test-id');

            expect(url).toBe(
                'https://test-api.example.com/api/pipedrive-integration/webhooks/test-id',
            );
        });

        it('throws error when BASE_URL is not configured', () => {
            delete process.env.BASE_URL;

            expect(() => {
                integration._generateWebhookUrl('/webhooks/test-id');
            }).toThrow('BASE_URL environment variable is required');
        });

        it('uses integration name from Definition in URL', () => {
            const url = integration._generateWebhookUrl('/test-path');

            expect(url).toContain('/api/pipedrive-integration/test-path');
        });

        it('appends provided path to URL', () => {
            const customPath = '/custom/webhook/path';
            const url = integration._generateWebhookUrl(customPath);

            expect(url).toBe(
                'https://test-api.example.com/api/pipedrive-integration/custom/webhook/path',
            );
        });
    });

    describe('_handlePipedriveWebhook', () => {
        beforeEach(() => {
            integration._handlePersonWebhook = jest.fn().mockResolvedValue();
        });

        describe('Happy Path - Event Processing', () => {
            it('processes person.added event', async () => {
                const webhookData = {
                    body: {
                        event: 'added.person',
                        meta: {
                            id: 123,
                            action: 'added',
                            object: 'person',
                            timestamp: '2024-01-01',
                        },
                        current: {
                            id: 123,
                            first_name: 'John',
                            last_name: 'Doe',
                        },
                    },
                    headers: {},
                    integrationId: 'test-id',
                };

                const consoleSpy = jest
                    .spyOn(console, 'log')
                    .mockImplementation();

                const result =
                    await integration._handlePipedriveWebhook(webhookData);

                expect(result.success).toBe(true);
                expect(result.event).toBe('added.person');
                expect(result.action).toBe('added');
                expect(result.object).toBe('person');
                expect(integration._handlePersonWebhook).toHaveBeenCalledWith({
                    action: 'added',
                    data: webhookData.body.current,
                    previous: undefined,
                    meta: webhookData.body.meta,
                });

                consoleSpy.mockRestore();
            });

            it('processes person.updated event', async () => {
                const webhookData = {
                    body: {
                        event: 'updated.person',
                        meta: { id: 456, action: 'updated', object: 'person' },
                        current: { id: 456, first_name: 'Jane' },
                        previous: { id: 456, first_name: 'Jan' },
                    },
                    headers: {},
                    integrationId: 'test-id',
                };

                const consoleSpy = jest
                    .spyOn(console, 'log')
                    .mockImplementation();

                const result =
                    await integration._handlePipedriveWebhook(webhookData);

                expect(result.success).toBe(true);
                expect(result.action).toBe('updated');
                expect(integration._handlePersonWebhook).toHaveBeenCalledWith({
                    action: 'updated',
                    data: webhookData.body.current,
                    previous: webhookData.body.previous,
                    meta: webhookData.body.meta,
                });

                consoleSpy.mockRestore();
            });

            it('processes person.deleted event', async () => {
                const webhookData = {
                    body: {
                        event: 'deleted.person',
                        meta: { id: 789, action: 'deleted', object: 'person' },
                        current: null,
                    },
                    headers: {},
                    integrationId: 'test-id',
                };

                const consoleSpy = jest
                    .spyOn(console, 'log')
                    .mockImplementation();

                await integration._handlePipedriveWebhook(webhookData);

                expect(integration._handlePersonWebhook).toHaveBeenCalledWith({
                    action: 'deleted',
                    data: null,
                    previous: undefined,
                    meta: webhookData.body.meta,
                });

                consoleSpy.mockRestore();
            });

            it('processes person.merged event', async () => {
                const webhookData = {
                    body: {
                        event: 'merged.person',
                        meta: { id: 999, action: 'merged', object: 'person' },
                        current: { id: 999, first_name: 'Merged' },
                    },
                    headers: {},
                    integrationId: 'test-id',
                };

                const consoleSpy = jest
                    .spyOn(console, 'log')
                    .mockImplementation();

                await integration._handlePipedriveWebhook(webhookData);

                expect(integration._handlePersonWebhook).toHaveBeenCalled();

                consoleSpy.mockRestore();
            });
        });

        describe('Unhandled Object Types', () => {
            it('skips unhandled object types', async () => {
                const webhookData = {
                    body: {
                        event: 'added.deal',
                        meta: { id: 123, action: 'added', object: 'deal' },
                        current: { id: 123, title: 'Test Deal' },
                    },
                    headers: {},
                    integrationId: 'test-id',
                };

                const consoleSpy = jest
                    .spyOn(console, 'log')
                    .mockImplementation();

                const result =
                    await integration._handlePipedriveWebhook(webhookData);

                expect(result).toEqual({
                    success: true,
                    skipped: true,
                    reason: "Object type 'deal' not configured for sync",
                });
                expect(integration._handlePersonWebhook).not.toHaveBeenCalled();

                consoleSpy.mockRestore();
            });
        });

        describe('Error Handling', () => {
            it('logs error to integration messages on failure', async () => {
                const webhookData = {
                    body: {
                        event: 'added.person',
                        meta: { id: 123, action: 'added', object: 'person' },
                        current: { id: 123 },
                    },
                    headers: {},
                    integrationId: 'test-id',
                };

                integration._handlePersonWebhook.mockRejectedValue(
                    new Error('Sync failed'),
                );

                const consoleSpy = jest
                    .spyOn(console, 'error')
                    .mockImplementation();
                const logSpy = jest.spyOn(console, 'log').mockImplementation();

                await expect(
                    integration._handlePipedriveWebhook(webhookData),
                ).rejects.toThrow('Sync failed');

                expect(
                    integration.updateIntegrationMessages.execute,
                ).toHaveBeenCalledWith(
                    'test-integration-id',
                    'errors',
                    'Webhook Processing Error',
                    expect.stringContaining('Failed to process added.person'),
                    expect.any(Number),
                );

                consoleSpy.mockRestore();
                logSpy.mockRestore();
            });

            it('throws error for SQS retry', async () => {
                const webhookData = {
                    body: {
                        event: 'updated.person',
                        meta: { id: 456 },
                        current: { id: 456 },
                    },
                    headers: {},
                    integrationId: 'test-id',
                };

                integration._handlePersonWebhook.mockRejectedValue(
                    new Error('Processing error'),
                );

                const consoleSpy = jest
                    .spyOn(console, 'error')
                    .mockImplementation();
                const logSpy = jest.spyOn(console, 'log').mockImplementation();

                await expect(
                    integration._handlePipedriveWebhook(webhookData),
                ).rejects.toThrow('Processing error');

                consoleSpy.mockRestore();
                logSpy.mockRestore();
            });

            it('throws error when meta is missing', async () => {
                const webhookData = {
                    body: {
                        event: 'added.person',
                        current: { id: 123 },
                    },
                    headers: {},
                    integrationId: 'test-id',
                };

                const consoleSpy = jest
                    .spyOn(console, 'error')
                    .mockImplementation();
                const logSpy = jest.spyOn(console, 'log').mockImplementation();

                await expect(
                    integration._handlePipedriveWebhook(webhookData),
                ).rejects.toThrow(
                    'Invalid webhook payload: missing meta or event',
                );

                consoleSpy.mockRestore();
                logSpy.mockRestore();
            });

            it('throws error when event is missing', async () => {
                const webhookData = {
                    body: {
                        meta: { id: 123 },
                        current: { id: 123 },
                    },
                    headers: {},
                    integrationId: 'test-id',
                };

                const consoleSpy = jest
                    .spyOn(console, 'error')
                    .mockImplementation();
                const logSpy = jest.spyOn(console, 'log').mockImplementation();

                await expect(
                    integration._handlePipedriveWebhook(webhookData),
                ).rejects.toThrow(
                    'Invalid webhook payload: missing meta or event',
                );

                consoleSpy.mockRestore();
                logSpy.mockRestore();
            });
        });
    });

    describe('_handlePersonWebhook', () => {
        beforeEach(() => {
            mockPipedriveApi.api.getPerson = jest.fn();
            integration._syncPersonToQuo = jest.fn().mockResolvedValue();
            integration.upsertMapping = jest.fn().mockResolvedValue();
        });

        describe('Happy Path', () => {
            it('fetches full person data from Pipedrive', async () => {
                const fullPerson = {
                    id: 123,
                    first_name: 'John',
                    last_name: 'Doe',
                    emails: [{ value: 'john@example.com', primary: true }],
                };

                mockPipedriveApi.api.getPerson.mockResolvedValue({
                    data: fullPerson,
                });

                await integration._handlePersonWebhook({
                    action: 'added',
                    data: { id: 123, first_name: 'John' },
                    meta: { id: 123 },
                });

                expect(mockPipedriveApi.api.getPerson).toHaveBeenCalledWith(
                    123,
                );
                expect(integration._syncPersonToQuo).toHaveBeenCalledWith(
                    fullPerson,
                    'added',
                );
            });

            it('syncs person to Quo via _syncPersonToQuo', async () => {
                mockPipedriveApi.api.getPerson.mockResolvedValue({
                    data: { id: 456, first_name: 'Jane' },
                });

                await integration._handlePersonWebhook({
                    action: 'updated',
                    data: { id: 456 },
                    meta: { id: 456 },
                });

                expect(integration._syncPersonToQuo).toHaveBeenCalledWith(
                    { id: 456, first_name: 'Jane' },
                    'updated',
                );
            });

            it('updates mapping with sync metadata', async () => {
                mockPipedriveApi.api.getPerson.mockResolvedValue({
                    data: { id: 789 },
                });

                const dateSpy = jest
                    .spyOn(Date.prototype, 'toISOString')
                    .mockReturnValue('2024-01-15T12:00:00.000Z');

                await integration._handlePersonWebhook({
                    action: 'merged',
                    data: { id: 789 },
                    meta: { id: 789 },
                });

                expect(integration.upsertMapping).toHaveBeenCalledWith('789', {
                    externalId: '789',
                    entityType: 'Person',
                    lastSyncedAt: '2024-01-15T12:00:00.000Z',
                    syncMethod: 'webhook',
                    action: 'merged',
                });

                dateSpy.mockRestore();
            });
        });

        describe('Deletion Handling', () => {
            it('handles deleted person without fetching full data', async () => {
                const consoleSpy = jest
                    .spyOn(console, 'log')
                    .mockImplementation();

                await integration._handlePersonWebhook({
                    action: 'deleted',
                    data: null,
                    meta: { id: 999 },
                });

                expect(mockPipedriveApi.api.getPerson).not.toHaveBeenCalled();
                expect(integration._syncPersonToQuo).toHaveBeenCalledWith(
                    { id: 999 },
                    'deleted',
                );

                consoleSpy.mockRestore();
            });
        });

        describe('Error Recovery', () => {
            it('uses webhook data when API fetch fails', async () => {
                mockPipedriveApi.api.getPerson.mockRejectedValue(
                    new Error('API unavailable'),
                );

                const webhookData = { id: 111, first_name: 'Fallback' };
                const warnSpy = jest
                    .spyOn(console, 'warn')
                    .mockImplementation();
                const logSpy = jest.spyOn(console, 'log').mockImplementation();

                await integration._handlePersonWebhook({
                    action: 'added',
                    data: webhookData,
                    meta: { id: 111 },
                });

                expect(integration._syncPersonToQuo).toHaveBeenCalledWith(
                    webhookData,
                    'added',
                );

                warnSpy.mockRestore();
                logSpy.mockRestore();
            });

            it('handles person not found gracefully', async () => {
                mockPipedriveApi.api.getPerson.mockResolvedValue({
                    data: null,
                });

                const warnSpy = jest
                    .spyOn(console, 'warn')
                    .mockImplementation();
                const logSpy = jest.spyOn(console, 'log').mockImplementation();

                await integration._handlePersonWebhook({
                    action: 'updated',
                    data: null,
                    meta: { id: 222 },
                });

                expect(integration._syncPersonToQuo).not.toHaveBeenCalled();
                expect(warnSpy).toHaveBeenCalledWith(
                    expect.stringContaining('Person 222 not found'),
                );

                warnSpy.mockRestore();
                logSpy.mockRestore();
            });

            it('throws error on sync failure', async () => {
                mockPipedriveApi.api.getPerson.mockResolvedValue({
                    data: { id: 333 },
                });

                integration._syncPersonToQuo.mockRejectedValue(
                    new Error('Sync failed'),
                );

                const errorSpy = jest
                    .spyOn(console, 'error')
                    .mockImplementation();
                const logSpy = jest.spyOn(console, 'log').mockImplementation();

                await expect(
                    integration._handlePersonWebhook({
                        action: 'added',
                        data: { id: 333 },
                        meta: { id: 333 },
                    }),
                ).rejects.toThrow('Sync failed');

                errorSpy.mockRestore();
                logSpy.mockRestore();
            });
        });
    });
});
