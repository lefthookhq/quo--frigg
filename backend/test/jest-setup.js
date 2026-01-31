require('dotenv').config({ path: '.env.test' });

global.console = {
    ...console,
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
};

process.env.NODE_ENV = 'test';
process.env.BASE_URL = 'https://test.example.com';
process.env.AWS_ACCESS_KEY_ID = 'test-aws-key';
process.env.AWS_SECRET_ACCESS_KEY = 'test-aws-secret';
process.env.AWS_REGION = 'us-east-1';
process.env.S3_BUCKET_NAME = 'test-bucket';
process.env.SQS_QUEUE_URL =
    'https://sqs.us-east-1.amazonaws.com/123456789/test-queue';
// Prisma needs DATABASE_URL even in tests (used by bulkUpsertToQuo)
// This is a mock URL that won't actually be used since Prisma calls are mocked
process.env.DATABASE_URL =
    process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test_db';

jest.mock('aws-sdk', () => ({
    S3: jest.fn(() => ({
        upload: jest.fn().mockImplementation(() => ({
            promise: jest.fn().mockResolvedValue({
                Location: 'https://test-bucket.s3.amazonaws.com/test-file.jpg',
                Key: 'test-file.jpg',
            }),
        })),
        getSignedUrl: jest
            .fn()
            .mockReturnValue('https://signed-url.example.com'),
    })),
    SQS: jest.fn(() => ({
        sendMessage: jest.fn().mockImplementation(() => ({
            promise: jest.fn().mockResolvedValue({
                MessageId: 'test-message-id',
            }),
        })),
    })),
}));

// Mock Prisma Client to avoid database connections in tests
jest.mock('@prisma/client', () => ({
    PrismaClient: jest.fn().mockImplementation(() => ({
        user: {
            findUnique: jest.fn().mockResolvedValue({
                id: 'test-user-id',
                appOrgId: 'test-org-id',
            }),
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
            delete: jest.fn().mockResolvedValue({}),
        },
        $connect: jest.fn().mockResolvedValue(undefined),
        $disconnect: jest.fn().mockResolvedValue(undefined),
    })),
}));

jest.mock('@friggframework/core', () => ({
    IntegrationBase: class IntegrationBase {
        constructor() {
            this.events = {};
        }
    },
    Entity: class Entity {},
    UserModel: class UserModel {},
    IntegrationModel: class IntegrationModel {},
    get: (obj, path) => {
        // Simple lodash.get implementation for testing
        if (!obj || !path) return undefined;
        const keys = path.split('.');
        let result = obj;
        for (const key of keys) {
            result = result?.[key];
            if (result === undefined) return undefined;
        }
        return result;
    },
    Requester: class Requester {
        constructor(params = {}) {
            this.baseUrl = params.baseUrl || '';
            this.headers = params.headers || {};
        }
    },
    ApiKeyRequester: class ApiKeyRequester {
        constructor(params = {}) {
            this.baseUrl = params.baseUrl || '';
            this.headers = params.headers || {};
            this.requesterType = 'apiKey';
            // Match actual frigg framework: uses snake_case (api_key_name, api_key)
            this.api_key_name = params.api_key_name || 'key';
            this.api_key = params.api_key || null;
        }
        async addAuthHeaders(headers) {
            if (this.api_key) {
                headers[this.api_key_name] = this.api_key;
            }
            return headers;
        }
        isAuthenticated() {
            return (
                this.api_key !== null &&
                this.api_key !== undefined &&
                typeof this.api_key === 'string' &&
                this.api_key.trim().length > 0
            );
        }
        setApiKey(api_key) {
            this.api_key = api_key;
        }
        setApiKeyName(api_key_name) {
            this.api_key_name = api_key_name;
        }
    },
    OAuth2Requester: class OAuth2Requester {
        constructor(params = {}) {
            this.baseUrl = params.baseUrl || '';
            this.headers = params.headers || {};
            this.accessToken = params.accessToken || '';
        }
    },
    BasicAuthRequester: class BasicAuthRequester {
        constructor(params = {}) {
            this.baseUrl = params.baseUrl || '';
            this.headers = params.headers || {};
            this.username = params.username || '';
            this.password = params.password || '';
        }
    },
    createFriggBackend: jest.fn(() => ({
        moduleFactory: {
            getInstanceFromTypeName: jest.fn(),
            getEntitiesForUser: jest.fn(() => []),
        },
        IntegrationHelper: {
            getIntegrationsForUserId: jest.fn(() => []),
        },
        integrationFactory: {
            createIntegration: jest.fn(() => ({ _id: 'test-integration-id' })),
        },
    })),
    QueuerUtil: {
        getQueuer: jest.fn(() => ({
            queue: jest.fn().mockResolvedValue(),
        })),
    },
    createFriggCommands: jest.fn((params) => ({
        updateIntegrationConfig: jest.fn().mockResolvedValue({}),
        getIntegration: jest.fn().mockResolvedValue({}),
        deleteIntegration: jest.fn().mockResolvedValue({}),
        createMapping: jest.fn().mockResolvedValue({}),
        updateMapping: jest.fn().mockResolvedValue({}),
        deleteMapping: jest.fn().mockResolvedValue({}),
    })),
    createSchedulerCommands: jest.fn((params) => ({
        scheduleJob: jest.fn().mockResolvedValue({
            jobId: 'mock-job-id',
            jobArn: 'arn:aws:scheduler:mock:mock-job-arn',
            scheduledAt: new Date().toISOString(),
        }),
        deleteJob: jest.fn().mockResolvedValue({
            success: true,
            jobId: 'mock-job-id',
        }),
        getJobStatus: jest.fn().mockResolvedValue({
            exists: true,
            scheduledAt: new Date().toISOString(),
            state: 'ENABLED',
        }),
    })),
}));

// Removed mocks for non-existent modules (@friggframework/api-module-asana, @friggframework/api-module-frontify)
// These modules don't exist in the monorepo and were causing test failures

global.fetch = jest.fn(() =>
    Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        blob: () => Promise.resolve(new Blob()),
        text: () => Promise.resolve(''),
        headers: new Map(),
    }),
);

beforeEach(() => {
    jest.clearAllMocks();
});
