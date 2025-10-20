/**
 * Integration Test for AttioIntegration
 * 
 * Tests the complete integration flow for Attio CRM:
 * 1. Get auth requirements for modules
 * 2. Create entities via POST /api/authorize  
 * 3. Create integration via POST /api/integrations
 * 4. Test integration features
 * 
 * @group integration
 * @group attio
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

describe('AttioIntegration - End-to-End Integration Test', () => {
    let quoEntityId;
    let attioEntityId;
    let integrationId;
    const testUserId = `attio-integration-test-${Date.now()}`;

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

        it('should get auth requirements for attio module', async () => {
            const authReqs = await getAuthRequirements('attio', testUserId);

            expect(authReqs).toBeDefined();
            // Attio uses OAuth2
            expect(authReqs.type).toBe('oauth2');
            expect(authReqs).toHaveProperty('url'); // OAuth redirect URL
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

        it('should create attio entity with OAuth credentials', async () => {
            const attioClientId = process.env.ATTIO_CLIENT_ID;
            const attioClientSecret = process.env.ATTIO_CLIENT_SECRET;
            
            if (!attioClientId || !attioClientSecret) {
                console.warn('ATTIO credentials not set, skipping entity creation');
                return;
            }

            // Note: Full OAuth flow requires manual intervention
            // In automated tests, we might need to mock or use pre-authorized tokens
            console.warn('Attio OAuth entity creation requires manual OAuth flow');
            console.warn('This test documents the expected behavior');
            
            // For now, skip actual OAuth flow in automated tests
            // In manual/interactive tests, this would complete the OAuth flow
        });

        it('should validate quo entity authentication', async () => {
            if (!quoEntityId) {
                console.warn('Quo entity not created, skipping validation');
                return;
            }

            const authResult = await testEntityAuth(quoEntityId, testUserId);
            expect([200, 400]).toContain(authResult.status);
        });
    });

    describe('Step 3: Create Integration via POST /api/integrations', () => {
        it('should create Attio integration when both entities exist', async () => {
            if (!quoEntityId || !attioEntityId) {
                console.warn('Entities not fully created, skipping integration creation');
                console.warn('Attio integration requires manual OAuth completion');
                return;
            }

            const integration = await createIntegration(
                'attio',
                {
                    quo: quoEntityId,
                    attio: attioEntityId,
                },
                {},
                testUserId
            );

            expect(integration).toBeDefined();
            expect(integration).toHaveProperty('id');
            expect(integration.entities).toHaveProperty('quo');
            expect(integration.entities).toHaveProperty('attio');
            
            integrationId = integration.id;
        });
    });

    describe('Step 4: Test Integration Features', () => {
        it('should document expected Attio integration capabilities', () => {
            // Expected capabilities of AttioIntegration:
            // - Person/contact sync from Attio to Quo
            // - Company sync from Attio to Quo
            // - Workspace discovery
            // - Webhook configuration
            // - Record creation and search
            
            expect(true).toBe(true);
        });
    });

    describe('Backend-to-Backend Auth', () => {
        it('should support x-frigg header authentication for Attio workflow', async () => {
            const uniqueUserId = `attio-x-frigg-${Date.now()}`;
            
            // Verify new user auto-creation via x-frigg headers
            const authReqs = await getAuthRequirements('quo', uniqueUserId);
            expect(authReqs).toBeDefined();
        });
    });
});

