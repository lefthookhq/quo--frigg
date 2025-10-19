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
        integration.axiscare = mockAxisCareApi;
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

    describe('Static Configuration', () => {
        it('should have correct Definition', () => {
            expect(AxisCareIntegration.Definition.name).toBe('axiscare');
            expect(AxisCareIntegration.Definition.display.label).toBe(
                'AxisCare',
            );
        });

        it('should have correct CRMConfig', () => {
            expect(
                AxisCareIntegration.CRMConfig.personObjectTypes,
            ).toHaveLength(1);
            expect(
                AxisCareIntegration.CRMConfig.personObjectTypes[0]
                    .crmObjectName,
            ).toBe('Client');
            expect(
                AxisCareIntegration.CRMConfig.syncConfig.supportsWebhooks,
            ).toBe(false);
        });
    });

    describe('Required Methods', () => {
        describe('fetchPersonPage', () => {
            it('should fetch clients page correctly', async () => {
                const mockResponse = {
                    clients: [{ id: 1, first_name: 'John', last_name: 'Doe' }],
                    total_count: 1,
                    has_more: false,
                };

                mockAxisCareApi.api.clients.getAll.mockResolvedValue(
                    mockResponse,
                );

                const result = await integration.fetchPersonPage({
                    objectType: 'Client',
                    page: 0,
                    limit: 10,
                    sortDesc: true,
                });

                expect(result.data).toEqual(mockResponse.clients);
                expect(result.total).toBe(1);
                expect(result.hasMore).toBe(false);
            });
        });

        describe('transformPersonToQuo', () => {
            it('should transform AxisCare client to Quo format', async () => {
                const client = {
                    id: 123,
                    first_name: 'John',
                    last_name: 'Doe',
                    email: 'john@example.com',
                    phone: '555-1234',
                    mobile_phone: '555-5678',
                    status: 'active',
                    date_of_birth: '1950-01-01',
                    address: '123 Main St',
                    city: 'Springfield',
                    state: 'IL',
                    zip_code: '62701',
                };

                const result = await integration.transformPersonToQuo(client);

                expect(result.externalId).toBe('123');
                expect(result.source).toBe('axiscare');
                expect(result.defaultFields.firstName).toBe('John');
                expect(result.defaultFields.phoneNumbers).toHaveLength(2);
                expect(result.customFields.status).toBe('active');
            });
        });

        describe('logSMSToActivity', () => {
            it('should log SMS to AxisCare communications', async () => {
                mockAxisCareApi.api.clients.get.mockResolvedValue({ id: 123 });
                mockAxisCareApi.api.communications.create.mockResolvedValue({
                    id: 456,
                });

                await integration.logSMSToActivity({
                    contactExternalId: '123',
                    direction: 'outbound',
                    content: 'Test SMS',
                    timestamp: '2025-01-10T15:30:00Z',
                });

                expect(
                    mockAxisCareApi.api.communications.create,
                ).toHaveBeenCalled();
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

        it('should have LIST_AXISCARE_APPOINTMENTS event', () => {
            expect(integration.events.LIST_AXISCARE_APPOINTMENTS).toBeDefined();
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
