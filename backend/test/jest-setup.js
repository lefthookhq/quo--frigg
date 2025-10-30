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

jest.mock('@friggframework/core', () => ({
    IntegrationBase: class IntegrationBase {
        constructor() {
            this.events = {};
        }
    },
    Entity: class Entity {},
    UserModel: class UserModel {},
    IntegrationModel: class IntegrationModel {},
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
            this.apiKey = params.apiKey || '';
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
