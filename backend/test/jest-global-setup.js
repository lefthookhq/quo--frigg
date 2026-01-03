/**
 * Custom Jest global setup that uses Docker MongoDB instead of MongoMemoryServer
 * This avoids OpenSSL compatibility issues with mongodb-memory-server on Ubuntu 24.04
 */
const { overrideEnvironment } = require('@friggframework/test/override-environment');

module.exports = async function () {
    if (!process.env.STAGE) {
        overrideEnvironment({ STAGE: 'dev' });
    }

    // Use Docker MongoDB instead of MongoMemoryServer
    // Expects MongoDB to be running via docker-compose on localhost:27017
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/frigg-quo-test';
    process.env.MONGO_URI = mongoUri;

    console.log('Using Docker MongoDB for tests:', mongoUri);
    console.log('Make sure MongoDB is running: npm run docker:start');
};
