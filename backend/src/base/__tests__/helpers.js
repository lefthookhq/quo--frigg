/**
 * Test Helpers for BaseCRMIntegration
 * 
 * Provides mock factories and test data builders for testing
 * CRM integration components.
 */

// ============================================================================
// Mock Factories
// ============================================================================

/**
 * Create a mock ProcessManager
 * @returns {Object} Mock ProcessManager with jest functions
 */
function createMockProcessManager() {
    return {
        createSyncProcess: jest.fn(),
        updateState: jest.fn(),
        updateMetrics: jest.fn(),
        getProcess: jest.fn(),
        handleError: jest.fn(),
        updateTotal: jest.fn(),
        completeProcess: jest.fn(),
    };
}

/**
 * Create a mock QueueManager
 * @returns {Object} Mock QueueManager with jest functions
 */
function createMockQueueManager() {
    return {
        queueFetchPersonPage: jest.fn(),
        queueProcessPersonBatch: jest.fn(),
        queueCompleteSync: jest.fn(),
        fanOutPages: jest.fn(),
        queueMultipleBatches: jest.fn(),
        getQueueUrl: jest.fn(() => 'https://sqs.test.com/queue'),
    };
}

/**
 * Create a mock SyncOrchestrator
 * @returns {Object} Mock SyncOrchestrator with jest functions
 */
function createMockSyncOrchestrator() {
    return {
        startInitialSync: jest.fn(),
        startOngoingSync: jest.fn(),
        handleWebhook: jest.fn(),
        getLastSyncTime: jest.fn(),
        hasActiveSyncs: jest.fn(),
        cancelActiveSyncs: jest.fn(),
    };
}

/**
 * Create a mock Process Repository
 * @returns {Object} Mock repository with jest functions
 */
function createMockProcessRepository() {
    return {
        create: jest.fn(),
        findById: jest.fn(),
        update: jest.fn(),
        findByIntegrationAndType: jest.fn(),
        findActiveProcesses: jest.fn(),
        findByName: jest.fn(),
        deleteById: jest.fn(),
    };
}

/**
 * Create a mock Integration instance
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock integration
 */
function createMockIntegration(overrides = {}) {
    return {
        id: 'integration-123',
        userId: 'user-456',
        constructor: {
            CRMConfig: {
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
                },
            },
        },
        fetchPersonPage: jest.fn(),
        transformPersonToQuo: jest.fn(),
        fetchPersonsByIds: jest.fn(),
        ...overrides,
    };
}

// ============================================================================
// Test Data Builders
// ============================================================================

/**
 * Build process data for testing
 * @param {Object} overrides - Fields to override
 * @returns {Object} Process data object
 */
function buildProcessData(overrides = {}) {
    return {
        userId: 'user-123',
        integrationId: 'integration-456',
        name: 'test-crm-contact-sync',
        type: 'CRM_SYNC',
        state: 'INITIALIZING',
        context: {
            syncType: 'INITIAL',
            personObjectType: 'Contact',
            totalRecords: 0,
            processedRecords: 0,
            currentPage: 0,
            pagination: {
                pageSize: 100,
                currentCursor: null,
                nextPage: 0,
                hasMore: true,
            },
            startTime: new Date().toISOString(),
        },
        results: {
            aggregateData: {
                totalSynced: 0,
                totalFailed: 0,
                duration: 0,
                recordsPerSecond: 0,
                errors: [],
            },
        },
        ...overrides,
    };
}

/**
 * Build a complete process record (as returned from repository)
 * @param {Object} overrides - Fields to override
 * @returns {Object} Complete process record
 */
function buildProcessRecord(overrides = {}) {
    return {
        id: 'process-123',
        ...buildProcessData(overrides),
        createdAt: new Date(),
        updatedAt: new Date(),
        childProcesses: [],
        parentProcessId: null,
    };
}

/**
 * Build person page response (from CRM API)
 * @param {Object} options - Options for building response
 * @returns {Object} Person page response
 */
function buildPersonPageResponse({
    data = [],
    total = 100,
    hasMore = true,
    page = 0,
    limit = 100,
} = {}) {
    // Generate mock person data if not provided
    if (data.length === 0) {
        const count = Math.min(limit, total - page * limit);
        data = Array.from({ length: count }, (_, i) => ({
            id: `person-${page * limit + i}`,
            firstName: `Test${i}`,
            lastName: `Person${i}`,
            email: `test${i}@example.com`,
            phone: `555-${String(i).padStart(4, '0')}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }));
    }

    return {
        data,
        total,
        hasMore,
    };
}

/**
 * Build Quo contact format
 * @param {Object} overrides - Fields to override
 * @returns {Object} Quo contact object
 */
function buildQuoContact(overrides = {}) {
    return {
        externalId: 'person-123',
        source: 'test-crm-person',
        defaultFields: {
            firstName: 'Test',
            lastName: 'Person',
            company: 'Test Company',
            phoneNumbers: [{ name: 'work', value: '555-0100' }],
            emails: [{ name: 'work', value: 'test@example.com' }],
        },
        customFields: {
            crmId: 'person-123',
            crmType: 'test-crm',
            lastModified: new Date().toISOString(),
        },
        ...overrides,
    };
}

/**
 * Build metrics update object
 * @param {Object} overrides - Fields to override
 * @returns {Object} Metrics update
 */
function buildMetricsUpdate(overrides = {}) {
    return {
        processed: 10,
        success: 8,
        errors: 2,
        errorDetails: [
            {
                contactId: 'person-1',
                error: 'Missing required field: email',
                timestamp: new Date().toISOString(),
            },
        ],
        ...overrides,
    };
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert that a process has the expected structure
 * @param {Object} process - Process object to validate
 */
function assertValidProcess(process) {
    expect(process).toHaveProperty('id');
    expect(process).toHaveProperty('userId');
    expect(process).toHaveProperty('integrationId');
    expect(process).toHaveProperty('name');
    expect(process).toHaveProperty('type');
    expect(process).toHaveProperty('state');
    expect(process).toHaveProperty('context');
    expect(process).toHaveProperty('results');
    expect(process).toHaveProperty('createdAt');
    expect(process).toHaveProperty('updatedAt');
}

/**
 * Assert that context has CRM sync structure
 * @param {Object} context - Context object to validate
 */
function assertValidCRMSyncContext(context) {
    expect(context).toHaveProperty('syncType');
    expect(context).toHaveProperty('personObjectType');
    expect(context).toHaveProperty('totalRecords');
    expect(context).toHaveProperty('processedRecords');
    expect(context).toHaveProperty('pagination');
    expect(context.pagination).toHaveProperty('pageSize');
}

module.exports = {
    // Mock factories
    createMockProcessManager,
    createMockQueueManager,
    createMockSyncOrchestrator,
    createMockProcessRepository,
    createMockIntegration,

    // Test data builders
    buildProcessData,
    buildProcessRecord,
    buildPersonPageResponse,
    buildQuoContact,
    buildMetricsUpdate,

    // Assertion helpers
    assertValidProcess,
    assertValidCRMSyncContext,
};

