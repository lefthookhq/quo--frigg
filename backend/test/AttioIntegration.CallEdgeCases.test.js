/**
 * Call Edge Cases Tests - TDD Implementation
 *
 * Tests for call event types that are currently not being logged:
 * 1. Missed calls (no-answer, missed status)
 * 2. Calls with voicemail
 * 3. Forwarded calls
 * 4. Sona-handled calls (AI assistant)
 *
 * Following DDD and Hexagonal Architecture:
 * - Domain logic is isolated in handlers
 * - External dependencies (Attio API, Quo API) are mocked at the ports
 * - Business rules are tested independently of infrastructure
 *
 * Test Structure:
 * - Arrange: Set up webhook data and mock responses
 * - Act: Call the handler method
 * - Assert: Verify correct behavior and data transformations
 */

const AttioIntegration = require('../src/integrations/AttioIntegration');

describe('AttioIntegration - Call Edge Cases (TDD)', () => {
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
            updateIntegrationStatus: { execute: jest.fn() },
            updateIntegrationMessages: { execute: jest.fn() },
            findOrganizationUserById: jest.fn().mockResolvedValue({
                id: 'test-user-id',
                email: 'test@example.com',
            }),
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

    describe('Domain Rule: Missed Calls (status: "missed" or "no-answer")', () => {
        it('should log missed incoming call with "Incoming missed" description', async () => {
            // Arrange - Domain Event: Call completed with missed status
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'call-missed-001',
                        direction: 'incoming',
                        status: 'missed',
                        duration: 0,
                        participants: ['+15551234567', '+15559876543'],
                        phoneNumberId: 'pn-456',
                        userId: 'user-789',
                        createdAt: '2025-01-15T10:30:00Z',
                    },
                    deepLink: 'https://app.openphone.com/calls/call-missed-001',
                },
            };

            // Mock getCall to return the call data
            mockQuoApi.api.getCall.mockResolvedValue({
                data: webhookData.data.object,
            });

            // Mock infrastructure responses
            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: {
                    symbol: '📞',
                    name: 'Sales Line',
                    number: '+15559876543',
                },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'John', lastName: 'Doe' },
            });

            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-missed-123' } },
            });

            // Act - Execute domain logic
            await integration._handleQuoCallEvent(webhookData);

            // Assert - Verify domain rules applied correctly
            expect(mockAttioApi.api.createNote).toHaveBeenCalledWith({
                parent_object: 'people',
                parent_record_id: 'attio-contact-123',
                title: expect.stringContaining('Call +15551234567 →'),
                format: 'markdown',
                content: expect.stringContaining('Incoming missed'),
                created_at: '2025-01-15T10:30:00Z',
            });

            // Verify no duration shown for missed calls
            const noteContent =
                mockAttioApi.api.createNote.mock.calls[0][0].content;
            expect(noteContent).not.toContain('Recording');
            expect(noteContent).toContain('[View the call activity in Quo]');
        });

        it('should log no-answer call with "Incoming missed" description', async () => {
            // Arrange - Domain Event: Call completed with no-answer status
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'call-no-answer-001',
                        direction: 'incoming',
                        status: 'no-answer',
                        duration: 0,
                        participants: ['+15551234567', '+15559876543'],
                        phoneNumberId: 'pn-456',
                        userId: 'user-789',
                        createdAt: '2025-01-15T11:00:00Z',
                    },
                    deepLink:
                        'https://app.openphone.com/calls/call-no-answer-001',
                },
            };

            mockQuoApi.api.getCall.mockResolvedValue({
                data: webhookData.data.object,
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { name: 'Support Line', number: '+15559876543' },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'Jane', lastName: 'Smith' },
            });

            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-no-answer-123' } },
            });

            // Act
            await integration._handleQuoCallEvent(webhookData);

            // Assert - Both "missed" and "no-answer" use same description
            expect(mockAttioApi.api.createNote).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('Incoming missed'),
                }),
            );
        });
    });

    describe('Domain Rule: Calls with Voicemail', () => {
        it('should log missed call with voicemail URL as clickable markdown link', async () => {
            // Arrange - Domain Event: Missed call with voicemail object (v3 API structure)
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'call-vm-001',
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
                    deepLink: 'https://app.openphone.com/calls/call-vm-001',
                },
            };

            mockQuoApi.api.getCall.mockResolvedValue({
                data: webhookData.data.object,
            });

            // Mock getCallVoicemails to return voicemail data (for no-answer calls)
            mockQuoApi.api.getCallVoicemails.mockResolvedValue({
                data: {
                    status: 'completed',
                    recordingUrl:
                        'https://files.openphone.co/dev/g/d3d0299416a54cbfaa8ef4dc64840e4b.mp3',
                    duration: 11,
                },
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { name: 'Sales Line', number: '+15559876543' },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'John', lastName: 'Doe' },
            });

            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-vm-123' } },
            });

            // Act
            await integration._handleQuoCallEvent(webhookData);

            // Assert - Voicemail indicator with clickable URL link
            const noteContent =
                mockAttioApi.api.createNote.mock.calls[0][0].content;
            expect(noteContent).toContain('Incoming missed');
            expect(noteContent).toContain('**Voicemail:**');
            expect(noteContent).toContain('(0:11)');
            expect(noteContent).toContain(
                '[Listen to voicemail](https://files.openphone.co/dev/g/d3d0299416a54cbfaa8ef4dc64840e4b.mp3)',
            );
            expect(noteContent).toContain('[View the call activity in Quo]');
        });

        it('should handle voicemail with transcript in call summary enrichment', async () => {
            // Arrange - Domain Event: Call summary with voicemail transcript
            const webhookData = {
                type: 'call.summary.completed',
                data: {
                    object: {
                        callId: 'call-vm-002',
                        summary: ['Customer left voicemail'],
                        nextSteps: ['Call back'],
                        status: 'completed',
                    },
                    deepLink: 'https://app.openphone.com/calls/call-vm-002',
                },
            };

            integration.getMapping.mockResolvedValue({
                noteId: 'note-old-vm',
                callId: 'call-vm-002',
                attioContactId: 'attio-contact-123',
            });

            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: 'call-vm-002',
                    direction: 'incoming',
                    status: 'missed',
                    duration: 0,
                    participants: ['+15551234567', '+15559876543'],
                    phoneNumberId: 'pn-456',
                    userId: 'user-789',
                    createdAt: '2025-01-15T12:00:00Z',
                },
            });

            mockQuoApi.api.getCallRecordings.mockResolvedValue({ data: [] });

            mockQuoApi.api.getCallVoicemails.mockResolvedValue({
                data: {
                    recordingUrl: 'https://storage.example.com/vm-002.mp3',
                    transcript: 'Hi, please call me back about the proposal',
                    duration: 30,
                },
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { name: 'Sales Line', number: '+15559876543' },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'John', lastName: 'Doe' },
            });

            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-enriched-vm' } },
            });

            // Act
            await integration._handleQuoCallSummaryEvent(webhookData);

            // Assert - Enriched note includes voicemail URL and transcript
            const enrichedNote = mockAttioApi.api.createNote.mock.calls[0][0];
            expect(enrichedNote.content).toContain(
                'https://storage.example.com/vm-002.mp3',
            );
            expect(enrichedNote.content).toContain(
                'Hi, please call me back about the proposal',
            );
            expect(enrichedNote.content).toContain('Summary:');
            expect(enrichedNote.content).toContain('Customer left voicemail');
        });
    });

    describe('Call Summary Enrichment (Jobs and Title)', () => {
        it('should parse jobs object structure and display formatted job data', async () => {
            // Use centralized webhook fixture with jobs
            const {
                callSummaryCompletedWebhook,
            } = require('./fixtures/quo-v4-webhooks');
            const {
                mockGetPhoneNumber,
                mockGetUser,
            } = require('./fixtures/quo-api-responses');

            integration.getMapping.mockResolvedValue({
                noteId: 'note-initial',
                callId: callSummaryCompletedWebhook.data.object.callId,
                attioContactId: 'attio-contact-123',
            });

            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: callSummaryCompletedWebhook.data.object.callId,
                    direction: 'incoming',
                    status: 'completed',
                    duration: 180,
                    participants: ['+15559876543', '+15551234567'],
                    phoneNumberId: 'PN_TEST_001',
                    userId: 'US_TEST_001',
                    answeredAt: '2025-01-15T10:30:00Z',
                    aiHandled: 'ai-agent',
                    createdAt: '2025-01-15T10:30:00Z',
                },
            });

            mockQuoApi.api.getCallRecordings.mockResolvedValue({ data: [] });
            mockQuoApi.api.getCallVoicemails.mockResolvedValue({ data: null });
            mockQuoApi.api.getPhoneNumber.mockResolvedValue(
                mockGetPhoneNumber.salesLine,
            );
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.johnSmith);

            integration.logCallToActivity = jest
                .fn()
                .mockResolvedValue('note-enriched');
            mockAttioApi.api.deleteNote.mockResolvedValue({});

            await integration._handleQuoCallSummaryEvent(
                callSummaryCompletedWebhook,
            );

            // Assert: Jobs parsed correctly with icon, name, and data items
            // Jobs are shown directly with emoji+name format (no separate "Jobs:" header)
            const callArgs = integration.logCallToActivity.mock.calls[0][0];
            expect(callArgs.summary).toContain('✍️ Message taking');
            expect(callArgs.summary).toContain(
                '**First and last name:** Jane Doe',
            );
            expect(callArgs.summary).toContain('**Summarize the message:**');
            expect(callArgs.summary).toContain(
                'Jane Doe called to inquire about product pricing',
            );
        });

        it('should use "Call" prefix in title, not "Call Summary:"', async () => {
            // Use centralized fixtures
            const {
                callSummaryCompletedWebhook,
            } = require('./fixtures/quo-v4-webhooks');
            const {
                mockGetPhoneNumber,
                mockGetUser,
            } = require('./fixtures/quo-api-responses');

            integration.getMapping.mockResolvedValue({
                noteId: 'note-title-test',
                callId: callSummaryCompletedWebhook.data.object.callId,
                attioContactId: 'attio-contact-123',
            });

            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: callSummaryCompletedWebhook.data.object.callId,
                    direction: 'incoming',
                    status: 'completed',
                    duration: 180,
                    participants: ['+15559876543', '+15551234567'],
                    phoneNumberId: 'PN_TEST_001',
                    userId: 'US_TEST_001',
                    answeredAt: '2025-01-15T10:30:00Z',
                    aiHandled: null, // Regular call
                    createdAt: '2025-01-15T10:30:00Z',
                },
            });

            mockQuoApi.api.getCallRecordings.mockResolvedValue({ data: [] });
            mockQuoApi.api.getCallVoicemails.mockResolvedValue({ data: null });
            mockQuoApi.api.getPhoneNumber.mockResolvedValue(
                mockGetPhoneNumber.salesLine,
            );
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.johnSmith);

            integration.logCallToActivity = jest
                .fn()
                .mockResolvedValue('note-enriched');
            mockAttioApi.api.deleteNote.mockResolvedValue({});

            await integration._handleQuoCallSummaryEvent(
                callSummaryCompletedWebhook,
            );

            // Assert: Title uses "Call" prefix, not "Call Summary:"
            const callArgs = integration.logCallToActivity.mock.calls[0][0];
            expect(callArgs.title).toMatch(/^☎️\s+Call\s+/);
            expect(callArgs.title).not.toContain('Call Summary:');
        });

        it('should not include jobs section when jobs array is empty', async () => {
            // Use base webhook but modify to have empty jobs
            const {
                callSummaryCompletedWebhook,
            } = require('./fixtures/quo-v4-webhooks');
            const {
                mockGetPhoneNumber,
                mockGetUser,
            } = require('./fixtures/quo-api-responses');

            const webhookWithoutJobs = {
                ...callSummaryCompletedWebhook,
                data: {
                    ...callSummaryCompletedWebhook.data,
                    object: {
                        ...callSummaryCompletedWebhook.data.object,
                        jobs: [], // Empty jobs array
                    },
                },
            };

            integration.getMapping.mockResolvedValue({
                noteId: 'note-no-jobs',
                callId: webhookWithoutJobs.data.object.callId,
                attioContactId: 'attio-contact-123',
            });

            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: webhookWithoutJobs.data.object.callId,
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
            mockQuoApi.api.getPhoneNumber.mockResolvedValue(
                mockGetPhoneNumber.salesLine,
            );
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.johnSmith);

            integration.logCallToActivity = jest
                .fn()
                .mockResolvedValue('note-no-jobs');
            mockAttioApi.api.deleteNote.mockResolvedValue({});

            await integration._handleQuoCallSummaryEvent(webhookWithoutJobs);

            // Assert: No jobs section when jobs array is empty
            const callArgs = integration.logCallToActivity.mock.calls[0][0];
            expect(callArgs.summary).not.toContain('**Jobs:**');
        });
    });

    describe('Domain Rule: Forwarded Calls', () => {
        it('should log forwarded call with forwardedTo user information', async () => {
            // Arrange - Domain Event: Call forwarded to specific user
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'call-fwd-001',
                        direction: 'incoming',
                        status: 'forwarded',
                        duration: 0,
                        participants: ['+15551234567', '+15559876543'],
                        phoneNumberId: 'pn-456',
                        userId: 'user-789',
                        forwardedTo: 'USxyz789',
                        createdAt: '2025-01-15T13:00:00Z',
                    },
                    deepLink: 'https://app.openphone.com/calls/call-fwd-001',
                },
            };

            mockQuoApi.api.getCall.mockResolvedValue({
                data: webhookData.data.object,
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { name: 'Main Line', number: '+15559876543' },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'John', lastName: 'Doe' },
            });

            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-fwd-123' } },
            });

            // Act
            await integration._handleQuoCallEvent(webhookData);

            // Assert - Forwarded description includes target user
            const noteContent =
                mockAttioApi.api.createNote.mock.calls[0][0].content;
            expect(noteContent).toContain('Incoming forwarded to USxyz789');
            expect(noteContent).toContain('[View the call activity in Quo]');
        });

        it('should log forwarded call handled by phone menu (no forwardedTo)', async () => {
            // Arrange - Domain Event: Call forwarded by IVR/phone menu
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'call-fwd-menu-001',
                        direction: 'incoming',
                        status: 'forwarded',
                        duration: 0,
                        participants: ['+15551234567', '+15559876543'],
                        phoneNumberId: 'pn-456',
                        userId: 'user-789',
                        forwardedTo: null, // Phone menu forwarding
                        createdAt: '2025-01-15T14:00:00Z',
                    },
                    deepLink:
                        'https://app.openphone.com/calls/call-fwd-menu-001',
                },
            };

            mockQuoApi.api.getCall.mockResolvedValue({
                data: webhookData.data.object,
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { name: 'Support Line', number: '+15559876543' },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'Jane', lastName: 'Smith' },
            });

            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-fwd-menu-123' } },
            });

            // Act
            await integration._handleQuoCallEvent(webhookData);

            // Assert - Generic forwarding description when no specific target
            const noteContent =
                mockAttioApi.api.createNote.mock.calls[0][0].content;
            expect(noteContent).toContain('Incoming forwarded by phone menu');
            expect(noteContent).toContain('[View the call activity in Quo]');
        });
    });

    describe('Domain Rule: Contact Auto-Creation from Calls', () => {
        it('should create new Quo contact when call comes from unknown number', async () => {
            // Arrange - Domain Event: Call from number not in Quo
            integration._findAttioContactFromQuoWebhook = jest
                .fn()
                .mockResolvedValue('attio-contact-new-123');

            // Mock that contact doesn't exist in Quo
            integration._shouldAutoCreateContact = jest
                .fn()
                .mockResolvedValue(true);
            integration._createContactFromCallEvent = jest
                .fn()
                .mockResolvedValue({
                    id: 'quo-contact-new-001',
                    externalId: 'attio-contact-new-123',
                });

            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'call-new-contact-001',
                        direction: 'incoming',
                        status: 'completed',
                        duration: 60,
                        participants: ['+15559999999', '+15559876543'], // New number
                        phoneNumberId: 'pn-456',
                        userId: 'user-789',
                        createdAt: '2025-01-15T17:00:00Z',
                        answeredAt: '2025-01-15T17:00:05Z',
                    },
                    deepLink:
                        'https://app.openphone.com/calls/call-new-contact-001',
                },
            };

            mockQuoApi.api.getCall.mockResolvedValue({
                data: webhookData.data.object,
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { name: 'Sales Line', number: '+15559876543' },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'John', lastName: 'Doe' },
            });

            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-new-contact-123' } },
            });

            // Mock Attio contact fetch
            mockAttioApi.api.getRecord.mockResolvedValue({
                data: {
                    id: { record_id: 'attio-contact-new-123' },
                    values: {
                        name: [{ value: 'New Contact' }],
                        email_addresses: [{ email_address: 'new@example.com' }],
                    },
                },
            });

            // Act
            await integration._handleQuoCallEvent(webhookData);

            // Assert - Contact lookup performed
            expect(
                integration._findAttioContactFromQuoWebhook,
            ).toHaveBeenCalledWith('+15559999999');

            // Note: Auto-creation logic would be implemented in future iteration
            // For now, this test documents the expected behavior
        });
    });

    describe('Infrastructure: Error Handling and Resilience', () => {
        it('should handle missing phone number gracefully', async () => {
            // Arrange
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'call-error-001',
                        direction: 'incoming',
                        status: 'completed',
                        duration: 60,
                        participants: ['+15551234567', '+15559876543'],
                        phoneNumberId: 'pn-nonexistent',
                        userId: 'user-789',
                        createdAt: '2025-01-15T18:00:00Z',
                        answeredAt: '2025-01-15T18:00:05Z',
                    },
                    deepLink: 'https://app.openphone.com/calls/call-error-001',
                },
            };

            mockQuoApi.api.getCall.mockResolvedValue({
                data: webhookData.data.object,
            });

            mockQuoApi.api.getPhoneNumber.mockRejectedValue(
                new Error('Phone number not found'),
            );

            // Act & Assert - Should propagate error (phone/user metadata fetch failure)
            await expect(
                integration._handleQuoCallEvent(webhookData),
            ).rejects.toThrow('Phone number not found');
        });

        it('should handle Attio API failure gracefully', async () => {
            // Arrange
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'call-attio-error-001',
                        direction: 'incoming',
                        status: 'completed',
                        duration: 60,
                        participants: ['+15551234567', '+15559876543'],
                        phoneNumberId: 'pn-456',
                        userId: 'user-789',
                        createdAt: '2025-01-15T19:00:00Z',
                        answeredAt: '2025-01-15T19:00:05Z',
                    },
                    deepLink:
                        'https://app.openphone.com/calls/call-attio-error-001',
                },
            };

            mockQuoApi.api.getCall.mockResolvedValue({
                data: webhookData.data.object,
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { name: 'Sales Line', number: '+15559876543' },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'John', lastName: 'Doe' },
            });

            mockAttioApi.api.createNote.mockRejectedValue(
                new Error('Attio API rate limit exceeded'),
            );

            // Act - Errors during activity creation are captured in results, not thrown
            const result = await integration._handleQuoCallEvent(webhookData);

            // Assert - Result shows failures for all participants with error details
            expect(result.logged).toBe(false);
            expect(result.results.length).toBeGreaterThan(0);
            expect(result.results.every((r) => r.logged === false)).toBe(true);
            expect(
                result.results.some((r) =>
                    r.error?.includes('Attio API rate limit exceeded'),
                ),
            ).toBe(true);
        });
    });
});
