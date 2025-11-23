const { Api } = require('./api');

describe('Quo API - API Key Compatibility', () => {
    describe('API_KEY_VALUE getter', () => {
        it('should return api_key value via API_KEY_VALUE getter for backward compatibility', () => {
            const api = new Api({ api_key: 'test-api-key-123' });

            // The getter should return the same value as api_key
            expect(api.API_KEY_VALUE).toBe('test-api-key-123');
            expect(api.api_key).toBe('test-api-key-123');
        });

        it('should reflect changes made via setApiKey()', () => {
            const api = new Api();

            // Initially undefined
            expect(api.API_KEY_VALUE).toBeNull();

            // Set via setApiKey
            api.setApiKey('new-key-456');

            // Should be accessible via both properties
            expect(api.API_KEY_VALUE).toBe('new-key-456');
            expect(api.api_key).toBe('new-key-456');
        });

        it('should work with definition.js getCredentialDetails pattern', () => {
            // This simulates how definition.js uses the API key
            const api = new Api();
            api.setApiKey('credential-key-789');

            // definition.js does: const apiKey = api.API_KEY_VALUE;
            const apiKey = api.API_KEY_VALUE;

            expect(apiKey).toBe('credential-key-789');
            expect(apiKey).not.toBeUndefined();
            expect(apiKey).not.toBeNull();
        });
    });
});

describe('Quo API - Frigg Contact Endpoints', () => {
    let api;
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
        process.env.FRIGG_API_KEY = 'test-frigg-api-key';
        api = new Api({ api_key: 'test-api-key' });
        api._post = jest.fn();
        api._patch = jest.fn();
    });

    afterEach(() => {
        process.env = originalEnv;
        jest.clearAllMocks();
    });

    describe('createFriggContact', () => {
        it('should call /frigg/contacts with POST and include x-frigg-api-key header', async () => {
            const contactData = {
                defaultFields: {
                    firstName: 'John',
                    lastName: 'Doe',
                    phoneNumbers: [{ name: 'mobile', value: '+15551234567' }],
                },
                externalId: 'crm-123',
            };

            api._post.mockResolvedValue({ data: { id: 'quo-contact-id', ...contactData } });

            await api.createFriggContact(contactData);

            expect(api._post).toHaveBeenCalledWith({
                url: expect.stringContaining('/frigg/contacts'),
                headers: {
                    'Content-Type': 'application/json',
                    'x-frigg-api-key': 'test-frigg-api-key',
                },
                body: contactData,
            });
        });

        it('should return created contact data', async () => {
            const contactData = {
                defaultFields: { firstName: 'Jane' },
                externalId: 'crm-456',
            };

            const expectedResponse = {
                data: {
                    id: 'quo-contact-id',
                    externalId: 'crm-456',
                    defaultFields: { firstName: 'Jane' },
                },
            };

            api._post.mockResolvedValue(expectedResponse);

            const result = await api.createFriggContact(contactData);

            expect(result).toEqual(expectedResponse);
        });
    });

    describe('updateFriggContact', () => {
        it('should call /frigg/contacts/:id with PATCH and include x-frigg-api-key header', async () => {
            const contactId = 'quo-contact-123';
            const updateData = {
                defaultFields: {
                    firstName: 'Updated',
                    lastName: 'Name',
                },
            };

            api._patch.mockResolvedValue({ data: { id: contactId, ...updateData } });

            await api.updateFriggContact(contactId, updateData);

            expect(api._patch).toHaveBeenCalledWith({
                url: expect.stringContaining(`/frigg/contacts/${contactId}`),
                headers: {
                    'Content-Type': 'application/json',
                    'x-frigg-api-key': 'test-frigg-api-key',
                },
                body: updateData,
            });
        });

        it('should return updated contact data', async () => {
            const contactId = 'quo-contact-456';
            const updateData = {
                defaultFields: { company: 'New Company' },
            };

            const expectedResponse = {
                data: {
                    id: contactId,
                    defaultFields: { company: 'New Company' },
                },
            };

            api._patch.mockResolvedValue(expectedResponse);

            const result = await api.updateFriggContact(contactId, updateData);

            expect(result).toEqual(expectedResponse);
        });
    });

    describe('URL configuration', () => {
        it('should have friggContacts URL defined', () => {
            expect(api.URLs.friggContacts).toBe('/frigg/contacts');
        });

        it('should have friggContactById URL function defined', () => {
            expect(api.URLs.friggContactById('test-id')).toBe('/frigg/contacts/test-id');
        });
    });
});
