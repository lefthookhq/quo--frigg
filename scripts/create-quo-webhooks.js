#!/usr/bin/env node
/**
 * Script to create Quo webhook subscriptions for call and message events
 *
 * Usage: node scripts/create-quo-webhooks.js
 */

const { Api } = require('../backend/src/api-modules/quo/api');

// Configuration
const API_KEY = 'bhCMAoOOb7XQRYmF7gWMYgQZRk3YUNhi';
const WEBHOOK_URL = 'https://webhook.site/5b15ea91-bc99-47da-b0c4-2df2c17ad7be';
const BASE_URL = 'https://dev-public-api.openphone.dev';

// Event types for each webhook
const CALL_EVENTS = [
    'call.completed',
    'call.ringing',
    'call.recording.completed'
];

const CALL_SUMMARY_EVENTS = [
    'call.summary.completed'
];

const MESSAGE_EVENTS = [
    'message.received',
    'message.delivered'
];

async function createWebhooks() {
    // Initialize API client
    const api = new Api({
        api_key: API_KEY,
        baseUrl: BASE_URL
    });

    console.log('Creating Quo webhook subscriptions...\n');
    console.log(`Webhook URL: ${WEBHOOK_URL}\n`);

    const results = [];

    try {
        // Create call webhooks (one for all call events)
        console.log('Creating call webhook subscription...');
        console.log(`Events: ${CALL_EVENTS.join(', ')}`);

        const callWebhookResult = await api.createCallWebhook({
            url: WEBHOOK_URL,
            events: CALL_EVENTS,
            resourceIds: ['*'], // Subscribe to all phone numbers
        });

        console.log('✓ Call webhook created successfully');
        console.log(`  ID: ${callWebhookResult.data?.id || 'N/A'}`);
        results.push({ type: 'call', success: true, data: callWebhookResult });
        console.log('');

    } catch (error) {
        console.error('✗ Failed to create call webhook');
        console.error(`  Error: ${error.message}`);
        if (error.response?.data) {
            console.error(`  Details: ${JSON.stringify(error.response.data, null, 2)}`);
        }
        results.push({ type: 'call', success: false, error: error.message });
        console.log('');
    }

    try {
        // Create call summary webhook
        console.log('Creating call summary webhook subscription...');
        console.log(`Events: ${CALL_SUMMARY_EVENTS.join(', ')}`);

        const callSummaryWebhookResult = await api.createCallSummaryWebhook({
            url: WEBHOOK_URL,
            events: CALL_SUMMARY_EVENTS,
            resourceIds: ['*'], // Subscribe to all phone numbers
        });

        console.log('✓ Call summary webhook created successfully');
        console.log(`  ID: ${callSummaryWebhookResult.data?.id || 'N/A'}`);
        results.push({ type: 'call-summary', success: true, data: callSummaryWebhookResult });
        console.log('');

    } catch (error) {
        console.error('✗ Failed to create call summary webhook');
        console.error(`  Error: ${error.message}`);
        if (error.response?.data) {
            console.error(`  Details: ${JSON.stringify(error.response.data, null, 2)}`);
        }
        results.push({ type: 'call-summary', success: false, error: error.message });
        console.log('');
    }

    try {
        // Create message webhooks (one for all message events)
        console.log('Creating message webhook subscription...');
        console.log(`Events: ${MESSAGE_EVENTS.join(', ')}`);

        const messageWebhookResult = await api.createMessageWebhook({
            url: WEBHOOK_URL,
            events: MESSAGE_EVENTS,
            resourceIds: ['*'], // Subscribe to all phone numbers
            status: 'enabled',
        });

        console.log('✓ Message webhook created successfully');
        console.log(`  ID: ${messageWebhookResult.data?.id || 'N/A'}`);
        results.push({ type: 'message', success: true, data: messageWebhookResult });
        console.log('');

    } catch (error) {
        console.error('✗ Failed to create message webhook');
        console.error(`  Error: ${error.message}`);
        if (error.response?.data) {
            console.error(`  Details: ${JSON.stringify(error.response.data, null, 2)}`);
        }
        results.push({ type: 'message', success: false, error: error.message });
        console.log('');
    }

    // Summary
    console.log('='.repeat(60));
    console.log('Summary:');
    console.log('='.repeat(60));

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log(`Total webhooks attempted: ${results.length}`);
    console.log(`Successful: ${successful}`);
    console.log(`Failed: ${failed}`);

    if (successful > 0) {
        console.log('\nWebhook IDs created:');
        results.filter(r => r.success).forEach(r => {
            console.log(`  ${r.type}: ${r.data.data?.id || 'N/A'}`);
        });
    }

    // Exit with appropriate code
    process.exit(failed > 0 ? 1 : 0);
}

// Run the script
createWebhooks().catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
});
