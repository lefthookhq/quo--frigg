/**
 * Track an analytics event to Quo's analytics API (fire-and-forget)
 *
 * This utility wraps the Quo API call to prevent analytics failures from blocking
 * business logic. All tracking is non-blocking and errors are logged but not thrown.
 *
 * The integration name is automatically derived from integration.constructor.Definition.name,
 * eliminating the need for manual string parameters and reducing copy-paste errors.
 *
 * @param {Object} integration - The integration instance
 * @param {Object} integration.constructor.Definition - Static Definition with name field
 * @param {string} integration.constructor.Definition.name - Integration name (e.g., 'attio')
 * @param {Object} integration.quo - Quo module with API instance
 * @param {Object} integration.quo.api - Quo API with sendAnalyticsEvent method
 * @param {Object} integration.commands - Commands object with findOrganizationUserById
 * @param {string} integration.userId - The user ID to look up
 * @param {string} event - Event type from QUO_ANALYTICS_EVENTS
 * @param {Object} [data={}] - Event-specific data (contactId, messageId, callId, error)
 * @returns {void}
 */
function trackAnalyticsEvent(integration, event, data = {}) {
    const integrationName = integration.constructor.Definition.name;

    if (!integration?.quo?.api || !integration?.commands) {
        console.warn(
            `[Analytics][${integrationName}] Quo API or commands not available, skipping tracking`,
        );
        return;
    }

    integration.commands
        .findOrganizationUserById(integration.userId)
        .then((user) => {
            if (!user) {
                console.warn(
                    `[Analytics][${integrationName}] User ${integration.userId} not found for analytics tracking`,
                );
            }

            return integration.quo.api.sendAnalyticsEvent({
                orgId: user?.appOrgId || null,
                userId: user?.id || null,
                integration: integrationName,
                event,
                data,
            });
        })
        .then(() => {
            console.log(`[Analytics][${integrationName}] ✓ Tracked ${event}`);
        })
        .catch((error) => {
            console.warn(
                `[Analytics][${integrationName}] Failed to track ${event}: ${error.message}`,
            );
        });
}

module.exports = {
    trackAnalyticsEvent,
};
