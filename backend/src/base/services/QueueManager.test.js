/**
 * QueueManager Service Tests
 *
 * Tests queue operations, batching, and fan-out patterns.
 */

const QueueManager = require('./QueueManager');

describe('QueueManager', () => {
    let queueManager;
    let mockQueuerUtil;

    beforeEach(() => {
        mockQueuerUtil = {
            batchSend: jest.fn(),
        };
        queueManager = new QueueManager({
            queuerUtil: mockQueuerUtil,
            queueUrl: 'https://sqs.test.com/queue',
        });
    });

    describe('constructor', () => {
        it('should require queuerUtil', () => {
            expect(() => new QueueManager({ queueUrl: 'test' })).toThrow(
                'queuerUtil is required',
            );
        });

        it('should require queueUrl', () => {
            expect(() => new QueueManager({ queuerUtil: {} })).toThrow(
                'queueUrl is required',
            );
        });

        it('should initialize with dependencies', () => {
            expect(queueManager.queuerUtil).toBe(mockQueuerUtil);
            expect(queueManager.queueUrl).toBe('https://sqs.test.com/queue');
        });
    });

    describe('queueFetchPersonPage', () => {
        it('should queue a fetch person page job', async () => {
            const params = {
                processId: 'process-123',
                personObjectType: 'Contact',
                page: 5,
                limit: 100,
                modifiedSince: new Date('2024-01-01T10:00:00Z'),
                sortDesc: true,
            };

            await queueManager.queueFetchPersonPage(params);

            expect(mockQueuerUtil.batchSend).toHaveBeenCalledWith(
                [
                    {
                        event: 'FETCH_PERSON_PAGE',
                        data: {
                            processId: 'process-123',
                            personObjectType: 'Contact',
                            page: 5,
                            cursor: null,
                            limit: 100,
                            modifiedSince: '2024-01-01T10:00:00.000Z',
                            sortDesc: true,
                        },
                    },
                ],
                'https://sqs.test.com/queue',
            );
        });

        it('should handle null modifiedSince', async () => {
            const params = {
                processId: 'process-123',
                personObjectType: 'Contact',
                page: 0,
                limit: 50,
                sortDesc: false,
            };

            await queueManager.queueFetchPersonPage(params);

            expect(mockQueuerUtil.batchSend).toHaveBeenCalledWith(
                [
                    {
                        event: 'FETCH_PERSON_PAGE',
                        data: {
                            processId: 'process-123',
                            personObjectType: 'Contact',
                            page: 0,
                            cursor: null,
                            limit: 50,
                            modifiedSince: null,
                            sortDesc: false,
                        },
                    },
                ],
                'https://sqs.test.com/queue',
            );
        });

        it('should use default values', async () => {
            const params = {
                processId: 'process-123',
                personObjectType: 'Contact',
                page: 2,
                limit: 75,
            };

            await queueManager.queueFetchPersonPage(params);

            expect(mockQueuerUtil.batchSend).toHaveBeenCalledWith(
                [
                    {
                        event: 'FETCH_PERSON_PAGE',
                        data: {
                            processId: 'process-123',
                            personObjectType: 'Contact',
                            page: 2,
                            cursor: null,
                            limit: 75,
                            modifiedSince: null,
                            sortDesc: true, // default value
                        },
                    },
                ],
                'https://sqs.test.com/queue',
            );
        });
    });

    describe('queueProcessPersonBatch', () => {
        it('should queue a process person batch job', async () => {
            const params = {
                processId: 'process-123',
                crmPersonIds: ['person-1', 'person-2', 'person-3'],
                page: 5,
                totalInPage: 3,
                isWebhook: false,
            };

            await queueManager.queueProcessPersonBatch(params);

            expect(mockQueuerUtil.batchSend).toHaveBeenCalledWith(
                [
                    {
                        event: 'PROCESS_PERSON_BATCH',
                        data: {
                            processId: 'process-123',
                            crmPersonIds: ['person-1', 'person-2', 'person-3'],
                            page: 5,
                            totalInPage: 3,
                            isWebhook: false,
                        },
                    },
                ],
                'https://sqs.test.com/queue',
            );
        });

        it('should handle webhook batches', async () => {
            const params = {
                processId: 'process-456',
                crmPersonIds: ['person-4'],
                isWebhook: true,
            };

            await queueManager.queueProcessPersonBatch(params);

            expect(mockQueuerUtil.batchSend).toHaveBeenCalledWith(
                [
                    {
                        event: 'PROCESS_PERSON_BATCH',
                        data: {
                            processId: 'process-456',
                            crmPersonIds: ['person-4'],
                            page: null,
                            totalInPage: null,
                            isWebhook: true,
                        },
                    },
                ],
                'https://sqs.test.com/queue',
            );
        });

        it('should use default values', async () => {
            const params = {
                processId: 'process-123',
                crmPersonIds: ['person-1', 'person-2'],
            };

            await queueManager.queueProcessPersonBatch(params);

            expect(mockQueuerUtil.batchSend).toHaveBeenCalledWith(
                [
                    {
                        event: 'PROCESS_PERSON_BATCH',
                        data: {
                            processId: 'process-123',
                            crmPersonIds: ['person-1', 'person-2'],
                            page: null,
                            totalInPage: null,
                            isWebhook: false,
                        },
                    },
                ],
                'https://sqs.test.com/queue',
            );
        });
    });

    describe('queueCompleteSync', () => {
        it('should queue a complete sync job', async () => {
            const processId = 'process-123';

            await queueManager.queueCompleteSync(processId);

            expect(mockQueuerUtil.batchSend).toHaveBeenCalledWith(
                [
                    {
                        event: 'COMPLETE_SYNC',
                        data: {
                            processId: 'process-123',
                        },
                    },
                ],
                'https://sqs.test.com/queue',
            );
        });
    });

    describe('fanOutPages', () => {
        it('should queue all pages for fan-out processing', async () => {
            const params = {
                processId: 'process-123',
                personObjectType: 'Contact',
                totalPages: 15,
                startPage: 1,
                limit: 100,
                modifiedSince: new Date('2024-01-01T10:00:00Z'),
                sortDesc: true,
            };

            await queueManager.fanOutPages(params);

            // Should queue pages 1-14 (15 total pages, starting from page 1)
            expect(mockQueuerUtil.batchSend).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({
                        event: 'FETCH_PERSON_PAGE',
                        data: expect.objectContaining({
                            processId: 'process-123',
                            personObjectType: 'Contact',
                            page: 1,
                            limit: 100,
                        }),
                    }),
                    expect.objectContaining({
                        event: 'FETCH_PERSON_PAGE',
                        data: expect.objectContaining({
                            processId: 'process-123',
                            personObjectType: 'Contact',
                            page: 14,
                            limit: 100,
                        }),
                    }),
                ]),
                'https://sqs.test.com/queue',
            );

            // Should have 14 messages (pages 1-14)
            const messages = mockQueuerUtil.batchSend.mock.calls[0][0];
            expect(messages).toHaveLength(14);
        });

        it('should not queue any messages if no pages to fan out', async () => {
            const params = {
                processId: 'process-123',
                personObjectType: 'Contact',
                totalPages: 1, // Only page 0 exists
                startPage: 1, // Start from page 1
                limit: 100,
            };

            await queueManager.fanOutPages(params);

            expect(mockQueuerUtil.batchSend).not.toHaveBeenCalled();
        });

        it('should handle default values', async () => {
            const params = {
                processId: 'process-123',
                personObjectType: 'Contact',
                totalPages: 5,
                limit: 50,
            };

            await queueManager.fanOutPages(params);

            const messages = mockQueuerUtil.batchSend.mock.calls[0][0];
            expect(messages).toHaveLength(4); // Pages 1, 2, 3, 4

            // Check first message has defaults
            expect(messages[0].data.modifiedSince).toBeNull();
            expect(messages[0].data.sortDesc).toBe(true);
        });

        it('should handle zero total pages', async () => {
            const params = {
                processId: 'process-123',
                personObjectType: 'Contact',
                totalPages: 0,
                startPage: 1,
                limit: 100,
            };

            await queueManager.fanOutPages(params);

            expect(mockQueuerUtil.batchSend).not.toHaveBeenCalled();
        });
    });

    describe('queueMultipleBatches', () => {
        it('should queue multiple batches at once', async () => {
            const batches = [
                {
                    processId: 'process-123',
                    crmPersonIds: ['person-1', 'person-2'],
                    page: 1,
                },
                {
                    processId: 'process-123',
                    crmPersonIds: ['person-3', 'person-4'],
                    page: 2,
                    isWebhook: false,
                },
                {
                    processId: 'process-456',
                    crmPersonIds: ['person-5'],
                    isWebhook: true,
                },
            ];

            await queueManager.queueMultipleBatches(batches);

            expect(mockQueuerUtil.batchSend).toHaveBeenCalledWith(
                [
                    {
                        event: 'PROCESS_PERSON_BATCH',
                        data: {
                            processId: 'process-123',
                            crmPersonIds: ['person-1', 'person-2'],
                            page: 1,
                            totalInPage: 2,
                            isWebhook: false,
                        },
                    },
                    {
                        event: 'PROCESS_PERSON_BATCH',
                        data: {
                            processId: 'process-123',
                            crmPersonIds: ['person-3', 'person-4'],
                            page: 2,
                            totalInPage: 2,
                            isWebhook: false,
                        },
                    },
                    {
                        event: 'PROCESS_PERSON_BATCH',
                        data: {
                            processId: 'process-456',
                            crmPersonIds: ['person-5'],
                            page: null,
                            totalInPage: 1,
                            isWebhook: true,
                        },
                    },
                ],
                'https://sqs.test.com/queue',
            );
        });

        it('should handle empty batches array', async () => {
            await queueManager.queueMultipleBatches([]);

            expect(mockQueuerUtil.batchSend).not.toHaveBeenCalled();
        });

        it('should use default values for missing properties', async () => {
            const batches = [
                {
                    processId: 'process-123',
                    crmPersonIds: ['person-1'],
                },
            ];

            await queueManager.queueMultipleBatches(batches);

            expect(mockQueuerUtil.batchSend).toHaveBeenCalledWith(
                [
                    {
                        event: 'PROCESS_PERSON_BATCH',
                        data: {
                            processId: 'process-123',
                            crmPersonIds: ['person-1'],
                            page: null,
                            totalInPage: 1,
                            isWebhook: false,
                        },
                    },
                ],
                'https://sqs.test.com/queue',
            );
        });
    });

    describe('getQueueUrl', () => {
        it('should return the queue URL', () => {
            const queueUrl = queueManager.getQueueUrl();
            expect(queueUrl).toBe('https://sqs.test.com/queue');
        });
    });

    describe('queueMessage', () => {
        it('should queue a generic message with custom event type', async () => {
            const params = {
                action: 'POST_CREATE_SETUP',
                integrationId: 'integration-123',
            };

            await queueManager.queueMessage(params);

            expect(mockQueuerUtil.batchSend).toHaveBeenCalledWith(
                [
                    {
                        event: 'POST_CREATE_SETUP',
                        data: {
                            integrationId: 'integration-123',
                        },
                    },
                ],
                'https://sqs.test.com/queue',
            );
        });

        it('should handle messages with delay', async () => {
            const params = {
                action: 'POST_CREATE_SETUP',
                integrationId: 'integration-456',
                delaySeconds: 35,
            };

            await queueManager.queueMessage(params);

            expect(mockQueuerUtil.batchSend).toHaveBeenCalledWith(
                [
                    {
                        event: 'POST_CREATE_SETUP',
                        data: {
                            integrationId: 'integration-456',
                        },
                        delaySeconds: 35,
                    },
                ],
                'https://sqs.test.com/queue',
            );
        });

        it('should queue message with only action field', async () => {
            const params = {
                action: 'CUSTOM_EVENT',
            };

            await queueManager.queueMessage(params);

            expect(mockQueuerUtil.batchSend).toHaveBeenCalledWith(
                [
                    {
                        event: 'CUSTOM_EVENT',
                        data: {},
                    },
                ],
                'https://sqs.test.com/queue',
            );
        });

        it('should queue message with multiple data fields', async () => {
            const params = {
                action: 'COMPLEX_EVENT',
                integrationId: 'integration-789',
                userId: 'user-123',
                metadata: { foo: 'bar' },
            };

            await queueManager.queueMessage(params);

            expect(mockQueuerUtil.batchSend).toHaveBeenCalledWith(
                [
                    {
                        event: 'COMPLEX_EVENT',
                        data: {
                            integrationId: 'integration-789',
                            userId: 'user-123',
                            metadata: { foo: 'bar' },
                        },
                    },
                ],
                'https://sqs.test.com/queue',
            );
        });

        it('should not include delaySeconds in data payload', async () => {
            const params = {
                action: 'DELAYED_EVENT',
                processId: 'process-999',
                delaySeconds: 60,
            };

            await queueManager.queueMessage(params);

            const call = mockQueuerUtil.batchSend.mock.calls[0][0][0];
            expect(call.data).toEqual({ processId: 'process-999' });
            expect(call.data.delaySeconds).toBeUndefined();
            expect(call.delaySeconds).toBe(60);
        });

        it('should throw error if action is missing', async () => {
            await expect(
                queueManager.queueMessage({
                    integrationId: 'integration-123',
                }),
            ).rejects.toThrow('action is required for queueMessage');
        });

        it('should handle zero delay', async () => {
            const params = {
                action: 'IMMEDIATE_EVENT',
                data: 'test',
                delaySeconds: 0,
            };

            await queueManager.queueMessage(params);

            expect(mockQueuerUtil.batchSend).toHaveBeenCalledWith(
                [
                    {
                        event: 'IMMEDIATE_EVENT',
                        data: {
                            data: 'test',
                        },
                        delaySeconds: 0,
                    },
                ],
                'https://sqs.test.com/queue',
            );
        });
    });

    describe('error handling', () => {
        it('should propagate QueuerUtil errors', async () => {
            const queuerError = new Error('SQS send failed');
            mockQueuerUtil.batchSend.mockRejectedValue(queuerError);

            await expect(
                queueManager.queueFetchPersonPage({
                    processId: 'process-123',
                    personObjectType: 'Contact',
                    page: 0,
                    limit: 100,
                }),
            ).rejects.toThrow('SQS send failed');
        });

        it('should propagate QueuerUtil errors from queueMessage', async () => {
            const queuerError = new Error('SQS send failed');
            mockQueuerUtil.batchSend.mockRejectedValue(queuerError);

            await expect(
                queueManager.queueMessage({
                    action: 'TEST_EVENT',
                    data: 'test',
                }),
            ).rejects.toThrow('SQS send failed');
        });
    });
});
