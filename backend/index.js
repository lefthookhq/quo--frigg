const ScalingTestIntegration = require('./src/integrations/ScalingTestIntegration');
// const ZohoCRMIntegration = require('./src/integrations/ZohoCRMIntegration');
const PipedriveIntegration = require('./src/integrations/PipedriveIntegration');
const AttioIntegration = require('./src/integrations/AttioIntegration');
const AxisCareIntegration = require('./src/integrations/AxisCareIntegration');

const appDefinition = {
    label: 'Quo Integrations',
    name: 'quo-integrations',
    integrations: [
        ScalingTestIntegration,
        // ZohoCRMIntegration,
        PipedriveIntegration,
        AttioIntegration,
        AxisCareIntegration,
    ],
    user: {
        usePassword: true,
        primary: 'individual',
        individualUserRequired: true,
        organizationUserRequired: false,
        authModes: {
            friggToken: true, // Support web UI login
            xFriggHeaders: true, // Enable backend-to-backend API communication
            adopterJwt: false, // Not using custom JWT
        },
    },
    encryption: {
        fieldLevelEncryptionMethod: 'kms', // Use 'aes' for local dev, 'kms' for production
        createResourceIfNoneFound: true,
    },
    vpc: {
        enable: true, // Enable VPC for production deployment
        management: 'discover', // 'create-new' | 'discover' | 'use-existing'
        subnets: {
            management: 'discover', // 'create' | 'discover' | 'use-existing'
        },
        natGateway: {
            management: 'createAndManage', // 'createAndManage' | 'discover' | 'useExisting'
            id: null, // Optional: specific NAT Gateway ID when management is 'useExisting'
        },
        selfHeal: true, // Enable automatic fixing of misconfigurations
    },
    database: {
        postgres: {
            enable: true, // Can be enabled for PostgreSQL
            management: 'create-new', // Create new Aurora Serverless v2 cluster for dev
            publiclyAccessible: true, // Whether to expose the database publicly (dev only - QA/prod should be false)
            autoCreateCredentials: true, // Auto-create Secrets Manager secret with secure password
            database: 'postgres', // Database name
            minCapacity: 0.5, // Minimum Aurora capacity units (cost optimization for dev)
            maxCapacity: 1, // Maximum Aurora capacity units
        },
    },
    ssm: {
        enable: false,
    },
    environment: {
        // Core Configuration
        BASE_URL: true,
        DATABASE_URL: true,
        DATABASE_USER: true,
        DATABASE_PASSWORD: true,
        REDIRECT_PATH: true,
        HEALTH_API_KEY: true,
        // AWS Configuration
        AWS_REGION: true,
        S3_BUCKET_NAME: true,

        QUO_API_KEY: true,
        QUO_BASE_URL: true,
        AXISCARE_API_KEY: true,
        AXISCARE_BASE_URL: true,
        ATTIO_CLIENT_ID: true,
        ATTIO_CLIENT_SECRET: true,
        PIPEDRIVE_API_KEY: true,
        ZOHO_CLIENT_ID: true,
        ZOHO_CLIENT_SECRET: true,
        SCALE_TEST_API_KEY: true,
    },
};

module.exports = {
    Definition: appDefinition,
};
