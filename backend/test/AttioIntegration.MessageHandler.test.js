/**
 * Message Handler Tests (TDD)
 *
 * Bug: Production error - this.integrationMappingRepository.get is not a function
 * Root Cause: Line 1920 uses wrong API (integrationMappingRepository.get vs getMapping)
 *
 * Test Plan:
 * 1. Verify message handler uses correct getMapping() API for duplicate detection
 * 2. Verify message handler correctly logs messages to Attio
 * 3. Verify message handler stores mapping after logging
 * 4. Verify duplicate messages are skipped
 */

const AttioIntegration = require('../src/integrations/AttioIntegration');
const {
    mockGetPhoneNumber,
    mockGetUser,
} = require('./fixtures/quo-api-responses');
const {
    messageReceivedWebhook,
    messageDeliveredWebhook,
} = require('./fixtures/quo-v4-webhooks');

describe('AttioIntegration - Message Handler (Bug Fix)', () => {
    let integration;
    let mockAttioApi;
    let mockQuoApi;
    let mockCommands;

    beforeEach(() => {
        mockAttioApi = {
            api: {
                createNote: jest.fn().mockResolvedValue({ id: 'note-123' }),
                deleteNote: jest.fn(),
                getRecord: jest.fn(),
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
            updateIntegrationStatus: { execute: jest.fn() },
            updateIntegrationMessages: { execute: jest.fn() },
            findOrganizationUserById: jest.fn().mockResolvedValue({
                id: 'test-user-id',
                email: 'test@example.com',
            }),
        };

        integration = new AttioIntegration({
            credential: {},
            integrationConfig: {},
            id: 'test-integration-id',
        });

        integration.attio = mockAttioApi;
        integration.quo = mockQuoApi;
        integration.commands = mockCommands;
        integration.config = {
            quoCallWebhookKey: 'test-key',
            phoneNumbersMetadata: [
                { number: '+15551234567', name: 'Sales Line' },
            ],
        };

        integration.upsertMapping = jest.fn().mockResolvedValue({});
        integration.getMapping = jest.fn().mockResolvedValue(null);
        integration._findAttioContactFromQuoWebhook = jest
            .fn()
            .mockResolvedValue('attio-contact-123');
        integration.logSMSToActivity = jest.fn().mockResolvedValue('note-123');
    });

    describe('Bug Fix: Uses correct getMapping() API', () => {
        it('should use getMapping() to check for duplicate messages (not integrationMappingRepository.get)', async () => {
            // Use centralized webhook fixture
            const webhookData = messageReceivedWebhook;

            // Mock no existing mapping (first message)
            integration.getMapping.mockResolvedValueOnce(null);

            mockQuoApi.api.getPhoneNumber.mockResolvedValue(
                mockGetPhoneNumber.salesLine,
            );
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.johnSmith);

            await integration._handleQuoMessageEvent(webhookData);

            // CRITICAL: Should use getMapping() not integrationMappingRepository.get()
            expect(integration.getMapping).toHaveBeenCalledWith(
                webhookData.data.object.id,
            );
            expect(integration.getMapping).toHaveBeenCalledTimes(1);

            // Should have logged SMS to Attio
            expect(integration.logSMSToActivity).toHaveBeenCalled();

            // Should have stored mapping to prevent future duplicates
            expect(integration.upsertMapping).toHaveBeenCalledWith(
                webhookData.data.object.id,
                expect.objectContaining({
                    messageId: webhookData.data.object.id,
                }),
            );
        });

        it('should skip duplicate messages when mapping exists', async () => {
            // Use centralized webhook fixture
            const webhookData = messageReceivedWebhook;

            // Mock existing mapping (duplicate)
            integration.getMapping.mockResolvedValueOnce({
                messageId: webhookData.data.object.id,
                noteId: 'note-existing-123',
                contactId: 'attio-contact-123',
            });

            const result =
                await integration._handleQuoMessageEvent(webhookData);

            // Should have checked for duplicate using getMapping
            expect(integration.getMapping).toHaveBeenCalledWith(
                webhookData.data.object.id,
            );

            // Should skip logging duplicate
            expect(result.skipped).toBe(true);
            expect(result.reason).toBe('duplicate');

            // Should NOT create new note
            expect(mockAttioApi.api.createNote).not.toHaveBeenCalled();

            // Should NOT create new mapping
            expect(integration.upsertMapping).not.toHaveBeenCalled();
        });
    });

    describe('Message Logging Workflow', () => {
        it('should log incoming messages to Attio with correct formatting', async () => {
            // Use centralized webhook fixture
            const webhookData = messageReceivedWebhook;

            integration.getMapping.mockResolvedValueOnce(null);
            mockQuoApi.api.getPhoneNumber.mockResolvedValue(
                mockGetPhoneNumber.salesLine,
            );
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.johnSmith);

            await integration._handleQuoMessageEvent(webhookData);

            // Should have found contact from external phone
            expect(
                integration._findAttioContactFromQuoWebhook,
            ).toHaveBeenCalledWith(webhookData.data.object.from);

            // Should have logged SMS with message content
            expect(integration.logSMSToActivity).toHaveBeenCalledWith(
                expect.objectContaining({
                    contactExternalId: 'attio-contact-123',
                    content: expect.stringContaining('more information'),
                    title: expect.stringContaining('Message'),
                }),
            );
        });

        it('should log outgoing messages to Attio', async () => {
            // Use centralized webhook fixture for outgoing message
            const webhookData = messageDeliveredWebhook;

            integration.getMapping.mockResolvedValueOnce(null);
            mockQuoApi.api.getPhoneNumber.mockResolvedValue(
                mockGetPhoneNumber.salesLine,
            );
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.johnSmith);

            await integration._handleQuoMessageEvent(webhookData);

            // Should have found contact from recipient phone (outgoing = use 'to')
            expect(
                integration._findAttioContactFromQuoWebhook,
            ).toHaveBeenCalledWith(webhookData.data.object.to);

            // Should have logged SMS
            expect(integration.logSMSToActivity).toHaveBeenCalled();
        });

        it('should skip logging when contact not found in Attio', async () => {
            const webhookData = {
                type: 'message.received',
                data: {
                    object: {
                        id: 'MSG_NO_CONTACT',
                        from: '+15559999999',
                        to: '+15551234567',
                        text: 'Unknown contact message',
                        direction: 'incoming',
                        createdAt: '2025-01-15T10:30:00Z',
                        phoneNumberId: 'PN_TEST_001',
                        userId: 'US_TEST_001',
                    },
                    deepLink: 'https://my.quo.com/messages/MSG_NO_CONTACT',
                },
            };

            integration.getMapping.mockResolvedValueOnce(null);
            integration._findAttioContactFromQuoWebhook.mockResolvedValueOnce(
                null,
            );
            mockQuoApi.api.getPhoneNumber.mockResolvedValue(
                mockGetPhoneNumber.salesLine,
            );
            mockQuoApi.api.getUser.mockResolvedValue(mockGetUser.johnSmith);

            const result =
                await integration._handleQuoMessageEvent(webhookData);

            // Should have checked for duplicate
            expect(integration.getMapping).toHaveBeenCalled();

            // Should have tried to find contact
            expect(
                integration._findAttioContactFromQuoWebhook,
            ).toHaveBeenCalled();

            // New behavior: Should NOT log when no contact found (consistent across all integrations)
            expect(integration.logSMSToActivity).not.toHaveBeenCalled();

            // Should return appropriate error result
            expect(result.logged).toBe(false);
            expect(result.error).toBe('Contact not found');
        });
    });
});
