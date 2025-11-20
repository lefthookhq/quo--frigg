const axios = require('axios');

/**
 * Integration Test Helper Functions
 *
 * Provides utilities for testing Frigg integrations end-to-end using
 * backend-to-backend authentication with x-frigg headers.
 */

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';
const API_KEY = process.env.FRIGG_APP_API_KEY || 'test-api-key';
const DEFAULT_USER_ID = 'test-user-integration';
const DEFAULT_ORG_ID = 'test-org-integration';

/**
 * Make an authenticated request using x-frigg headers
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE, etc.)
 * @param {string} path - API path (e.g., '/api/integrations')
 * @param {Object} [data] - Request body data
 * @param {string} [userId] - App user ID for x-frigg-appUserId header
 * @param {string} [orgId] - App org ID for x-frigg-appOrgId header
 * @returns {Promise<AxiosResponse>} Axios response
 */
async function makeAuthenticatedRequest(
    method,
    path,
    data = null,
    userId = DEFAULT_USER_ID,
    orgId = null,
) {
    const headers = {
        'x-api-key': API_KEY,
    };

    if (userId) {
        headers['x-frigg-appUserId'] = userId;
    }

    if (orgId) {
        headers['x-frigg-appOrgId'] = orgId;
    }

    try {
        return await axios({
            method,
            url: `${BASE_URL}${path}`,
            headers,
            data,
            validateStatus: null, // Don't throw on any status code
        });
    } catch (error) {
        console.error('Request failed:', error.message);
        throw error;
    }
}

/**
 * Get authorization requirements for a module type
 * @param {string} entityType - Module type (e.g., 'quo', 'attio', 'axiscare')
 * @param {string} [userId] - User ID for authentication
 * @returns {Promise<Object>} Authorization requirements (JSON schema, UI schema, etc.)
 */
async function getAuthRequirements(entityType, userId = DEFAULT_USER_ID) {
    const res = await makeAuthenticatedRequest(
        'GET',
        `/api/authorize?entityType=${entityType}`,
        null,
        userId,
    );

    if (res.status !== 200) {
        throw new Error(
            `Failed to get auth requirements for ${entityType}: ${res.status} - ${JSON.stringify(res.data)}`,
        );
    }

    return res.data;
}

/**
 * Create an entity by authenticating a module
 * @param {string} entityType - Module type (e.g., 'quo', 'attio')
 * @param {Object} credentials - Credentials for the module (e.g., { apiKey: '...' })
 * @param {string} [userId] - User ID for authentication
 * @param {string} [orgId] - App org ID for x-frigg-appOrgId header
 * @returns {Promise<Object>} Created entity details (includes entity.id)
 */
async function authenticateModule(
    entityType,
    credentials,
    userId = DEFAULT_USER_ID,
    orgId = null,
) {
    const res = await makeAuthenticatedRequest(
        'POST',
        '/api/authorize',
        { entityType, data: credentials },
        userId,
        orgId,
    );

    if (res.status !== 200) {
        throw new Error(
            `Failed to authenticate module ${entityType}: ${res.status} - ${JSON.stringify(res.data)}`,
        );
    }

    return res.data;
}

/**
 * Create an integration with multiple entities
 * @param {string} integrationType - Integration type (e.g., 'scaling-test')
 * @param {Object} entities - Map of entity types to entity IDs (e.g., { quo: 'entity-id-1', scaletest: 'entity-id-2' })
 * @param {Object} [config] - Integration configuration
 * @param {string} [userId] - User ID for authentication
 * @param {string} [orgId] - App org ID for x-frigg-appOrgId header
 * @returns {Promise<Object>} Created integration
 */
async function createIntegration(
    integrationType,
    entities,
    config = {},
    userId = DEFAULT_USER_ID,
    orgId = null,
) {
    const integrationConfig = {
        type: integrationType,
        ...config,
    };

    const res = await makeAuthenticatedRequest(
        'POST',
        '/api/integrations',
        {
            config: integrationConfig,
            entities,
        },
        userId,
        orgId,
    );

    if (res.status !== 201) {
        throw new Error(
            `Failed to create integration ${integrationType}: ${res.status} - ${JSON.stringify(res.data)}`,
        );
    }

    return res.data;
}

/**
 * Get all integrations for a user
 * @param {string} [userId] - User ID for authentication
 * @returns {Promise<Object>} Integrations data
 */
