/**
 * Call Summary Enrichment Feature Tests
 *
 * Tests the 3-phase call activity logging workflow:
 * Phase 1: call.completed → Create initial note with basic call info + store mapping
 * Phase 2: call.summary.completed → Fetch recordings/voicemails
 * Phase 3: Update/recreate note with enriched summary
 *
 * Integrations:
 * - Attio: delete old note + create new note (no update API)
 * - AxisCare: update existing call log (has update API)
 * - Zoho CRM: update existing note (has update API)
 * - Pipedrive: update existing note (has update API)
 *
 * Safety: ALWAYS create new before deleting old to prevent data loss
 */

const AttioIntegration = require('../src/integrations/AttioIntegration');
const AxisCareIntegration = require('../src/integrations/AxisCareIntegration');

// Import centralized mock fixtures
const {
    mockGetPhoneNumber,
    mockGetUser,
    mockGetCall,
    mockGetCallRecordings,
    mockGetCallVoicemails,
} = require('./fixtures/quo-api-responses');

describe('Call Summary Enrichment - Attio Integration', () => {
    let integration;
    let mockAttioApi;
    let mockQuoApi;
    let mockCommands;

    beforeEach(() => {
        // Mock Attio API
        mockAttioApi = {
            api: {
                createNote: jest.fn(),
                deleteNote: jest.fn(),
                getRecord: jest.fn(),
            },
        };

        // Mock Quo API
        mockQuoApi = {
            api: {
                getCall: jest.fn(),
                getCallRecordings: jest.fn(),
                getCallVoicemails: jest.fn(),
                getPhoneNumber: jest.fn(),
                getUser: jest.fn(),
            },
        };

        // Mock commands
        mockCommands = {
            updateIntegrationConfig: jest.fn().mockResolvedValue({}),
            findOrganizationUserById: jest.fn().mockResolvedValue({
                id: 'user-123',
                appOrgId: 'org-123',
            }),
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
            // Mark the Quo phone number as internal so only external contact is processed
            phoneNumbersMetadata: [
                { number: '+15551234567', name: 'Sales Line', type: 'internal' }
            ],
        };

        // Mock mapping methods
        integration.upsertMapping = jest.fn().mockResolvedValue({});
        integration.getMapping = jest.fn().mockResolvedValue(null);
    });

    describe('Phase 1: call.completed - Initial Note Creation', () => {
        it('should create initial note and store mapping with call ID -> note ID', async () => {
            // Arrange - use centralized fixtures
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: mockGetCall.completedIncoming.data,
                    deepLink: 'https://app.openphone.com/calls/AC_TEST_001',
                },
            };

            // Mock Quo API calls needed by processor
            mockQuoApi.api.getCall.mockResolvedValue(mockGetCall.completedIncoming);
            mockQuoApi.api.getCallVoicemails.mockResolvedValue({ data: [] });
            mockQuoApi.api.getPhoneNumber.mockResolvedValue(mockGetPhoneNumber.salesLine);
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.johnSmith);

            mockAttioApi.api.getRecord.mockResolvedValue({
                data: { id: { record_id: 'attio-contact-123' } },
            });

            mockAttioApi.api.createNote.mockResolvedValue({
                data: {
                    id: { note_id: 'note-abc123' },
                },
            });

            // Mock mapping lookup (no existing mapping)
            integration.getMapping.mockResolvedValue(null);

            // Mock _findAttioContactFromQuoWebhook to return the contact ID
            integration._findAttioContactFromQuoWebhook = jest
                .fn()
                .mockResolvedValue('attio-contact-123');

            // Act
            await integration._handleQuoCallEvent(webhookData);

            // Assert - Note created with basic info
            expect(mockAttioApi.api.createNote).toHaveBeenCalledWith({
                parent_object: 'people',
                parent_record_id: 'attio-contact-123',
                title: expect.stringContaining('Call'),
                format: 'markdown',
                content: expect.stringContaining('Incoming answered by John Smith'),
                created_at: mockGetCall.completedIncoming.data.createdAt,
            });

            // Assert - Mapping stored: call ID -> note ID (may be called multiple times for multiple participants)
            expect(integration.upsertMapping).toHaveBeenCalledWith(
                'AC_TEST_001',
                expect.objectContaining({
                    noteId: 'note-abc123',
                    callId: 'AC_TEST_001',
                    contactId: 'attio-contact-123',
                }),
            );
        });
    });

    describe('Phase 2: call.recording.completed - Enrich with Recordings', () => {
        it('should find existing note, create new note with recording, and delete old note', async () => {
            // Arrange
            const webhookData = {
                type: 'call.recording.completed',
                data: {
                    object: {
                        ...mockGetCall.completedIncoming.data,
                        // Recording is now available
                    },
                    deepLink: 'https://app.openphone.com/calls/AC_TEST_001',
                },
            };

            // Mock existing mapping from Phase 1 (uses contactId not attioContactId)
            integration.getMapping.mockResolvedValue({
                mapping: {
                    noteId: 'note-initial-123',
                    callId: 'AC_TEST_001',
                    contactId: 'attio-contact-123',
                },
            });

            mockQuoApi.api.getCall.mockResolvedValue(mockGetCall.completedIncoming);

            mockQuoApi.api.getCallRecordings.mockResolvedValue(
                mockGetCallRecordings.singleRecording
            );

            mockQuoApi.api.getCallVoicemails.mockResolvedValue({ data: null });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue(mockGetPhoneNumber.salesLine);

            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.johnSmith);

            mockAttioApi.api.getRecord.mockResolvedValue({
                data: { id: { record_id: 'attio-contact-123' } },
            });

            // Mock _findAttioContactFromQuoWebhook to return the contact ID
            integration._findAttioContactFromQuoWebhook = jest
                .fn()
                .mockResolvedValue('attio-contact-123');

            // New note with recording
            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-with-recording-456' } },
            });

            // Track call order
            const callOrder = [];
            mockAttioApi.api.createNote.mockImplementation(() => {
                callOrder.push('create');
                return Promise.resolve({ data: { id: { note_id: 'note-with-recording-456' } } });
            });
            mockAttioApi.api.deleteNote.mockImplementation(() => {
                callOrder.push('delete');
                return Promise.resolve({});
            });

            // Act
            await integration._handleQuoCallRecordingEvent(webhookData);

            // Assert - Create called BEFORE delete (safety first!)
            expect(callOrder).toEqual(['create', 'delete']);

            // Assert - New note includes recording link
            expect(mockAttioApi.api.createNote).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('▶️ Recording'),
                    content: expect.stringContaining('https://storage.example.com'),
                }),
            );

            // Assert - Old note deleted
            expect(mockAttioApi.api.deleteNote).toHaveBeenCalledWith('note-initial-123');

            // Assert - Mapping updated with new note ID
            expect(integration.upsertMapping).toHaveBeenCalledWith(
                'AC_TEST_001',
                expect.objectContaining({
                    noteId: 'note-with-recording-456',
                }),
            );
        });

        it('should create new note if no existing mapping found', async () => {
            // Arrange
            const webhookData = {
                type: 'call.recording.completed',
                data: {
                    object: mockGetCall.completedIncoming.data,
                    deepLink: 'https://app.openphone.com/calls/AC_TEST_001',
                },
            };

            // No existing mapping
            integration.getMapping.mockResolvedValue(null);

            mockQuoApi.api.getCall.mockResolvedValue(mockGetCall.completedIncoming);
            mockQuoApi.api.getCallRecordings.mockResolvedValue(
                mockGetCallRecordings.singleRecording
            );
            mockQuoApi.api.getCallVoicemails.mockResolvedValue({ data: null });
            mockQuoApi.api.getPhoneNumber.mockResolvedValue(mockGetPhoneNumber.salesLine);
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.johnSmith);
            mockAttioApi.api.getRecord.mockResolvedValue({
                data: { id: { record_id: 'attio-contact-123' } },
            });

            integration._findAttioContactFromQuoWebhook = jest
                .fn()
                .mockResolvedValue('attio-contact-123');

            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-new-789' } },
            });

            // Act
            await integration._handleQuoCallRecordingEvent(webhookData);

            // Assert - Created new note (no delete since no old note)
            expect(mockAttioApi.api.createNote).toHaveBeenCalled();
            expect(mockAttioApi.api.deleteNote).not.toHaveBeenCalled();

            // Assert - Mapping created
            expect(integration.upsertMapping).toHaveBeenCalledWith(
                'AC_TEST_001',
                expect.objectContaining({
                    noteId: 'note-new-789',
                }),
            );
        });

        it('should detect AI-handled calls (Sona) using aiHandled property', async () => {
            const webhookData = {
                type: 'call.recording.completed',
                data: {
                    object: mockGetCall.aiHandledCall.data,
                    deepLink: 'https://app.openphone.com/calls/AC_TEST_AI',
                },
            };

            integration.getMapping.mockResolvedValue({
                mapping: {
                    noteId: 'note-initial-ai',
                    callId: 'AC_TEST_AI',
                    attioContactId: 'attio-contact-123',
                },
            });

            mockQuoApi.api.getCall.mockResolvedValue(mockGetCall.aiHandledCall);
            mockQuoApi.api.getCallRecordings.mockResolvedValue(
                mockGetCallRecordings.singleRecording
            );
            mockQuoApi.api.getCallVoicemails.mockResolvedValue({ data: null });
            mockQuoApi.api.getPhoneNumber.mockResolvedValue(mockGetPhoneNumber.salesLine);
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.johnSmith);

            integration._findAttioContactFromQuoWebhook = jest
                .fn()
                .mockResolvedValue('attio-contact-123');

            integration.logCallToActivity = jest.fn().mockResolvedValue('note-ai-456');
            mockAttioApi.api.deleteNote.mockResolvedValue({});

            await integration._handleQuoCallRecordingEvent(webhookData);

            expect(integration.logCallToActivity).toHaveBeenCalledWith(
                expect.objectContaining({
                    summary: expect.stringContaining('Handled by Sona'),
                })
            );
        });
    });

    describe('Phase 3: call.summary.completed - Fetch Recordings/Voicemails', () => {
        it('should fetch call details, recordings, and voicemails when summary arrives', async () => {
            // Arrange
            const webhookData = {
                type: 'call.summary.completed',
                data: {
                    object: {
                        callId: 'call-123',
                        summary: [
                            'Customer inquired about pricing',
                            'Scheduled follow-up meeting',
                        ],
                        nextSteps: ['Send pricing proposal', 'Calendar invite'],
                        status: 'completed',
                    },
                    deepLink: 'https://app.openphone.com/calls/call-123',
                },
            };

            // Mock call details
            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: 'call-123',
                    direction: 'incoming',
                    status: 'completed',
                    duration: 180,
                    participants: ['+15551234567', '+15559876543'],
                    phoneNumberId: 'pn-456',
                    userId: 'user-789',
                    createdAt: '2025-01-15T10:30:00Z',
                },
            });

            // Mock recordings
            mockQuoApi.api.getCallRecordings.mockResolvedValue({
                data: [
                    {
                        id: 'rec-001',
                        url: 'https://storage.example.com/recording.mp3',
                        duration: 180,
                        status: 'completed',
                        type: 'audio/mpeg',
                    },
                ],
            });

            // Mock voicemails (empty)
            mockQuoApi.api.getCallVoicemails.mockResolvedValue({
                data: null,
            });

            // Mock existing mapping (from Phase 1)
            integration.getMapping.mockResolvedValue({
                noteId: 'note-abc123',
                callId: 'call-123',
                attioContactId: 'attio-contact-123',
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { symbol: '📞', name: 'Sales Line', number: '+15559876543' },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'John', lastName: 'Doe' },
            });

            mockAttioApi.api.getRecord.mockResolvedValue({
                data: { id: { record_id: 'attio-contact-123' } },
            });

            // Mock _findAttioContactFromQuoWebhook to return the contact ID
            integration._findAttioContactFromQuoWebhook = jest
                .fn()
                .mockResolvedValue('attio-contact-123');

            // Mock createNote for the enrichment flow
            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-enriched-123' } },
            });

            // Act
            await integration._handleQuoCallSummaryEvent(webhookData);

            // Assert - Call details fetched
            expect(mockQuoApi.api.getCall).toHaveBeenCalledWith('call-123');

            // Assert - Recordings fetched
            expect(mockQuoApi.api.getCallRecordings).toHaveBeenCalledWith('call-123');

            // Assert - Voicemails fetched
            expect(mockQuoApi.api.getCallVoicemails).toHaveBeenCalledWith('call-123');
        });
    });

    describe('Phase 3: Attio - Delete Old Note + Create New with Enriched Summary', () => {
        it('should create new enriched note BEFORE deleting old note (safety first)', async () => {
            // Arrange
            const webhookData = {
                type: 'call.summary.completed',
                data: {
                    object: {
                        callId: 'call-123',
                        summary: ['Customer inquired about pricing'],
                        nextSteps: ['Send proposal'],
                        status: 'completed',
                    },
                    deepLink: 'https://app.openphone.com/calls/call-123',
                },
            };

            // Mock existing mapping
            integration.getMapping.mockResolvedValue({
                noteId: 'note-old-123',
                callId: 'call-123',
                attioContactId: 'attio-contact-123',
            });

            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: 'call-123',
                    direction: 'incoming',
                    status: 'completed',
                    duration: 180,
                    participants: ['+15551234567', '+15559876543'],
                    phoneNumberId: 'pn-456',
                    userId: 'user-789',
                    createdAt: '2025-01-15T10:30:00Z',
                },
            });

            mockQuoApi.api.getCallRecordings.mockResolvedValue({
                data: [
                    {
                        url: 'https://storage.example.com/rec.mp3',
                        duration: 180,
                    },
                ],
            });

            mockQuoApi.api.getCallVoicemails.mockResolvedValue({ data: null });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { symbol: '📞', name: 'Sales', number: '+15559876543' },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'John', lastName: 'Doe' },
            });

            mockAttioApi.api.getRecord.mockResolvedValue({
                data: { id: { record_id: 'attio-contact-123' } },
            });

            // Mock _findAttioContactFromQuoWebhook to return the contact ID
            integration._findAttioContactFromQuoWebhook = jest
                .fn()
                .mockResolvedValue('attio-contact-123');

            // New note created
            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-new-456' } },
            });

            // Track call order
            const callOrder = [];
            mockAttioApi.api.createNote.mockImplementation(() => {
                callOrder.push('create');
                return Promise.resolve({ data: { id: { note_id: 'note-new-456' } } });
            });
            mockAttioApi.api.deleteNote.mockImplementation(() => {
                callOrder.push('delete');
                return Promise.resolve({});
            });

            // Act
            await integration._handleQuoCallSummaryEvent(webhookData);

            // Assert - Create called BEFORE delete
            expect(callOrder).toEqual(['create', 'delete']);

            // Assert - New note has enriched summary
            expect(mockAttioApi.api.createNote).toHaveBeenCalledWith(
                expect.objectContaining({
                    parent_object: 'people',
                    parent_record_id: 'attio-contact-123',
                    content: expect.stringMatching(/Summary:.*Customer inquired about pricing/s),
                }),
            );

            // Assert - New note includes recording link
            expect(mockAttioApi.api.createNote).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('https://storage.example.com/rec.mp3'),
                }),
            );

            // Assert - Old note deleted
            expect(mockAttioApi.api.deleteNote).toHaveBeenCalledWith('note-old-123');

            // Assert - Mapping updated with new note ID
            expect(integration.upsertMapping).toHaveBeenCalledWith(
                'call-123',
                expect.objectContaining({
                    noteId: 'note-new-456',
                    callId: 'call-123',
                }),
            );
        });

        it('should handle recording and voicemail URLs in note content', async () => {
            // Arrange
            const webhookData = {
                type: 'call.summary.completed',
                data: {
                    object: {
                        callId: 'call-123',
                        summary: ['Customer left voicemail'],
                        nextSteps: [],
                        status: 'completed',
                    },
                    deepLink: 'https://app.openphone.com/calls/call-123',
                },
            };

            integration.getMapping.mockResolvedValue({
                noteId: 'note-old-123',
                callId: 'call-123',
                attioContactId: 'attio-contact-123',
            });

            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: 'call-123',
                    direction: 'incoming',
                    status: 'missed',
                    duration: 0,
                    participants: ['+15551234567', '+15559876543'],
                    phoneNumberId: 'pn-456',
                    userId: 'user-789',
                    createdAt: '2025-01-15T10:30:00Z',
                },
            });

            // Mock both recordings and voicemails
            mockQuoApi.api.getCallRecordings.mockResolvedValue({
                data: [
                    {
                        url: 'https://storage.example.com/recording.mp3',
                        duration: 60,
                    },
                ],
            });

            mockQuoApi.api.getCallVoicemails.mockResolvedValue({
                data: {
                    recordingUrl: 'https://storage.example.com/voicemail.mp3',
                    transcript: 'Hi, this is a test voicemail',
                    duration: 45,
                },
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { name: 'Support', number: '+15559876543' },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'Jane', lastName: 'Smith' },
            });

            mockAttioApi.api.getRecord.mockResolvedValue({
                data: { id: { record_id: 'attio-contact-123' } },
            });

            // Mock _findAttioContactFromQuoWebhook to return the contact ID
            integration._findAttioContactFromQuoWebhook = jest
                .fn()
                .mockResolvedValue('attio-contact-123');

            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-new-789' } },
            });

            // Act
            await integration._handleQuoCallSummaryEvent(webhookData);

            // Assert - Note contains both recording and voicemail links
            const noteCall = mockAttioApi.api.createNote.mock.calls[0][0];
            expect(noteCall.content).toContain('https://storage.example.com/recording.mp3');
            expect(noteCall.content).toContain('https://storage.example.com/voicemail.mp3');
        });

        it('should keep old note if new note creation fails', async () => {
            // Arrange - Delete fails protection
            const webhookData = {
                type: 'call.summary.completed',
                data: {
                    object: {
                        callId: 'call-123',
                        summary: ['Test summary'],
                        nextSteps: [],
                        status: 'completed',
                    },
                    deepLink: 'https://app.openphone.com/calls/call-123',
                },
            };

            integration.getMapping.mockResolvedValue({
                noteId: 'note-old-123',
                callId: 'call-123',
                attioContactId: 'attio-contact-123',
            });

            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: 'call-123',
                    direction: 'incoming',
                    status: 'completed',
                    duration: 60,
                    participants: ['+15551234567', '+15559876543'],
                    phoneNumberId: 'pn-456',
                    userId: 'user-789',
                    createdAt: '2025-01-15T10:30:00Z',
                },
            });

            mockQuoApi.api.getCallRecordings.mockResolvedValue({ data: [] });
            mockQuoApi.api.getCallVoicemails.mockResolvedValue({ data: null });
            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { name: 'Line', number: '+15559876543' },
            });
            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'John', lastName: 'Doe' },
            });
            mockAttioApi.api.getRecord.mockResolvedValue({
                data: { id: { record_id: 'attio-contact-123' } },
            });

            // Mock _findAttioContactFromQuoWebhook to return the contact ID
            integration._findAttioContactFromQuoWebhook = jest
                .fn()
                .mockResolvedValue('attio-contact-123');

            // NEW NOTE CREATION FAILS
            mockAttioApi.api.createNote.mockRejectedValue(
                new Error('Attio API Error: 500'),
            );

            // Act & Assert - Should throw error and NOT delete old note
            await expect(
                integration._handleQuoCallSummaryEvent(webhookData),
            ).rejects.toThrow('Attio API Error: 500');

            // Assert - Delete was NEVER called (old note preserved)
            expect(mockAttioApi.api.deleteNote).not.toHaveBeenCalled();
        });

        it('should still succeed if delete fails after new note is created', async () => {
            // Arrange
            const webhookData = {
                type: 'call.summary.completed',
                data: {
                    object: {
                        callId: 'call-123',
                        summary: ['Summary'],
                        nextSteps: [],
                        status: 'completed',
                    },
                    deepLink: 'https://app.openphone.com/calls/call-123',
                },
            };

            integration.getMapping.mockResolvedValue({
                noteId: 'note-old-123',
                callId: 'call-123',
                attioContactId: 'attio-contact-123',
            });

            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: 'call-123',
                    direction: 'incoming',
                    status: 'completed',
                    duration: 60,
                    participants: ['+15551234567', '+15559876543'],
                    phoneNumberId: 'pn-456',
                    userId: 'user-789',
                    createdAt: '2025-01-15T10:30:00Z',
                },
            });

            mockQuoApi.api.getCallRecordings.mockResolvedValue({ data: [] });
            mockQuoApi.api.getCallVoicemails.mockResolvedValue({ data: null });
            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { name: 'Line', number: '+15559876543' },
            });
            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'John', lastName: 'Doe' },
            });
            mockAttioApi.api.getRecord.mockResolvedValue({
                data: { id: { record_id: 'attio-contact-123' } },
            });

            // Mock _findAttioContactFromQuoWebhook to return the contact ID
            integration._findAttioContactFromQuoWebhook = jest
                .fn()
                .mockResolvedValue('attio-contact-123');

            // New note created successfully
            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-new-999' } },
            });

            // Delete fails (but new note already exists!)
            mockAttioApi.api.deleteNote.mockRejectedValue(
                new Error('Note already deleted or not found'),
            );

            // Act - Should NOT throw (delete failure is non-fatal)
            await integration._handleQuoCallSummaryEvent(webhookData);

            // Assert - New note was created
            expect(mockAttioApi.api.createNote).toHaveBeenCalled();

            // Assert - Mapping updated with new note ID (delete failure doesn't prevent this)
            expect(integration.upsertMapping).toHaveBeenCalledWith(
                'call-123',
                expect.objectContaining({
                    noteId: 'note-new-999',
                }),
            );
        });
    });
});

