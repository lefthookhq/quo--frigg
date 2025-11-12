#!/usr/bin/env node
/**
 * Direct Quo API Testing Script
 * 
 * Tests bulk contact creation and individual contact operations
 * Usage: node test-quo-api.js <API_KEY> [operation]
 * 
 * Operations:
 *   bulk-create    - Test bulk contact creation (default)
 *   list-contacts  - List existing contacts
 *   single-create  - Create single contact
 *   create-duplicate - Create contact with duplicate phone number
 */

const https = require('https');

const API_KEY = process.argv[2];
const OPERATION = process.argv[3] || 'bulk-create';
const USE_DEV = process.env.USE_DEV === 'true' || process.argv.includes('--dev');
const BASE_URL = USE_DEV ? 'https://dev-public-api.openphone.dev/v1' : 'https://api.openphone.com/v1';

if (!API_KEY) {
    console.error('Usage: node test-quo-api.js <API_KEY> [operation]');
    console.error('Operations: bulk-create, list-contacts, single-create, create-duplicate, duplicate-externalid, test-webhooks, test-webhook-v2');
    process.exit(1);
}

function makeRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const hostname = USE_DEV ? 'dev-public-api.openphone.dev' : 'api.openphone.com';
        // If path starts with /v2, use it as-is, otherwise prepend /v1
        const fullPath = path.startsWith('/v2') ? path : `/v1${path}`;
        const options = {
            hostname: hostname,
            port: 443,
            path: fullPath,
            method: method,
            headers: {
                'Authorization': API_KEY,
                'Content-Type': 'application/json',
            },
        };

        if (body) {
            const bodyStr = JSON.stringify(body);
            options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
        }

        const baseUrlWithoutVersion = USE_DEV ? 'https://dev-public-api.openphone.dev' : 'https://api.openphone.com';
        console.log(`\n📤 ${method} ${baseUrlWithoutVersion}${fullPath}`);
        if (body) {
            console.log('📦 Request Body:', JSON.stringify(body, null, 2));
        }

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                console.log(`📥 Status: ${res.statusCode} ${res.statusMessage}`);
                console.log('📥 Headers:', JSON.stringify(res.headers, null, 2));

                if (data) {
                    try {
                        const parsed = JSON.parse(data);
                        console.log('📥 Response Body:', JSON.stringify(parsed, null, 2));
                        resolve({ status: res.statusCode, data: parsed, headers: res.headers });
                    } catch (e) {
                        console.log('📥 Response Body (raw):', data);
                        resolve({ status: res.statusCode, data: data, headers: res.headers });
                    }
                } else {
                    console.log('📥 Response Body: (empty)');
                    resolve({ status: res.statusCode, data: null, headers: res.headers });
                }
            });
        });

        req.on('error', (error) => {
            console.error('❌ Request failed:', error);
            reject(error);
        });

        if (body) {
            req.write(JSON.stringify(body));
        }

        req.end();
    });
}

async function testBulkCreate() {
    console.log('\n🧪 Testing Bulk Contact Creation\n');

    const timestamp = Date.now();
    const contacts = [
        {
            externalId: `test-attio-${timestamp}-1`,
            source: 'attio',
            defaultFields: {
                firstName: 'Test',
                lastName: 'Contact One',
                company: 'Acme Corp',
                role: 'CEO',
                phoneNumbers: [{ name: 'phone', value: '+16045550001' }],
                emails: [{ name: 'email', value: `test1-${timestamp}@example.com` }],
            },
            customFields: [],
        },
        {
            externalId: `test-attio-${timestamp}-2`,
            source: 'attio',
            defaultFields: {
                firstName: 'Test',
                lastName: 'Contact Two',
                company: 'Beta Inc',
                role: 'CTO',
                phoneNumbers: [{ name: 'phone', value: '+16045550002' }],
                emails: [{ name: 'email', value: `test2-${timestamp}@example.com` }],
            },
            customFields: [],
        },
    ];

    const result = await makeRequest('POST', '/contacts/bulk', { contacts });

    console.log('\n✅ Bulk create completed');
    return result;
}

async function listContacts() {
    console.log('\n🧪 Listing Contacts\n');
    const result = await makeRequest('GET', '/contacts?maxResults=10');
    console.log('\n✅ List contacts completed');
    return result;
}

async function testSingleCreate() {
    console.log('\n🧪 Testing Single Contact Creation\n');

    const timestamp = Date.now();
    const contact = {
        externalId: `test-attio-single-${timestamp}`,
        source: 'attio',
        defaultFields: {
            firstName: 'Single',
            lastName: 'Test Contact',
            company: 'Test Co',
            phoneNumbers: [{ name: 'phone', value: '+16045559999' }],
            emails: [{ name: 'email', value: `single-${timestamp}@example.com` }],
        },
        customFields: [],
    };

    const result = await makeRequest('POST', '/contacts', contact);
    console.log('\n✅ Single create completed');
    return result;
}

