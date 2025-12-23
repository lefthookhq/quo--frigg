/**
 * Tests for ZohoCRMIntegration webhook functionality
 * Focus: Notification token verification, setup, and routing
 */

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

const ZohoCRMIntegration = require('./ZohoCRMIntegration');

describe('ZohoCRMIntegration - Notification Token Verification', () => {
    let integration;

    beforeEach(() => {
        integration = new ZohoCRMIntegration();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('_verifyNotificationToken', () => {
        describe('Happy Path - Valid Tokens', () => {
            it('returns true when tokens match', () => {
                const result = integration._verifyNotificationToken({
                    receivedToken: 'secret-token-123',
                    storedToken: 'secret-token-123',
                });

                expect(result).toBe(true);
            });
        });

        describe('Error Cases - Invalid Tokens', () => {
            it('returns false when received token is null', () => {
                const warnSpy = jest
                    .spyOn(console, 'warn')
                    .mockImplementation();

                const result = integration._verifyNotificationToken({
                    receivedToken: null,
                    storedToken: 'stored-token',
                });

                expect(result).toBe(false);
                expect(warnSpy).toHaveBeenCalledWith(
                    expect.stringContaining(
                        'Missing received token or stored token',
                    ),
                );

                warnSpy.mockRestore();
            });

            it('returns false when stored token is null', () => {
                const warnSpy = jest
                    .spyOn(console, 'warn')
                    .mockImplementation();

                const result = integration._verifyNotificationToken({
                    receivedToken: 'received-token',
                    storedToken: null,
                });

                expect(result).toBe(false);

                warnSpy.mockRestore();
            });

            it('returns false when tokens do not match', () => {
                const result = integration._verifyNotificationToken({
                    receivedToken: 'token-abc',
                    storedToken: 'token-xyz',
                });

                expect(result).toBe(false);
            });

            it('handles undefined received token as missing', () => {
                const warnSpy = jest
                    .spyOn(console, 'warn')
                    .mockImplementation();

                const result = integration._verifyNotificationToken({
                    receivedToken: undefined,
                    storedToken: 'stored-token',
                });

                expect(result).toBe(false);
                expect(warnSpy).toHaveBeenCalledWith(
                    expect.stringContaining('Missing received token'),
                );

                warnSpy.mockRestore();
            });
        });

        describe('Edge Cases', () => {
            it('handles empty string tokens', () => {
                const warnSpy = jest
                    .spyOn(console, 'warn')
                    .mockImplementation();

                const result = integration._verifyNotificationToken({
                    receivedToken: '',
                    storedToken: 'stored-token',
                });

                expect(result).toBe(false);

                warnSpy.mockRestore();
            });

            it('handles whitespace-only tokens', () => {
                const result = integration._verifyNotificationToken({
                    receivedToken: '   ',
                    storedToken: '   ',
                });

                expect(result).toBe(true); // They match (both whitespace)
            });

            it('is case-sensitive when comparing tokens', () => {
                const result = integration._verifyNotificationToken({
                    receivedToken: 'Token123',
                    storedToken: 'token123',
                });

                expect(result).toBe(false);
            });

            it('handles special characters in tokens', () => {
                const complexToken = 'token!@#$%^&*()_+-=[]{}|;:,.<>?';

                const result = integration._verifyNotificationToken({
                    receivedToken: complexToken,
                    storedToken: complexToken,
                });

                expect(result).toBe(true);
            });
        });
    });
});

describe('ZohoCRMIntegration - Notification Setup', () => {
    let integration;
    let mockZohoCrmApi;

    beforeEach(() => {
        integration = new ZohoCRMIntegration();

        // Mock Zoho CRM API
        mockZohoCrmApi = {
            api: {
                enableNotification: jest.fn(),
            },
        };

        integration.zoho = mockZohoCrmApi;
        integration.id = 'test-integration-id';
        integration.config = {};

        // Mock commands
        integration.commands = {
            updateIntegrationConfig: jest.fn().mockResolvedValue({}),
        };

        // Set BASE_URL for tests
        process.env.BASE_URL = 'https://test-api.example.com';
    });

    afterEach(() => {
        delete process.env.BASE_URL;
        jest.restoreAllMocks();
    });

    describe('setupZohoNotifications', () => {
        describe('Happy Path - Already Configured', () => {
            it('returns already_configured when channel exists', async () => {
                integration.config = {
                    zohoNotificationChannelId: '12345',
                    zohoNotificationUrl: 'https://test.com/notifications',
                    notificationEvents: ['Accounts.all', 'Contacts.all'],
                };

                const result = await integration.setupZohoNotifications();

                expect(result).toEqual({
                    status: 'already_configured',
                    channelId: '12345',
                    notificationUrl: 'https://test.com/notifications',
                    events: ['Accounts.all', 'Contacts.all'],
                });
                expect(
                    mockZohoCrmApi.api.enableNotification,
                ).not.toHaveBeenCalled();
            });
        });

        describe('Happy Path - Creates Notification', () => {
            it('generates notification token', async () => {
                const mockResponse = {
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
                };

                mockZohoCrmApi.api.enableNotification.mockResolvedValue(
                    mockResponse,
                );

                const consoleSpy = jest
                    .spyOn(console, 'log')
                    .mockImplementation();

                await integration.setupZohoNotifications();

                // Verify token was generated (40 char hex string)
                const configCall =
                    integration.commands.updateIntegrationConfig.mock
                        .calls[0][0];
                expect(configCall.config.zohoNotificationToken).toMatch(
                    /^[a-f0-9]{40}$/,
                );

                consoleSpy.mockRestore();
            });

            it('enables notification for Accounts and Contacts', async () => {
                const mockResponse = {
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
                };

                mockZohoCrmApi.api.enableNotification.mockResolvedValue(
                    mockResponse,
                );

                const consoleSpy = jest
                    .spyOn(console, 'log')
                    .mockImplementation();

                await integration.setupZohoNotifications();

                expect(
                    mockZohoCrmApi.api.enableNotification,
                ).toHaveBeenCalledWith(
                    expect.objectContaining({
                        watch: expect.arrayContaining([
                            expect.objectContaining({
                                events: ['Accounts.all', 'Contacts.all'],
                            }),
                        ]),
                    }),
                );

                consoleSpy.mockRestore();
            });

            it('stores channel ID and token in config', async () => {
                const mockResponse = {
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
                };

                mockZohoCrmApi.api.enableNotification.mockResolvedValue(
                    mockResponse,
                );

                const consoleSpy = jest
                    .spyOn(console, 'log')
                    .mockImplementation();

                await integration.setupZohoNotifications();

                expect(
                    integration.commands.updateIntegrationConfig,
                ).toHaveBeenCalledWith(
                    expect.objectContaining({
                        integrationId: 'test-integration-id',
                        config: expect.objectContaining({
                            zohoNotificationChannelId: expect.any(Number),
                            zohoNotificationToken: expect.any(String),
                            zohoNotificationUrl: expect.stringContaining(
                                'test-integration-id',
                            ),
                            notificationEvents: [
                                'Accounts.all',
                                'Contacts.all',
                            ],
                        }),
                    }),
                );

                consoleSpy.mockRestore();
            });

            it('uses constant ZOHO_NOTIFICATION_CHANNEL_ID', async () => {
                const mockResponse = {
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
                };

                mockZohoCrmApi.api.enableNotification.mockResolvedValue(
                    mockResponse,
                );

                const consoleSpy = jest
                    .spyOn(console, 'log')
                    .mockImplementation();

                await integration.setupZohoNotifications();

                const configCall =
                    integration.commands.updateIntegrationConfig.mock
                        .calls[0][0];
                expect(configCall.config.zohoNotificationChannelId).toBe(
                    ZohoCRMIntegration.ZOHO_NOTIFICATION_CHANNEL_ID,
                );

                consoleSpy.mockRestore();
            });
        });

        describe('Error Handling', () => {
            it('throws error when BASE_URL not configured', async () => {
                delete process.env.BASE_URL;

                await expect(
                    integration.setupZohoNotifications(),
                ).rejects.toThrow('BASE_URL environment variable is required');
            });

            it('throws error when notification creation fails', async () => {
                mockZohoCrmApi.api.enableNotification.mockRejectedValue(
                    new Error('Zoho API error'),
                );

                const consoleSpy = jest
                    .spyOn(console, 'error')
                    .mockImplementation();

                await expect(
                    integration.setupZohoNotifications(),
                ).rejects.toThrow('Zoho API error');

                consoleSpy.mockRestore();
            });

            it('throws error when status is not success', async () => {
                const mockResponse = {
                    watch: [
                        {
                            status: 'failure',
                            details: { message: 'Invalid configuration' },
                        },
                    ],
                };

                mockZohoCrmApi.api.enableNotification.mockResolvedValue(
                    mockResponse,
                );

                const consoleSpy = jest
                    .spyOn(console, 'error')
                    .mockImplementation();

                await expect(
                    integration.setupZohoNotifications(),
                ).rejects.toThrow('Notification channel creation failed');

                consoleSpy.mockRestore();
            });

            it('throws error when no watch data returned', async () => {
                const mockResponse = {
                    watch: [],
                };

                mockZohoCrmApi.api.enableNotification.mockResolvedValue(
                    mockResponse,
                );

                const consoleSpy = jest
                    .spyOn(console, 'error')
                    .mockImplementation();

                await expect(
                    integration.setupZohoNotifications(),
                ).rejects.toThrow('Notification channel creation failed');

                consoleSpy.mockRestore();
            });
        });

        describe('Configuration Details', () => {
            it('includes return_affected_field_values flag', async () => {
                const mockResponse = {
                    watch: [
                        {
                            status: 'success',
                            details: {
                                events: [{ resource_name: 'Accounts' }],
                            },
                        },
                    ],
                };

                mockZohoCrmApi.api.enableNotification.mockResolvedValue(
                    mockResponse,
                );

                const consoleSpy = jest
                    .spyOn(console, 'log')
                    .mockImplementation();

                await integration.setupZohoNotifications();

                expect(
                    mockZohoCrmApi.api.enableNotification,
                ).toHaveBeenCalledWith(
                    expect.objectContaining({
                        watch: expect.arrayContaining([
                            expect.objectContaining({
                                return_affected_field_values: true,
                            }),
                        ]),
                    }),
                );

                consoleSpy.mockRestore();
            });

            it('sets notify_on_related_action to false', async () => {
                const mockResponse = {
                    watch: [
                        {
                            status: 'success',
                            details: {
                                events: [{ resource_name: 'Contacts' }],
                            },
                        },
                    ],
                };

                mockZohoCrmApi.api.enableNotification.mockResolvedValue(
                    mockResponse,
                );

                const consoleSpy = jest
                    .spyOn(console, 'log')
                    .mockImplementation();

                await integration.setupZohoNotifications();

                expect(
                    mockZohoCrmApi.api.enableNotification,
                ).toHaveBeenCalledWith(
                    expect.objectContaining({
                        watch: expect.arrayContaining([
                            expect.objectContaining({
                                notify_on_related_action: false,
                            }),
                        ]),
                    }),
                );

                consoleSpy.mockRestore();
            });

            it('includes timestamp in config', async () => {
                const dateSpy = jest
                    .spyOn(Date.prototype, 'toISOString')
                    .mockReturnValue('2024-01-20T10:00:00.000Z');

                const mockResponse = {
                    watch: [
                        {
                            status: 'success',
                            details: {
                                events: [{ resource_name: 'Accounts' }],
                            },
                        },
                    ],
                };

                mockZohoCrmApi.api.enableNotification.mockResolvedValue(
                    mockResponse,
                );

                const consoleSpy = jest
                    .spyOn(console, 'log')
                    .mockImplementation();

                await integration.setupZohoNotifications();

                const configCall =
                    integration.commands.updateIntegrationConfig.mock
                        .calls[0][0];
                expect(configCall.config.notificationCreatedAt).toBe(
                    '2024-01-20T10:00:00.000Z',
                );

                dateSpy.mockRestore();
                consoleSpy.mockRestore();
            });
        });
    });
});

describe('ZohoCRMIntegration - Notification Processing', () => {
    let integration;
    let mockZohoCrmApi;

    beforeEach(() => {
        integration = new ZohoCRMIntegration();

        // Mock Zoho CRM API
        mockZohoCrmApi = {
            api: {
                getRecord: jest.fn(),
            },
        };

        integration.zoho = mockZohoCrmApi;
        integration.id = 'test-integration-id';
        integration.config = {
            zohoNotificationToken: 'test-token-123',
        };

        // Mock methods
        integration._handlePersonWebhook = jest.fn().mockResolvedValue();
        integration.upsertMapping = jest.fn().mockResolvedValue();
        integration.updateIntegrationMessages = {
            execute: jest.fn().mockResolvedValue(),
        };

        // Suppress console logs
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'warn').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('_handleZohoNotification', () => {
        describe('Token Verification', () => {
            it('verifies notification token when available', async () => {
                const notificationData = {
                    body: {
                        module: 'Contacts',
                        ids: ['12345'],
                        operation: 'update',
                        channel_id: 1735593600000,
                        token: 'test-token-123',
                    },
                };

                const result =
                    await integration._handleZohoNotification(notificationData);

                expect(result.success).toBe(true);
                expect(result.successCount).toBe(1);
            });

            it('throws error on invalid token', async () => {
                const notificationData = {
                    body: {
                        module: 'Contacts',
                        ids: ['12345'],
                        operation: 'update',
                        channel_id: 1735593600000,
                        token: 'wrong-token',
                    },
                };

                await expect(
                    integration._handleZohoNotification(notificationData),
                ).rejects.toThrow('Notification token verification failed');
            });

            it('warns when token not available', async () => {
                integration.config = {}; // No token configured

                const notificationData = {
                    body: {
                        module: 'Contacts',
                        ids: ['12345'],
                        operation: 'update',
                        channel_id: 1735593600000,
                    },
                };

                const result =
                    await integration._handleZohoNotification(notificationData);

                expect(result.success).toBe(true);
                expect(console.warn).toHaveBeenCalledWith(
                    expect.stringContaining('No token - skipping verification'),
                );
            });
        });

        describe('Event Routing', () => {
            it('processes Contacts module notifications', async () => {
                const notificationData = {
                    body: {
                        module: 'Contacts',
                        ids: ['contact-123'],
                        operation: 'insert',
                        channel_id: 1735593600000,
                    },
                };

                const result =
                    await integration._handleZohoNotification(notificationData);

                expect(result.success).toBe(true);
                expect(result.module).toBe('Contacts');
                expect(integration._handlePersonWebhook).toHaveBeenCalledWith({
                    objectType: 'Contact',
                    recordId: 'contact-123',
                    moduleName: 'Contacts',
                    operation: 'insert',
                });
            });

            it('processes Accounts module notifications', async () => {
                const notificationData = {
                    body: {
                        module: 'Accounts',
                        ids: ['account-456'],
                        operation: 'update',
                        channel_id: 1735593600000,
                    },
                };

                const result =
                    await integration._handleZohoNotification(notificationData);

                expect(result.success).toBe(true);
                expect(result.module).toBe('Accounts');
                expect(integration._handlePersonWebhook).toHaveBeenCalledWith({
                    objectType: 'Account',
                    recordId: 'account-456',
                    moduleName: 'Accounts',
                    operation: 'update',
                });
            });

            it('skips unhandled modules', async () => {
                const notificationData = {
                    body: {
                        module: 'Leads',
                        ids: ['lead-789'],
                        operation: 'insert',
                        channel_id: 1735593600000,
                    },
                };

                const result =
                    await integration._handleZohoNotification(notificationData);

                expect(result.success).toBe(true);
                expect(result.skipped).toBe(true);
                expect(result.reason).toContain('Leads');
                expect(integration._handlePersonWebhook).not.toHaveBeenCalled();
            });
        });

        describe('Batch Processing', () => {
            it('processes all record IDs in notification', async () => {
                const notificationData = {
                    body: {
                        module: 'Contacts',
                        ids: ['contact-1', 'contact-2', 'contact-3'],
                        operation: 'update',
                        channel_id: 1735593600000,
                    },
                };

                const result =
                    await integration._handleZohoNotification(notificationData);

                expect(result.success).toBe(true);
                expect(result.recordCount).toBe(3);
                expect(result.successCount).toBe(3);
                expect(result.errorCount).toBe(0);
                expect(integration._handlePersonWebhook).toHaveBeenCalledTimes(
                    3,
                );
            });

            it('continues processing after individual errors', async () => {
                integration._handlePersonWebhook
                    .mockResolvedValueOnce() // contact-1 succeeds
                    .mockRejectedValueOnce(new Error('Sync failed')) // contact-2 fails
                    .mockResolvedValueOnce(); // contact-3 succeeds

                const notificationData = {
                    body: {
                        module: 'Contacts',
                        ids: ['contact-1', 'contact-2', 'contact-3'],
                        operation: 'update',
                        channel_id: 1735593600000,
                    },
                };

                const result =
                    await integration._handleZohoNotification(notificationData);

                expect(result.success).toBe(true);
                expect(result.successCount).toBe(2);
                expect(result.errorCount).toBe(1);
                expect(result.results).toEqual([
                    { recordId: 'contact-1', status: 'success' },
                    {
                        recordId: 'contact-2',
                        status: 'error',
                        error: 'Sync failed',
                    },
                    { recordId: 'contact-3', status: 'success' },
                ]);
            });

            it('returns success/error counts', async () => {
                integration._handlePersonWebhook
                    .mockResolvedValueOnce()
                    .mockRejectedValueOnce(new Error('Error 1'))
                    .mockRejectedValueOnce(new Error('Error 2'))
                    .mockResolvedValueOnce()
                    .mockResolvedValueOnce();

                const notificationData = {
                    body: {
                        module: 'Accounts',
                        ids: ['acc-1', 'acc-2', 'acc-3', 'acc-4', 'acc-5'],
                        operation: 'insert',
                        channel_id: 1735593600000,
                    },
                };

                const result =
                    await integration._handleZohoNotification(notificationData);

                expect(result.success).toBe(true);
                expect(result.successCount).toBe(3);
                expect(result.errorCount).toBe(2);
            });
        });

        describe('Error Handling', () => {
            it('throws error when module missing', async () => {
                const notificationData = {
                    body: {
                        ids: ['12345'],
                        operation: 'update',
                        channel_id: 1735593600000,
                    },
                };

                await expect(
                    integration._handleZohoNotification(notificationData),
                ).rejects.toThrow('Notification payload missing module or ids');
            });

            it('throws error when ids array empty', async () => {
                const notificationData = {
                    body: {
                        module: 'Contacts',
                        ids: [],
                        operation: 'update',
                        channel_id: 1735593600000,
                    },
                };

                await expect(
                    integration._handleZohoNotification(notificationData),
                ).rejects.toThrow('Notification payload missing module or ids');
            });

            it('throws error when ids missing', async () => {
                const notificationData = {
                    body: {
                        module: 'Contacts',
                        operation: 'update',
                        channel_id: 1735593600000,
                    },
                };

                await expect(
                    integration._handleZohoNotification(notificationData),
                ).rejects.toThrow();
            });

            it('logs error to integration messages', async () => {
                const notificationData = {
                    body: {
                        module: 'InvalidModule',
                        ids: [],
                        operation: 'update',
                        channel_id: 1735593600000,
                    },
                };

                await expect(
                    integration._handleZohoNotification(notificationData),
                ).rejects.toThrow();

                expect(
                    integration.updateIntegrationMessages.execute,
                ).toHaveBeenCalledWith(
                    'test-integration-id',
                    'errors',
                    'Notification Processing Error',
                    expect.stringContaining(
                        'Failed to process InvalidModule notification',
                    ),
                    expect.any(Number),
                );
            });
        });
    });

    describe('_handlePersonWebhook', () => {
        it('syncs Contact to Quo', async () => {
            // Create a fresh integration for this test with real _handlePersonWebhook
            const testIntegration = new ZohoCRMIntegration();
            testIntegration._syncPersonToQuo = jest.fn().mockResolvedValue();
            testIntegration.upsertMapping = jest.fn().mockResolvedValue();

            // Suppress console logs for this specific call
            const logSpy = jest.spyOn(console, 'log').mockImplementation();

            await testIntegration._handlePersonWebhook({
                objectType: 'Contact',
                recordId: 'contact-123',
                moduleName: 'Contacts',
                operation: 'insert',
            });

            expect(testIntegration._syncPersonToQuo).toHaveBeenCalledWith(
                'Contact',
                'contact-123',
                'insert',
            );

            logSpy.mockRestore();
        });

        it('syncs Account to Quo', async () => {
            const testIntegration = new ZohoCRMIntegration();
            testIntegration._syncPersonToQuo = jest.fn().mockResolvedValue();
            testIntegration.upsertMapping = jest.fn().mockResolvedValue();

            const logSpy = jest.spyOn(console, 'log').mockImplementation();

            await testIntegration._handlePersonWebhook({
                objectType: 'Account',
                recordId: 'account-456',
                moduleName: 'Accounts',
                operation: 'update',
            });

            expect(testIntegration._syncPersonToQuo).toHaveBeenCalledWith(
                'Account',
                'account-456',
                'update',
            );

            logSpy.mockRestore();
        });

        it('updates mapping after sync', async () => {
            const testIntegration = new ZohoCRMIntegration();
            testIntegration._syncPersonToQuo = jest.fn().mockResolvedValue();
            testIntegration.upsertMapping = jest.fn().mockResolvedValue();

            const logSpy = jest.spyOn(console, 'log').mockImplementation();

            await testIntegration._handlePersonWebhook({
                objectType: 'Contact',
                recordId: 'contact-789',
                moduleName: 'Contacts',
                operation: 'update',
            });

            expect(testIntegration.upsertMapping).toHaveBeenCalledWith(
                'contact-789',
                {
                    externalId: 'contact-789',
                    entityType: 'Contact',
                    lastSyncedAt: expect.any(String),
                    syncMethod: 'webhook',
                    moduleName: 'Contacts',
                    operation: 'update',
                },
            );

            logSpy.mockRestore();
        });

        it('throws error on sync failure', async () => {
            const testIntegration = new ZohoCRMIntegration();
            testIntegration._syncPersonToQuo = jest
                .fn()
                .mockRejectedValue(new Error('Sync failed'));
            testIntegration.upsertMapping = jest.fn().mockResolvedValue();

            const logSpy = jest.spyOn(console, 'log').mockImplementation();
            const errorSpy = jest.spyOn(console, 'error').mockImplementation();

            await expect(
                testIntegration._handlePersonWebhook({
                    objectType: 'Contact',
                    recordId: 'contact-fail',
                    moduleName: 'Contacts',
                    operation: 'insert',
                }),
            ).rejects.toThrow('Sync failed');

            logSpy.mockRestore();
            errorSpy.mockRestore();
        });
    });
});
