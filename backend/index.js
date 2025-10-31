const ScalingTestIntegration = require('./src/integrations/ScalingTestIntegration');
const ZohoCRMIntegration = require('./src/integrations/ZohoCRMIntegration');
const PipedriveIntegration = require('./src/integrations/PipedriveIntegration');
const AttioIntegration = require('./src/integrations/AttioIntegration');
const AxisCareIntegration = require('./src/integrations/AxisCareIntegration');

const appDefinition = {
    label: 'Quo Integrations',
    name: 'quo-integrations',
    // Managed mode but with explicit subnet configuration
    managementMode: 'managed', // Frigg manages all enabled resources
    vpcIsolation: 'isolated', // Each stage gets separate VPC/Aurora for complete isolation

    integrations: [
        ScalingTestIntegration,
        ZohoCRMIntegration,
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
        fieldLevelEncryptionMethod: 'kms', // KMS encryption for production
    },
    vpc: {
        enable: true,
        enableVPCEndpoints: true,
        selfHeal: true,
    },
    database: {
        postgres: {
            enable: true,
            publiclyAccessible: false, // Use private subnets - Lambda can access via VPC
            database: 'postgres',
            minCapacity: 0.5,
            maxCapacity: 1,
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
        ADMIN_API_KEY: true,
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