async function testDuplicatePhone() {
    console.log('\n🧪 Testing Duplicate Phone Number Creation\n');

    const sharedPhone = '+16045550123';
    const timestamp = Date.now();

    // Create first contact
    console.log('\n--- Creating Contact 1 with phone', sharedPhone);
    const contact1 = {
        externalId: `test-dup-${timestamp}-A`,
        source: 'attio',
        defaultFields: {
            firstName: 'Duplicate',
            lastName: 'Test A',
            phoneNumbers: [{ name: 'phone', value: sharedPhone }],
        },
        customFields: [],
    };
    const result1 = await makeRequest('POST', '/contacts', contact1);

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Create second contact with same phone
    console.log('\n--- Creating Contact 2 with SAME phone', sharedPhone);
    const contact2 = {
        externalId: `test-dup-${timestamp}-B`,
        source: 'attio',
        defaultFields: {
            firstName: 'Duplicate',
            lastName: 'Test B',
            phoneNumbers: [{ name: 'phone', value: sharedPhone }],
        },
        customFields: [],
    };
    const result2 = await makeRequest('POST', '/contacts', contact2);

    console.log('\n✅ Duplicate phone test completed');
    console.log('Result 1:', result1.status === 201 ? '✅ Created' : `❌ ${result1.status}`);
    console.log('Result 2:', result2.status === 201 ? '✅ Created' : `❌ ${result2.status}`);

    return { result1, result2 };
}

async function testDuplicateExternalId() {
    console.log('\n🧪 Testing Duplicate externalId Creation\n');

    const sharedExternalId = `test-dup-external-${Date.now()}`;

    // Create first contact
    console.log('\n--- Creating Contact 1 with externalId', sharedExternalId);
    const contact1 = {
        externalId: sharedExternalId,
        source: 'attio',
        defaultFields: {
            firstName: 'ExternalId',
            lastName: 'Test A',
            phoneNumbers: [{ name: 'phone', value: '+16045550201' }],
        },
        customFields: [],
    };
    const result1 = await makeRequest('POST', '/contacts', contact1);

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Create second contact with SAME externalId but different phone
    console.log('\n--- Creating Contact 2 with SAME externalId', sharedExternalId);
    const contact2 = {
        externalId: sharedExternalId,  // SAME externalId
        source: 'attio',
        defaultFields: {
            firstName: 'ExternalId',
            lastName: 'Test B',
            phoneNumbers: [{ name: 'phone', value: '+16045550202' }],  // Different phone
        },
        customFields: [],
    };
    const result2 = await makeRequest('POST', '/contacts', contact2);

    console.log('\n✅ Duplicate externalId test completed');
    console.log('Result 1:', result1.status === 201 ? '✅ Created' : `❌ ${result1.status}`);
    console.log('Result 2:', result2.status === 409 ? '🔴 409 Conflict (expected)' : result2.status === 201 ? '⚠️  Created (unexpected)' : `❌ ${result2.status}`);

    if (result2.status === 409) {
        console.log('\n🎯 CONFIRMED: Duplicate externalId causes 409 Conflict!');
    }

    return { result1, result2 };
}

async function testWebhookEndpoints() {
    console.log('\n🧪 Testing Webhook Endpoints (v1 vs v2)\n');

    const results = {
        v1: {},
        v2: {}
    };

    // Test v1 endpoints
    console.log('\n--- Testing v1 webhook endpoints ---');
    try {
        console.log('GET /v1/webhooks');
        results.v1.webhooks = await makeRequest('GET', '/webhooks');
    } catch (e) {
        results.v1.webhooks = { error: e.message };
    }

    try {
        console.log('\nGET /v1/webhooks/messages');
        results.v1.messages = await makeRequest('GET', '/webhooks/messages');
    } catch (e) {
        results.v1.messages = { error: e.message };
    }

    try {
        console.log('\nGET /v1/webhooks/calls');
        results.v1.calls = await makeRequest('GET', '/webhooks/calls');
    } catch (e) {
        results.v1.calls = { error: e.message };
    }

    // Test v2 endpoints
    console.log('\n\n--- Testing v2 webhook endpoints ---');
    try {
        console.log('GET /v2/webhooks');
        results.v2.webhooks = await makeRequest('GET', '/v2/webhooks');
    } catch (e) {
        results.v2.webhooks = { error: e.message };
    }

    try {
        console.log('\nGET /v2/webhooks/messages');
        results.v2.messages = await makeRequest('GET', '/v2/webhooks/messages');
    } catch (e) {
        results.v2.messages = { error: e.message };
    }

    try {
        console.log('\nGET /v2/webhooks/calls');
        results.v2.calls = await makeRequest('GET', '/v2/webhooks/calls');
    } catch (e) {
        results.v2.calls = { error: e.message };
    }

    // Summary
    console.log('\n\n📊 Summary:');
    console.log('v1/webhooks:', results.v1.webhooks.status === 200 ? '✅ Works' : `❌ ${results.v1.webhooks.status || 'Error'}`);
    console.log('v1/webhooks/messages:', results.v1.messages.status === 200 ? '✅ Works' : `❌ ${results.v1.messages.status || 'Error'}`);
    console.log('v1/webhooks/calls:', results.v1.calls.status === 200 ? '✅ Works' : `❌ ${results.v1.calls.status || 'Error'}`);
    console.log('');
    console.log('v2/webhooks:', results.v2.webhooks.status === 200 ? '✅ Works' : `❌ ${results.v2.webhooks.status || 'Error'}`);
    console.log('v2/webhooks/messages:', results.v2.messages.status === 200 ? '✅ Works' : `❌ ${results.v2.messages.status || 'Error'}`);
    console.log('v2/webhooks/calls:', results.v2.calls.status === 200 ? '✅ Works' : `❌ ${results.v2.calls.status || 'Error'}`);

    return results;
}

