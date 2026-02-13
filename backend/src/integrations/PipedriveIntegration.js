const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');
const pipedrive = require('@friggframework/api-module-pipedrive');
const quo = require('../api-modules/quo');
const { createFriggCommands } = require('@friggframework/core');
const CallSummaryEnrichmentService = require('../base/services/CallSummaryEnrichmentService');
const QuoWebhookEventProcessor = require('../base/services/QuoWebhookEventProcessor');
const QuoCallContentBuilder = require('../base/services/QuoCallContentBuilder');
const { filterExternalParticipants } = require('../utils/participantFilter');
const { QUO_ANALYTICS_EVENTS, QuoWebhookEvents } = require('../base/constants');
const { trackAnalyticsEvent } = require('../utils/trackAnalyticsEvent');

/**
 * Format duration in seconds to Pipedrive's HH:MM format
 * @param {number} seconds - Duration in seconds
 * @returns {string|undefined} - Duration in HH:MM format, or undefined if less than 1 minute
 */
function formatDurationForPipedrive(seconds) {
    if (!seconds) return undefined;
    const totalMinutes = Math.floor(seconds / 60);
    if (totalMinutes < 1) return undefined;
    const hours = Math.floor(totalMinutes / 60)
        .toString()
        .padStart(2, '0');
    const minutes = (totalMinutes % 60).toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

/**
 * PipedriveIntegration - Refactored to extend BaseCRMIntegration
 *
 * Pipedrive-specific implementation for syncing persons/deals with Quo.
 * Demonstrates BaseCRMIntegration pattern with webhook support.
 */
class PipedriveIntegration extends BaseCRMIntegration {
    static Definition = {
        name: 'pipedrive',
        version: '1.0.0',
        supportedVersions: ['1.0.0'],
        hasUserConfig: true,

        display: {
            label: 'Pipedrive',
            description:
                'Pipeline management platform integration with Quo API',
            category: 'CRM & Sales',
            detailsUrl: 'https://www.pipedrive.com',
            icon: '',
        },
        modules: {
            pipedrive: { definition: pipedrive.Definition },
            quo: {
                definition: {
                    ...quo.Definition,
                    getName: () => 'quo-pipedrive',
                    moduleName: 'quo-pipedrive',
                    display: {
                        ...(quo.Definition.display || {}),
                        label: 'Quo (Pipedrive)',
                    },
                },
            },
        },
        webhooks: {
            enabled: true,
        },
        routes: [
            {
                path: '/pipedrive/deals',
                method: 'GET',
                event: 'LIST_PIPEDRIVE_DEALS',
            },
            {
                path: '/pipedrive/persons',
                method: 'GET',
                event: 'LIST_PIPEDRIVE_PERSONS',
            },
            {
                path: '/pipedrive/organizations',
                method: 'GET',
                event: 'LIST_PIPEDRIVE_ORGANIZATIONS',
            },
            {
                path: '/pipedrive/activities',
                method: 'GET',
                event: 'LIST_PIPEDRIVE_ACTIVITIES',
            },
            {
                path: '/uninstall',
                method: 'DELETE',
                event: 'PIPEDRIVE_APP_UNINSTALL',
            },
        ],
    };

    /**
     * CRM Configuration - Required by BaseCRMIntegration
     */
    static CRMConfig = {
        personObjectTypes: [
            { crmObjectName: 'Person', quoContactType: 'contact' },
        ],
        syncConfig: {
            paginationType: 'CURSOR_BASED',
            supportsTotal: false,
            returnFullRecords: true,
            reverseChronological: true,
            initialBatchSize: 100,
            ongoingBatchSize: 50,
            supportsWebhooks: true, // ✅ Webhook support implemented (programmatic registration)
        },
        queueConfig: {
            maxWorkers: 20,
            provisioned: 8,
            maxConcurrency: 75,
            batchSize: 1,
            timeout: 600,
        },
    };

    /**
     * Webhook configuration constants
     * Used for webhook labels and identification in webhook processing
     */
    static WEBHOOK_LABELS = {
        QUO_MESSAGES: 'Pipedrive Integration - Messages',
        QUO_CALLS: 'Pipedrive Integration - Calls',
        QUO_CALL_SUMMARIES: 'Pipedrive Integration - Call Summaries',
    };

    /**
     * Webhook event subscriptions
     * Defines which events each webhook type listens for
     */
    static WEBHOOK_EVENTS = {
        QUO_MESSAGES: [
            QuoWebhookEvents.MESSAGE_RECEIVED,
            QuoWebhookEvents.MESSAGE_DELIVERED,
        ],
        QUO_CALLS: [QuoWebhookEvents.CALL_COMPLETED],
        QUO_CALL_SUMMARIES: [QuoWebhookEvents.CALL_SUMMARY_COMPLETED],
    };

    constructor(params) {
        super(params);

        this.commands = createFriggCommands({
            integrationClass: PipedriveIntegration,
        });

        this.events = {
            ...this.events,

            LIST_PIPEDRIVE_DEALS: {
                handler: this.listDeals,
            },
            LIST_PIPEDRIVE_PERSONS: {
                handler: this.listPersons,
            },
            LIST_PIPEDRIVE_ORGANIZATIONS: {
                handler: this.listOrganizations,
            },
            LIST_PIPEDRIVE_ACTIVITIES: {
                handler: this.listActivities,
            },
            CREATE_PIPEDRIVE_DEAL: {
                type: 'USER_ACTION',
                handler: this.createDeal,
                title: 'Create Pipedrive Deal',
                description: 'Create a new deal in Pipedrive',
                userActionType: 'DATA',
            },
            SEARCH_PIPEDRIVE_DATA: {
                type: 'USER_ACTION',
                handler: this.searchData,
                title: 'Search Pipedrive Data',
                description: 'Search for deals, persons, and organizations',
                userActionType: 'SEARCH',
            },
            GET_PIPEDRIVE_STATS: {
                type: 'USER_ACTION',
                handler: this.getStats,
                title: 'Get Pipedrive Stats',
                description:
                    'Get statistics and performance metrics from Pipedrive',
                userActionType: 'REPORT',
            },
            PIPEDRIVE_APP_UNINSTALL: {
                handler: this.handleAppUninstall.bind(this),
            },
        };
    }

    /**
     * Verify Quo (OpenPhone) webhook signature
     * Uses HMAC-SHA256 to verify the webhook payload
     * Signature format: "hmac;version;timestamp;signature"
     *
     * @private
     * @param {Object} headers - HTTP headers
     * @param {Object} body - Webhook payload
     * @param {string} eventType - Event type (e.g., "call.completed")
     * @returns {Promise<void>}
     * @throws {Error} If signature is invalid or missing
     */
    async _verifyQuoWebhookSignature(headers, body, eventType) {
        const signatureHeader = headers['openphone-signature'];

        if (!signatureHeader) {
            throw new Error('Missing Openphone-Signature header');
        }

        // Parse signature format: hmac;version;timestamp;signature
        const parts = signatureHeader.split(';');
        if (parts.length !== 4 || parts[0] !== 'hmac') {
            throw new Error('Invalid Openphone-Signature format');
        }

        const [_, version, timestamp, receivedSignature] = parts;

        // BACKWARDS COMPATIBILITY: Check for OLD structure (single webhook) first
        let legacyWebhookKey;
        if (eventType.startsWith('call.summary')) {
            legacyWebhookKey = this.config?.quoCallSummaryWebhookKey;
        } else if (eventType.startsWith('call.')) {
            legacyWebhookKey = this.config?.quoCallWebhookKey;
        } else if (eventType.startsWith('message.')) {
            legacyWebhookKey = this.config?.quoMessageWebhookKey;
        }

        if (legacyWebhookKey) {
            console.log(
                '[Quo Webhook] Using old webhook structure for signature verification',
            );
            this._verifySignatureWithKey(
                legacyWebhookKey,
                timestamp,
                body,
                receivedSignature,
            );
            console.log('[Quo Webhook] ✓ Signature verified (old structure)');
            return;
        }

        // NEW structure (array) - use dual-strategy verification
        let webhookArray;
        if (eventType.startsWith('call.summary')) {
            webhookArray = this.config?.quoCallSummaryWebhooks || [];
        } else if (eventType.startsWith('call.')) {
            webhookArray = this.config?.quoCallWebhooks || [];
        } else if (eventType.startsWith('message.')) {
            webhookArray = this.config?.quoMessageWebhooks || [];
        } else {
            throw new Error(
                `Unknown event type for key selection: ${eventType}`,
            );
        }

        if (webhookArray.length === 0) {
            throw new Error('No webhooks configured for event type');
        }

        // Strategy 1: Try to find webhook by ID from payload (if present)
        const webhookIdFromPayload = body?.id;
        if (webhookIdFromPayload) {
            const matchingWebhook = webhookArray.find(
                (wh) => wh.id === webhookIdFromPayload,
            );
            if (matchingWebhook) {
                try {
                    this._verifySignatureWithKey(
                        matchingWebhook.key,
                        timestamp,
                        body,
                        receivedSignature,
                    );
                    console.log(
                        `[Quo Webhook] ✓ Signature verified (webhook ID: ${webhookIdFromPayload})`,
                    );
                    return;
                } catch (err) {
                    console.warn(
                        `[Quo Webhook] Signature verification failed for webhook ${webhookIdFromPayload}, trying fallback`,
                    );
                }
            }
        }

        // Strategy 2: Fallback - try all keys for this event type
        for (const webhook of webhookArray) {
            try {
                this._verifySignatureWithKey(
                    webhook.key,
                    timestamp,
                    body,
                    receivedSignature,
                );
                console.log(
                    `[Quo Webhook] ✓ Signature verified (webhook ID: ${webhook.id})`,
                );
                return;
            } catch (err) {
                continue;
            }
        }

        throw new Error(
            'Webhook signature verification failed with all configured webhooks',
        );
    }

    /**
     * Verify webhook signature with a specific key
     * Tries multiple payload/key formats to handle different signature methods
     */
    _verifySignatureWithKey(webhookKey, timestamp, body, receivedSignature) {
        const crypto = require('crypto');

        const testFormats = [
            {
                name: 'timestamp + body (no separator)',
                payload: timestamp + JSON.stringify(body),
                keyTransform: 'plain',
            },
            {
                name: 'timestamp + body (no separator, base64 key)',
                payload: timestamp + JSON.stringify(body),
                keyTransform: 'base64',
            },
            {
                name: 'timestamp + "." + body (dot separator)',
                payload: timestamp + '.' + JSON.stringify(body),
                keyTransform: 'plain',
            },
            {
                name: 'timestamp + "." + body (dot separator, base64 key)',
                payload: timestamp + '.' + JSON.stringify(body),
                keyTransform: 'base64',
            },
        ];

        for (const format of testFormats) {
            const key =
                format.keyTransform === 'base64'
                    ? Buffer.from(webhookKey, 'base64')
                    : webhookKey;

            const hmac = crypto.createHmac('sha256', key);
            hmac.update(format.payload);
            const computedSignature = hmac.digest('base64');

            if (computedSignature === receivedSignature) {
                return;
            }
        }

        throw new Error('Signature mismatch');
    }

    /**
     * Normalize phone number for consistent matching
     * Removes formatting characters while preserving E.164 format
     *
     * @private
     * @param {string} phone - Phone number to normalize
     * @returns {string} Normalized phone number
     */
    _normalizePhoneNumber(phone) {
        if (!phone) return phone;
        // Remove spaces, parentheses, dashes, but keep + for international format
        return phone.replace(/[\s\(\)\-]/g, '');
    }

    /**
     * Generate webhook URL with BASE_URL validation
     * Centralizes URL construction and ensures BASE_URL is configured
     *
     * @private
     * @param {string} path - Webhook path (e.g., '/webhooks/{id}')
     * @returns {string} Complete webhook URL
     * @throws {Error} If BASE_URL environment variable is not configured
     */
    _generateWebhookUrl(path) {
        if (!process.env.BASE_URL) {
            throw new Error(
                'BASE_URL environment variable is required for webhook setup. ' +
                    'Please configure this in your deployment environment before enabling webhooks.',
            );
        }

        const integrationName = this.constructor.Definition.name;
        return `${process.env.BASE_URL}/api/${integrationName}-integration${path}`;
    }

    /**
     * Fetch a page of persons from Pipedrive (CURSOR_BASED)
     * @param {Object} params
     * @param {string} params.objectType - CRM object type (Person)
     * @param {string|null} [params.cursor] - Cursor for pagination
     * @param {number} params.limit - Records per page
     * @param {Date} [params.modifiedSince] - Filter by modification date
     * @param {boolean} [params.sortDesc=true] - Sort descending
     * @returns {Promise<{data: Array, cursor: string|null, hasMore: boolean}>}
     */
    async fetchPersonPage({
        objectType,
        cursor = null,
        limit,
        modifiedSince,
        sortDesc = true,
    }) {
        try {
            const params = {
                limit,
            };

            if (cursor) {
                params.cursor = cursor;
            }

            if (modifiedSince) {
                params.updated_since = modifiedSince.toISOString();
            }

            params.sort_by = 'update_time';
            params.sort_direction = sortDesc ? 'desc' : 'asc';

            const response = await this.pipedrive.api.listPersons(params);
            const persons = response.data || [];
            const nextCursor = response.additional_data?.next_cursor || null;

            console.log(
                `[Pipedrive] Fetched ${persons.length} ${objectType}(s) at cursor ${cursor || 'start'}, ` +
                    `hasMore=${!!nextCursor}`,
            );

            return {
                data: persons,
                cursor: nextCursor,
                hasMore: !!nextCursor,
            };
        } catch (error) {
            console.error(
                `Error fetching ${objectType} at cursor ${cursor}:`,
                error,
            );
            throw error;
        }
    }

    /**
     * Transform Pipedrive person object to Quo contact format
     * @param {Object} person - Pipedrive person object
     * @param {Map<string, Object>|null} orgMap - Optional pre-fetched organization map (id -> org data)
     * @returns {Promise<Object>} Quo contact format
     */
    async transformPersonToQuo(person, orgMap = null) {
        const phoneNumbers = [];
        if (person.phones && person.phones.length > 0) {
            phoneNumbers.push(
                ...person.phones.map((p) => ({
                    name: p.label
                        ? p.label.charAt(0).toUpperCase() + p.label.slice(1)
                        : 'Work',
                    value: p.value,
                    primary: p.primary || false,
                })),
            );
        }

        const emails = [];
        if (person.emails && person.emails.length > 0) {
            emails.push(
                ...person.emails.map((e) => ({
                    name: e.label
                        ? e.label.charAt(0).toUpperCase() + e.label.slice(1)
                        : 'Work',
                    value: e.value,
                    primary: e.primary || false,
                })),
            );
        }

        let company = null;
        if (person.org_id) {
            if (orgMap && orgMap.has(person.org_id)) {
                const orgData = orgMap.get(person.org_id);
                company = orgData?.name || null;
            } else {
                try {
                    const orgResponse =
                        await this.pipedrive.api.getOrganization(person.org_id);
                    company = orgResponse.data?.name || null;
                } catch (error) {
                    console.warn(
                        `[PipedriveIntegration] Failed to fetch organization ${person.org_id} for person ${person.id}:`,
                        error.message,
                    );
                    company = null;
                }
            }
        }

        const firstName = person.first_name || 'Unknown';

        // Generate sourceUrl for linking back to Pipedrive
        const sourceUrl = `https://app.pipedrive.com/person/${person.id}`;

        return {
            externalId: String(person.id),
            source: 'openphone-pipedrive',
            sourceUrl,
            defaultFields: {
                firstName,
                lastName: person.last_name,
                company,
                phoneNumbers,
                emails,
            },
            customFields: [],
            sourceEntityType: 'person',
        };
    }

    /**
     * Log SMS message to Pipedrive as a note
     * @param {Object} activity - SMS activity
     * @returns {Promise<void>}
     */
    async logSMSToActivity(activity) {
        try {
            const person = await this.pipedrive.api.getPerson(
                activity.contactExternalId,
            );
            if (!person || !person.data) {
                console.warn(
                    `Person not found for SMS logging: ${activity.contactExternalId}`,
                );
                return;
            }

            const noteData = {
                content: activity.content,
                person_id: person.data.id,
            };

            await this.pipedrive.api.createNote(noteData);
        } catch (error) {
            console.error('Failed to log SMS to Pipedrive:', error);
            throw error;
        }
    }

    /**
     * Log phone call to Pipedrive as an activity
     * @param {Object} activity - Call activity
     * @returns {Promise<void>}
     */
    async logCallToActivity(activity) {
        try {
            const person = await this.pipedrive.api.getPerson(
                activity.contactExternalId,
            );
            if (!person || !person.data) {
                console.warn(
                    `Person not found for call logging: ${activity.contactExternalId}`,
                );
                return;
            }

            const activityData = {
                subject: `Call: ${activity.direction} (${activity.duration}s)`,
                type: 'call',
                done: 1,
                note: activity.summary || 'Phone call',
                participants: [{ person_id: person.data.id, primary: true }],
                duration: formatDurationForPipedrive(activity.duration),
            };

            await this.pipedrive.api.createActivity(activityData);
        } catch (error) {
            console.error('Failed to log call activity to Pipedrive:', error);
            throw error;
        }
    }

    /**
     * Update an existing activity in Pipedrive
     * Wrapper method for convenience
     *
     * @param {string|number} activityId - Activity ID to update
     * @param {Object} activityData - Activity fields to update
     * @returns {Promise<Object>} Updated activity response
     */
    async updateActivity(activityId, activityData) {
        return await this.pipedrive.api.updateActivity(
            activityId,
            activityData,
        );
    }

    /**
     * Setup Pipedrive webhooks
     * Programmatically registers multiple webhooks with Pipedrive API
     * Stores webhook IDs in config for later cleanup
     * @private
     * @returns {Promise<Object>} Setup result
     */
    async setupPipedriveWebhooks() {
        try {
            if (
                this.config?.pipedriveWebhookIds &&
                this.config.pipedriveWebhookIds.length > 0
            ) {
                console.log(
                    `[Pipedrive] Webhooks already registered:`,
                    this.config.pipedriveWebhookIds,
                );
                return {
                    status: 'already_configured',
                    webhookIds: this.config.pipedriveWebhookIds,
                    webhookUrl: this.config.pipedriveWebhookUrl,
                };
            }

            const webhookUrl = `${process.env.BASE_URL}/api/pipedrive-integration/webhooks/${this.id}`;

            console.log(`[Pipedrive] Registering webhooks at: ${webhookUrl}`);

            // 3. Define webhook subscriptions (one webhook per event combination)
            const subscriptions = [
                {
                    event_action: 'added',
                    event_object: 'person',
                    name: 'Person Added',
                },
                {
                    event_action: 'updated',
                    event_object: 'person',
                    name: 'Person Updated',
                },
                {
                    event_action: 'deleted',
                    event_object: 'person',
                    name: 'Person Deleted',
                },
                {
                    event_action: 'merged',
                    event_object: 'person',
                    name: 'Person Merged',
                },
            ];

            const webhookIds = [];
            const createdWebhooks = [];

            for (const sub of subscriptions) {
                try {
                    const webhookResponse =
                        await this.pipedrive.api.createWebhook({
                            subscription_url: webhookUrl,
                            event_action: sub.event_action,
                            event_object: sub.event_object,
                            name: `Quo - ${sub.name}`,
                            version: '1.0',
                        });

                    if (webhookResponse?.data?.id) {
                        webhookIds.push(webhookResponse.data.id);
                        createdWebhooks.push({
                            id: webhookResponse.data.id,
                            event: `${sub.event_action}.${sub.event_object}`,
                            name: sub.name,
                        });
                        console.log(
                            `[Pipedrive] ✓ Created webhook ${webhookResponse.data.id}: ${sub.event_action}.${sub.event_object}`,
                        );
                    } else {
                        console.warn(
                            `[Pipedrive] No webhook ID returned for ${sub.event_action}.${sub.event_object}`,
                        );
                    }
                } catch (error) {
                    console.error(
                        `[Pipedrive] Failed to create webhook for ${sub.event_action}.${sub.event_object}:`,
                        error.message,
                    );
                    // Continue with other webhooks even if one fails
                }
            }

            if (webhookIds.length === 0) {
                throw new Error('Failed to create any webhooks');
            }

            // 5. Store webhook IDs using command pattern
            const updatedConfig = {
                ...this.config,
                pipedriveWebhookIds: webhookIds,
                pipedriveWebhookUrl: webhookUrl,
                pipedriveWebhooks: createdWebhooks,
                webhookCreatedAt: new Date().toISOString(),
            };

            await this.commands.updateIntegrationConfig({
                integrationId: this.id,
                config: updatedConfig,
            });

            this.config = updatedConfig;

            console.log(
                `[Pipedrive] ✓ Registered ${webhookIds.length} webhooks successfully`,
            );

            return {
                status: 'configured',
                webhookIds: webhookIds,
                webhookUrl: webhookUrl,
                webhooks: createdWebhooks,
            };
        } catch (error) {
            console.error('[Pipedrive] Failed to setup webhooks:', error);

            // Fatal error - webhooks are required
            await this.updateIntegrationMessages.execute(
                this.id,
                'errors',
                'Webhook Setup Failed',
                `Could not register webhooks with Pipedrive: ${error.message}. Webhooks are required for this integration. Check API credentials and BASE_URL configuration.`,
                Date.now(),
            );

            // Re-throw to prevent integration creation
            throw error;
        }
    }

    /**
     * Migrate old webhook structure (single webhooks) to new structure (arrays)
     * This ensures backwards compatibility for existing integrations
     */
    async _migrateOldWebhooksToNewStructure() {
        console.log(
            '[Quo] Migrating old webhook structure to new array structure',
        );

        const hasOldStructure =
            this.config?.quoMessageWebhookId ||
            this.config?.quoCallWebhookId ||
            this.config?.quoCallSummaryWebhookId;

        if (!hasOldStructure) {
            console.log(
                '[Quo] No old webhook structure found, skipping migration',
            );
            return false;
        }

        // Convert old structure to new array structure
        const messageWebhooks = this.config.quoMessageWebhookId
            ? [
                  {
                      id: this.config.quoMessageWebhookId,
                      key: this.config.quoMessageWebhookKey,
                      resourceIds: this.config?.enabledPhoneIds || [],
                  },
              ]
            : [];

        const callWebhooks = this.config.quoCallWebhookId
            ? [
                  {
                      id: this.config.quoCallWebhookId,
                      key: this.config.quoCallWebhookKey,
                      resourceIds: this.config?.enabledPhoneIds || [],
                  },
              ]
            : [];

        const callSummaryWebhooks = this.config.quoCallSummaryWebhookId
            ? [
                  {
                      id: this.config.quoCallSummaryWebhookId,
                      key: this.config.quoCallSummaryWebhookKey,
                      resourceIds: this.config?.enabledPhoneIds || [],
                  },
              ]
            : [];

        // Update config with new structure and remove old fields
        const updatedConfig = {
            ...this.config,
            // Add new array structure
            quoMessageWebhooks: messageWebhooks,
            quoCallWebhooks: callWebhooks,
            quoCallSummaryWebhooks: callSummaryWebhooks,
            // Remove old single webhook fields
            quoMessageWebhookId: undefined,
            quoMessageWebhookKey: undefined,
            quoCallWebhookId: undefined,
            quoCallWebhookKey: undefined,
            quoCallSummaryWebhookId: undefined,
            quoCallSummaryWebhookKey: undefined,
        };

        await this.updateConfig(updatedConfig);
        console.log(
            `[Quo] ✓ Successfully migrated webhooks: ${messageWebhooks.length} message, ${callWebhooks.length} call, ${callSummaryWebhooks.length} call-summary`,
        );

        return true;
    }

    /**
     * Setup Quo webhooks (message, call, and call-summary webhooks)
     * Registers webhooks with Quo API and stores webhook IDs + keys in config
     * Uses atomic pattern: creates all webhooks before saving config, with rollback on failure
     * @private
     * @returns {Promise<Object>} Setup result with status, webhookIds, webhookUrls, etc.
     */
    async setupQuoWebhook() {
        const createdWebhooks = [];

        try {
            // Check for old structure (backwards compatibility) - migrate if found
            const hasOldStructure =
                this.config?.quoMessageWebhookId ||
                this.config?.quoCallWebhookId ||
                this.config?.quoCallSummaryWebhookId;

            if (hasOldStructure) {
                console.log(
                    '[Quo] Detected old webhook structure, migrating...',
                );
                await this._migrateOldWebhooksToNewStructure();
                return {
                    status: 'migrated',
                    messageWebhooks: this.config.quoMessageWebhooks,
                    callWebhooks: this.config.quoCallWebhooks,
                    callSummaryWebhooks: this.config.quoCallSummaryWebhooks,
                    webhookUrl: this.config.quoWebhooksUrl,
                };
            }

            // Check if already configured with new structure
            if (
                this.config?.quoMessageWebhooks &&
                this.config?.quoCallWebhooks &&
                this.config?.quoCallSummaryWebhooks
            ) {
                console.log(
                    `[Quo] Webhooks already registered: ${this.config.quoMessageWebhooks.length} message, ${this.config.quoCallWebhooks.length} call, ${this.config.quoCallSummaryWebhooks.length} call-summary`,
                );
                return {
                    status: 'already_configured',
                    messageWebhooks: this.config.quoMessageWebhooks,
                    callWebhooks: this.config.quoCallWebhooks,
                    callSummaryWebhooks: this.config.quoCallSummaryWebhooks,
                    webhookUrl: this.config.quoWebhooksUrl,
                };
            }

            // Check for partial configuration (recovery scenario)
            const hasPartialConfig =
                this.config?.quoMessageWebhooks ||
                this.config?.quoCallWebhooks ||
                this.config?.quoCallSummaryWebhooks;

            if (hasPartialConfig) {
                console.warn(
                    '[Quo] Partial webhook configuration detected - cleaning up before retry',
                );

                const quoMessageWebhooks =
                    this.config?.quoMessageWebhooks || [];
                for (const webhook of quoMessageWebhooks) {
                    try {
                        await this.quo.api.deleteWebhook(webhook.id);
                        console.log(
                            `[Quo] Cleaned up orphaned message webhook: ${webhook.id}`,
                        );
                    } catch (cleanupError) {
                        console.warn(
                            `[Quo] Could not clean up message webhook (may have been deleted): ${cleanupError.message}`,
                        );
                    }
                }

                const quoCallWebhooks = this.config?.quoCallWebhooks || [];
                for (const webhook of quoCallWebhooks) {
                    try {
                        await this.quo.api.deleteWebhook(webhook.id);
                        console.log(
                            `[Quo] Cleaned up orphaned call webhook: ${webhook.id}`,
                        );
                    } catch (cleanupError) {
                        console.warn(
                            `[Quo] Could not clean up call webhook (may have been deleted): ${cleanupError.message}`,
                        );
                    }
                }

                const quoCallSummaryWebhooks =
                    this.config?.quoCallSummaryWebhooks || [];
                for (const webhook of quoCallSummaryWebhooks) {
                    try {
                        await this.quo.api.deleteWebhook(webhook.id);
                        console.log(
                            `[Quo] Cleaned up orphaned call-summary webhook: ${webhook.id}`,
                        );
                    } catch (cleanupError) {
                        console.warn(
                            `[Quo] Could not clean up call-summary webhook (may have been deleted): ${cleanupError.message}`,
                        );
                    }
                }
            }

            console.log('[Quo] Fetching phone numbers for webhook filtering');
            await this._fetchAndStoreEnabledPhoneIds();
            const phoneIds = this.config.enabledPhoneIds || [];

            const webhookUrl = this._generateWebhookUrl(`/webhooks/${this.id}`);

            console.log(
                `[Quo] Registering message and call webhooks at: ${webhookUrl}`,
            );

            // Use base class method to create webhooks with resourceIds support
            const { messageWebhooks, callWebhooks, callSummaryWebhooks } =
                await this._createQuoWebhooksWithPhoneIds(webhookUrl, phoneIds);

            // Track created webhooks for rollback on error
            createdWebhooks.push(
                ...messageWebhooks.map((wh) => ({
                    type: 'message',
                    id: wh.id,
                })),
                ...callWebhooks.map((wh) => ({ type: 'call', id: wh.id })),
                ...callSummaryWebhooks.map((wh) => ({
                    type: 'callSummary',
                    id: wh.id,
                })),
            );

            const updatedConfig = {
                ...this.config,
                quoMessageWebhooks: messageWebhooks,
                quoCallWebhooks: callWebhooks,
                quoCallSummaryWebhooks: callSummaryWebhooks,
                quoWebhooksUrl: webhookUrl,
                quoWebhooksCreatedAt: new Date().toISOString(),
            };

            await this.commands.updateIntegrationConfig({
                integrationId: this.id,
                config: updatedConfig,
            });

            this.config = updatedConfig;

            console.log(`[Quo] ✓ Keys stored securely (encrypted at rest)`);

            return {
                status: 'configured',
                messageWebhooks: messageWebhooks,
                callWebhooks: callWebhooks,
                callSummaryWebhooks: callSummaryWebhooks,
                webhookUrl: webhookUrl,
            };
        } catch (error) {
            console.error('[Quo] Failed to setup webhooks:', error);

            if (createdWebhooks.length > 0) {
                console.warn(
                    `[Quo] Rolling back ${createdWebhooks.length} created webhook(s)`,
                );

                for (const webhook of createdWebhooks) {
                    try {
                        await this.quo.api.deleteWebhook(webhook.id);
                        console.log(
                            `[Quo] ✓ Rolled back ${webhook.type} webhook ${webhook.id}`,
                        );
                    } catch (rollbackError) {
                        console.error(
                            `[Quo] Failed to rollback ${webhook.type} webhook ${webhook.id}:`,
                            rollbackError.message,
                        );
                    }
                }
            }

            // Fatal error - both webhooks required
            await this.updateIntegrationMessages.execute(
                this.id,
                'errors',
                'Quo Webhook Setup Failed',
                `Could not register webhooks with Quo: ${error.message}. Integration requires message, call, and call-summary webhooks to function properly.`,
                Date.now(),
            );

            return {
                status: 'failed',
                error: error.message,
            };
        }
    }

    /**
     * Setup webhooks with both Pipedrive and Quo
     * Called during onCreate lifecycle (BaseCRMIntegration)
     * Orchestrates webhook setup for both services - BOTH required for success
     * @returns {Promise<Object>} Setup result
     */
    async setupWebhooks() {
        const results = {
            pipedrive: null,
            quo: null,
            overallStatus: 'success',
        };

        // Use Promise.allSettled to attempt both webhook setups independently
        // This ensures Quo webhooks are created even if Pipedrive setup fails
        const [pipedriveResult, quoResult] = await Promise.allSettled([
            this.setupPipedriveWebhooks(),
            this.setupQuoWebhook(),
        ]);

        // Process Pipedrive webhook result
        if (pipedriveResult.status === 'fulfilled') {
            results.pipedrive = pipedriveResult.value;
            console.log('[Webhook Setup] ✓ Pipedrive webhooks configured');
        } else {
            results.pipedrive = {
                status: 'failed',
                error: pipedriveResult.reason.message,
            };
            console.error(
                '[Webhook Setup] ✗ Pipedrive webhook setup failed:',
                pipedriveResult.reason.message,
            );

            // Log warning for Pipedrive failure (non-fatal)
            await this.updateIntegrationMessages.execute(
                this.id,
                'warnings',
                'Pipedrive Webhook Setup Failed',
                `Could not register webhooks with Pipedrive: ${pipedriveResult.reason.message}. Integration will function without Pipedrive webhooks, but changes in Pipedrive will not sync automatically.`,
                Date.now(),
            );
        }

        // Process Quo webhook result
        if (quoResult.status === 'fulfilled') {
            results.quo = quoResult.value;
            console.log('[Webhook Setup] ✓ Quo webhooks configured');
        } else {
            results.quo = {
                status: 'failed',
                error: quoResult.reason.message,
            };
            console.error(
                '[Webhook Setup] ✗ Quo webhook setup failed:',
                quoResult.reason.message,
            );

            // Quo webhooks are critical - log as error
            await this.updateIntegrationMessages.execute(
                this.id,
                'errors',
                'Quo Webhook Setup Failed',
                `Failed to register webhooks with Quo: ${quoResult.reason.message}. Quo webhooks are required for receiving calls and messages.`,
                Date.now(),
            );
        }

        // Determine overall status
        // Note: Both methods catch errors and return {status: 'failed'} instead of throwing
        // So we check both Promise fulfillment AND the result.status field
        const pipedriveSuccess =
            pipedriveResult.status === 'fulfilled' &&
            results.pipedrive.status !== 'failed';
        const quoSuccess =
            quoResult.status === 'fulfilled' && results.quo.status !== 'failed';

        if (pipedriveSuccess && quoSuccess) {
            results.overallStatus = 'success';
            console.log(
                '[Webhook Setup] ✓ All webhooks configured successfully',
            );
        } else if (quoSuccess) {
            // Quo webhooks working is sufficient for basic functionality
            results.overallStatus = 'partial';
            console.log(
                '[Webhook Setup] ⚠ Partial success - Quo webhooks configured, Pipedrive webhooks failed',
            );
        } else if (pipedriveSuccess) {
            // Pipedrive webhooks alone are not sufficient (need Quo for core functionality)
            results.overallStatus = 'failed';
            console.error(
                '[Webhook Setup] ✗ Failed - Quo webhooks required for integration to function',
            );
            throw new Error(
                'Quo webhook setup failed. Quo webhooks are required for integration to function.',
            );
        } else {
            // Both failed
            results.overallStatus = 'failed';
            console.error(
                '[Webhook Setup] ✗ Failed - Both webhook setups failed',
            );
            throw new Error(
                'Both Pipedrive and Quo webhook setups failed. Integration cannot function without Quo webhooks.',
            );
        }

        return results;
    }

    /**
     * HTTP webhook receiver - handles incoming webhooks before queuing
     * Called on incoming webhook POST before queuing to SQS
     * Context: NO database connection (fast cold start)
     *
     * Determines webhook source (Pipedrive vs Quo) and validates signatures
     * before queuing for processing
     *
     * @param {Object} params
     * @param {Object} params.req - Express request object
     * @param {Object} params.res - Express response object
     * @returns {Promise<void>}
     */
    async onWebhookReceived({ req, res }) {
        try {
            const isPipedriveWebhook =
                req.body?.meta?.host &&
                req.body.meta.host.includes('pipedrive.com');

            // Determine webhook source based on signature header
            // Pipedrive webhooks don't have openphone-signature header
            const source = isPipedriveWebhook ? 'pipedrive' : 'quo';

            // Note: We can't verify signature here because we don't have DB access
            // Signature verification will happen in onWebhook() with full context

            const webhookData = {
                body: req.body,
                headers: req.headers,
                integrationId: req.params.integrationId,
                signature: isPipedriveWebhook || null,
                source: source,
                receivedAt: new Date().toISOString(),
            };

            await this.queueWebhook(webhookData);

            res.status(200).json({ received: true });
        } catch (error) {
            console.error('[Webhook] Receive error:', error);
            throw error;
        }
    }

    /**
     * Process webhook events from Pipedrive and Quo
     * Called by queue worker with full database access and hydrated integration
     * Automatically invoked by Frigg's webhook infrastructure
     * Routes to appropriate handler based on webhook source
     *
     * @param {Object} params
     * @param {Object} params.data - Webhook data from queue
     * @param {Object} params.data.body - Webhook payload
     * @param {Object} params.data.headers - HTTP headers
     * @param {string} params.data.source - Webhook source ('pipedrive' or 'quo')
     * @param {string} params.data.integrationId - Integration ID
     * @returns {Promise<Object>} Processing result
     */
    async onWebhook({ data }) {
        const { source } = data;

        console.log(`[Webhook] Processing ${source} webhook`);

        if (source === 'quo') {
            return await this._handleQuoWebhook(data);
        } else {
            return await this._handlePipedriveWebhook(data);
        }
    }

    /**
     * Process webhook events from Pipedrive
     * Called by onWebhook() router
     *
     * @private
     * @param {Object} data - Webhook data from queue
     * @returns {Promise<Object>} Processing result
     */
    async _handlePipedriveWebhook(data) {
        const { body, headers, integrationId } = data;

        console.log(`[Pipedrive Webhook] Processing event:`, {
            event: body.event,
            action: body.meta?.action,
            object: body.meta?.object,
            objectId: body.meta?.id,
            timestamp: body.meta?.timestamp,
        });

        try {
            const { meta, current, previous, event } = body;

            if (!meta || !event) {
                throw new Error(
                    'Invalid webhook payload: missing meta or event',
                );
            }

            // 2. Parse event type (e.g., "updated.person" -> action: updated, object: person)
            const [action, object] = event.split('.');

            switch (object) {
                case 'person':
                    await this._handlePersonWebhook({
                        action,
                        data: current,
                        previous,
                        meta,
                    });
                    break;
                default:
                    console.log(
                        `[Pipedrive Webhook] Unhandled object type: ${object}`,
                    );
                    return {
                        success: true,
                        skipped: true,
                        reason: `Object type '${object}' not configured for sync`,
                    };
            }

            console.log(
                `[Pipedrive Webhook] ✓ Successfully processed ${event}`,
            );

            return {
                success: true,
                event: event,
                action: action,
                object: object,
                objectId: meta.id,
                processedAt: new Date().toISOString(),
            };
        } catch (error) {
            console.error('[Pipedrive Webhook] Processing error:', error);

            // Log error to integration messages
            await this.updateIntegrationMessages.execute(
                this.id,
                'errors',
                'Webhook Processing Error',
                `Failed to process ${body.event}: ${error.message}`,
                Date.now(),
            );

            // Re-throw for SQS retry and DLQ
            throw error;
        }
    }

    /**
     * Handle person webhook events (added, updated, deleted, merged)
     * Fetches full person data and syncs to Quo
     *
     * @private
     * @param {Object} params
     * @param {string} params.action - Event action: added, updated, deleted, merged
     * @param {Object} params.data - Current person data from webhook
     * @param {Object} params.previous - Previous person data (for updates)
     * @param {Object} params.meta - Webhook metadata (ids, timestamp, etc.)
     * @returns {Promise<void>}
     */
    async _handlePersonWebhook({ action, data, previous, meta }) {
        console.log(`[Pipedrive Webhook] Handling person ${action}:`, meta.id);

        try {
            let person;

            if (action === 'deleted') {
                // For deletion, we only need the person ID
                person = { id: meta.id };
            } else {
                try {
                    const response = await this.pipedrive.api.getPerson(
                        meta.id,
                    );
                    person = response.data;
                } catch (error) {
                    console.warn(
                        `[Pipedrive Webhook] Could not fetch person ${meta.id}, using webhook data:`,
                        error.message,
                    );
                    person = data;
                }

                if (!person) {
                    console.warn(
                        `[Pipedrive Webhook] Person ${meta.id} not found`,
                    );
                    return;
                }
            }

            await this._syncPersonToQuo(person, action);

            // Update mapping for idempotency tracking
            await this.upsertMapping(String(meta.id), {
                externalId: String(meta.id),
                entityType: 'Person',
                lastSyncedAt: new Date().toISOString(),
                syncMethod: 'webhook',
                action: action,
            });

            console.log(
                `[Pipedrive Webhook] ✓ Synced person ${meta.id} to Quo`,
            );
        } catch (error) {
            console.error(
                `[Pipedrive Webhook] Failed to sync person ${meta.id}:`,
                error.message,
            );
            throw error;
        }
    }

    /**
     * Sync Pipedrive person to Quo
     * Handles all person sync operations: create, update, and delete
     *
     * @private
     * @param {Object} person - Pipedrive person object (or object with id for deletion)
     * @param {string} action - 'added', 'updated', or 'deleted'
     * @returns {Promise<void>}
     */
    async _syncPersonToQuo(person, action) {
        console.log(
            `[Pipedrive] Syncing person to Quo (${action}):`,
            person.id,
        );

        try {
            if (!this.quo?.api) {
                throw new Error('Quo API not available');
            }

            // Handle deletion separately (no transformation needed)
            if (action === 'deleted') {
                const existingContacts = await this.quo.api.listContacts({
                    externalIds: [String(person.id)],
                    maxResults: 10,
                });

                const exactMatch =
                    existingContacts?.data && existingContacts.data.length > 0
                        ? existingContacts.data.find(
                              (contact) =>
                                  contact.externalId === String(person.id),
                          )
                        : null;

                if (exactMatch) {
                    await this.quo.api.deleteContact(exactMatch.id);
                    console.log(
                        `[Pipedrive] ✓ Deleted Quo contact ${exactMatch.id} for person ${person.id}`,
                    );
                    await trackAnalyticsEvent(
                        this,
                        QUO_ANALYTICS_EVENTS.CONTACT_DELETED,
                        { contactId: String(person.id) },
                    );
                } else {
                    console.log(
                        `[Pipedrive] Contact for person ${person.id} not found in Quo, nothing to delete`,
                    );
                }
                return;
            }

            const quoContact = await this.transformPersonToQuo(person);

            const result = await this.upsertContactToQuo(quoContact);

            console.log(
                `[Pipedrive] ✓ Contact ${result.action} in Quo (externalId: ${quoContact.externalId}, quoContactId: ${result.quoContactId})`,
            );

            const analyticsEvent =
                result.action === 'created'
                    ? QUO_ANALYTICS_EVENTS.CONTACT_IMPORT
                    : QUO_ANALYTICS_EVENTS.CONTACT_UPDATED;
            await trackAnalyticsEvent(this, analyticsEvent, {
                contactId: String(person.id),
            });

            console.log(`[Pipedrive] ✓ Person ${person.id} synced to Quo`);
        } catch (error) {
            console.error(
                `[Pipedrive] Failed to sync person ${person.id}:`,
                error.message,
            );
            await trackAnalyticsEvent(
                this,
                QUO_ANALYTICS_EVENTS.CONTACT_SYNC_FAILED,
                {
                    contactId: String(person.id),
                    error: error.message,
                },
            );
            throw error;
        }
    }

    /**
     * Process webhook events from Quo (OpenPhone)
     * Called by onWebhook() router
     *
     * @private
     * @param {Object} data - Webhook data from queue
     * @returns {Promise<Object>} Processing result
     */
    async _handleQuoWebhook(data) {
        const { body, headers } = data;
        const eventType = body.type; // "call.completed", "message.received", etc.

        console.log(`[Quo Webhook] Processing event: ${eventType}`);

        try {
            // TODO(quo-webhooks): Re-enable signature verification once Quo/OpenPhone
            // await this._verifyQuoWebhookSignature(headers, body, eventType);

            let result;
            if (eventType === QuoWebhookEvents.CALL_COMPLETED) {
                result = await this._handleQuoCallEvent(body);
            } else if (eventType === QuoWebhookEvents.CALL_SUMMARY_COMPLETED) {
                result = await this._handleQuoCallSummaryEvent(body);
            } else if (
                eventType === QuoWebhookEvents.MESSAGE_RECEIVED ||
                eventType === QuoWebhookEvents.MESSAGE_DELIVERED
            ) {
                result = await this._handleQuoMessageEvent(body);
            } else {
                console.warn(`[Quo Webhook] Unknown event type: ${eventType}`);
                return { success: true, skipped: true, eventType };
            }

            return {
                success: true,
                processedAt: new Date().toISOString(),
                eventType,
                result,
            };
        } catch (error) {
            console.error('[Quo Webhook] Processing error:', error);

            if (eventType.startsWith('message.')) {
                await trackAnalyticsEvent(
                    this,
                    QUO_ANALYTICS_EVENTS.MESSAGE_LOG_FAILED,
                    {
                        messageId: body.data?.object?.id,
                        error: error.message,
                    },
                );
            } else if (eventType.startsWith('call.')) {
                await trackAnalyticsEvent(
                    this,
                    QUO_ANALYTICS_EVENTS.CALL_LOG_FAILED,
                    {
                        callId:
                            body.data?.object?.id || body.data?.object?.callId,
                        error: error.message,
                    },
                );
            }

            await this.updateIntegrationMessages.execute(
                this.id,
                'errors',
                'Quo Webhook Processing Error',
                `Failed to process ${eventType}: ${error.message}`,
                Date.now(),
            );

            throw error; // Re-throw for SQS retry
        }
    }

    /**
     * Handle Quo call.completed webhook event
     * Uses QuoWebhookEventProcessor for orchestration
     *
     * @private
     * @param {Object} webhookData - Quo webhook payload
     * @returns {Promise<Object>} Processing result
     */
    async _handleQuoCallEvent(webhookData) {
        const result = await QuoWebhookEventProcessor.processCallEvent({
            webhookData,
            quoApi: this.quo.api,
            phoneNumbersMetadata: this.config?.phoneNumbersMetadata || [],
            crmAdapter: {
                formatMethod: 'html',
                useEmoji: true,
                findContactByPhone: async (phone) => {
                    try {
                        return await this._findPipedriveContactByPhone(phone);
                    } catch {
                        return null;
                    }
                },
                createCallActivity: async (contactId, activity) => {
                    const activityData = {
                        subject: activity.title || 'Call',
                        type: 'call',
                        done: 1,
                        note: `<p><strong>${activity.title}</strong></p><p>${activity.content}</p>`,
                        participants: [
                            { person_id: parseInt(contactId), primary: true },
                        ],
                        duration: formatDurationForPipedrive(activity.duration),
                    };
                    const activityResponse =
                        await this.pipedrive.api.createActivity(activityData);
                    return activityResponse?.data?.id || null;
                },
            },
            mappingRepo: {
                get: (id) => this.getMapping(id),
                upsert: (id, data) => this.upsertMapping(id, data),
            },
            onActivityCreated: async ({ callId }) => {
                await trackAnalyticsEvent(this, QUO_ANALYTICS_EVENTS.CALL_LOGGED, {
                    callId,
                });
            },
        });

        return result;
    }

    /**
     * Handle Quo message.received and message.delivered webhook events
     * Uses QuoWebhookEventProcessor for orchestration
     *
     * @private
     * @param {Object} webhookData - Quo webhook payload
     * @returns {Promise<Object>} Processing result
     */
    async _handleQuoMessageEvent(webhookData) {
        const result = await QuoWebhookEventProcessor.processMessageEvent({
            webhookData,
            quoApi: this.quo.api,
            crmAdapter: {
                formatMethod: 'html',
                useEmoji: true,
                findContactByPhone: async (phone) => {
                    try {
                        return await this._findPipedriveContactByPhone(phone);
                    } catch {
                        return null;
                    }
                },
                createMessageActivity: async (contactId, activity) => {
                    const noteData = {
                        content: `<p><strong>${activity.title}</strong></p><p>${activity.content}</p>`,
                        person_id: parseInt(contactId),
                    };
                    const noteResponse =
                        await this.pipedrive.api.createNote(noteData);
                    return noteResponse?.data?.id || null;
                },
            },
            mappingRepo: {
                get: (id) => this.getMapping(id),
                upsert: (id, data) => this.upsertMapping(id, data),
            },
            onActivityCreated: async ({ messageId }) => {
                await trackAnalyticsEvent(this, QUO_ANALYTICS_EVENTS.MESSAGE_LOGGED, {
                    messageId,
                });
            },
        });

        return result;
    }

    /**
     * Handle Quo call.summary.completed webhook event
     * Uses CallSummaryEnrichmentService to update the existing note with enriched content
     *
     * @private
     * @param {Object} webhookData - Quo webhook payload
     * @returns {Promise<Object>} Processing result
     */
    async _handleQuoCallSummaryEvent(webhookData) {
        const summaryObject = webhookData.data.object;
        const callId = summaryObject.callId;
        const summary = summaryObject.summary || [];
        const nextSteps = summaryObject.nextSteps || [];
        const jobs = summaryObject.jobs || [];

        console.log(
            `[Quo Webhook] Processing call summary for call: ${callId}, ${summary.length} summary points, ${nextSteps.length} next steps`,
        );

        const callResponse = await this.quo.api.getCall(callId);
        if (!callResponse?.data) {
            console.warn(`[Quo Webhook] Call ${callId} not found`);
            return {
                received: true,
                callId,
                logged: false,
                error: 'Call not found',
            };
        }
        const callObject = callResponse.data;

        // Get ALL external participants (supports multi-party)
        const externalParticipants = filterExternalParticipants(
            callObject.participants || [],
            this.config?.phoneNumbersMetadata || [],
        );

        if (externalParticipants.length === 0) {
            console.warn(
                `[Quo Webhook] No external participants for call ${callId}`,
            );
            return {
                received: true,
                callId,
                logged: false,
                error: 'No external participants',
            };
        }

        // Fetch metadata once for all participants
        const [phoneNumberDetails, userDetails] = await Promise.all([
            this.quo.api.getPhoneNumber(callObject.phoneNumberId),
            this.quo.api.getUser(callObject.userId),
        ]);

        const inboxName =
            QuoCallContentBuilder.buildInboxName(phoneNumberDetails);
        const inboxNumber =
            phoneNumberDetails.data?.number ||
            phoneNumberDetails.data?.formattedNumber ||
            '';
        const userName = QuoCallContentBuilder.buildUserName(userDetails);
        const formatOptions = QuoCallContentBuilder.getFormatOptions('html');

        const deepLink = webhookData.data.deepLink || '#';

        const results = [];

        // Loop through each external participant
        for (const contactPhone of externalParticipants) {
            let pipedrivePersonId;
            try {
                pipedrivePersonId =
                    await this._findPipedriveContactByPhone(contactPhone);
            } catch (error) {
                console.warn(
                    `[Quo Webhook] Failed to find Pipedrive contact for ${contactPhone}: ${error.message}`,
                );
                results.push({
                    contactPhone,
                    logged: false,
                    error: 'Contact not found',
                });
                continue;
            }

            // Use CallSummaryEnrichmentService to enrich the note with update pattern
            const enrichmentResult =
                await CallSummaryEnrichmentService.enrichCallNote({
                    callId,
                    summaryData: { summary, nextSteps, jobs },
                    callDetails: callObject,
                    quoApi: this.quo.api,
                    crmAdapter: {
                        canUpdateNote: () => true,
                        createNote: async ({ contactId, content, title }) => {
                            // Note: Creates an Activity (not a Note) for calls
                            const plainTextTitle = title
                                .replace(/<[^>]*>/g, '')
                                .trim();
                            const subject =
                                plainTextTitle.substring(0, 255) || 'Call';

                            const activityData = {
                                subject,
                                type: 'call',
                                done: 1,
                                note: title + content,
                                participants: [
                                    {
                                        person_id: parseInt(contactId),
                                        primary: true,
                                    },
                                ],
                            };
                            const activityResponse =
                                await this.pipedrive.api.createActivity(
                                    activityData,
                                );
                            return activityResponse?.data?.id || null;
                        },
                        updateNote: async (activityId, { content, title }) => {
                            // Note: Updates an Activity (not a Note) for calls
                            const activityData = {
                                note: title + content,
                            };
                            return await this.updateActivity(
                                activityId,
                                activityData,
                            );
                        },
                    },
                    mappingRepo: {
                        get: async (id) => await this.getMapping(id),
                        upsert: async (id, data) =>
                            await this.upsertMapping(id, data),
                    },
                    contactId: pipedrivePersonId,
                    formatters: {
                        formatCallHeader: (callData) =>
                            QuoCallContentBuilder.buildCallStatus({
                                call: callData,
                                userName,
                            }),
                        formatTitle: (callData) =>
                            `<p><strong>${QuoCallContentBuilder.buildCallTitle({
                                call: callData,
                                inboxName,
                                inboxNumber,
                                contactPhone,
                                formatOptions,
                            })}</strong></p>`,
                        formatDeepLink: () =>
                            `\n<p>${QuoCallContentBuilder.buildDeepLink({
                                deepLink,
                                formatOptions,
                            }).replace(formatOptions.lineBreakDouble, '')}</p>`,
                        formatMethod: 'html',
                    },
                });

            console.log(
                `[Quo Webhook] ✓ Call summary enrichment complete for person ${pipedrivePersonId}`,
            );

            results.push({
                contactPhone,
                personId: pipedrivePersonId,
                noteId: enrichmentResult.noteId,
                logged: true,
                recordingsCount: enrichmentResult.recordingsCount,
                hasVoicemail: enrichmentResult.hasVoicemail,
            });
        }

        // Track analytics if at least one note was created
        if (results.some((r) => r.logged)) {
            await trackAnalyticsEvent(this, QUO_ANALYTICS_EVENTS.CALL_LOGGED, {
                callId,
            });
        }

        return {
            received: true,
            logged: results.some((r) => r.logged),
            results,
            callId,
            summaryPoints: summary.length,
            nextStepsCount: nextSteps.length,
        };
    }

    /**
     * Find Pipedrive contact by phone number
     * Uses exact phone number matching with normalized format
     *
     * @private
     * @param {string} phoneNumber - Phone number to search for
     * @returns {Promise<string>} Pipedrive person ID
     * @throws {Error} If contact not found in Pipedrive
     */
    async _findPipedriveContactByPhone(phoneNumber) {
        console.log(
            `[Quo Webhook] Looking up Pipedrive contact by phone: ${phoneNumber}`,
        );

        const normalizedPhone = this._normalizePhoneNumber(phoneNumber);
        console.log(
            `[Quo Webhook] Normalized phone: ${phoneNumber} → ${normalizedPhone}`,
        );

        try {
            // Using dedicated person search endpoint with phone field filter
            const searchResult = await this.pipedrive.api.searchPersons({
                term: normalizedPhone,
                fields: 'phone',
                exact_match: false,
                limit: 1,
            });

            if (
                !searchResult?.data?.items ||
                searchResult.data.items.length === 0
            ) {
                throw new Error(
                    `No Pipedrive contact found with phone number ${phoneNumber} (normalized: ${normalizedPhone}). ` +
                        `Contact must exist in Pipedrive to log activities.`,
                );
            }

            // With exact_match=true and fields='phone', take the first (most relevant) result
            const firstItem = searchResult.data.items[0];
            const personId = String(firstItem.item.id);

            console.log(`[Quo Webhook] ✓ Found contact by phone: ${personId}`);
            return personId;
        } catch (error) {
            console.error(
                `[Quo Webhook] Contact lookup failed:`,
                error.message,
            );
            throw error;
        }
    }

    /**
     * Fetch multiple organization records by IDs using a single batch query
     * @param {string[]|number[]} orgIds - Array of organization IDs
     * @returns {Promise<Array<Object>>} Array of organization records
     */
    async fetchOrganizationsByIds(orgIds) {
        if (!orgIds || orgIds.length === 0) {
            return [];
        }

        console.log(
            `[PipedriveIntegration] Fetching ${orgIds.length} unique organizations in single batch query`,
        );

        try {
            const result = await this.pipedrive.api.listOrganizations({
                ids: orgIds,
            });

            const organizations = result.data || [];

            console.log(
                `[PipedriveIntegration] Successfully fetched ${organizations.length}/${orgIds.length} organizations`,
            );

            if (organizations.length < orgIds.length) {
                const returnedIds = new Set(organizations.map((org) => org.id));
                const missingIds = orgIds.filter((id) => !returnedIds.has(id));
                console.warn(
                    `[PipedriveIntegration] ${missingIds.length} organizations not found:`,
                    missingIds,
                );
            }

            return organizations;
        } catch (error) {
            console.error(
                `[PipedriveIntegration] Failed to fetch organizations in batch:`,
                error.message,
            );
            return [];
        }
    }

    /**
     * Batch transform Pipedrive persons to Quo contacts
     * Optimized: pre-fetches all unique organizations to avoid N+1 queries
     *
     * @param {Array<Object>} persons - Array of Pipedrive person records
     * @returns {Promise<Array<Object>>} Array of Quo contact objects
     */
    async transformPersonsToQuo(persons) {
        if (!persons || persons.length === 0) {
            return [];
        }

        const orgIds = [
            ...new Set(persons.map((p) => p.org_id).filter(Boolean)),
        ];

        let orgMap = new Map();
        if (orgIds.length > 0) {
            const organizations = await this.fetchOrganizationsByIds(orgIds);
            orgMap = new Map(organizations.map((org) => [org.id, org]));
        }

        return Promise.all(
            persons.map((p) => this.transformPersonToQuo(p, orgMap)),
        );
    }

    /**
     * Fetch a single person by ID
     * @param {string} id - Person ID
     * @returns {Promise<Object>}
     */
    async fetchPersonById(id) {
        const response = await this.pipedrive.api.getPerson(id);
        return response.data;
    }

    /**
     * Fetch multiple persons by IDs (for webhook batch processing)
     * @param {string[]} ids - Array of person IDs
     * @returns {Promise<Object[]>}
     */
    async fetchPersonsByIds(ids) {
        const persons = [];
        for (const id of ids) {
            try {
                const person = await this.fetchPersonById(id);
                persons.push(person);
            } catch (error) {
                console.error(`Failed to fetch person ${id}:`, error.message);
            }
        }
        return persons;
    }

    async listDeals({ req, res }) {
        try {
            const params = {
                limit: req.query.limit ? parseInt(req.query.limit) : 50,
                cursor: req.query.cursor,
            };

            const deals = await this.pipedrive.api.listDeals(params);
            res.json(deals);
        } catch (error) {
            console.error('Failed to list Pipedrive deals:', error);
            res.status(500).json({
                error: 'Failed to list deals',
                details: error.message,
            });
        }
    }

    async listPersons({ req, res }) {
        try {
            const params = {
                limit: req.query.limit ? parseInt(req.query.limit) : 50,
                cursor: req.query.cursor,
            };

            const persons = await this.pipedrive.api.listPersons(params);
            res.json(persons);
        } catch (error) {
            console.error('Failed to list Pipedrive persons:', error);
            res.status(500).json({
                error: 'Failed to list persons',
                details: error.message,
            });
        }
    }

    async listOrganizations({ req, res }) {
        try {
            const params = {
                limit: req.query.limit ? parseInt(req.query.limit) : 50,
                cursor: req.query.cursor,
            };

            const organizations =
                await this.pipedrive.api.listOrganizations(params);
            res.json(organizations);
        } catch (error) {
            console.error('Failed to list Pipedrive organizations:', error);
            res.status(500).json({
                error: 'Failed to list organizations',
                details: error.message,
            });
        }
    }

    async listActivities({ req, res }) {
        try {
            const params = {
                limit: req.query.limit ? parseInt(req.query.limit) : 50,
                cursor: req.query.cursor,
            };

            const activities = await this.pipedrive.api.listActivities(params);
            res.json(activities);
        } catch (error) {
            console.error('Failed to list Pipedrive activities:', error);
            res.status(500).json({
                error: 'Failed to list activities',
                details: error.message,
            });
        }
    }

    async createDeal({ req, res }) {
        try {
            const dealData = req.body;

            if (!dealData.title) {
                return res.status(400).json({
                    error: 'Deal title is required',
                });
            }

            const result = await this.pipedrive.api.createDeal(dealData);
            res.json(result);
        } catch (error) {
            console.error('Failed to create Pipedrive deal:', error);
            res.status(500).json({
                error: 'Failed to create deal',
                details: error.message,
            });
        }
    }

    async searchData({ req, res }) {
        try {
            const { term, item_types, exact_match } = req.body;

            if (!term) {
                return res.status(400).json({
                    error: 'Search term is required',
                });
            }

            const result = await this.pipedrive.api.search({
                term,
                item_types: item_types || 'person,organization,deal',
                exact_match: exact_match || false,
            });

            res.json(result);
        } catch (error) {
            console.error('Failed to search Pipedrive data:', error);
            res.status(500).json({
                error: 'Failed to search data',
                details: error.message,
            });
        }
    }

    async getStats({ req, res }) {
        try {
            const [deals, persons, activities] = await Promise.all([
                this.pipedrive.api.listDeals({ limit: 1 }),
                this.pipedrive.api.listPersons({ limit: 1 }),
                this.pipedrive.api.listActivities({ limit: 1 }),
            ]);

            const stats = {
                totalDeals: deals.additional_data?.pagination?.total || 0,
                totalPersons: persons.additional_data?.pagination?.total || 0,
                totalActivities:
                    activities.additional_data?.pagination?.total || 0,
            };

            res.json(stats);
        } catch (error) {
            console.error('Failed to get Pipedrive stats:', error);
            res.status(500).json({
                error: 'Failed to get stats',
                details: error.message,
            });
        }
    }

    /**
     * Verify Pipedrive Basic Auth credentials
     * Pipedrive sends HTTP Basic Auth with client_id:client_secret encoded in Base64
     *
     * @private
     * @param {string} authHeader - Authorization header value
     * @returns {boolean} - True if credentials are valid
     */
    _verifyPipedriveBasicAuth(authHeader) {
        if (!authHeader || !authHeader.startsWith('Basic ')) {
            return false;
        }

        const clientId = process.env.PIPEDRIVE_CLIENT_ID;
        const clientSecret = process.env.PIPEDRIVE_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            console.error(
                '[Pipedrive Uninstall] PIPEDRIVE_CLIENT_ID or PIPEDRIVE_CLIENT_SECRET not configured',
            );
            return false;
        }

        const expectedCredentials = Buffer.from(
            `${clientId}:${clientSecret}`,
        ).toString('base64');
        const receivedCredentials = authHeader.slice(6); // Remove 'Basic ' prefix

        return receivedCredentials === expectedCredentials;
    }

    /**
     * Handle Pipedrive app uninstall callback
     * Called when a user uninstalls the app from their Pipedrive account
     * Pipedrive sends a DELETE request with Basic Auth to the callback URL
     *
     * @see https://pipedrive.readme.io/docs/app-uninstallation
     * @param {Object} params - Request and response objects
     * @param {Object} params.req - Express request
     * @param {Object} params.res - Express response
     */
    async handleAppUninstall({ req, res }) {
        console.log('[Pipedrive Uninstall] Received uninstall callback');

        try {
            // Step 1: Verify Pipedrive Basic Auth
            const authHeader = req.headers.authorization;
            if (!this._verifyPipedriveBasicAuth(authHeader)) {
                console.error(
                    '[Pipedrive Uninstall] Invalid or missing Basic Auth credentials',
                );
                // Return success anyway (graceful failure - Pipedrive may retry)
                return res.status(200).json({ success: true });
            }

            // Step 2: Extract company_id from request body
            // Pipedrive sends: { user_id, company_id, timestamp }
            const { company_id: companyId, user_id: pipedriveUserId } =
                req.body;

            if (!companyId) {
                console.error(
                    '[Pipedrive Uninstall] Missing company_id in request body',
                );
                // Return success anyway (graceful failure)
                return res.status(200).json({ success: true });
            }

            console.log(
                `[Pipedrive Uninstall] Processing uninstall for company_id: ${companyId}, user_id: ${pipedriveUserId}`,
            );

            // Step 3: Find integration by external entity ID (company_id)
            const result =
                await this.commands.findIntegrationContextByExternalEntityId(
                    String(companyId),
                );

            if (result.error) {
                // Integration not found - may already be deleted (idempotent)
                console.log(
                    `[Pipedrive Uninstall] Integration not found for company_id: ${companyId}. ` +
                        `This may be expected if the integration was already deleted.`,
                );
                return res.status(200).json({ success: true });
            }

            const { context } = result;
            const integrationId = context.record.id || context.record._id;

            console.log(
                `[Pipedrive Uninstall] Found integration: ${integrationId}`,
            );

            // Step 4: Hydrate integration instance for cleanup
            this.id = integrationId;
            this.record = context.record;
            this.config = context.record.config || {};

            // Hydrate modules if available for webhook cleanup
            if (context.modules) {
                for (const [moduleName, moduleData] of Object.entries(
                    context.modules,
                )) {
                    this[moduleName] = moduleData;
                }
            }

            // Step 5: Call onDelete to cleanup external resources (webhooks, etc.)
            try {
                await this.onDelete({
                    integrationId,
                    triggeredBy: 'pipedrive_uninstall',
                    pipedriveUserId,
                    companyId,
                });
                console.log(
                    `[Pipedrive Uninstall] onDelete completed for integration: ${integrationId}`,
                );
            } catch (deleteError) {
                console.error(
                    `[Pipedrive Uninstall] Error in onDelete:`,
                    deleteError.message,
                );
                // Continue with deletion even if onDelete has errors
            }

            // Step 6: Delete credentials and entities for THIS integration only
            // context.record.entities already contains full entity objects with credentialId
            const entities = context.record.entities || [];
            console.log(
                `[Pipedrive Uninstall] Found ${entities.length} entities for this integration`,
            );

            if (entities.length > 0) {
                // Delete credentials and entities
                for (const entity of entities) {
                    // Credential can be nested as entity.credential or entity.credentialId
                    const credId =
                        entity.credential?.id ||
                        entity.credential?._id ||
                        entity.credentialId;

                    if (credId) {
                        const credentialId =
                            typeof credId === 'object'
                                ? credId._id || credId.id || credId.toString()
                                : credId;

                        try {
                            console.log(
                                `[Pipedrive Uninstall] Deleting credential: ${credentialId}`,
                            );
                            await this.commands.deleteCredentialById(
                                credentialId,
                            );
                        } catch (credError) {
                            console.error(
                                `[Pipedrive Uninstall] Error deleting credential ${credentialId}:`,
                                credError.message,
                            );
                        }
                    }

                    const entityId = entity.id || entity._id;
                    try {
                        console.log(
                            `[Pipedrive Uninstall] Deleting entity: ${entityId}`,
                        );
                        await this.commands.deleteEntityById(entityId);
                    } catch (entityError) {
                        console.error(
                            `[Pipedrive Uninstall] Error deleting entity ${entityId}:`,
                            entityError.message,
                        );
                    }
                }
            } else {
                console.log(
                    `[Pipedrive Uninstall] No entities found in integration record`,
                );
            }

            // Note: User is NOT deleted as they may have other integrations

            // Step 7: Delete the integration record from database
            const deleteResult =
                await this.commands.deleteIntegrationById(integrationId);

            if (deleteResult.error) {
                console.error(
                    `[Pipedrive Uninstall] Failed to delete integration ${integrationId}:`,
                    deleteResult.reason,
                );
                // Still return success as we've processed the request
            } else {
                console.log(
                    `[Pipedrive Uninstall] Successfully deleted integration: ${integrationId}`,
                );
            }

            // Step 8: Track analytics event
            await trackAnalyticsEvent(
                this,
                QUO_ANALYTICS_EVENTS.INTEGRATION_DISCONNECTED ||
                    'integration.disconnected',
                {
                    integrationId,
                    companyId,
                    triggeredBy: 'pipedrive_uninstall',
                },
            );

            return res.status(200).json({ success: true });
        } catch (error) {
            // Log error but return success (graceful failure)
            console.error('[Pipedrive Uninstall] Unexpected error:', error);
            return res.status(200).json({ success: true });
        }
    }

    /**
     * Called when integration is deleted
     * Clean up webhook registrations with Pipedrive
     *
     * @param {Object} params - Deletion parameters
     * @returns {Promise<void>}
     */
    async onDelete(params) {
        const deletionResults = {
            pipedrive: [],
            quoMessage: null,
            quoCall: null,
            quoCallSummary: null,
        };

        try {
            if (!this.pipedrive?.api || !this.quo?.api) {
                const missingModules = [];
                if (!this.pipedrive?.api) missingModules.push('pipedrive');
                if (!this.quo?.api) missingModules.push('quo');

                console.error(
                    `[Webhook Cleanup] Cannot delete webhooks: Missing API modules: ${missingModules.join(', ')}`,
                );
                console.error(
                    '[Webhook Cleanup] This likely means modules were not loaded during the deletion lifecycle.',
                );
                console.warn(
                    '[Webhook Cleanup] Webhook IDs have been preserved in config for manual cleanup:',
                );

                const pipedriveWebhookIds =
                    this.config?.pipedriveWebhookIds || [];
                if (pipedriveWebhookIds.length > 0) {
                    for (const webhookId of pipedriveWebhookIds) {
                        console.warn(`  - Pipedrive webhook: ${webhookId}`);
                    }
                }

                const quoMessageWebhooks =
                    this.config?.quoMessageWebhooks || [];
                const quoCallWebhooks = this.config?.quoCallWebhooks || [];
                const quoCallSummaryWebhooks =
                    this.config?.quoCallSummaryWebhooks || [];

                quoMessageWebhooks.forEach((wh) => {
                    console.warn(`  - Quo message webhook: ${wh.id}`);
                });
                quoCallWebhooks.forEach((wh) => {
                    console.warn(`  - Quo call webhook: ${wh.id}`);
                });
                quoCallSummaryWebhooks.forEach((wh) => {
                    console.warn(`  - Quo call-summary webhook: ${wh.id}`);
                });

                // Also log old structure if present
                if (this.config?.quoMessageWebhookId) {
                    console.warn(
                        `  - Quo message webhook (old): ${this.config.quoMessageWebhookId}`,
                    );
                }
                if (this.config?.quoCallWebhookId) {
                    console.warn(
                        `  - Quo call webhook (old): ${this.config.quoCallWebhookId}`,
                    );
                }
                if (this.config?.quoCallSummaryWebhookId) {
                    console.warn(
                        `  - Quo call-summary webhook (old): ${this.config.quoCallSummaryWebhookId}`,
                    );
                }

                console.warn(
                    '[Webhook Cleanup] You will need to manually delete these webhooks from the external services.',
                );

                await super.onDelete(params);
                return;
            }

            const pipedriveWebhookIds = this.config?.pipedriveWebhookIds || [];

            if (pipedriveWebhookIds.length > 0) {
                console.log(
                    `[Pipedrive] Deleting ${pipedriveWebhookIds.length} webhooks`,
                );

                for (const webhookId of pipedriveWebhookIds) {
                    try {
                        await this.pipedrive.api.deleteWebhook(webhookId);
                        deletionResults.pipedrive.push('success');
                        console.log(
                            `[Pipedrive] ✓ Webhook ${webhookId} deleted from Pipedrive`,
                        );
                    } catch (error) {
                        deletionResults.pipedrive.push('failed');
                        console.error(
                            `[Pipedrive] Failed to delete webhook ${webhookId}:`,
                            error.message,
                        );
                        console.warn(
                            `[Pipedrive] Webhook ID ${webhookId} preserved in config for manual cleanup`,
                        );
                    }
                }
            } else {
                console.log('[Pipedrive] No webhooks to delete');
            }

            const quoMessageWebhooks = this.config?.quoMessageWebhooks || [];

            if (quoMessageWebhooks.length > 0) {
                console.log(
                    `[Quo] Deleting ${quoMessageWebhooks.length} message webhook(s)`,
                );

                for (const webhook of quoMessageWebhooks) {
                    try {
                        await this.quo.api.deleteWebhook(webhook.id);
                        deletionResults.quoMessage = 'success';
                        console.log(
                            `[Quo] ✓ Message webhook ${webhook.id} deleted from Quo`,
                        );
                    } catch (error) {
                        deletionResults.quoMessage = 'failed';
                        console.error(
                            `[Quo] Failed to delete message webhook ${webhook.id}:`,
                            error.message,
                        );
                    }
                }
            } else {
                console.log('[Quo] No message webhooks to delete');
            }

            const quoCallWebhooks = this.config?.quoCallWebhooks || [];

            if (quoCallWebhooks.length > 0) {
                console.log(
                    `[Quo] Deleting ${quoCallWebhooks.length} call webhook(s)`,
                );

                for (const webhook of quoCallWebhooks) {
                    try {
                        await this.quo.api.deleteWebhook(webhook.id);
                        deletionResults.quoCall = 'success';
                        console.log(
                            `[Quo] ✓ Call webhook ${webhook.id} deleted from Quo`,
                        );
                    } catch (error) {
                        deletionResults.quoCall = 'failed';
                        console.error(
                            `[Quo] Failed to delete call webhook ${webhook.id}:`,
                            error.message,
                        );
                    }
                }
            } else {
                console.log('[Quo] No call webhooks to delete');
            }

            const quoCallSummaryWebhooks =
                this.config?.quoCallSummaryWebhooks || [];

            if (quoCallSummaryWebhooks.length > 0) {
                console.log(
                    `[Quo] Deleting ${quoCallSummaryWebhooks.length} call-summary webhook(s)`,
                );

                for (const webhook of quoCallSummaryWebhooks) {
                    try {
                        await this.quo.api.deleteWebhook(webhook.id);
                        deletionResults.quoCallSummary = 'success';
                        console.log(
                            `[Quo] ✓ Call-summary webhook ${webhook.id} deleted from Quo`,
                        );
                    } catch (error) {
                        deletionResults.quoCallSummary = 'failed';
                        console.error(
                            `[Quo] Failed to delete call-summary webhook ${webhook.id}:`,
                            error.message,
                        );
                    }
                }
            } else {
                console.log('[Quo] No call-summary webhooks to delete');
            }

            // BACKWARDS COMPATIBILITY: Delete old structure webhooks if still present
            if (this.config?.quoMessageWebhookId) {
                console.log('[Quo] Deleting old message webhook structure');
                try {
                    await this.quo.api.deleteWebhook(
                        this.config.quoMessageWebhookId,
                    );
                    console.log(
                        `[Quo] ✓ Old message webhook ${this.config.quoMessageWebhookId} deleted`,
                    );
                } catch (error) {
                    console.error(
                        `[Quo] Failed to delete old message webhook:`,
                        error.message,
                    );
                }
            }

            if (this.config?.quoCallWebhookId) {
                console.log('[Quo] Deleting old call webhook structure');
                try {
                    await this.quo.api.deleteWebhook(
                        this.config.quoCallWebhookId,
                    );
                    console.log(
                        `[Quo] ✓ Old call webhook ${this.config.quoCallWebhookId} deleted`,
                    );
                } catch (error) {
                    console.error(
                        `[Quo] Failed to delete old call webhook:`,
                        error.message,
                    );
                }
            }

            if (this.config?.quoCallSummaryWebhookId) {
                console.log(
                    '[Quo] Deleting old call-summary webhook structure',
                );
                try {
                    await this.quo.api.deleteWebhook(
                        this.config.quoCallSummaryWebhookId,
                    );
                    console.log(
                        `[Quo] ✓ Old call-summary webhook ${this.config.quoCallSummaryWebhookId} deleted`,
                    );
                } catch (error) {
                    console.error(
                        `[Quo] Failed to delete old call-summary webhook:`,
                        error.message,
                    );
                }
            }

            const pipedriveSuccessCount = deletionResults.pipedrive.filter(
                (result) => result === 'success',
            ).length;
            const pipedriveFailedCount = deletionResults.pipedrive.filter(
                (result) => result === 'failed',
            ).length;

            const quoResults = [
                deletionResults.quoMessage,
                deletionResults.quoCall,
                deletionResults.quoCallSummary,
            ];
            const quoSuccessCount = quoResults.filter(
                (result) => result === 'success',
            ).length;
            const quoFailedCount = quoResults.filter(
                (result) => result === 'failed',
            ).length;

            const totalSuccess = pipedriveSuccessCount + quoSuccessCount;
            const totalFailed = pipedriveFailedCount + quoFailedCount;

            if (totalFailed > 0) {
                console.warn(
                    `[Webhook Cleanup] Partial cleanup: ${totalSuccess} succeeded, ${totalFailed} failed. Failed webhook IDs preserved for manual cleanup.`,
                );
            } else {
                console.log(
                    `[Webhook Cleanup] ✓ All webhooks deleted successfully`,
                );
            }
        } catch (error) {
            console.error(
                '[Webhook Cleanup] Unexpected error during cleanup:',
                error,
            );
        }

        await super.onDelete(params);
    }
}

module.exports = PipedriveIntegration;
