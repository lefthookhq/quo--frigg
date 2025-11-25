/**
 * Empty Participants Array Tests - TDD Implementation
 *
 * Tests for handling call webhooks with empty participants[] array.
 * Real v4 API issue: Some calls (especially no-answer) arrive with empty participants.
 *
 * Solution: Fetch full call details via getCall(callId) when participants is empty.
 */

const AttioIntegration = require('../src/integrations/AttioIntegration');

describe('AttioIntegration - Empty Participants Array (v4 API Bug)', () => {
    let integration;
    let mockAttioApi;
    let mockQuoApi;
    let mockCommands;

    beforeEach(() => {
        // Mock Attio API
        mockAttioApi = {
            api: {
                createNote: jest.fn(),
                getRecord: jest.fn(),
            },
        };

        // Mock Quo API
        mockQuoApi = {
            api: {
                getCall: jest.fn(),
                getPhoneNumber: jest.fn(),
                getUser: jest.fn(),
            },
        };

        // Mock commands
        mockCommands = {
            updateIntegrationConfig: jest.fn().mockResolvedValue({}),
        };

        // Create integration instance
        integration = new AttioIntegration({
            userId: 'test-user',
            id: 'test-integration-id',
        });

        // Inject mocks
        integration.attio = mockAttioApi;
        integration.quo = mockQuoApi;
        integration.commands = mockCommands;
        integration.config = {
            quoCallWebhookKey: 'test-key',
            phoneNumbersMetadata: [
                { number: '+17786502958', name: 'Primary' },
                { number: '+15559876543', name: 'Sales Line' },
            ],
        };

        // Mock mapping methods
        integration.upsertMapping = jest.fn().mockResolvedValue({});
        integration.getMapping = jest.fn().mockResolvedValue(null);
        integration._findAttioContactFromQuoWebhook = jest
            .fn()
            .mockResolvedValue('attio-contact-123');

        // Mock Attio getRecord
        mockAttioApi.api.getRecord.mockResolvedValue({
            data: {
                id: { record_id: 'attio-contact-123' },
                values: {
                    name: [{ value: 'Test Contact' }],
                },
            },
        });
    });

    describe('Domain Rule: Empty Participants Array Fallback', () => {
        it('should fetch full call details when participants array is empty', async () => {
            // Arrange - Domain Event: Real v4 webhook with empty participants
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'AC_EXAMPLE_EMPTY_001',
                        direction: 'incoming',
                        status: 'no-answer',
                        duration: 16,
                        participants: [], // EMPTY - this is the bug
                        phoneNumberId: 'PNOjP3dgKb',
                        userId: 'USdWHISNTR',
                        createdAt: '2025-11-25T06:47:41.758Z',
                        answeredAt: null,
                        answeredBy: null,
                        completedAt: '2025-11-25T06:47:58.000Z',
                    },
                    deepLink: 'https://dev.quo.com/inbox/PNOjP3dgKb/c/CN123?at=AC_EXAMPLE_EMPTY_001',
                },
            };

            // Mock getCall to return full details with participants array
            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: 'AC_EXAMPLE_EMPTY_001',
                    from: '+16048027941', // Contact phone
                    to: '+17786502958', // Inbox phone
                    direction: 'incoming',
                    status: 'no-answer',
                    duration: 16,
                    participants: ['+16048027941', '+17786502958'], // Populated by getCall
                    phoneNumberId: 'PNOjP3dgKb',
                    userId: 'USdWHISNTR',
                    answeredAt: null,
                    completedAt: '2025-11-25T06:47:58.000Z',
                    createdAt: '2025-11-25T06:47:41.758Z',
                },
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { name: 'Primary', symbol: '🍎', number: '+17786502958' },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'John', lastName: 'Doe' },
            });

            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-empty-participants' } },
            });

            // Act
            await integration._handleQuoCallEvent(webhookData);

            // Assert - Should have fetched full call details
            expect(mockQuoApi.api.getCall).toHaveBeenCalledWith('AC_EXAMPLE_EMPTY_001');

            // Assert - Should have found contact via _findAttioContactFromQuoWebhook
            expect(integration._findAttioContactFromQuoWebhook).toHaveBeenCalledWith('+16048027941');

            // Assert - Note created successfully
            expect(mockAttioApi.api.createNote).toHaveBeenCalled();
            const noteContent = mockAttioApi.api.createNote.mock.calls[0][0].content;
            expect(noteContent).toContain('Incoming missed');
        });

        it('should handle outgoing calls with empty participants', async () => {
            // Arrange - Domain Event: Outgoing call with empty participants
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'AC_outgoing_empty',
                        direction: 'outgoing',
                        status: 'completed',
                        duration: 120,
                        participants: [], // EMPTY
                        phoneNumberId: 'pn-456',
                        userId: 'user-789',
                        createdAt: '2025-01-15T14:00:00Z',
                        answeredAt: '2025-01-15T14:00:05Z',
                    },
                    deepLink: 'https://app.openphone.com/calls/AC_outgoing_empty',
                },
            };

            // Mock getCall to return full details with participants array
            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: 'AC_outgoing_empty',
                    from: '+15559876543', // Inbox phone (outgoing FROM)
                    to: '+15551234567', // Contact phone (outgoing TO)
                    direction: 'outgoing',
                    status: 'completed',
                    duration: 120,
                    participants: ['+15559876543', '+15551234567'], // Populated by getCall
                    phoneNumberId: 'pn-456',
                    userId: 'user-789',
                    answeredAt: '2025-01-15T14:00:05Z',
                    createdAt: '2025-01-15T14:00:00Z',
                },
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { name: 'Sales Line', number: '+15559876543' },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'Jane', lastName: 'Smith' },
            });

            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-outgoing-empty' } },
            });

            // Act
            await integration._handleQuoCallEvent(webhookData);

            // Assert - Fetched full call details
            expect(mockQuoApi.api.getCall).toHaveBeenCalledWith('AC_outgoing_empty');

            // Assert - Used correct contact phone for outgoing call (to field)
            expect(integration._findAttioContactFromQuoWebhook).toHaveBeenCalledWith('+15551234567');

            // Assert - Note created with correct status
            const noteContent = mockAttioApi.api.createNote.mock.calls[0][0].content;
            expect(noteContent).toContain('Outgoing initiated by Jane Smith');
        });

        it('should always fetch full call details even with participants array', async () => {
            // Arrange - Domain Event: Normal webhook with participants
            // NOTE: With refactoring, handler ALWAYS calls getCall() now
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'call-normal-001',
                        direction: 'incoming',
                        status: 'completed',
                        duration: 60,
                        participants: ['+15551234567', '+15559876543'], // Will be ignored, getCall result used
                        phoneNumberId: 'pn-456',
                        userId: 'user-789',
                        createdAt: '2025-01-15T15:00:00Z',
                        answeredAt: '2025-01-15T15:00:05Z',
                    },
                    deepLink: 'https://app.openphone.com/calls/call-normal-001',
                },
            };

            // Mock getCall to return the call data
            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: 'call-normal-001',
                    direction: 'incoming',
                    status: 'completed',
                    duration: 60,
                    participants: ['+15551234567', '+15559876543'],
                    phoneNumberId: 'pn-456',
                    userId: 'user-789',
                    createdAt: '2025-01-15T15:00:00Z',
                    answeredAt: '2025-01-15T15:00:05Z',
                },
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { name: 'Sales Line', number: '+15559876543' },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'John', lastName: 'Doe' },
            });

            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-normal' } },
            });

            // Act
            await integration._handleQuoCallEvent(webhookData);

            // Assert - Handler ALWAYS calls getCall() now (simplified logic)
            expect(mockQuoApi.api.getCall).toHaveBeenCalledWith('call-normal-001');

            // Assert - Used correct contact phone from getCall result
            expect(integration._findAttioContactFromQuoWebhook).toHaveBeenCalledWith('+15551234567');
        });

        it('should handle API error when fetching call details', async () => {
            // Arrange - Domain Event: getCall fails (could have empty or populated participants)
            // NOTE: With refactoring, handler ALWAYS calls getCall(), so error can happen anytime
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'call-fetch-error',
                        direction: 'incoming',
                        status: 'no-answer',
                        participants: [], // Doesn't matter, getCall is always called
                        phoneNumberId: 'pn-456',
                        userId: 'user-789',
                        createdAt: '2025-01-15T16:00:00Z',
                    },
                    deepLink: 'https://app.openphone.com/calls/call-fetch-error',
                },
            };

            // Mock getCall to return null/undefined (call not found)
            mockQuoApi.api.getCall.mockResolvedValue({ data: null });

            // Act
            const result = await integration._handleQuoCallEvent(webhookData);

            // Assert - Should return error result, not throw
            expect(result.logged).toBe(false);
            expect(result.error).toBe('Call not found');
        });
    });
});