describe('Call Summary Enrichment - AxisCare Integration', () => {
    let integration;
    let mockAxisCareApi;
    let mockQuoApi;
    let mockCommands;

    beforeEach(() => {
        mockAxisCareApi = {
            api: {
                createCallLog: jest.fn(),
                updateCallLog: jest.fn(),
                getClient: jest.fn(),
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
            updateIntegrationConfig: jest.fn().mockResolvedValue({}),
        };

        integration = new AxisCareIntegration({
            userId: 'test-user',
            id: 'test-integration-id',
        });

        integration.axisCare = mockAxisCareApi;
        integration.quo = mockQuoApi;
        integration.commands = mockCommands;
        integration.config = { quoCallWebhookKey: 'test-key' };

        integration.upsertMapping = jest.fn().mockResolvedValue({});
        integration.getMapping = jest.fn().mockResolvedValue(null);
    });

    describe('Phase 3: AxisCare - Update Existing Call Log with Enriched Summary', () => {
        it('should update existing call log with enriched summary (AxisCare supports updates)', async () => {
            // Arrange
            const webhookData = {
                type: 'call.summary.completed',
                data: {
                    object: {
                        callId: 'call-456',
                        summary: ['Discussed care plan', 'Reviewed medications'],
                        nextSteps: ['Schedule nurse visit', 'Update prescription'],
                        status: 'completed',
                    },
                    deepLink: 'https://app.openphone.com/calls/call-456',
                },
            };

            // Existing mapping from Phase 1
            integration.getMapping.mockResolvedValue({
                noteId: 789, // AxisCare call log ID (stored as noteId for consistency)
                callId: 'call-456',
                axiscareContactId: 123,
                axiscareContactType: 'client',
            });

            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: 'call-456',
                    direction: 'outgoing',
                    status: 'completed',
                    duration: 240,
                    participants: ['+15559876543', '+15551234567'],
                    phoneNumberId: 'pn-789',
                    userId: 'user-123',
                    createdAt: '2025-01-15T14:00:00Z',
                },
            });

            mockQuoApi.api.getCallRecordings.mockResolvedValue({
                data: [
                    {
                        url: 'https://storage.example.com/care-call.mp3',
                        duration: 240,
                    },
                ],
            });

            mockQuoApi.api.getCallVoicemails.mockResolvedValue({ data: null });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { name: 'Care Line', number: '+15559876543' },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'Sarah', lastName: 'Johnson' },
            });

            mockAxisCareApi.api.updateCallLog.mockResolvedValue({
                id: 789,
                notes: 'Updated with summary',
            });

            // Mock _findAxisCareContactByPhone to return the contact
            integration._findAxisCareContactByPhone = jest.fn().mockResolvedValue({
                id: 123,
                type: 'client',
                name: 'Test Client',
            });

            // Act
            await integration._handleQuoCallSummaryEvent(webhookData);

            // Assert - updateCallLog called (NOT create + delete)
            expect(mockAxisCareApi.api.updateCallLog).toHaveBeenCalledWith(
                789,
                expect.objectContaining({
                    notes: expect.stringMatching(/Summary:.*Discussed care plan/s),
                }),
            );

            // Assert - Notes include recording URL
            const updateCall = mockAxisCareApi.api.updateCallLog.mock.calls[0][1];
            expect(updateCall.notes).toContain('https://storage.example.com/care-call.mp3');

            // Assert - createCallLog NOT called (update only)
            expect(mockAxisCareApi.api.createCallLog).not.toHaveBeenCalled();
        });

        it('should handle voicemail transcripts in AxisCare call log updates', async () => {
            // Arrange
            const webhookData = {
                type: 'call.summary.completed',
                data: {
                    object: {
                        callId: 'call-789',
                        summary: ['Voicemail received'],
                        nextSteps: ['Call back'],
                        status: 'completed',
                    },
                    deepLink: 'https://app.openphone.com/calls/call-789',
                },
            };

            integration.getMapping.mockResolvedValue({
                noteId: 999, // AxisCare call log ID (stored as noteId for consistency)
                callId: 'call-789',
                axiscareContactId: 456,
                axiscareContactType: 'client',
            });

            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: 'call-789',
                    direction: 'incoming',
                    status: 'missed',
                    duration: 0,
                    participants: ['+15551234567', '+15559876543'],
                    phoneNumberId: 'pn-999',
                    userId: 'user-456',
                    createdAt: '2025-01-15T16:00:00Z',
                },
            });

            mockQuoApi.api.getCallRecordings.mockResolvedValue({ data: [] });

            mockQuoApi.api.getCallVoicemails.mockResolvedValue({
                data: {
                    recordingUrl: 'https://storage.example.com/vm-789.mp3',
                    transcript: 'Please call me back regarding my appointment',
                    duration: 30,
                },
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { name: 'Main Line', number: '+15559876543' },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'Mike', lastName: 'Davis' },
            });

            mockAxisCareApi.api.updateCallLog.mockResolvedValue({ id: 999 });

            // Mock _findAxisCareContactByPhone to return the contact
            integration._findAxisCareContactByPhone = jest.fn().mockResolvedValue({
                id: 456,
                type: 'client',
                name: 'Test Client',
            });

            // Act
            await integration._handleQuoCallSummaryEvent(webhookData);

            // Assert - Voicemail URL and transcript included
            const updateCall = mockAxisCareApi.api.updateCallLog.mock.calls[0][1];
            expect(updateCall.notes).toContain('https://storage.example.com/vm-789.mp3');
            expect(updateCall.notes).toContain('Please call me back regarding my appointment');
        });
    });
});

