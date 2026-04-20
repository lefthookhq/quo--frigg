/**
 * QueuerUtilWrapper
 *
 * ⚠️ TEMPORARY WORKAROUND - SCHEDULED FOR REMOVAL ⚠️
 *
 * This wrapper exists ONLY to support delayed message delivery to work around
 * Quo API's key validation propagation delay (~30-35 seconds). When integrations
 * are created, webhook setup must be delayed to allow Quo's systems to propagate
 * the API key before we attempt to create webhooks.
 *
 * **This will be removed once Quo resolves their API key propagation delay.**
 *
 * Technical Implementation:
 * - Wraps @friggframework/core QueuerUtil to add SQS DelaySeconds support
 * - Extracts `delaySeconds` from message data and applies it as SQS parameter
 * - Without this, delays would be in message body (no actual delay occurs)
 * - With this, SQS holds the message for X seconds before Lambda receives it
 *
 * Design Philosophy (Hexagonal Architecture / Adapter Pattern):
 * - Wraps external infrastructure concern (SQS) with domain-appropriate interface
 * - Maintains backward compatibility with existing QueuerUtil API
 * - Separates infrastructure concerns (SQS DelaySeconds) from domain logic
 *
 * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-sqs/interfaces/sendmessagebatchcommandinput.html
 * @todo Remove this wrapper once Quo API key propagation is instant
 */

const { v4: uuid } = require('uuid');
const {
    SQSClient,
    SendMessageCommand,
    SendMessageBatchCommand,
} = require('@aws-sdk/client-sqs');

const awsConfigOptions = () => {
    const config = {};
    if (process.env.IS_OFFLINE) {
        console.log('Running in offline mode');
        config.credentials = {
            accessKeyId: 'test-aws-key',
            secretAccessKey: 'test-aws-secret',
        };
        config.region = 'us-east-1';
    }
    if (process.env.AWS_ENDPOINT) {
        config.endpoint = process.env.AWS_ENDPOINT;
    }
    return config;
};

const sqs = new SQSClient(awsConfigOptions());

// Best-effort extraction of the logical event/processId/integrationId from a
// JSON SQS message body. Used only for log correlation — never throws.
const summarizeMessageBody = (bodyStr) => {
    try {
        const parsed = JSON.parse(bodyStr);
        return {
            event: parsed?.event,
            processId: parsed?.data?.processId,
            integrationId: parsed?.data?.integrationId,
        };
    } catch {
        return {};
    }
};

// Inspect SendMessageBatchResult for partial failures and log them.
//
// AWS SendMessageBatch can succeed at the HTTP level (2xx) while rejecting
// individual entries — KMS errors, per-entry throttling, service errors. Callers
// that don't inspect `result.Failed` silently lose those messages. This was a
// real production incident in this codebase: cursor=800 FETCH_PERSON_PAGE
// messages disappeared with no DLQ, no Lambda invocation, no trace. The Frigg
// framework's queuer-util has the same gap upstream (observability logs added
// in frigg PR #578) — this mirror makes sure the local wrapper is equally loud.
const inspectBatchResult = (result, queueUrl, buffer) => {
    const bufferSize = buffer.length;
    const failedCount = result?.Failed?.length ?? 0;
    const successCount = result?.Successful?.length ?? 0;

    const bufferById = new Map(buffer.map((b) => [b.Id, b]));

    if (failedCount > 0) {
        console.error(
            `[QueuerUtilWrapper] SendMessageBatch partial failure: ${failedCount}/${bufferSize} failed`,
            {
                queueUrl,
                bufferSize,
                successCount,
                failedCount,
                failed: result.Failed.map((f) => {
                    const bufEntry = bufferById.get(f.Id);
                    const summary = bufEntry
                        ? summarizeMessageBody(bufEntry.MessageBody)
                        : {};
                    return {
                        Id: f.Id,
                        Code: f.Code,
                        SenderFault: f.SenderFault,
                        Message: f.Message,
                        ...summary,
                    };
                }),
            },
        );
    } else if (successCount > 0) {
        const entries = result.Successful.map((s) => {
            const bufEntry = bufferById.get(s.Id);
            const summary = bufEntry
                ? summarizeMessageBody(bufEntry.MessageBody)
                : {};
            return { MessageId: s.MessageId, ...summary };
        });
        console.log(
            `[QueuerUtilWrapper] SendMessageBatch ok: ${successCount}/${bufferSize} to ${queueUrl}`,
            { entries },
        );
    }

    return result;
};

