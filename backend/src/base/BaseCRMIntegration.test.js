/**
 * BaseCRMIntegration Tests
 * 
 * Tests the base class for CRM integrations with mocked services.
 */

const { BaseCRMIntegration } = require('./BaseCRMIntegration');
const {
    createMockProcessManager,
    createMockQueueManager,
    createMockSyncOrchestrator,
    createMockIntegration,
    buildProcessRecord,
    buildPersonPageResponse,
    buildQuoContact,
} = require('./__tests__/helpers');

describe('BaseCRMIntegration', () => {
    let integration;
    let mockProcessManager;
    let mockQueueManager;
    let mockSyncOrchestrator;

    beforeEach(() => {
        // Create a concrete test class that extends BaseCRMIntegration
        class TestCRMIntegration extends BaseCRMIntegration {
            static CRMConfig = {
                personObjectTypes: [
                    { crmObjectName: 'Contact', quoContactType: 'contact' },
                ],
                syncConfig: {
                    reverseChronological: true,
                    initialBatchSize: 100,
                    ongoingBatchSize: 50,
                    supportsWebhooks: true,
                    pollIntervalMinutes: 60,
                },
                queueConfig: {
                    maxWorkers: 25,
                    provisioned: 10,
                },
            };

            async fetchPersonPage(params) {
                return buildPersonPageResponse({
                    data: [
                        { id: 'person-1', firstName: 'John', lastName: 'Doe' },
                        { id: 'person-2', firstName: 'Jane', lastName: 'Smith' },
                    ],
                    total: 100,
                    hasMore: true,
                });
            }

            async transformPersonToQuo(person) {
                return buildQuoContact({
                    externalId: person.id,
                    defaultFields: {
                        firstName: person.firstName,
                        lastName: person.lastName,
                    },
                });
            }

            async logSMSToActivity(activity) {
                console.log('SMS logged:', activity);
            }

            async logCallToActivity(activity) {
                console.log('Call logged:', activity);
            }

            async setupWebhooks() {
                console.log('Webhooks setup');
            }

            async fetchPersonById(id) {
                return { id, firstName: 'Test', lastName: 'Person' };
            }

            async fetchPersonsByIds(ids) {
                return ids.map(id => ({ id, firstName: 'Test', lastName: 'Person' }));
            }
        }

        integration = new TestCRMIntegration({
            id: 'integration-123',
            userId: 'user-456',
        });

        // Inject mock services
        mockProcessManager = createMockProcessManager();
        mockQueueManager = createMockQueueManager();
        mockSyncOrchestrator = createMockSyncOrchestrator();

        integration._processManager = mockProcessManager;
        integration._queueManager = mockQueueManager;
        integration._syncOrchestrator = mockSyncOrchestrator;
    });

    describe('constructor', () => {
        it('should extend IntegrationBase', () => {
            expect(integration).toBeInstanceOf(BaseCRMIntegration);
        });

        it('should initialize with lazy service loading', () => {
            expect(integration._processManager).toBe(mockProcessManager);
            expect(integration._queueManager).toBe(mockQueueManager);
            expect(integration._syncOrchestrator).toBe(mockSyncOrchestrator);
        });

        it('should auto-generate CRM events', () => {
            expect(integration.events).toHaveProperty('INITIAL_SYNC');
            expect(integration.events).toHaveProperty('ONGOING_SYNC');
            expect(integration.events).toHaveProperty('WEBHOOK_RECEIVED');
            expect(integration.events).toHaveProperty('FETCH_PERSON_PAGE');
            expect(integration.events).toHaveProperty('PROCESS_PERSON_BATCH');
            expect(integration.events).toHaveProperty('COMPLETE_SYNC');
            expect(integration.events).toHaveProperty('LOG_SMS');
            expect(integration.events).toHaveProperty('LOG_CALL');
        });

        it('should have proper event configurations', () => {
            expect(integration.events.INITIAL_SYNC.type).toBe('USER_ACTION');
            expect(integration.events.ONGOING_SYNC.type).toBe('CRON');
            expect(integration.events.LOG_SMS.type).toBeUndefined(); // No type for internal events
        });
    });

    describe('service getters', () => {
        it('should return injected services', () => {
            expect(integration.processManager).toBe(mockProcessManager);
            expect(integration.queueManager).toBe(mockQueueManager);
            expect(integration.syncOrchestrator).toBe(mockSyncOrchestrator);
        });
    });

    describe('abstract method enforcement', () => {
        it('should throw error for unimplemented fetchPersonPage', async () => {
            class IncompleteIntegration extends BaseCRMIntegration {
                static CRMConfig = { personObjectTypes: [] };
            }

            const incomplete = new IncompleteIntegration();
            await expect(incomplete.fetchPersonPage({}))
                .rejects.toThrow('fetchPersonPage must be implemented by child class');
        });

        it('should throw error for unimplemented transformPersonToQuo', async () => {
            class IncompleteIntegration extends BaseCRMIntegration {
                static CRMConfig = { personObjectTypes: [] };
            }

            const incomplete = new IncompleteIntegration();
            await expect(incomplete.transformPersonToQuo({}))
                .rejects.toThrow('transformPersonToQuo must be implemented by child class');
        });

        it('should throw error for unimplemented logSMSToActivity', async () => {
            class IncompleteIntegration extends BaseCRMIntegration {
                static CRMConfig = { personObjectTypes: [] };
            }

            const incomplete = new IncompleteIntegration();
            await expect(incomplete.logSMSToActivity({}))
                .rejects.toThrow('logSMSToActivity must be implemented by child class');
        });

        it('should throw error for unimplemented logCallToActivity', async () => {
            class IncompleteIntegration extends BaseCRMIntegration {
                static CRMConfig = { personObjectTypes: [] };
            }

            const incomplete = new IncompleteIntegration();
            await expect(incomplete.logCallToActivity({}))
                .rejects.toThrow('logCallToActivity must be implemented by child class');
        });

        it('should throw error for unimplemented setupWebhooks', async () => {
            class IncompleteIntegration extends BaseCRMIntegration {
                static CRMConfig = { personObjectTypes: [] };
            }

            const incomplete = new IncompleteIntegration();
            await expect(incomplete.setupWebhooks())
                .rejects.toThrow('setupWebhooks must be implemented by child class');
        });
    });

    describe('lifecycle methods', () => {
        it('should handle onCreate with webhook support', async () => {
            const updateIntegrationStatusSpy = jest.spyOn(integration, 'updateIntegrationStatus', 'get')
                .mockReturnValue({ execute: jest.fn() });
            const checkIfNeedsConfigSpy = jest.spyOn(integration, 'checkIfNeedsConfig')
                .mockResolvedValue(false);

            await integration.onCreate({ integrationId: 'integration-123' });

            expect(checkIfNeedsConfigSpy).toHaveBeenCalled();
            expect(updateIntegrationStatusSpy().execute).toHaveBeenCalledWith(
                'integration-123',
                'ENABLED'
            );
        });

        it('should handle onCreate with config needed', async () => {
            const updateIntegrationStatusSpy = jest.spyOn(integration, 'updateIntegrationStatus', 'get')
                .mockReturnValue({ execute: jest.fn() });
            const checkIfNeedsConfigSpy = jest.spyOn(integration, 'checkIfNeedsConfig')
                .mockResolvedValue(true);

            await integration.onCreate({ integrationId: 'integration-123' });

            expect(checkIfNeedsConfigSpy).toHaveBeenCalled();
            expect(updateIntegrationStatusSpy().execute).toHaveBeenCalledWith(
                'integration-123',
                'NEEDS_CONFIG'
            );
        });

        it('should handle onUpdate with triggerInitialSync', async () => {
            const startInitialSyncSpy = jest.spyOn(integration, 'startInitialSync')
                .mockResolvedValue({ processIds: ['process-1'] });

            await integration.onUpdate({
                integrationId: 'integration-123',
                config: { triggerInitialSync: true },
            });

            expect(startInitialSyncSpy).toHaveBeenCalledWith({ integrationId: 'integration-123' });
        });

        it('should not trigger sync if triggerInitialSync is false', async () => {
            const startInitialSyncSpy = jest.spyOn(integration, 'startInitialSync');

            await integration.onUpdate({
                integrationId: 'integration-123',
                config: { triggerInitialSync: false },
            });

            expect(startInitialSyncSpy).not.toHaveBeenCalled();
        });
    });

    describe('public orchestration methods', () => {
        it('should delegate startInitialSync to SyncOrchestrator', async () => {
            const expectedResult = {
                message: 'Initial sync started',
                processIds: ['process-1'],
            };
            mockSyncOrchestrator.startInitialSync.mockResolvedValue(expectedResult);

            const result = await integration.startInitialSync({ integrationId: 'integration-123' });

            expect(mockSyncOrchestrator.startInitialSync).toHaveBeenCalledWith({
                integration: integration,
                integrationId: 'integration-123',
                personObjectTypes: integration.constructor.CRMConfig.personObjectTypes,
            });
            expect(result).toEqual(expectedResult);
        });

        it('should delegate startOngoingSync to SyncOrchestrator', async () => {
            const expectedResult = { message: 'Ongoing sync started' };
            mockSyncOrchestrator.startOngoingSync.mockResolvedValue(expectedResult);

            const result = await integration.startOngoingSync({ integrationId: 'integration-123' });

            expect(mockSyncOrchestrator.startOngoingSync).toHaveBeenCalledWith({
                integration: integration,
                integrationId: 'integration-123',
                personObjectTypes: integration.constructor.CRMConfig.personObjectTypes,
            });
            expect(result).toEqual(expectedResult);
        });

        it('should delegate handleWebhook to SyncOrchestrator', async () => {
            const webhookData = { id: 'person-1', firstName: 'John' };
            const expectedResult = { status: 'queued', count: 1 };
            mockSyncOrchestrator.handleWebhook.mockResolvedValue(expectedResult);

            const result = await integration.handleWebhook({ data: webhookData });

            expect(mockSyncOrchestrator.handleWebhook).toHaveBeenCalledWith({
                integration: integration,
                data: webhookData,
            });
            expect(result).toEqual(expectedResult);
        });
    });

    describe('queue handlers', () => {
        describe('fetchPersonPageHandler', () => {
            it('should fetch page and update process state', async () => {
                const data = {
                    processId: 'process-123',
                    personObjectType: 'Contact',
                    page: 0,
                    limit: 100,
                    sortDesc: true,
                };

                const mockProcess = buildProcessRecord({ id: 'process-123' });
                mockProcessManager.updateState.mockResolvedValue(mockProcess);
                mockProcessManager.updateTotal.mockResolvedValue(mockProcess);
                mockQueueManager.fanOutPages.mockResolvedValue();
                mockQueueManager.queueProcessPersonBatch.mockResolvedValue();

                await integration.fetchPersonPageHandler({ data });

                expect(mockProcessManager.updateState).toHaveBeenCalledWith(
                    'process-123',
                    'FETCHING_TOTAL'
                );
                expect(mockProcessManager.updateTotal).toHaveBeenCalledWith(
                    'process-123',
                    100, // total from mock response
                    1    // totalPages = Math.ceil(100/100)
                );
                expect(mockQueueManager.queueProcessPersonBatch).toHaveBeenCalledWith({
                    processId: 'process-123',
                    crmPersonIds: ['person-1', 'person-2'],
                    page: 0,
                    totalInPage: 2,
                });
            });

            it('should handle errors in fetchPersonPageHandler', async () => {
                const data = {
                    processId: 'process-123',
                    personObjectType: 'Contact',
                    page: 0,
                    limit: 100,
                };

                // Mock fetchPersonPage to throw error
                jest.spyOn(integration, 'fetchPersonPage').mockRejectedValue(
                    new Error('API connection failed')
                );

                mockProcessManager.handleError.mockResolvedValue();

                await integration.fetchPersonPageHandler({ data });

                expect(mockProcessManager.handleError).toHaveBeenCalledWith(
                    'process-123',
                    expect.any(Error)
                );
            });
        });

        describe('processPersonBatchHandler', () => {
            it('should process batch and update metrics', async () => {
                const data = {
                    processId: 'process-123',
                    crmPersonIds: ['person-1', 'person-2'],
                    page: 1,
                };

                mockProcessManager.updateMetrics.mockResolvedValue();

                await integration.processPersonBatchHandler({ data });

                expect(mockProcessManager.updateMetrics).toHaveBeenCalledWith(
                    'process-123',
                    {
                        processed: 2,
                        success: 2, // Mock bulkUpsertToQuo returns successCount: 2
                        errors: 0,
                        errorDetails: [],
                    }
                );
            });

            it('should handle errors in processPersonBatchHandler', async () => {
                const data = {
                    processId: 'process-123',
                    crmPersonIds: ['person-1', 'person-2'],
                    page: 1,
                };

                // Mock fetchPersonsByIds to throw error
                jest.spyOn(integration, 'fetchPersonsByIds').mockRejectedValue(
                    new Error('CRM API failed')
                );

                mockProcessManager.updateMetrics.mockResolvedValue();

                await integration.processPersonBatchHandler({ data });

                expect(mockProcessManager.updateMetrics).toHaveBeenCalledWith(
                    'process-123',
                    {
                        processed: 0,
                        success: 0,
                        errors: 2,
                        errorDetails: [{ error: 'CRM API failed', batch: 1 }],
                    }
                );
            });
        });

        describe('completeSyncHandler', () => {
            it('should complete the process', async () => {
                const data = { processId: 'process-123' };

                mockProcessManager.completeProcess.mockResolvedValue();

                await integration.completeSyncHandler({ data });

                expect(mockProcessManager.completeProcess).toHaveBeenCalledWith('process-123');
            });
        });
    });

    describe('outbound activity logging', () => {
        it('should log SMS activity', async () => {
            const smsData = {
                direction: 'outbound',
                body: 'Hello world',
                createdAt: '2024-01-01T10:00:00Z',
                contactId: 'contact-123',
            };

            const logSMSToActivitySpy = jest.spyOn(integration, 'logSMSToActivity')
                .mockResolvedValue();

            await integration.logSMS({ data: smsData });

            expect(logSMSToActivitySpy).toHaveBeenCalledWith({
                type: 'sms',
                direction: 'outbound',
                content: 'Hello world',
                timestamp: '2024-01-01T10:00:00Z',
                contactExternalId: 'contact-123',
            });
        });

        it('should log call activity', async () => {
            const callData = {
                direction: 'inbound',
                duration: 120,
                aiSummary: 'Customer inquiry about product',
                createdAt: '2024-01-01T10:00:00Z',
                contactId: 'contact-123',
            };

            const logCallToActivitySpy = jest.spyOn(integration, 'logCallToActivity')
                .mockResolvedValue();

            await integration.logCall({ data: callData });

            expect(logCallToActivitySpy).toHaveBeenCalledWith({
                type: 'call',
                direction: 'inbound',
                duration: 120,
                summary: 'Customer inquiry about product',
                timestamp: '2024-01-01T10:00:00Z',
                contactExternalId: 'contact-123',
            });
        });

        it('should warn if SMS logging not supported', async () => {
            class NoSMSIntegration extends BaseCRMIntegration {
                static CRMConfig = { personObjectTypes: [] };
                logSMSToActivity = undefined; // Not implemented
            }

            const noSMSIntegration = new NoSMSIntegration();
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

            await noSMSIntegration.logSMS({ data: {} });

            expect(consoleSpy).toHaveBeenCalledWith('SMS logging not supported');
            consoleSpy.mockRestore();
        });
    });

    describe('helper methods', () => {
        it('should get queue URL from environment', () => {
            process.env.TESTCRM_QUEUE_URL = 'https://sqs.test.com/queue';

            const queueUrl = integration.getQueueUrl();
            expect(queueUrl).toBe('https://sqs.test.com/queue');
        });

        it('should handle bulk upsert to Quo', async () => {
            const contacts = [
                buildQuoContact({ externalId: 'person-1' }),
                buildQuoContact({ externalId: 'person-2' }),
            ];

            // Mock quo.api.upsertContact
            integration.quo = {
                api: {
                    upsertContact: jest.fn().mockResolvedValue(),
                },
            };

            const result = await integration.bulkUpsertToQuo(contacts);

            expect(integration.quo.api.upsertContact).toHaveBeenCalledTimes(2);
            expect(result).toEqual({
                successCount: 2,
                errorCount: 0,
                errors: [],
            });
        });

        it('should handle bulk upsert errors', async () => {
            const contacts = [
                buildQuoContact({ externalId: 'person-1' }),
                buildQuoContact({ externalId: 'person-2' }),
            ];

            integration.quo = {
                api: {
                    upsertContact: jest.fn()
                        .mockResolvedValueOnce() // First succeeds
                        .mockRejectedValueOnce(new Error('Quo API error')), // Second fails
                },
            };

            const result = await integration.bulkUpsertToQuo(contacts);

            expect(result).toEqual({
                successCount: 1,
                errorCount: 1,
                errors: [
                    {
                        contactId: 'person-2',
                        error: 'Quo API error',
                        timestamp: expect.any(String),
                    },
                ],
            });
        });
    });
});