async function getIntegrations(userId = DEFAULT_USER_ID) {
    const res = await makeAuthenticatedRequest(
        'GET',
        '/api/integrations',
        null,
        userId,
    );

    if (res.status !== 200) {
        throw new Error(
            `Failed to get integrations: ${res.status} - ${JSON.stringify(res.data)}`,
        );
    }

    return res.data;
}

/**
 * Get a specific integration by ID
 * @param {string} integrationId - Integration ID
 * @param {string} [userId] - User ID for authentication
 * @returns {Promise<Object>} Integration details
 */
async function getIntegration(integrationId, userId = DEFAULT_USER_ID) {
    const res = await makeAuthenticatedRequest(
        'GET',
        `/api/integrations/${integrationId}`,
        null,
        userId,
    );

    if (res.status !== 200) {
        throw new Error(
            `Failed to get integration ${integrationId}: ${res.status} - ${JSON.stringify(res.data)}`,
        );
    }

    return res.data;
}

/**
 * Delete an integration
 * @param {string} integrationId - Integration ID to delete
 * @param {string} [userId] - User ID for authentication
 * @returns {Promise<void>}
 */
async function deleteIntegration(integrationId, userId = DEFAULT_USER_ID) {
    const res = await makeAuthenticatedRequest(
        'DELETE',
        `/api/integrations/${integrationId}`,
        null,
        userId,
    );

    if (res.status !== 204) {
        throw new Error(
            `Failed to delete integration ${integrationId}: ${res.status} - ${JSON.stringify(res.data)}`,
        );
    }
}

/**
 * Test authentication for an entity
 * @param {string} entityId - Entity ID to test
 * @param {string} [userId] - User ID for authentication
 * @returns {Promise<Object>} Test auth result
 */
async function testEntityAuth(entityId, userId = DEFAULT_USER_ID) {
    const res = await makeAuthenticatedRequest(
        'GET',
        `/api/entities/${entityId}/test-auth`,
        null,
        userId,
    );

    return { status: res.status, data: res.data };
}

/**
 * Create a test user via Frigg's user creation endpoint
 * @param {string} username - Username for the test user
 * @param {string} password - Password for the test user
 * @returns {Promise<Object>} Created user with token
 */
async function createTestUser(username, password) {
    const res = await axios.post(`${BASE_URL}/user/create`, {
        username,
        password,
    });

    if (res.status !== 201) {
        throw new Error(
            `Failed to create test user: ${res.status} - ${JSON.stringify(res.data)}`,
        );
    }

    return res.data;
}

/**
 * Login as a test user
 * @param {string} username - Username
 * @param {string} password - Password
 * @returns {Promise<Object>} Login result with token
 */
async function loginTestUser(username, password) {
    const res = await axios.post(`${BASE_URL}/user/login`, {
        username,
        password,
    });

    if (res.status !== 201) {
        throw new Error(
            `Failed to login: ${res.status} - ${JSON.stringify(res.data)}`,
        );
    }

    return res.data;
}

/**
 * Cleanup test data - delete integration and its entities
 * @param {string} integrationId - Integration ID to clean up
 * @param {string} [userId] - User ID for authentication
 * @returns {Promise<void>}
 */
async function cleanupTestData(integrationId, userId = DEFAULT_USER_ID) {
    try {
        await deleteIntegration(integrationId, userId);
    } catch (error) {
        console.warn(`Cleanup warning: ${error.message}`);
    }
}

/**
 * Wait for a condition to be true with timeout
 * @param {Function} condition - Async function that returns true when condition met
 * @param {number} [timeoutMs=10000] - Timeout in milliseconds
 * @param {number} [intervalMs=500] - Polling interval in milliseconds
 * @returns {Promise<void>}
 */
async function waitForCondition(
    condition,
    timeoutMs = 10000,
    intervalMs = 500,
) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        if (await condition()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Condition not met within ${timeoutMs}ms`);
}

module.exports = {
    // Request helpers
    makeAuthenticatedRequest,

    // Entity/Module helpers
    getAuthRequirements,
    authenticateModule,
    testEntityAuth,

    // Integration helpers
    createIntegration,
    getIntegrations,
    getIntegration,
    deleteIntegration,

    // User helpers
    createTestUser,
    loginTestUser,

    // Cleanup
    cleanupTestData,

    // Utilities
    waitForCondition,

    // Constants
    BASE_URL,
    DEFAULT_USER_ID,
    DEFAULT_ORG_ID,
};
