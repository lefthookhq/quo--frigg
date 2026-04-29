const ZohoCRMIntegration = require('../src/integrations/ZohoCRMIntegration');
const { HaltError } = require('@friggframework/core');

describe('ZohoCRMIntegration - Notification Renewal', () => {
    let integration;
    let mockZohoApi;

    beforeEach(() => {
        mockZohoApi = {
            enableNotification: jest.fn(),
            updateNotification: jest.fn(),
            getNotificationDetails: jest.fn(),
            disableNotification: jest.fn(),
        };

        integration = new ZohoCRMIntegration({});
        integration.zoho = { api: mockZohoApi };
        integration.id = 7133;

        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'warn').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('_renewZohoNotificationWithRetry', () => {
        const renewalParams = {
            channelId: '1735593600000',
            events: ['Accounts.all', 'Contacts.all'],
            expiry: new Date('2026-04-23T20:00:00Z'),
            token: 'verification-token-abc',
            notifyUrl:
                'https://oe4xqic7q9.execute-api.us-east-1.amazonaws.com/api/zoho-integration/webhooks/7133',
        };

        function buildFetchError(statusCode, body = '') {
            const error = new Error(
                `An error ocurred while fetching an external resource.\n${statusCode} ${body}`,
            );
            error.name = 'FetchError';
            error.statusCode = statusCode;
            error.response = { status: statusCode };
            return error;
        }

        it('returns the renewal response on PATCH success', async () => {
            mockZohoApi.updateNotification.mockResolvedValueOnce({
                watch: [
                    {
                        channel_id: renewalParams.channelId,
                        status: 'success',
                    },
                ],
            });

            const result =
                await integration._renewZohoNotificationWithRetry(
                    renewalParams,
                );

            expect(mockZohoApi.updateNotification).toHaveBeenCalledTimes(1);
            expect(mockZohoApi.enableNotification).not.toHaveBeenCalled();
            expect(result.watch[0].status).toBe('success');
        });

        it('falls back to re-subscribe on PATCH 400 (NOT_SUBSCRIBED with body)', async () => {
            mockZohoApi.updateNotification.mockRejectedValueOnce(
                buildFetchError(400, 'NOT_SUBSCRIBED'),
            );
            mockZohoApi.enableNotification.mockResolvedValueOnce({
                watch: [
                    {
                        channel_id: renewalParams.channelId,
                        status: 'success',
                    },
                ],
            });

            const result =
                await integration._renewZohoNotificationWithRetry(
                    renewalParams,
                );

            expect(mockZohoApi.updateNotification).toHaveBeenCalledTimes(1);
            expect(mockZohoApi.enableNotification).toHaveBeenCalledTimes(1);
            expect(mockZohoApi.enableNotification).toHaveBeenCalledWith(
                expect.objectContaining({
                    watch: [
                        expect.objectContaining({
                            channel_id: renewalParams.channelId,
                            events: renewalParams.events,
                            token: renewalParams.token,
                            notify_url: renewalParams.notifyUrl,
                            return_affected_field_values: true,
                            notify_on_related_action: false,
                        }),
                    ],
                }),
            );
            expect(result.watch[0].status).toBe('success');
        });

        it('falls back to re-subscribe on PATCH 400 with stripped body (FetchError in prod)', async () => {
            mockZohoApi.updateNotification.mockRejectedValueOnce(
                buildFetchError(400, 'Bad Request'),
            );
            mockZohoApi.enableNotification.mockResolvedValueOnce({
                watch: [
                    {
                        channel_id: renewalParams.channelId,
                        status: 'success',
                    },
                ],
            });

            const result =
                await integration._renewZohoNotificationWithRetry(
                    renewalParams,
                );

            expect(mockZohoApi.updateNotification).toHaveBeenCalledTimes(1);
            expect(mockZohoApi.enableNotification).toHaveBeenCalledTimes(1);
            expect(result.watch[0].status).toBe('success');
        });

        it('falls back to re-subscribe on PATCH 5xx errors (no PATCH retry)', async () => {
            mockZohoApi.updateNotification.mockRejectedValueOnce(
                buildFetchError(500, 'Internal Server Error'),
            );
            mockZohoApi.enableNotification.mockResolvedValueOnce({
                watch: [
                    {
                        channel_id: renewalParams.channelId,
                        status: 'success',
                    },
                ],
            });

            const result =
                await integration._renewZohoNotificationWithRetry(
                    renewalParams,
                );

            expect(mockZohoApi.updateNotification).toHaveBeenCalledTimes(1);
            expect(mockZohoApi.enableNotification).toHaveBeenCalledTimes(1);
            expect(result.watch[0].status).toBe('success');
        });

        it('falls back to re-subscribe when PATCH returns 200 with non-success watch', async () => {
            mockZohoApi.updateNotification.mockResolvedValueOnce({
                watch: [{ status: 'error', code: 'SOMETHING' }],
            });
            mockZohoApi.enableNotification.mockResolvedValueOnce({
                watch: [
                    {
                        channel_id: renewalParams.channelId,
                        status: 'success',
                    },
                ],
            });

            const result =
                await integration._renewZohoNotificationWithRetry(
                    renewalParams,
                );

            expect(mockZohoApi.updateNotification).toHaveBeenCalledTimes(1);
            expect(mockZohoApi.enableNotification).toHaveBeenCalledTimes(1);
            expect(result.watch[0].status).toBe('success');
        });
    });

    describe('_reSubscribeNotification - recovery flow', () => {
        const watchConfig = {
            watch: [
                {
                    channel_id: '1735593600000',
                    events: ['Accounts.all', 'Contacts.all'],
                    token: 'verification-token-abc',
                    notify_url:
                        'https://oe4xqic7q9.execute-api.us-east-1.amazonaws.com/api/zoho-integration/webhooks/7133',
                },
            ],
        };

        function buildFetchError(statusCode, body = '') {
            const error = new Error(`${statusCode} ${body}`);
            error.name = 'FetchError';
            error.statusCode = statusCode;
            error.response = { status: statusCode };
            return error;
        }

        it('returns response on initial POST success (no recovery needed)', async () => {
            mockZohoApi.enableNotification.mockResolvedValueOnce({
                watch: [
                    {
                        channel_id: watchConfig.watch[0].channel_id,
                        status: 'success',
                    },
                ],
            });

            const result =
                await integration._reSubscribeNotification(watchConfig);

            expect(mockZohoApi.enableNotification).toHaveBeenCalledTimes(1);
            expect(mockZohoApi.getNotificationDetails).not.toHaveBeenCalled();
            expect(mockZohoApi.disableNotification).not.toHaveBeenCalled();
            expect(result.watch[0].status).toBe('success');
        });

        it('on initial POST failure, finds stale channel via GET, deletes it, retries POST', async () => {
            mockZohoApi.enableNotification
                .mockRejectedValueOnce(buildFetchError(400, 'Bad Request'))
                .mockResolvedValueOnce({
                    watch: [
                        {
                            channel_id: watchConfig.watch[0].channel_id,
                            status: 'success',
                        },
                    ],
                });

            mockZohoApi.getNotificationDetails.mockResolvedValueOnce({
                watch: [
                    {
                        channel_id: watchConfig.watch[0].channel_id,
                        events: ['Accounts.all'],
                    },
                ],
            });

            mockZohoApi.disableNotification.mockResolvedValueOnce({
                watch: [{ status: 'success' }],
            });

            const result =
                await integration._reSubscribeNotification(watchConfig);

            expect(mockZohoApi.enableNotification).toHaveBeenCalledTimes(2);
            expect(mockZohoApi.getNotificationDetails).toHaveBeenCalledTimes(1);
            expect(mockZohoApi.disableNotification).toHaveBeenCalledWith([
                watchConfig.watch[0].channel_id,
            ]);
            expect(result.watch[0].status).toBe('success');
        });

        it('on initial POST failure, skips DELETE if no stale channel found, retries POST', async () => {
            mockZohoApi.enableNotification
                .mockRejectedValueOnce(buildFetchError(400, 'Bad Request'))
                .mockResolvedValueOnce({
                    watch: [
                        {
                            channel_id: watchConfig.watch[0].channel_id,
                            status: 'success',
                        },
                    ],
                });

            mockZohoApi.getNotificationDetails.mockResolvedValueOnce({
                watch: [
                    { channel_id: '9999999999999', events: ['Accounts.all'] },
                ],
            });

            const result =
                await integration._reSubscribeNotification(watchConfig);

            expect(mockZohoApi.enableNotification).toHaveBeenCalledTimes(2);
            expect(mockZohoApi.getNotificationDetails).toHaveBeenCalledTimes(1);
            expect(mockZohoApi.disableNotification).not.toHaveBeenCalled();
            expect(result.watch[0].status).toBe('success');
        });

        it('throws HaltError tagged with integrationId when recovery POST also fails', async () => {
            mockZohoApi.enableNotification
                .mockRejectedValueOnce(buildFetchError(400, 'Bad Request'))
                .mockRejectedValueOnce(buildFetchError(400, 'Still Failing'));

            mockZohoApi.getNotificationDetails.mockResolvedValueOnce({
                watch: [],
            });

            let caught;
            try {
                await integration._reSubscribeNotification(watchConfig);
            } catch (err) {
                caught = err;
            }

            expect(caught).toBeInstanceOf(HaltError);
            expect(caught.isHaltError).toBe(true);
            expect(caught.message).toContain('integration 7133');
            expect(caught.message).toMatch(/recovery attempt/i);
            expect(mockZohoApi.enableNotification).toHaveBeenCalledTimes(2);
        });

        it('throws HaltError when GET (getNotificationDetails) fails', async () => {
            mockZohoApi.enableNotification.mockRejectedValueOnce(
                buildFetchError(400, 'Bad Request'),
            );
            mockZohoApi.getNotificationDetails.mockRejectedValueOnce(
                buildFetchError(500, 'Internal Server Error'),
            );

            let caught;
            try {
                await integration._reSubscribeNotification(watchConfig);
            } catch (err) {
                caught = err;
            }

            expect(caught).toBeInstanceOf(HaltError);
            expect(caught.message).toContain('integration 7133');
        });

        it('throws HaltError when DELETE (disableNotification) fails', async () => {
            mockZohoApi.enableNotification.mockRejectedValueOnce(
                buildFetchError(400, 'Bad Request'),
            );
            mockZohoApi.getNotificationDetails.mockResolvedValueOnce({
                watch: [
                    {
                        channel_id: watchConfig.watch[0].channel_id,
                        events: ['Accounts.all'],
                    },
                ],
            });
            mockZohoApi.disableNotification.mockRejectedValueOnce(
                buildFetchError(500, 'Internal Server Error'),
            );

            let caught;
            try {
                await integration._reSubscribeNotification(watchConfig);
            } catch (err) {
                caught = err;
            }

            expect(caught).toBeInstanceOf(HaltError);
            expect(caught.message).toContain('integration 7133');
        });

        it('throws HaltError when initial POST returns 200 with non-success watch and recovery also fails', async () => {
            mockZohoApi.enableNotification
                .mockResolvedValueOnce({
                    watch: [{ status: 'error', code: 'SOMETHING' }],
                })
                .mockResolvedValueOnce({
                    watch: [{ status: 'error', code: 'STILL_BROKEN' }],
                });
            mockZohoApi.getNotificationDetails.mockResolvedValueOnce({
                watch: [],
            });

            let caught;
            try {
                await integration._reSubscribeNotification(watchConfig);
            } catch (err) {
                caught = err;
            }

            expect(caught).toBeInstanceOf(HaltError);
            expect(caught.message).toContain('integration 7133');
        });
    });
});
