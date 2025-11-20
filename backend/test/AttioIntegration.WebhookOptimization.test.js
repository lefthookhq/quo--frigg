const AttioIntegration = require('../src/integrations/AttioIntegration');

describe('AttioIntegration - Webhook Mapping Optimization', () => {
    let integration;
    let mockQuoApi;
    let mockAttioApi;
    let mockEntity;

    beforeEach(() => {
        // Mock Quo API
        mockQuoApi = {
            listContacts: jest.fn(),
            getPhoneNumber: jest.fn(),
            getUser: jest.fn(),
        };

        // Mock Attio API
        mockAttioApi = {
            queryRecords: jest.fn(),
            searchRecords: jest.fn(),
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
            // Arrange
            const quoContact = {
                id: 'quo-456',
                defaultFields: {
                    phoneNumbers: [{ value: '+12125551234' }],
                },
            };

            const expectedExternalId = 'attio-789';

            // Mock mapping lookup
            mockEntity.findOne.mockResolvedValue({
                config: {
                    externalId: expectedExternalId,
                    quoContactId: quoContact.id,
                },
            });

            // Act
            const result =
                await integration._findAttioContactFromQuoWebhook(quoContact);

            // Assert
            expect(result).toBe(expectedExternalId);
            expect(mockAttioApi.queryRecords).not.toHaveBeenCalled(); // Should not search!
        });

        it('should fallback to phone search if no mapping exists', async () => {
            // Arrange
            const quoContact = {
                id: 'quo-456',
                defaultFields: {
                    phoneNumbers: [{ value: '+12125551234' }],
                },
            };

            const expectedRecordId = 'attio-789';

            // Mock no mapping found
            mockEntity.findOne.mockResolvedValue(null);

            // Mock phone search success
            mockAttioApi.queryRecords.mockResolvedValue({
                data: [{ id: { record_id: expectedRecordId } }],
            });

            integration.getMapping.mockResolvedValue({
                externalId: expectedRecordId,
            });

            // Act
            const result =
                await integration._findAttioContactFromQuoWebhook(quoContact);

            // Assert
            expect(result).toBe(expectedRecordId);
            expect(mockAttioApi.queryRecords).toHaveBeenCalled(); // Should search
            expect(integration.upsertMapping).toHaveBeenCalledWith(
                expectedRecordId,
                expect.objectContaining({
                    externalId: expectedRecordId,
                    quoContactId: quoContact.id,
                    action: 'backfill',
                }),
            );
        });

        it('should throw error if no mapping and no phone number', async () => {
            // Arrange
            const quoContact = {
                id: 'quo-456',
                defaultFields: {
                    // No phone numbers
                },
            };

            // Mock no mapping found
            mockEntity.findOne.mockResolvedValue(null);

            // Act & Assert
            await expect(
                integration._findAttioContactFromQuoWebhook(quoContact),
            ).rejects.toThrow('Cannot find Attio contact');
            await expect(
                integration._findAttioContactFromQuoWebhook(quoContact),
            ).rejects.toThrow('No mapping');
        });

        it('should create mapping after successful phone search', async () => {
            // Arrange
            const quoContact = {
                id: 'quo-new',
                defaultFields: {
                    phoneNumbers: [{ value: '+19175551234' }],
                },
            };

            const foundRecordId = 'attio-new';

            mockEntity.findOne.mockResolvedValue(null);
            mockAttioApi.queryRecords.mockResolvedValue({
                data: [{ id: { record_id: foundRecordId } }],
            });
            integration.getMapping.mockResolvedValue({
                externalId: foundRecordId,
            });

            // Act
            await integration._findAttioContactFromQuoWebhook(quoContact);

            // Assert
            expect(integration.upsertMapping).toHaveBeenCalledWith(
                foundRecordId,
                expect.objectContaining({
                    externalId: foundRecordId,
                    quoContactId: 'quo-new',
                    phoneNumber: '+19175551234',
                    syncMethod: 'webhook',
                    action: 'backfill',
                }),
            );
        });
    });

    describe('_handleQuoCallEvent with mapping optimization', () => {
        it('should use mapping-first lookup for contact resolution', async () => {
            // Arrange
            const webhookData = {
                data: {
                    object: {
                        id: 'call-123',
                        direction: 'incoming',
                        participants: ['+12125551234', '+19175555678'],
                        duration: 120,
                        status: 'completed',
                        phoneNumberId: 'phone-id',
                        userId: 'user-id',
                        createdAt: '2025-01-01T12:00:00Z',
                    },
                    deepLink: 'https://quo.com/call/123',
                },
            };

            const quoContact = {
                id: 'quo-456',
                defaultFields: { phoneNumbers: [{ value: '+12125551234' }] },
            };

            // Mock Quo API
            mockQuoApi.listContacts.mockResolvedValue({
                data: [quoContact],
            });

            mockQuoApi.getPhoneNumber.mockResolvedValue({
                name: 'Test Line',
                phoneNumber: '+19175555678',
            });

            mockQuoApi.getUser.mockResolvedValue({
                name: 'Test User',
            });

            // Mock mapping lookup (fast path)
            mockEntity.findOne.mockResolvedValue({
                config: {
                    externalId: 'attio-789',
                    quoContactId: 'quo-456',
                },
            });

            integration.logCallToActivity = jest.fn().mockResolvedValue({});

            // Act
            const result = await integration._handleQuoCallEvent(webhookData);

            // Assert
            expect(result.logged).toBe(true);
            expect(result.contactId).toBe('attio-789');
            expect(mockQuoApi.listContacts).toHaveBeenCalledWith({
                phoneNumbers: ['+12125551234'],
                maxResults: 1,
            });
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

            const quoContact = {
                id: 'quo-456',
                defaultFields: { phoneNumbers: [{ value: '+12125551234' }] },
            };

            // Mock Quo API
            mockQuoApi.listContacts.mockResolvedValue({
                data: [quoContact],
            });

            mockQuoApi.getPhoneNumber.mockResolvedValue({
                name: 'Test Inbox',
            });

            mockQuoApi.getUser.mockResolvedValue({
                name: 'Test User',
            });

            // Mock mapping lookup (fast path)
            mockEntity.findOne.mockResolvedValue({
                config: {
                    externalId: 'attio-789',
                    quoContactId: 'quo-456',
                },
            });

            integration.logSMSToActivity = jest.fn().mockResolvedValue({});

            // Act
            const result =
                await integration._handleQuoMessageEvent(webhookData);

            // Assert
            expect(result.logged).toBe(true);
            expect(result.contactId).toBe('attio-789');
            expect(mockAttioApi.queryRecords).not.toHaveBeenCalled(); // Used mapping!
        });
    });
});
