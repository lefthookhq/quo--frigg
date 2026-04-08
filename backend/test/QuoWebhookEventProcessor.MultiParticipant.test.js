const QuoWebhookEventProcessor = require('../src/base/services/QuoWebhookEventProcessor');

describe('QuoWebhookEventProcessor - Multi-Participant Call Handling', () => {
    let mockQuoApi;

    beforeEach(() => {
        mockQuoApi = {
            getCall: jest.fn(),
            getCallVoicemails: jest.fn(),
        };
    });

    describe('fetchCallWithVoicemail', () => {
        it('should return null when OpenPhone returns 400 Too Many Participants', async () => {
            const error = new Error('Too Many Participants');
            error.statusCode = 400;
            mockQuoApi.getCall.mockRejectedValue(error);

            const result =
                await QuoWebhookEventProcessor.fetchCallWithVoicemail(
                    mockQuoApi,
                    'call-123',
                );

            expect(result).toBeNull();
        });

        it('should log a warning for multi-participant calls instead of throwing', async () => {
            const consoleSpy = jest
                .spyOn(console, 'warn')
                .mockImplementation();

            const error = new Error('Too Many Participants');
            error.statusCode = 400;
            mockQuoApi.getCall.mockRejectedValue(error);

            await QuoWebhookEventProcessor.fetchCallWithVoicemail(
                mockQuoApi,
                'call-456',
            );

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('call-456'),
            );
            consoleSpy.mockRestore();
        });

        it('should re-throw non-400 errors from getCall', async () => {
            const error = new Error('Internal Server Error');
            error.statusCode = 500;
            mockQuoApi.getCall.mockRejectedValue(error);

            await expect(
                QuoWebhookEventProcessor.fetchCallWithVoicemail(
                    mockQuoApi,
                    'call-789',
                ),
            ).rejects.toThrow('Internal Server Error');
        });

        it('should re-throw errors without statusCode (e.g. network errors)', async () => {
            const error = new Error('ECONNREFUSED');
            mockQuoApi.getCall.mockRejectedValue(error);

            await expect(
                QuoWebhookEventProcessor.fetchCallWithVoicemail(
                    mockQuoApi,
                    'call-net',
                ),
            ).rejects.toThrow('ECONNREFUSED');
        });

        it('should return call data normally when getCall succeeds', async () => {
            mockQuoApi.getCall.mockResolvedValue({
                data: {
                    id: 'call-ok',
                    status: 'completed',
                    participants: [],
                },
            });

            const result =
                await QuoWebhookEventProcessor.fetchCallWithVoicemail(
                    mockQuoApi,
                    'call-ok',
                );

            expect(result).toEqual({
                id: 'call-ok',
                status: 'completed',
                participants: [],
            });
        });
    });
});
