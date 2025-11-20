#!/usr/bin/env node
/**
 * Test Quo API listContacts with externalIds array parameter
 * Tests the correct query string format: externalIds[]=id1&externalIds[]=id2
 */

const https = require('https');

const API_KEY = process.argv[2];
const USE_DEV =
    process.env.USE_DEV === 'true' || process.argv.includes('--dev');

if (!API_KEY) {
    console.error('Usage: node test-list-contacts-array.js <API_KEY> [--dev]');
    process.exit(1);
}

// Test external IDs
const externalIds = [
    '0e77bdf3-2c4a-41be-801e-c1a47e8af171',
    '7893b79c-934a-45c4-8387-76fc2a6cb1ca',
    '7b679535-df74-4b03-8200-a32177c93563',
];

// Build query string with array notation
function buildQueryString(externalIds) {
    return externalIds
        .map((id) => `externalIds[]=${encodeURIComponent(id)}`)
        .join('&');
}

function makeRequest(queryString) {
    return new Promise((resolve, reject) => {
        const hostname = USE_DEV
            ? 'dev-public-api.openphone.dev'
            : 'api.openphone.com';
        const path = `/v1/contacts?${queryString}&maxResults=${externalIds.length}`;

        const options = {
            hostname: hostname,
            port: 443,
            path: path,
            method: 'GET',
            headers: {
                Authorization: API_KEY,
                'Content-Type': 'application/json',
            },
        };

        console.log(`\n📤 GET https://${hostname}${path}`);
        console.log(`Headers:`, JSON.stringify(options.headers, null, 2));

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                console.log(`\n📥 Response Status: ${res.statusCode}`);
                console.log(`Headers:`, JSON.stringify(res.headers, null, 2));

                try {
                    const parsed = JSON.parse(data);
                    console.log(
                        `\nResponse Body:`,
                        JSON.stringify(parsed, null, 2),
                    );
                    resolve(parsed);
                } catch (e) {
                    console.log(`\nRaw Response:`, data);
                    resolve(data);
                }
            });
        });

        req.on('error', (error) => {
            console.error(`\n❌ Request failed:`, error.message);
            reject(error);
        });

        req.end();
    });
}

async function testArrayFormat() {
    console.log('='.repeat(80));
    console.log('Testing externalIds Array Parameter Format');
    console.log('='.repeat(80));

    console.log(`\n📋 Testing with ${externalIds.length} external IDs:`);
    externalIds.forEach((id, i) => console.log(`   ${i + 1}. ${id}`));

    const queryString = buildQueryString(externalIds);
    console.log(`\n🔗 Query String: ${queryString}`);

    try {
        await makeRequest(queryString);
    } catch (error) {
        console.error('Test failed:', error);
        process.exit(1);
    }
}

// Also test single externalId for comparison
async function testSingleId() {
    console.log('\n' + '='.repeat(80));
    console.log('Testing Single externalId (for comparison)');
    console.log('='.repeat(80));

    const queryString = `externalIds[]=${encodeURIComponent(externalIds[0])}`;
    console.log(`\n🔗 Query String: ${queryString}`);

    try {
        await makeRequest(queryString);
    } catch (error) {
        console.error('Test failed:', error);
    }
}

async function run() {
    await testArrayFormat();
    await testSingleId();
}

run().catch(console.error);