describe('Call Summary Enrichment - Zoho CRM Integration', () => {
    let integration;
    let mockZohoCrmApi;
    let mockQuoApi;
    let mockCommands;

    // Import at describe level to avoid issues
    const ZohoCRMIntegration = require('../src/integrations/ZohoCRMIntegration');

    beforeEach(() => {
        mockZohoCrmApi = {
            api: {
                createNote: jest.fn(),
                updateNote: jest.fn(),
                updateCall: jest.fn(),
                deleteNote: jest.fn(),
                searchRecordsByCriteria: jest.fn(),
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
            updateIntegrationConfig: jest.fn().mockResolvedValue({}),
            findOrganizationUserById: jest.fn().mockResolvedValue({
                id: 'user-123',
                appOrgId: 'org-123',
            }),
        };

        integration = new ZohoCRMIntegration({
            userId: 'test-user',
            id: 'test-integration-id',
        });

        integration.zoho = mockZohoCrmApi;
        integration.quo = mockQuoApi;
        integration.commands = mockCommands;
        integration.config = {
            quoCallWebhookKey: 'test-key',
            phoneNumbersMetadata: [
                { number: '+15551234567', name: 'Sales Line', type: 'internal' }
            ],
        };

        integration.upsertMapping = jest.fn().mockResolvedValue({});
        integration.getMapping = jest.fn().mockResolvedValue(null);
    });

    describe('Phase 3: Zoho CRM - Update Existing Note with Enriched Summary', () => {
        it('should update existing note with enriched summary (Zoho CRM supports updates)', async () => {
            // Arrange
            const webhookData = {
                type: 'call.summary.completed',
                data: {
                    object: {
                        callId: 'call-zoho-123',
                        summary: ['Discussed product demo', 'Reviewed pricing'],
                        nextSteps: ['Send quote', 'Schedule follow-up'],
                        status: 'completed',
                    },
                    deepLink: 'https://app.openphone.com/calls/call-zoho-123',
                },
            };

            // Existing mapping from Phase 1
            integration.getMapping.mockResolvedValue({
                noteId: 'zoho-note-456',
                callId: 'call-zoho-123',
                zohoContactId: 'zoho-contact-789',
            });

            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: 'call-zoho-123',
                    direction: 'outgoing',
                    status: 'completed',
                    duration: 300,
                    participants: ['+15559876543', '+15551234567'],
                    phoneNumberId: 'pn-zoho',
                    userId: 'user-zoho',
                    createdAt: '2025-01-15T11:00:00Z',
                },
            });

            mockQuoApi.api.getCallRecordings.mockResolvedValue({
                data: [
                    {
                        url: 'https://storage.example.com/zoho-recording.mp3',
                        duration: 300,
                    },
                ],
            });

            mockQuoApi.api.getCallVoicemails.mockResolvedValue({ data: null });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { name: 'Sales Line', number: '+15559876543' },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'Alex', lastName: 'Johnson' },
            });

            mockZohoCrmApi.api.updateNote.mockResolvedValue({
                data: [{ details: { id: 'zoho-note-456' } }],
            });

            // Mock _findZohoContactByPhone to return the contact ID
            integration._findZohoContactByPhone = jest
                .fn()
                .mockResolvedValue('zoho-contact-789');

            // Act
            await integration._handleQuoCallSummaryEvent(webhookData);

            // Assert - updateCall called (production uses updateCall for Calls_module)
            expect(mockZohoCrmApi.api.updateCall).toHaveBeenCalledWith(
                'zoho-note-456',
                expect.objectContaining({
                    Subject: expect.any(String),
                    Description: expect.stringMatching(/Summary:.*Discussed product demo/s),
                }),
            );

            // Assert - Description includes recording URL
            const updateCallArgs = mockZohoCrmApi.api.updateCall.mock.calls[0][1];
            expect(updateCallArgs.Description).toContain('https://storage.example.com/zoho-recording.mp3');

            // Assert - createNote NOT called (update only)
            expect(mockZohoCrmApi.api.createNote).not.toHaveBeenCalled();
        });

        it('should handle voicemail transcripts in Zoho CRM note updates', async () => {
            // Arrange
            const webhookData = {
                type: 'call.summary.completed',
                data: {
                    object: {
                        callId: 'call-zoho-vm',
                        summary: ['Customer left voicemail'],
                        nextSteps: ['Return call'],
                        status: 'completed',
                    },
                    deepLink: 'https://app.openphone.com/calls/call-zoho-vm',
                },
            };

            integration.getMapping.mockResolvedValue({
                noteId: 'zoho-note-vm',
                callId: 'call-zoho-vm',
                zohoContactId: 'zoho-contact-vm',
            });

            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: 'call-zoho-vm',
                    direction: 'incoming',
                    status: 'missed',
                    duration: 0,
                    participants: ['+15551234567', '+15559876543'],
                    phoneNumberId: 'pn-zoho-vm',
                    userId: 'user-zoho-vm',
                    createdAt: '2025-01-15T12:00:00Z',
                },
            });

            mockQuoApi.api.getCallRecordings.mockResolvedValue({ data: [] });

            mockQuoApi.api.getCallVoicemails.mockResolvedValue({
                data: {
                    recordingUrl: 'https://storage.example.com/zoho-vm.mp3',
                    transcript: 'Hi, please call me back about the proposal',
                    duration: 25,
                },
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { name: 'Main Line', number: '+15559876543' },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'Sam', lastName: 'Wilson' },
            });

            mockZohoCrmApi.api.updateCall.mockResolvedValue({
                data: [{ details: { id: 'zoho-note-vm' } }],
            });

            integration._findZohoContactByPhone = jest
                .fn()
                .mockResolvedValue('zoho-contact-vm');

            // Act
            await integration._handleQuoCallSummaryEvent(webhookData);

            // Assert - Voicemail URL and transcript included (uses updateCall)
            const updateCallArgs = mockZohoCrmApi.api.updateCall.mock.calls[0][1];
            expect(updateCallArgs.Description).toContain('https://storage.example.com/zoho-vm.mp3');
            expect(updateCallArgs.Description).toContain('Hi, please call me back about the proposal');
        });
    });
});

