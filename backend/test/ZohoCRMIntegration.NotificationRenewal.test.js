const ZohoCRMIntegration = require('../src/integrations/ZohoCRMIntegration');
const { HaltError } = require('@friggframework/core');

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
                            // Must match the initial subscription so webhook payloads
                            // keep field-level diff data on a re-created channel.
                            return_affected_field_values: true,
                            notify_on_related_action: false,
                        }),
                    ],
                }),
            );
            expect(result.watch[0].status).toBe('success');
        });

        it('does NOT fall back on a generic 400 without NOT_SUBSCRIBED (retries instead)', async () => {
            // Guard against over-broad detection: a 400 caused by something other
            // than NOT_SUBSCRIBED (e.g. schema or transient) must still go through
            // the 3× retry path and not trigger the POST fallback.
            const sanitizedError = new Error(
                'An error ocurred while fetching an external resource.\n' +
                    'PATCH https://www.zohoapis.com/crm/v8/actions/watch\n' +
                    '400 Bad Request',
            );
            sanitizedError.name = 'FetchError';
            sanitizedError.statusCode = 400;
            sanitizedError.response = { status: 400 };

            mockZohoApi.updateNotification.mockRejectedValue(sanitizedError);

            await expect(
                integration._renewZohoNotificationWithRetry(renewalParams),
            ).rejects.toThrow(/400 Bad Request/);

            expect(mockZohoApi.updateNotification).toHaveBeenCalledTimes(3);
            expect(mockZohoApi.enableNotification).not.toHaveBeenCalled();
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

        it('propagates network/5xx errors from enableNotification fallback unchanged so Frigg can retry', async () => {
            // When the POST fallback itself fails transiently (5xx, network),
            // the FetchError must propagate as-is — statusCode preserved, not
            // wrapped — so Frigg's retry/isHaltError logic can classify it.
            mockZohoApi.updateNotification.mockRejectedValueOnce(
                buildNotSubscribedFetchError(),
            );

            const transportError = new Error(
                'An error ocurred while fetching an external resource.\n' +
                    'POST https://www.zohoapis.com/crm/v8/actions/watch\n' +
                    '503 Service Unavailable',
            );
            transportError.name = 'FetchError';
            transportError.statusCode = 503;
            transportError.response = { status: 503 };
            mockZohoApi.enableNotification.mockRejectedValueOnce(
                transportError,
            );

            let caught;
            try {
                await integration._renewZohoNotificationWithRetry(
                    renewalParams,
                );
            } catch (err) {
                caught = err;
            }

            expect(caught).toBe(transportError);
            expect(caught.statusCode).toBe(503);
            expect(caught.isHaltError).toBeUndefined();
            expect(mockZohoApi.enableNotification).toHaveBeenCalledTimes(1);
        });

        it('throws HaltError when enableNotification fallback returns a non-success watch (avoids pointless DLQ retries)', async () => {
            mockZohoApi.updateNotification.mockRejectedValueOnce(
                buildNotSubscribedFetchError(),
            );
            mockZohoApi.enableNotification.mockResolvedValueOnce({
                watch: [{ status: 'error', code: 'SOMETHING_ELSE' }],
            });

            let caught;
            try {
                await integration._renewZohoNotificationWithRetry(
                    renewalParams,
                );
            } catch (err) {
                caught = err;
            }

            expect(caught).toBeInstanceOf(HaltError);
            expect(caught.isHaltError).toBe(true);
            expect(caught.message).toMatch(/re-subscription failed/i);
            expect(mockZohoApi.enableNotification).toHaveBeenCalledTimes(1);
        });
    });
});
