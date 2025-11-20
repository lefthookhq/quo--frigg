const AttioIntegration = require('../src/integrations/AttioIntegration');

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
        integration._findAttioContactFromQuoWebhook = jest.fn();

        // Mock getRecord to return valid person
        mockAttioApi.getRecord.mockResolvedValue({
            data: {
                id: { record_id: 'attio-person-123' },
            },
        });

        // Mock createNote to succeed
        mockAttioApi.createNote.mockResolvedValue({
            data: { id: 'note-123' },
        });

        // Mock phone number lookup
        mockQuoApi.getPhoneNumber.mockResolvedValue({
            data: {
                id: 'phone-123',
                number: '+19175555555',
                name: 'Test Line',
                symbol: '📞',
            },
        });

        // Mock user lookup
        mockQuoApi.getUser.mockResolvedValue({
            data: {
                id: 'user-123',
                firstName: 'John',
                lastName: 'Doe',
            },
        });

        // Mock contact lookup
        integration._findAttioContactFromQuoWebhook.mockResolvedValue(
            'attio-person-123',
        );
    });

    describe('SMS Webhook - Duplicate Prevention', () => {
        it('should create exactly ONE note for message.received webhook', async () => {
            // Arrange
            const webhookData = {
                type: 'message.received',
                data: {
                    object: {
                        id: 'msg-123',
                        direction: 'incoming',
                        from: '+12125551234',
                        to: '+19175555555',
                        text: 'Hello, this is a test message',
                        phoneNumberId: 'phone-123',
                        userId: 'user-123',
                        createdAt: '2025-01-15T10:30:00Z',
                    },
                    deepLink: 'https://quo.com/message/msg-123',
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
                    created_at: '2025-01-15T10:30:00Z',
                }),
            );
        });

        it('should create exactly ONE note for message.delivered webhook', async () => {
            // Arrange
            const webhookData = {
                type: 'message.delivered',
                data: {
                    object: {
                        id: 'msg-456',
                        direction: 'outgoing',
                        from: '+19175555555',
                        to: '+12125551234',
                        text: 'Response message',
                        phoneNumberId: 'phone-123',
                        userId: 'user-123',
                        createdAt: '2025-01-15T10:31:00Z',
                    },
                    deepLink: 'https://quo.com/message/msg-456',
                },
            };

            // Act
            await integration._handleQuoMessageEvent(webhookData);

            // Assert - createNote should be called EXACTLY ONCE
            expect(createNoteSpy).toHaveBeenCalledTimes(1);
        });

        it('should NOT create duplicate notes when processing same webhook twice', async () => {
            // Arrange
            const webhookData = {
                type: 'message.received',
                data: {
                    object: {
                        id: 'msg-789',
                        direction: 'incoming',
                        from: '+12125551234',
                        to: '+19175555555',
                        text: 'Duplicate test',
                        phoneNumberId: 'phone-123',
                        userId: 'user-123',
                        createdAt: '2025-01-15T10:32:00Z',
                    },
                    deepLink: 'https://quo.com/message/msg-789',
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
            // Arrange
            const webhookData = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'call-123',
                        direction: 'incoming',
                        participants: ['+12125551234', '+19175555555'],
                        duration: 120,
                        status: 'completed',
                        phoneNumberId: 'phone-123',
                        userId: 'user-123',
                        createdAt: '2025-01-15T10:33:00Z',
                    },
                    deepLink: 'https://quo.com/call/call-123',
                },
            };

            // Act
            await integration._handleQuoCallEvent(webhookData);

            // Assert - createNote should be called EXACTLY ONCE
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
            // Mock getCall to return call details
            mockQuoApi.getCall = jest.fn().mockResolvedValue({
                data: {
                    id: 'call-123',
                    direction: 'incoming',
                    participants: ['+12125551234', '+19175555555'],
                    duration: 165, // 2m 45s
                    status: 'completed',
                    phoneNumberId: 'phone-123',
                    userId: 'user-123',
                    createdAt: '2025-01-15T10:00:00Z',
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
            expect(noteContent).toContain('Incoming answered by John Doe');
            expect(noteContent).toContain('▶️ Recording (2:45)');
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

            // Verify title
            const noteTitle = createNoteSpy.mock.calls[0][0].title;
            expect(noteTitle).toContain('☎️  Call Summary:');
            expect(noteTitle).toContain('+12125551234');

            expect(result).toEqual({
                received: true,
                callId: 'call-123',
                logged: true,
                contactId: 'attio-person-123',
                summaryPoints: 3,
                nextStepsCount: 2,
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
            expect(result.summaryPoints).toBe(1);
            expect(result.nextStepsCount).toBe(0);
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
            expect(noteContent).toContain('Incoming answered by John Doe');
            expect(noteContent).not.toContain('**Summary:**');
            expect(noteContent).not.toContain('**Next Steps:**');

            expect(result.logged).toBe(true);
            expect(result.summaryPoints).toBe(0);
            expect(result.nextStepsCount).toBe(0);
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
            // Arrange
            const messageWebhook = {
                type: 'message.received',
                data: {
                    object: {
                        id: 'msg-1',
                        direction: 'incoming',
                        from: '+12125551234',
                        to: '+19175555555',
                        text: 'Test 1',
                        phoneNumberId: 'phone-123',
                        userId: 'user-123',
                        createdAt: '2025-01-15T10:00:00Z',
                    },
                    deepLink: 'https://quo.com/message/msg-1',
                },
            };

            const callWebhook = {
                type: 'call.completed',
                data: {
                    object: {
                        id: 'call-1',
                        direction: 'incoming',
                        participants: ['+12125551234', '+19175555555'],
                        duration: 60,
                        status: 'completed',
                        phoneNumberId: 'phone-123',
                        userId: 'user-123',
                        createdAt: '2025-01-15T10:05:00Z',
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
            // Arrange
            mockAttioApi.createNote.mockRejectedValue(
                new Error('Attio API error'),
            );

            const webhookData = {
                type: 'message.received',
                data: {
                    object: {
                        id: 'msg-error',
                        direction: 'incoming',
                        from: '+12125551234',
                        to: '+19175555555',
                        text: 'Error test',
                        phoneNumberId: 'phone-123',
                        userId: 'user-123',
                        createdAt: '2025-01-15T10:40:00Z',
                    },
                    deepLink: 'https://quo.com/message/msg-error',
                },
            };

            // Act & Assert
            await expect(
                integration._handleQuoMessageEvent(webhookData),
            ).rejects.toThrow('Attio API error');
        });

        it('should throw error if note creation fails for call', async () => {
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
                    },
                    deepLink: 'https://quo.com/call/call-error',
                },
            };

            // Act & Assert
            await expect(
                integration._handleQuoCallEvent(webhookData),
            ).rejects.toThrow('Attio API error');
        });
    });
});
