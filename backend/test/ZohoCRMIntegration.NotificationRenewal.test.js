const ZohoCRMIntegration = require('../src/integrations/ZohoCRMIntegration');

describe('ZohoCRMIntegration - Notification Renewal', () => {
    let integration;
    let mockZohoApi;

    beforeEach(() => {
        mockZohoApi = {
            enableNotification: jest.fn(),
            updateNotification: jest.fn(),
        };

        integration = new ZohoCRMIntegration({});
        integration.zoho = { api: mockZohoApi };
        integration.id = 'test-integration-id';
    });

    describe('_renewZohoNotificationWithRetry - NOT_SUBSCRIBED fallback', () => {
        const renewalParams = {
            channelId: '1735593600000',
            events: ['Accounts.all', 'Contacts.all'],
            expiry: new Date('2026-04-23T20:00:00Z'),
            token: 'verification-token-abc',
            notifyUrl:
                'https://oe4xqic7q9.execute-api.us-east-1.amazonaws.com/api/zoho-integration/webhooks/7133',
        };

        function buildNotSubscribedFetchError() {
            // Mirrors the FetchError shape produced by Frigg core for the observed
            // 400 Bad Request body from Zoho's PATCH /actions/watch.
            const error = new Error(
                'An error ocurred while fetching an external resource.\n' +
                    '>>> Request Details >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>\n' +
                    'PATCH https://www.zohoapis.com/crm/v8/actions/watch\n' +
                    '<<< Response Details <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<\n' +
                    '400 Bad Request\n' +
                    '{"watch":[{"code":"NOT_SUBSCRIBED","details":{},"message":"Not subscribed for actions-watch of the given channel","status":"error"}]}',
            );
            error.name = 'FetchError';
            error.statusCode = 400;
            error.response = { status: 400 };
            return error;
        }

        it('falls back to enableNotification when Zoho returns NOT_SUBSCRIBED on PATCH renewal', async () => {
            mockZohoApi.updateNotification.mockRejectedValueOnce(
                buildNotSubscribedFetchError(),
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
                        }),
                    ],
                }),
            );
            expect(result.watch[0].status).toBe('success');
        });

        it('still retries + throws on non-NOT_SUBSCRIBED errors (no fallback)', async () => {
            const transientError = new Error(
                'An error ocurred while fetching an external resource.\n500 Internal Server Error',
            );
            transientError.name = 'FetchError';
            transientError.statusCode = 500;

            mockZohoApi.updateNotification.mockRejectedValue(transientError);

            await expect(
                integration._renewZohoNotificationWithRetry(renewalParams),
            ).rejects.toThrow(/Internal Server Error/);

            expect(mockZohoApi.updateNotification).toHaveBeenCalledTimes(3);
            expect(mockZohoApi.enableNotification).not.toHaveBeenCalled();
        });

        it('throws when enableNotification fallback itself returns a non-success watch', async () => {
            mockZohoApi.updateNotification.mockRejectedValueOnce(
                buildNotSubscribedFetchError(),
            );
            mockZohoApi.enableNotification.mockResolvedValueOnce({
                watch: [{ status: 'error', code: 'SOMETHING_ELSE' }],
            });

            await expect(
                integration._renewZohoNotificationWithRetry(renewalParams),
            ).rejects.toThrow(/re-subscription failed|renewal failed/i);
        });
    });
});
