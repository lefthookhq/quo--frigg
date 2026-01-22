// Mock BaseCRMIntegration BEFORE importing ClioIntegration
jest.mock('../base/BaseCRMIntegration', () => {
    return {
        BaseCRMIntegration: class MockBaseCRMIntegration {
            constructor() {
                this.events = {};
            }
        },
    };
});

const ClioIntegration = require('./ClioIntegration');

const mockClioContact = {
    person: {
        id: 123,
        etag: 'etag123',
        name: 'John Doe',
        first_name: 'John',
        middle_name: 'Michael',
        last_name: 'Doe',
        title: 'Attorney',
        type: 'Person',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-10T00:00:00Z',
        is_client: true,
        phone_numbers: [
            { id: 1, number: '555-1234', name: 'work', default_number: true },
            {
                id: 2,
                number: '555-5678',
                name: 'mobile',
                default_number: false,
            },
        ],
        email_addresses: [
            {
                id: 1,
                address: 'john@example.com',
                name: 'work',
                default_email: true,
            },
        ],
        company: { id: 999, name: 'Acme Law Firm' },
    },
    personNoMiddleName: {
        id: 124,
        etag: 'etag124',
        name: 'Jane Smith',
        first_name: 'Jane',
        last_name: 'Smith',
        type: 'Person',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-10T00:00:00Z',
        is_client: true,
        phone_numbers: [],
        email_addresses: [],
    },
    company: {
        id: 456,
        etag: 'etag456',
        name: 'Acme Law Firm',
        type: 'Company',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-10T00:00:00Z',
        is_client: true,
        phone_numbers: [
            { id: 3, number: '555-0000', name: 'main', default_number: true },
        ],
        email_addresses: [
            {
                id: 2,
                address: 'info@acmelaw.com',
                name: 'main',
                default_email: true,
            },
        ],
    },
    minimal: {
        id: 789,
        etag: 'etag789',
        name: 'Test',
        type: 'Person',
        first_name: 'Test',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-10T00:00:00Z',
        is_client: false,
    },
    personWithCompanyRef: {
        id: 125,
        etag: 'etag125',
        name: 'Bob Wilson',
        first_name: 'Bob',
        last_name: 'Wilson',
        type: 'Person',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-10T00:00:00Z',
        is_client: true,
        company: { id: 999 },
    },
};

const mockClioResponse = {
    withPaging: {
        data: [mockClioContact.person],
        meta: {
            paging: {
                next: 'https://app.clio.com/api/v4/contacts.json?page_token=next_page_token&limit=100',
            },
            records: 100,
        },
    },
    lastPage: {
        data: [mockClioContact.person],
        meta: { paging: {}, records: 1 },
    },
    empty: {
        data: [],
        meta: { paging: {}, records: 0 },
    },
};