/**
 * Enhanced QueuerUtil with delay support
 *
 * API-compatible with @friggframework/core QueuerUtil but adds support
 * for message delays through the `delaySeconds` property on message entries.
 */
const QueuerUtilWrapper = {
    /**
     * Send a single message to SQS queue
     * @param {Object} message - Message to send
     * @param {string} queueUrl - SQS queue URL
     * @param {number} [delaySeconds] - Optional delay in seconds (0-900)
     * @returns {Promise<Object>} SQS response
     */
    send: async (message, queueUrl, delaySeconds) => {
        console.log(`Enqueuing message to SQS queue ${queueUrl}`);

        const params = {
            MessageBody: JSON.stringify(message),
            QueueUrl: queueUrl,
        };

        // Add delay if specified (0-900 seconds for SQS)
        if (delaySeconds !== undefined && delaySeconds !== null) {
            params.DelaySeconds = delaySeconds;
        }

        const command = new SendMessageCommand(params);
        const result = await sqs.send(command);
        console.log(
            `[QueuerUtilWrapper] SendMessage ok: MessageId=${result?.MessageId} to ${queueUrl}`,
        );
        return result;
    },

    /**
     * Send multiple messages to SQS queue in batches
     * Enhanced to support per-message delays via `delaySeconds` property
     *
     * @param {Array<Object>} entries - Array of message entries
     * @param {string} entries[].event - Event type
     * @param {Object} entries[].data - Event data
     * @param {number} [entries[].delaySeconds] - Optional delay for this message (0-900)
     * @param {string} queueUrl - SQS queue URL
     * @returns {Promise<Object>} SQS response
     *
     * @example
     * await batchSend([
     *   { event: 'IMMEDIATE', data: { id: 1 } },
     *   { event: 'DELAYED', data: { id: 2 }, delaySeconds: 30 }
     * ], queueUrl);
     */
    batchSend: async (entries = [], queueUrl) => {
        console.log(
            `Enqueuing ${entries.length} entries on SQS to queue ${queueUrl}`,
        );
        const buffer = [];
        const batchSize = 10;

        for (const entry of entries) {
            // Extract delaySeconds if present (infrastructure concern)
            const { delaySeconds, ...messageContent } = entry;

            // Build SQS batch entry
            const sqsEntry = {
                Id: uuid(),
                MessageBody: JSON.stringify(messageContent),
            };

            // Add delay if specified (SQS infrastructure parameter)
            // Each message in a batch can have its own delay
            if (delaySeconds !== undefined && delaySeconds !== null) {
                sqsEntry.DelaySeconds = delaySeconds;
            }

            buffer.push(sqsEntry);

            // Send batch when buffer reaches SQS limit (10 messages)
            if (buffer.length === batchSize) {
                console.log('Buffer at 10, sending batch');
                const command = new SendMessageBatchCommand({
                    Entries: buffer,
                    QueueUrl: queueUrl,
                });
                const result = await sqs.send(command);
                inspectBatchResult(result, queueUrl, buffer);
                // Clear buffer after successful send
                buffer.splice(0, buffer.length);
            }
        }

        console.log('Buffer at end, sending final batch');

        // Send any remaining entries (< 10)
        if (buffer.length > 0) {
            console.log(buffer);
            const command = new SendMessageBatchCommand({
                Entries: buffer,
                QueueUrl: queueUrl,
            });
            const result = await sqs.send(command);
            return inspectBatchResult(result, queueUrl, buffer);
        }

        // No messages to send
        return {};
    },
};

module.exports = { QueuerUtilWrapper };
