#!/usr/bin/env node
/**
 * Manually trigger REFRESH_WEBHOOK event for local testing.
 *
 * This simulates what EventBridge Scheduler would do in production:
 * sends a message to the SQS queue that triggers the queue worker.
 *
 * Usage:
 *   node scripts/trigger-refresh-webhook.js <integrationId>
 *   node scripts/trigger-refresh-webhook.js 7
 *
 * Environment variables:
 *   ZOHO_QUEUE_URL - Queue URL (defaults to LocalStack URL)
 *   AWS_ENDPOINT   - AWS endpoint (defaults to http://localhost:4566)
 */

const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');

const integrationId = process.argv[2];

if (!integrationId) {
    console.error('Usage: node scripts/trigger-refresh-webhook.js <integrationId>');
    console.error('Example: node scripts/trigger-refresh-webhook.js 7');
    process.exit(1);
}

const awsEndpoint = process.env.AWS_ENDPOINT || 'http://localhost:4566';
const defaultQueueUrl = 'http://localhost.localstack.cloud:4566/000000000000/quo-integrations--dev-ZohoQueue';

const sqs = new SQSClient({
    region: 'us-east-1',
    endpoint: awsEndpoint,
    credentials: {
        accessKeyId: 'test-aws-key',
        secretAccessKey: 'test-aws-secret',
    },
});

const payload = {
    event: 'REFRESH_WEBHOOK',  // Note: worker expects 'event', not 'eventType'
    integrationName: 'zoho',
    data: {
        integrationId: integrationId,
        executionId: `manual-test-${Date.now()}`,
    },
    scheduledAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
};

function getQueueUrl() {
    return process.env.ZOHO_QUEUE_URL || defaultQueueUrl;
}

async function main() {
    console.log('=== REFRESH_WEBHOOK Manual Trigger ===\n');

    try {
        const queueUrl = getQueueUrl();
        console.log('Queue URL:', queueUrl);
        console.log('\nPayload:');
        console.log(JSON.stringify(payload, null, 2));
        console.log('');

        const command = new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify(payload),
        });

        const result = await sqs.send(command);
        console.log('✓ Message sent successfully!');
        console.log('  MessageId:', result.MessageId);
        console.log('\n📋 Next steps:');
        console.log('  1. If frigg is running (npm run frigg:start), the zohoQueueWorker should pick this up');
        console.log('  2. Watch the logs for "[Zoho CRM] Processing REFRESH_WEBHOOK"');
        console.log('  3. The _onRefreshWebhook handler will renew the Zoho notification channel');
    } catch (error) {
        console.error('\n✗ Failed:', error.message);
        console.error('\nTroubleshooting:');
        console.error('  1. Make sure LocalStack is running: npm run docker:start');
        console.error('  2. Make sure frigg server is running: npm run frigg:start');
        console.error('  3. Check AWS_ENDPOINT env var (default: http://localhost:4566)');
        process.exit(1);
    }
}

main();
