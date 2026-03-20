/**
 * AxisCare Integration - Direction-Aware Caller Fields Tests
 *
 * Verifies that callerName and callerPhone in AxisCare call logs
 * are set correctly based on call direction:
 * - Outbound: caller = Quo inbox (phone number + user name)
 * - Inbound: caller = external AxisCare contact
 *
 * Covers both code paths:
 * 1. _handleQuoCallEvent (call.completed webhook)
 * 2. _handleQuoCallSummaryEvent (call.summary.completed webhook)
 */

const AxisCareIntegration = require('../src/integrations/AxisCareIntegration');
const {
    mockGetCall,
    mockGetPhoneNumber,
    mockGetUser,
} = require('./fixtures/quo-api-responses');

describe('AxisCareIntegration - Caller Fields by Direction', () => {
    let integration;
    let mockAxisCareApi;
    let mockQuoApi;

    const CONTACT_PHONE = '+15559876543';
    const INBOX_PHONE = '+15551234567';
    const INBOX_NAME = '📞 Sales Line';
    const CONTACT_NAME = 'Jane Client';
    const QUO_USER_NAME = 'John Smith';

    beforeEach(() => {
        mockAxisCareApi = {
            api: {
                createCallLog: jest
                    .fn()
                    .mockResolvedValue({ id: 'call-log-1' }),
                updateCallLog: jest.fn().mockResolvedValue({}),
                getClient: jest.fn(),
            },
        };

        mockQuoApi = {
            api: {
                getCall: jest.fn(),
                getCallRecordings: jest.fn().mockResolvedValue({ data: [] }),
                getCallVoicemails: jest.fn().mockResolvedValue({ data: null }),
                getPhoneNumber: jest
                    .fn()
                    .mockResolvedValue(mockGetPhoneNumber.salesLine),
                getUser: jest.fn().mockResolvedValue(mockGetUser.johnSmith),
            },
        };

        integration = new AxisCareIntegration({
            userId: 'test-user',
            id: 'test-integration-id',
        });

        integration.axisCare = mockAxisCareApi;
        integration.quo = mockQuoApi;
        integration.commands = {
            updateIntegrationConfig: jest.fn().mockResolvedValue({}),
        };
        integration.config = {
            phoneNumbersMetadata: [{ id: 'PN_TEST_001', number: INBOX_PHONE }],
        };
        integration.upsertMapping = jest.fn().mockResolvedValue({});
        integration.getMapping = jest.fn().mockResolvedValue(null);
        integration._findAxisCareContactByPhone = jest
            .fn()
            .mockResolvedValue({ id: '123', type: 'client' });
        integration._fetchAxisCareContactName = jest
            .fn()
            .mockResolvedValue(CONTACT_NAME);
        integration.updateIntegrationMessages = {
            execute: jest.fn().mockResolvedValue({}),
        };
    });

    function buildCallWebhook(callFixture) {
        return {
            type: 'call.completed',
            data: {
                object: callFixture.data,
                deepLink: `https://app.openphone.com/calls/${callFixture.data.id}`,
            },
        };
    }

    function buildSummaryWebhook(callId) {
        return {
            type: 'call.summary.completed',
            data: {
                object: {
                    callId,
                    summary: ['Discussed care plan'],
                    nextSteps: ['Follow up next week'],
                    status: 'completed',
                },
                deepLink: `https://app.openphone.com/calls/${callId}`,
            },
        };
    }

    describe.each([
        ['_handleQuoCallEvent', 'call event'],
        ['_handleQuoCallSummaryEvent', 'call summary event'],
    ])('%s', (method, label) => {
        function invokeHandler(callFixture) {
            mockQuoApi.api.getCall.mockResolvedValue(callFixture);

            if (method === '_handleQuoCallEvent') {
                return integration._handleQuoCallEvent(
                    buildCallWebhook(callFixture),
                );
            }
            return integration._handleQuoCallSummaryEvent(
                buildSummaryWebhook(callFixture.data.id),
            );
        }

        it(`should use Quo inbox phone and user name for outbound ${label}`, async () => {
            await invokeHandler(mockGetCall.completedOutgoing);

            expect(mockAxisCareApi.api.createCallLog).toHaveBeenCalledWith(
                expect.objectContaining({
                    callerPhone: INBOX_PHONE,
                    callerName: `${QUO_USER_NAME} ${INBOX_NAME}`,
                }),
            );
        });

        it(`should use contact phone and name for inbound ${label}`, async () => {
            await invokeHandler(mockGetCall.completedIncoming);

            expect(mockAxisCareApi.api.createCallLog).toHaveBeenCalledWith(
                expect.objectContaining({
                    callerPhone: CONTACT_PHONE,
                    callerName: CONTACT_NAME,
                }),
            );
        });
    });

    describe('_handleQuoCallEvent - outbound without initiatedBy', () => {
        it('should fall back to userId when initiatedBy is null', async () => {
            const outgoingNoInitiator = {
                data: {
                    ...mockGetCall.completedOutgoing.data,
                    initiatedBy: null,
                },
            };
            mockQuoApi.api.getCall.mockResolvedValue(outgoingNoInitiator);

            await integration._handleQuoCallEvent(
                buildCallWebhook(outgoingNoInitiator),
            );

            // userId resolves to QUO_USER_NAME, combined with inbox name
            expect(mockAxisCareApi.api.createCallLog).toHaveBeenCalledWith(
                expect.objectContaining({
                    callerPhone: INBOX_PHONE,
                    callerName: `${QUO_USER_NAME} ${INBOX_NAME}`,
                }),
            );
            expect(
                integration._fetchAxisCareContactName,
            ).not.toHaveBeenCalled();
        });
    });

    describe('inbound - contact name lookup fails', () => {
        it('should fall back to contact phone when _fetchAxisCareContactName returns null', async () => {
            integration._fetchAxisCareContactName.mockResolvedValue(null);
            mockQuoApi.api.getCall.mockResolvedValue(
                mockGetCall.completedIncoming,
            );

            await integration._handleQuoCallEvent(
                buildCallWebhook(mockGetCall.completedIncoming),
            );

            expect(mockAxisCareApi.api.createCallLog).toHaveBeenCalledWith(
                expect.objectContaining({
                    callerPhone: CONTACT_PHONE,
                    callerName: CONTACT_PHONE,
                }),
            );
        });

        it('should fall back to contact phone in summary path when name lookup fails', async () => {
            integration._fetchAxisCareContactName.mockResolvedValue(null);
            mockQuoApi.api.getCall.mockResolvedValue(
                mockGetCall.completedIncoming,
            );

            await integration._handleQuoCallSummaryEvent(
                buildSummaryWebhook(mockGetCall.completedIncoming.data.id),
            );

            expect(mockAxisCareApi.api.createCallLog).toHaveBeenCalledWith(
                expect.objectContaining({
                    callerPhone: CONTACT_PHONE,
                    callerName: CONTACT_PHONE,
                }),
            );
        });
    });
});
