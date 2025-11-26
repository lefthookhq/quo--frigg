/**
 * Call Title Format Tests (TDD)
 *
 * Bug: Call titles showing "Call Summary:" instead of "Call"
 * Expected: All call notes should use "Call" prefix, not "Call Summary:"
 *
 * Test Plan:
 * 1. Regular call with summary → title should be "☎️  Call ..."
 * 2. AI-handled (Sona) call with summary → title should be "☎️  Call ..."
 * 3. Call with recordings only (no summary) → title should be "☎️  Call ..."
 */

const AttioIntegration = require('../src/integrations/AttioIntegration');
const {
    mockGetPhoneNumber,
    mockGetUser,
    mockGetCall,
    mockGetCallRecordings,
} = require('./fixtures/quo-api-responses');

describe('AttioIntegration - Call Title Format (Bug Fix)', () => {
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
                { number: '+15551234567', name: 'Sales Line' }
            ]
        };

        integration.upsertMapping = jest.fn().mockResolvedValue({});
        integration.getMapping = jest.fn();
        integration._findAttioContactFromQuoWebhook = jest.fn().mockResolvedValue('attio-contact-123');
    });

    describe('Bug Fix: Title should be "Call" not "Call Summary:"', () => {
        it('should use "Call" prefix for regular call with AI summary', async () => {
            const webhookData = {
                type: 'call.summary.completed',
                data: {
                    object: {
                        callId: 'AC_TEST_001',
                        summary: ['Customer requested demo', 'Scheduled for next week'],
                        nextSteps: ['Send calendar invite'],
                        jobs: [],
                        status: 'completed',
                    },
                    deepLink: 'https://app.openphone.com/calls/AC_TEST_001',
                },
            };

            integration.getMapping.mockResolvedValue({
                mapping: {
                    noteId: 'note-initial-123',
                    callId: 'AC_TEST_001',
                },
            });

            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: 'AC_TEST_001',
                    direction: 'incoming',
                    status: 'completed',
                    duration: 180,
                    participants: ['+15559876543', '+15551234567'],
                    phoneNumberId: 'PN_TEST_001',
                    userId: 'US_TEST_001',
                    answeredAt: '2025-01-15T10:30:00Z',
                    aiHandled: null, // Regular call, not AI-handled
                    createdAt: '2025-01-15T10:30:00Z',
                },
            });

            mockQuoApi.api.getCallRecordings.mockResolvedValue({ data: [] });
            mockQuoApi.api.getCallVoicemails.mockResolvedValue({ data: null });
            mockQuoApi.api.getPhoneNumber.mockResolvedValue(mockGetPhoneNumber.salesLine);
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.johnSmith);

            integration.logCallToActivity = jest.fn().mockResolvedValue('note-enriched-456');
            mockAttioApi.api.deleteNote.mockResolvedValue({});

            await integration._handleQuoCallSummaryEvent(webhookData);

            // Assert: Title should NOT contain "Call Summary:"
            expect(integration.logCallToActivity).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: expect.stringMatching(/^☎️\s+Call\s+/), // Should start with "☎️  Call "
                    title: expect.not.stringMatching(/Call Summary:/), // Should NOT contain "Call Summary:"
                })
            );
        });

        it('should use "Call" prefix for AI-handled (Sona) call with summary', async () => {
            const webhookData = {
                type: 'call.summary.completed',
                data: {
                    object: {
                        callId: 'AC_TEST_SONA',
                        summary: ['Sona handled customer inquiry'],
                        nextSteps: [],
                        jobs: [],
                        status: 'completed',
                    },
                    deepLink: 'https://app.openphone.com/calls/AC_TEST_SONA',
                },
            };

            integration.getMapping.mockResolvedValue({
                mapping: {
                    noteId: 'note-sona-initial',
                    callId: 'AC_TEST_SONA',
                },
            });

            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: 'AC_TEST_SONA',
                    direction: 'incoming',
                    status: 'completed',
                    duration: 120,
                    participants: ['+15559876543', '+15551234567'],
                    phoneNumberId: 'PN_TEST_001',
                    userId: 'US_TEST_001',
                    answeredAt: '2025-01-15T11:00:00Z',
                    aiHandled: 'ai-agent', // Sona-handled call
                    createdAt: '2025-01-15T11:00:00Z',
                },
            });

            mockQuoApi.api.getCallRecordings.mockResolvedValue({ data: [] });
            mockQuoApi.api.getCallVoicemails.mockResolvedValue({ data: null });
            mockQuoApi.api.getPhoneNumber.mockResolvedValue(mockGetPhoneNumber.salesLine);
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.johnSmith);

            integration.logCallToActivity = jest.fn().mockResolvedValue('note-sona-enriched');
            mockAttioApi.api.deleteNote.mockResolvedValue({});

            await integration._handleQuoCallSummaryEvent(webhookData);

            // Assert: Title should NOT contain "Call Summary:" even for Sona calls
            expect(integration.logCallToActivity).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: expect.stringMatching(/^☎️\s+Call\s+/),
                    title: expect.not.stringMatching(/Call Summary:/),
                })
            );
        });
    });

    describe('Jobs Field Display (Sona Enhancement)', () => {
        it('should include jobs section in enriched note when jobs are present', async () => {
            const webhookData = {
                type: 'call.summary.completed',
                data: {
                    object: {
                        callId: 'AC_TEST_JOBS',
                        summary: ['Customer requested pricing information', 'Discussed enterprise plan features'],
                        nextSteps: ['Send pricing proposal by EOD'],
                        jobs: [
                            {
                                icon: '✍️',
                                name: 'Message taking',
                                result: {
                                    data: [
                                        {
                                            name: 'First and last name',
                                            value: 'John Customer',
                                        },
                                        {
                                            name: 'Summarize the message',
                                            value: 'Customer called to discuss enterprise pricing and schedule a demo with the engineering team.',
                                        },
                                    ],
                                },
                            },
                        ],
                        status: 'completed',
                    },
                    deepLink: 'https://app.openphone.com/calls/AC_TEST_JOBS',
                },
            };

            integration.getMapping.mockResolvedValue({
                mapping: {
                    noteId: 'note-jobs-initial',
                    callId: 'AC_TEST_JOBS',
                },
            });

            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: 'AC_TEST_JOBS',
                    direction: 'incoming',
                    status: 'completed',
                    duration: 300,
                    participants: ['+15559876543', '+15551234567'],
                    phoneNumberId: 'PN_TEST_001',
                    userId: 'US_TEST_001',
                    answeredAt: '2025-01-15T14:30:00Z',
                    aiHandled: 'ai-agent',
                    createdAt: '2025-01-15T14:30:00Z',
                },
            });

            mockQuoApi.api.getCallRecordings.mockResolvedValue({ data: [] });
            mockQuoApi.api.getCallVoicemails.mockResolvedValue({ data: null });
            mockQuoApi.api.getPhoneNumber.mockResolvedValue(mockGetPhoneNumber.salesLine);
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.johnSmith);

            integration.logCallToActivity = jest.fn().mockResolvedValue('note-jobs-enriched');
            mockAttioApi.api.deleteNote.mockResolvedValue({});

            await integration._handleQuoCallSummaryEvent(webhookData);

            // Assert: Summary should include Jobs section with formatted job data
            const callArgs = integration.logCallToActivity.mock.calls[0][0];
            expect(callArgs.summary).toContain('**Jobs:**');
            expect(callArgs.summary).toContain('✍️ Message taking');
            expect(callArgs.summary).toContain('**First and last name:** John Customer');
            expect(callArgs.summary).toContain('**Summarize the message:** Customer called to discuss enterprise pricing');
        });

        it('should not include jobs section when jobs array is empty', async () => {
            const webhookData = {
                type: 'call.summary.completed',
                data: {
                    object: {
                        callId: 'AC_TEST_NO_JOBS',
                        summary: ['Quick check-in call'],
                        nextSteps: [],
                        jobs: [],
                        status: 'completed',
                    },
                    deepLink: 'https://app.openphone.com/calls/AC_TEST_NO_JOBS',
                },
            };

            integration.getMapping.mockResolvedValue({
                mapping: {
                    noteId: 'note-no-jobs-initial',
                    callId: 'AC_TEST_NO_JOBS',
                },
            });

            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: 'AC_TEST_NO_JOBS',
                    direction: 'outgoing',
                    status: 'completed',
                    duration: 60,
                    participants: ['+15559876543', '+15551234567'],
                    phoneNumberId: 'PN_TEST_001',
                    userId: 'US_TEST_001',
                    answeredAt: '2025-01-15T15:00:00Z',
                    aiHandled: null,
                    createdAt: '2025-01-15T15:00:00Z',
                },
            });

            mockQuoApi.api.getCallRecordings.mockResolvedValue({ data: [] });
            mockQuoApi.api.getCallVoicemails.mockResolvedValue({ data: null });
            mockQuoApi.api.getPhoneNumber.mockResolvedValue(mockGetPhoneNumber.salesLine);
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.johnSmith);

            integration.logCallToActivity = jest.fn().mockResolvedValue('note-no-jobs');
            mockAttioApi.api.deleteNote.mockResolvedValue({});

            await integration._handleQuoCallSummaryEvent(webhookData);

            // Assert: Summary should NOT include Jobs section
            const callArgs = integration.logCallToActivity.mock.calls[0][0];
            expect(callArgs.summary).not.toContain('**Jobs:**');
        });
    });
});
