/**
 * Request Logger Utility
 *
 * Logs appOrgId and appUserId on every request for easier log parsing
 * Extracts context from integration instance, request headers, and user repository
 */

/**
 * Extract user context from integration instance
 *
 * @param {Object} integration - Integration instance (AttioIntegration, etc.)
 * @returns {Object} User context with appOrgId and appUserId
 */
function extractUserContext(integration) {
    const context = {
        integrationId: null,
        userId: null,
        appOrgId: null,
        appUserId: null,
    };

    // Extract integration ID
    if (integration?.id) {
        context.integrationId = integration.id;
    }

    // Extract userId (Frigg internal user ID)
    if (integration?.userId) {
        context.userId = integration.userId;
    }

    // Try to extract appOrgId from entity
    // Frigg entities can have custom fields including appOrgId
    if (integration?.entity?.appOrgId) {
        context.appOrgId = integration.entity.appOrgId;
    }

    // Try to extract appUserId from user record
    if (integration?.user?.appUserId) {
        context.appUserId = integration.user.appUserId;
    } else if (integration?.userId) {
        // Fallback: use Frigg userId if appUserId not available
        context.appUserId = integration.userId;
    }

    return context;
}

/**
 * Extract user context from request headers
 * Useful for webhook handlers that receive user context via headers
 *
 * @param {Object} headers - HTTP request headers
 * @returns {Object} User context from headers
 */
function extractUserContextFromHeaders(headers) {
    const context = {
        appOrgId: null,
        appUserId: null,
    };

    if (headers['x-frigg-apporgid']) {
        context.appOrgId = headers['x-frigg-apporgid'];
    }

    if (headers['x-frigg-appuserid']) {
        context.appUserId = headers['x-frigg-appuserid'];
    }

    return context;
}

/**
 * Log request with user context
 *
 * @param {string} message - Log message
 * @param {Object} integration - Integration instance
 * @param {Object} additionalData - Additional data to log
 */
function logWithUserContext(message, integration, additionalData = {}) {
    const userContext = extractUserContext(integration);

    const logData = {
        timestamp: new Date().toISOString(),
        message,
        context: userContext,
        ...additionalData,
    };

    // Format log output
    const contextStr = [
        userContext.appOrgId && `appOrgId=${userContext.appOrgId}`,
        userContext.appUserId && `appUserId=${userContext.appUserId}`,
        userContext.integrationId && `integrationId=${userContext.integrationId}`,
    ]
        .filter(Boolean)
        .join(' ');

    console.log(`[${contextStr}] ${message}`, additionalData);

    return logData;
}

/**
 * Log webhook event with user context
 *
 * @param {string} webhookType - Type of webhook (e.g., 'call.completed')
 * @param {Object} integration - Integration instance
 * @param {Object} webhookData - Webhook payload
 * @param {Object} headers - Optional request headers
 */
function logWebhook(webhookType, integration, webhookData, headers = {}) {
    const userContext = extractUserContext(integration);
    const headerContext = extractUserContextFromHeaders(headers);

    // Merge contexts (headers take precedence if available)
    const finalContext = {
        ...userContext,
        appOrgId: headerContext.appOrgId || userContext.appOrgId,
        appUserId: headerContext.appUserId || userContext.appUserId,
    };

    const contextStr = [
        finalContext.appOrgId && `appOrgId=${finalContext.appOrgId}`,
        finalContext.appUserId && `appUserId=${finalContext.appUserId}`,
        finalContext.integrationId && `integrationId=${finalContext.integrationId}`,
    ]
        .filter(Boolean)
        .join(' ');

    console.log(
        `[${contextStr}] Webhook: ${webhookType}`,
        {
            webhookId: webhookData.id,
            eventType: webhookData.type,
            createdAt: webhookData.createdAt,
        },
    );

    return finalContext;
}

/**
 * Log API call with user context
 *
 * @param {string} apiMethod - API method name (e.g., 'getCall')
 * @param {Object} integration - Integration instance
 * @param {Object} params - API call parameters
 */
function logApiCall(apiMethod, integration, params = {}) {
    return logWithUserContext(`API Call: ${apiMethod}`, integration, { params });
}

module.exports = {
    extractUserContext,
    extractUserContextFromHeaders,
    logWithUserContext,
    logWebhook,
    logApiCall,
};
