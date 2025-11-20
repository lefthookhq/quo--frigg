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

const ScalingTestIntegration = require('./ScalingTestIntegration');

describe('ScalingTestIntegration (Refactored)', () => {
    let integration;

    beforeEach(() => {
        integration = new ScalingTestIntegration();
        integration.id = 'test-integration-id';
        integration.userId = 'test-user-id';
    });

    describe('Static Configuration', () => {
        it('should have correct Definition', () => {
            expect(ScalingTestIntegration.Definition.name).toBe('scalingtest');
            expect(ScalingTestIntegration.Definition.display.label).toBe(
                'Scaling Test Integration',
            );
        });

        it('should have quo module with correct name and label overrides', () => {
            expect(ScalingTestIntegration.Definition.modules.quo).toBeDefined();
            expect(
                ScalingTestIntegration.Definition.modules.quo.definition,
            ).toBeDefined();

            // Test name override
            expect(
                ScalingTestIntegration.Definition.modules.quo.definition.getName(),
            ).toBe('quo-scalingtest');
            expect(
                ScalingTestIntegration.Definition.modules.quo.definition
                    .moduleName,
            ).toBe('quo-scalingtest');

            // Test label override (if display property exists)
            if (
                ScalingTestIntegration.Definition.modules.quo.definition.display
            ) {
                expect(
                    ScalingTestIntegration.Definition.modules.quo.definition
                        .display.label,
                ).toBe('Quo (Scaling Test)');
            }
        });

        it('should have high-scale CRMConfig', () => {
            expect(
                ScalingTestIntegration.CRMConfig.syncConfig.initialBatchSize,
            ).toBe(500);
            expect(
                ScalingTestIntegration.CRMConfig.queueConfig.maxWorkers,
            ).toBe(100);
        });
    });

    describe('Required Methods', () => {
        describe('fetchPersonPage', () => {
            it('should generate synthetic contacts', async () => {
                const result = await integration.fetchPersonPage({
                    objectType: 'Contact',
                    page: 0,
                    limit: 10,
                });

                expect(result.data).toHaveLength(10);
                expect(result.total).toBe(10000);
                expect(result.hasMore).toBe(true);
                expect(result.data[0].first_name).toBe('Test0');
            });

            it('should handle pagination correctly', async () => {
                const result = await integration.fetchPersonPage({
                    objectType: 'Contact',
                    page: 999,
                    limit: 10,
                });

                expect(result.data).toHaveLength(10);
                expect(result.hasMore).toBe(false);
                expect(result.data[0].id).toBe(9991);
            });
        });

        describe('transformPersonToQuo', () => {
            it('should transform synthetic contact correctly', async () => {
                const contact = integration.generateSyntheticContact(0);
                const result = await integration.transformPersonToQuo(contact);

                expect(result.externalId).toBe('1');
                expect(result.source).toBe('scalingtest');
                expect(result.defaultFields.firstName).toBe('Test0');
                expect(result.defaultFields.lastName).toBe('Contact0');
            });
        });

        describe('logSMSToActivity', () => {
            it('should simulate SMS logging', async () => {
                const consoleSpy = jest
                    .spyOn(console, 'log')
                    .mockImplementation();

                await integration.logSMSToActivity({
                    contactExternalId: '123',
                    direction: 'outbound',
                    content: 'Test',
                });

                expect(consoleSpy).toHaveBeenCalled();
                consoleSpy.mockRestore();
            });
        });

        describe('setupWebhooks', () => {
            it('should simulate webhook setup', async () => {
                const consoleSpy = jest
                    .spyOn(console, 'log')
                    .mockImplementation();

                await integration.setupWebhooks();

                expect(consoleSpy).toHaveBeenCalledWith(
                    'ScalingTest: Webhooks configured (simulated)',
                );
                consoleSpy.mockRestore();
            });
        });
    });

    describe('Helper Methods', () => {
        it('should generate consistent synthetic data', () => {
            const contact1 = integration.generateSyntheticContact(5);
            const contact2 = integration.generateSyntheticContact(5);

            expect(contact1.id).toBe(contact2.id);
            expect(contact1.first_name).toBe(contact2.first_name);
        });

        it('should fetch person by ID', async () => {
            const person = await integration.fetchPersonById('10');

            expect(person.id).toBe(10);
            expect(person.first_name).toBe('Test9');
        });

        it('should fetch persons by IDs', async () => {
            const persons = await integration.fetchPersonsByIds([
                '1',
                '2',
                '3',
            ]);

            expect(persons).toHaveLength(3);
            expect(persons[0].id).toBe(1);
            expect(persons[2].id).toBe(3);
        });
    });
});
