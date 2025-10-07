/*
 * Jest configuration for pure unit tests
 * No external dependencies, no MongoDB, completely isolated
 */

module.exports = {
    // Test environment
    testEnvironment: 'node',

    // Clear mocks between tests
    clearMocks: true,

    // Test file patterns - only our unit tests
    testMatch: [
        '<rootDir>/test/services/*.test.js',
        '<rootDir>/test/use-cases/*.test.js',
        '<rootDir>/test/repositories/*.test.js',
    ],

    // Exclude files that might have external dependencies
    testPathIgnorePatterns: [
        '/node_modules/',
        '/coverage/',
        '/test/integrations/', // Skip integration tests
        '/test/mocks/',
        '/test/signatureValidation.test.js',
        '/test/oauthStateValidation.test.js',
    ],

    // NO global setup/teardown - this was starting MongoDB
    globalSetup: undefined,
    globalTeardown: undefined,

    // NO setup files that might require external services
    setupFilesAfterEnv: [],

    // Shorter timeout for unit tests
    testTimeout: 10000, // 10 seconds

    // Run tests serially to avoid conflicts
    maxWorkers: 1,

    // Verbose output
    verbose: false, // Reduce noise for now

    // No coverage collection for now - just focus on getting tests to run
    collectCoverage: false,

    // Force exit to prevent hanging
    forceExit: true,

    // Detect open handles to identify what might be keeping Node running
    detectOpenHandles: true,
};