describe('ClioIntegration', () => {
    let integration;
    let mockClioApi;
    let mockQuoApi;

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup mock APIs
        mockClioApi = {
            api: {
                listContacts: jest.fn(),
                getContact: jest.fn(),
                region: 'us',
            },
        };
        mockQuoApi = { api: {} };

        // Create integration instance
        integration = new ClioIntegration();
        integration.clio = mockClioApi;
        integration.quo = mockQuoApi;
        integration.id = 'test-integration-id';
        integration.userId = 'test-user-id';
        integration.config = {};
    });

    describe('Static Configuration', () => {
        it('should have correct Definition name', () => {
            expect(ClioIntegration.Definition.name).toBe('clio');
        });

        it('should have correct Definition version', () => {
            expect(ClioIntegration.Definition.version).toBe('1.0.0');
        });

        it('should have quo module with correct name override', () => {
            expect(
                ClioIntegration.Definition.modules.quo.definition.getName(),
            ).toBe('quo-clio');
        });

        it('should have CRMConfig with Person and Company object types', () => {
            expect(ClioIntegration.CRMConfig.personObjectTypes).toEqual([
                { crmObjectName: 'Person', quoContactType: 'contact' },
                { crmObjectName: 'Company', quoContactType: 'company' },
            ]);
        });

        it('should have CONTACT_FIELDS constant defined', () => {
            expect(ClioIntegration.CONTACT_FIELDS).toBeDefined();
            expect(ClioIntegration.CONTACT_FIELDS).toContain('phone_numbers');
            expect(ClioIntegration.CONTACT_FIELDS).toContain('email_addresses');
            expect(ClioIntegration.CONTACT_FIELDS).toContain('company');
        });

        it('should have cursor-based pagination configured', () => {
            expect(ClioIntegration.CRMConfig.syncConfig.paginationType).toBe(
                'CURSOR_BASED',
            );
        });
    });

    describe('fetchPersonPage', () => {
        it('should fetch contacts and return correct format', async () => {
            mockClioApi.api.listContacts.mockResolvedValue(
                mockClioResponse.lastPage,
            );

            const result = await integration.fetchPersonPage({
                objectType: 'Person',
                cursor: null,
                limit: 50,
                sortDesc: true,
            });

            expect(result).toEqual({
                data: mockClioResponse.lastPage.data,
                cursor: null,
                hasMore: false,
            });
        });

        it('should pass cursor as page_token', async () => {
            mockClioApi.api.listContacts.mockResolvedValue(
                mockClioResponse.lastPage,
            );

            await integration.fetchPersonPage({
                objectType: 'Person',
                cursor: 'test_cursor_token',
                limit: 50,
            });

            expect(mockClioApi.api.listContacts).toHaveBeenCalledWith(
                expect.objectContaining({
                    page_token: 'test_cursor_token',
                }),
            );
        });

        it('should convert modifiedSince to ISO string for updated_since', async () => {
            const testDate = new Date('2025-01-15T10:30:00Z');
            mockClioApi.api.listContacts.mockResolvedValue(
                mockClioResponse.empty,
            );

            await integration.fetchPersonPage({
                objectType: 'Person',
                cursor: null,
                limit: 50,
                modifiedSince: testDate,
            });

            expect(mockClioApi.api.listContacts).toHaveBeenCalledWith(
                expect.objectContaining({
                    updated_since: '2025-01-15T10:30:00.000Z',
                }),
            );
        });

        it('should set order to id(desc) when sortDesc is true', async () => {
            mockClioApi.api.listContacts.mockResolvedValue(
                mockClioResponse.empty,
            );

            await integration.fetchPersonPage({
                objectType: 'Person',
                cursor: null,
                limit: 50,
                sortDesc: true,
            });

            expect(mockClioApi.api.listContacts).toHaveBeenCalledWith(
                expect.objectContaining({
                    order: 'id(desc)',
                }),
            );
        });

        it('should set order to id(asc) when sortDesc is false', async () => {
            mockClioApi.api.listContacts.mockResolvedValue(
                mockClioResponse.empty,
            );

            await integration.fetchPersonPage({
                objectType: 'Person',
                cursor: null,
                limit: 50,
                sortDesc: false,
            });

            expect(mockClioApi.api.listContacts).toHaveBeenCalledWith(
                expect.objectContaining({
                    order: 'id(asc)',
                }),
            );
        });

        it('should return hasMore=true when next cursor exists', async () => {
            mockClioApi.api.listContacts.mockResolvedValue(
                mockClioResponse.withPaging,
            );

            const result = await integration.fetchPersonPage({
                objectType: 'Person',
                cursor: null,
                limit: 50,
            });

            expect(result.hasMore).toBe(true);
            expect(result.cursor).toBe('next_page_token');
        });

        it('should handle empty response correctly', async () => {
            mockClioApi.api.listContacts.mockResolvedValue(
                mockClioResponse.empty,
            );

            const result = await integration.fetchPersonPage({
                objectType: 'Company',
                cursor: null,
                limit: 50,
            });

            expect(result).toEqual({
                data: [],
                cursor: null,
                hasMore: false,
            });
        });

        it('should pass objectType as type parameter', async () => {
            mockClioApi.api.listContacts.mockResolvedValue(
                mockClioResponse.empty,
            );

            await integration.fetchPersonPage({
                objectType: 'Company',
                cursor: null,
                limit: 100,
            });

            expect(mockClioApi.api.listContacts).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'Company',
                    limit: 100,
                }),
            );
        });

        it('should include CONTACT_FIELDS in request', async () => {
            mockClioApi.api.listContacts.mockResolvedValue(
                mockClioResponse.empty,
            );

            await integration.fetchPersonPage({
                objectType: 'Person',
                cursor: null,
                limit: 50,
            });

            expect(mockClioApi.api.listContacts).toHaveBeenCalledWith(
                expect.objectContaining({
                    fields: ClioIntegration.CONTACT_FIELDS,
                }),
            );
        });

        describe('Error Handling', () => {
            it('should propagate API errors', async () => {
                mockClioApi.api.listContacts.mockRejectedValue(
                    new Error('Rate limited'),
                );

                await expect(
                    integration.fetchPersonPage({
                        objectType: 'Person',
                        cursor: null,
                        limit: 50,
                    }),
                ).rejects.toThrow('Rate limited');
            });

            it('should propagate network errors', async () => {
                mockClioApi.api.listContacts.mockRejectedValue(
                    new Error('Network error'),
                );

                await expect(
                    integration.fetchPersonPage({
                        objectType: 'Company',
                        cursor: 'some_cursor',
                        limit: 100,
                    }),
                ).rejects.toThrow('Network error');
            });
        });
    });

    describe('transformPersonToQuo', () => {
        it('should transform Person with all fields correctly', async () => {
            const result = await integration.transformPersonToQuo(
                mockClioContact.person,
            );

            expect(result).toEqual({
                externalId: '123',
                source: 'openphone-clio',
                sourceUrl: 'https://app.clio.com/contacts/123',
                isEditable: false,
                defaultFields: {
                    firstName: 'John Michael',
                    lastName: 'Doe',
                    company: 'Acme Law Firm',
                    role: 'Attorney',
                    phoneNumbers: [
                        { name: 'Work', value: '555-1234', primary: true },
                        { name: 'Mobile', value: '555-5678', primary: false },
                    ],
                    emails: [
                        {
                            name: 'Work',
                            value: 'john@example.com',
                            primary: true,
                        },
                    ],
                },
                customFields: [],
                sourceEntityType: 'person',
            });
        });

        it('should handle Person without middle_name', async () => {
            const result = await integration.transformPersonToQuo(
                mockClioContact.personNoMiddleName,
            );

            expect(result.defaultFields.firstName).toBe('Jane');
            expect(result.defaultFields.lastName).toBe('Smith');
        });

        it('should transform Company type correctly', async () => {
            const result = await integration.transformPersonToQuo(
                mockClioContact.company,
            );

            expect(result.externalId).toBe('456');
            expect(result.defaultFields.firstName).toBe('Acme Law Firm');
            expect(result.defaultFields.lastName).toBe('');
            expect(result.defaultFields.company).toBeNull();
            expect(result.sourceEntityType).toBe('company');
        });

        it('should handle minimal Person data', async () => {
            const result = await integration.transformPersonToQuo(
                mockClioContact.minimal,
            );

            expect(result.externalId).toBe('789');
            expect(result.defaultFields.firstName).toBe('Test');
            expect(result.defaultFields.lastName).toBe('');
            expect(result.defaultFields.phoneNumbers).toEqual([]);
            expect(result.defaultFields.emails).toEqual([]);
            expect(result.defaultFields.company).toBeNull();
        });

        it('should capitalize phone number labels', async () => {
            const result = await integration.transformPersonToQuo(
                mockClioContact.person,
            );

            expect(result.defaultFields.phoneNumbers[0].name).toBe('Work');
            expect(result.defaultFields.phoneNumbers[1].name).toBe('Mobile');
        });

        it('should capitalize email labels', async () => {
            const result = await integration.transformPersonToQuo(
                mockClioContact.person,
            );

            expect(result.defaultFields.emails[0].name).toBe('Work');
        });

        it('should use companyMap when company.name is not expanded', async () => {
            const companyMap = new Map();
            companyMap.set(999, { id: 999, name: 'Looked Up Company' });

            const result = await integration.transformPersonToQuo(
                mockClioContact.personWithCompanyRef,
                companyMap,
            );

            expect(result.defaultFields.company).toBe('Looked Up Company');
        });

        it('should return null company when not in companyMap', async () => {
            const companyMap = new Map();

            const result = await integration.transformPersonToQuo(
                mockClioContact.personWithCompanyRef,
                companyMap,
            );

            expect(result.defaultFields.company).toBeNull();
        });

        it('should always set isEditable to false', async () => {
            const result = await integration.transformPersonToQuo(
                mockClioContact.person,
            );
            expect(result.isEditable).toBe(false);
        });

        it('should always set source to openphone-clio', async () => {
            const result = await integration.transformPersonToQuo(
                mockClioContact.person,
            );
            expect(result.source).toBe('openphone-clio');
        });

        it('should handle Person with no name (fallback to Unknown)', async () => {
            const noNamePerson = {
                id: 999,
                type: 'Person',
                created_at: '2025-01-01T00:00:00Z',
                updated_at: '2025-01-01T00:00:00Z',
            };

            const result = await integration.transformPersonToQuo(noNamePerson);
            expect(result.defaultFields.firstName).toBe('Unknown');
        });

        it('should handle Company with no name (fallback to Unknown)', async () => {
            const noNameCompany = {
                id: 999,
                type: 'Company',
                created_at: '2025-01-01T00:00:00Z',
                updated_at: '2025-01-01T00:00:00Z',
            };

            const result =
                await integration.transformPersonToQuo(noNameCompany);
            expect(result.defaultFields.firstName).toBe('Unknown');
        });
    });

    describe('transformPersonsToQuo', () => {
        it('should return empty array for empty input', async () => {
            const result = await integration.transformPersonsToQuo([]);
            expect(result).toEqual([]);
        });

        it('should return empty array for null input', async () => {
            const result = await integration.transformPersonsToQuo(null);
            expect(result).toEqual([]);
        });

        it('should transform multiple contacts', async () => {
            const contacts = [mockClioContact.person, mockClioContact.company];

            const result = await integration.transformPersonsToQuo(contacts);

            expect(result).toHaveLength(2);
            expect(result[0].externalId).toBe('123');
            expect(result[1].externalId).toBe('456');
        });

        it('should skip company pre-fetch when all companies have names', async () => {
            const contacts = [mockClioContact.person];

            await integration.transformPersonsToQuo(contacts);

            expect(mockClioApi.api.getContact).not.toHaveBeenCalled();
        });

        it('should pre-fetch companies when company.name is not expanded', async () => {
            mockClioApi.api.getContact.mockResolvedValue({
                data: { id: 999, name: 'Fetched Company' },
            });

            const contacts = [mockClioContact.personWithCompanyRef];

            const result = await integration.transformPersonsToQuo(contacts);

            expect(mockClioApi.api.getContact).toHaveBeenCalledWith(
                999,
                'id,name',
            );
            expect(result[0].defaultFields.company).toBe('Fetched Company');
        });

        it('should handle company fetch error gracefully', async () => {
            mockClioApi.api.getContact.mockRejectedValue(
                new Error('API Error'),
            );

            const contacts = [mockClioContact.personWithCompanyRef];

            const result = await integration.transformPersonsToQuo(contacts);

            expect(result[0].defaultFields.company).toBeNull();
        });

        it('should deduplicate company fetches', async () => {
            mockClioApi.api.getContact.mockResolvedValue({
                data: { id: 999, name: 'Shared Company' },
            });

            const contacts = [
                { ...mockClioContact.personWithCompanyRef, id: 1 },
                { ...mockClioContact.personWithCompanyRef, id: 2 },
            ];

            const result = await integration.transformPersonsToQuo(contacts);

            expect(mockClioApi.api.getContact).toHaveBeenCalledTimes(1);
            expect(result[0].defaultFields.company).toBe('Shared Company');
            expect(result[1].defaultFields.company).toBe('Shared Company');
        });
    });

    describe('Route Handlers', () => {
        let mockReq;
        let mockRes;

        beforeEach(() => {
            mockReq = { query: {} };
            mockRes = {
                json: jest.fn(),
                status: jest.fn().mockReturnThis(),
            };
        });

        describe('listContacts', () => {
            it('should return contacts with default pagination', async () => {
                mockClioApi.api.listContacts.mockResolvedValue({
                    data: [mockClioContact.person],
                    meta: { paging: { next: 'next_token' } },
                });

                await integration.listContacts({ req: mockReq, res: mockRes });

                expect(mockClioApi.api.listContacts).toHaveBeenCalledWith({
                    limit: 50,
                    page_token: undefined,
                });
                expect(mockRes.json).toHaveBeenCalledWith({
                    data: [mockClioContact.person],
                    paging: { next: 'next_token' },
                });
            });

            it('should pass page_token and custom limit', async () => {
                mockReq.query = { page_token: 'cursor123', limit: '100' };
                mockClioApi.api.listContacts.mockResolvedValue({
                    data: [],
                    meta: { paging: {} },
                });

                await integration.listContacts({ req: mockReq, res: mockRes });

                expect(mockClioApi.api.listContacts).toHaveBeenCalledWith({
                    limit: 100,
                    page_token: 'cursor123',
                });
            });

            it('should enforce maximum limit of 200', async () => {
                mockReq.query = { limit: '500' };
                mockClioApi.api.listContacts.mockResolvedValue({
                    data: [],
                    meta: { paging: {} },
                });

                await integration.listContacts({ req: mockReq, res: mockRes });

                expect(mockClioApi.api.listContacts).toHaveBeenCalledWith({
                    limit: 50,
                    page_token: undefined,
                });
            });

            it('should handle invalid limit gracefully', async () => {
                mockReq.query = { limit: 'invalid' };
                mockClioApi.api.listContacts.mockResolvedValue({
                    data: [],
                    meta: { paging: {} },
                });

                await integration.listContacts({ req: mockReq, res: mockRes });

                expect(mockClioApi.api.listContacts).toHaveBeenCalledWith({
                    limit: 50,
                    page_token: undefined,
                });
            });

            it('should return 500 on API error', async () => {
                mockClioApi.api.listContacts.mockRejectedValue(
                    new Error('API Error'),
                );

                await integration.listContacts({ req: mockReq, res: mockRes });

                expect(mockRes.status).toHaveBeenCalledWith(500);
                expect(mockRes.json).toHaveBeenCalledWith({
                    error: 'API Error',
                });
            });
        });

        describe('listMatters', () => {
            beforeEach(() => {
                mockClioApi.api.listMatters = jest.fn();
            });

            it('should return matters with default pagination', async () => {
                mockClioApi.api.listMatters.mockResolvedValue({
                    data: [{ id: 1, display_number: 'M-001' }],
                    meta: { paging: { next: 'next_token' } },
                });

                await integration.listMatters({ req: mockReq, res: mockRes });

                expect(mockClioApi.api.listMatters).toHaveBeenCalledWith({
                    limit: 50,
                    page_token: undefined,
                });
                expect(mockRes.json).toHaveBeenCalledWith({
                    data: [{ id: 1, display_number: 'M-001' }],
                    paging: { next: 'next_token' },
                });
            });

            it('should pass page_token and custom limit', async () => {
                mockReq.query = { page_token: 'cursor456', limit: '75' };
                mockClioApi.api.listMatters.mockResolvedValue({
                    data: [],
                    meta: { paging: {} },
                });

                await integration.listMatters({ req: mockReq, res: mockRes });

                expect(mockClioApi.api.listMatters).toHaveBeenCalledWith({
                    limit: 75,
                    page_token: 'cursor456',
                });
            });

            it('should return 500 on API error', async () => {
                mockClioApi.api.listMatters.mockRejectedValue(
                    new Error('Matters API Error'),
                );

                await integration.listMatters({ req: mockReq, res: mockRes });

                expect(mockRes.status).toHaveBeenCalledWith(500);
                expect(mockRes.json).toHaveBeenCalledWith({
                    error: 'Matters API Error',
                });
            });
        });
    });

    describe('Abstract Method Stubs', () => {
        it('should create Clio Note for logSMSToActivity', async () => {
            const mockNoteResponse = {
                data: {
                    id: 999,
                    subject: 'SMS: +15551234567',
                    detail: 'Message content',
                },
            };
            mockClioApi.api.createNote = jest.fn().mockResolvedValue(mockNoteResponse);

            const activity = {
                contactExternalId: '123',
                title: 'SMS: +15551234567',
                content: 'Message content',
                timestamp: '2024-01-05T10:30:00Z',
            };

            const noteId = await integration.logSMSToActivity(activity);

            expect(noteId).toBe(999);
            expect(mockClioApi.api.createNote).toHaveBeenCalledWith({
                type: 'Contact',
                contact: { id: 123 },
                subject: 'SMS: +15551234567',
                detail: 'Message content',
                detail_text_type: 'rich_text',
                date: '2024-01-05T10:30:00Z',
            });
        });

        it('should create Clio PhoneCommunication for logCallToActivity', async () => {
            const mockCommunicationResponse = {
                data: {
                    id: 888,
                    type: 'PhoneCommunication',
                    subject: 'Call: +15551234567',
                    body: 'Call content',
                },
            };
            mockClioApi.api.createCommunication = jest
                .fn()
                .mockResolvedValue(mockCommunicationResponse);

            const activity = {
                contactExternalId: '456',
                title: 'Call: +15551234567',
                content: 'Call content',
                timestamp: '2024-01-05T11:00:00Z',
                duration: 120,
                direction: 'inbound',
                quoCallId: 'call-123',
            };

            const communicationId = await integration.logCallToActivity(activity);

            expect(communicationId).toBe(888);
            expect(mockClioApi.api.createCommunication).toHaveBeenCalledWith({
                type: 'PhoneCommunication',
                subject: 'Call: +15551234567',
                body: 'Call content',
                date: '2024-01-05T11:00:00Z',
                received_at: '2024-01-05T11:00:00Z',
                senders: [{ type: 'Contact', id: 456 }],
                external_properties: [
                    { name: 'quo_call_id', value: 'call-123' },
                    { name: 'duration', value: '120' },
                ],
            });
        });

        it('should throw error for unknown webhook source', async () => {
            await expect(
                integration.onWebhook({ data: { source: 'unknown' } }),
            ).rejects.toThrow('Unknown webhook source: unknown');
        });
    });

    describe('Region URL Generation', () => {
        it('should generate US region URL without prefix', async () => {
            mockClioApi.api.region = 'us';
            const result = await integration.transformPersonToQuo(
                mockClioContact.person,
            );
            expect(result.sourceUrl).toBe('https://app.clio.com/contacts/123');
        });

        it('should generate EU region URL with eu prefix', async () => {
            mockClioApi.api.region = 'eu';
            const result = await integration.transformPersonToQuo(
                mockClioContact.person,
            );
            expect(result.sourceUrl).toBe(
                'https://eu.app.clio.com/contacts/123',
            );
        });

        it('should generate CA region URL with ca prefix', async () => {
            mockClioApi.api.region = 'ca';
            const result = await integration.transformPersonToQuo(
                mockClioContact.person,
            );
            expect(result.sourceUrl).toBe(
                'https://ca.app.clio.com/contacts/123',
            );
        });

        it('should generate AU region URL with au prefix', async () => {
            mockClioApi.api.region = 'au';
            const result = await integration.transformPersonToQuo(
                mockClioContact.person,
            );
            expect(result.sourceUrl).toBe(
                'https://au.app.clio.com/contacts/123',
            );
        });

        it('should default to US region when region is undefined', async () => {
            mockClioApi.api.region = undefined;
            const result = await integration.transformPersonToQuo(
                mockClioContact.person,
            );
            expect(result.sourceUrl).toBe('https://app.clio.com/contacts/123');
        });

        it('should default to US when clio.api is undefined', async () => {
            integration.clio = {};
            const result = await integration.transformPersonToQuo(
                mockClioContact.person,
            );
            expect(result.sourceUrl).toBe('https://app.clio.com/contacts/123');
        });
    });

    describe('Webhook Infrastructure', () => {
        let mockCommands;
        let mockUpdateIntegrationMessages;

        beforeEach(() => {
            mockCommands = {
                updateIntegrationConfig: jest.fn().mockResolvedValue({}),
            };
            mockUpdateIntegrationMessages = {
                execute: jest.fn().mockResolvedValue({}),
            };
            integration.commands = mockCommands;
            integration.updateIntegrationMessages =
                mockUpdateIntegrationMessages;
            integration.queueWebhook = jest.fn().mockResolvedValue({});
        });

        describe('setupWebhooks', () => {
            it('should call setupClioWebhook and setupQuoWebhook', async () => {
                mockClioApi.api.createWebhook = jest.fn().mockResolvedValue({
                    data: {
                        id: 12345,
                        etag: '"abc123"',
                    },
                });

                // Mock setupQuoWebhook to return configured status
                integration.setupQuoWebhook = jest.fn().mockResolvedValue({
                    status: 'configured',
                    messageWebhookId: 'msg-wh-123',
                    callWebhookId: 'call-wh-123',
                    callSummaryWebhookId: 'summary-wh-123',
                });

                // Mock setupClickToCall
                integration.setupClickToCall = jest.fn().mockResolvedValue({
                    status: 'configured',
                    customActionId: 'ca-123',
                });

                const result = await integration.setupWebhooks();

                expect(result.clio.status).toBe('pending_handshake');
                expect(result.clio.webhookId).toBe(12345);
                expect(result.quo.status).toBe('configured');
                expect(result.clickToCall.status).toBe('configured');
                expect(result.overallStatus).toBe('success');
                expect(integration.setupQuoWebhook).toHaveBeenCalled();
                expect(integration.setupClickToCall).toHaveBeenCalled();
            });

            it('should handle setupClioWebhook failure gracefully', async () => {
                mockClioApi.api.createWebhook = jest
                    .fn()
                    .mockRejectedValue(new Error('API Error'));

                // Mock setupQuoWebhook and setupClickToCall
                integration.setupQuoWebhook = jest.fn().mockResolvedValue({
                    status: 'configured',
                });
                integration.setupClickToCall = jest.fn().mockResolvedValue({
                    status: 'configured',
                });

                const result = await integration.setupWebhooks();

                expect(result.clio.status).toBe('failed');
                expect(result.clio.error).toBe('API Error');
                expect(result.overallStatus).toBe('partial');
                expect(
                    mockUpdateIntegrationMessages.execute,
                ).toHaveBeenCalled();
            });
        });

        describe('setupClioWebhook', () => {
            it('should return already_configured when webhook exists', async () => {
                integration.config = {
                    clioWebhookId: 12345,
                    clioWebhookSecret: 'secret',
                    clioWebhookUrl: 'https://test.com/webhook',
                    clioWebhookExpiresAt: new Date(
                        Date.now() + 20 * 24 * 60 * 60 * 1000,
                    ).toISOString(),
                };

                const result = await integration.setupClioWebhook();

                expect(result.status).toBe('already_configured');
                expect(result.webhookId).toBe(12345);
            });

            it('should trigger renewal when webhook expires in < 7 days', async () => {
                const expiresIn5Days = new Date(
                    Date.now() + 5 * 24 * 60 * 60 * 1000,
                ).toISOString();
                integration.config = {
                    clioWebhookId: 12345,
                    clioWebhookSecret: 'secret',
                    clioWebhookUrl: 'https://test.com/webhook',
                    clioWebhookExpiresAt: expiresIn5Days,
                };

                mockClioApi.api.updateWebhook = jest.fn().mockResolvedValue({
                    data: { id: 12345 },
                });

                const result = await integration.setupClioWebhook();

                expect(result.status).toBe('renewed');
                expect(mockClioApi.api.updateWebhook).toHaveBeenCalled();
            });

            it('should create webhook and wait for handshake when not configured', async () => {
                integration.config = {};
                mockClioApi.api.createWebhook = jest.fn().mockResolvedValue({
                    data: {
                        id: 12345,
                        etag: '"abc123"',
                    },
                });
                mockClioApi.api.activateWebhook = jest.fn();

                const result = await integration.setupClioWebhook();

                expect(result.status).toBe('pending_handshake');
                expect(result.webhookId).toBe(12345);
                expect(mockClioApi.api.createWebhook).toHaveBeenCalledWith(
                    expect.objectContaining({
                        model: 'contact',
                        events: ['created', 'updated', 'deleted'],
                    }),
                );
                // activateWebhook should NOT be called here - it happens in handshake
                expect(mockClioApi.api.activateWebhook).not.toHaveBeenCalled();
                expect(
                    mockCommands.updateIntegrationConfig,
                ).toHaveBeenCalledWith(
                    expect.objectContaining({
                        config: expect.objectContaining({
                            clioWebhookId: 12345,
                            clioWebhookSecret: null, // Will be set during handshake
                            clioWebhookStatus: 'pending_handshake',
                        }),
                    }),
                );
            });

            it('should clean up orphaned webhook before creating new one', async () => {
                integration.config = {
                    clioWebhookId: 99999,
                };
                mockClioApi.api.deleteWebhook = jest.fn().mockResolvedValue({});
                mockClioApi.api.createWebhook = jest.fn().mockResolvedValue({
                    data: {
                        id: 12345,
                        etag: '"abc123"',
                    },
                });

                await integration.setupClioWebhook();

                expect(mockClioApi.api.deleteWebhook).toHaveBeenCalledWith(
                    99999,
                );
            });
        });

        describe('setupClickToCall', () => {
            it('should return already_configured when custom action exists', async () => {
                integration.config = {
                    clioCustomActionId: 'ca-123',
                };

                const result = await integration.setupClickToCall();

                expect(result.status).toBe('already_configured');
                expect(result.customActionId).toBe('ca-123');
            });

            it('should create custom action when not configured', async () => {
                integration.config = {};
                integration.id = '10';
                mockClioApi.api.createCustomAction = jest.fn().mockResolvedValue({
                    data: { id: 'ca-456' },
                });

                const result = await integration.setupClickToCall();

                expect(result.status).toBe('configured');
                expect(result.customActionId).toBe('ca-456');
                expect(mockClioApi.api.createCustomAction).toHaveBeenCalledWith(
                    expect.objectContaining({
                        label: 'Call with Quo',
                        ui_reference: 'contacts/show',
                    }),
                );
                expect(mockCommands.updateIntegrationConfig).toHaveBeenCalledWith({
                    integrationId: '10',
                    config: { clioCustomActionId: 'ca-456' },
                });
            });

            it('should handle custom action creation failure', async () => {
                integration.config = {};
                mockClioApi.api.createCustomAction = jest
                    .fn()
                    .mockRejectedValue(new Error('API Error'));

                await expect(integration.setupClickToCall()).rejects.toThrow('API Error');
            });
        });

        describe('onWebhookReceived', () => {
            it('should queue handshake POST with X-Hook-Secret header for processing', async () => {
                integration.config = {
                    clioWebhookId: 12345,
                    clioWebhookStatus: 'pending_handshake',
                };

                const mockReq = {
                    headers: { 'x-hook-secret': 'the-secret-from-clio' },
                    body: { data: { webhook_id: 12345 } },
                    params: { integrationId: 'test-id' },
                };
                const mockRes = {
                    set: jest.fn(),
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn(),
                };

                await integration.onWebhookReceived({
                    req: mockReq,
                    res: mockRes,
                });

                // Should queue the handshake for processing in onWebhook
                expect(integration.queueWebhook).toHaveBeenCalledWith(
                    expect.objectContaining({
                        body: mockReq.body,
                        source: 'clio',
                        isHandshake: true,
                        hookSecret: 'the-secret-from-clio',
                    }),
                );
                expect(mockRes.status).toHaveBeenCalledWith(200);
                expect(mockRes.json).toHaveBeenCalledWith({
                    received: true,
                    handshake: true,
                });
            });

            it('should reject webhooks without signature or secret', async () => {
                const mockReq = {
                    headers: {},
                    body: { data: {} },
                    params: { integrationId: 'test-id' },
                };
                const mockRes = {
                    set: jest.fn(),
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn(),
                };

                await integration.onWebhookReceived({
                    req: mockReq,
                    res: mockRes,
                });

                expect(mockRes.status).toHaveBeenCalledWith(401);
                expect(mockRes.json).toHaveBeenCalledWith({
                    error: 'Signature required',
                });
            });

            it('should queue webhook data with signature', async () => {
                const mockReq = {
                    headers: { 'x-hook-signature': 'valid-signature' },
                    body: { data: { id: 123 }, meta: { event: 'created' } },
                    params: { integrationId: 'test-id' },
                };
                const mockRes = {
                    set: jest.fn(),
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn(),
                };

                await integration.onWebhookReceived({
                    req: mockReq,
                    res: mockRes,
                });

                expect(integration.queueWebhook).toHaveBeenCalledWith(
                    expect.objectContaining({
                        body: mockReq.body,
                        source: 'clio',
                        signature: 'valid-signature',
                    }),
                );
                expect(mockRes.status).toHaveBeenCalledWith(200);
            });
        });

        describe('_handleClioWebhook', () => {
            beforeEach(() => {
                mockQuoApi.api.createFriggContact = jest
                    .fn()
                    .mockResolvedValue({});
                mockQuoApi.api.updateFriggContact = jest
                    .fn()
                    .mockResolvedValue({});
                mockQuoApi.api.listContacts = jest
                    .fn()
                    .mockResolvedValue({ data: [{ id: 'quo-contact-123' }] });
                mockQuoApi.api.deleteContact = jest.fn().mockResolvedValue({});
            });

            it('should process handshake and activate webhook', async () => {
                integration.config = {
                    clioWebhookId: 12345,
                    clioWebhookStatus: 'pending_handshake',
                };
                mockClioApi.api.activateWebhook = jest.fn().mockResolvedValue({
                    data: { id: 12345, status: 'enabled' },
                });

                const webhookData = {
                    body: { data: { webhook_id: 12345 } },
                    headers: {},
                    isHandshake: true,
                    hookSecret: 'the-secret-from-clio',
                };

                const result =
                    await integration._handleClioWebhook(webhookData);

                expect(result.success).toBe(true);
                expect(result.type).toBe('handshake');
                expect(mockClioApi.api.activateWebhook).toHaveBeenCalledWith(
                    12345,
                    'the-secret-from-clio',
                );
                expect(
                    mockCommands.updateIntegrationConfig,
                ).toHaveBeenCalledWith(
                    expect.objectContaining({
                        config: expect.objectContaining({
                            clioWebhookSecret: 'the-secret-from-clio',
                            clioWebhookStatus: 'enabled',
                        }),
                    }),
                );
            });

            it('should process created event', async () => {
                integration.config = {};
                const webhookData = {
                    body: {
                        data: mockClioContact.person,
                        meta: { event: 'created', webhook_id: 12345 },
                    },
                    headers: {},
                };

                const result =
                    await integration._handleClioWebhook(webhookData);

                expect(result.success).toBe(true);
                expect(result.event).toBe('created');
                expect(mockQuoApi.api.createFriggContact).toHaveBeenCalled();
            });

            it('should process updated event', async () => {
                integration.config = {};
                const webhookData = {
                    body: {
                        data: mockClioContact.person,
                        meta: { event: 'updated', webhook_id: 12345 },
                    },
                    headers: {},
                };

                const result =
                    await integration._handleClioWebhook(webhookData);

                expect(result.success).toBe(true);
                expect(result.event).toBe('updated');
                expect(mockQuoApi.api.listContacts).toHaveBeenCalled();
                expect(mockQuoApi.api.updateFriggContact).toHaveBeenCalledWith(
                    'quo-contact-123',
                    expect.any(Object),
                );
            });

            it('should process deleted event', async () => {
                integration.config = {};
                const webhookData = {
                    body: {
                        data: { id: 123 },
                        meta: { event: 'deleted', webhook_id: 12345 },
                    },
                    headers: {},
                };

                const result =
                    await integration._handleClioWebhook(webhookData);

                expect(result.success).toBe(true);
                expect(result.event).toBe('deleted');
                expect(mockQuoApi.api.listContacts).toHaveBeenCalledWith({
                    externalIds: ['123'],
                });
                expect(mockQuoApi.api.deleteContact).toHaveBeenCalledWith(
                    'quo-contact-123',
                );
            });

            it('should skip unhandled event types', async () => {
                integration.config = {};
                const webhookData = {
                    body: {
                        data: { id: 123 },
                        meta: { event: 'unknown_event', webhook_id: 12345 },
                    },
                    headers: {},
                };

                const result =
                    await integration._handleClioWebhook(webhookData);

                expect(result.success).toBe(true);
                expect(result.skipped).toBe(true);
            });

            it('should verify signature when secret is configured', async () => {
                integration.config = {
                    clioWebhookSecret: 'test-secret',
                };
                const webhookData = {
                    body: {
                        data: mockClioContact.person,
                        meta: { event: 'created', webhook_id: 12345 },
                    },
                    headers: { 'x-hook-signature': 'invalid-sig' },
                };

                await expect(
                    integration._handleClioWebhook(webhookData),
                ).rejects.toThrow('Webhook signature verification failed');
            });

            it('should trigger renewal during processing when < 7 days remaining', async () => {
                const expiresIn3Days = new Date(
                    Date.now() + 3 * 24 * 60 * 60 * 1000,
                ).toISOString();
                integration.config = {
                    clioWebhookId: 12345,
                    clioWebhookExpiresAt: expiresIn3Days,
                };
                mockClioApi.api.updateWebhook = jest.fn().mockResolvedValue({
                    data: { id: 12345 },
                });

                const webhookData = {
                    body: {
                        data: mockClioContact.person,
                        meta: { event: 'created', webhook_id: 12345 },
                    },
                    headers: {},
                };

                await integration._handleClioWebhook(webhookData);

                expect(mockClioApi.api.updateWebhook).toHaveBeenCalled();
            });
        });

        describe('_handleContactDeleted', () => {
            beforeEach(() => {
                mockQuoApi.api.listContacts = jest
                    .fn()
                    .mockResolvedValue({ data: [{ id: 'quo-123' }] });
                mockQuoApi.api.deleteContact = jest.fn().mockResolvedValue({});
            });

            it('should handle contact not found gracefully', async () => {
                mockQuoApi.api.listContacts = jest
                    .fn()
                    .mockResolvedValue({ data: [] });

                await expect(
                    integration._handleContactDeleted(123),
                ).resolves.not.toThrow();
                expect(mockQuoApi.api.deleteContact).not.toHaveBeenCalled();
            });

            it('should handle 404 on delete gracefully', async () => {
                mockQuoApi.api.listContacts = jest
                    .fn()
                    .mockResolvedValue({ data: [{ id: 'quo-123' }] });
                const error = new Error('Contact not found');
                error.status = 404;
                mockQuoApi.api.deleteContact = jest
                    .fn()
                    .mockRejectedValue(error);

                await expect(
                    integration._handleContactDeleted(123),
                ).resolves.not.toThrow();
            });

            it('should rethrow non-404 errors', async () => {
                mockQuoApi.api.listContacts = jest
                    .fn()
                    .mockResolvedValue({ data: [{ id: 'quo-123' }] });
                const error = new Error('Server error');
                error.status = 500;
                mockQuoApi.api.deleteContact = jest
                    .fn()
                    .mockRejectedValue(error);

                await expect(
                    integration._handleContactDeleted(123),
                ).rejects.toThrow('Server error');
            });
        });

        describe('Settings Endpoints', () => {
            describe('getSettings', () => {
                it('should return default settings when config is empty', async () => {
                    integration.config = {};

                    const mockReq = {};
                    const mockRes = {
                        json: jest.fn(),
                    };

                    await integration.getSettings({ req: mockReq, res: mockRes });

                    expect(mockRes.json).toHaveBeenCalledWith({
                        settings: {
                            callLoggingEnabled: true,
                            messageLoggingEnabled: true,
                            enabledPhoneIds: [],
                            phoneNumbersMetadata: [],
                            phoneNumbersFetchedAt: null,
                        },
                    });
                });

                it('should return stored settings', async () => {
                    integration.config = {
                        callLoggingEnabled: false,
                        messageLoggingEnabled: true,
                        enabledPhoneIds: ['phone-1', 'phone-2'],
                        phoneNumbersMetadata: [
                            { id: 'phone-1', name: 'Main', number: '+15551234567' },
                        ],
                        phoneNumbersFetchedAt: '2025-01-01T00:00:00Z',
                    };

                    const mockRes = {
                        json: jest.fn(),
                        status: jest.fn().mockReturnThis(),
                    };

                    await integration.getSettings({ req: {}, res: mockRes });

                    expect(mockRes.json).toHaveBeenCalledWith({
                        settings: {
                            callLoggingEnabled: false,
                            messageLoggingEnabled: true,
                            enabledPhoneIds: ['phone-1', 'phone-2'],
                            phoneNumbersMetadata: [
                                { id: 'phone-1', name: 'Main', number: '+15551234567' },
                            ],
                            phoneNumbersFetchedAt: '2025-01-01T00:00:00Z',
                        },
                    });
                });
            });

            describe('updateSettings', () => {
                let mockReq, mockRes;

                beforeEach(() => {
                    integration.config = {};
                    integration.id = '10';
                    mockCommands.updateIntegrationConfig = jest.fn().mockResolvedValue({});
                    mockQuoApi.api.listPhoneNumbers = jest.fn().mockResolvedValue({
                        data: [
                            { id: 'phone-1', name: 'Main', number: '+15551234567', createdAt: '2025-01-01' },
                            { id: 'phone-2', name: 'Support', number: '+15559876543', createdAt: '2025-01-02' },
                        ],
                    });
                });

                it('should update call logging toggle', async () => {
                    const req = {
                        body: { callLoggingEnabled: false },
                    };
                    const res = {
                        json: jest.fn(),
                        status: jest.fn().mockReturnThis(),
                    };

                    await integration.updateSettings({ req, res });

                    expect(mockCommands.updateIntegrationConfig).toHaveBeenCalledWith({
                        integrationId: '10',
                        config: expect.objectContaining({
                            callLoggingEnabled: false,
                        }),
                    });
                    expect(res.json).toHaveBeenCalledWith({
                        success: true,
                        settings: expect.objectContaining({
                            callLoggingEnabled: false,
                        }),
                    });
                });

                it('should update message logging toggle', async () => {
                    integration.config = { messageLoggingEnabled: true };

                    const req = {
                        body: { messageLoggingEnabled: false },
                    };
                    const res = {
                        json: jest.fn(),
                        status: jest.fn().mockReturnThis(),
                    };

                    await integration.updateSettings({ req, res });

                    expect(mockCommands.updateIntegrationConfig).toHaveBeenCalledWith({
                        integrationId: '10',
                        config: expect.objectContaining({
                            messageLoggingEnabled: false,
                        }),
                    });
                    expect(res.json).toHaveBeenCalledWith(
                        expect.objectContaining({
                            success: true,
                            settings: expect.objectContaining({
                                messageLoggingEnabled: false,
                            }),
                        }),
                    );
                });

                it('should update enabledPhoneIds and fetch phone metadata', async () => {
                    integration.config = {
                        enabledPhoneIds: ['old-id-1'],
                    };

                    mockQuoApi.api.listPhoneNumbers = jest.fn().mockResolvedValue({
                        data: [
                            { id: 'phone-1', name: 'Main', number: '+15551234567' },
                            { id: 'phone-2', name: 'Support', number: '+15559876543' },
                        ],
                    });

                    const req = {
                        body: {
                            enabledPhoneIds: ['phone-1', 'phone-2'],
                        },
                    };
                    const res = {
                        json: jest.fn(),
                    };

                    await integration.updateSettings({ req, res });

                    expect(mockCommands.updateIntegrationConfig).toHaveBeenCalledWith({
                        integrationId: '10',
                        config: expect.objectContaining({
                            enabledPhoneIds: ['phone-1', 'phone-2'],
                            phoneNumbersMetadata: expect.arrayContaining([
                                expect.objectContaining({ id: 'phone-1' }),
                                expect.objectContaining({ id: 'phone-2' }),
                            ]),
                            phoneNumbersFetchedAt: expect.any(String),
                        }),
                    });
                    expect(res.json).toHaveBeenCalledWith({
                        success: true,
                        settings: expect.objectContaining({
                            enabledPhoneIds: ['phone-1', 'phone-2'],
                        }),
                    });
                });

                it('should not refetch phone metadata if selection unchanged', async () => {
                    integration.config = {
                        enabledPhoneIds: ['phone-1'],
                    };

                    const req = {
                        body: {
                            enabledPhoneIds: ['phone-1'],
                        },
                    };
                    const res = {
                        json: jest.fn(),
                    };

                    await integration.updateSettings({ req, res });

                    expect(mockQuoApi.api.listPhoneNumbers).not.toHaveBeenCalled();
                });

                it('should handle update errors', async () => {
                    mockCommands.updateIntegrationConfig = jest
                        .fn()
                        .mockRejectedValue(new Error('DB Error'));

                    const req = {
                        body: { callLoggingEnabled: false },
                    };
                    const res = {
                        status: jest.fn().mockReturnThis(),
                        json: jest.fn(),
                    };

                    await integration.updateSettings({ req, res });

                    expect(res.status).toHaveBeenCalledWith(500);
                    expect(res.json).toHaveBeenCalledWith({
                        error: 'DB Error',
                    });
                });
            });

            describe('listQuoPhoneNumbers', () => {
                it('should return list of available phone numbers', async () => {
                    mockQuoApi.api.listPhoneNumbers = jest.fn().mockResolvedValue({
                        data: [
                            {
                                id: 'phone-1',
                                name: 'Main Office',
                                number: '+15551234567',
                                createdAt: '2025-01-01T00:00:00Z',
                            },
                            {
                                id: 'phone-2',
                                name: 'Support',
                                number: '+15559876543',
                                createdAt: '2025-01-02T00:00:00Z',
                            },
                        ],
                    });

                    const req = {};
                    const res = {
                        json: jest.fn(),
                    };

                    await integration.listQuoPhoneNumbers({ req, res });

                    expect(mockQuoApi.api.listPhoneNumbers).toHaveBeenCalledWith({
                        maxResults: 100,
                    });
                    expect(res.json).toHaveBeenCalledWith({
                        phoneNumbers: [
                            {
                                id: 'phone-1',
                                name: 'Main Office',
                                number: '+15551234567',
                                createdAt: '2025-01-01T00:00:00Z',
                            },
                            {
                                id: 'phone-2',
                                name: 'Support',
                                number: '+15559876543',
                                createdAt: '2025-01-02T00:00:00Z',
                            },
                        ],
                    });
                });

                it('should handle empty phone list', async () => {
                    mockQuoApi.api.listPhoneNumbers = jest.fn().mockResolvedValue({
                        data: [],
                    });

                    const req = {};
                    const res = {
                        json: jest.fn(),
                    };

                    await integration.listQuoPhoneNumbers({ req, res });

                    expect(res.json).toHaveBeenCalledWith({
                        phoneNumbers: [],
                    });
                });

                it('should handle API errors', async () => {
                    mockQuoApi.api.listPhoneNumbers = jest
                        .fn()
                        .mockRejectedValue(new Error('API Error'));

                    const req = {};
                    const res = {
                        status: jest.fn().mockReturnThis(),
                        json: jest.fn(),
                    };

                    await integration.listQuoPhoneNumbers({ req, res });

                    expect(res.status).toHaveBeenCalledWith(500);
                    expect(res.json).toHaveBeenCalledWith({
                        error: 'API Error',
                    });
                });
            });
        });

        describe('_handleContactDeleted', () => {
            beforeEach(() => {
                mockQuoApi.api.listContacts = jest
                    .fn()
                    .mockResolvedValue({ data: [{ id: 'quo-123' }] });
                mockQuoApi.api.deleteContact = jest.fn().mockResolvedValue({});
            });

            it('should handle contact not found gracefully', async () => {
                mockQuoApi.api.listContacts = jest
                    .fn()
                    .mockResolvedValue({ data: [] });

                await expect(
                    integration._handleContactDeleted(123),
                ).resolves.not.toThrow();
                expect(mockQuoApi.api.deleteContact).not.toHaveBeenCalled();
            });

            it('should handle 404 on delete gracefully', async () => {
                mockQuoApi.api.listContacts = jest
                    .fn()
                    .mockResolvedValue({ data: [{ id: 'quo-123' }] });
                const error = new Error('Contact not found');
                error.status = 404;
                mockQuoApi.api.deleteContact = jest.fn().mockRejectedValue(error);

                await expect(
                    integration._handleContactDeleted(123),
                ).resolves.not.toThrow();
            });

            it('should rethrow non-404 errors', async () => {
                mockQuoApi.api.listContacts = jest
                    .fn()
                    .mockResolvedValue({ data: [{ id: 'quo-123' }] });
                const error = new Error('Server error');
                error.status = 500;
                mockQuoApi.api.deleteContact = jest.fn().mockRejectedValue(error);

                await expect(integration._handleContactDeleted(123)).rejects.toThrow(
                    'Server error',
                );
            });
        });

        describe('onDelete', () => {
            it('should delete Clio webhook on integration deletion', async () => {
                integration.config = { clioWebhookId: 12345 };
                mockClioApi.api.deleteWebhook = jest.fn().mockResolvedValue({});

                await integration.onDelete();

                expect(mockClioApi.api.deleteWebhook).toHaveBeenCalledWith(
                    12345,
                );
            });

            it('should handle webhook deletion error gracefully', async () => {
                integration.config = { clioWebhookId: 12345 };
                mockClioApi.api.deleteWebhook = jest
                    .fn()
                    .mockRejectedValue(new Error('API Error'));

                await expect(integration.onDelete()).resolves.not.toThrow();
            });

            it('should skip deletion when no webhook configured', async () => {
                integration.config = {};
                mockClioApi.api.deleteWebhook = jest.fn();

                await integration.onDelete();

                expect(mockClioApi.api.deleteWebhook).not.toHaveBeenCalled();
            });
        });
    });
});
