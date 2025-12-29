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
            { id: 2, number: '555-5678', name: 'mobile', default_number: false },
        ],
        email_addresses: [
            { id: 1, address: 'john@example.com', name: 'work', default_email: true },
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
            { id: 2, address: 'info@acmelaw.com', name: 'main', default_email: true },
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
            expect(ClioIntegration.Definition.modules.quo.definition.getName()).toBe('quo-clio');
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
            expect(ClioIntegration.CRMConfig.syncConfig.paginationType).toBe('CURSOR_BASED');
        });
    });

    describe('fetchPersonPage', () => {
        it('should fetch contacts and return correct format', async () => {
            mockClioApi.api.listContacts.mockResolvedValue(mockClioResponse.lastPage);

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
            mockClioApi.api.listContacts.mockResolvedValue(mockClioResponse.lastPage);

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
            mockClioApi.api.listContacts.mockResolvedValue(mockClioResponse.empty);

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
            mockClioApi.api.listContacts.mockResolvedValue(mockClioResponse.empty);

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
            mockClioApi.api.listContacts.mockResolvedValue(mockClioResponse.empty);

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
            mockClioApi.api.listContacts.mockResolvedValue(mockClioResponse.withPaging);

            const result = await integration.fetchPersonPage({
                objectType: 'Person',
                cursor: null,
                limit: 50,
            });

            expect(result.hasMore).toBe(true);
            expect(result.cursor).toBe('next_page_token');
        });

        it('should handle empty response correctly', async () => {
            mockClioApi.api.listContacts.mockResolvedValue(mockClioResponse.empty);

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
            mockClioApi.api.listContacts.mockResolvedValue(mockClioResponse.empty);

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
            mockClioApi.api.listContacts.mockResolvedValue(mockClioResponse.empty);

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
                mockClioApi.api.listContacts.mockRejectedValue(new Error('Rate limited'));

                await expect(
                    integration.fetchPersonPage({
                        objectType: 'Person',
                        cursor: null,
                        limit: 50,
                    }),
                ).rejects.toThrow('Rate limited');
            });

            it('should propagate network errors', async () => {
                mockClioApi.api.listContacts.mockRejectedValue(new Error('Network error'));

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
            const result = await integration.transformPersonToQuo(mockClioContact.person);

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
                        { name: 'Work', value: 'john@example.com', primary: true },
                    ],
                },
                customFields: [],
                sourceEntityType: 'person',
            });
        });

        it('should handle Person without middle_name', async () => {
            const result = await integration.transformPersonToQuo(mockClioContact.personNoMiddleName);

            expect(result.defaultFields.firstName).toBe('Jane');
            expect(result.defaultFields.lastName).toBe('Smith');
        });

        it('should transform Company type correctly', async () => {
            const result = await integration.transformPersonToQuo(mockClioContact.company);

            expect(result.externalId).toBe('456');
            expect(result.defaultFields.firstName).toBe('Acme Law Firm');
            expect(result.defaultFields.lastName).toBe('');
            expect(result.defaultFields.company).toBeNull();
            expect(result.sourceEntityType).toBe('company');
        });

        it('should handle minimal Person data', async () => {
            const result = await integration.transformPersonToQuo(mockClioContact.minimal);

            expect(result.externalId).toBe('789');
            expect(result.defaultFields.firstName).toBe('Test');
            expect(result.defaultFields.lastName).toBe('');
            expect(result.defaultFields.phoneNumbers).toEqual([]);
            expect(result.defaultFields.emails).toEqual([]);
            expect(result.defaultFields.company).toBeNull();
        });

        it('should capitalize phone number labels', async () => {
            const result = await integration.transformPersonToQuo(mockClioContact.person);

            expect(result.defaultFields.phoneNumbers[0].name).toBe('Work');
            expect(result.defaultFields.phoneNumbers[1].name).toBe('Mobile');
        });

        it('should capitalize email labels', async () => {
            const result = await integration.transformPersonToQuo(mockClioContact.person);

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
            const result = await integration.transformPersonToQuo(mockClioContact.person);
            expect(result.isEditable).toBe(false);
        });

        it('should always set source to openphone-clio', async () => {
            const result = await integration.transformPersonToQuo(mockClioContact.person);
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

            const result = await integration.transformPersonToQuo(noNameCompany);
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

            expect(mockClioApi.api.getContact).toHaveBeenCalledWith(999, 'id,name');
            expect(result[0].defaultFields.company).toBe('Fetched Company');
        });

        it('should handle company fetch error gracefully', async () => {
            mockClioApi.api.getContact.mockRejectedValue(new Error('API Error'));

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
                mockClioApi.api.listContacts.mockRejectedValue(new Error('API Error'));

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
                mockClioApi.api.listMatters.mockRejectedValue(new Error('Matters API Error'));

                await integration.listMatters({ req: mockReq, res: mockRes });

                expect(mockRes.status).toHaveBeenCalledWith(500);
                expect(mockRes.json).toHaveBeenCalledWith({
                    error: 'Matters API Error',
                });
            });
        });
    });

    describe('Abstract Method Stubs', () => {
        it('should throw NotImplemented for logSMSToActivity', async () => {
            await expect(integration.logSMSToActivity()).rejects.toThrow(
                'ClioIntegration.logSMSToActivity() not implemented',
            );
        });

        it('should throw NotImplemented for logCallToActivity', async () => {
            await expect(integration.logCallToActivity()).rejects.toThrow(
                'ClioIntegration.logCallToActivity() not implemented',
            );
        });

        it('should throw NotImplemented for setupWebhooks', async () => {
            await expect(integration.setupWebhooks()).rejects.toThrow(
                'ClioIntegration.setupWebhooks() not implemented',
            );
        });

        it('should throw NotImplemented for onWebhook', async () => {
            await expect(
                integration.onWebhook({ data: { type: 'test', id: '123' } }),
            ).rejects.toThrow('ClioIntegration.onWebhook() not fully implemented');
        });
    });

    describe('Region URL Generation', () => {
        it('should generate US region URL without prefix', async () => {
            mockClioApi.api.region = 'us';
            const result = await integration.transformPersonToQuo(mockClioContact.person);
            expect(result.sourceUrl).toBe('https://app.clio.com/contacts/123');
        });

        it('should generate EU region URL with eu prefix', async () => {
            mockClioApi.api.region = 'eu';
            const result = await integration.transformPersonToQuo(mockClioContact.person);
            expect(result.sourceUrl).toBe('https://eu.app.clio.com/contacts/123');
        });

        it('should generate CA region URL with ca prefix', async () => {
            mockClioApi.api.region = 'ca';
            const result = await integration.transformPersonToQuo(mockClioContact.person);
            expect(result.sourceUrl).toBe('https://ca.app.clio.com/contacts/123');
        });

        it('should generate AU region URL with au prefix', async () => {
            mockClioApi.api.region = 'au';
            const result = await integration.transformPersonToQuo(mockClioContact.person);
            expect(result.sourceUrl).toBe('https://au.app.clio.com/contacts/123');
        });

        it('should default to US region when region is undefined', async () => {
            mockClioApi.api.region = undefined;
            const result = await integration.transformPersonToQuo(mockClioContact.person);
            expect(result.sourceUrl).toBe('https://app.clio.com/contacts/123');
        });

        it('should default to US when clio.api is undefined', async () => {
            integration.clio = {};
            const result = await integration.transformPersonToQuo(mockClioContact.person);
            expect(result.sourceUrl).toBe('https://app.clio.com/contacts/123');
        });
    });
});
