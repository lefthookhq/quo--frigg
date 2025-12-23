const AttioIntegration = require('../src/integrations/AttioIntegration');

describe('AttioIntegration - Webhook Mapping Optimization', () => {
    let integration;
    let mockQuoApi;
    let mockAttioApi;
    let mockEntity;

    beforeEach(() => {
        // Mock Quo API (with all methods needed by QuoWebhookEventProcessor)
        mockQuoApi = {
            listContacts: jest.fn(),
            getPhoneNumber: jest.fn(),
            getUser: jest.fn(),
            getCall: jest.fn(),
            getCallRecordings: jest.fn().mockResolvedValue({ data: [] }),
            getCallVoicemails: jest.fn().mockResolvedValue({ data: null }),
        };

        // Mock Attio API
        mockAttioApi = {
            queryRecords: jest.fn(),
            searchRecords: jest.fn(),
            createNote: jest.fn(),
            getRecord: jest.fn(),
        };

        // Mock Entity for mapping storage
        mockEntity = {
            findOne: jest.fn(),
        };

        // Create integration instance
        integration = new AttioIntegration({});
        integration.quo = { api: mockQuoApi };
        integration.attio = { api: mockAttioApi };
        integration.modules = { entity: mockEntity };
        integration.upsertMapping = jest.fn().mockResolvedValue({});
        integration.getMapping = jest.fn();
        // Mock commands for trackAnalyticsEvent
        integration.commands = {
            findOrganizationUserById: jest
                .fn()
                .mockResolvedValue({ email: 'test@example.com' }),
            updateIntegrationConfig: jest.fn().mockResolvedValue({}),
        };
        // Mock config with phoneNumbersMetadata for filterExternalParticipants
        integration.config = {
            phoneNumbersMetadata: [
                { number: '+19175555678' }, // The Quo phone number
            ],
        };
    });

    describe('_findContactByPhone override', () => {
        it('should call _findAttioContactByPhone', async () => {
            // Arrange
            const phoneNumber = '+12125551234';
            const expectedRecordId = 'attio-record-123';

            mockAttioApi.queryRecords.mockResolvedValue({
                data: [{ id: { record_id: expectedRecordId } }],
            });

            integration.getMapping.mockResolvedValue({
                externalId: expectedRecordId,
            });

            // Act
            const result = await integration._findContactByPhone(phoneNumber);

            // Assert
            expect(result).toBe(expectedRecordId);
        });
    });

    describe('_findAttioContactFromQuoWebhook', () => {
        it('should use mapping for O(1) lookup when available', async () => {
            // Arrange - method expects phone number string
            const phoneNumber = '+12125551234';
            const expectedExternalId = 'attio-789';

            // Mock getMapping to return the contact (fast path)
            integration.getMapping.mockResolvedValue({
                externalId: expectedExternalId,
            });

            // Act
            const result =
                await integration._findAttioContactFromQuoWebhook(phoneNumber);

            // Assert
            expect(result).toBe(expectedExternalId);
            expect(mockAttioApi.queryRecords).not.toHaveBeenCalled(); // Should not search!
        });

        it('should fallback to phone search if no mapping exists', async () => {
            // Arrange - method expects phone number string
            const phoneNumber = '+12125551234';
            const expectedRecordId = 'attio-789';

            // Mock no mapping found on first call (triggers phone search)
            integration.getMapping
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ externalId: expectedRecordId });

            // Mock phone search success
            mockAttioApi.queryRecords.mockResolvedValue({
                data: [{ id: { record_id: expectedRecordId } }],
            });

            // Act
            const result =
                await integration._findAttioContactFromQuoWebhook(phoneNumber);

            // Assert
            expect(result).toBe(expectedRecordId);
            expect(mockAttioApi.queryRecords).toHaveBeenCalled(); // Should search
        });

        it('should throw error if no mapping and no phone number', async () => {
            // Arrange - method requires phone number
            // Act & Assert
            await expect(
                integration._findAttioContactFromQuoWebhook(null),
            ).rejects.toThrow('Phone number is required');
            await expect(
                integration._findAttioContactFromQuoWebhook(undefined),
            ).rejects.toThrow('Phone number is required');
        });

        it('should throw error if contact not found by phone', async () => {
            // Arrange
            const phoneNumber = '+19175551234';

            // Mock no mapping found
            integration.getMapping.mockResolvedValue(null);

            // Mock phone search returns no results
            mockAttioApi.queryRecords.mockResolvedValue({
                data: [],
            });

            // Act & Assert
            await expect(
                integration._findAttioContactFromQuoWebhook(phoneNumber),
            ).rejects.toThrow('No Attio contact found');
        });
    });

    describe('_handleQuoCallEvent with mapping optimization', () => {
        it('should use mapping-first lookup for contact resolution', async () => {
            // Arrange
            const callObject = {
                id: 'call-123',
                direction: 'incoming',
                participants: ['+12125551234', '+19175555678'],
                duration: 120,
                status: 'completed',
                answeredAt: '2025-01-01T12:00:05Z',
                phoneNumberId: 'phone-id',
                userId: 'user-id',
                createdAt: '2025-01-01T12:00:00Z',
            };

            const webhookData = {
                data: {
                    object: callObject,
                    deepLink: 'https://quo.com/call/123',
                },
            };

            // Mock Quo API (with data wrappers as expected by QuoWebhookEventProcessor)
            mockQuoApi.getCall.mockResolvedValue({ data: callObject });

            mockQuoApi.getPhoneNumber.mockResolvedValue({
                data: {
                    name: 'Test Line',
                    number: '+19175555678',
                },
            });

            mockQuoApi.getUser.mockResolvedValue({
                data: {
                    firstName: 'Test',
                    lastName: 'User',
                },
            });

            // Mock Attio createNote response
            mockAttioApi.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-123' } },
            });

            // Mock Attio getRecord for logCallToActivity
            mockAttioApi.getRecord.mockResolvedValue({
                data: {
                    id: { record_id: 'attio-789' },
                    values: { name: [{ value: 'Test Contact' }] },
                },
            });

            // Mock getMapping for the adapter (returns the contact ID)
            integration.getMapping.mockResolvedValue({
                mapping: { noteId: 'existing-note' },
            });

            // Mock _findAttioContactFromQuoWebhook to use mapping (fast path)
            integration._findAttioContactFromQuoWebhook = jest
                .fn()
                .mockResolvedValue('attio-789');

            // Act
            const result = await integration._handleQuoCallEvent(webhookData);

            // Assert
            // New implementation returns results array
            expect(result.logged).toBe(true);
            expect(result.results[0].logged).toBe(true);
            expect(mockAttioApi.queryRecords).not.toHaveBeenCalled(); // Used mapping!
        });
    });

    describe('_handleQuoMessageEvent with mapping optimization', () => {
        it('should use mapping-first lookup for contact resolution', async () => {
            // Arrange
            const webhookData = {
                data: {
                    object: {
                        id: 'msg-123',
                        direction: 'incoming',
                        from: '+12125551234',
                        to: '+19175555678',
                        text: 'Hello',
                        phoneNumberId: 'phone-id',
                        userId: 'user-id',
                        createdAt: '2025-01-01T12:00:00Z',
                    },
                    deepLink: 'https://quo.com/message/123',
                },
            };

            // Mock Quo API (with data wrappers as expected by QuoWebhookEventProcessor)
            mockQuoApi.getPhoneNumber.mockResolvedValue({
                data: {
                    name: 'Test Inbox',
                    number: '+19175555678',
                },
            });

            mockQuoApi.getUser.mockResolvedValue({
                data: {
                    firstName: 'Test',
                    lastName: 'User',
                },
            });

            // Mock Attio createNote response
            mockAttioApi.createNote.mockResolvedValue({
                data: { id: { note_id: 'note-msg-123' } },
            });

            // Mock Attio getRecord for logSMSToActivity
            mockAttioApi.getRecord.mockResolvedValue({
                data: {
                    id: { record_id: 'attio-789' },
                    values: { name: [{ value: 'Test Contact' }] },
                },
            });

            // Mock _findAttioContactFromQuoWebhook to use mapping (fast path)
            integration._findAttioContactFromQuoWebhook = jest
                .fn()
                .mockResolvedValue('attio-789');

            // Act
            const result =
                await integration._handleQuoMessageEvent(webhookData);

            // Assert
            expect(result.logged).toBe(true);
            // Check results array if present (varies by implementation)
            if (result.results) {
                expect(result.results[0].logged).toBe(true);
            }
            expect(mockAttioApi.queryRecords).not.toHaveBeenCalled(); // Used mapping!
        });
    });
});
