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

module.exports = {
    QUO_ANALYTICS_EVENTS,
};
