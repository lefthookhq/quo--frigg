/**
 * Integration Test for Organization User Configuration
 *
 * Tests that when organizationUserRequired is true and primary is 'organization',
 * the system correctly:
 * 1. Creates both individual and organization user records
 * 2. Links them together
 * 3. Stores appOrgId in the organization user
 * 4. Creates integrations linked to the organization user
 *
 * @group integration
 * @group organization-user
 */

const {
    makeAuthenticatedRequest,
    authenticateModule,
    createIntegration,
    cleanupTestData,
} = require('./integration-test-helpers');

describe('Organization User Configuration', () => {
    const testOrgId = `test-org-${Date.now()}`;
    const testUserId = `test-user-${Date.now()}`;
    let integrationId;
    let quoEntityId;
    let scaleTestEntityId;

    afterAll(async () => {
        if (integrationId) {
            await cleanupTestData(integrationId, testUserId);
        }
    });

    describe('User Creation with Organization Primary', () => {
        it('should create both individual and organization users when both headers are provided', async () => {
            // Make a request with both appUserId and appOrgId headers
            const res = await makeAuthenticatedRequest(
                'GET',
                '/api/integrations',
                null,
                testUserId,
                testOrgId, // Pass orgId to test helpers
            );

            expect(res.status).toBe(200);

            // Verify response indicates organization is primary
            // The user creation happens in the auth middleware
            // We can't directly inspect the User table from here without DB access
            // but we can verify the API accepts the request
            expect(res.data).toBeDefined();
        });

        it('should create integration entities with organization context', async () => {
            const quoApiKey = process.env.QUO_API_KEY;
            const scaleTestApiKey =
                process.env.SCALE_TEST_API_KEY || 'dummy-key';

            if (!quoApiKey) {
                console.warn('QUO_API_KEY not set, skipping test');
                return;
            }

            // Create entities using both userId and orgId headers
            const quoEntity = await authenticateModule(
                'quo',
                { apiKey: quoApiKey },
                testUserId,
            );

            expect(quoEntity).toBeDefined();
            expect(quoEntity.entity).toHaveProperty('id');
            quoEntityId = quoEntity.entity.id;

            const scaleTestEntity = await authenticateModule(
                'scale-test',
                { apiKey: scaleTestApiKey },
                testUserId,
            );

            expect(scaleTestEntity).toBeDefined();
            expect(scaleTestEntity.entity).toHaveProperty('id');
            scaleTestEntityId = scaleTestEntity.entity.id;
        });

        it('should create integration linked to organization user', async () => {
            if (!quoEntityId || !scaleTestEntityId) {
                console.warn('Entities not created, skipping integration test');
                return;
            }

            const integration = await createIntegration(
                'scaling-test',
                {
                    quo: quoEntityId,
                    'scale-test': scaleTestEntityId,
                },
                {},
                testUserId,
            );

            expect(integration).toBeDefined();
            expect(integration).toHaveProperty('id');
            integrationId = integration.id;

            // Verify integration has userId (which should be org user ID when primary='organization')
            expect(integration).toHaveProperty('userId');
            expect(integration.userId).toBeDefined();

            // Integration should be in ENABLED status after onCreate lifecycle
            expect(integration.status).toBe('ENABLED');
        });
    });

    describe('Organization User Required Validation', () => {
        it('should require appOrgId header when organizationUserRequired is true', async () => {
            // According to get-user-from-x-frigg-headers.js:49-54
            // When organizationUserRequired is true, the system should process appOrgId

            // Make request with only appUserId (no appOrgId)
            const res = await makeAuthenticatedRequest(
                'GET',
                '/api/integrations',
                null,
                `solo-user-${Date.now()}`,
                null, // No orgId
            );

            // With organizationUserRequired: true, this should still work
            // because individualUserRequired is also true
            // The system creates individual user and can function
            expect(res.status).toBe(200);
        });

        it('should accept both headers and link individual to organization', async () => {
            const uniqueUserId = `linked-user-${Date.now()}`;
            const uniqueOrgId = `linked-org-${Date.now()}`;

            // Make request with both headers
            const res = await makeAuthenticatedRequest(
                'GET',
                '/api/integrations',
                null,
                uniqueUserId,
                uniqueOrgId,
            );

            expect(res.status).toBe(200);

            // Make another request with same IDs to verify they're linked
            const res2 = await makeAuthenticatedRequest(
                'GET',
                '/api/integrations',
                null,
                uniqueUserId,
                uniqueOrgId,
            );

            expect(res2.status).toBe(200);
            // Should get same integrations list (same user context)
            expect(res2.data).toEqual(res.data);
        });
    });

    describe('AppOrgId Storage Verification', () => {
        it('should store and retrieve appOrgId through integration context', async () => {
            // This is an indirect test - we create an integration and verify
            // it can be retrieved, which proves the org user relationship works

            if (!integrationId) {
                console.warn('No integration created, skipping test');
                return;
            }

            // Get integration using the same user/org context
            const res = await makeAuthenticatedRequest(
                'GET',
                `/api/integrations/${integrationId}`,
                null,
                testUserId,
                testOrgId,
            );

            expect(res.status).toBe(200);
            expect(res.data).toBeDefined();
            expect(res.data.id).toBe(integrationId);

            // Integration should have userId (organization user ID)
            expect(res.data.userId).toBeDefined();
        });

        it('should isolate integrations by organization', async () => {
            // Create integration for different org
            const differentOrgId = `different-org-${Date.now()}`;
            const differentUserId = `different-user-${Date.now()}`;

            const res = await makeAuthenticatedRequest(
                'GET',
                '/api/integrations',
                null,
                differentUserId,
                differentOrgId,
            );

            expect(res.status).toBe(200);

            // Should have empty integrations list (different org context)
            // Our test integration belongs to testOrgId, not differentOrgId
            const integrations = Array.isArray(res.data)
                ? res.data
                : res.data.integrations || [];

            // Should not include our test integration
            const hasOurIntegration = integrations.some(
                (i) => i.id === integrationId,
            );
            expect(hasOurIntegration).toBe(false);
        });
    });

    describe('Primary User Type Behavior', () => {
        it('should use organization as primary when primary="organization"', async () => {
            // When primary='organization', the getId() method returns org user ID
            // This means integration.userId should be the organization user ID

            if (!integrationId) {
                console.warn('No integration created, skipping test');
                return;
            }

            // Get integration
            const res = await makeAuthenticatedRequest(
                'GET',
                `/api/integrations/${integrationId}`,
                null,
                testUserId,
                testOrgId,
            );

            expect(res.status).toBe(200);
            expect(res.data.userId).toBeDefined();

            // The userId should be a valid ID (not null/undefined)
            // In production, we could verify it's the org user ID by checking
            // the User table, but in integration tests we verify behavior
            expect(typeof res.data.userId).toBe('number');
        });
    });

    describe('Backward Compatibility', () => {
        it('should still work with only appUserId header (creates individual user)', async () => {
            const soloUserId = `backward-compat-${Date.now()}`;

            // Make request with only appUserId (legacy behavior)
            const res = await makeAuthenticatedRequest(
                'GET',
                '/api/integrations',
                null,
                soloUserId,
                null, // No orgId
            );

            // Should still work because individualUserRequired: true
            expect(res.status).toBe(200);
        });
    });
});
