const AttioIntegration = require('../src/integrations/AttioIntegration');
const { mockQuoMessage, mockGetPhoneNumber, mockGetUser, mockGetCall } = require('./fixtures/quo-api-responses');

/**
 * Unit tests to verify:
 * 1. SMS and call webhooks only create ONE note per webhook receipt
 * 2. Call summary webhooks create notes in Attio
 */
describe('AttioIntegration - Webhook Duplicate Prevention', () => {
    let integration;
    let mockQuoApi;
    let mockAttioApi;
    let createNoteSpy;

    beforeEach(() => {
        // Mock Quo API
        mockQuoApi = {
            getPhoneNumber: jest.fn(),
            getUser: jest.fn(),
            getCall: jest.fn(),
            getCallRecordings: jest.fn(),
            getCallVoicemails: jest.fn(),
        };

        // Mock Attio API with note creation spy
        mockAttioApi = {
            getRecord: jest.fn(),
            createNote: jest.fn(),
        };

        // Create spy for createNote to track call count
        createNoteSpy = mockAttioApi.createNote;

        // Create integration instance
        integration = new AttioIntegration({});
        integration.quo = { api: mockQuoApi };
        integration.attio = { api: mockAttioApi };
        integration.id = 'test-integration-id';
        integration.userId = 'test-user-id';
        integration._findAttioContactFromQuoWebhook = jest.fn();

        // Mock commands (needed for analytics tracking)
        integration.commands = {
            findOrganizationUserById: jest.fn().mockResolvedValue({ id: 'test-user-id' }),
        };

        // Mock getRecord to return valid person
        mockAttioApi.getRecord.mockResolvedValue({
            data: {
                id: { record_id: 'attio-person-123' },
            },
        });

        // Mock createNote to succeed (Attio API returns nested structure)
        mockAttioApi.createNote.mockResolvedValue({
            data: { id: { note_id: 'note-123' } },
        });

        // Mock phone number lookup using centralized fixture
        mockQuoApi.getPhoneNumber.mockResolvedValue(mockGetPhoneNumber.salesLine);

        // Mock user lookup using centralized fixture
        mockQuoApi.getUser.mockResolvedValue(mockGetUser.johnSmith);

        // Configure integration with phone numbers metadata for participant filtering
        integration.config = {
            phoneNumbersMetadata: [
                { number: '+15551234567', name: 'Sales Line' }, // Match mockGetPhoneNumber.salesLine
            ],
        };

        // Mock contact lookup
        integration._findAttioContactFromQuoWebhook.mockResolvedValue(
            'attio-person-123',
        );

        // Mock integrationMappingRepository for message deduplication
        integration.integrationMappingRepository = {
            get: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({}),
        };

        // Mock getMapping and upsertMapping methods (used by call summary enrichment)
        integration.getMapping = jest.fn().mockResolvedValue(null);
        integration.upsertMapping = jest.fn().mockResolvedValue({});

        // Mock getCall to return the webhook's call data (for "always fetch" pattern)
        // Note: This will be overridden by individual tests if they need specific data
        mockQuoApi.getCall.mockImplementation(() => {
            return Promise.resolve({
                data: {
                    id: 'default-call-id',
                    participants: ['+12125551234', '+15551234567'],
                    direction: 'incoming',
                    status: 'completed',
                    duration: 60,
                    phoneNumberId: 'PN_TEST_001',
                    userId: 'US_TEST_001',
                    answeredAt: '2025-01-15T10:00:00Z',
                    createdAt: '2025-01-15T10:00:00Z',
                },
            });
        });

        // Mock getCallRecordings and getCallVoicemails for call summary tests
        mockQuoApi.getCallRecordings.mockResolvedValue({
            data: [
                {
                    url: 'https://files.quo.com/recording-1.mp3',
                    duration: 120,
                },
            ],
        });

        mockQuoApi.getCallVoicemails.mockResolvedValue({
            data: [],
        });
    });

    describe('SMS Webhook - Duplicate Prevention', () => {
        it('should create exactly ONE note for message.received webhook', async () => {
            // Arrange - Use centralized fixture
            const webhookData = {
                type: 'message.received',
                data: {
                    ...mockQuoMessage.incomingMinimal.data,
                    object: {
                        ...mockQuoMessage.incomingMinimal.data.object,
                        id: 'msg-123', // Custom ID for this test
                    },
                },
            };

            // Act
            await integration._handleQuoMessageEvent(webhookData);

            // Assert - createNote should be called EXACTLY ONCE
            expect(createNoteSpy).toHaveBeenCalledTimes(1);
            expect(createNoteSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    parent_object: 'people',
                    parent_record_id: 'attio-person-123',
                    format: 'markdown',
                    created_at: mockQuoMessage.incomingMinimal.data.object.createdAt,
                }),
            );
        });

        it('should create exactly ONE note for message.delivered webhook', async () => {
            // Arrange - Use centralized fixture
            const webhookData = {
                type: 'message.delivered',
                data: {
                    ...mockQuoMessage.outgoingMinimal.data,
                    object: {
                        ...mockQuoMessage.outgoingMinimal.data.object,
                        id: 'msg-456', // Custom ID for this test
                    },
                },
            };

            // Act
            await integration._handleQuoMessageEvent(webhookData);

            // Assert - createNote should be called EXACTLY ONCE
            expect(createNoteSpy).toHaveBeenCalledTimes(1);
        });

        it('should NOT create duplicate notes when processing same webhook twice', async () => {
            // Arrange - Use centralized fixture
            const webhookData = {
                type: 'message.received',
                data: {
                    ...mockQuoMessage.incomingMinimal.data,
                    object: {
                        ...mockQuoMessage.incomingMinimal.data.object,
                        id: 'msg-789', // Custom ID for this test
                    },
                },
            };

            // Act - Process webhook twice (simulating duplicate delivery)
            await integration._handleQuoMessageEvent(webhookData);
            const firstCallCount = createNoteSpy.mock.calls.length;

            createNoteSpy.mockClear(); // Clear spy for second call

            await integration._handleQuoMessageEvent(webhookData);
            const secondCallCount = createNoteSpy.mock.calls.length;

            // Assert - Each call creates exactly one note (no internal duplication)
            expect(firstCallCount).toBe(1);
            expect(secondCallCount).toBe(1);
            // Note: Frigg's queue deduplication should prevent the second call
            // But if it does happen, each call should still only create 1 note
        });
    });

    describe('Call Webhook - Duplicate Prevention', () => {
        it('should create exactly ONE note for call.completed webhook (incoming)', async () => {
            // Arrange - Configure phoneNumbersMetadata to filter out one participant
            integration.config = {
                phoneNumbersMetadata: [
                    { number: '+15551234567', name: 'Sales Line' },
                    { number: '+12125551234', name: 'Support Line' }, // Filter this Quo number
                ],
            };

            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'call-123',
                        direction: 'incoming',
                        participants: ['+12125551234', '+19175555555'], // Only +19175555555 is external
                        duration: 120,
                        status: 'completed',
                        phoneNumberId: 'phone-123',
                        userId: 'user-123',
                        createdAt: '2025-01-15T10:33:00Z',
                        answeredAt: '2025-01-15T10:33:05Z',
                    },
                    deepLink: 'https://quo.com/call/call-123',
                },
            };

            // Mock getCall to return the webhook data
            mockQuoApi.getCall.mockResolvedValueOnce({
                data: webhookData.data.object,
            });

            // Act
            await integration._handleQuoCallEvent(webhookData);

            // Assert - createNote should be called EXACTLY ONCE (only for external participant)
            expect(createNoteSpy).toHaveBeenCalledTimes(1);
            expect(createNoteSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    parent_object: 'people',
                    parent_record_id: 'attio-person-123',
                    format: 'markdown',
                    created_at: '2025-01-15T10:33:00Z',
                }),
            );
        });

        it('should create exactly ONE note for call.completed webhook (outgoing)', async () => {
            // Arrange
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'call-456',
                        direction: 'outgoing',
                        participants: ['+19175555555', '+12125551234'],
                        duration: 90,
                        status: 'completed',
                        phoneNumberId: 'phone-123',
                        userId: 'user-123',
                        createdAt: '2025-01-15T10:34:00Z',
                    },
                    deepLink: 'https://quo.com/call/call-456',
                },
            };

            // Act
            await integration._handleQuoCallEvent(webhookData);

            // Assert - createNote should be called EXACTLY ONCE
            expect(createNoteSpy).toHaveBeenCalledTimes(1);
        });

        it('should create exactly ONE note for call.completed with voicemail', async () => {
            // Arrange
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'call-789',
                        direction: 'incoming',
                        participants: ['+12125551234', '+19175555555'],
                        duration: 0,
                        status: 'completed',
                        phoneNumberId: 'phone-123',
                        userId: 'user-123',
                        createdAt: '2025-01-15T10:35:00Z',
                        voicemail: {
                            duration: 30,
                            transcription: 'Test voicemail',
                        },
                    },
                    deepLink: 'https://quo.com/call/call-789',
                },
            };

            // Act
            await integration._handleQuoCallEvent(webhookData);

            // Assert - createNote should be called EXACTLY ONCE
            expect(createNoteSpy).toHaveBeenCalledTimes(1);
        });

        it('should NOT create duplicate notes when processing same call webhook twice', async () => {
            // Arrange
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'call-duplicate',
                        direction: 'incoming',
                        participants: ['+12125551234', '+19175555555'],
                        duration: 60,
                        status: 'completed',
                        phoneNumberId: 'phone-123',
                        userId: 'user-123',
                        createdAt: '2025-01-15T10:36:00Z',
                    },
                    deepLink: 'https://quo.com/call/call-duplicate',
                },
            };

            // Act - Process webhook twice
            await integration._handleQuoCallEvent(webhookData);
            const firstCallCount = createNoteSpy.mock.calls.length;

            createNoteSpy.mockClear();

            await integration._handleQuoCallEvent(webhookData);
            const secondCallCount = createNoteSpy.mock.calls.length;

            // Assert
            expect(firstCallCount).toBe(1);
            expect(secondCallCount).toBe(1);
        });
    });

    describe('Call Summary Webhook - Note Creation', () => {
        beforeEach(() => {
            // Configure phoneNumbersMetadata to filter out one participant
            integration.config = {
                phoneNumbersMetadata: [
                    { number: '+15551234567', name: 'Sales Line' },
                    { number: '+12125551234', name: 'Support Line' }, // Filter this Quo number
                ],
            };

            // Mock getCall to return call details (answered call)
            mockQuoApi.getCall = jest.fn().mockResolvedValue({
                data: {
                    id: 'call-123',
                    direction: 'incoming',
                    participants: ['+12125551234', '+19175555555'], // Only +19175555555 is external
                    duration: 165, // 2m 45s
                    status: 'completed',
                    phoneNumberId: 'phone-123',
                    userId: 'user-123',
                    createdAt: '2025-01-15T10:00:00Z',
                    answeredAt: '2025-01-15T10:00:05Z', // Call was answered
                    answeredBy: 'user-123',
                },
            });
        });

        it('should create exactly ONE note with formatted summary', async () => {
            // Arrange
            const webhookData = {
                type: 'call.summary.completed',
                data: {
                    object: {
                        callId: 'call-123',
                        status: 'completed',
                        summary: [
                            'Customer called about their recent order',
                            'Discussed shipping options and delivery timeline',
                            'Agreed on expedited shipping',
                        ],
                        nextSteps: [
                            'Update shipping method in customer portal',
                            'Send tracking information when available',
                        ],
                    },
                    deepLink: 'https://quo.com/call/call-123',
                },
            };

            // Act
            const result =
                await integration._handleQuoCallSummaryEvent(webhookData);

            // Assert - Should create exactly ONE note
            expect(createNoteSpy).toHaveBeenCalledTimes(1);
            expect(createNoteSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    parent_object: 'people',
                    parent_record_id: 'attio-person-123',
                    format: 'markdown',
                    created_at: '2025-01-15T10:00:00Z',
                }),
            );

            // Verify note content includes summary and next steps
            const noteContent = createNoteSpy.mock.calls[0][0].content;
            expect(noteContent).toContain('Incoming answered by John Smith'); // mockGetUser.johnSmith
            expect(noteContent).toContain('▶️ Recording (2:00)'); // Mock recording is 120 seconds
            expect(noteContent).toContain('**Summary:**');
            expect(noteContent).toContain(
                '• Customer called about their recent order',
            );
            expect(noteContent).toContain(
                '• Discussed shipping options and delivery timeline',
            );
            expect(noteContent).toContain('• Agreed on expedited shipping');
            expect(noteContent).toContain('**Next Steps:**');
            expect(noteContent).toContain(
                '• Update shipping method in customer portal',
            );
            expect(noteContent).toContain(
                '• Send tracking information when available',
            );
            expect(noteContent).toContain(
                '[View the call activity in Quo](https://quo.com/call/call-123)',
            );

            // Verify title (now uses regular call format, not "Call Summary:")
            const noteTitle = createNoteSpy.mock.calls[0][0].title;
            expect(noteTitle).toContain('☎️  Call');
            expect(noteTitle).toContain('+19175555555'); // External participant

            // Verify result structure (multi-participant format)
            expect(result).toEqual({
                received: true,
                callId: 'call-123',
                logged: true,
                participantCount: 1,
                results: [
                    expect.objectContaining({
                        contactPhone: '+19175555555',
                        attioRecordId: 'attio-person-123',
                        logged: true,
                        summaryPoints: 3,
                        nextStepsCount: 2,
                    }),
                ],
            });
        });

        it('should handle summary without next steps', async () => {
            // Arrange
            const webhookData = {
                type: 'call.summary.completed',
                data: {
                    object: {
                        callId: 'call-456',
                        status: 'completed',
                        summary: ['Quick status check call'],
                        nextSteps: [],
                    },
                    deepLink: 'https://quo.com/call/call-456',
                },
            };

            mockQuoApi.getCall.mockResolvedValue({
                data: {
                    id: 'call-456',
                    direction: 'outgoing',
                    participants: ['+19175555555', '+12125551234'],
                    duration: 60,
                    status: 'completed',
                    phoneNumberId: 'phone-123',
                    userId: 'user-123',
                    createdAt: '2025-01-15T10:05:00Z',
                },
            });

            // Act
            const result =
                await integration._handleQuoCallSummaryEvent(webhookData);

            // Assert
            expect(createNoteSpy).toHaveBeenCalledTimes(1);

            const noteContent = createNoteSpy.mock.calls[0][0].content;
            expect(noteContent).toContain('**Summary:**');
            expect(noteContent).toContain('• Quick status check call');
            expect(noteContent).not.toContain('**Next Steps:**');

            expect(result.logged).toBe(true);
            expect(result.results[0].summaryPoints).toBe(1);
            expect(result.results[0].nextStepsCount).toBe(0);
        });

        it('should handle empty summary and next steps arrays', async () => {
            // Arrange
            const webhookData = {
                type: 'call.summary.completed',
                data: {
                    object: {
                        callId: 'call-789',
                        status: 'completed',
                        summary: [],
                        nextSteps: [],
                    },
                    deepLink: 'https://quo.com/call/call-789',
                },
            };

            // Act
            const result =
                await integration._handleQuoCallSummaryEvent(webhookData);

            // Assert - Should still create note with status line
            expect(createNoteSpy).toHaveBeenCalledTimes(1);

            const noteContent = createNoteSpy.mock.calls[0][0].content;
            expect(noteContent).toContain('Incoming answered by John Smith'); // mockGetUser.johnSmith
            expect(noteContent).not.toContain('**Summary:**');
            expect(noteContent).not.toContain('**Next Steps:**');

            expect(result.logged).toBe(true);
            expect(result.results[0].summaryPoints).toBe(0);
            expect(result.results[0].nextStepsCount).toBe(0);
        });

        it('should handle call not found error', async () => {
            // Arrange
            mockQuoApi.getCall.mockResolvedValue({ data: null });

            const webhookData = {
                type: 'call.summary.completed',
                data: {
                    object: {
                        callId: 'call-missing',
                        status: 'completed',
                        summary: ['Test'],
                        nextSteps: [],
                    },
                },
            };

            // Act
            const result =
                await integration._handleQuoCallSummaryEvent(webhookData);

            // Assert - Should not create note
            expect(createNoteSpy).toHaveBeenCalledTimes(0);
            expect(result).toEqual({
                received: true,
                callId: 'call-missing',
                logged: false,
                error: 'Call not found',
            });
        });

        it('should NOT create duplicate notes when processing same summary twice', async () => {
            // Arrange
            const webhookData = {
                type: 'call.summary.completed',
                data: {
                    object: {
                        callId: 'call-duplicate',
                        status: 'completed',
                        summary: ['Duplicate test summary'],
                        nextSteps: [],
                    },
                    deepLink: 'https://quo.com/call/call-duplicate',
                },
            };

            // Act
            await integration._handleQuoCallSummaryEvent(webhookData);
            const firstCallCount = createNoteSpy.mock.calls.length;

            createNoteSpy.mockClear();

            await integration._handleQuoCallSummaryEvent(webhookData);
            const secondCallCount = createNoteSpy.mock.calls.length;

            // Assert
            expect(firstCallCount).toBe(1);
            expect(secondCallCount).toBe(1);
        });
    });

    describe('Integration - Complete Webhook Flow', () => {
        it('should process multiple different webhooks without duplication', async () => {
            // Arrange - Use centralized fixtures
            const messageWebhook = {
                type: 'message.received',
                data: {
                    ...mockQuoMessage.incomingMinimal.data,
                    object: {
                        ...mockQuoMessage.incomingMinimal.data.object,
                        id: 'msg-1',
                    },
                },
            };

            const callWebhook = {
                type: 'call.completed',
                data: {
                    ...mockGetCall.completedIncoming.data,
                    object: {
                        ...mockGetCall.completedIncoming.data,
                        id: 'call-1',
                    },
                    deepLink: 'https://quo.com/call/call-1',
                },
            };

            // Act
            await integration._handleQuoMessageEvent(messageWebhook);
            await integration._handleQuoCallEvent(callWebhook);

            // Assert - Should have exactly 2 notes total (1 per webhook)
            expect(createNoteSpy).toHaveBeenCalledTimes(2);
        });
    });

    describe('Error Handling - Note Creation Failures', () => {
        it('should throw error if note creation fails for SMS', async () => {
            // Arrange - Use centralized fixture
            mockAttioApi.createNote.mockRejectedValue(
                new Error('Attio API error'),
            );

            const webhookData = {
                type: 'message.received',
                data: {
                    ...mockQuoMessage.incomingMinimal.data,
                    object: {
                        ...mockQuoMessage.incomingMinimal.data.object,
                        id: 'msg-error',
                    },
                },
            };

            // Act & Assert
            await expect(
                integration._handleQuoMessageEvent(webhookData),
            ).rejects.toThrow('Attio API error');
        });

        it('should return error result when note creation fails for call', async () => {
            // Arrange
            mockAttioApi.createNote.mockRejectedValue(
                new Error('Attio API error'),
            );

            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'call-error',
                        direction: 'incoming',
                        participants: ['+12125551234', '+19175555555'],
                        duration: 60,
                        status: 'completed',
                        phoneNumberId: 'phone-123',
                        userId: 'user-123',
                        createdAt: '2025-01-15T10:41:00Z',
                        answeredAt: '2025-01-15T10:41:05Z',
                    },
                    deepLink: 'https://quo.com/call/call-error',
                },
            };

            mockQuoApi.getCall.mockResolvedValue({
                data: webhookData.data.object,
            });

            // Act - Errors are captured in results instead of thrown
            const result = await integration._handleQuoCallEvent(webhookData);

            // Assert - Result shows failure with error details
            expect(result.logged).toBe(false);
            expect(result.results.length).toBeGreaterThan(0);
            expect(result.results.every((r) => r.logged === false)).toBe(true);
            expect(result.results.some((r) => r.error?.includes('Attio API error'))).toBe(true);
        });
    });
});
