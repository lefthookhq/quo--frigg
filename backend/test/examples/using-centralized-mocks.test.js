/**
 * Example: Using Centralized Mock Fixtures
 *
 * This test demonstrates how to use the centralized Quo API mock fixtures
 * instead of inline mocking. This approach:
 * - Reduces code duplication
 * - Makes tests more maintainable
 * - Ensures consistency across test suite
 * - Makes it easier to update when API changes
 */

const AttioIntegration = require('../../src/integrations/AttioIntegration');
const {
    mockGetPhoneNumber,
    mockGetUser,
    mockGetCall,
    setupStandardQuoMocks,
} = require('../fixtures/quo-api-responses');
const { callCompletedWebhook } = require('../fixtures/quo-v4-webhooks');

describe('Example: Using Centralized Mock Fixtures', () => {
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
        integration.config = { quoCallWebhookKey: 'test-key' };

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
                    name: [{ value: 'Jane Doe' }],
                },
            },
        });
    });

    describe('Approach 1: Manual Mock Setup', () => {
        it('should handle incoming call using centralized fixtures', async () => {
            // ✅ GOOD: Use centralized mock fixtures
            mockQuoApi.api.getPhoneNumber.mockResolvedValue(mockGetPhoneNumber.salesLine);
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.johnSmith);

            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-123' } },
            });

            // Act
            await integration._handleQuoCallEvent(callCompletedWebhook);

            // Assert
            expect(mockQuoApi.api.getPhoneNumber).toHaveBeenCalledWith('PNSeQ1TGZU');
            expect(mockQuoApi.api.getUser).toHaveBeenCalledWith('USpvVF3Lo2');
            expect(mockAttioApi.api.createNote).toHaveBeenCalled();
        });
    });

    describe('Approach 2: Helper Function Setup', () => {
        it('should handle incoming call using helper function', async () => {
            // ✅ BEST: Use helper function for common scenarios
            setupStandardQuoMocks(mockQuoApi, 'incoming');

            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-123' } },
            });

            // Act
            await integration._handleQuoCallEvent(callCompletedWebhook);

            // Assert
            expect(mockAttioApi.api.createNote).toHaveBeenCalled();
            const noteContent = mockAttioApi.api.createNote.mock.calls[0][0].content;
            expect(noteContent).toContain('Incoming answered');
        });

        it('should handle outgoing call using helper function', async () => {
            // ✅ BEST: Quick setup for outgoing scenario
            setupStandardQuoMocks(mockQuoApi, 'outgoing');

            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-456' } },
            });

            // Use outgoing webhook fixture
            const outgoingWebhook = {
                ...callCompletedWebhook,
                data: {
                    ...callCompletedWebhook.data,
                    object: {
                        ...callCompletedWebhook.data.object,
                        direction: 'outgoing',
                        // Participants reversed for outgoing
                        participants: ['+15551234567', '+15559876543'],
                    },
                },
            };

            // Act
            await integration._handleQuoCallEvent(outgoingWebhook);

            // Assert
            const noteContent = mockAttioApi.api.createNote.mock.calls[0][0].content;
            expect(noteContent).toContain('Outgoing');
        });
    });

    describe('Approach 3: Mixing Fixtures and Custom Data', () => {
        it('should handle call with custom phone number but standard user', async () => {
            // ✅ FLEXIBLE: Mix fixtures with custom data
            const customPhoneNumber = {
                data: {
                    ...mockGetPhoneNumber.salesLine.data,
                    name: 'Custom VIP Line',
                    symbol: '⭐',
                },
            };

            mockQuoApi.api.getPhoneNumber.mockResolvedValue(customPhoneNumber);
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.janeDoe); // Different user

            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-custom' } },
            });

            // Act
            await integration._handleQuoCallEvent(callCompletedWebhook);

            // Assert
            const noteContent = mockAttioApi.api.createNote.mock.calls[0][0].title;
            expect(noteContent).toContain('⭐ Custom VIP Line');
            expect(mockAttioApi.api.createNote.mock.calls[0][0].content).toContain('Jane Doe');
        });
    });

    describe('❌ ANTI-PATTERN: Avoid Inline Mocking', () => {
        it('demonstrates what NOT to do - inline mocking', async () => {
            // ❌ BAD: Don't inline mock like this
            mockQuoApi.api.getPhoneNumber.mockResolvedValue({
                data: {
                    id: 'PN123',
                    name: 'Sales',
                    symbol: '📞',
                    number: '+15551234567',
                    formattedNumber: '(555) 123-4567',
                    groupId: 'GR123',
                    users: [],
                    createdAt: '2025-01-01T00:00:00.000Z',
                    updatedAt: '2025-01-01T00:00:00.000Z',
                },
            });

            mockQuoApi.api.getUser.mockResolvedValue({
                data: {
                    id: 'US123',
                    firstName: 'John',
                    lastName: 'Smith',
                    email: 'john@example.com',
                },
            });

            // Problems with this approach:
            // 1. Duplicated across many tests
            // 2. Hard to maintain when API changes
            // 3. Inconsistent data between tests
            // 4. Verbose and clutters test logic

            mockAttioApi.api.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-bad' } },
            });

            await integration._handleQuoCallEvent(callCompletedWebhook);

            expect(mockAttioApi.api.createNote).toHaveBeenCalled();
        });
    });
});

/**
 * SUMMARY: Best Practices
 *
 * ✅ DO:
 * - Use mockGetPhoneNumber, mockGetUser, mockGetCall from fixtures
 * - Use setupStandardQuoMocks() helper for common scenarios
 * - Mix fixtures with custom overrides when needed
 * - Keep test logic focused on what you're testing
 *
 * ❌ DON'T:
 * - Inline mock entire API responses
 * - Copy-paste mock data across tests
 * - Create custom mock data unless testing edge cases
 * - Mix different mock styles in same test file
 *
 * 📦 BENEFITS:
 * - Single source of truth for API response shapes
 * - Easy to update when API changes
 * - Consistent test data across suite
 * - Less code duplication
 * - Faster test writing
 */
