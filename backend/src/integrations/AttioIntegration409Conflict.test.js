const AttioIntegration = require('./AttioIntegration');

describe('AttioIntegration - 409 Conflict Handling', () => {
    let integration;

    beforeEach(() => {
        integration = new AttioIntegration({
            id: 'integration-123',
            userId: 'user-456',
        });

        integration.attio = {
            api: {
                getRecord: jest.fn(),
            },
        };

        integration.upsertMapping = jest.fn().mockResolvedValue();
        integration._upsertContactMapping = jest.fn().mockResolvedValue();
        integration.getMapping = jest.fn().mockResolvedValue(null);

        // Mock bulkUpsertToQuo to avoid Prisma database calls
        integration.bulkUpsertToQuo = jest.fn().mockResolvedValue({
            successCount: 1,
            errorCount: 0,
            errors: [],
        });
    });

    describe('_syncPersonToQuo - 409 conflict handling', () => {
        it('should handle 409 conflict by fetching existing contact and creating mapping', async () => {
            const attioRecord = {
                id: { record_id: 'attio-person-123' },
                values: {
                    name: [
                        {
                            first_name: 'John',
                            last_name: 'Doe',
                            active_until: null,
                        },
                    ],
                    email_addresses: [],
                    phone_numbers: [{ phone_number: '+15551234567' }],
                },
            };

            integration.quo = {
                api: {
                    createContact: jest.fn().mockRejectedValue({
                        status: 409,
                        code: '0800409',
                        message: 'Contact with this externalId already exists',
                    }),
                    listContacts: jest.fn().mockResolvedValue({
                        data: [
                            {
                                id: 'quo-contact-existing',
                                externalId: 'attio-person-123',
                                source: 'attio',
                                defaultFields: {
                                    firstName: 'John',
                                    lastName: 'Doe',
                                    phoneNumbers: [{ value: '+15551234567' }],
                                },
                            },
                        ],
                        totalItems: 1,
                    }),
                    updateContact: jest.fn().mockResolvedValue({
                        data: {
                            id: 'quo-contact-existing',
                            defaultFields: {
                                firstName: 'John',
                                lastName: 'Doe',
                                phoneNumbers: [{ value: '+15551234567' }],
                            },
                        },
                    }),
                },
            };

            await integration._syncPersonToQuo(attioRecord, 'created');

            expect(integration.quo.api.createContact).toHaveBeenCalled();

            expect(integration.quo.api.listContacts).toHaveBeenCalledWith({
                externalIds: ['attio-person-123'],
                maxResults: 1,
            });

            expect(integration._upsertContactMapping).toHaveBeenCalledWith(
                'attio-person-123',
                '+15551234567',
                expect.objectContaining({
                    quoContactId: 'quo-contact-existing',
                    syncMethod: 'webhook',
                    action: 'conflict_resolved',
                }),
            );
        });

        it('should create mapping on successful contact creation', async () => {
            const attioRecord = {
                id: { record_id: 'attio-person-new' },
                values: {
                    name: [
                        {
                            first_name: 'Jane',
                            last_name: 'Smith',
                            active_until: null,
                        },
                    ],
                    email_addresses: [],
                    phone_numbers: [{ phone_number: '+15559876543' }],
                },
            };

            integration.quo = {
                api: {
                    createContact: jest.fn().mockResolvedValue({
                        data: {
                            id: 'quo-contact-new',
                            externalId: 'attio-person-new',
                            source: 'attio',
                            defaultFields: {
                                phoneNumbers: [{ value: '+15559876543' }],
                            },
                        },
                    }),
                },
            };

            await integration._syncPersonToQuo(attioRecord, 'created');

            expect(integration.quo.api.createContact).toHaveBeenCalled();

            expect(integration._upsertContactMapping).toHaveBeenCalledWith(
                'attio-person-new',
                '+15559876543',
                expect.objectContaining({
                    quoContactId: 'quo-contact-new',
                    syncMethod: 'webhook',
                    action: 'created',
                }),
            );
        });

        it('should re-throw error if 409 conflict but contact not found in Quo', async () => {
            const attioRecord = {
                id: { record_id: 'attio-person-orphan' },
                values: {
                    name: [
                        {
                            first_name: 'Ghost',
                            last_name: 'Contact',
                            active_until: null,
                        },
                    ],
                    email_addresses: [],
                    phone_numbers: [],
                },
            };

            integration.quo = {
                api: {
                    createContact: jest.fn().mockRejectedValue({
                        status: 409,
                        code: '0800409',
                    }),
                    listContacts: jest.fn().mockResolvedValue({
                        data: [],
                        totalItems: 0,
                    }),
                },
            };

            await expect(
                integration._syncPersonToQuo(attioRecord, 'created'),
            ).rejects.toThrow();

            expect(integration._upsertContactMapping).not.toHaveBeenCalled();
        });

        it('should re-throw non-409 errors without attempting conflict resolution', async () => {
            const attioRecord = {
                id: { record_id: 'attio-person-error' },
                values: {
                    name: [
                        {
                            first_name: 'Error',
                            last_name: 'Test',
                            active_until: null,
                        },
                    ],
                    email_addresses: [],
                    phone_numbers: [],
                },
            };

            integration.quo = {
                api: {
                    createContact: jest.fn().mockRejectedValue({
                        status: 500,
                        message: 'Internal Server Error',
                    }),
                },
            };

            await expect(
                integration._syncPersonToQuo(attioRecord, 'created'),
            ).rejects.toMatchObject({
                status: 500,
            });

            expect(integration.upsertMapping).not.toHaveBeenCalled();
        });

        it('should handle update action without 409 conflict handling', async () => {
            const attioRecord = {
                id: { record_id: 'attio-person-update' },
                values: {
                    name: [
                        {
                            first_name: 'Updated',
                            last_name: 'Person',
                            active_until: null,
                        },
                    ],
                    email_addresses: [],
                    phone_numbers: [],
                },
            };

            integration.quo = {
                api: {
                    listContacts: jest.fn().mockResolvedValue({
                        data: [
                            {
                                id: 'quo-contact-existing',
                                externalId: 'attio-person-update',
                            },
                        ],
                    }),
                    updateContact: jest.fn().mockResolvedValue({
                        data: {
                            id: 'quo-contact-existing',
                        },
                    }),
                },
            };

            await integration._syncPersonToQuo(attioRecord, 'updated');

            expect(integration.quo.api.updateContact).toHaveBeenCalled();
            expect(integration.quo.api.createContact).not.toBeDefined();
        });
    });

    describe('Integration: mapping verification in webhook handlers', () => {
        it('should find contact by mapping after bulk sync creates contacts', async () => {
            integration.getMapping = jest.fn().mockResolvedValue({
                externalId: 'attio-person-123',
                quoContactId: 'quo-contact-1',
                entityType: 'people',
                syncMethod: 'bulk',
            });

            integration.attio.api.queryRecords = jest.fn().mockResolvedValue({
                data: [
                    {
                        id: { record_id: 'attio-person-123' },
                        values: {
                            phone_numbers: [
                                {
                                    phone_number: '+19789517449',
                                    active_until: null,
                                },
                            ],
                        },
                    },
                ],
            });

            const recordId =
                await integration._findAttioContactByPhone('+19789517449');

            expect(recordId).toBe('attio-person-123');
            expect(integration.getMapping).toHaveBeenCalledWith(
                'attio-person-123',
            );
        });

        it('should fail to find contact when mapping does not exist (demonstrates bug)', async () => {
            integration.getMapping = jest.fn().mockResolvedValue(null);

            integration.attio.api.queryRecords = jest.fn().mockResolvedValue({
                data: [
                    {
                        id: { record_id: 'attio-person-orphan' },
                        values: {
                            phone_numbers: [
                                {
                                    phone_number: '+19789517449',
                                    active_until: null,
                                },
                            ],
                        },
                    },
                ],
            });

            await expect(
                integration._findAttioContactByPhone('+19789517449'),
            ).rejects.toThrow(
                'but none were synced from Attio to Quo. Only synced contacts can receive activity logs.',
            );
        });
    });
});
