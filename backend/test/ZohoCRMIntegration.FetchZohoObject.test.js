const ZohoCRMIntegration = require('../src/integrations/ZohoCRMIntegration');

describe('ZohoCRMIntegration - _fetchZohoObject JSON Error Handling', () => {
    let integration;

    beforeEach(() => {
        integration = Object.create(ZohoCRMIntegration.prototype);
        integration.zoho = {
            api: {
                getContact: jest.fn(),
                getAccount: jest.fn(),
            },
        };
    });

    describe('when Zoho returns invalid JSON (empty body)', () => {
        it('should return null for Contact when getContact throws invalid JSON error', async () => {
            const jsonError = new Error(
                'invalid json response body at https://www.zohoapis.com/crm/v8/Contacts/123 reason: Unexpected end of JSON input',
            );
            integration.zoho.api.getContact.mockRejectedValue(jsonError);

            const result = await integration._fetchZohoObject('Contact', '123');

            expect(result).toBeNull();
        });

        it('should return null for Account when getAccount throws invalid JSON error', async () => {
            const jsonError = new Error(
                'invalid json response body at https://www.zohoapis.com/crm/v8/Accounts/456 reason: Unexpected end of JSON input',
            );
            integration.zoho.api.getAccount.mockRejectedValue(jsonError);

            const result = await integration._fetchZohoObject('Account', '456');

            expect(result).toBeNull();
        });

        it('should log a warning when returning null due to invalid JSON', async () => {
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

            const jsonError = new Error(
                'invalid json response body reason: Unexpected end of JSON input',
            );
            integration.zoho.api.getContact.mockRejectedValue(jsonError);

            await integration._fetchZohoObject('Contact', '789');

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('789'),
            );
            consoleSpy.mockRestore();
        });
    });

    describe('when Zoho returns other errors', () => {
        it('should re-throw non-JSON errors for Contact', async () => {
            const error = new Error('Unauthorized');
            error.statusCode = 401;
            integration.zoho.api.getContact.mockRejectedValue(error);

            await expect(
                integration._fetchZohoObject('Contact', '123'),
            ).rejects.toThrow('Unauthorized');
        });

        it('should re-throw non-JSON errors for Account', async () => {
            const error = new Error('Rate limit exceeded');
            error.statusCode = 429;
            integration.zoho.api.getAccount.mockRejectedValue(error);

            await expect(
                integration._fetchZohoObject('Account', '456'),
            ).rejects.toThrow('Rate limit exceeded');
        });
    });

    describe('when Zoho returns valid data', () => {
        it('should return contact data normally', async () => {
            integration.zoho.api.getContact.mockResolvedValue({
                data: [{ id: '123', Full_Name: 'John Doe' }],
            });

            const result = await integration._fetchZohoObject('Contact', '123');

            expect(result).toEqual({
                id: '123',
                Full_Name: 'John Doe',
                _objectType: 'Contact',
            });
        });

        it('should return account data normally', async () => {
            integration.zoho.api.getAccount.mockResolvedValue({
                data: [{ id: '456', Account_Name: 'Acme Corp' }],
            });

            const result = await integration._fetchZohoObject('Account', '456');

            expect(result).toEqual({
                id: '456',
                Account_Name: 'Acme Corp',
                _objectType: 'Account',
            });
        });
    });
});
