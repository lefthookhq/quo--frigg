/**
 * Bulk Sync Mapping Tests
 *
 * Tests for Phase 1 & 2 bug fixes:
 * - Phase 1: Bulk sync should create mappings after successful contact creation
 * - Phase 2: Webhook sync should handle 409 conflicts by creating mappings
 *
 * References: https://github.com/lefthookhq/quo--frigg/issues/18
 */

const { BaseCRMIntegration } = require('./BaseCRMIntegration');
const {
    createMockProcessManager,
    createMockQueueManager,
    createMockSyncOrchestrator,
    buildQuoContact,
} = require('./__tests__/helpers');

describe('Bulk Sync Mapping Creation (Issue #18)', () => {
    let integration;
    let mockProcessManager;
    let mockQueueManager;
    let mockSyncOrchestrator;

    beforeEach(() => {
        class TestCRMIntegration extends BaseCRMIntegration {
            static Definition = {
                name: 'test-crm',
                version: '1.0.0',
            };

            static CRMConfig = {
                personObjectTypes: [
                    { crmObjectName: 'Contact', quoContactType: 'contact' },
                ],
                syncConfig: {
                    paginationType: 'CURSOR_BASED',
                    supportsTotal: false,
                    returnFullRecords: true,
                    reverseChronological: true,
                    initialBatchSize: 50,
                },
            };

            async fetchPersonPage(params) {
                return {
                    data: [],
                    cursor: null,
                    hasMore: false,
                };
            }

            transformPersonToQuo(person) {
                return buildQuoContact({
                    externalId: person.id,
                });
            }

            async logSMSToActivity(activity) {}
            async logCallToActivity(activity) {}
            async setupWebhooks() {}
            async fetchPersonById(id) {
                return { id };
            }
        }

        integration = new TestCRMIntegration({
            id: 'integration-123',
            userId: 'user-456',
        });

        mockProcessManager = createMockProcessManager();
        mockQueueManager = createMockQueueManager();
        mockSyncOrchestrator = createMockSyncOrchestrator();

        integration._processManager = mockProcessManager;
        integration._queueManager = mockQueueManager;
        integration._syncOrchestrator = mockSyncOrchestrator;
    });

    describe('Phase 1: bulkUpsertToQuo mapping creation', () => {
        it('should create mappings after successful bulk contact creation', async () => {
            const contacts = [
                buildQuoContact({ externalId: 'attio-person-1' }),
                buildQuoContact({ externalId: 'attio-person-2' }),
            ];

            integration.quo = {
                api: {
                    bulkCreateContacts: jest.fn().mockResolvedValue({ status: 202 }),
                    listContacts: jest.fn().mockResolvedValue({
                        data: [
                            {
                                id: 'quo-contact-1',
                                externalId: 'attio-person-1',
                                source: 'test-crm',
                                createdAt: new Date().toISOString(),
                            },
                            {
                                id: 'quo-contact-2',
                                externalId: 'attio-person-2',
                                source: 'test-crm',
                                createdAt: new Date().toISOString(),
                            },
                        ],
                        totalItems: 2,
                    }),
                },
            };

            integration.upsertMapping = jest.fn().mockResolvedValue();

            const result = await integration.bulkUpsertToQuo(contacts);

            expect(integration.quo.api.bulkCreateContacts).toHaveBeenCalledWith(contacts);

            expect(integration.quo.api.listContacts).toHaveBeenCalledWith({
                externalIds: ['attio-person-1', 'attio-person-2'],
                maxResults: 2,
            });

            expect(integration.upsertMapping).toHaveBeenCalledTimes(2);
            expect(integration.upsertMapping).toHaveBeenCalledWith('attio-person-1', {
                externalId: 'attio-person-1',
                quoContactId: 'quo-contact-1',
                entityType: 'people',
                lastSyncedAt: expect.any(String),
                syncMethod: 'bulk',
                action: 'created',
            });
            expect(integration.upsertMapping).toHaveBeenCalledWith('attio-person-2', {
                externalId: 'attio-person-2',
                quoContactId: 'quo-contact-2',
                entityType: 'people',
                lastSyncedAt: expect.any(String),
                syncMethod: 'bulk',
                action: 'created',
            });

            expect(result).toEqual({
                successCount: 2,
                errorCount: 0,
                errors: [],
            });
        });

        it('should handle partial failures when fetching created contacts', async () => {
            const contacts = [
                buildQuoContact({ externalId: 'attio-person-1' }),
                buildQuoContact({ externalId: 'attio-person-2' }),
                buildQuoContact({ externalId: 'attio-person-3' }),
            ];

            integration.quo = {
                api: {
                    bulkCreateContacts: jest.fn().mockResolvedValue({ status: 202 }),
                    listContacts: jest.fn().mockResolvedValue({
                        data: [
                            {
                                id: 'quo-contact-1',
                                externalId: 'attio-person-1',
                                source: 'test-crm',
                            },
                        ],
                        totalItems: 1,
                    }),
                },
            };

            integration.upsertMapping = jest.fn().mockResolvedValue();

            const result = await integration.bulkUpsertToQuo(contacts);

            expect(integration.upsertMapping).toHaveBeenCalledTimes(1);

            expect(result.successCount).toBe(1);
            expect(result.errorCount).toBe(2);
            expect(result.errors).toHaveLength(2);
            expect(result.errors[0]).toMatchObject({
                error: 'Contact not found after bulk create',
                externalId: 'attio-person-2',
            });
            expect(result.errors[1]).toMatchObject({
                error: 'Contact not found after bulk create',
                externalId: 'attio-person-3',
            });
        });

        it('should handle mapping creation failures gracefully', async () => {
            const contacts = [
                buildQuoContact({ externalId: 'attio-person-1' }),
                buildQuoContact({ externalId: 'attio-person-2' }),
            ];

            integration.quo = {
                api: {
                    bulkCreateContacts: jest.fn().mockResolvedValue({ status: 202 }),
                    listContacts: jest.fn().mockResolvedValue({
                        data: [
                            { id: 'quo-contact-1', externalId: 'attio-person-1' },
                            { id: 'quo-contact-2', externalId: 'attio-person-2' },
                        ],
                        totalItems: 2,
                    }),
                },
            };

            integration.upsertMapping = jest.fn()
                .mockResolvedValueOnce()
                .mockRejectedValueOnce(new Error('Database connection failed'));

            const result = await integration.bulkUpsertToQuo(contacts);

            expect(result.successCount).toBe(1);
            expect(result.errorCount).toBe(1);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toMatchObject({
                error: 'Database connection failed',
                externalId: 'attio-person-2',
            });
        });

        it('should handle bulk create API failures', async () => {
            const contacts = [
                buildQuoContact({ externalId: 'attio-person-1' }),
            ];

            integration.quo = {
                api: {
                    bulkCreateContacts: jest.fn().mockRejectedValue(
                        new Error('Quo API unavailable')
                    ),
                },
            };

            integration.upsertMapping = jest.fn();

            const result = await integration.bulkUpsertToQuo(contacts);

            expect(integration.upsertMapping).not.toHaveBeenCalled();
            expect(result.successCount).toBe(0);
            expect(result.errorCount).toBe(1);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toMatchObject({
                error: 'Quo API unavailable',
                contactCount: 1,
            });
        });

        it('should wait briefly after bulk create for async processing', async () => {
            const contacts = [buildQuoContact({ externalId: 'attio-person-1' })];

            const bulkCreateTimestamp = Date.now();
            let listContactsTimestamp;

            integration.quo = {
                api: {
                    bulkCreateContacts: jest.fn().mockResolvedValue({ status: 202 }),
                    listContacts: jest.fn().mockImplementation(() => {
                        listContactsTimestamp = Date.now();
                        return Promise.resolve({
                            data: [{ id: 'quo-contact-1', externalId: 'attio-person-1' }],
                            totalItems: 1,
                        });
                    }),
                },
            };

            integration.upsertMapping = jest.fn().mockResolvedValue();

            await integration.bulkUpsertToQuo(contacts);

            const delayMs = listContactsTimestamp - bulkCreateTimestamp;

            expect(delayMs).toBeGreaterThanOrEqual(900);
        });
    });
});
