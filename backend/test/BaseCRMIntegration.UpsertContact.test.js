const { BaseCRMIntegration } = require('../src/base/BaseCRMIntegration');

describe('BaseCRMIntegration - upsertContactToQuo', () => {
    let integration;
    let mockQuoApi;

    const quoContact = {
        externalId: 'ext-123',
        source: 'test-crm',
        sourceUrl: 'https://crm.example.com/contact/ext-123',
        defaultFields: {
            firstName: 'John',
            lastName: 'Doe',
            phoneNumbers: [
                { name: 'Work', value: '+15551234567', primary: true },
            ],
            emails: [
                { name: 'Work', value: 'john@example.com', primary: true },
            ],
        },
        customFields: [],
        sourceEntityType: 'person',
    };

    const createdContact = {
        data: {
            id: 'quo-contact-001',
            defaultFields: {
                phoneNumbers: [{ value: '+15551234567' }],
            },
        },
    };

    const updatedContact = {
        data: {
            id: 'quo-contact-001',
            defaultFields: {
                phoneNumbers: [{ value: '+15551234567' }],
            },
        },
    };

    beforeEach(() => {
        integration = new BaseCRMIntegration({});

        mockQuoApi = {
            listContacts: jest.fn(),
            createFriggContact: jest.fn(),
            updateFriggContact: jest.fn(),
        };

        integration.quo = { api: mockQuoApi };
        integration.upsertMapping = jest.fn().mockResolvedValue(undefined);
    });

    it('should create a new contact when none exists', async () => {
        mockQuoApi.listContacts.mockResolvedValue({ data: [] });
        mockQuoApi.createFriggContact.mockResolvedValue(createdContact);

        const result = await integration.upsertContactToQuo(quoContact);

        expect(result.action).toBe('created');
        expect(result.quoContactId).toBe('quo-contact-001');
        expect(mockQuoApi.createFriggContact).toHaveBeenCalledWith(quoContact);
    });

    it('should update an existing contact when found', async () => {
        mockQuoApi.listContacts.mockResolvedValue({
            data: [{ id: 'quo-contact-001' }],
        });
        mockQuoApi.updateFriggContact.mockResolvedValue(updatedContact);

        const result = await integration.upsertContactToQuo(quoContact);

        expect(result.action).toBe('updated');
        expect(result.quoContactId).toBe('quo-contact-001');
        expect(mockQuoApi.updateFriggContact).toHaveBeenCalledWith(
            'quo-contact-001',
            quoContact,
        );
    });

    it('should handle 409 conflict by retrying as update', async () => {
        // First lookup: contact not found (race condition - another request is creating it)
        mockQuoApi.listContacts
            .mockResolvedValueOnce({ data: [] })
            // Second lookup after 409: contact now exists
            .mockResolvedValueOnce({
                data: [{ id: 'quo-contact-001' }],
            });

        // Create fails with 409 Conflict
        const conflictError = new Error('Conflict');
        conflictError.statusCode = 409;
        mockQuoApi.createFriggContact.mockRejectedValue(conflictError);

        // Update should succeed
        mockQuoApi.updateFriggContact.mockResolvedValue(updatedContact);

        const result = await integration.upsertContactToQuo(quoContact);

        expect(result.action).toBe('updated');
        expect(result.quoContactId).toBe('quo-contact-001');
        expect(mockQuoApi.listContacts).toHaveBeenCalledTimes(2);
        expect(mockQuoApi.createFriggContact).toHaveBeenCalledTimes(1);
        expect(mockQuoApi.updateFriggContact).toHaveBeenCalledWith(
            'quo-contact-001',
            quoContact,
        );
    });

    it('should re-throw non-409 errors from create', async () => {
        mockQuoApi.listContacts.mockResolvedValue({ data: [] });

        const serverError = new Error('Internal Server Error');
        serverError.statusCode = 500;
        mockQuoApi.createFriggContact.mockRejectedValue(serverError);

        await expect(
            integration.upsertContactToQuo(quoContact),
        ).rejects.toMatchObject({
            message: 'Internal Server Error',
            statusCode: 500,
        });

        expect(mockQuoApi.listContacts).toHaveBeenCalledTimes(1);
    });

    it('should throw if contact still not found after 409 retry', async () => {
        // Both lookups return empty - unlikely but defensive
        mockQuoApi.listContacts.mockResolvedValue({ data: [] });

        const conflictError = new Error('Conflict');
        conflictError.statusCode = 409;
        mockQuoApi.createFriggContact.mockRejectedValue(conflictError);

        await expect(
            integration.upsertContactToQuo(quoContact),
        ).rejects.toThrow('Failed to resolve contact after 409 conflict');
    });

    it('should throw when Quo API is not available', async () => {
        integration.quo = null;

        await expect(
            integration.upsertContactToQuo(quoContact),
        ).rejects.toThrow('Quo API not available');
    });

    it('should throw when externalId is missing', async () => {
        await expect(
            integration.upsertContactToQuo({ defaultFields: {} }),
        ).rejects.toThrow('Contact must have an externalId');
    });
});
