/**
 * ProcessManager Service Tests
 *
 * Tests the ProcessManager service with mocked use cases.
 * Demonstrates the testing approach for service layer components.
 */

const ProcessManager = require('./ProcessManager');
const {
    createMockProcessRepository,
    buildProcessData,
    buildProcessRecord,
    assertValidProcess,
    assertValidCRMSyncContext,
} = require('../__tests__/helpers');

describe('ProcessManager', () => {
    let processManager;
    let mockCreateProcessUseCase;
    let mockUpdateProcessStateUseCase;
    let mockUpdateProcessMetricsUseCase;
    let mockGetProcessUseCase;

    beforeEach(() => {
        // Create mock use cases
        mockCreateProcessUseCase = {
            execute: jest.fn(),
        };
        mockUpdateProcessStateUseCase = {
            execute: jest.fn(),
            processRepository: createMockProcessRepository(),
        };
        mockUpdateProcessMetricsUseCase = {
            execute: jest.fn(),
        };
        mockGetProcessUseCase = {
            execute: jest.fn(),
        };

        // Create ProcessManager with mocked dependencies
        processManager = new ProcessManager({
            createProcessUseCase: mockCreateProcessUseCase,
            updateProcessStateUseCase: mockUpdateProcessStateUseCase,
            updateProcessMetricsUseCase: mockUpdateProcessMetricsUseCase,
            getProcessUseCase: mockGetProcessUseCase,
        });
    });

    describe('constructor', () => {
        it('should require all use cases', () => {
            expect(() => new ProcessManager({})).toThrow(
                'createProcessUseCase is required',
            );
        });

        it('should initialize with all dependencies', () => {
            expect(processManager.createProcessUseCase).toBe(
                mockCreateProcessUseCase,
            );
            expect(processManager.updateProcessStateUseCase).toBe(
                mockUpdateProcessStateUseCase,
            );
            expect(processManager.updateProcessMetricsUseCase).toBe(
                mockUpdateProcessMetricsUseCase,
            );
            expect(processManager.getProcessUseCase).toBe(
                mockGetProcessUseCase,
            );
        });
    });

    describe('createSyncProcess', () => {
        it('should create a CRM sync process with proper structure', async () => {
            const mockProcess = buildProcessRecord();
            mockCreateProcessUseCase.execute.mockResolvedValue(mockProcess);

            const result = await processManager.createSyncProcess({
                integrationId: 'integration-123',
                userId: 'user-456',
                syncType: 'INITIAL',
                personObjectType: 'Contact',
                state: 'INITIALIZING',
            });

            // Verify use case was called
            expect(mockCreateProcessUseCase.execute).toHaveBeenCalledTimes(1);
            const callArgs = mockCreateProcessUseCase.execute.mock.calls[0][0];

            // Verify process structure
            expect(callArgs.userId).toBe('user-456');
            expect(callArgs.integrationId).toBe('integration-123');
            expect(callArgs.type).toBe('CRM_SYNC');
            expect(callArgs.state).toBe('INITIALIZING');
            expect(callArgs.name).toContain('Contact-sync');

            // Verify context structure
            assertValidCRMSyncContext(callArgs.context);
            expect(callArgs.context.syncType).toBe('INITIAL');
            expect(callArgs.context.personObjectType).toBe('Contact');

            // Verify results structure
            expect(callArgs.results.aggregateData).toBeDefined();
            expect(callArgs.results.aggregateData.totalSynced).toBe(0);
            expect(callArgs.results.pages).toBeDefined();

            // Verify returned value
            expect(result).toEqual(mockProcess);
        });

        it('should include lastSyncedTimestamp for ongoing syncs', async () => {
            const mockProcess = buildProcessRecord();
            mockCreateProcessUseCase.execute.mockResolvedValue(mockProcess);

            const lastSyncTime = new Date('2024-01-01');
            await processManager.createSyncProcess({
                integrationId: 'integration-123',
                userId: 'user-456',
                syncType: 'ONGOING',
                personObjectType: 'Contact',
                lastSyncedTimestamp: lastSyncTime,
            });

            const callArgs = mockCreateProcessUseCase.execute.mock.calls[0][0];
            expect(callArgs.context.lastSyncedTimestamp).toBe(
                lastSyncTime.toISOString(),
            );
        });

        it('should use custom pageSize if provided', async () => {
            const mockProcess = buildProcessRecord();
            mockCreateProcessUseCase.execute.mockResolvedValue(mockProcess);

            await processManager.createSyncProcess({
                integrationId: 'integration-123',
                userId: 'user-456',
                syncType: 'INITIAL',
                personObjectType: 'Contact',
                pageSize: 50,
            });

            const callArgs = mockCreateProcessUseCase.execute.mock.calls[0][0];
            expect(callArgs.context.pagination.pageSize).toBe(50);
        });
    });

    describe('updateState', () => {
        it('should update process state', async () => {
            const mockProcess = buildProcessRecord({ state: 'FETCHING_TOTAL' });
            mockUpdateProcessStateUseCase.execute.mockResolvedValue(
                mockProcess,
            );

            const result = await processManager.updateState(
                'process-123',
                'FETCHING_TOTAL',
            );

            expect(mockUpdateProcessStateUseCase.execute).toHaveBeenCalledWith(
                'process-123',
                'FETCHING_TOTAL',
                {},
            );
            expect(result).toEqual(mockProcess);
        });

        it('should update state with context updates', async () => {
            const mockProcess = buildProcessRecord();
            mockUpdateProcessStateUseCase.execute.mockResolvedValue(
                mockProcess,
            );

            const contextUpdates = { currentPage: 5 };
            await processManager.updateState(
                'process-123',
                'PROCESSING_BATCHES',
                contextUpdates,
            );

            expect(mockUpdateProcessStateUseCase.execute).toHaveBeenCalledWith(
                'process-123',
                'PROCESSING_BATCHES',
                contextUpdates,
            );
        });
    });

    describe('updateMetrics', () => {
        it('should update process metrics', async () => {
            const mockProcess = buildProcessRecord();
            mockUpdateProcessMetricsUseCase.execute.mockResolvedValue(
                mockProcess,
            );

            const metricsUpdate = {
                processed: 100,
                success: 95,
                errors: 5,
            };

            const result = await processManager.updateMetrics(
                'process-123',
                metricsUpdate,
            );

            expect(
                mockUpdateProcessMetricsUseCase.execute,
            ).toHaveBeenCalledWith('process-123', metricsUpdate);
            expect(result).toEqual(mockProcess);
        });
    });

    describe('getProcess', () => {
        it('should retrieve a process', async () => {
            const mockProcess = buildProcessRecord();
            mockGetProcessUseCase.execute.mockResolvedValue(mockProcess);

            const result = await processManager.getProcess('process-123');

            expect(mockGetProcessUseCase.execute).toHaveBeenCalledWith(
                'process-123',
            );
            expect(result).toEqual(mockProcess);
        });

        it('should return null if process not found', async () => {
            mockGetProcessUseCase.execute.mockResolvedValue(null);

            const result = await processManager.getProcess('nonexistent');

            expect(result).toBeNull();
        });
    });

    describe('handleError', () => {
        it('should update process to ERROR state with error details', async () => {
            const mockProcess = buildProcessRecord({ state: 'ERROR' });
            mockUpdateProcessStateUseCase.execute.mockResolvedValue(
                mockProcess,
            );

            const error = new Error('Something went wrong');
            const result = await processManager.handleError(
                'process-123',
                error,
            );

            expect(mockUpdateProcessStateUseCase.execute).toHaveBeenCalledWith(
                'process-123',
                'ERROR',
                expect.objectContaining({
                    error: 'Something went wrong',
                    errorStack: expect.any(String),
                    errorTimestamp: expect.any(String),
                }),
            );
            expect(result).toEqual(mockProcess);
        });
    });

    describe('completeProcess', () => {
        it('should mark process as completed with endTime', async () => {
            const mockProcess = buildProcessRecord({ state: 'COMPLETED' });
            mockUpdateProcessStateUseCase.execute.mockResolvedValue(
                mockProcess,
            );

            const result = await processManager.completeProcess('process-123');

            expect(mockUpdateProcessStateUseCase.execute).toHaveBeenCalledWith(
                'process-123',
                'COMPLETED',
                expect.objectContaining({
                    endTime: expect.any(String),
                }),
            );
            expect(result).toEqual(mockProcess);
        });
    });
});
