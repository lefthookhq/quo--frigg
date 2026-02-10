const { Api: QuoApi } = require('../src/api-modules/quo/api');

describe('QuoApi.listContacts - Array Query Parameter Handling', () => {
    let quoApi;
    let mockGet;

    beforeEach(() => {
        // Create QuoApi instance with proper params structure
        quoApi = new QuoApi({
            access_token: 'test-key',
            api_key: 'test-key',
        });

        // Mock the _get method to capture the URL
        mockGet = jest.fn().mockResolvedValue({ data: [] });
        quoApi._get = mockGet;
    });

    describe('Array parameter handling', () => {
        it('should format externalIds array with repeated keys', async () => {
            // Arrange
            const params = {
                externalIds: ['id-1', 'id-2', 'id-3'],
                maxResults: 10,
            };

            // Act
            await quoApi.listContacts(params);

            // Assert
            expect(mockGet).toHaveBeenCalledWith({
                url: expect.stringContaining('externalIds=id-1'),
            });
            expect(mockGet).toHaveBeenCalledWith({
                url: expect.stringContaining('externalIds=id-2'),
            });
            expect(mockGet).toHaveBeenCalledWith({
                url: expect.stringContaining('externalIds=id-3'),
            });
            expect(mockGet).toHaveBeenCalledWith({
                url: expect.stringContaining('maxResults=10'),
            });

            // Verify NOT using comma-separated format
            const calledUrl = mockGet.mock.calls[0][0].url;
            expect(calledUrl).not.toContain('externalIds=id-1,id-2');
            // Verify NOT using bracket notation (which gets double-encoded by encodeURI)
            expect(calledUrl).not.toContain('externalIds[]');
        });

        it('should format phoneNumbers array with repeated keys', async () => {
            // Arrange
            const params = {
                phoneNumbers: ['+12125551234', '+19175555678'],
            };

            // Act
            await quoApi.listContacts(params);

            // Assert
            const calledUrl = mockGet.mock.calls[0][0].url;
            expect(calledUrl).toContain('phoneNumbers=%2B12125551234');
            expect(calledUrl).toContain('phoneNumbers=%2B19175555678');
            expect(calledUrl).not.toContain('phoneNumbers[]');
        });

        it('should handle mix of array and non-array parameters', async () => {
            // Arrange
            const params = {
                externalIds: ['id-1', 'id-2'],
                maxResults: 5,
                includePhoneNumbers: true,
            };

            // Act
            await quoApi.listContacts(params);

            // Assert
            const calledUrl = mockGet.mock.calls[0][0].url;

            // Arrays should use repeated keys
            expect(calledUrl).toContain('externalIds=id-1');
            expect(calledUrl).toContain('externalIds=id-2');
            expect(calledUrl).not.toContain('externalIds[]');

            // Regular params should be unchanged
            expect(calledUrl).toContain('maxResults=5');
            expect(calledUrl).toContain('includePhoneNumbers=true');
            expect(calledUrl).not.toContain('maxResults[]');
            expect(calledUrl).not.toContain('includePhoneNumbers[]');
        });

        it('should properly encode special characters in array values', async () => {
            // Arrange
            const params = {
                externalIds: ['id with spaces', 'id/with/slashes'],
            };

            // Act
            await quoApi.listContacts(params);

            // Assert
            const calledUrl = mockGet.mock.calls[0][0].url;
            expect(calledUrl).toContain('id%20with%20spaces');
            expect(calledUrl).toContain('id%2Fwith%2Fslashes');
        });

        it('should handle empty array', async () => {
            // Arrange
            const params = {
                externalIds: [],
                maxResults: 10,
            };

            // Act
            await quoApi.listContacts(params);

            // Assert
            const calledUrl = mockGet.mock.calls[0][0].url;
            expect(calledUrl).not.toContain('externalIds');
            expect(calledUrl).toContain('maxResults=10');
        });

        it('should handle single item array', async () => {
            // Arrange
            const params = {
                externalIds: ['single-id'],
            };

            // Act
            await quoApi.listContacts(params);

            // Assert
            const calledUrl = mockGet.mock.calls[0][0].url;
            expect(calledUrl).toContain('externalIds=single-id');
            expect(calledUrl).not.toContain('externalIds[]');
        });
    });

    describe('Non-array parameter handling', () => {
        it('should handle string parameters without brackets', async () => {
            // Arrange
            const params = {
                name: 'John Doe',
                maxResults: 10,
            };

            // Act
            await quoApi.listContacts(params);

            // Assert
            const calledUrl = mockGet.mock.calls[0][0].url;
            expect(calledUrl).toContain('name=John%20Doe');
            expect(calledUrl).not.toContain('name[]');
        });

        it('should handle no parameters', async () => {
            // Act
            await quoApi.listContacts();

            // Assert
            const calledUrl = mockGet.mock.calls[0][0].url;
            expect(calledUrl).not.toContain('?');
        });

        it('should handle empty params object', async () => {
            // Act
            await quoApi.listContacts({});

            // Assert
            const calledUrl = mockGet.mock.calls[0][0].url;
            expect(calledUrl).not.toContain('?');
        });
    });

    describe('Real-world bulk sync scenario', () => {
        it('should correctly format request with 7 UUIDs from bulk sync', async () => {
            // Arrange - Real UUIDs from the error log
            const params = {
                externalIds: [
                    '0e77bdf3-2c4a-41be-801e-c1a47e8af171',
                    '7893b79c-934a-45c4-8387-76fc2a6cb1ca',
                    '7b679535-df74-4b03-8200-a32177c93563',
                    'd95f31e4-03c6-4bbf-8ba7-bf10cf87b293',
                    'e4f05ca9-512b-4ddd-9edf-1e462f31537b',
                    'fb626aeb-ab9a-48cf-bece-655b063ad46c',
                    'fcaa0b25-cee0-4c19-93e3-ab03bfd2d7ce',
                ],
                maxResults: 7,
            };

            // Act
            await quoApi.listContacts(params);

            // Assert
            const calledUrl = mockGet.mock.calls[0][0].url;

            // Each ID should be a separate repeated key parameter
            params.externalIds.forEach((id) => {
                expect(calledUrl).toContain(`externalIds=${id}`);
            });

            // Should NOT use bracket notation (double-encoded by encodeURI)
            expect(calledUrl).not.toContain('externalIds[]');

            // Should NOT be comma-separated
            expect(calledUrl).not.toContain(
                '0e77bdf3-2c4a-41be-801e-c1a47e8af171,7893b79c',
            );

            // Each individual param should be under 75 chars
            const idParams = calledUrl
                .split('&')
                .filter((p) => p.startsWith('externalIds='));
            idParams.forEach((param) => {
                const value = param.split('=')[1];
                expect(value.length).toBeLessThanOrEqual(75);
            });
        });
    });
});
