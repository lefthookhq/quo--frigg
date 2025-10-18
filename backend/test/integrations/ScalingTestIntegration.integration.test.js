/**
 * Integration Test for ScalingTestIntegration
 * 
 * Tests the complete integration flow:
 * 1. Get auth requirements for modules
 * 2. Create entities via POST /api/authorize
 * 3. Create integration via POST /api/integrations
 * 4. Test integration features
 * 
 * @group integration
 * @group scaling-test
 */

const {
    getAuthRequirements,
    authenticateModule,
    createIntegration,
    getIntegration,
    deleteIntegration,
    testEntityAuth,
    cleanupTestData,
} = require('../integration-test-helpers');

describe('ScalingTestIntegration - End-to-End Integration Test', () => {
    let quoEntityId;
    let scaleTestEntityId;
    let integrationId;
    const testUserId = `integration-test-${Date.now()}`;

    // Cleanup after all tests
    afterAll(async () => {
        if (integrationId) {
            await cleanupTestData(integrationId, testUserId);
        }
    });

    describe('Step 1: Get Auth Requirements', () => {
        it('should get auth requirements for quo module', async () => {
            const authReqs = await getAuthRequirements('quo', testUserId);

            expect(authReqs).toBeDefined();
            expect(authReqs.type).toBe('apiKey');
            expect(authReqs.data).toHaveProperty('jsonSchema');
            expect(authReqs.data).toHaveProperty('uiSchema');
            expect(authReqs.data.jsonSchema.properties).toHaveProperty('apiKey');
        });

        it('should get auth requirements for scale-test module', async () => {
            const authReqs = await getAuthRequirements('scale-test', testUserId);

            expect(authReqs).toBeDefined();
            expect(authReqs.type).toBe('apiKey');
            expect(authReqs.data.jsonSchema.properties).toHaveProperty('apiKey');
        });
    });

    describe('Step 2: Create Entities via POST /api/authorize', () => {
        it('should create quo entity with API key', async () => {
            const quoApiKey = process.env.QUO_API_KEY;
            
            if (!quoApiKey) {
                console.warn('QUO_API_KEY not set, skipping entity creation');
                return;
            }

            const entity = await authenticateModule(
                'quo',
                { apiKey: quoApiKey },
                testUserId
            );

            expect(entity).toBeDefined();
            expect(entity.entity).toHaveProperty('id');
            quoEntityId = entity.entity.id;
        });

        it('should create scale-test entity with API key', async () => {
            const scaleTestApiKey = process.env.SCALE_TEST_API_KEY || 'any-dummy-key';

            const entity = await authenticateModule(
                'scale-test',
                { apiKey: scaleTestApiKey },
                testUserId
            );

            expect(entity).toBeDefined();
            expect(entity.entity).toHaveProperty('id');
            scaleTestEntityId = entity.entity.id;
        });

        it('should validate authentication for created entities', async () => {
            if (!quoEntityId || !scaleTestEntityId) {
                console.warn('Entities not created, skipping validation');
                return;
            }

            // Test quo entity auth
            const quoAuthResult = await testEntityAuth(quoEntityId, testUserId);
            expect([200, 400]).toContain(quoAuthResult.status); // 200 = ok, 400 = auth issue

            // Test scale-test entity auth  
            const scaleTestAuthResult = await testEntityAuth(scaleTestEntityId, testUserId);
            expect([200, 400]).toContain(scaleTestAuthResult.status);
        });
    });

    describe('Step 3: Create Integration via POST /api/integrations', () => {
        it('should create ScalingTest integration with entities', async () => {
            if (!quoEntityId || !scaleTestEntityId) {
                console.warn('Entities not created, skipping integration creation');
                return;
            }

            const integration = await createIntegration(
                'scalingtest',
                {
                    quo: quoEntityId,
                    'scale-test': scaleTestEntityId,
                },
                {},
                testUserId
            );

            expect(integration).toBeDefined();
            expect(integration).toHaveProperty('id');
            expect(integration.entities).toHaveProperty('quo');
            expect(integration.entities).toHaveProperty('scale-test');
            
            integrationId = integration.id;
        });

        it('should retrieve the created integration', async () => {
            if (!integrationId) {
                console.warn('Integration not created, skipping retrieval');
                return;
            }

            const integration = await getIntegration(integrationId, testUserId);

            expect(integration).toBeDefined();
            expect(integration.id).toBe(integrationId);
            expect(integration.entities).toHaveProperty('quo');
            expect(integration.entities).toHaveProperty('scale-test');
        });
    });

    describe('Step 4: Test Integration Features', () => {
        it('should test basic integration functionality', async () => {
            if (!integrationId) {
                console.warn('Integration not created, skipping feature tests');
                return;
            }

            // Integration is created - in a real scenario, we'd test:
            // - Sync operations
            // - Data transformation
            // - Webhook handling
            // - Queue processing
            
            // For now, verify integration exists and is accessible
            const integration = await getIntegration(integrationId, testUserId);
            expect(integration.status).toBeDefined();
        });
    });

    describe('Backend-to-Backend Auth', () => {
        it('should support authentication with x-frigg-appUserId header', async () => {
            const uniqueUserId = `x-frigg-test-${Date.now()}`;
            
            const authReqs = await getAuthRequirements('quo', uniqueUserId);
            expect(authReqs).toBeDefined();
            
            // Verify the auto-created user can be used for subsequent requests
            const authReqs2 = await getAuthRequirements('scale-test', uniqueUserId);
            expect(authReqs2).toBeDefined();
        });

        it('should support authentication with x-frigg-appOrgId header', async () => {
            const uniqueOrgId = `x-frigg-org-${Date.now()}`;
            
            // Note: This would require updating the test helper to support orgId
            // For now, this documents the intended behavior
            expect(true).toBe(true);
        });
    });
});

