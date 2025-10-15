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

    describe('Cursor-Based Pagination', () => {
        describe('fetchPersonPageHandler', () => {
            it('should fetch first page and queue next page when more exist', async () => {
                const mockResponse = {
                    results: {
                        clients: [
                            { id: 1, firstName: 'John', lastName: 'Doe' },
                            { id: 2, firstName: 'Jane', lastName: 'Smith' },
                        ],
                    },
                    nextPage:
                        'https://agency.axiscare.com/api/clients?startAfterId=2&limit=50',
                    errors: null,
                };

                integration.processManager.getMetadata.mockResolvedValue({});
                mockAxisCareApi.api.listClients.mockResolvedValue(
                    mockResponse,
                );

                await integration.fetchPersonPageHandler({
                    data: {
                        processId: 'proc_123',
                        personObjectType: 'Client',
                        page: 0,
                        limit: 50,
                    },
                });

                // Should update state to FETCHING_PAGE
                expect(
                    integration.processManager.updateState,
                ).toHaveBeenCalledWith('proc_123', 'FETCHING_PAGE');

                // Should call listClients for first page
                expect(mockAxisCareApi.api.listClients).toHaveBeenCalledWith({
                    limit: 50,
                });

                // Should update metadata with nextPage URL
                expect(
                    integration.processManager.updateMetadata,
                ).toHaveBeenCalledWith('proc_123', {
                    nextPageUrl: mockResponse.nextPage,
                    totalFetched: 2,
                    pageCount: 1,
                });

                // Should queue batch processing
                expect(
                    integration.queueManager.queueProcessPersonBatch,
                ).toHaveBeenCalledWith({
                    processId: 'proc_123',
                    crmPersonIds: ['1', '2'],
                    page: 0,
                    totalInPage: 2,
                });

                // Should queue next page
                expect(
                    integration.queueManager.queueFetchPersonPage,
                ).toHaveBeenCalledWith({
                    processId: 'proc_123',
                    personObjectType: 'Client',
                    page: 1,
                    limit: 50,
                });
            });

            it('should use stored nextPage URL for subsequent pages', async () => {
                const nextPageUrl =
                    'https://agency.axiscare.com/api/clients?startAfterId=100&limit=50';
                const mockResponse = {
                    results: {
                        clients: [
                            { id: 101, firstName: 'Test', lastName: 'User' },
                        ],
                    },
                    nextPage: null, // Last page
                    errors: null,
                };

                integration.processManager.getMetadata.mockResolvedValue({
                    nextPageUrl,
                    totalFetched: 100,
                    pageCount: 2,
                });
                mockAxisCareApi.api.getFromUrl.mockResolvedValue(mockResponse);

                await integration.fetchPersonPageHandler({
                    data: {
                        processId: 'proc_123',
                        personObjectType: 'Client',
                        page: 2,
                        limit: 50,
                    },
                });

                // Should use getFromUrl with stored URL
                expect(mockAxisCareApi.api.getFromUrl).toHaveBeenCalledWith(
                    nextPageUrl,
                );

                // Should queue completion (no more pages)
                expect(
                    integration.queueManager.queueCompleteSync,
                ).toHaveBeenCalledWith('proc_123');
            });

            it('should handle empty first page', async () => {
                const mockResponse = {
                    results: { clients: [] },
                    nextPage: null,
                    errors: null,
                };

                integration.processManager.getMetadata.mockResolvedValue({});
                mockAxisCareApi.api.listClients.mockResolvedValue(
                    mockResponse,
                );

                await integration.fetchPersonPageHandler({
                    data: {
                        processId: 'proc_123',
                        personObjectType: 'Client',
                        page: 0,
                        limit: 50,
                    },
                });

                // Should update total to 0
                expect(
                    integration.processManager.updateTotal,
                ).toHaveBeenCalledWith('proc_123', 0, 0);

                // Should queue completion
                expect(
                    integration.queueManager.queueCompleteSync,
                ).toHaveBeenCalledWith('proc_123');
            });

            it('should handle API errors and update process', async () => {
                const apiError = new Error('API connection failed');

                integration.processManager.getMetadata.mockResolvedValue({});
                mockAxisCareApi.api.listClients.mockRejectedValue(apiError);

                await expect(
                    integration.fetchPersonPageHandler({
                        data: {
                            processId: 'proc_123',
                            personObjectType: 'Client',
                            page: 0,
                            limit: 50,
                        },
                    }),
                ).rejects.toThrow('API connection failed');

                // Should call handleError
                expect(
                    integration.processManager.handleError,
                ).toHaveBeenCalledWith('proc_123', apiError);
            });

            it('should validate and throw on AxisCare API error response', async () => {
                const mockResponse = {
                    results: { clients: [] },
                    errors: [
                        {
                            code: 'INVALID_TOKEN',
                            message: 'Authentication failed',
                        },
                    ],
                };

                integration.processManager.getMetadata.mockResolvedValue({});
                mockAxisCareApi.api.listClients.mockResolvedValue(
                    mockResponse,
                );

                await expect(
                    integration.fetchPersonPageHandler({
                        data: {
                            processId: 'proc_123',
                            personObjectType: 'Client',
                            page: 0,
                            limit: 50,
                        },
                    }),
                ).rejects.toThrow('AxisCare API returned errors');
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

                mockAxisCareApi.api.listClients.mockResolvedValue(
                    mockResponse,
                );

                const result = await integration.fetchPersonsByIds(ids);

                // Should call listClients with comma-separated IDs
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

                const consoleSpy = jest
                    .spyOn(console, 'warn')
                    .mockImplementation();

                const result = await integration.fetchPersonsByIds(ids);

                // Should log warning
                expect(consoleSpy).toHaveBeenCalledWith(
                    expect.stringContaining('Bulk fetch failed'),
                    expect.any(String),
                );

                // Should fetch individually
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

                // Should return only successful fetches
                expect(result).toHaveLength(2);
                expect(result[0].id).toBe(1);
                expect(result[1].id).toBe(3);

                // Should log error for failed fetch
                expect(consoleErrorSpy).toHaveBeenCalledWith(
                    expect.stringContaining('Failed to fetch client 2'),
                    expect.any(String),
                );

                consoleErrorSpy.mockRestore();
                consoleWarnSpy.mockRestore();
            });
        });

        describe('_fetchWithRetry', () => {
            it('should succeed on first attempt', async () => {
                const fetchFn = jest
                    .fn()
                    .mockResolvedValue({ success: true });

                const result = await integration._fetchWithRetry(fetchFn);

                expect(fetchFn).toHaveBeenCalledTimes(1);
                expect(result).toEqual({ success: true });
            });

            it('should retry on network errors', async () => {
                const networkError = new Error('Network timeout');
                networkError.code = 'ETIMEDOUT';

                const fetchFn = jest
                    .fn()
                    .mockRejectedValueOnce(networkError)
                    .mockRejectedValueOnce(networkError)
                    .mockResolvedValueOnce({ success: true });

                const consoleSpy = jest
                    .spyOn(console, 'log')
                    .mockImplementation();

                const result = await integration._fetchWithRetry(
                    fetchFn,
                    3,
                    100,
                );

                expect(fetchFn).toHaveBeenCalledTimes(3);
                expect(result).toEqual({ success: true });
                expect(consoleSpy).toHaveBeenCalledWith(
                    expect.stringContaining('Retry 1/3'),
                );

                consoleSpy.mockRestore();
            });

            it('should retry on 5xx server errors', async () => {
                const serverError = new Error('Internal server error');
                serverError.response = { status: 503 };

                const fetchFn = jest
                    .fn()
                    .mockRejectedValueOnce(serverError)
                    .mockResolvedValueOnce({ success: true });

                const result = await integration._fetchWithRetry(
                    fetchFn,
                    3,
                    100,
                );

                expect(fetchFn).toHaveBeenCalledTimes(2);
                expect(result).toEqual({ success: true });
            });

            it('should retry on rate limit (429)', async () => {
                const rateLimitError = new Error('Rate limit exceeded');
                rateLimitError.response = { status: 429 };

                const fetchFn = jest
                    .fn()
                    .mockRejectedValueOnce(rateLimitError)
                    .mockResolvedValueOnce({ success: true });

                const result = await integration._fetchWithRetry(
                    fetchFn,
                    3,
                    100,
                );

                expect(fetchFn).toHaveBeenCalledTimes(2);
            });

            it('should NOT retry on 4xx client errors', async () => {
                const clientError = new Error('Bad request');
                clientError.response = { status: 400 };

                const fetchFn = jest.fn().mockRejectedValue(clientError);

                await expect(
                    integration._fetchWithRetry(fetchFn, 3, 100),
                ).rejects.toThrow('Bad request');

                // Should only try once (no retry on client errors)
                expect(fetchFn).toHaveBeenCalledTimes(1);
            });

            it('should throw after max retries', async () => {
                const networkError = new Error('Connection failed');
                networkError.code = 'ECONNRESET';

                const fetchFn = jest.fn().mockRejectedValue(networkError);

                await expect(
                    integration._fetchWithRetry(fetchFn, 3, 100),
                ).rejects.toThrow('Connection failed');

                expect(fetchFn).toHaveBeenCalledTimes(3);
            });

            it('should use exponential backoff with jitter', async () => {
                const error = new Error('Timeout');
                error.code = 'ETIMEDOUT';

                const fetchFn = jest
                    .fn()
                    .mockRejectedValueOnce(error)
                    .mockRejectedValueOnce(error)
                    .mockResolvedValueOnce({ success: true });

                const startTime = Date.now();
                await integration._fetchWithRetry(fetchFn, 3, 100);
                const duration = Date.now() - startTime;

                // Should take at least 100ms (first retry) + 200ms (second retry) = 300ms
                // (allowing for jitter and test execution time)
                expect(duration).toBeGreaterThan(250);
            });
        });
    });
});
