const ScalingTestIntegration = require('./src/integrations/ScalingTestIntegration');
// const ZohoCRMIntegration = require('./src/integrations/ZohoCRMIntegration');
// const PipeDriveIntegration = require('./src/integrations/PipeDriveIntegration');
// const AttioIntegration = require('./src/integrations/AttioIntegration');
const AxisCareIntegration = require('./src/integrations/AxisCareIntegration');

const appDefinition = {
    label: 'Quo Integrations',
    name: 'quo-integrations',
    integrations: [
        ScalingTestIntegration,
        // ZohoCRMIntegration,
        // PipeDriveIntegration,
        // AttioIntegration,
        AxisCareIntegration,
    ],
    user: {
        usePassword: true,
        individualUserRequired: true,
    },
    encryption: {
        fieldLevelEncryptionMethod: 'aes', // Use 'aes' for local dev, 'kms' for production
        createResourceIfNoneFound: true,
    },
    vpc: {
        enable: false, // Disable VPC for local development
        management: 'discover', // 'create-new' | 'discover' | 'use-existing'
        vpcId: null, // Optional: specific VPC ID to use when management is 'use-existing'
        subnets: {
            management: 'discover', // 'create' | 'discover' | 'use-existing'
            ids: [], // Optional: specific subnet IDs when management is 'use-existing'
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
            management: 'create-new', // 'create-new' | 'discover' | 'use-existing'
        },
    },
    ssm: {
        enable: false,
    },
    environment: {
        // Core Configuration
        BASE_URL: true,
        DATABASE_URL: true,
        REDIRECT_PATH: true,
        // AWS Configuration
        AWS_REGION: true,
        S3_BUCKET_NAME: true,
    },
};

module.exports = {
    Definition: appDefinition,
};
