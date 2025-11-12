const AttioIntegration = require('../src/integrations/AttioIntegration');

describe('AttioIntegration - Enhanced 409 Conflict Handling', () => {
    let integration;
    let mockQuoApi;
    let mockAttioApi;

    beforeEach(() => {
        // Mock Quo API
        mockQuoApi = {
            createContact: jest.fn(),
            updateContact: jest.fn(),
            listContacts: jest.fn(),
        };

        // Mock Attio API
        mockAttioApi = {};

        // Create integration instance
        integration = new AttioIntegration({});
        integration.quo = { api: mockQuoApi };
        integration.attio = { api: mockAttioApi };
        integration.upsertMapping = jest.fn().mockResolvedValue({});
        integration.transformPersonToQuo = jest.fn();
    });

    describe('_syncPersonToQuo - 409 handling with PATCH', () => {
        it('should create mapping and PATCH contact on 409 conflict', async () => {
            // Arrange
            const attioRecord = {
                id: { record_id: 'attio-123' },
                values: {
                    name: [{ first_name: 'John', last_name: 'Doe' }],
                },
            };

            const quoContact = {
                externalId: 'attio-123',
                defaultFields: {
                    firstName: 'John',
                    lastName: 'Doe',
                    phoneNumbers: [{ value: '+12125551234' }],
                },
            };

            const existingContact = {
                id: 'quo-existing-456',
                externalId: 'attio-123',
                defaultFields: {
                    firstName: 'John Old',
                    phoneNumbers: [{ value: '+12125551234' }],
                },
            };

            integration.transformPersonToQuo.mockResolvedValue(quoContact);

            // Mock 409 error on create
            mockQuoApi.createContact.mockRejectedValue({
                status: 409,
                code: '0800409',
                message: 'Failed to create contact',
            });

            // Mock listContacts returns existing contact
            mockQuoApi.listContacts.mockResolvedValue({
                data: [existingContact],
            });

            mockQuoApi.updateContact.mockResolvedValue({ data: existingContact });

            // Act
            await integration._syncPersonToQuo(attioRecord, 'created');

            // Assert - Should create mapping
            expect(integration.upsertMapping).toHaveBeenCalledWith(
                'attio-123',
                expect.objectContaining({
                    externalId: 'attio-123',
                    quoContactId: 'quo-existing-456',
                    phoneNumber: '+12125551234',
                    action: 'conflict_resolved',
                }),
            );

            // Assert - Should PATCH with updated data
            expect(mockQuoApi.updateContact).toHaveBeenCalledWith(
                'quo-existing-456',
                expect.objectContaining({
                    defaultFields: {
                        firstName: 'John',
                        lastName: 'Doe',
                        phoneNumbers: [{ value: '+12125551234' }],
                    },
                }),
            );

            // Assert - Should NOT include externalId in update
            expect(mockQuoApi.updateContact).toHaveBeenCalledWith(
                'quo-existing-456',
                expect.not.objectContaining({
                    externalId: expect.anything(),
                }),
            );
        });

        it('should throw error if 409 but contact not found by externalId', async () => {
            // Arrange
            const attioRecord = {
                id: { record_id: 'attio-orphan' },
            };

            const quoContact = {
                externalId: 'attio-orphan',
                defaultFields: { firstName: 'Orphan' },
            };

            integration.transformPersonToQuo.mockResolvedValue(quoContact);

            // Mock 409 error
            mockQuoApi.createContact.mockRejectedValue({
                status: 409,
                code: '0800409',
            });

            // Mock listContacts returns empty (contact disappeared)
            mockQuoApi.listContacts.mockResolvedValue({
                data: [],
            });

            // Act & Assert
            await expect(
                integration._syncPersonToQuo(attioRecord, 'created'),
            ).rejects.toThrow('409 conflict but contact not found');
        });

        it('should handle 409 with code field', async () => {
            // Arrange
            const attioRecord = {
                id: { record_id: 'attio-123' },
            };

            const quoContact = {
                externalId: 'attio-123',
                defaultFields: { firstName: 'Test' },
            };

            const existingContact = {
                id: 'quo-456',
                externalId: 'attio-123',
                defaultFields: { phoneNumbers: [{ value: '+1234567890' }] },
            };

            integration.transformPersonToQuo.mockResolvedValue(quoContact);

            // Mock 409 with only code field (no status field)
            mockQuoApi.createContact.mockRejectedValue({
                code: '0800409',
                message: 'Conflict',
            });

            mockQuoApi.listContacts.mockResolvedValue({
                data: [existingContact],
            });

            mockQuoApi.updateContact.mockResolvedValue({ data: existingContact });

            // Act
            await integration._syncPersonToQuo(attioRecord, 'created');

            // Assert - Should handle 409 even without status field
            expect(integration.upsertMapping).toHaveBeenCalled();
            expect(mockQuoApi.updateContact).toHaveBeenCalled();
        });

        it('should create mapping with phone number from existing contact', async () => {
            // Arrange
            const attioRecord = {
                id: { record_id: 'attio-123' },
            };

            const quoContact = {
                externalId: 'attio-123',
                defaultFields: { firstName: 'Test' },
            };

            const existingContact = {
                id: 'quo-456',
                externalId: 'attio-123',
                defaultFields: {
                    phoneNumbers: [
                        { value: '+12125551234', type: 'mobile' },
                    ],
                },
            };

            integration.transformPersonToQuo.mockResolvedValue(quoContact);

            mockQuoApi.createContact.mockRejectedValue({
                status: 409,
                code: '0800409',
            });

            mockQuoApi.listContacts.mockResolvedValue({
                data: [existingContact],
            });

            mockQuoApi.updateContact.mockResolvedValue({ data: existingContact });

            // Act
            await integration._syncPersonToQuo(attioRecord, 'created');

            // Assert
            expect(integration.upsertMapping).toHaveBeenCalledWith(
                'attio-123',
                expect.objectContaining({
                    phoneNumber: '+12125551234',
                }),
            );
        });

        it('should re-throw non-409 errors', async () => {
            // Arrange
            const attioRecord = {
                id: { record_id: 'attio-123' },
            };

            const quoContact = {
                externalId: 'attio-123',
                defaultFields: { firstName: 'Test' },
            };

            integration.transformPersonToQuo.mockResolvedValue(quoContact);

            // Mock 500 error (not 409)
            mockQuoApi.createContact.mockRejectedValue({
                status: 500,
                message: 'Internal Server Error',
            });

            // Act & Assert
            await expect(
                integration._syncPersonToQuo(attioRecord, 'created'),
            ).rejects.toMatchObject({
                status: 500,
            });

            // Should NOT attempt to fetch existing contact
            expect(mockQuoApi.listContacts).not.toHaveBeenCalled();
        });

        it('should successfully create contact without 409', async () => {
            // Arrange
            const attioRecord = {
                id: { record_id: 'attio-new' },
            };

            const quoContact = {
                externalId: 'attio-new',
                defaultFields: { firstName: 'New' },
            };

            const createdContact = {
                id: 'quo-new-789',
                externalId: 'attio-new',
            };

            integration.transformPersonToQuo.mockResolvedValue(quoContact);

            mockQuoApi.createContact.mockResolvedValue({
                data: createdContact,
            });

            // Act
            await integration._syncPersonToQuo(attioRecord, 'created');

            // Assert - Should create mapping for new contact
            expect(integration.upsertMapping).toHaveBeenCalledWith(
                'attio-new',
                expect.objectContaining({
                    externalId: 'attio-new',
                    quoContactId: 'quo-new-789',
                    action: 'created',
                }),
            );

            // Should NOT call update
            expect(mockQuoApi.updateContact).not.toHaveBeenCalled();
        });
    });
});
