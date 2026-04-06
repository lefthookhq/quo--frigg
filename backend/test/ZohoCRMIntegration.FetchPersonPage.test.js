const ZohoCRMIntegration = require('../src/integrations/ZohoCRMIntegration');

describe('ZohoCRMIntegration - fetchPersonPage 204 No Content Handling', () => {
    let integration;
    let mockZohoApi;

    beforeEach(() => {
        mockZohoApi = {
            api: {
                listContacts: jest.fn(),
                listAccounts: jest.fn(),
            },
        };

        integration = new ZohoCRMIntegration({
            userId: 'test-user',
            id: 'test-integration-id',
        });

        integration.zoho = mockZohoApi;
    });

    describe('when Zoho API returns 204 No Content (empty JSON body)', () => {
        const jsonParseErrors = [
            {
                name: 'Unexpected end of JSON input',
                error: new Error('Unexpected end of JSON input'),
            },
            {
                name: 'invalid json response body',
                error: new Error(
                    'invalid json response body at https://www.zohoapis.com/crm/v8/Accounts reason: Unexpected end of JSON input',
                ),
            },
        ];

        for (const { name, error } of jsonParseErrors) {
            it(`should return empty data for Accounts when: ${name}`, async () => {
                mockZohoApi.api.listAccounts.mockRejectedValue(error);

                const result = await integration.fetchPersonPage({
                    objectType: 'Account',
                    limit: 50,
                });

                expect(result.data).toEqual([]);
                expect(result.hasMore).toBe(false);
                expect(result.cursor).toBeNull();
            });

            it(`should return empty data for Contacts when: ${name}`, async () => {
                mockZohoApi.api.listContacts.mockRejectedValue(error);

                const result = await integration.fetchPersonPage({
                    objectType: 'Contact',
                    limit: 50,
                });

                expect(result.data).toEqual([]);
                expect(result.hasMore).toBe(false);
                expect(result.cursor).toBeNull();
            });
        }
    });

    it('should re-throw non-JSON-parse errors', async () => {
        const authError = new Error('Invalid OAuth token');
        authError.statusCode = 401;
        mockZohoApi.api.listAccounts.mockRejectedValue(authError);

        await expect(
            integration.fetchPersonPage({
                objectType: 'Account',
                limit: 50,
            }),
        ).rejects.toThrow('Invalid OAuth token');
    });

    it('should still work normally when API returns valid data', async () => {
        mockZohoApi.api.listAccounts.mockResolvedValue({
            data: [
                { id: 'acc-1', Account_Name: 'Test Corp' },
                { id: 'acc-2', Account_Name: 'Other Inc' },
            ],
            info: {
                next_page_token: 'cursor-abc',
                more_records: true,
            },
        });

        const result = await integration.fetchPersonPage({
            objectType: 'Account',
            limit: 50,
        });

        expect(result.data).toHaveLength(2);
        expect(result.data[0]._objectType).toBe('Account');
        expect(result.hasMore).toBe(true);
        expect(result.cursor).toBe('cursor-abc');
    });
});
