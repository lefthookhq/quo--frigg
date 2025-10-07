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
process.env.FRONTIFY_CLIENT_ID = 'test-frontify-client-id';
process.env.FRONTIFY_CLIENT_SECRET = 'test-frontify-secret';
process.env.ASANA_CLIENT_ID = 'test-asana-client-id';
process.env.ASANA_CLIENT_SECRET = 'test-asana-secret';
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
}));

jest.mock('@friggframework/api-module-asana', () => ({
    Definition: {
        name: 'asana',
        version: '1.0.0',
        env: {
            redirect_uri: 'https://test.example.com/auth/redirect',
        },
    },
    Api: jest.fn(),
    Config: {},
}));

jest.mock('@friggframework/api-module-frontify', () => ({
    Definition: {
        name: 'frontify',
        version: '1.0.0',
    },
    Api: jest.fn(),
    Config: {},
}));

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
