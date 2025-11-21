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
 *
 * Safety: ALWAYS create new before deleting old to prevent data loss
 */

const AttioIntegration = require('../src/integrations/AttioIntegration');
const AxisCareIntegration = require('../src/integrations/AxisCareIntegration');

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
        };

        // Mock mapping methods
        integration.upsertMapping = jest.fn().mockResolvedValue({});
        integration.getMapping = jest.fn().mockResolvedValue(null);
    });

    describe('Phase 1: call.completed - Initial Note Creation', () => {
        it('should create initial note and store mapping with call ID -> note ID', async () => {
            // Arrange
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'call-123',
                        direction: 'incoming',
                        status: 'completed',
                        duration: 120,
                        participants: ['+15551234567', '+15559876543'],
                        phoneNumberId: 'pn-456',
                        userId: 'user-789',
                        createdAt: '2025-01-15T10:30:00Z',
                    },
                    deepLink: 'https://app.openphone.com/calls/call-123',
                },
            };

            mockAttioApi.api.getRecord.mockResolvedValue({
                data: { id: { record_id: 'attio-contact-123' } },
            });

            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: { symbol: '📞', name: 'Sales Line', number: '+15559876543' },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: { firstName: 'John', lastName: 'Doe' },
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
                content: expect.stringContaining('Incoming answered by John Doe'),
                created_at: '2025-01-15T10:30:00Z',
            });

            // Assert - Mapping stored: call ID -> note ID
            expect(integration.upsertMapping).toHaveBeenCalledWith(
                'call-123',
                expect.objectContaining({
                    noteId: 'note-abc123',
                    callId: 'call-123',
                    attioContactId: 'attio-contact-123',
                }),
            );
        });
    });

    describe('Phase 2: call.summary.completed - Fetch Recordings/Voicemails', () => {
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