async function testWebhookV2CreateDelete() {
    console.log('\n🧪 Testing v2 Webhook Create & Delete\n');

    let createdWebhookId = null;

    try {
        // Step 1: Create webhook on v2
        console.log('--- Step 1: Creating webhook on v2 endpoint ---');
        const webhookPayload = {
            url: 'https://test-webhook-endpoint.example.com/test',
            events: ['message.received', 'message.delivered'],
            label: 'Test Webhook v2',
            status: 'enabled'
        };

        const createResult = await makeRequest('POST', '/v2/webhooks', webhookPayload);

        if (createResult.status === 201 && createResult.data?.id) {
            createdWebhookId = createResult.data.id;
            console.log(`\n✅ Webhook created successfully!`);
            console.log(`   ID: ${createdWebhookId}`);
            console.log(`   URL: ${createResult.data.url}`);
            console.log(`   Status: ${createResult.data.status}`);
        } else {
            console.log(`\n❌ Webhook creation failed`);
            console.log(`   Status: ${createResult.status}`);
            return { success: false, step: 'create', result: createResult };
        }

        // Step 2: Verify webhook exists
        console.log('\n--- Step 2: Verifying webhook exists ---');
        const listResult = await makeRequest('GET', '/v2/webhooks');

        if (listResult.status === 200) {
            const webhook = listResult.data?.data?.find(w => w.id === createdWebhookId);
            if (webhook) {
                console.log(`\n✅ Webhook found in list`);
            } else {
                console.log(`\n⚠️  Webhook not found in list (may be async)`);
            }
        }

        // Step 3: Delete webhook
        console.log('\n--- Step 3: Deleting webhook ---');
        const deleteResult = await makeRequest('DELETE', `/v2/webhooks/${createdWebhookId}`);

        if (deleteResult.status === 204 || deleteResult.status === 200) {
            console.log(`\n✅ Webhook deleted successfully!`);
        } else {
            console.log(`\n❌ Webhook deletion failed`);
            console.log(`   Status: ${deleteResult.status}`);
        }

        // Step 4: Verify deletion
        console.log('\n--- Step 4: Verifying deletion ---');
        const verifyResult = await makeRequest('GET', '/v2/webhooks');

        if (verifyResult.status === 200) {
            const webhook = verifyResult.data?.data?.find(w => w.id === createdWebhookId);
            if (!webhook) {
                console.log(`\n✅ Webhook successfully removed from list`);
            } else {
                console.log(`\n⚠️  Webhook still in list (may be soft delete)`);
            }
        }

        console.log('\n🎯 Result: v2 webhook endpoints WORK!');
        return { success: true };

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);

        // Cleanup: Try to delete webhook if it was created
        if (createdWebhookId) {
            console.log('\n🧹 Attempting cleanup...');
            try {
                await makeRequest('DELETE', `/v2/webhooks/${createdWebhookId}`);
                console.log('✅ Cleanup successful');
            } catch (cleanupError) {
                console.error('⚠️  Cleanup failed:', cleanupError.message);
                console.error(`⚠️  Manual cleanup needed: DELETE /v2/webhooks/${createdWebhookId}`);
            }
        }

        return { success: false, error: error.message };
    }
}

// Main execution
(async () => {
    try {
        console.log('🚀 Quo API Testing Script');
        console.log('Environment:', USE_DEV ? 'DEV (dev-public-api.openphone.dev)' : 'PRODUCTION (api.openphone.com)');
        console.log('API Key:', API_KEY.substring(0, 10) + '...');
        console.log('Operation:', OPERATION);

        switch (OPERATION) {
            case 'bulk-create':
                await testBulkCreate();
                break;
            case 'list-contacts':
                await listContacts();
                break;
            case 'single-create':
                await testSingleCreate();
                break;
            case 'create-duplicate':
                await testDuplicatePhone();
                break;
            case 'duplicate-externalid':
                await testDuplicateExternalId();
                break;
            case 'test-webhooks':
                await testWebhookEndpoints();
                break;
            case 'test-webhook-v2':
                await testWebhookV2CreateDelete();
                break;
            default:
                console.error('Unknown operation:', OPERATION);
                process.exit(1);
        }

        console.log('\n✨ Test completed successfully\n');
    } catch (error) {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    }
})();

