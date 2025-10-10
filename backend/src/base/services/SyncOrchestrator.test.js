/**
 * SyncOrchestrator Service Tests
 * 
 * Tests sync workflow orchestration and coordination.
 */

const SyncOrchestrator = require('./SyncOrchestrator');
const {
    createMockProcessManager,
    createMockQueueManager,
    createMockIntegration,
    buildProcessRecord,
} = require('../__tests__/helpers');

describe('SyncOrchestrator', () => {
    let syncOrchestrator;
    let mockProcessManager;
    let mockQueueManager;
    let mockIntegration;

    beforeEach(() => {
        mockProcessManager = createMockProcessManager();
        mockQueueManager = createMockQueueManager();
        mockIntegration = createMockIntegration({
            id: 'integration-123',
            userId: 'user-456',
        });

        syncOrchestrator = new SyncOrchestrator({
            processManager: mockProcessManager,
            queueManager: mockQueueManager,
        });
    });

    describe('constructor', () => {
        it('should require processManager', () => {
            expect(() => new SyncOrchestrator({ queueManager: mockQueueManager }))
                .toThrow('processManager is required');
        });

        it('should require queueManager', () => {
            expect(() => new SyncOrchestrator({ processManager: mockProcessManager }))
                .toThrow('queueManager is required');
        });

        it('should initialize with dependencies', () => {
            expect(syncOrchestrator.processManager).toBe(mockProcessManager);
            expect(syncOrchestrator.queueManager).toBe(mockQueueManager);
        });
    });

    describe('startInitialSync', () => {
        const personObjectTypes = [
            { crmObjectName: 'Contact', quoContactType: 'contact' },
            { crmObjectName: 'Lead', quoContactType: 'contact' },
        ];

        it('should start initial sync for all person types', async () => {
            const process1 = buildProcessRecord({
                id: 'process-1',
                name: 'integration-123-Contact-sync',
            });
            const process2 = buildProcessRecord({
                id: 'process-2',
                name: 'integration-123-Lead-sync',
            });

            mockProcessManager.createSyncProcess
                .mockResolvedValueOnce(process1)
                .mockResolvedValueOnce(process2);

            const result = await syncOrchestrator.startInitialSync({
                integration: mockIntegration,
                integrationId: 'integration-123',
                personObjectTypes,
            });

            expect(mockProcessManager.createSyncProcess).toHaveBeenCalledTimes(2);
            expect(mockProcessManager.createSyncProcess).toHaveBeenCalledWith({
                integrationId: 'integration-123',
                userId: 'user-456',
                syncType: 'INITIAL',
                personObjectType: 'Contact',
                state: 'INITIALIZING',
                pageSize: 100, // Default from CRMConfig
            });
            expect(mockProcessManager.createSyncProcess).toHaveBeenCalledWith({
                integrationId: 'integration-123',
                userId: 'user-456',
                syncType: 'INITIAL',
                personObjectType: 'Lead',
                state: 'INITIALIZING',
                pageSize: 100,
            });

            expect(mockQueueManager.queueFetchPersonPage).toHaveBeenCalledTimes(2);
            expect(mockQueueManager.queueFetchPersonPage).toHaveBeenCalledWith({
                processId: 'process-1',
                personObjectType: 'Contact',
                page: 0,
                limit: 100,
                sortDesc: true, // reverseChronological: true
            });
            expect(mockQueueManager.queueFetchPersonPage).toHaveBeenCalledWith({
                processId: 'process-2',
                personObjectType: 'Lead',
                page: 0,
                limit: 100,
                sortDesc: true,
            });

            expect(result).toEqual({
                message: 'Initial sync started for 2 person type(s)',
                processIds: ['process-1', 'process-2'],
                personObjectTypes: ['Contact', 'Lead'],
                estimatedCompletion: expect.any(Date),
            });
        });

        it('should throw error if no personObjectTypes provided', async () => {
            await expect(syncOrchestrator.startInitialSync({
                integration: mockIntegration,
                integrationId: 'integration-123',
                personObjectTypes: [],
            })).rejects.toThrow('No personObjectTypes configured for sync');
        });

        it('should throw error if personObjectTypes is null', async () => {
            await expect(syncOrchestrator.startInitialSync({
                integration: mockIntegration,
                integrationId: 'integration-123',
                personObjectTypes: null,
            })).rejects.toThrow('No personObjectTypes configured for sync');
        });

        it('should use custom batch sizes from CRMConfig', async () => {
            const customIntegration = createMockIntegration({
                constructor: {
                    CRMConfig: {
                        personObjectTypes: [{ crmObjectName: 'Contact', quoContactType: 'contact' }],
                        syncConfig: {
                            reverseChronological: true,
                            initialBatchSize: 200, // Custom size
                            ongoingBatchSize: 50,
                            supportsWebhooks: true,
                            pollIntervalMinutes: 60,
                        },
                    },
                },
            });

            const process = buildProcessRecord({ id: 'process-1' });
            mockProcessManager.createSyncProcess.mockResolvedValue(process);

            await syncOrchestrator.startInitialSync({
                integration: customIntegration,
                integrationId: 'integration-123',
                personObjectTypes: [{ crmObjectName: 'Contact', quoContactType: 'contact' }],
            });

            expect(mockProcessManager.createSyncProcess).toHaveBeenCalledWith(
                expect.objectContaining({
                    pageSize: 200,
                })
            );
            expect(mockQueueManager.queueFetchPersonPage).toHaveBeenCalledWith(
                expect.objectContaining({
                    limit: 200,
                })
            );
        });

        it('should handle reverseChronological: false', async () => {
            const ascIntegration = createMockIntegration({
                constructor: {
                    CRMConfig: {
                        personObjectTypes: [{ crmObjectName: 'Contact', quoContactType: 'contact' }],
                        syncConfig: {
                            reverseChronological: false, // Ascending order
                            initialBatchSize: 100,
                        },
                    },
                },
            });

            const process = buildProcessRecord({ id: 'process-1' });
            mockProcessManager.createSyncProcess.mockResolvedValue(process);

            await syncOrchestrator.startInitialSync({
                integration: ascIntegration,
                integrationId: 'integration-123',
                personObjectTypes: [{ crmObjectName: 'Contact', quoContactType: 'contact' }],
            });

            expect(mockQueueManager.queueFetchPersonPage).toHaveBeenCalledWith(
                expect.objectContaining({
                    sortDesc: false,
                })
            );
        });
    });

    describe('startOngoingSync', () => {
        const personObjectTypes = [
            { crmObjectName: 'Contact', quoContactType: 'contact' },
        ];

        it('should start ongoing sync with lastSyncTime', async () => {
            const lastSyncTime = new Date('2024-01-01T10:00:00Z');
            const process = buildProcessRecord({
                id: 'process-1',
                name: 'integration-123-Contact-sync',
            });

            mockProcessManager.createSyncProcess.mockResolvedValue(process);

            const result = await syncOrchestrator.startOngoingSync({
                integration: mockIntegration,
                integrationId: 'integration-123',
                personObjectTypes,
                lastSyncTime,
            });

            expect(mockProcessManager.createSyncProcess).toHaveBeenCalledWith({
                integrationId: 'integration-123',
                userId: 'user-456',
                syncType: 'ONGOING',
                personObjectType: 'Contact',
                state: 'FETCHING_TOTAL',
                lastSyncedTimestamp: lastSyncTime,
                pageSize: 50, // ongoingBatchSize
            });

            expect(mockQueueManager.queueFetchPersonPage).toHaveBeenCalledWith({
                processId: 'process-1',
                personObjectType: 'Contact',
                page: 0,
                limit: 50,
                modifiedSince: lastSyncTime,
                sortDesc: false, // Ongoing sync typically ascending
            });

            expect(result).toEqual({
                message: 'Ongoing sync started',
                processIds: ['process-1'],
                lastSyncTime: '2024-01-01T10:00:00.000Z',
            });
        });

        it('should start ongoing sync without lastSyncTime', async () => {
            const process = buildProcessRecord({ id: 'process-1' });
            mockProcessManager.createSyncProcess.mockResolvedValue(process);

            const result = await syncOrchestrator.startOngoingSync({
                integration: mockIntegration,
                integrationId: 'integration-123',
                personObjectTypes,
                // No lastSyncTime provided
            });

            expect(mockProcessManager.createSyncProcess).toHaveBeenCalledWith({
                integrationId: 'integration-123',
                userId: 'user-456',
                syncType: 'ONGOING',
                personObjectType: 'Contact',
                state: 'FETCHING_TOTAL',
                lastSyncedTimestamp: null,
                pageSize: 50,
            });

            expect(result.lastSyncTime).toBeNull();
        });

        it('should throw error if no personObjectTypes provided', async () => {
            await expect(syncOrchestrator.startOngoingSync({
                integration: mockIntegration,
                integrationId: 'integration-123',
                personObjectTypes: [],
            })).rejects.toThrow('No personObjectTypes configured for sync');
        });
    });

    describe('handleWebhook', () => {
        it('should handle webhook with single record', async () => {
            const webhookData = {
                id: 'person-123',
                firstName: 'John',
                lastName: 'Doe',
                updated_at: '2024-01-01T10:00:00Z',
            };

            const process = buildProcessRecord({
                id: 'process-1',
                name: 'integration-123-webhook-sync',
            });

            mockProcessManager.createSyncProcess.mockResolvedValue(process);

            const result = await syncOrchestrator.handleWebhook({
                integration: mockIntegration,
                data: webhookData,
            });

            expect(mockProcessManager.createSyncProcess).toHaveBeenCalledWith({
                integrationId: 'integration-123',
                userId: 'user-456',
                syncType: 'WEBHOOK',
                personObjectType: 'webhook',
                state: 'PROCESSING_BATCHES',
                totalRecords: 1,
            });

            expect(mockQueueManager.queueProcessPersonBatch).toHaveBeenCalledWith({
                processId: 'process-1',
                crmPersonIds: ['person-123'],
                isWebhook: true,
            });

            expect(result).toEqual({
                status: 'queued',
                processId: 'process-1',
                count: 1,
            });
        });

        it('should handle webhook with multiple records', async () => {
            const webhookData = [
                { id: 'person-1', firstName: 'John' },
                { id: 'person-2', firstName: 'Jane' },
                { id: 'person-3', firstName: 'Bob' },
            ];

            const process = buildProcessRecord({ id: 'process-1' });
            mockProcessManager.createSyncProcess.mockResolvedValue(process);

            const result = await syncOrchestrator.handleWebhook({
                integration: mockIntegration,
                data: webhookData,
            });

            expect(mockProcessManager.createSyncProcess).toHaveBeenCalledWith(
                expect.objectContaining({
                    totalRecords: 3,
                })
            );

            expect(mockQueueManager.queueProcessPersonBatch).toHaveBeenCalledWith({
                processId: 'process-1',
                crmPersonIds: ['person-1', 'person-2', 'person-3'],
                isWebhook: true,
            });

            expect(result).toEqual({
                status: 'queued',
                processId: 'process-1',
                count: 3,
            });
        });

        it('should skip webhook with empty data', async () => {
            const result = await syncOrchestrator.handleWebhook({
                integration: mockIntegration,
                data: [],
            });

            expect(mockProcessManager.createSyncProcess).not.toHaveBeenCalled();
            expect(mockQueueManager.queueProcessPersonBatch).not.toHaveBeenCalled();

            expect(result).toEqual({
                status: 'skipped',
                message: 'No data in webhook',
                count: 0,
            });
        });

        it('should skip webhook with null data', async () => {
            const result = await syncOrchestrator.handleWebhook({
                integration: mockIntegration,
                data: null,
            });

            expect(result).toEqual({
                status: 'skipped',
                message: 'No data in webhook',
                count: 0,
            });
        });
    });

    describe('getLastSyncTime', () => {
        it('should return null (not yet implemented)', async () => {
            const result = await syncOrchestrator.getLastSyncTime('integration-123');
            expect(result).toBeNull();
        });
    });

    describe('hasActiveSyncs', () => {
        it('should return false (not yet implemented)', async () => {
            const result = await syncOrchestrator.hasActiveSyncs('integration-123');
            expect(result).toBe(false);
        });
    });

    describe('cancelActiveSyncs', () => {
        it('should return not implemented message', async () => {
            const result = await syncOrchestrator.cancelActiveSyncs('integration-123');
            expect(result).toEqual({
                message: 'Active sync cancellation not yet implemented',
                cancelledCount: 0,
            });
        });
    });

    describe('error handling', () => {
        it('should propagate processManager errors', async () => {
            const processError = new Error('Process creation failed');
            mockProcessManager.createSyncProcess.mockRejectedValue(processError);

            await expect(syncOrchestrator.startInitialSync({
                integration: mockIntegration,
                integrationId: 'integration-123',
                personObjectTypes: [{ crmObjectName: 'Contact', quoContactType: 'contact' }],
            })).rejects.toThrow('Process creation failed');
        });

        it('should propagate queueManager errors', async () => {
            const queueError = new Error('Queue operation failed');
            mockQueueManager.queueFetchPersonPage.mockRejectedValue(queueError);

            const process = buildProcessRecord({ id: 'process-1' });
            mockProcessManager.createSyncProcess.mockResolvedValue(process);

            await expect(syncOrchestrator.startInitialSync({
                integration: mockIntegration,
                integrationId: 'integration-123',
                personObjectTypes: [{ crmObjectName: 'Contact', quoContactType: 'contact' }],
            })).rejects.toThrow('Queue operation failed');
        });
    });
});
