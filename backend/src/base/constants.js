/**
 * Quo Analytics Events
 * Event types supported by Quo's analytics API
 * Used by integrations to track sync operations, message/call logging, etc.
 */
const QUO_ANALYTICS_EVENTS = {
    CONTACT_IMPORT: 'ContactImport',
    CONTACT_UPDATED: 'ContactUpdated',
    CONTACT_DELETED: 'ContactDeleted',
    CONTACT_SYNC_FAILED: 'ContactSyncFailed',
    MESSAGE_LOGGED: 'MessageLogged',
    MESSAGE_LOG_FAILED: 'MessageLogFailed',
    CALL_LOGGED: 'CallLogged',
    CALL_LOG_FAILED: 'CallLogFailed',
};

/**
 * Quo Webhook Event Types
 * Single source of truth for all Quo/OpenPhone webhook events
 * Used by integrations for webhook subscription and event handling
 */
const QuoWebhookEvents = {
    // Message events
    MESSAGE_RECEIVED: 'message.received',
    MESSAGE_DELIVERED: 'message.delivered',

    // Call events
    CALL_COMPLETED: 'call.completed',
    CALL_RECORDING_COMPLETED: 'call.recording.completed',
    CALL_SUMMARY_COMPLETED: 'call.summary.completed',
};

/**
 * Get webhook key type for signature verification
 * @param {string} eventType - The webhook event type
 * @returns {'callSummary' | 'call' | 'message' | null}
 */
const getWebhookKeyType = (eventType) => {
    if (eventType.startsWith('call.summary')) return 'callSummary';
    if (eventType.startsWith('call.')) return 'call';
    if (eventType.startsWith('message.')) return 'message';
    return null;
};

module.exports = {
    QUO_ANALYTICS_EVENTS,
    QuoWebhookEvents,
    getWebhookKeyType,
};
