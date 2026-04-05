const { BaseCRMIntegration } = require('../src/base/BaseCRMIntegration');

class TestCRMIntegration extends BaseCRMIntegration {}

describe('BaseCRMIntegration - upsertContactToQuo 409 Conflict Handling', () => {
    let integration;
    let mockQuoApi;

    const contactPayload = {
        externalId: 'ext-123',
        defaultFields: {
            firstName: 'John',
            lastName: 'Doe',
            phoneNumbers: [{ name: 'primary', value: '+15551234567' }],
        },
        source: 'attio',
    };

    const createdContactResponse = {
        data: {
            id: 'quo-contact-1',
            defaultFields: {
                phoneNumbers: [{ value: '+15551234567' }],
            },
        },
    };

    const updatedContactResponse = {
        data: {
            id: 'quo-contact-1',
            defaultFields: {
                phoneNumbers: [{ value: '+15551234567' }],
            },
        },
    };

    beforeEach(() => {
        mockQuoApi = {
            api: {
                listContacts: jest.fn(),
                createFriggContact: jest.fn(),
                updateFriggContact: jest.fn(),
            },
        };

        integration = new TestCRMIntegration({
            userId: 'test-user',
            id: 'test-integration-id',
        });

        integration.quo = mockQuoApi;
        integration.upsertMapping = jest.fn().mockResolvedValue({});
    });

    it('should handle 409 Conflict by falling back to update when create races', async () => {
        // Simulate race condition: listContacts returns empty (not found),
        // but createFriggContact returns 409 because another process created it
        mockQuoApi.api.listContacts
            .mockResolvedValueOnce({ data: [] }) // First lookup: not found
            .mockResolvedValueOnce({
                data: [{ id: 'quo-contact-1' }],
            }); // Second lookup after 409: found

        const conflictError = new Error('Conflict');
        conflictError.statusCode = 409;
        mockQuoApi.api.createFriggContact.mockRejectedValue(conflictError);

        mockQuoApi.api.updateFriggContact.mockResolvedValue(
            updatedContactResponse,
        );

        const result = await integration.upsertContactToQuo(contactPayload);

        expect(result.action).toBe('updated');
        expect(result.quoContactId).toBe('quo-contact-1');
        expect(mockQuoApi.api.createFriggContact).toHaveBeenCalledTimes(1);
        expect(mockQuoApi.api.updateFriggContact).toHaveBeenCalledTimes(1);
        expect(mockQuoApi.api.listContacts).toHaveBeenCalledTimes(2);
    });

    it('should re-throw non-409 errors from createFriggContact', async () => {
        mockQuoApi.api.listContacts.mockResolvedValue({ data: [] });

        const serverError = new Error('Internal Server Error');
        serverError.statusCode = 500;
        mockQuoApi.api.createFriggContact.mockRejectedValue(serverError);

        await expect(
            integration.upsertContactToQuo(contactPayload),
        ).rejects.toThrow('Internal Server Error');

        expect(mockQuoApi.api.updateFriggContact).not.toHaveBeenCalled();
    });

    it('should throw if retry lookup after 409 still finds no contact', async () => {
        mockQuoApi.api.listContacts.mockResolvedValue({ data: [] });

        const conflictError = new Error('Conflict');
        conflictError.statusCode = 409;
        mockQuoApi.api.createFriggContact.mockRejectedValue(conflictError);

        await expect(
            integration.upsertContactToQuo(contactPayload),
        ).rejects.toThrow();
    });

    it('should still work normally when create succeeds (no 409)', async () => {
        mockQuoApi.api.listContacts.mockResolvedValue({ data: [] });
        mockQuoApi.api.createFriggContact.mockResolvedValue(
            createdContactResponse,
        );

        const result = await integration.upsertContactToQuo(contactPayload);

        expect(result.action).toBe('created');
        expect(result.quoContactId).toBe('quo-contact-1');
        expect(mockQuoApi.api.updateFriggContact).not.toHaveBeenCalled();
    });

    it('should still work normally when contact exists (update path)', async () => {
        mockQuoApi.api.listContacts.mockResolvedValue({
            data: [{ id: 'quo-contact-1' }],
        });
        mockQuoApi.api.updateFriggContact.mockResolvedValue(
            updatedContactResponse,
        );

        const result = await integration.upsertContactToQuo(contactPayload);

        expect(result.action).toBe('updated');
        expect(result.quoContactId).toBe('quo-contact-1');
        expect(mockQuoApi.api.createFriggContact).not.toHaveBeenCalled();
    });
});
