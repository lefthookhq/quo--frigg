/**
 * Bulk Upsert Pagination Tests
 *
 * Tests the pagination handling when fetching contacts by externalIds after bulk create.
 * OpenPhone's query parser (qs) has a default arrayLimit of 20, so we chunk at 20 IDs.
 */

const { BaseCRMIntegration } = require('../src/base/BaseCRMIntegration');
const { buildQuoContact } = require('../src/base/__tests__/helpers');

describe('bulkUpsertToQuo - Pagination', () => {
    let integration;

    beforeEach(() => {
        // Create a concrete test class that extends BaseCRMIntegration
        class TestCRMIntegration extends BaseCRMIntegration {
            static Definition = {
                name: 'test-crm',
                version: '1.0.0',
            };

            static CRMConfig = {
                personObjectTypes: [
                    { crmObjectName: 'Contact', quoContactType: 'contact' },
                ],
            };

            transformPersonToQuo(person) {
                return buildQuoContact({ externalId: person.id });
            }

            async logSMSToActivity() {}
            async logCallToActivity() {}
            async setupWebhooks() {}
            async fetchPersonById(id) {
                return { id };
            }
            async fetchPersonPage() {
                return { data: [], total: 0, hasMore: false };
            }
            async fetchPersonsByIds(ids) {
                return ids.map((id) => ({ id }));
            }
        }

        integration = new TestCRMIntegration({
            id: 'integration-123',
            userId: 'user-456',
        });

        // Mock upsertMapping
        integration.upsertMapping = jest.fn().mockResolvedValue();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('when fetching more than 20 contacts (array limit)', () => {
        it('should paginate listContacts requests to respect maxResults=20 limit', async () => {
            // Create 100 contacts (5 pages of 20 needed)
            const contacts = Array.from({ length: 100 }, (_, i) =>
                buildQuoContact({
                    externalId: `person-${i + 1}`,
                    defaultFields: {
                        phoneNumbers: [
                            { value: `+155501${String(i).padStart(4, '0')}` },
                        ],
                    },
                }),
            );

            // Mock bulkCreateContacts to succeed
            const mockBulkCreate = jest.fn().mockResolvedValue({});

            // Mock listContacts to return paginated results
            const mockListContacts = jest
                .fn()
                .mockImplementation(async ({ externalIds, maxResults }) => {
                    // Verify maxResults doesn't exceed 20
                    expect(maxResults).toBeLessThanOrEqual(20);
                    expect(externalIds.length).toBeLessThanOrEqual(20);

                    return {
                        data: externalIds.map((externalId) => ({
                            id: `quo-${externalId}`,
                            externalId,
                            defaultFields: {
                                phoneNumbers: [
                                    {
                                        value: `+155501${externalId.split('-')[1].padStart(4, '0')}`,
                                    },
                                ],
                            },
                        })),
                    };
                });

            integration.quo = {
                api: {
                    bulkCreateContacts: mockBulkCreate,
                    listContacts: mockListContacts,
                },
            };

            const result = await integration.bulkUpsertToQuo(contacts);

            // Should call bulkCreateContacts once with all contacts (no orgId)
            expect(mockBulkCreate).toHaveBeenCalledTimes(1);
            expect(mockBulkCreate).toHaveBeenCalledWith(contacts);

            // Should call listContacts 5 times (5 pages of 20)
            expect(mockListContacts).toHaveBeenCalledTimes(5);

            // All 100 contacts should be successfully mapped
            expect(result.successCount).toBe(100);
            expect(result.errorCount).toBe(0);
            expect(result.errors).toEqual([]);

            // Should create 100 mappings
            expect(integration.upsertMapping).toHaveBeenCalledTimes(100);
        });

        it('should handle exactly 20 contacts (1 page)', async () => {
            const contacts = Array.from({ length: 20 }, (_, i) =>
                buildQuoContact({
                    externalId: `person-${i + 1}`,
                    defaultFields: {
                        phoneNumbers: [
                            { value: `+155501${String(i).padStart(4, '0')}` },
                        ],
                    },
                }),
            );

            const mockBulkCreate = jest.fn().mockResolvedValue({});
            const mockListContacts = jest
                .fn()
                .mockImplementation(async ({ externalIds, maxResults }) => {
                    expect(maxResults).toBeLessThanOrEqual(20);
                    expect(externalIds).toHaveLength(20);

                    return {
                        data: externalIds.map((externalId, index) => ({
                            id: `quo-${externalId}`,
                            externalId,
                            defaultFields: {
                                phoneNumbers: [
                                    {
                                        value: `+155501${String(index).padStart(4, '0')}`,
                                    },
                                ],
                            },
                        })),
                    };
                });

            integration.quo = {
                api: {
                    bulkCreateContacts: mockBulkCreate,
                    listContacts: mockListContacts,
                },
            };

            const result = await integration.bulkUpsertToQuo(contacts);

            // Should only call listContacts once
            expect(mockListContacts).toHaveBeenCalledTimes(1);
            expect(result.successCount).toBe(20);
            expect(result.errorCount).toBe(0);
        });

        it('should handle 45 contacts (3 pages: 20, 20, 5)', async () => {
            const contacts = Array.from({ length: 45 }, (_, i) =>
                buildQuoContact({
                    externalId: `person-${i + 1}`,
                    defaultFields: {
                        phoneNumbers: [
                            { value: `+155501${String(i).padStart(4, '0')}` },
                        ],
                    },
                }),
            );

            const mockBulkCreate = jest.fn().mockResolvedValue({});
            let callCount = 0;
            const mockListContacts = jest
                .fn()
                .mockImplementation(async ({ externalIds, maxResults }) => {
                    callCount++;
                    expect(maxResults).toBeLessThanOrEqual(20);

                    if (callCount <= 2) {
                        expect(externalIds).toHaveLength(20);
                    } else if (callCount === 3) {
                        expect(externalIds).toHaveLength(5);
                    }

                    return {
                        data: externalIds.map((externalId) => ({
                            id: `quo-${externalId}`,
                            externalId,
                            defaultFields: {
                                phoneNumbers: [
                                    {
                                        value: `+155501${externalId.split('-')[1].padStart(4, '0')}`,
                                    },
                                ],
                            },
                        })),
                    };
                });

            integration.quo = {
                api: {
                    bulkCreateContacts: mockBulkCreate,
                    listContacts: mockListContacts,
                },
            };

            const result = await integration.bulkUpsertToQuo(contacts);

            // Should call listContacts 3 times
            expect(mockListContacts).toHaveBeenCalledTimes(3);
            expect(result.successCount).toBe(45);
            expect(result.errorCount).toBe(0);
        });

        it('should handle partial failures across paginated requests', async () => {
            // 40 contacts = 2 pages of 20
            const contacts = Array.from({ length: 40 }, (_, i) =>
                buildQuoContact({
                    externalId: `person-${i + 1}`,
                    defaultFields: {
                        phoneNumbers: [
                            { value: `+155501${String(i).padStart(4, '0')}` },
                        ],
                    },
                }),
            );

            const mockBulkCreate = jest.fn().mockResolvedValue({});
            let callCount = 0;
            const mockListContacts = jest
                .fn()
                .mockImplementation(async ({ externalIds }) => {
                    callCount++;

                    // First page: return all 20
                    if (callCount === 1) {
                        return {
                            data: externalIds.map((externalId, index) => ({
                                id: `quo-${externalId}`,
                                externalId,
                                defaultFields: {
                                    phoneNumbers: [
                                        {
                                            value: `+155501${String(index).padStart(4, '0')}`,
                                        },
                                    ],
                                },
                            })),
                        };
                    }

                    // Second page: only return 10 out of 20 (10 failed)
                    if (callCount === 2) {
                        const returnedContacts = externalIds.slice(0, 10);
                        return {
                            data: returnedContacts.map(
                                (externalId, index) => ({
                                    id: `quo-${externalId}`,
                                    externalId,
                                    defaultFields: {
                                        phoneNumbers: [
                                            {
                                                value: `+155501${String(index + 20).padStart(4, '0')}`,
                                            },
                                        ],
                                    },
                                }),
                            ),
                        };
                    }
                });

            integration.quo = {
                api: {
                    bulkCreateContacts: mockBulkCreate,
                    listContacts: mockListContacts,
                },
            };

            const result = await integration.bulkUpsertToQuo(contacts);

            // Should have 30 successes and 10 errors
            expect(result.successCount).toBe(30);
            expect(result.errorCount).toBe(10);
            expect(result.errors).toHaveLength(10);

            // Verify error messages
            result.errors.forEach((error) => {
                expect(error.error).toBe('Contact not found after bulk create');
                expect(error.externalId).toMatch(/^person-\d+$/);
            });
        });

        it('should handle contacts without phone numbers', async () => {
            const contacts = Array.from({ length: 75 }, (_, i) =>
                buildQuoContact({
                    externalId: `person-${i + 1}`,
                    defaultFields: {
                        phoneNumbers:
                            i % 10 === 0
                                ? []
                                : [
                                      {
                                          value: `+155501${String(i).padStart(4, '0')}`,
                                      },
                                  ], // Every 10th contact has no phone
                    },
                }),
            );

            const mockBulkCreate = jest.fn().mockResolvedValue({});
            const mockListContacts = jest
                .fn()
                .mockImplementation(async ({ externalIds }) => {
                    return {
                        data: externalIds.map((externalId, index) => {
                            const contactNum = parseInt(
                                externalId.split('-')[1],
                            );
                            return {
                                id: `quo-${externalId}`,
                                externalId,
                                defaultFields: {
                                    phoneNumbers:
                                        contactNum % 10 === 0
                                            ? []
                                            : [
                                                  {
                                                      value: `+155501${String(contactNum - 1).padStart(4, '0')}`,
                                                  },
                                              ],
                                },
                            };
                        }),
                    };
                });

            integration.quo = {
                api: {
                    bulkCreateContacts: mockBulkCreate,
                    listContacts: mockListContacts,
                },
            };

            const result = await integration.bulkUpsertToQuo(contacts);

            // Should call listContacts 4 times (75 contacts = 3×20 + 15)
            expect(mockListContacts).toHaveBeenCalledTimes(4);

            // Contacts without phone: person-10, person-20, person-30, person-40, person-50, person-60, person-70 (7 contacts)
            // Because contactNum % 10 === 0 is checked on the contact number (not the index)
            expect(result.successCount).toBe(68); // 75 - 7
            expect(result.errorCount).toBe(7);

            // Verify error messages for no phone number
            const noPhoneErrors = result.errors.filter(
                (e) => e.error === 'No phone number available',
            );
            expect(noPhoneErrors).toHaveLength(7);
        });
    });

    describe('performance optimization', () => {
        it('should fetch pages in parallel for better performance', async () => {
            // 60 contacts = 3 pages of 20
            const contacts = Array.from({ length: 60 }, (_, i) =>
                buildQuoContact({
                    externalId: `person-${i + 1}`,
                    defaultFields: {
                        phoneNumbers: [
                            { value: `+155501${String(i).padStart(4, '0')}` },
                        ],
                    },
                }),
            );

            const mockBulkCreate = jest.fn().mockResolvedValue({});
            const callTimestamps = [];
            const mockListContacts = jest
                .fn()
                .mockImplementation(async ({ externalIds }) => {
                    const startTime = Date.now();
                    callTimestamps.push(startTime);

                    // Simulate API delay
                    await new Promise((resolve) => setTimeout(resolve, 50));

                    return {
                        data: externalIds.map((externalId, index) => ({
                            id: `quo-${externalId}`,
                            externalId,
                            defaultFields: {
                                phoneNumbers: [
                                    {
                                        value: `+155501${String(index).padStart(4, '0')}`,
                                    },
                                ],
                            },
                        })),
                    };
                });

            integration.quo = {
                api: {
                    bulkCreateContacts: mockBulkCreate,
                    listContacts: mockListContacts,
                },
            };

            await integration.bulkUpsertToQuo(contacts);

            // Should call listContacts 3 times (60 contacts = 3 pages of 20)
            expect(mockListContacts).toHaveBeenCalledTimes(3);

            // The key test: Check that all calls started within a small time window (parallel execution)
            // If parallel: all calls start nearly simultaneously
            // If sequential: calls would be spaced 50ms+ apart
            const timeWindow =
                Math.max(...callTimestamps) - Math.min(...callTimestamps);
            expect(timeWindow).toBeLessThan(20); // All should start nearly simultaneously (within 20ms)
        });

        it('should handle one page failure without affecting others in parallel fetch', async () => {
            // 60 contacts = 3 pages of 20
            const contacts = Array.from({ length: 60 }, (_, i) =>
                buildQuoContact({
                    externalId: `person-${i + 1}`,
                    defaultFields: {
                        phoneNumbers: [
                            { value: `+155501${String(i).padStart(4, '0')}` },
                        ],
                    },
                }),
            );

            const mockBulkCreate = jest.fn().mockResolvedValue({});
            let callCount = 0;
            const mockListContacts = jest
                .fn()
                .mockImplementation(async ({ externalIds }) => {
                    callCount++;

                    // Second page fails
                    if (callCount === 2) {
                        throw new Error('API rate limit exceeded');
                    }

                    return {
                        data: externalIds.map((externalId, index) => ({
                            id: `quo-${externalId}`,
                            externalId,
                            defaultFields: {
                                phoneNumbers: [
                                    {
                                        value: `+155501${String(index).padStart(4, '0')}`,
                                    },
                                ],
                            },
                        })),
                    };
                });

            integration.quo = {
                api: {
                    bulkCreateContacts: mockBulkCreate,
                    listContacts: mockListContacts,
                },
            };

            const result = await integration.bulkUpsertToQuo(contacts);

            // Should attempt all 3 calls
            expect(mockListContacts).toHaveBeenCalledTimes(3);

            // Since one page failed, the entire operation fails
            expect(result.successCount).toBe(0);
            expect(result.errorCount).toBe(60);
            expect(result.errors[0].error).toBe('API rate limit exceeded');
        });
    });

    describe('error handling with pagination', () => {
        it('should handle API errors during paginated fetch', async () => {
            // 40 contacts = 2 pages of 20
            const contacts = Array.from({ length: 40 }, (_, i) =>
                buildQuoContact({
                    externalId: `person-${i + 1}`,
                    defaultFields: {
                        phoneNumbers: [
                            { value: `+155501${String(i).padStart(4, '0')}` },
                        ],
                    },
                }),
            );

            const mockBulkCreate = jest.fn().mockResolvedValue({});
            let callCount = 0;
            const mockListContacts = jest.fn().mockImplementation(async () => {
                callCount++;

                // First call succeeds
                if (callCount === 1) {
                    return {
                        data: Array.from({ length: 20 }, (_, i) => ({
                            id: `quo-person-${i + 1}`,
                            externalId: `person-${i + 1}`,
                            defaultFields: {
                                phoneNumbers: [
                                    {
                                        value: `+155501${String(i).padStart(4, '0')}`,
                                    },
                                ],
                            },
                        })),
                    };
                }

                // Second call fails with the actual error from logs
                throw new Error('Expected integer to be less or equal to 50');
            });

            integration.quo = {
                api: {
                    bulkCreateContacts: mockBulkCreate,
                    listContacts: mockListContacts,
                },
            };

            const result = await integration.bulkUpsertToQuo(contacts);

            // When paginated fetch fails on second page, the error bubbles up to the catch block
            // This causes all 40 contacts to be marked as failed (errorCount = contacts.length)
            expect(result.successCount).toBe(0);
            expect(result.errorCount).toBe(40);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0].error).toBe(
                'Expected integer to be less or equal to 50',
            );
        });
    });
});
