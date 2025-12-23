/**
 * No-Answer Call Voicemail Tests (TDD)
 *
 * Bug: Missed calls with voicemails don't include voicemail in Attio notes
 * Solution: For no-answer calls, wait 3s for voicemail processing, then fetch and merge
 *
 * API Behavior (from Quo):
 * 1. call.completed webhook arrives (may have empty participants[] - ignored)
 * 2. getCall(callId) returns full call details with participants: ["+16178505435"] ✓
 * 3. For no-answer calls, WAIT 3 seconds (voicemail processing time)
 * 4. Fetch voicemail via getCallVoicemails(callId)
 * 5. Merge voicemail into call object and log to Attio
 *
 * Real Production Example:
 * - Webhook: {"participants": [], "status": "no-answer"} (ignored, just triggers handler)
 * - Full call: {"participants": ["+16178505435"], "status": "no-answer"} (already populated)
 * - Wait 3s for voicemail processing
 * - Voicemail: {"duration": 16, "transcript": "...", "recordingUrl": "..."}
 */

const AttioIntegration = require('../src/integrations/AttioIntegration');
const {
    mockGetPhoneNumber,
    mockGetUser,
} = require('./fixtures/quo-api-responses');

describe('AttioIntegration - Empty Participants (Voicemail)', () => {
    let integration;
    let mockAttioApi;
    let mockQuoApi;
    let mockCommands;

    beforeEach(() => {
        mockAttioApi = {
            api: {
                createNote: jest.fn(),
                deleteNote: jest.fn(),
                getRecord: jest.fn(),
            },
        };

        mockQuoApi = {
            api: {
                getCall: jest.fn(),
                getCallRecordings: jest.fn(),
                getCallVoicemails: jest.fn(),
                getPhoneNumber: jest.fn(),
                getUser: jest.fn(),
            },
        };

        mockCommands = {
            updateIntegrationStatus: { execute: jest.fn() },
            updateIntegrationMessages: { execute: jest.fn() },
            findOrganizationUserById: jest.fn().mockResolvedValue({
                id: 'test-user-id',
                email: 'test@example.com',
            }),
        };

        integration = new AttioIntegration({
            credential: {},
            integrationConfig: {},
            id: 'test-integration-id',
        });

        integration.attio = mockAttioApi;
        integration.quo = mockQuoApi;
        integration.commands = mockCommands;
        integration.config = {
            quoCallWebhookKey: 'test-key',
            phoneNumbersMetadata: [
                { number: '+15551234567', name: 'Sales Line' },
            ],
        };

        integration.upsertMapping = jest.fn().mockResolvedValue({});
        integration.getMapping = jest.fn();
        integration._findAttioContactFromQuoWebhook = jest
            .fn()
            .mockResolvedValue('attio-contact-123');
        integration.logCallToActivity = jest.fn().mockResolvedValue('note-123');
    });

    describe('No-answer with voicemail', () => {
        it('should fetch voicemail and log to Attio for no-answer calls', async () => {
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'CALL_TEST_VOICEMAIL_001',
                        participants: [], // Empty in webhook
                        direction: 'incoming',
                        status: 'no-answer',
                        duration: 0,
                        phoneNumberId: 'PNSeQ1TGZU',
                        userId: 'USpvVF3Lo2',
                        answeredAt: null,
                        createdAt: '2025-11-26T04:13:39.317Z',
                    },
                    deepLink:
                        'https://my.quo.com/calls/CALL_TEST_VOICEMAIL_001',
                },
            };

            // getCall returns full call details with participants already populated
            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: 'CALL_TEST_VOICEMAIL_001',
                    participants: ['+16178505435'], // Already populated in getCall response
                    direction: 'incoming',
                    status: 'no-answer',
                    duration: 26,
                    phoneNumberId: 'PNSeQ1TGZU',
                    userId: 'USpvVF3Lo2',
                    answeredAt: null,
                    createdAt: '2025-11-26T04:13:39.317Z',
                },
            });

            // Voicemail exists
            mockQuoApi.api.getCallVoicemails.mockResolvedValue({
                data: {
                    duration: 16,
                    id: 'VOICEMAIL_TEST_001',
                    transcript: 'I paid my dues, after time...',
                    recordingUrl: 'https://m.openph.one/static/voicemail.mp3',
                    status: 'completed',
                },
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue(
                mockGetPhoneNumber.salesLine,
            );
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.johnSmith);
            mockQuoApi.api.getCallRecordings.mockResolvedValue({ data: [] });

            await integration._handleQuoCallEvent(webhookData);

            // Should have called getCall once
            expect(mockQuoApi.api.getCall).toHaveBeenCalledTimes(1);
            expect(mockQuoApi.api.getCall).toHaveBeenCalledWith(
                'CALL_TEST_VOICEMAIL_001',
            );

            // Should have fetched voicemail for no-answer call
            expect(mockQuoApi.api.getCallVoicemails).toHaveBeenCalledWith(
                'CALL_TEST_VOICEMAIL_001',
            );

            // Should have logged to Attio with voicemail
            expect(integration.logCallToActivity).toHaveBeenCalled();
            const callArgs = integration.logCallToActivity.mock.calls[0][0];
            expect(callArgs.summary).toContain('Voicemail');
            expect(callArgs.summary).toContain('I paid my dues');
            expect(callArgs.title).toContain('+16178505435'); // External participant
        });

        it('should skip logging if no participants even with voicemail', async () => {
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'AC_NO_PARTICIPANTS_NO_VM',
                        participants: [],
                        direction: 'incoming',
                        status: 'no-answer',
                        phoneNumberId: 'PN_TEST_001',
                        userId: 'US_TEST_001',
                        answeredAt: null,
                        createdAt: '2025-11-26T04:13:39.317Z',
                    },
                    deepLink:
                        'https://my.quo.com/calls/AC_NO_PARTICIPANTS_NO_VM',
                },
            };

            // getCall returns empty participants (edge case)
            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: 'AC_NO_PARTICIPANTS_NO_VM',
                    participants: [], // Empty - unusual but possible
                    direction: 'incoming',
                    status: 'no-answer',
                    phoneNumberId: 'PN_TEST_001',
                    userId: 'US_TEST_001',
                    answeredAt: null,
                    createdAt: '2025-11-26T04:13:39.317Z',
                },
            });

            // Voicemail exists but no participants to link it to
            mockQuoApi.api.getCallVoicemails.mockResolvedValue({
                data: {
                    duration: 16,
                    id: 'VM_TEST',
                    transcript: 'Test voicemail',
                    recordingUrl: 'https://example.com/vm.mp3',
                    status: 'completed',
                },
            });
            mockQuoApi.api.getPhoneNumber.mockResolvedValue(
                mockGetPhoneNumber.salesLine,
            );
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.johnSmith);

            const result = await integration._handleQuoCallEvent(webhookData);

            // Should have called getCall once
            expect(mockQuoApi.api.getCall).toHaveBeenCalledTimes(1);

            // Should have checked for voicemail
            expect(mockQuoApi.api.getCallVoicemails).toHaveBeenCalled();

            // Should NOT have logged (no participants means no contact to link to)
            expect(integration.logCallToActivity).not.toHaveBeenCalled();
            expect(result.logged).toBe(false);
        });
    });
});
