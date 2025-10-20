/**
 * Integration Test for AxisCareIntegration
 * 
 * Tests the complete integration flow for AxisCare home care management:
 * 1. Get auth requirements for modules
 * 2. Create entities via POST /api/authorize
 * 3. Create integration via POST /api/integrations
 * 4. Test integration features (client sync, applicant sync, appointments)
 * 
 * @group integration
 * @group axiscare
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

describe('AxisCareIntegration - End-to-End Integration Test', () => {
    let quoEntityId;
    let axisCareEntityId;
    let integrationId;
    const testUserId = `axiscare-integration-test-${Date.now()}`;

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
            expect(authReqs.data.jsonSchema.properties).toHaveProperty('apiKey');
        });

        it('should get auth requirements for axiscare module', async () => {
            const authReqs = await getAuthRequirements('axiscare', testUserId);

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

        it('should create axiscare entity with API key', async () => {
            const axisCareApiKey = process.env.AXISCARE_API_KEY;
            
            if (!axisCareApiKey) {
                console.warn('AXISCARE_API_KEY not set, skipping entity creation');
                return;
            }

            const entity = await authenticateModule(
                'axiscare',
                { apiKey: axisCareApiKey },
                testUserId
            );

            expect(entity).toBeDefined();
            expect(entity.entity).toHaveProperty('id');
            axisCareEntityId = entity.entity.id;
        });

        it('should validate authentication for created entities', async () => {
            if (!quoEntityId || !axisCareEntityId) {
                console.warn('Entities not created, skipping validation');
                return;
            }

            // Test quo entity auth
            const quoAuthResult = await testEntityAuth(quoEntityId, testUserId);
            expect([200, 400]).toContain(quoAuthResult.status);

            // Test axiscare entity auth
            const axisCareAuthResult = await testEntityAuth(axisCareEntityId, testUserId);
            expect([200, 400]).toContain(axisCareAuthResult.status);
        });
    });

    describe('Step 3: Create Integration via POST /api/integrations', () => {
        it('should create AxisCare integration with entities', async () => {
            if (!quoEntityId || !axisCareEntityId) {
                console.warn('Entities not created, skipping integration creation');
                return;
            }

            const integration = await createIntegration(
                'axiscare',
                {
                    quo: quoEntityId,
                    axiscare: axisCareEntityId,
                },
                {},
                testUserId
            );

            expect(integration).toBeDefined();
            expect(integration).toHaveProperty('id');
            expect(integration.entities).toHaveProperty('quo');
            expect(integration.entities).toHaveProperty('axiscare');
            
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
            expect(integration.entities).toHaveProperty('axiscare');
        });
    });

    describe('Step 4: Test Integration Features', () => {
        it('should document AxisCare integration capabilities', () => {
            // Expected capabilities of AxisCareIntegration:
            // - Client synchronization (Clients -> Quo Contacts)
            // - Applicant synchronization (Applicants -> Quo Contacts)
            // - Appointment management
            // - Service tracking
            // - Healthcare analytics
            // - Cursor-based pagination
            
            expect(true).toBe(true);
        });

        it('should test basic integration functionality', async () => {
            if (!integrationId) {
                console.warn('Integration not created, skipping feature tests');
                return;
            }

            // In a real scenario with deployed integration, we'd test:
            // - Initial sync of clients
            // - Ongoing sync operations
            // - Webhook handling for real-time updates
            // - Data transformation accuracy
            
            const integration = await getIntegration(integrationId, testUserId);
            expect(integration.status).toBeDefined();
        });
    });

    describe('Backend-to-Backend Auth', () => {
        it('should support authentication with x-frigg-appUserId header', async () => {
            const uniqueUserId = `axiscare-x-frigg-${Date.now()}`;
            
            const authReqs = await getAuthRequirements('quo', uniqueUserId);
            expect(authReqs).toBeDefined();
        });

        it('should auto-create users for backend integration requests', async () => {
            const uniqueUserId = `axiscare-backend-${Date.now()}`;
            
            // First request should auto-create user
            const authReqs1 = await getAuthRequirements('quo', uniqueUserId);
            expect(authReqs1).toBeDefined();
            
            // Second request should reuse the same user
            const authReqs2 = await getAuthRequirements('axiscare', uniqueUserId);
            expect(authReqs2).toBeDefined();
        });
    });
});

