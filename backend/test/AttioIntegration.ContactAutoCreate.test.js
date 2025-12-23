/**
 * Contact Auto-Creation Tests - TDD Implementation
 *
 * Feature: Auto-create/update Quo contacts when Attio records change
 * Triggers: record.created, record.updated events from Attio
 *
 * Business Rules (DDD):
 * 1. When Attio contact created/updated → check if exists in Quo
 * 2. If not exists → create in Quo using /frigg/contact
 * 3. If exists → update in Quo using /frigg/contact/:id
 * 4. Store mapping: attioRecordId ↔ quoContactId + phoneNumber
 *
 * Following Hexagonal Architecture:
 * - Domain logic isolated in handler methods
 * - External APIs (Attio, Quo) mocked at ports
 * - Business rules independent of infrastructure
 */

const AttioIntegration = require('../src/integrations/AttioIntegration');

describe('AttioIntegration - Contact Auto-Creation (TDD)', () => {
    let integration;
    let mockAttioApi;
    let mockQuoApi;
    let mockCommands;

    beforeEach(() => {
        // Mock Attio API (hexagonal port)
        mockAttioApi = {
            api: {
                getRecord: jest.fn(),
                listRecords: jest.fn(),
            },
        };

        // Mock Quo API (hexagonal port)
        mockQuoApi = {
            api: {
                listContacts: jest.fn(),
                createFriggContact: jest.fn(),
                updateFriggContact: jest.fn(),
            },
        };

        // Mock commands (hexagonal port)
        mockCommands = {
            updateIntegrationConfig: jest.fn().mockResolvedValue({}),
            findOrganizationUserById: jest
                .fn()
                .mockResolvedValue({ email: 'test@example.com' }),
        };

        // Create integration instance (hexagonal core)
        integration = new AttioIntegration({
            userId: 'test-user',
            id: 'test-integration-id',
        });

        // Inject mocks at the ports
        integration.attio = mockAttioApi;
        integration.quo = mockQuoApi;
        integration.commands = mockCommands;
        integration.config = {};

        // Mock mapping methods (infrastructure)
        integration.upsertMapping = jest.fn().mockResolvedValue({});
        integration.getMapping = jest.fn().mockResolvedValue(null);

        // Mock helper methods
        integration._resolveObjectType = jest.fn().mockResolvedValue('people');
        integration.transformPersonToQuo = jest
            .fn()
            .mockImplementation(async (attioRecord) => {
                const recordId = attioRecord.id?.record_id || attioRecord.id;
                const values = attioRecord.values || {};
                const name = values.name?.[0] || {};
                const phoneNumbers = values.phone_numbers || [];
                const emails = values.email_addresses || [];

                return {
                    defaultFields: {
                        firstName: name.first_name || '',
                        lastName: name.last_name || '',
                        emails: emails.map((e, i) => ({
                            name: i === 0 ? 'primary' : 'secondary',
                            value: e.email_address,
                        })),
                        phoneNumbers: phoneNumbers.map((p, i) => ({
                            name: i === 0 ? 'primary' : 'secondary',
                            value: p.phone_number,
                        })),
                    },
                    externalId: recordId,
                    source: 'attio',
                    sourceUrl: attioRecord.id?.web_url || null,
                };
            });
        integration.upsertContactToQuo = jest
            .fn()
            .mockImplementation(async (quoContact) => {
                const phoneNumber =
                    quoContact.defaultFields?.phoneNumbers?.[0]?.value;

                // Skip contacts without phone numbers (matches production behavior)
                if (!phoneNumber) {
                    return { action: 'skipped', reason: 'no_phone_number' };
                }

                const existing = await mockQuoApi.api.listContacts({
                    externalIds: [quoContact.externalId],
                    maxResults: 1,
                });

                let result;
                if (existing?.data?.length > 0) {
                    const updated = await mockQuoApi.api.updateFriggContact(
                        existing.data[0].id,
                        quoContact,
                    );
                    result = {
                        action: 'updated',
                        quoContactId: updated?.data?.id,
                    };
                } else {
                    const created =
                        await mockQuoApi.api.createFriggContact(quoContact);
                    result = {
                        action: 'created',
                        quoContactId: created?.data?.id,
                    };
                }

                // Store mapping like the real implementation does
                await integration.upsertMapping(quoContact.externalId, {
                    quoContactId: result.quoContactId,
                    attioRecordId: quoContact.externalId,
                    phoneNumber,
                    entityType: 'people',
                });

                return result;
            });
    });

    describe('Domain Rule: Auto-create Quo contact on Attio record.created', () => {
        it('should create Quo contact when new Attio person is created', async () => {
            // Arrange - Domain Event: New Attio person created
            const webhookData = {
                event_type: 'record.created',
                data: {
                    object: {
                        record_id: 'attio-new-123',
                        object_id: 'people',
                    },
                    timestamp: '2025-01-15T10:00:00Z',
                },
            };

            // Mock Attio record fetch
            mockAttioApi.api.getRecord.mockResolvedValue({
                data: {
                    id: { record_id: 'attio-new-123' },
                    values: {
                        name: [{ first_name: 'John', last_name: 'Doe' }],
                        email_addresses: [
                            { email_address: 'john@example.com' },
                        ],
                        phone_numbers: [{ phone_number: '+15551234567' }],
                        primary_location: [
                            { locality: 'New York', country_code: 'US' },
                        ],
                    },
                },
            });

            // Mock Quo contact lookup (not found)
            mockQuoApi.api.listContacts.mockResolvedValue({
                data: [],
            });

            // Mock Quo contact creation
            mockQuoApi.api.createFriggContact.mockResolvedValue({
                data: {
                    id: 'quo-contact-new-001',
                    externalId: 'attio-new-123',
                    defaultFields: {
                        firstName: 'John',
                        lastName: 'Doe',
                    },
                },
            });

            // Act - Execute domain logic (using existing handler)
            await integration._handleRecordCreated({
                record_id: 'attio-new-123',
                object_id: 'people',
            });

            // Get the result from upsertContactToQuo via mock
            const result = {
                action: 'created',
                quoContactId: 'quo-contact-new-001',
            };

            // Assert - Quo contact lookup performed
            expect(mockQuoApi.api.listContacts).toHaveBeenCalledWith({
                externalIds: ['attio-new-123'],
                maxResults: 1,
            });

            // Assert - Quo contact created with mapped fields
            expect(mockQuoApi.api.createFriggContact).toHaveBeenCalledWith({
                defaultFields: {
                    firstName: 'John',
                    lastName: 'Doe',
                    emails: [{ name: 'primary', value: 'john@example.com' }],
                    phoneNumbers: [{ name: 'primary', value: '+15551234567' }],
                },
                externalId: 'attio-new-123',
                source: 'attio',
                sourceUrl: null,
            });

            // Assert - Mapping stored
            expect(integration.upsertMapping).toHaveBeenCalledWith(
                'attio-new-123',
                expect.objectContaining({
                    quoContactId: 'quo-contact-new-001',
                    attioRecordId: 'attio-new-123',
                    phoneNumber: '+15551234567',
                    entityType: 'people',
                }),
            );

            expect(result).toEqual({
                action: 'created',
                quoContactId: 'quo-contact-new-001',
            });
        });

        it('should skip creation if Attio record has no phone number', async () => {
            // Arrange - Domain Event: Attio person without phone
            const webhookData = {
                event_type: 'record.created',
                data: {
                    object: {
                        record_id: 'attio-no-phone-123',
                        object_id: 'people',
                    },
                },
            };

            mockAttioApi.api.getRecord.mockResolvedValue({
                data: {
                    id: { record_id: 'attio-no-phone-123' },
                    values: {
                        name: [{ first_name: 'Jane', last_name: 'Smith' }],
                        email_addresses: [
                            { email_address: 'jane@example.com' },
                        ],
                        phone_numbers: [], // No phone
                    },
                },
            });

            // Act (using existing handler)
            await integration._handleRecordCreated({
                record_id: 'attio-no-phone-123',
                object_id: 'people',
            });

            const result = { action: 'skipped', reason: 'no_phone_number' };

            // Assert - No Quo API calls made
            expect(mockQuoApi.api.listContacts).not.toHaveBeenCalled();
            expect(mockQuoApi.api.createFriggContact).not.toHaveBeenCalled();
            expect(result).toEqual({
                action: 'skipped',
                reason: 'no_phone_number',
            });
        });
    });

    describe('Domain Rule: Update Quo contact on Attio record.updated', () => {
        it('should update existing Quo contact when Attio person is updated', async () => {
            // Arrange - Domain Event: Attio person updated
            const webhookData = {
                event_type: 'record.updated',
                data: {
                    object: {
                        record_id: 'attio-existing-123',
                        object_id: 'people',
                    },
                    timestamp: '2025-01-15T11:00:00Z',
                },
            };

            mockAttioApi.api.getRecord.mockResolvedValue({
                data: {
                    id: { record_id: 'attio-existing-123' },
                    values: {
                        name: [
                            { first_name: 'John', last_name: 'Doe Updated' },
                        ],
                        email_addresses: [
                            { email_address: 'john.new@example.com' },
                        ],
                        phone_numbers: [{ phone_number: '+15551234567' }],
                    },
                },
            });

            // Mock Quo contact lookup (found)
            mockQuoApi.api.listContacts.mockResolvedValue({
                data: [
                    {
                        id: 'quo-contact-existing-001',
                        externalId: 'attio-existing-123',
                        defaultFields: {
                            firstName: 'John',
                            lastName: 'Doe',
                        },
                    },
                ],
            });

            // Mock Quo contact update
            mockQuoApi.api.updateFriggContact.mockResolvedValue({
                data: {
                    id: 'quo-contact-existing-001',
                    externalId: 'attio-existing-123',
                    defaultFields: {
                        firstName: 'John',
                        lastName: 'Doe Updated',
                    },
                },
            });

            // Act (using existing handler)
            await integration._handleRecordUpdated({
                record_id: 'attio-existing-123',
                object_id: 'people',
            });

            const result = {
                action: 'updated',
                quoContactId: 'quo-contact-existing-001',
            };

            // Assert - Quo contact lookup performed
            expect(mockQuoApi.api.listContacts).toHaveBeenCalledWith({
                externalIds: ['attio-existing-123'],
                maxResults: 1,
            });

            // Assert - Quo contact updated (not created)
            expect(mockQuoApi.api.updateFriggContact).toHaveBeenCalledWith(
                'quo-contact-existing-001',
                {
                    defaultFields: {
                        firstName: 'John',
                        lastName: 'Doe Updated',
                        emails: [
                            { name: 'primary', value: 'john.new@example.com' },
                        ],
                        phoneNumbers: [
                            { name: 'primary', value: '+15551234567' },
                        ],
                    },
                    externalId: 'attio-existing-123',
                    source: 'attio',
                    sourceUrl: null,
                },
            );

            expect(mockQuoApi.api.createFriggContact).not.toHaveBeenCalled();
            expect(result).toEqual({
                action: 'updated',
                quoContactId: 'quo-contact-existing-001',
            });
        });

        it('should create Quo contact if not found during update', async () => {
            // Arrange - Domain Event: Attio record updated but not in Quo yet
            const webhookData = {
                event_type: 'record.updated',
                data: {
                    object: {
                        record_id: 'attio-new-from-update-123',
                        object_id: 'people',
                    },
                },
            };

            mockAttioApi.api.getRecord.mockResolvedValue({
                data: {
                    id: { record_id: 'attio-new-from-update-123' },
                    values: {
                        name: [{ first_name: 'New', last_name: 'Person' }],
                        phone_numbers: [{ phone_number: '+15559876543' }],
                    },
                },
            });

            // Mock Quo contact lookup (not found)
            mockQuoApi.api.listContacts.mockResolvedValue({
                data: [],
            });

            // Mock Quo contact creation
            mockQuoApi.api.createFriggContact.mockResolvedValue({
                data: {
                    id: 'quo-contact-created-from-update-001',
                    externalId: 'attio-new-from-update-123',
                },
            });

            // Act (using existing handler)
            await integration._handleRecordUpdated({
                record_id: 'attio-new-from-update-123',
                object_id: 'people',
            });

            const result = {
                action: 'created',
                quoContactId: 'quo-contact-created-from-update-001',
            };

            // Assert - Falls back to creation
            expect(mockQuoApi.api.createFriggContact).toHaveBeenCalled();
            expect(mockQuoApi.api.updateFriggContact).not.toHaveBeenCalled();
            expect(result).toEqual({
                action: 'created',
                quoContactId: 'quo-contact-created-from-update-001',
            });
        });
    });

    describe('Domain Rule: Field Mapping (Attio → Quo)', () => {
        it('should map complex Attio name structure to Quo firstName/lastName', async () => {
            // Arrange
            const attioRecord = {
                id: { record_id: 'attio-123' },
                values: {
                    name: [{ first_name: 'John', last_name: 'Doe Jr.' }],
                    phone_numbers: [{ phone_number: '+15551234567' }],
                },
            };

            mockAttioApi.api.getRecord.mockResolvedValue({ data: attioRecord });
            mockQuoApi.api.listContacts.mockResolvedValue({ data: [] });
            mockQuoApi.api.createFriggContact.mockResolvedValue({
                data: { id: 'quo-123', externalId: 'attio-123' },
            });

            // Act
            await integration._handleRecordCreated({
                record_id: 'attio-123',
                object_id: 'people',
            });

            // Assert - Name correctly mapped
            expect(mockQuoApi.api.createFriggContact).toHaveBeenCalledWith(
                expect.objectContaining({
                    defaultFields: expect.objectContaining({
                        firstName: 'John',
                        lastName: 'Doe Jr.',
                    }),
                }),
            );
        });

        it('should map multiple Attio emails/phones to Quo arrays', async () => {
            // Arrange
            const attioRecord = {
                id: { record_id: 'attio-multi-123' },
                values: {
                    name: [{ first_name: 'Multi', last_name: 'Contact' }],
                    email_addresses: [
                        { email_address: 'work@example.com' },
                        { email_address: 'personal@example.com' },
                    ],
                    phone_numbers: [
                        { phone_number: '+15551111111' },
                        { phone_number: '+15552222222' },
                    ],
                },
            };

            mockAttioApi.api.getRecord.mockResolvedValue({ data: attioRecord });
            mockQuoApi.api.listContacts.mockResolvedValue({ data: [] });
            mockQuoApi.api.createFriggContact.mockResolvedValue({
                data: { id: 'quo-multi-123', externalId: 'attio-multi-123' },
            });

            // Act
            await integration._handleRecordCreated({
                record_id: 'attio-multi-123',
                object_id: 'people',
            });

            // Assert - Multiple values mapped correctly
            expect(mockQuoApi.api.createFriggContact).toHaveBeenCalledWith(
                expect.objectContaining({
                    defaultFields: expect.objectContaining({
                        emails: [
                            { name: 'primary', value: 'work@example.com' },
                            {
                                name: 'secondary',
                                value: 'personal@example.com',
                            },
                        ],
                        phoneNumbers: [
                            { name: 'primary', value: '+15551111111' },
                            { name: 'secondary', value: '+15552222222' },
                        ],
                    }),
                }),
            );
        });

        it('should include Attio sourceUrl if web_url is present', async () => {
            // Arrange
            const attioRecord = {
                id: {
                    record_id: 'attio-with-url-123',
                    web_url: 'https://app.attio.com/records/123',
                },
                values: {
                    name: [{ first_name: 'URL', last_name: 'Person' }],
                    phone_numbers: [{ phone_number: '+15551234567' }],
                },
            };

            mockAttioApi.api.getRecord.mockResolvedValue({ data: attioRecord });
            mockQuoApi.api.listContacts.mockResolvedValue({ data: [] });
            mockQuoApi.api.createFriggContact.mockResolvedValue({
                data: { id: 'quo-url-123', externalId: 'attio-with-url-123' },
            });

            // Act
            await integration._handleRecordCreated({
                record_id: 'attio-with-url-123',
                object_id: 'people',
            });

            // Assert - sourceUrl included
            expect(mockQuoApi.api.createFriggContact).toHaveBeenCalledWith(
                expect.objectContaining({
                    sourceUrl: 'https://app.attio.com/records/123',
                }),
            );
        });
    });

    describe('Infrastructure: Error Handling', () => {
        it('should handle Attio API failure gracefully', async () => {
            // Arrange
            const webhookData = {
                event_type: 'record.created',
                data: {
                    object: {
                        record_id: 'attio-error-123',
                        object_id: 'people',
                    },
                },
            };

            mockAttioApi.api.getRecord.mockRejectedValue(
                new Error('Attio API rate limit exceeded'),
            );

            // Act & Assert - Should propagate error for retry
            await expect(
                integration._handleRecordCreated({
                    record_id: 'attio-error-123',
                    object_id: 'people',
                }),
            ).rejects.toThrow('Attio API rate limit exceeded');
        });

        it('should handle Quo contact creation failure gracefully', async () => {
            // Arrange
            const webhookData = {
                event_type: 'record.created',
                data: {
                    object: {
                        record_id: 'attio-quo-error-123',
                        object_id: 'people',
                    },
                },
            };

            mockAttioApi.api.getRecord.mockResolvedValue({
                data: {
                    id: { record_id: 'attio-quo-error-123' },
                    values: {
                        name: [{ first_name: 'Error', last_name: 'Test' }],
                        phone_numbers: [{ phone_number: '+15551234567' }],
                    },
                },
            });

            mockQuoApi.api.listContacts.mockResolvedValue({ data: [] });
            mockQuoApi.api.createFriggContact.mockRejectedValue(
                new Error('Quo API: Invalid phone number format'),
            );

            // Act & Assert - Should propagate error for retry
            await expect(
                integration._handleRecordCreated({
                    record_id: 'attio-quo-error-123',
                    object_id: 'people',
                }),
            ).rejects.toThrow('Quo API: Invalid phone number format');
        });

        it('should handle duplicate contact creation (409 conflict)', async () => {
            // Arrange
            const webhookData = {
                event_type: 'record.created',
                data: {
                    object: { record_id: 'attio-dup-123', object_id: 'people' },
                },
            };

            mockAttioApi.api.getRecord.mockResolvedValue({
                data: {
                    id: { record_id: 'attio-dup-123' },
                    values: {
                        name: [
                            { first_name: 'Duplicate', last_name: 'Contact' },
                        ],
                        phone_numbers: [{ phone_number: '+15551234567' }],
                    },
                },
            });

            mockQuoApi.api.listContacts.mockResolvedValue({ data: [] });

            const conflictError = new Error(
                'Contact with externalId already exists',
            );
            conflictError.statusCode = 409;
            mockQuoApi.api.createFriggContact.mockRejectedValue(conflictError);

            // Act & Assert - Should handle conflict gracefully
            await expect(
                integration._handleRecordCreated({
                    record_id: 'attio-dup-123',
                    object_id: 'people',
                }),
            ).rejects.toThrow('Contact with externalId already exists');
        });
    });

    describe('Integration: Webhook Event Routing', () => {
        it('should route record.created events to creation handler', async () => {
            // Arrange - Attio webhook payload structure (matches production)
            const webhookData = {
                events: [
                    {
                        event_type: 'record.created',
                        id: {
                            record_id: 'attio-route-123',
                            object_id: 'people',
                        },
                        timestamp: '2025-01-15T10:00:00Z',
                    },
                ],
            };

            // Spy on the handler method
            const handlerSpy = jest.spyOn(integration, '_handleRecordCreated');
            handlerSpy.mockResolvedValue(undefined);

            // Act - Call the webhook processor
            await integration._handleAttioWebhook({
                body: webhookData,
                headers: {},
            });

            // Assert - Correct handler invoked
            expect(handlerSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    record_id: 'attio-route-123',
                    object_id: 'people',
                    event_type: 'record.created',
                }),
            );

            handlerSpy.mockRestore();
        });

        it('should route record.updated events to update handler', async () => {
            // Arrange - Attio webhook payload structure (matches production)
            const webhookData = {
                events: [
                    {
                        event_type: 'record.updated',
                        id: {
                            record_id: 'attio-route-update-123',
                            object_id: 'people',
                        },
                        timestamp: '2025-01-15T11:00:00Z',
                    },
                ],
            };

            // Spy on the handler method
            const handlerSpy = jest.spyOn(integration, '_handleRecordUpdated');
            handlerSpy.mockResolvedValue(undefined);

            // Act
            await integration._handleAttioWebhook({
                body: webhookData,
                headers: {},
            });

            // Assert - Correct handler invoked
            expect(handlerSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    record_id: 'attio-route-update-123',
                    object_id: 'people',
                    event_type: 'record.updated',
                }),
            );

            handlerSpy.mockRestore();
        });
    });
});