describe('Call Summary Enrichment - Pipedrive Integration', () => {
    let integration;
    let mockPipedriveApi;
    let mockQuoApi;
    let mockCommands;

    // Import at describe level to avoid issues
    const PipedriveIntegration = require('../src/integrations/PipedriveIntegration');

    beforeEach(() => {
        mockPipedriveApi = {
            api: {
                createNote: jest.fn(),
                _put: jest.fn(), // Used for updateNote
                searchPersons: jest.fn(),
                baseUrl: 'https://company.pipedrive.com/api',
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
            updateIntegrationConfig: jest.fn().mockResolvedValue({}),
            findOrganizationUserById: jest.fn().mockResolvedValue({
                id: 'test-user-id',
                email: 'test@example.com',
            }),
        };

        integration = new PipedriveIntegration({
            userId: 'test-user',
            id: 'test-integration-id',
        });

        integration.pipedrive = mockPipedriveApi;
        integration.quo = mockQuoApi;
        integration.commands = mockCommands;
        integration.config = {
            quoCallWebhookKey: 'test-key',
            // Mark the Quo phone number as internal (not the contact number)
            phoneNumbersMetadata: [
                { number: '+15551234567', name: 'Sales Line', type: 'internal' }
            ],
        };

        integration.upsertMapping = jest.fn().mockResolvedValue({});
        integration.getMapping = jest.fn().mockResolvedValue(null);
    });

    describe('Phase 1: call.completed - Initial Note Creation with Mapping', () => {
        it('should create initial note and store mapping with call ID -> note ID', async () => {
            // Arrange
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'call-pd-123',
                        direction: 'incoming',
                        status: 'completed',
                        duration: 120,
                        participants: ['+15551234567', '+15559876543'],
                        phoneNumberId: 'pn-pd-456',
                        userId: 'user-pd-789',
                        createdAt: '2025-01-15T10:30:00Z',
                    },
                    deepLink: 'https://app.openphone.com/calls/call-pd-123',
                },
            };

            // Mock getCall to return full call details
            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: 'call-pd-123',
                    direction: 'incoming',
                    status: 'completed',
                    duration: 120,
                    participants: ['+15551234567', '+15559876543'],
                    phoneNumberId: 'pn-pd-456',
                    userId: 'user-pd-789',
                    createdAt: '2025-01-15T10:30:00Z',
                    answeredAt: '2025-01-15T10:30:05Z',
                },
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { symbol: '📞', name: 'Sales Line', number: '+15559876543' },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'John', lastName: 'Doe' },
            });

            mockPipedriveApi.api.createNote.mockResolvedValue({
                data: { id: 12345 },
            });

            // Mock _findPipedriveContactByPhone - returns numeric ID as string (Pipedrive person IDs are numbers)
            integration._findPipedriveContactByPhone = jest
                .fn()
                .mockResolvedValue('456789');

            // Act
            await integration._handleQuoCallEvent(webhookData);

            // Assert - Note created
            expect(mockPipedriveApi.api.createNote).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('Call'),
                    person_id: 456789, // parseInt('456789')
                }),
            );

            // Assert - Mapping stored: call ID -> note ID
            expect(integration.upsertMapping).toHaveBeenCalledWith(
                'call-pd-123',
                expect.objectContaining({
                    noteId: 12345,
                    callId: 'call-pd-123',
                    contactId: '456789',
                }),
            );
        });
    });

    describe('Phase 3: Pipedrive - Update Existing Note with Enriched Summary', () => {
        it('should update existing note with enriched summary (Pipedrive supports updates)', async () => {
            // Arrange
            const webhookData = {
                type: 'call.summary.completed',
                data: {
                    object: {
                        callId: 'call-pd-123',
                        summary: ['Discussed product features', 'Reviewed pricing'],
                        nextSteps: ['Send proposal', 'Schedule demo'],
                        status: 'completed',
                    },
                    deepLink: 'https://app.openphone.com/calls/call-pd-123',
                },
            };

            // Existing mapping from Phase 1
            integration.getMapping.mockResolvedValue({
                noteId: 12345,
                callId: 'call-pd-123',
                contactId: 'pd-person-123',
            });

            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: 'call-pd-123',
                    direction: 'outgoing',
                    status: 'completed',
                    duration: 300,
                    participants: ['+15559876543', '+15551234567'],
                    phoneNumberId: 'pn-pd',
                    userId: 'user-pd',
                    createdAt: '2025-01-15T11:00:00Z',
                },
            });

            mockQuoApi.api.getCallRecordings.mockResolvedValue({
                data: [
                    {
                        url: 'https://storage.example.com/pd-recording.mp3',
                        duration: 300,
                    },
                ],
            });

            mockQuoApi.api.getCallVoicemails.mockResolvedValue({ data: null });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { name: 'Sales Line', number: '+15559876543' },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'Alex', lastName: 'Johnson' },
            });

            mockPipedriveApi.api._put.mockResolvedValue({
                data: { id: 12345 },
            });

            // Mock _findPipedriveContactByPhone
            integration._findPipedriveContactByPhone = jest
                .fn()
                .mockResolvedValue('pd-person-123');

            // Act
            await integration._handleQuoCallSummaryEvent(webhookData);

            // Assert - _put called for update (NOT createNote)
            expect(mockPipedriveApi.api._put).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'https://company.pipedrive.com/api/v1/notes/12345',
                    body: expect.objectContaining({
                        content: expect.stringMatching(/Summary:.*Discussed product features/s),
                    }),
                }),
            );

            // Assert - Notes include recording URL
            const updateCall = mockPipedriveApi.api._put.mock.calls[0][0];
            expect(updateCall.body.content).toContain('https://storage.example.com/pd-recording.mp3');

            // Assert - createNote NOT called (update only)
            expect(mockPipedriveApi.api.createNote).not.toHaveBeenCalled();
        });

        it('should handle voicemail transcripts in Pipedrive note updates', async () => {
            // Arrange
            const webhookData = {
                type: 'call.summary.completed',
                data: {
                    object: {
                        callId: 'call-pd-vm',
                        summary: ['Customer left voicemail'],
                        nextSteps: ['Return call'],
                        status: 'completed',
                    },
                    deepLink: 'https://app.openphone.com/calls/call-pd-vm',
                },
            };

            integration.getMapping.mockResolvedValue({
                noteId: 67890,
                callId: 'call-pd-vm',
                contactId: 'pd-person-vm',
            });

            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: 'call-pd-vm',
                    direction: 'incoming',
                    status: 'missed',
                    duration: 0,
                    participants: ['+15551234567', '+15559876543'],
                    phoneNumberId: 'pn-pd-vm',
                    userId: 'user-pd-vm',
                    createdAt: '2025-01-15T12:00:00Z',
                },
            });

            mockQuoApi.api.getCallRecordings.mockResolvedValue({ data: [] });

            mockQuoApi.api.getCallVoicemails.mockResolvedValue({
                data: {
                    recordingUrl: 'https://storage.example.com/pd-vm.mp3',
                    transcript: 'Hi, please call me back about my order',
                    duration: 25,
                },
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { name: 'Main Line', number: '+15559876543' },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'Sam', lastName: 'Wilson' },
            });

            mockPipedriveApi.api._put.mockResolvedValue({
                data: { id: 67890 },
            });

            integration._findPipedriveContactByPhone = jest
                .fn()
                .mockResolvedValue('pd-person-vm');

            // Act
            await integration._handleQuoCallSummaryEvent(webhookData);

            // Assert - Voicemail URL and transcript included
            const updateCall = mockPipedriveApi.api._put.mock.calls[0][0];
            expect(updateCall.body.content).toContain('https://storage.example.com/pd-vm.mp3');
            expect(updateCall.body.content).toContain('Hi, please call me back about my order');
        });

        it('should show "Handled by Sona" status and include jobs data for AI-handled calls', async () => {
            // Arrange - AI-handled call with jobs (message taking)
            const webhookData = {
                type: 'call.summary.completed',
                data: {
                    object: {
                        callId: 'call-pd-sona',
                        summary: ['The AI assistant took a message from the caller'],
                        nextSteps: [],
                        jobs: [
                            {
                                icon: '✍️',
                                name: 'Message taking',
                                result: {
                                    data: [
                                        { name: 'First and last name', value: 'John Doe' },
                                        { name: 'Summarize the message', value: 'Interested in product demo' },
                                    ],
                                },
                            },
                        ],
                        status: 'completed',
                    },
                    deepLink: 'https://my.quo.com/inbox/test/c/call-pd-sona',
                },
            };

            integration.getMapping.mockResolvedValue({
                noteId: 11111,
                callId: 'call-pd-sona',
                contactId: 'pd-person-sona',
            });

            // AI-handled call has aiHandled: 'ai-agent'
            mockQuoApi.api.getCall.mockResolvedValue({
                data: {
                    id: 'call-pd-sona',
                    direction: 'incoming',
                    status: 'completed',
                    duration: 120,
                    participants: ['+15551234567', '+15559876543'],
                    phoneNumberId: 'pn-pd-sona',
                    userId: 'user-pd-sona',
                    createdAt: '2025-01-15T14:00:00Z',
                    aiHandled: 'ai-agent', // AI-handled call
                    answeredAt: null, // Not answered by human
                },
            });

            mockQuoApi.api.getCallRecordings.mockResolvedValue({
                data: [{ url: 'https://storage.example.com/sona-recording.mp3', duration: 120 }],
            });

            mockQuoApi.api.getCallVoicemails.mockResolvedValue({ data: null });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { name: 'Main Line', number: '+15559876543' },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'Sona', lastName: 'AI' },
            });

            mockPipedriveApi.api._put.mockResolvedValue({
                data: { id: 11111 },
            });

            integration._findPipedriveContactByPhone = jest
                .fn()
                .mockResolvedValue('pd-person-sona');

            // Act
            await integration._handleQuoCallSummaryEvent(webhookData);

            // Assert - Note updated with "Handled by Sona" status
            const updateCall = mockPipedriveApi.api._put.mock.calls[0][0];
            expect(updateCall.body.content).toContain('Handled by Sona');

            // Assert - Jobs data included
            expect(updateCall.body.content).toContain('Message taking');
            expect(updateCall.body.content).toContain('John Doe');
            expect(updateCall.body.content).toContain('Interested in product demo');
        });
    });
});
