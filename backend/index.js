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
            sharedSecret: true, // Enable backend-to-backend API communication with x-frigg-api-key
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
        REDIRECT_URI: true,
        HEALTH_API_KEY: true,
        ADMIN_API_KEY: true,
        FRIGG_API_KEY: true, // Backend-to-backend authentication
        FRIGG_APP_USER_ID: true,
        // AWS Configuration
        AWS_REGION: true,
        S3_BUCKET_NAME: true,

        QUO_BASE_URL: true,
        ATTIO_CLIENT_ID: true,
        ATTIO_CLIENT_SECRET: true,
        ATTIO_SCOPE: true,
        PIPEDRIVE_CLIENT_ID: true,
        PIPEDRIVE_CLIENT_SECRET: true,
        PIPEDRIVE_SCOPE: true,
        ZOHO_CLIENT_ID: true,
        ZOHO_CLIENT_SECRET: true,
        ZOHO_SCOPE: true,
        SCALE_TEST_API_KEY: true,
    },
};

module.exports = {
    Definition: appDefinition,
};
