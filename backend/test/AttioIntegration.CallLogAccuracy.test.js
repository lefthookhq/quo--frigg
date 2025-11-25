/**
 * Call Log Accuracy Tests - TDD Implementation
 *
 * Tests for accurate call log details based on real webhook payloads:
 * 1. Completed calls with answeredAt: null should be marked as missed
 * 2. Voicemail URLs should be included as clickable markdown links
 *
 * Following DDD and Hexagonal Architecture:
 * - Domain logic is isolated in handlers
 * - External dependencies (Attio API, Quo API) are mocked at the ports
 * - Business rules are tested independently of infrastructure
 *
 * Test Structure:
 * - Arrange: Set up webhook data matching REAL v3 API structure
 * - Act: Call the handler method
 * - Assert: Verify correct behavior and accurate data transformations
 */

const AttioIntegration = require('../src/integrations/AttioIntegration');
const { mockGetCall, mockGetPhoneNumber, mockGetUser } = require('./fixtures/quo-api-responses');

describe('AttioIntegration - Call Log Accuracy (TDD)', () => {
    let integration;
    let mockAttioApi;
    let mockQuoApi;
    let mockCommands;

    beforeEach(() => {
        // Mock Attio API (hexagonal port)
        mockAttioApi = {
            api: {
                createNote: jest.fn(),
                deleteNote: jest.fn(),
                getRecord: jest.fn(),
            },
        };

        // Mock Quo API (hexagonal port)
        mockQuoApi = {
            api: {
                getCall: jest.fn(),
                getCallRecordings: jest.fn(),
                getCallVoicemails: jest.fn(),
                getPhoneNumber: jest.fn(),
                getUser: jest.fn(),
            },
        };

        // Mock commands (hexagonal port)
        mockCommands = {
            updateIntegrationConfig: jest.fn().mockResolvedValue({}),
        };

        // Create integration instance (hexagonal core)
        integration = new AttioIntegration({
            userId: 'test-user',
            id: 'test-integration-id',
        });

        // Inject mocks at the ports
        integration.attio = mockAttioApi;
        integration.quo = mockQuoApi;
        integration.commands = mockCommands;
        integration.config = {
            quoCallWebhookKey: 'test-key',
            phoneNumbersMetadata: [
                { number: '+15551234567', name: 'Sales Line' }, // Match mockGetPhoneNumber.salesLine
                { number: '+15552468135', name: 'Support Line' }, // Match mockGetPhoneNumber.supportLine
            ],
        };

        // Mock mapping methods (infrastructure)
        integration.upsertMapping = jest.fn().mockResolvedValue({});
        integration.getMapping = jest.fn().mockResolvedValue(null);
        integration._findAttioContactFromQuoWebhook = jest
            .fn()
            .mockResolvedValue('attio-contact-123');

        // Mock Attio getRecord (required for logCallToActivity)
        mockAttioApi.api.getRecord.mockResolvedValue({
            data: {
                id: { record_id: 'attio-contact-123' },
                values: {
                    name: [{ value: 'Test Contact' }],
                },
            },
        });
    });

    describe('Domain Rule: Completed Calls with answeredAt: null (REAL v3 API)', () => {
        it('should detect completed call with answeredAt: null as missed call', async () => {
            // Arrange - Domain Event: REAL webhook payload from user
            // Status is "completed" BUT answeredAt is null = MISSED CALL
            const webhookData = {
                id: 'EV_EXAMPLE_EVENT_001',
                object: 'event',
                apiVersion: 'v3',
                type: 'call.completed',
                data: {
                    object: {
                        id: 'AC_EXAMPLE_MISSED_CALL_001',
                        from: '+16036644141',
                        to: '+17786544283',
                        direction: 'incoming',
                        status: 'completed', // ⚠️ Status is "completed"
                        answeredAt: null, // ❌ But NOT answered - this is MISSED
                        answeredBy: null,
                        completedAt: '2025-11-25T05:14:12+00:00',
                        duration: 0,
                        voicemail: {
                            url: 'https://files.openphone.co/dev/g/d3d0299416a54cbfaa8ef4dc64840e4b.mp3',
                            duration: 11,
                        },
                    },
                    deepLink: 'https://app.openphone.com/calls/AC_EXAMPLE_MISSED_CALL_001',
                },
            };

            // Transform v3 structure to expected format
            const transformedWebhookData = {
                type: webhookData.type,
                data: {
                    object: {
                        ...webhookData.data.object,
                        participants: [
                            webhookData.data.object.from,
                            webhookData.data.object.to,
                        ],
                        phoneNumberId: 'pn-test',
                        userId: 'user-test',
                        createdAt: webhookData.data.object.completedAt,
                    },
                    deepLink: webhookData.data.deepLink,
                },
            };

            // Mock getCall to return the call data (handler now ALWAYS fetches call)
            mockQuoApi.api.getCall.mockResolvedValue({
                data: transformedWebhookData.data.object,
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue(mockGetPhoneNumber.salesLine);
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.johnSmith);

            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-answered-null' } },
            });

            // Act
            await integration._handleQuoCallEvent(transformedWebhookData);

            // Assert - Should be logged as MISSED, not answered
            const noteContent = mockAttioApi.api.createNote.mock.calls[0][0].content;
            expect(noteContent).toContain('Incoming missed');
            expect(noteContent).not.toContain('Incoming answered by');
            expect(noteContent).toContain('➿ Voicemail (0:11)');
            expect(noteContent).toContain(
                '[Listen to voicemail](https://files.openphone.co/dev/g/d3d0299416a54cbfaa8ef4dc64840e4b.mp3)',
            );
        });

        it('should detect completed call WITH answeredAt timestamp as answered call', async () => {
            // Arrange - Domain Event: Completed and actually answered
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'call-answered-001',
                        direction: 'incoming',
                        status: 'completed',
                        duration: 120,
                        participants: ['+15551234567', '+15559876543'],
                        phoneNumberId: 'pn-456',
                        userId: 'user-789',
                        createdAt: '2025-01-15T10:30:00Z',
                        answeredAt: '2025-01-15T10:30:05Z', // ✅ Actually answered
                        answeredBy: 'user-789',
                    },
                    deepLink: 'https://app.openphone.com/calls/call-answered-001',
                },
            };

            // Mock getCall to return the call data
            mockQuoApi.api.getCall.mockResolvedValue({
                data: webhookData.data.object,
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue(mockGetPhoneNumber.salesLine);
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.janeDoe);

            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-answered-123' } },
            });

            // Act
            await integration._handleQuoCallEvent(webhookData);

            // Assert - Should be logged as ANSWERED
            const noteContent = mockAttioApi.api.createNote.mock.calls[0][0].content;
            expect(noteContent).toContain('Incoming answered by Jane Doe'); // Updated to match mockGetUser.janeDoe
            expect(noteContent).not.toContain('Incoming missed');
            expect(noteContent).toContain('▶️ Recording (2:00)');
        });

        it('should handle outgoing completed call with answeredAt: null as unanswered', async () => {
            // Arrange - Domain Event: Outgoing call not answered
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'call-outgoing-no-answer',
                        direction: 'outgoing',
                        status: 'completed',
                        duration: 0,
                        participants: ['+15559876543', '+15551234567'],
                        phoneNumberId: 'pn-456',
                        userId: 'user-789',
                        createdAt: '2025-01-15T11:00:00Z',
                        answeredAt: null, // Not answered
                        answeredBy: null,
                    },
                    deepLink: 'https://app.openphone.com/calls/call-outgoing-no-answer',
                },
            };

            // Mock getCall to return the call data
            mockQuoApi.api.getCall.mockResolvedValue({
                data: webhookData.data.object,
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue(mockGetPhoneNumber.salesLine);
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.johnSmith);

            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-outgoing-no-answer' } },
            });

            // Act
            await integration._handleQuoCallEvent(webhookData);

            // Assert - Should indicate call not answered
            const noteContent = mockAttioApi.api.createNote.mock.calls[0][0].content;
            // For outgoing calls with answeredAt: null, we might show "Outgoing (not answered)" or similar
            expect(noteContent).toContain('Outgoing');
            expect(noteContent).not.toContain('Recording');
        });
    });

    describe('Domain Rule: Voicemail URL Accuracy (REAL v3 API)', () => {
        it('should include voicemail URL as clickable markdown link in note', async () => {
            // Arrange - Domain Event: Voicemail with real v3 URL structure
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'call-vm-real',
                        direction: 'incoming',
                        status: 'no-answer',
                        duration: 0,
                        participants: ['+15551234567', '+15559876543'],
                        phoneNumberId: 'pn-456',
                        userId: 'user-789',
                        createdAt: '2025-01-15T12:00:00Z',
                        answeredAt: null,
                        voicemail: {
                            url: 'https://files.openphone.co/dev/g/d3d0299416a54cbfaa8ef4dc64840e4b.mp3',
                            duration: 11,
                        },
                    },
                    deepLink: 'https://app.openphone.com/calls/call-vm-real',
                },
            };

            // Mock getCall to return the call data
            mockQuoApi.api.getCall.mockResolvedValue({
                data: webhookData.data.object,
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue(mockGetPhoneNumber.supportLine);
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.janeDoe);

            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-vm-real' } },
            });

            // Act
            await integration._handleQuoCallEvent(webhookData);

            // Assert - Voicemail URL must be clickable markdown link
            const noteContent = mockAttioApi.api.createNote.mock.calls[0][0].content;
            expect(noteContent).toContain('Incoming missed');
            expect(noteContent).toContain('➿ Voicemail (0:11)');
            expect(noteContent).toContain(
                '[Listen to voicemail](https://files.openphone.co/dev/g/d3d0299416a54cbfaa8ef4dc64840e4b.mp3)',
            );
            expect(noteContent).toContain('[View the call activity in Quo]');
        });

        it('should handle voicemail without URL gracefully', async () => {
            // Arrange - Domain Event: Voicemail metadata without URL
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'call-vm-no-url',
                        direction: 'incoming',
                        status: 'no-answer',
                        duration: 0,
                        participants: ['+15551234567', '+15559876543'],
                        phoneNumberId: 'pn-456',
                        userId: 'user-789',
                        createdAt: '2025-01-15T13:00:00Z',
                        answeredAt: null,
                        voicemail: {
                            duration: 15,
                            // url field missing or null
                        },
                    },
                    deepLink: 'https://app.openphone.com/calls/call-vm-no-url',
                },
            };

            // Mock getCall to return the call data
            mockQuoApi.api.getCall.mockResolvedValue({
                data: webhookData.data.object,
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue(mockGetPhoneNumber.salesLine);
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.johnSmith);

            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-vm-no-url' } },
            });

            // Act
            await integration._handleQuoCallEvent(webhookData);

            // Assert - Should show voicemail indicator but no broken link
            const noteContent = mockAttioApi.api.createNote.mock.calls[0][0].content;
            expect(noteContent).toContain('Incoming missed');
            expect(noteContent).toContain('➿ Voicemail (0:15)');
            expect(noteContent).not.toContain('[Listen to voicemail]');
            expect(noteContent).toContain('[View the call activity in Quo]');
        });
    });

    describe('Infrastructure: v3 API Compatibility', () => {
        it('should handle v3 API structure with from/to fields', async () => {
            // Arrange - Domain Event: Real v3 webhook with from/to instead of participants array
            const v3Webhook = {
                id: 'EV123',
                object: 'event',
                apiVersion: 'v3',
                type: 'call.completed',
                data: {
                    object: {
                        id: 'AC123',
                        from: '+15551234567',
                        to: '+15559876543',
                        direction: 'incoming',
                        status: 'completed',
                        answeredAt: '2025-01-15T14:00:00Z',
                        completedAt: '2025-01-15T14:02:00Z',
                        duration: 120,
                    },
                    deepLink: 'https://app.openphone.com/calls/AC123',
                },
            };

            // Transform to expected format (this would happen in webhook router)
            const transformedWebhook = {
                type: v3Webhook.type,
                data: {
                    object: {
                        ...v3Webhook.data.object,
                        participants: [v3Webhook.data.object.from, v3Webhook.data.object.to],
                        phoneNumberId: 'pn-test',
                        userId: 'user-test',
                        createdAt: v3Webhook.data.object.completedAt,
                    },
                    deepLink: v3Webhook.data.deepLink,
                },
            };

            // Mock getCall to return the call data
            mockQuoApi.api.getCall.mockResolvedValue({
                data: transformedWebhook.data.object,
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue(mockGetPhoneNumber.salesLine);
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.johnSmith);

            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-v3' } },
            });

            // Act
            await integration._handleQuoCallEvent(transformedWebhook);

            // Assert - Should process correctly
            expect(mockAttioApi.api.createNote).toHaveBeenCalled();
            const noteContent = mockAttioApi.api.createNote.mock.calls[0][0].content;
            expect(noteContent).toContain('Incoming answered by John Smith'); // Updated to match mockGetUser.johnSmith
        });
    });
});
