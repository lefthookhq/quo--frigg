const { BaseCRMIntegration } = require('../src/base/BaseCRMIntegration');

describe('BaseCRMIntegration - Mapping Lookup Methods', () => {
    let integration;

    beforeEach(() => {
        // Create minimal integration instance
        integration = new BaseCRMIntegration({});

        // Mock getMapping method (from Frigg framework)
        integration.getMapping = jest.fn();
    });

    describe('_getExternalIdFromMappingByPhone', () => {
        it('should return externalId when mapping exists', async () => {
            // Arrange
            const phoneNumber = '+12125551234';
            const expectedExternalId = 'attio-456';

            integration.getMapping.mockResolvedValue({
                externalId: expectedExternalId,
                phoneNumber: phoneNumber,
            });

            // Act
            const result = await integration._getExternalIdFromMappingByPhone(
                phoneNumber,
            );

            // Assert
            expect(result).toBe(expectedExternalId);
            expect(integration.getMapping).toHaveBeenCalledWith(phoneNumber);
        });

        it('should return null when mapping does not exist', async () => {
            // Arrange
            integration.getMapping.mockResolvedValue(null);

            // Act
            const result = await integration._getExternalIdFromMappingByPhone(
                '+19175551234',
            );

            // Assert
            expect(result).toBeNull();
        });

        it('should return null when mapping exists but has no externalId', async () => {
            // Arrange
            integration.getMapping.mockResolvedValue({
                phoneNumber: '+12125551234',
                // externalId missing
            });

            // Act
            const result = await integration._getExternalIdFromMappingByPhone(
                '+12125551234',
            );

            // Assert
            expect(result).toBeNull();
        });

        it('should return null on database error', async () => {
            // Arrange
            integration.getMapping.mockRejectedValue(
                new Error('Database connection failed'),
            );

            // Act
            const result = await integration._getExternalIdFromMappingByPhone(
                '+12125551234',
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
