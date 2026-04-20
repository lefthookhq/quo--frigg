/**
 * Track an analytics event to Quo's analytics API.
 * Errors are logged but never thrown. Aborts after ANALYTICS_TIMEOUT_MS to prevent
 * a slow/down analytics endpoint from blocking Lambda execution.
 */
const ANALYTICS_TIMEOUT_MS = 5_000;

async function trackAnalyticsEvent(integration, event, data = {}) {
    const integrationName = integration.constructor.Definition.name;

    if (!integration?.quo?.api || !integration?.commands) {
        console.warn(
            `[Analytics][${integrationName}] Quo API or commands not available, skipping tracking`
        );
        return;
    }

    try {
        const quoModuleName =
            integration.constructor.Definition.modules.quo.definition.getName();

        const quoEntity = await integration.commands.findEntity({
            userId: integration.userId,
            moduleName: quoModuleName,
        });

        if (!quoEntity) {
            console.warn(
                `[Analytics][${integrationName}] No Quo entity found for user ${integration.userId}, skipping tracking`
            );
            return;
        }

        const user = await integration.commands.findOrganizationUserById(
            integration.userId
        );

        const analyticsCall = integration.quo.api.sendAnalyticsEvent({
            orgId: user?.appOrgId || null,
            userId: quoEntity.externalId || null,
            integration: integrationName,
            event,
            data,
        });

        // Swallow late rejections if the timeout wins the race
        analyticsCall.catch(() => {});

        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(
                () => reject(new Error('Analytics request timed out')),
                ANALYTICS_TIMEOUT_MS
            );
        });

        try {
            await Promise.race([analyticsCall, timeout]);
        } finally {
            clearTimeout(timer);
        }

        console.log(`[Analytics][${integrationName}] Tracked ${event}`);
    } catch (error) {
        const msg = error?.message?.includes('timed out')
            ? `timed out after ${ANALYTICS_TIMEOUT_MS}ms`
            : error?.message || String(error);
        console.warn(
            `[Analytics][${integrationName}] Failed to track ${event}: ${msg}`
        );
    }
}

module.exports = {
    trackAnalyticsEvent,
};
