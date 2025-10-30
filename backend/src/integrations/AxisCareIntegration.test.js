/**
 * Jest test for refactored AxisCareIntegration
 * Tests that the integration properly extends BaseCRMIntegration
 */

// Mock BaseCRMIntegration before importing
jest.mock('../base/BaseCRMIntegration', () => {
    return {
        BaseCRMIntegration: class MockBaseCRMIntegration {
            constructor() {
                this.events = {
                    INITIAL_SYNC: { handler: jest.fn() },
                    ONGOING_SYNC: { handler: jest.fn() },
                    WEBHOOK_RECEIVED: { handler: jest.fn() },
                    FETCH_PERSON_PAGE: { handler: jest.fn() },
                    PROCESS_PERSON_BATCH: { handler: jest.fn() },
                    COMPLETE_SYNC: { handler: jest.fn() },
                    LOG_SMS: { handler: jest.fn() },
                    LOG_CALL: { handler: jest.fn() },
                };
            }
        },
    };
});

const AxisCareIntegration = require('./AxisCareIntegration');

describe('AxisCareIntegration', () => {
    let integration;
    let mockAxisCareApi;
    let mockQuoApi;

    beforeEach(() => {
        // Mock Date.now() for deterministic externalId testing
        jest.spyOn(Date, 'now').mockReturnValue(1640000000000); // Fixed timestamp

        mockAxisCareApi = {
            api: {
                clients: {
                    getAll: jest.fn(),
                    get: jest.fn(),
                },
                appointments: {
                    getAll: jest.fn(),
                },
                services: {
                    getAll: jest.fn(),
                },
                communications: {
                    create: jest.fn(),
                },
                reports: {
                    get: jest.fn(),
                },
                listClients: jest.fn(),
                getClient: jest.fn(),
                getFromUrl: jest.fn(),
            },
        };

        mockQuoApi = {
            api: {
                upsertContact: jest.fn(),
                logActivity: jest.fn(),
            },
        };

        integration = new AxisCareIntegration();
        // Using camelCase 'axisCare' per Definition (AxisCareIntegration.js:27)
        integration.axisCare = mockAxisCareApi;
        integration.quo = mockQuoApi;
        integration.id = 'test-integration-id';
        integration.userId = 'test-user-id';

        // Mock managers for pagination tests
        integration.processManager = {
            getMetadata: jest.fn(),
            updateMetadata: jest.fn(),
            updateState: jest.fn(),
            updateTotal: jest.fn(),
            handleError: jest.fn(),
        };
        integration.queueManager = {
            queueFetchPersonPage: jest.fn(),
            queueProcessPersonBatch: jest.fn(),
            queueCompleteSync: jest.fn(),
        };
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Static Configuration', () => {
        it('should have correct Definition', () => {
            expect(AxisCareIntegration.Definition.name).toBe('axisCare');
            expect(AxisCareIntegration.Definition.display.label).toBe(
                'AxisCare',
            );
        });

        it('should have correct CRMConfig', () => {
            expect(
                AxisCareIntegration.CRMConfig.personObjectTypes,
            ).toHaveLength(4);
            expect(
                AxisCareIntegration.CRMConfig.personObjectTypes[0]
                    .crmObjectName,
            ).toBe('Client');
            expect(
                AxisCareIntegration.CRMConfig.personObjectTypes[1]
                    .crmObjectName,
            ).toBe('Lead');
            expect(
                AxisCareIntegration.CRMConfig.personObjectTypes[2]
                    .crmObjectName,
            ).toBe('Caregiver');
            expect(
                AxisCareIntegration.CRMConfig.personObjectTypes[3]
                    .crmObjectName,
            ).toBe('Applicant');
            expect(
                AxisCareIntegration.CRMConfig.syncConfig.supportsWebhooks,
            ).toBe(false);
        });
    });

    describe('Required Methods', () => {
        describe('fetchPersonPage', () => {
            it('should fetch clients page correctly', async () => {
                const mockResponse = {
                    results: {
                        clients: [
                            { id: 1, firstName: 'John', lastName: 'Doe' },
                        ],
                    },
                };

                mockAxisCareApi.api.listClients.mockResolvedValue(mockResponse);

                const result = await integration.fetchPersonPage({
                    objectType: 'Client',
                    cursor: null,
                    limit: 10,
                    sortDesc: true,
                });

                expect(result.data).toHaveLength(1);
                expect(result.data[0]._objectType).toBe('Client');
                expect(result.cursor).toBe(null);
                expect(result.hasMore).toBe(false);
            });
        });

        describe('transformPersonToQuo', () => {
            it('should transform AxisCare client to Quo format', async () => {
                const client = {
                    id: 123,
                    firstName: 'John',
                    lastName: 'Doe',
                    personalEmail: 'john@example.com',
                    homePhone: '555-1234',
                    mobilePhone: '555-5678',
                    status: 'active',
                    dateOfBirth: '1950-01-01',
                    residentialAddress: '123 Main St',
                    _objectType: 'Client',
                };

                const result = await integration.transformPersonToQuo(client);

                expect(result.externalId).toBe('123_1640000000000');
                expect(result.source).toBe('axiscare');
                expect(result.defaultFields.firstName).toBe('John');
                expect(result.defaultFields.lastName).toBe('Doe');
                expect(result.defaultFields.phoneNumbers).toHaveLength(2);
                expect(result.defaultFields.emails).toHaveLength(1);
                expect(result.customFields).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ key: 'crmId', value: '123' }),
                        expect.objectContaining({
                            key: 'status',
                            value: 'active',
                        }),
                    ]),
                );
            });
        });

        describe('setupWebhooks', () => {
            it('should log webhook fallback message', async () => {
                const consoleSpy = jest
                    .spyOn(console, 'log')
                    .mockImplementation();

                await integration.setupWebhooks();

                expect(consoleSpy).toHaveBeenCalledWith(
                    'AxisCare webhooks not configured - using polling fallback',
                );

                consoleSpy.mockRestore();
            });
        });
    });

    describe('Backward Compatibility', () => {
        it('should have LIST_AXISCARE_CLIENTS event', () => {
            expect(integration.events.LIST_AXISCARE_CLIENTS).toBeDefined();
        });
    });

    describe('fetchPersonsByIds', () => {
        it('should use bulk API call for efficiency', async () => {
            const ids = ['1', '2', '3', '4', '5'];
            const mockResponse = {
                results: {
                    clients: [
                        { id: 1, firstName: 'John' },
                        { id: 2, firstName: 'Jane' },
                        { id: 3, firstName: 'Bob' },
                        { id: 4, firstName: 'Alice' },
                        { id: 5, firstName: 'Charlie' },
                    ],
                },
            };

            mockAxisCareApi.api.listClients.mockResolvedValue(mockResponse);

            const result = await integration.fetchPersonsByIds(ids);

            expect(mockAxisCareApi.api.listClients).toHaveBeenCalledWith({
                clientIds: '1,2,3,4,5',
                limit: 5,
            });

            expect(result).toHaveLength(5);
            expect(result[0].firstName).toBe('John');
        });

        it('should fallback to sequential fetch if bulk fails', async () => {
            const ids = ['1', '2'];
            const bulkError = new Error('Bulk fetch not supported');

            mockAxisCareApi.api.listClients.mockRejectedValue(bulkError);
            mockAxisCareApi.api.getClient
                .mockResolvedValueOnce({ id: 1, firstName: 'John' })
                .mockResolvedValueOnce({ id: 2, firstName: 'Jane' });

            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

            const result = await integration.fetchPersonsByIds(ids);

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Bulk fetch failed'),
                expect.any(String),
            );

            expect(mockAxisCareApi.api.getClient).toHaveBeenCalledTimes(2);
            expect(result).toHaveLength(2);

            consoleSpy.mockRestore();
        });

        it('should return empty array for empty input', async () => {
            const result = await integration.fetchPersonsByIds([]);
            expect(result).toEqual([]);
        });

        it('should handle individual fetch failures gracefully', async () => {
            const ids = ['1', '2', '3'];

            mockAxisCareApi.api.listClients.mockRejectedValue(
                new Error('Bulk not supported'),
            );
            mockAxisCareApi.api.getClient
                .mockResolvedValueOnce({ id: 1, firstName: 'John' })
                .mockRejectedValueOnce(new Error('Not found'))
                .mockResolvedValueOnce({ id: 3, firstName: 'Bob' });

            const consoleErrorSpy = jest
                .spyOn(console, 'error')
                .mockImplementation();
            const consoleWarnSpy = jest
                .spyOn(console, 'warn')
                .mockImplementation();

            const result = await integration.fetchPersonsByIds(ids);

            expect(result).toHaveLength(2);
            expect(result[0].id).toBe(1);
            expect(result[1].id).toBe(3);

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Failed to fetch client 2'),
                expect.any(String),
            );

            consoleErrorSpy.mockRestore();
            consoleWarnSpy.mockRestore();
        });
    });
});
