const QuoWebhookEventProcessor = require('./QuoWebhookEventProcessor');
const QuoCallContentBuilder = require('./QuoCallContentBuilder');

// Mock the participantFilter utility
jest.mock('../../utils/participantFilter', () => ({
    filterExternalParticipants: jest.fn((participants, metadata) => {
        // Simple mock: return all participants that don't start with "+1555"
        return participants.filter((p) => !p.startsWith('+1555'));
    }),
}));

describe('QuoWebhookEventProcessor', () => {
    // Sample call webhook data
    const createCallWebhookData = (overrides = {}) => ({
        type: 'call.completed',
        data: {
            object: {
                id: 'call_123',
                ...overrides.object,
            },
            deepLink: 'https://app.quo.com/call/123',
            ...overrides.data,
        },
    });

    // Sample message webhook data
    const createMessageWebhookData = (overrides = {}) => ({
        type: 'message.received',
        data: {
            object: {
                id: 'msg_123',
                direction: 'incoming',
                from: '+19876543210',
                to: '+15551234567',
                text: 'Hello!',
                phoneNumberId: 'phone_123',
                userId: 'user_123',
                createdAt: '2024-01-01T10:00:00Z',
                ...overrides.object,
            },
            deepLink: 'https://app.quo.com/msg/123',
            ...overrides.data,
        },
    });

    // Mock Quo API
    const createMockQuoApi = (overrides = {}) => ({
        getCall: jest.fn().mockResolvedValue({
            data: {
                id: 'call_123',
                status: 'completed',
                direction: 'incoming',
                answeredAt: '2024-01-01T10:00:00Z',
                duration: 120,
                participants: ['+19876543210', '+15551234567'],
                phoneNumberId: 'phone_123',
                userId: 'user_123',
                createdAt: '2024-01-01T10:00:00Z',
                ...overrides.call,
            },
        }),
        getCallVoicemails: jest.fn().mockResolvedValue({
            data: null,
        }),
        getPhoneNumber: jest.fn().mockResolvedValue({
            data: {
                symbol: '📞',
                name: 'Sales',
                number: '+15551234567',
            },
        }),
        getUser: jest.fn().mockResolvedValue({
            data: {
                firstName: 'John',
                lastName: 'Doe',
            },
        }),
        ...overrides,
    });

    // Mock CRM adapter
    const createMockCrmAdapter = (overrides = {}) => ({
        formatMethod: 'markdown',
        findContactByPhone: jest
            .fn()
            .mockResolvedValue('contact_123'),
        createCallActivity: jest
            .fn()
            .mockResolvedValue('activity_123'),
        createMessageActivity: jest
            .fn()
            .mockResolvedValue('activity_456'),
        ...overrides,
    });

    // Mock mapping repository
    const createMockMappingRepo = (overrides = {}) => ({
        get: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue(undefined),
        ...overrides,
    });

    describe('processCallEvent', () => {
        it('processes call event successfully for single participant', async () => {
            const mockQuoApi = createMockQuoApi();
            const mockCrmAdapter = createMockCrmAdapter();
            const mockMappingRepo = createMockMappingRepo();

            const result = await QuoWebhookEventProcessor.processCallEvent({
                webhookData: createCallWebhookData(),
                quoApi: mockQuoApi,
                phoneNumbersMetadata: [],
                crmAdapter: mockCrmAdapter,
                mappingRepo: mockMappingRepo,
            });

            expect(result.logged).toBe(true);
            expect(result.callId).toBe('call_123');
            expect(result.results).toHaveLength(1);
            expect(result.results[0].logged).toBe(true);
            expect(result.results[0].activityId).toBe('activity_123');

            // Verify API calls
            expect(mockQuoApi.getCall).toHaveBeenCalledWith('call_123');
            expect(mockQuoApi.getPhoneNumber).toHaveBeenCalled();
            expect(mockQuoApi.getUser).toHaveBeenCalled();

            // Verify CRM adapter calls
            expect(mockCrmAdapter.findContactByPhone).toHaveBeenCalledWith(
                '+19876543210',
            );
            expect(mockCrmAdapter.createCallActivity).toHaveBeenCalled();

            // Verify mapping was stored
            expect(mockMappingRepo.upsert).toHaveBeenCalledWith(
                'call_123',
                expect.objectContaining({
                    noteId: 'activity_123',
                    callId: 'call_123',
                }),
            );
        });

        it('returns error when call not found', async () => {
            const mockQuoApi = createMockQuoApi({
                getCall: jest.fn().mockResolvedValue({ data: null }),
            });

            const result = await QuoWebhookEventProcessor.processCallEvent({
                webhookData: createCallWebhookData(),
                quoApi: mockQuoApi,
                phoneNumbersMetadata: [],
                crmAdapter: createMockCrmAdapter(),
                mappingRepo: createMockMappingRepo(),
            });

            expect(result.logged).toBe(false);
            expect(result.error).toBe('Call not found');
        });

        it('returns error when no external participants', async () => {
            const mockQuoApi = createMockQuoApi({
                call: {
                    participants: ['+15551234567', '+15559876543'], // All internal
                },
            });

            const result = await QuoWebhookEventProcessor.processCallEvent({
                webhookData: createCallWebhookData(),
                quoApi: mockQuoApi,
                phoneNumbersMetadata: [],
                crmAdapter: createMockCrmAdapter(),
                mappingRepo: createMockMappingRepo(),
            });

            expect(result.logged).toBe(false);
            expect(result.error).toBe('No external participants');
            expect(result.participantCount).toBe(0);
        });

        it('handles contact not found gracefully', async () => {
            const mockQuoApi = createMockQuoApi();
            const mockCrmAdapter = createMockCrmAdapter({
                findContactByPhone: jest.fn().mockResolvedValue(null),
            });

            const result = await QuoWebhookEventProcessor.processCallEvent({
                webhookData: createCallWebhookData(),
                quoApi: mockQuoApi,
                phoneNumbersMetadata: [],
                crmAdapter: mockCrmAdapter,
                mappingRepo: createMockMappingRepo(),
            });

            expect(result.logged).toBe(false);
            expect(result.results[0].logged).toBe(false);
            expect(result.results[0].error).toBe('Contact not found');
        });

        it('creates activity with correct title and content', async () => {
            const mockQuoApi = createMockQuoApi();
            const mockCrmAdapter = createMockCrmAdapter();

            await QuoWebhookEventProcessor.processCallEvent({
                webhookData: createCallWebhookData(),
                quoApi: mockQuoApi,
                phoneNumbersMetadata: [],
                crmAdapter: mockCrmAdapter,
                mappingRepo: createMockMappingRepo(),
            });

            const createActivityCall =
                mockCrmAdapter.createCallActivity.mock.calls[0];
            const [contactId, activity] = createActivityCall;

            expect(contactId).toBe('contact_123');
            expect(activity.title).toContain('Call');
            expect(activity.title).toContain('📞 Sales');
            expect(activity.content).toContain('Incoming answered by John Doe');
            expect(activity.content).toContain('Recording (2:00)');
            expect(activity.content).toContain('View the call activity in Quo');
        });

        it('uses HTML formatting when adapter specifies', async () => {
            const mockQuoApi = createMockQuoApi();
            const mockCrmAdapter = createMockCrmAdapter({
                formatMethod: 'html',
            });

            await QuoWebhookEventProcessor.processCallEvent({
                webhookData: createCallWebhookData(),
                quoApi: mockQuoApi,
                phoneNumbersMetadata: [],
                crmAdapter: mockCrmAdapter,
                mappingRepo: createMockMappingRepo(),
            });

            const [, activity] =
                mockCrmAdapter.createCallActivity.mock.calls[0];
            expect(activity.content).toContain('<a href=');
        });

        it('uses plainText formatting when adapter specifies', async () => {
            const mockQuoApi = createMockQuoApi();
            const mockCrmAdapter = createMockCrmAdapter({
                formatMethod: 'plainText',
            });

            await QuoWebhookEventProcessor.processCallEvent({
                webhookData: createCallWebhookData(),
                quoApi: mockQuoApi,
                phoneNumbersMetadata: [],
                crmAdapter: mockCrmAdapter,
                mappingRepo: createMockMappingRepo(),
            });

            const [, activity] =
                mockCrmAdapter.createCallActivity.mock.calls[0];
            expect(activity.content).toContain('View the call activity in Quo:');
            expect(activity.content).not.toContain('[');
            expect(activity.title).not.toContain('☎️');
        });

        it('calls onActivityCreated callback if provided', async () => {
            const mockQuoApi = createMockQuoApi();
            const onActivityCreated = jest.fn();

            await QuoWebhookEventProcessor.processCallEvent({
                webhookData: createCallWebhookData(),
                quoApi: mockQuoApi,
                phoneNumbersMetadata: [],
                crmAdapter: createMockCrmAdapter(),
                mappingRepo: createMockMappingRepo(),
                onActivityCreated,
            });

            expect(onActivityCreated).toHaveBeenCalledWith({
                callId: 'call_123',
                contactId: 'contact_123',
                contactPhone: '+19876543210',
                activityId: 'activity_123',
            });
        });
    });

    describe('processMessageEvent', () => {
        it('processes message event successfully', async () => {
            const mockQuoApi = createMockQuoApi();
            const mockCrmAdapter = createMockCrmAdapter();
            const mockMappingRepo = createMockMappingRepo();

            const result = await QuoWebhookEventProcessor.processMessageEvent({
                webhookData: createMessageWebhookData(),
                quoApi: mockQuoApi,
                crmAdapter: mockCrmAdapter,
                mappingRepo: mockMappingRepo,
            });

            expect(result.logged).toBe(true);
            expect(result.messageId).toBe('msg_123');
            expect(result.noteId).toBe('activity_456');

            // Verify mapping was stored
            expect(mockMappingRepo.upsert).toHaveBeenCalledWith(
                'msg_123',
                expect.objectContaining({
                    messageId: 'msg_123',
                    noteId: 'activity_456',
                }),
            );
        });

        it('skips duplicate messages', async () => {
            const mockMappingRepo = createMockMappingRepo({
                get: jest.fn().mockResolvedValue({
                    noteId: 'existing_note_123',
                }),
            });

            const result = await QuoWebhookEventProcessor.processMessageEvent({
                webhookData: createMessageWebhookData(),
                quoApi: createMockQuoApi(),
                crmAdapter: createMockCrmAdapter(),
                mappingRepo: mockMappingRepo,
            });

            expect(result.logged).toBe(false);
            expect(result.skipped).toBe(true);
            expect(result.reason).toBe('duplicate');
            expect(result.noteId).toBe('existing_note_123');
        });

        it('handles nested mapping structure', async () => {
            const mockMappingRepo = createMockMappingRepo({
                get: jest.fn().mockResolvedValue({
                    mapping: {
                        noteId: 'nested_note_123',
                    },
                }),
            });

            const result = await QuoWebhookEventProcessor.processMessageEvent({
                webhookData: createMessageWebhookData(),
                quoApi: createMockQuoApi(),
                crmAdapter: createMockCrmAdapter(),
                mappingRepo: mockMappingRepo,
            });

            expect(result.skipped).toBe(true);
            expect(result.noteId).toBe('nested_note_123');
        });

        it('returns error when contact not found', async () => {
            const mockCrmAdapter = createMockCrmAdapter({
                findContactByPhone: jest.fn().mockResolvedValue(null),
            });

            const result = await QuoWebhookEventProcessor.processMessageEvent({
                webhookData: createMessageWebhookData(),
                quoApi: createMockQuoApi(),
                crmAdapter: mockCrmAdapter,
                mappingRepo: createMockMappingRepo(),
            });

            expect(result.logged).toBe(false);
            expect(result.error).toBe('Contact not found');
        });

        it('creates activity with correct content for incoming message', async () => {
            const mockCrmAdapter = createMockCrmAdapter();

            await QuoWebhookEventProcessor.processMessageEvent({
                webhookData: createMessageWebhookData({
                    object: {
                        direction: 'incoming',
                        text: 'Hello there!',
                    },
                }),
                quoApi: createMockQuoApi(),
                crmAdapter: mockCrmAdapter,
                mappingRepo: createMockMappingRepo(),
            });

            const [contactId, activity] =
                mockCrmAdapter.createMessageActivity.mock.calls[0];

            expect(contactId).toBe('contact_123');
            expect(activity.title).toContain('Message');
            expect(activity.content).toContain('Received: Hello there!');
        });

        it('creates activity with correct content for outgoing message', async () => {
            const mockCrmAdapter = createMockCrmAdapter();

            await QuoWebhookEventProcessor.processMessageEvent({
                webhookData: createMessageWebhookData({
                    object: {
                        direction: 'outgoing',
                        from: '+15551234567',
                        to: '+19876543210',
                        text: 'Hi back!',
                    },
                }),
                quoApi: createMockQuoApi(),
                crmAdapter: mockCrmAdapter,
                mappingRepo: createMockMappingRepo(),
            });

            const [, activity] =
                mockCrmAdapter.createMessageActivity.mock.calls[0];

            expect(activity.content).toContain('John Doe sent: Hi back!');
        });
    });

    describe('fetchCallWithVoicemail', () => {
        it('returns call without voicemail for non no-answer calls', async () => {
            const mockQuoApi = createMockQuoApi();

            const result = await QuoWebhookEventProcessor.fetchCallWithVoicemail(
                mockQuoApi,
                'call_123',
            );

            expect(result).toBeDefined();
            expect(result.voicemail).toBeUndefined();
            expect(mockQuoApi.getCallVoicemails).not.toHaveBeenCalled();
        });

        it('fetches voicemail for no-answer calls', async () => {
            jest.useFakeTimers();

            const mockQuoApi = createMockQuoApi({
                call: { status: 'no-answer' },
                getCallVoicemails: jest.fn().mockResolvedValue({
                    data: {
                        status: 'completed',
                        duration: 30,
                        recordingUrl: 'http://example.com/vm.mp3',
                        transcript: 'Test voicemail',
                        id: 'vm_123',
                    },
                }),
            });

            const fetchPromise =
                QuoWebhookEventProcessor.fetchCallWithVoicemail(
                    mockQuoApi,
                    'call_123',
                );

            // Fast-forward the 3-second wait
            await jest.advanceTimersByTimeAsync(3000);

            const result = await fetchPromise;

            expect(result.voicemail).toBeDefined();
            expect(result.voicemail.duration).toBe(30);
            expect(result.voicemail.url).toBe('http://example.com/vm.mp3');
            expect(result.voicemail.transcript).toBe('Test voicemail');

            jest.useRealTimers();
        });

        it('returns null when call not found', async () => {
            const mockQuoApi = createMockQuoApi({
                getCall: jest.fn().mockResolvedValue({ data: null }),
            });

            const result = await QuoWebhookEventProcessor.fetchCallWithVoicemail(
                mockQuoApi,
                'call_123',
            );

            expect(result).toBeNull();
        });

        it('handles voicemail fetch error gracefully', async () => {
            jest.useFakeTimers();

            const mockQuoApi = createMockQuoApi({
                call: { status: 'no-answer' },
                getCallVoicemails: jest
                    .fn()
                    .mockRejectedValue(new Error('API error')),
            });

            const fetchPromise =
                QuoWebhookEventProcessor.fetchCallWithVoicemail(
                    mockQuoApi,
                    'call_123',
                );

            await jest.advanceTimersByTimeAsync(3000);

            const result = await fetchPromise;

            // Should return call without voicemail, not throw
            expect(result).toBeDefined();
            expect(result.voicemail).toBeUndefined();

            jest.useRealTimers();
        });
    });

    describe('fetchCallMetadata', () => {
        it('fetches and formats metadata correctly', async () => {
            const mockQuoApi = createMockQuoApi();

            const result = await QuoWebhookEventProcessor.fetchCallMetadata(
                mockQuoApi,
                'phone_123',
                'user_123',
            );

            expect(result.inboxName).toBe('📞 Sales');
            expect(result.inboxNumber).toBe('+15551234567');
            expect(result.userName).toBe('John Doe');
        });

        it('uses defaults for missing data', async () => {
            const mockQuoApi = createMockQuoApi({
                getPhoneNumber: jest.fn().mockResolvedValue({ data: null }),
                getUser: jest.fn().mockResolvedValue({ data: null }),
            });

            const result = await QuoWebhookEventProcessor.fetchCallMetadata(
                mockQuoApi,
                'phone_123',
                'user_123',
            );

            expect(result.inboxName).toBe('Quo Line');
            expect(result.inboxNumber).toBe('');
            expect(result.userName).toBe('Quo User');
        });
    });
});
