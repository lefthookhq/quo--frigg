const { BaseCRMIntegration } = require('../src/base/BaseCRMIntegration');

describe('BaseCRMIntegration - Mapping Lookup Methods', () => {
    let integration;
    let mockEntity;

    beforeEach(() => {
        // Create mock Entity model
        mockEntity = {
            findOne: jest.fn(),
        };

        // Create minimal integration instance
        integration = new BaseCRMIntegration({});
        integration.modules = { entity: mockEntity };
    });

    describe('_getExternalIdFromMapping', () => {
        it('should return externalId when mapping exists', async () => {
            // Arrange
            const quoContactId = 'quo-123';
            const expectedExternalId = 'attio-456';

            mockEntity.findOne.mockResolvedValue({
                config: {
                    externalId: expectedExternalId,
                    quoContactId: quoContactId,
                },
            });

            // Act
            const result = await integration._getExternalIdFromMapping(
                quoContactId,
            );

            // Assert
            expect(result).toBe(expectedExternalId);
            expect(mockEntity.findOne).toHaveBeenCalledWith({
                'config.quoContactId': quoContactId,
            });
        });

        it('should return null when mapping does not exist', async () => {
            // Arrange
            mockEntity.findOne.mockResolvedValue(null);

            // Act
            const result = await integration._getExternalIdFromMapping(
                'unknown-id',
            );

            // Assert
            expect(result).toBeNull();
        });

        it('should return null when mapping exists but has no externalId', async () => {
            // Arrange
            mockEntity.findOne.mockResolvedValue({
                config: {
                    quoContactId: 'quo-123',
                    // externalId missing
                },
            });

            // Act
            const result = await integration._getExternalIdFromMapping(
                'quo-123',
            );

            // Assert
            expect(result).toBeNull();
        });

        it('should return null on database error', async () => {
            // Arrange
            mockEntity.findOne.mockRejectedValue(
                new Error('Database connection failed'),
            );

            // Act
            const result = await integration._getExternalIdFromMapping(
                'quo-123',
            );

            // Assert
            expect(result).toBeNull();
        });
    });

    describe('_findContactByPhone', () => {
        it('should throw error with integration name (base implementation)', async () => {
            // Arrange
            const phoneNumber = '+12125551234';

            // Act & Assert
            await expect(
                integration._findContactByPhone(phoneNumber),
            ).rejects.toThrow('BaseCRMIntegration does not support');
            await expect(
                integration._findContactByPhone(phoneNumber),
            ).rejects.toThrow(phoneNumber);
        });

        it('should include phone number in error message', async () => {
            // Arrange
            const phoneNumber = '+19175551234';

            // Act & Assert
            await expect(
                integration._findContactByPhone(phoneNumber),
            ).rejects.toThrow(phoneNumber);
        });
    });
});
