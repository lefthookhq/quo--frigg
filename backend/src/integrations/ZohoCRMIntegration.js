const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');
const { Definition: QuoDefinition } = require('../api-modules/quo/definition');
const zohoCrm = require('@friggframework/api-module-zoho-crm');
const { createFriggCommands, createSchedulerCommands } = require('@friggframework/core');
const CallSummaryEnrichmentService = require('../base/services/CallSummaryEnrichmentService');
const QuoWebhookEventProcessor = require('../base/services/QuoWebhookEventProcessor');
const QuoCallContentBuilder = require('../base/services/QuoCallContentBuilder');
const { QUO_ANALYTICS_EVENTS, QuoWebhookEvents } = require('../base/constants');
const { trackAnalyticsEvent } = require('../utils/trackAnalyticsEvent');
const { filterExternalParticipants } = require('../utils/participantFilter');

class ZohoCRMIntegration extends BaseCRMIntegration {
    static Definition = {
        name: 'zoho',
        version: '1.0.0',
        supportedVersions: ['1.0.0'],
        hasUserConfig: true,

        display: {
            label: 'Zoho CRM',
            description: 'Zoho CRM platform integration with Quo API',
            category: 'CRM & Sales',
            detailsUrl: 'https://www.zoho.com/crm',
            icon: '',
        },
        modules: {
            quo: {
                definition: {
                    ...QuoDefinition,
                    getName: () => 'quo-zoho',
                    moduleName: 'quo-zoho',
                    display: {
                        ...(QuoDefinition.display || {}),
                        label: 'Quo (Zoho CRM)',
                    },
                },
            },
            zoho: {
                definition: {
                    ...zohoCrm.Definition,
                    getName: () => 'zoho',
                    moduleName: 'zoho',
                    env: {
                        ...zohoCrm.Definition.env,
                        redirect_uri: `${process.env.REDIRECT_URI}/zoho`,
                    },
                },
            },
        },
        webhooks: {
            enabled: true,
        },
        routes: [
            {
                path: '/zoho/contacts',
                method: 'GET',
                event: 'LIST_ZOHO_CONTACTS',
            },
            {
                path: '/zoho/accounts',
                method: 'GET',
                event: 'LIST_ZOHO_ACCOUNTS',
            },
        ],
    };

    static CRMConfig = {
        personObjectTypes: [
            { crmObjectName: 'Contact', quoContactType: 'contact' },
            { crmObjectName: 'Account', quoContactType: 'contact' },
        ],
        syncConfig: {
            paginationType: 'CURSOR_BASED',
            supportsTotal: false,
            returnFullRecords: true,
            reverseChronological: true,
            initialBatchSize: 50,
            ongoingBatchSize: 25,
            supportsWebhooks: true,
        },
        queueConfig: {
            maxWorkers: 15,
            provisioned: 5,
            maxConcurrency: 50,
            batchSize: 1,
            timeout: 600,
        },
    };

    /**
     * Quo webhook labels for identification
     */
    static WEBHOOK_LABELS = {
        QUO_MESSAGES: 'Zoho CRM Integration - Messages',
        QUO_CALLS: 'Zoho CRM Integration - Calls',
        QUO_CALL_SUMMARIES: 'Zoho CRM Integration - Call Summaries',
    };

    /**
     * Quo webhook event subscriptions
     */
    static WEBHOOK_EVENTS = {
        QUO_MESSAGES: [
            QuoWebhookEvents.MESSAGE_RECEIVED,
            QuoWebhookEvents.MESSAGE_DELIVERED,
        ],
        QUO_CALLS: [QuoWebhookEvents.CALL_COMPLETED],
        QUO_CALL_SUMMARIES: [QuoWebhookEvents.CALL_SUMMARY_COMPLETED],
    };

    static ZOHO_NOTIFICATION_CHANNEL_ID = 1735593600000; // Unique bigint channel ID for Zoho webhooks

    constructor(params) {
        super(params);

        this.commands = createFriggCommands({
            integrationClass: ZohoCRMIntegration,
        });

        this.schedulerCommands = createSchedulerCommands({
            integrationName: 'zoho',
        });

        this.events = {
            ...this.events,

            LIST_ZOHO_CONTACTS: {
                handler: this.listContacts,
            },
            LIST_ZOHO_ACCOUNTS: {
                handler: this.listAccounts,
            },
            REFRESH_WEBHOOK: {
                type: 'LIFE_CYCLE_EVENT',
                handler: this._onRefreshWebhook,
            },
        };
    }

    /**
     * @private
     * @param {Object} params
     * @param {string} params.receivedToken - Token from notification payload
     * @param {string} params.storedToken - Stored notification token from config
     * @returns {boolean} True if token is valid
     */
    _verifyNotificationToken({ receivedToken, storedToken }) {
        if (!receivedToken || !storedToken) {
            console.warn('[Zoho CRM] Missing received token or stored token');
            return false;
        }

        try {
            return receivedToken === storedToken;
        } catch (error) {
            console.error('[Zoho CRM] Token verification error:', error);
            return false;
        }
    }

    async fetchPersonPage({
        objectType,
        cursor = null,
        limit,
        modifiedSince,
        sortDesc = true,
    }) {
        try {
            const params = {
                per_page: limit,
                sort_order: sortDesc ? 'desc' : 'asc',
                sort_by: 'Modified_Time',
            };

            if (cursor) {
                params.page_token = cursor;
            }

            if (modifiedSince) {
                params.modified_since = modifiedSince
                    .toISOString()
                    .split('T')[0];
            }

            let response;

            switch (objectType) {
                case 'Contact':
                    response = await this.zoho.api.listContacts(params);
                    break;

                case 'Account':
                    response = await this.zoho.api.listAccounts(params);
                    break;

                default:
                    throw new Error(`Unsupported objectType: ${objectType}`);
            }

            const persons = response.data || [];

            const taggedPersons = persons.map((person) => ({
                ...person,
                _objectType: objectType,
            }));

            const nextCursor = response.info?.next_page_token || null;
            const hasMore = response.info?.more_records || false;

            console.log(
                `[Zoho] Fetched ${taggedPersons.length} ${objectType}(s) at cursor ${cursor || 'start'}, ` +
                    `hasMore=${hasMore}`,
            );

            return {
                data: taggedPersons,
                cursor: nextCursor,
                hasMore: hasMore,
            };
        } catch (error) {
            console.error(
                `Error fetching ${objectType} at cursor ${cursor}:`,
                error,
            );
            throw error;
        }
    }

    async transformPersonToQuo(person) {
        const objectType = person._objectType || 'Contact';

        const phoneNumbers = this._extractPhoneNumbers(person, objectType);
        const emails = this._extractEmails(person, objectType);
        const firstName = this._extractFirstName(person, objectType);
        const company = this._extractCompany(person, objectType);

        const externalId = String(person.id || person.Id || 'unknown');
        const source = 'openphone-zoho';

        // Generate sourceUrl for linking back to Zoho CRM
        const sourceUrl = `https://crm.zoho.com/crm/org/tab/Contacts/${externalId}`;

        return {
            externalId,
            source,
            sourceUrl,
            defaultFields: {
                firstName,
                lastName: person.Last_Name || '',
                company,
                phoneNumbers,
                emails,
                role: person.Title || '',
            },
            customFields: [],
            sourceEntityType: objectType.toLowerCase(),
        };
    }

    _extractFirstName(person, objectType) {
        if (objectType === 'Account') {
            return person.Account_Name || 'Unknown';
        }
        return person.First_Name || 'Unknown';
    }

    _extractPhoneNumbers(person, objectType) {
        const phones = [];

        if (person.Phone) {
            phones.push({ name: 'Work', value: person.Phone });
        }

        if (objectType === 'Contact' && person.Mobile) {
            phones.push({ name: 'Mobile', value: person.Mobile });
        }

        return phones;
    }

    _extractEmails(person, objectType) {
        const emails = [];

        if (objectType === 'Contact' && person.Email) {
            emails.push({ name: 'Work', value: person.Email });
        }

        return emails;
    }

    _extractCompany(person, objectType) {
        if (objectType === 'Account') {
            return person.Parent_Account?.name || null;
        }
        return person.Account_Name?.name || null;
    }

    async logSMSToActivity(activity) {
        console.warn(
            'SMS activity logging not supported - Zoho CRM API module lacks activities endpoint',
        );
        return;
    }

    async logCallToActivity(activity) {
        console.warn(
            'Call activity logging not supported - Zoho CRM API module lacks activities endpoint',
        );
        return;
    }

    /**
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
     * Verify Quo webhook signature using HMAC.
     * Tests multiple payload/key combinations to handle format variations.
     *
     * @private
     * @param {Object} headers - HTTP headers from webhook request
     * @param {Object} body - Webhook payload body
     * @param {string} eventType - Event type (e.g., 'call.completed', 'message.received')
     * @throws {Error} If signature is missing, invalid format, or verification fails
     */
    async _verifyQuoWebhookSignature(headers, body, eventType) {
        const signatureHeader = headers['openphone-signature'];

        if (!signatureHeader) {
            throw new Error('Missing Openphone-Signature header');
        }

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
            return; // Early return for legacy
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
            throw new Error('No webhooks configured for this event type');
        }

        // Strategy 1: Try to match webhook by ID from payload
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
                        `[Quo Webhook] ✓ Signature verified with webhook ${matchingWebhook.id}`,
                    );
                    return;
                } catch (err) {
                    // Continue to fallback
                }
            }
        }

        for (const webhook of webhookArray) {
            try {
                this._verifySignatureWithKey(
                    webhook.key,
                    timestamp,
                    body,
                    receivedSignature,
                );
                console.log(
                    `[Quo Webhook] ✓ Signature verified with webhook ${webhook.id}`,
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

        let matchFound = false;

        for (const format of testFormats) {
            const key =
                format.keyTransform === 'base64'
                    ? Buffer.from(webhookKey, 'base64')
                    : webhookKey;

            const hmac = crypto.createHmac('sha256', key);
            hmac.update(format.payload);
            const computedSignature = hmac.digest('base64');

            const matches =
                computedSignature.length === receivedSignature.length &&
                crypto.timingSafeEqual(
                    Buffer.from(computedSignature),
                    Buffer.from(receivedSignature),
                );

            if (matches) {
                matchFound = true;
                break;
            }
        }

        if (!matchFound) {
            throw new Error(
                'Webhook signature verification failed - no matching format found',
            );
        }
    }

    /**
     * Setup Zoho CRM notification channel for Contacts and Accounts events.
     * @returns {Promise<Object>} Status object with channel details
     */
    async setupZohoNotifications() {
        try {
            if (this.config?.zohoNotificationChannelId) {
                console.log(
                    `[Zoho CRM] Notification already registered: ${this.config.zohoNotificationChannelId}`,
                );
                return {
                    status: 'already_configured',
                    channelId: this.config.zohoNotificationChannelId,
                    notificationUrl: this.config.zohoNotificationUrl,
                    events: this.config.notificationEvents,
                };
            }

            if (!process.env.BASE_URL) {
                throw new Error(
                    'BASE_URL environment variable is required for notification registration',
                );
            }

            const notificationUrl = `${process.env.BASE_URL}/api/zoho-integration/webhooks/${this.id}`;

            console.log(
                `[Zoho CRM] Registering notification channel at: ${notificationUrl}`,
            );

            const crypto = require('crypto');
            const notificationToken = crypto.randomBytes(20).toString('hex');

            const notificationConfig = {
                watch: [
                    {
                        channel_id:
                            this.constructor.ZOHO_NOTIFICATION_CHANNEL_ID,
                        events: ['Accounts.all', 'Contacts.all'],
                        notify_url: notificationUrl,
                        token: notificationToken,
                        return_affected_field_values: true,
                        notify_on_related_action: false,
                    },
                ],
            };

            console.log(
                `[Zoho CRM] Enabling notification channel at ${notificationUrl}`,
            );

            const response =
                await this.zoho.api.enableNotification(notificationConfig);

            if (
                !response?.watch ||
                response.watch.length === 0 ||
                response.watch[0].status !== 'success'
            ) {
                throw new Error(
                    `Notification channel creation failed: ${JSON.stringify(response)}`,
                );
            }

            const subscribedResources = response.watch[0].details.events
                .map((e) => e.resource_name)
                .join(', ');
            console.log(
                `[Zoho CRM] ✓ Notification channel ${this.constructor.ZOHO_NOTIFICATION_CHANNEL_ID} enabled for: ${subscribedResources}`,
            );

            const updatedConfig = {
                ...this.config,
                zohoNotificationChannelId:
                    this.constructor.ZOHO_NOTIFICATION_CHANNEL_ID,
                zohoNotificationToken: notificationToken,
                zohoNotificationUrl: notificationUrl,
                notificationCreatedAt: new Date().toISOString(),
                notificationEvents: ['Accounts.all', 'Contacts.all'],
            };

            await this.commands.updateIntegrationConfig({
                integrationId: this.id,
                config: updatedConfig,
            });

            this.config = updatedConfig;

            console.log(
                `[Zoho CRM] ✓ Notification channel configured successfully`,
            );
            console.log(
                `[Zoho CRM] ✓ Verification token stored securely (encrypted at rest)`,
            );

            // Schedule automatic renewal before expiration (6 days from now)
            await this._scheduleNotificationRenewal();

            return {
                status: 'configured',
                channelId: this.constructor.ZOHO_NOTIFICATION_CHANNEL_ID,
                notificationUrl: notificationUrl,
                events: ['Accounts.all', 'Contacts.all'],
            };
        } catch (error) {
            console.error('[Zoho CRM] Failed to setup notifications:', error);
            throw error;
        }
    }

    /**
     * Schedule automatic notification renewal before expiration.
     * Zoho notifications expire after max 7 days, so we renew at 6 days.
     * @private
     * @returns {Promise<void>}
     */
    async _scheduleNotificationRenewal() {
        try {
            // Calculate renewal date: 6 days from now
            const renewalDate = new Date();
            renewalDate.setDate(renewalDate.getDate() + 6);

            const jobId = `zoho-notif-renewal-${this.id}`;

            // Get queue ARN from environment
            const queueArn = process.env.ZOHO_QUEUE_ARN;
            if (!queueArn) {
                console.warn(
                    '[Zoho CRM] ZOHO_QUEUE_ARN not set, skipping notification renewal scheduling'
                );
                return;
            }

            const result = await this.schedulerCommands.scheduleJob({
                jobId,
                scheduledAt: renewalDate,
                event: 'REFRESH_WEBHOOK',
                payload: { integrationId: this.id },
                queueArn,
            });

            if (result.error) {
                console.warn(
                    `[Zoho CRM] Failed to schedule notification renewal: ${result.reason}`
                );
                return;
            }

            // Store the job ID in config for cleanup on delete
            const updatedConfig = {
                ...this.config,
                zohoNotificationRefreshJobId: jobId,
            };

            await this.commands.updateIntegrationConfig({
                integrationId: this.id,
                config: updatedConfig,
            });

            this.config = updatedConfig;

            console.log(
                `[Zoho CRM] ✓ Scheduled notification renewal for ${renewalDate.toISOString()}`
            );
        } catch (error) {
            console.warn(
                '[Zoho CRM] Failed to schedule notification renewal:',
                error.message
            );
            // Don't throw - notification setup should still succeed
        }
    }

    /**
     * Handle REFRESH_WEBHOOK event to renew Zoho notification before expiration.
     * @private
     * @param {Object} params - Event parameters
     * @param {Object} params.data - Event data containing integrationId
     * @returns {Promise<void>}
     */
    async _onRefreshWebhook({ data }) {
        const { integrationId } = data || {};

        console.log(
            `[Zoho CRM] Processing REFRESH_WEBHOOK for integration ${integrationId || this.id}`
        );

        try {
            // Verify we have the necessary modules
            if (!this.zoho?.api) {
                throw new Error('Zoho API module not initialized');
            }

            // Verify notification config exists
            if (!this.config?.zohoNotificationChannelId) {
                console.warn(
                    '[Zoho CRM] No notification channel configured, skipping renewal'
                );
                return;
            }

            // Calculate new expiry (7 days from now - Zoho max)
            const newExpiry = new Date();
            newExpiry.setDate(newExpiry.getDate() + 7);

            // Prepare the update config
            const updateConfig = {
                watch: [
                    {
                        channel_id: this.config.zohoNotificationChannelId,
                        events: this.config.notificationEvents || [
                            'Accounts.all',
                            'Contacts.all',
                        ],
                        channel_expiry: newExpiry.toISOString(),
                        token: this.config.zohoNotificationToken,
                        notify_url: this.config.zohoNotificationUrl,
                    },
                ],
            };

            console.log(
                `[Zoho CRM] Renewing notification channel ${this.config.zohoNotificationChannelId} until ${newExpiry.toISOString()}`
            );

            // Call Zoho API to update/renew notification
            const response = await this.zoho.api.updateNotification(updateConfig);

            if (
                !response?.watch ||
                response.watch.length === 0 ||
                response.watch[0].status !== 'success'
            ) {
                throw new Error(
                    `Notification renewal failed: ${JSON.stringify(response)}`
                );
            }

            console.log(
                `[Zoho CRM] ✓ Notification channel renewed successfully`
            );

            // Update config with new renewal timestamp
            const updatedConfig = {
                ...this.config,
                notificationCreatedAt: new Date().toISOString(),
            };

            await this.commands.updateIntegrationConfig({
                integrationId: this.id,
                config: updatedConfig,
            });

            this.config = updatedConfig;

            // Schedule the next renewal (6 days from now)
            await this._scheduleNotificationRenewal();
        } catch (error) {
            console.error(
                '[Zoho CRM] Failed to renew notification:',
                error.message
            );
            throw error;
        }
    }

    /**
     * BACKWARDS COMPATIBILITY: Migrates old single-webhook structure to new array structure
     * @private
     * @returns {Promise<boolean>} True if migration performed, false if no old structure found
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

        const updatedConfig = {
            ...this.config,
            quoMessageWebhooks: messageWebhooks,
            quoCallWebhooks: callWebhooks,
            quoCallSummaryWebhooks: callSummaryWebhooks,
            // Remove old fields
            quoMessageWebhookId: undefined,
            quoMessageWebhookKey: undefined,
            quoCallWebhookId: undefined,
            quoCallWebhookKey: undefined,
            quoCallSummaryWebhookId: undefined,
            quoCallSummaryWebhookKey: undefined,
        };

        await this.updateConfig(updatedConfig);

        console.log(
            `[Quo] ✓ Migration complete: ${messageWebhooks.length} message, ${callWebhooks.length} call, ${callSummaryWebhooks.length} call-summary webhook(s) migrated`,
        );

        return true;
    }

    /**
     * Setup Quo webhooks for call and message events.
     * Registers 3 webhooks atomically with rollback on failure.
     * @returns {Promise<Object>} Status object with webhook IDs or error
     */
    async setupQuoWebhook() {
        const createdWebhooks = [];

        try {
            // BACKWARDS COMPATIBILITY: Check for old structure (single webhook) - migrate if found
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

            const webhookUrl = this._generateWebhookUrl(`/webhooks/${this.id}`);

            console.log(
                `[Quo] Registering message and call webhooks at: ${webhookUrl}`,
            );

            const { messageWebhooks, callWebhooks, callSummaryWebhooks } =
                await this._createQuoWebhooksWithPhoneIds(webhookUrl);

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
     * Setup webhooks with both Zoho CRM and Quo.
     * @returns {Promise<Object>} Setup result
     */
    async setupWebhooks() {
        const results = {
            zoho: null,
            quo: null,
            overallStatus: 'success',
        };

        const [zohoResult, quoResult] = await Promise.allSettled([
            this.setupZohoNotifications(),
            this.setupQuoWebhook(),
        ]);

        if (zohoResult.status === 'fulfilled') {
            results.zoho = zohoResult.value;
            console.log('[Webhook Setup] ✓ Zoho CRM notifications configured');
        } else {
            results.zoho = {
                status: 'failed',
                error: zohoResult.reason.message,
            };
            console.error(
                '[Webhook Setup] ✗ Zoho CRM notification setup failed:',
                zohoResult.reason.message,
            );

            // Log warning for Zoho failure (non-fatal)
            await this.updateIntegrationMessages.execute(
                this.id,
                'warnings',
                'Zoho CRM Notification Setup Failed',
                `Could not register notifications with Zoho CRM: ${zohoResult.reason.message}. Integration will function without Zoho notifications, but changes in Zoho CRM will not sync automatically.`,
                Date.now(),
            );
        }

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

        const zohoSuccess =
            zohoResult.status === 'fulfilled' &&
            results.zoho.status !== 'failed';
        const quoSuccess =
            quoResult.status === 'fulfilled' && results.quo.status !== 'failed';

        if (zohoSuccess && quoSuccess) {
            results.overallStatus = 'success';
            console.log(
                '[Webhook Setup] ✓ All webhooks configured successfully',
            );
        } else if (quoSuccess) {
            results.overallStatus = 'partial';
            console.log(
                '[Webhook Setup] ⚠ Partial success - Quo webhooks configured, Zoho CRM notifications failed',
            );
        } else if (zohoSuccess) {
            results.overallStatus = 'failed';
            console.error(
                '[Webhook Setup] ✗ Failed - Quo webhooks required for integration to function',
            );
            throw new Error(
                'Quo webhook setup failed. Quo webhooks are required for integration to function.',
            );
        } else {
            results.overallStatus = 'failed';
            console.error(
                '[Webhook Setup] ✗ Failed - Both webhook setups failed',
            );
            throw new Error(
                'Both Zoho CRM and Quo webhook setups failed. Integration cannot function without Quo webhooks.',
            );
        }

        return results;
    }

    /**
     * HTTP webhook receiver - detects and routes Zoho CRM and Quo webhooks.
     * Called before queuing to SQS (no database connection).
     * @param {Object} params
     * @param {Object} params.req - Express request object
     * @param {Object} params.res - Express response object
     */
    async onWebhookReceived({ req, res }) {
        try {
            const hasZohoNotificationFormat =
                req.body?.channel_id && req.body?.ids;

            const source = hasZohoNotificationFormat ? 'zoho' : 'quo';

            if (source === 'zoho') {
                if (!req.body?.ids || !Array.isArray(req.body.ids)) {
                    console.error(
                        '[Zoho Notification] Invalid payload format - missing ids array',
                    );
                    res.status(400).json({
                        error: 'Invalid notification payload',
                    });
                    return;
                }
            }

            const webhookData = {
                body: req.body,
                headers: req.headers,
                integrationId: req.params.integrationId,
                source: source,
                receivedAt: new Date().toISOString(),
            };

            console.log(`[${source}] Received event:`, {
                module: req.body.module || req.body.module_name,
                recordCount: req.body.ids?.length || 1,
                operation: req.body.operation || req.body.event_type,
            });

            await this.queueWebhook(webhookData);

            res.status(200).json({ received: true });
        } catch (error) {
            console.error('[Webhook/Notification] Receive error:', error);
            throw error;
        }
    }

    /**
     * Process webhook events from both Zoho CRM and Quo.
     * @param {Object} params
     * @param {Object} params.data - Webhook data from queue
     * @returns {Promise<Object>} Processing result
     */
    async onWebhook({ data }) {
        const { source } = data;

        console.log(`[Webhook] Processing ${source} event`);

        if (source === 'quo') {
            return await this._handleQuoWebhook(data);
        } else {
            return await this._handleZohoNotification(data);
        }
    }

    /**
     * @private
     * @param {Object} data - Zoho CRM notification payload
     * @returns {Promise<Object>} Processing result
     */
    async _handleZohoNotification(data) {
        const { body } = data;

        console.log(`[Zoho Notification] Processing event:`, {
            module: body.module,
            recordCount: body.ids.length,
            operation: body.operation,
            channelId: body.channel_id,
        });

        try {
            const storedToken = this.config?.zohoNotificationToken;

            if (storedToken && body.token) {
                const isValid = this._verifyNotificationToken({
                    receivedToken: body.token,
                    storedToken: storedToken,
                });

                if (!isValid) {
                    console.error(
                        '[Zoho Notification] Invalid token - possible security issue!',
                    );
                    throw new Error('Notification token verification failed');
                }

                console.log('[Zoho Notification] ✓ Token verified');
            } else {
                console.warn(
                    '[Zoho Notification] No token - skipping verification',
                );
            }

            const moduleName = body.module;
            const recordIds = body.ids;
            const operation = body.operation;

            if (!moduleName || !recordIds || recordIds.length === 0) {
                throw new Error('Notification payload missing module or ids');
            }

            let objectType;
            if (moduleName === 'Contacts') {
                objectType = 'Contact';
            } else if (moduleName === 'Accounts') {
                objectType = 'Account';
            } else {
                console.log(
                    `[Zoho Notification] Unhandled module: ${moduleName}`,
                );
                return {
                    success: true,
                    skipped: true,
                    reason: `Module '${moduleName}' not configured for sync`,
                };
            }

            const results = [];
            for (const recordId of recordIds) {
                try {
                    await this._handlePersonWebhook({
                        objectType: objectType,
                        recordId: recordId,
                        moduleName: moduleName,
                        operation: operation,
                    });
                    results.push({ recordId, status: 'success' });
                } catch (error) {
                    console.error(
                        `[Zoho Notification] Failed to process ${objectType} ${recordId}:`,
                        error.message,
                    );
                    results.push({
                        recordId,
                        status: 'error',
                        error: error.message,
                    });
                }
            }

            const successCount = results.filter(
                (r) => r.status === 'success',
            ).length;
            const errorCount = results.filter(
                (r) => r.status === 'error',
            ).length;

            console.log(
                `[Zoho Notification] ✓ Processed ${successCount}/${recordIds.length} records (${errorCount} errors)`,
            );

            return {
                success: true,
                operation: operation,
                module: moduleName,
                recordCount: recordIds.length,
                successCount: successCount,
                errorCount: errorCount,
                results: results,
                processedAt: new Date().toISOString(),
            };
        } catch (error) {
            console.error('[Zoho Notification] Processing error:', error);

            await this.updateIntegrationMessages.execute(
                this.id,
                'errors',
                'Notification Processing Error',
                `Failed to process ${body.module} notification (${body.ids.length} records): ${error.message}`,
                Date.now(),
            );

            throw error;
        }
    }

    /**
     * @private
     * @param {Object} data - Quo webhook data from queue
     * @returns {Promise<Object>} Processing result
     */
    async _handleQuoWebhook(data) {
        const { body, headers } = data;
        const eventType = body.type; // "call.completed", "message.received", etc.

        console.log(`[Quo Webhook] Processing event: ${eventType}`);

        try {
            // TODO(quo-webhooks): Re-enable signature verification once Quo/OpenPhone
            //await this._verifyQuoWebhookSignature(headers, body, eventType);

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
                trackAnalyticsEvent(
                    this,
                    QUO_ANALYTICS_EVENTS.MESSAGE_LOG_FAILED,
                    {
                        messageId: body.data?.object?.id,
                        error: error.message,
                    },
                );
            } else if (eventType.startsWith('call.')) {
                trackAnalyticsEvent(
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
     * @private
     * @param {string} phone - Phone number to normalize
     * @returns {string} Normalized phone number (E.164 format preserved)
     */
    _normalizePhoneNumber(phone) {
        if (!phone) return phone;
        return phone.replace(/[\s\(\)\-]/g, '');
    }

    _formatDateTimeForZoho(isoString) {
        if (!isoString) return null;
        return isoString.replace(/\.\d{3}Z$/, '+00:00').replace(/Z$/, '+00:00');
    }

    /**
     * @private
     * @param {string} phoneNumber - Phone number to search for
     * @returns {Promise<string|null>} Zoho CRM record ID or null if not found
     */
    async _findZohoContactByPhone(phoneNumber) {
        console.log(
            `[Quo Webhook] Looking up Zoho CRM contact by phone: ${phoneNumber}`,
        );

        const normalizedPhone = this._normalizePhoneNumber(phoneNumber);
        console.log(
            `[Quo Webhook] Normalized phone: ${phoneNumber} → ${normalizedPhone}`,
        );

        try {
            const searchCriteria = `((Phone:equals:${normalizedPhone})or(Mobile:equals:${normalizedPhone}))`;

            const searchResults = await this.zoho.api.searchContacts({
                criteria: searchCriteria,
            });

            if (searchResults?.data && searchResults.data.length > 0) {
                const contactId = searchResults.data[0].id;
                console.log(
                    `[Quo Webhook] ✓ Found Zoho CRM contact: ${contactId}`,
                );
                return contactId;
            }

            console.log(
                `[Quo Webhook] No Zoho CRM contact found for phone: ${phoneNumber}`,
            );
            return null;
        } catch (error) {
            throw new Error(
                `Failed to search for Zoho CRM contact: ${error.message}`,
            );
        }
    }

    /**
     * Handle Quo call.completed webhook event.
     * Zoho uses Calls module with specific fields (Call_Type, Call_Duration).
     * @private
     * @param {Object} webhookData - Quo webhook payload
     * @returns {Promise<Object>} Processing result
     */
    async _handleQuoCallEvent(webhookData) {
        const callId = webhookData.data.object.id;
        const formatOptions =
            QuoCallContentBuilder.getFormatOptions('plainText');

        console.log(`[Quo Webhook] Processing call.completed: ${callId}`);

        const callObject =
            await QuoWebhookEventProcessor.fetchCallWithVoicemail(
                this.quo.api,
                callId,
            );

        if (!callObject) {
            console.warn(`[Quo Webhook] Call ${callId} not found`);
            return { logged: false, error: 'Call not found', callId };
        }

        const externalParticipants = filterExternalParticipants(
            callObject.participants || [],
            this.config?.phoneNumbersMetadata || [],
        );

        if (externalParticipants.length === 0) {
            console.warn(
                `[Quo Webhook] No external participants found for call ${callId}`,
            );
            return {
                logged: false,
                callId,
                error: 'No external participants',
                participantCount: 0,
            };
        }

        console.log(
            `[Quo Webhook] Found ${externalParticipants.length} external participant(s)`,
        );

        const { inboxName, inboxNumber, userName } =
            await QuoWebhookEventProcessor.fetchCallMetadata(
                this.quo.api,
                callObject.phoneNumberId,
                callObject.userId,
            );

        const deepLink = webhookData.data.deepLink || '#';
        const wasAnswered =
            callObject.answeredAt !== null &&
            callObject.answeredAt !== undefined;

        const statusDescription =
            QuoCallContentBuilder.buildCallStatus({
                call: callObject,
                userName,
            }) + '.';

        let callType;
        if (callObject.direction === 'outgoing') {
            callType = 'Outbound';
        } else if (!wasAnswered) {
            callType = 'Missed';
        } else {
            callType = 'Inbound';
        }

        const zohoDuration = QuoWebhookEventProcessor._formatDurationForZoho(
            callType === 'Missed' && callObject.duration === 0
                ? 0
                : callObject.duration,
        );

        const results = [];
        for (const contactPhone of externalParticipants) {
            const zohoContactId =
                await this._findZohoContactByPhone(contactPhone);

            if (!zohoContactId) {
                console.log(
                    `[Quo Webhook] ℹ️ No contact found for phone ${contactPhone} in Zoho CRM, trying next`,
                );
                results.push({
                    contactPhone,
                    zohoContactId: null,
                    zohoCallId: null,
                    logged: false,
                });
                continue;
            }

            const subject = QuoCallContentBuilder.buildCallTitle({
                call: callObject,
                inboxName,
                inboxNumber,
                contactPhone,
                formatOptions,
            });

            let description = statusDescription;

            if (
                callObject.status === 'completed' &&
                callObject.duration > 0 &&
                wasAnswered
            ) {
                description += QuoCallContentBuilder.buildRecordingSuffix({
                    call: callObject,
                    formatOptions,
                });
            }

            if (callObject.voicemail && callObject.voicemail.duration) {
                description += QuoCallContentBuilder.buildVoicemailSection({
                    voicemail: callObject.voicemail,
                    formatOptions,
                });
            }

            description += QuoCallContentBuilder.buildDeepLink({
                deepLink,
                formatOptions,
            });

            const callPayload = {
                Subject: subject,
                Call_Type: callType,
                Call_Start_Time: this._formatDateTimeForZoho(
                    callObject.createdAt || new Date().toISOString(),
                ),
                Call_Duration: zohoDuration,
                Description: description,
                Who_Id: zohoContactId,
                $se_module: 'Contacts',
            };

            if (callType === 'Missed' && callObject.voicemail?.url) {
                callPayload.Voice_Recording__s = callObject.voicemail.url;
            }

            const callResponse = await this.zoho.api.logCall(callPayload);

            const zohoCallId = callResponse?.data?.[0]?.details?.id || null;

            if (zohoCallId) {
                await this.upsertMapping(callId, {
                    zohoCallId,
                    callId,
                    zohoContactId,
                    createdAt: new Date().toISOString(),
                });
                console.log(
                    `[Quo Webhook] ✓ Logged call for ${contactPhone}, zohoCallId: ${zohoCallId}`,
                );
            }

            results.push({
                contactPhone,
                zohoContactId,
                zohoCallId,
                logged: !!zohoCallId,
            });
        }

        trackAnalyticsEvent(this, QUO_ANALYTICS_EVENTS.CALL_LOGGED, {
            callId: callObject.id,
        });

        return {
            logged: results.some((r) => r.logged),
            callId,
            participantCount: externalParticipants.length,
            results,
        };
    }

    /**
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
                useEmoji: false,
                findContactByPhone: async (phone) => {
                    return await this._findZohoContactByPhone(phone);
                },
                createMessageActivity: async (contactId, activity) => {
                    const noteResponse = await this.zoho.api.createNote(
                        'Contacts',
                        contactId,
                        {
                            Note_Title: activity.title,
                            Note_Content: activity.content,
                        },
                    );

                    if (noteResponse.data[0].code !== 'SUCCESS') {
                        throw new Error(
                            `Failed to create note: ${noteResponse.data[0].message}`,
                        );
                    }

                    return noteResponse.data[0]?.details?.id || null;
                },
            },
            mappingRepo: {
                get: (id) => this.getMapping(id),
                upsert: (id, data) => this.upsertMapping(id, data),
            },
            onActivityCreated: ({ messageId }) => {
                trackAnalyticsEvent(this, QUO_ANALYTICS_EVENTS.MESSAGE_LOGGED, {
                    messageId,
                });
            },
        });

        return result;
    }

    /**
     * Enriches existing Zoho CRM call with AI summary, recordings, and voicemails.
     * @private
     * @param {Object} webhookData - Quo webhook payload
     * @returns {Promise<Object>} Processing result
     */
    async _handleQuoCallSummaryEvent(webhookData) {
        const summaryObject = webhookData.data.object;
        const callId = summaryObject.callId;
        const summary = summaryObject.summary || [];
        const nextSteps = summaryObject.nextSteps || [];
        const formatOptions =
            QuoCallContentBuilder.getFormatOptions('plainText');

        console.log(
            `[Quo Webhook] Processing call summary for call: ${callId}, ${summary.length} summary points, ${nextSteps.length} next steps`,
        );

        // Fetch the original call details
        const callDetails = await this.quo.api.getCall(callId);
        if (!callDetails?.data) {
            console.warn(
                `[Quo Webhook] Call ${callId} not found, cannot create summary`,
            );
            return {
                received: true,
                callId,
                logged: false,
                error: 'Call not found',
            };
        }

        const callObject = callDetails.data;

        const participants = callObject.participants || [];
        if (participants.length < 2) {
            console.warn(
                `[Quo Webhook] Call ${callId} has insufficient participants`,
            );
            return {
                received: true,
                callId,
                logged: false,
                error: 'Insufficient participants',
            };
        }

        const externalParticipants = filterExternalParticipants(
            participants,
            this.config?.phoneNumbersMetadata || [],
        );

        if (externalParticipants.length === 0) {
            console.warn(
                `[Quo Webhook] No external participants found for call ${callId}`,
            );
            return {
                received: true,
                callId,
                logged: false,
                error: 'No external participants',
            };
        }

        console.log(
            `[Quo Webhook] Found ${externalParticipants.length} external participant(s) for summary`,
        );

        const deepLink = webhookData.data.deepLink || '#';

        const phoneNumberDetails = await this.quo.api.getPhoneNumber(
            callObject.phoneNumberId,
        );
        const inboxName =
            QuoCallContentBuilder.buildInboxName(phoneNumberDetails);
        const inboxNumber =
            phoneNumberDetails.data?.number ||
            phoneNumberDetails.data?.formattedNumber ||
            participants[callObject.direction === 'outgoing' ? 0 : 1];

        const userDetails = await this.quo.api.getUser(callObject.userId);
        const userName = QuoCallContentBuilder.buildUserName(userDetails);

        const wasAnswered =
            callObject.answeredAt !== null &&
            callObject.answeredAt !== undefined;

        let callType;
        if (callObject.direction === 'outgoing') {
            callType = 'Outbound';
        } else if (!wasAnswered) {
            callType = 'Missed';
        } else {
            callType = 'Inbound';
        }

        const zohoDuration = QuoWebhookEventProcessor._formatDurationForZoho(
            callType === 'Missed' && callObject.duration === 0
                ? 0
                : callObject.duration,
        );

        const results = [];
        for (const contactPhone of externalParticipants) {
            const zohoContactId =
                await this._findZohoContactByPhone(contactPhone);

            if (!zohoContactId) {
                console.log(
                    `[Quo Webhook] ℹ️ No contact found for phone ${contactPhone} in Zoho CRM, trying next`,
                );
                results.push({
                    contactPhone,
                    zohoContactId: null,
                    zohoCallId: null,
                    logged: false,
                });
                continue;
            }

            const enrichmentResult =
                await CallSummaryEnrichmentService.enrichCallNote({
                    callId,
                    summaryData: { summary, nextSteps },
                    callDetails: callObject,
                    quoApi: this.quo.api,
                    crmAdapter: {
                        canUpdateNote: () => true, // Zoho CRM supports call updates!
                        createNote: async ({ contactId, content, title }) => {
                            const callResponse = await this.zoho.api.logCall({
                                Subject: title,
                                Call_Type: callType,
                                Call_Start_Time: this._formatDateTimeForZoho(
                                    callObject.createdAt ||
                                        new Date().toISOString(),
                                ),
                                Call_Duration: zohoDuration,
                                Description: content,
                                Who_Id: contactId,
                                $se_module: 'Contacts',
                            });
                            return callResponse?.data?.[0]?.details?.id || null;
                        },
                        updateNote: async (zohoCallId, { content, title }) => {
                            return await this.zoho.api.updateCall(zohoCallId, {
                                Subject: title,
                                Description: content,
                            });
                        },
                    },
                    mappingRepo: {
                        get: async (id) => await this.getMapping(id),
                        upsert: async (id, data) =>
                            await this.upsertMapping(id, data),
                    },
                    contactId: zohoContactId,
                    formatters: {
                        formatMethod: 'plainText',
                        formatCallHeader: (callData) =>
                            QuoCallContentBuilder.buildCallStatus({
                                call: callData,
                                userName,
                            }),
                        formatTitle: (callData) =>
                            QuoCallContentBuilder.buildCallTitle({
                                call: callData,
                                inboxName,
                                inboxNumber,
                                contactPhone,
                                formatOptions,
                            }),
                        formatDeepLink: () =>
                            QuoCallContentBuilder.buildDeepLink({
                                deepLink,
                                formatOptions,
                            }),
                    },
                });

            console.log(
                `[Quo Webhook] ✓ Call summary enrichment complete for contact ${zohoContactId}`,
            );

            trackAnalyticsEvent(this, QUO_ANALYTICS_EVENTS.CALL_LOGGED, {
                callId,
            });

            results.push({
                contactPhone,
                zohoContactId,
                zohoCallId: enrichmentResult.noteId,
                oldZohoCallId: enrichmentResult.oldNoteId,
                logged: true,
                recordingsCount: enrichmentResult.recordingsCount,
                hasVoicemail: enrichmentResult.hasVoicemail,
            });
        }

        return {
            received: true,
            callId,
            results,
            summaryPoints: summary.length,
            nextStepsCount: nextSteps.length,
        };
    }

    async _handlePersonWebhook({
        objectType,
        recordId,
        moduleName,
        operation,
    }) {
        console.log(`[Zoho CRM Webhook] Handling ${objectType}: ${recordId}`);

        try {
            await this._syncPersonToQuo(objectType, recordId, operation);

            await this.upsertMapping(recordId, {
                externalId: recordId,
                entityType: objectType,
                lastSyncedAt: new Date().toISOString(),
                syncMethod: 'webhook',
                moduleName: moduleName,
                operation: operation,
            });

            console.log(
                `[Zoho CRM Webhook] ✓ Synced ${objectType} ${recordId} to Quo`,
            );
        } catch (error) {
            console.error(
                `[Zoho CRM Webhook] Failed to sync ${objectType} ${recordId}:`,
                error.message,
            );
            throw error;
        }
    }

    async _fetchZohoObject(objectType, recordId) {
        let person;

        if (objectType === 'Contact') {
            const response = await this.zoho.api.getContact(recordId);

            if (!response.data) {
                throw new Error(`No data returned for Contact ${recordId}`);
            }

            if (Array.isArray(response.data)) {
                if (response.data.length === 0) {
                    throw new Error(
                        `Contact ${recordId} not found (empty array)`,
                    );
                }
                person = response.data[0];
            } else {
                person = response.data;
            }
        } else if (objectType === 'Account') {
            const response = await this.zoho.api.getAccount(recordId);

            if (!response.data) {
                throw new Error(`No data returned for Account ${recordId}`);
            }

            if (Array.isArray(response.data)) {
                if (response.data.length === 0) {
                    throw new Error(
                        `Account ${recordId} not found (empty array)`,
                    );
                }
                person = response.data[0];
            } else {
                person = response.data;
            }
        } else {
            throw new Error(`Unknown object type: ${objectType}`);
        }

        if (!person) {
            throw new Error(`${objectType} ${recordId} not found in Zoho CRM`);
        }

        person._objectType = objectType;
        return person;
    }

    async _syncPersonToQuo(objectType, recordId, operation) {
        console.log(
            `[Zoho CRM] Syncing ${objectType} ${recordId} to Quo (${operation})`,
        );

        try {
            if (!this.quo?.api) {
                throw new Error('Quo API not available');
            }

            const externalId = String(recordId);

            if (operation === 'delete') {
                const existingContacts = await this.quo.api.listContacts({
                    externalIds: [externalId],
                    maxResults: 10,
                });

                const exactMatch =
                    existingContacts?.data && existingContacts.data.length > 0
                        ? existingContacts.data.find(
                              (contact) => contact.externalId === externalId,
                          )
                        : null;

                if (exactMatch) {
                    await this.quo.api.deleteContact(exactMatch.id);
                    console.log(
                        `[Zoho CRM] ✓ Deleted Quo contact ${exactMatch.id} for ${objectType} ${externalId}`,
                    );
                    trackAnalyticsEvent(
                        this,
                        QUO_ANALYTICS_EVENTS.CONTACT_DELETED,
                        { contactId: externalId },
                    );
                } else {
                    console.log(
                        `[Zoho CRM] Contact for ${objectType} ${externalId} not found in Quo, nothing to delete`,
                    );
                }
                return;
            }

            const person = await this._fetchZohoObject(objectType, recordId);
            const quoContact = await this.transformPersonToQuo(person);

            const result = await this.upsertContactToQuo(quoContact);

            console.log(
                `[Zoho CRM] ✓ Contact ${result.action} in Quo (externalId: ${quoContact.externalId}, quoContactId: ${result.quoContactId})`,
            );

            const analyticsEvent =
                result.action === 'created'
                    ? QUO_ANALYTICS_EVENTS.CONTACT_IMPORT
                    : QUO_ANALYTICS_EVENTS.CONTACT_UPDATED;
            trackAnalyticsEvent(this, analyticsEvent, {
                contactId: externalId,
            });

            console.log(
                `[Zoho CRM] ✓ ${objectType} ${externalId} synced to Quo`,
            );
        } catch (error) {
            console.error(
                `[Zoho CRM] Failed to sync ${objectType} ${recordId}:`,
                error.message,
            );
            trackAnalyticsEvent(
                this,
                QUO_ANALYTICS_EVENTS.CONTACT_SYNC_FAILED,
                {
                    contactId: String(recordId),
                    error: error.message,
                },
            );
            throw error;
        }
    }

    async fetchPersonById(id) {
        try {
            const contact = await this.zoho.api.getContact(id);
            return { ...contact.data, _objectType: 'Contact' };
        } catch (contactError) {
            try {
                const account = await this.zoho.api.getAccount(id);
                return { ...account.data, _objectType: 'Account' };
            } catch (accountError) {
                throw new Error(`Person not found: ${id}`);
            }
        }
    }

    async findPersonByExternalId(externalId) {
        try {
            const contact = await this.zoho.api.getContact(externalId);
            return { ...contact.data, _objectType: 'Contact' };
        } catch (contactError) {
            try {
                const account = await this.zoho.api.getAccount(externalId);
                return { ...account.data, _objectType: 'Account' };
            } catch (accountError) {
                return null;
            }
        }
    }

    async fetchPersonsByIds(ids) {
        if (!ids || ids.length === 0) {
            return [];
        }

        const contacts = [];
        for (const id of ids) {
            try {
                const contact = await this.fetchPersonById(id);
                contacts.push(contact);
            } catch (error) {
                console.error(`Failed to fetch contact ${id}:`, error.message);
            }
        }
        return contacts;
    }

    async listContacts({ req, res }) {
        try {
            const params = {
                per_page: req.query.per_page
                    ? parseInt(req.query.per_page)
                    : 50,
                page: req.query.page ? parseInt(req.query.page) : 1,
                sort_order: req.query.sort_order || 'asc',
                sort_by: req.query.sort_by || 'Created_Time',
            };

            const contacts = await this.zoho.api.listContacts(params);
            res.json(contacts);
        } catch (error) {
            console.error('Failed to list Zoho contacts:', error);
            res.status(500).json({
                error: 'Failed to list contacts',
                details: error.message,
            });
        }
    }

    async listAccounts({ req, res }) {
        try {
            const params = {
                per_page: req.query.per_page
                    ? parseInt(req.query.per_page)
                    : 50,
                page: req.query.page ? parseInt(req.query.page) : 1,
                sort_order: req.query.sort_order || 'asc',
                sort_by: req.query.sort_by || 'Created_Time',
            };

            const accounts = await this.zoho.api.listAccounts(params);
            res.json(accounts);
        } catch (error) {
            console.error('Failed to list Zoho accounts:', error);
            res.status(500).json({
                error: 'Failed to list accounts',
                details: error.message,
            });
        }
    }

    /**
     * Clean up webhook registrations when integration is deleted.
     * @param {Object} params - Deletion parameters
     */
    async onDelete(params) {
        if (!this.zoho?.api || !this.quo?.api) {
            const missingModules = [];
            if (!this.zoho?.api) missingModules.push('zoho');
            if (!this.quo?.api) missingModules.push('quo');

            console.error(
                `[Webhook Cleanup] Cannot delete webhooks: Missing API modules: ${missingModules.join(', ')}`,
            );
            console.error(
                '[Webhook Cleanup] This likely means modules were not loaded during the deletion lifecycle.',
            );

            const notificationChannelId =
                this.config?.zohoNotificationChannelId;
            const quoMessageWebhooks = this.config?.quoMessageWebhooks || [];
            const quoCallWebhooks = this.config?.quoCallWebhooks || [];
            const quoCallSummaryWebhooks =
                this.config?.quoCallSummaryWebhooks || [];

            if (
                notificationChannelId ||
                quoMessageWebhooks.length > 0 ||
                quoCallWebhooks.length > 0 ||
                quoCallSummaryWebhooks.length > 0
            ) {
                console.warn(
                    '[Webhook Cleanup] Webhooks preserved in config for manual cleanup:',
                );

                if (notificationChannelId) {
                    console.warn(
                        `  - Zoho CRM notification channel: ${notificationChannelId}`,
                    );
                }

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

                if (notificationChannelId) {
                    console.warn(
                        '[Webhook Cleanup] You will need to manually disable the notification channel from Zoho CRM.',
                    );
                }
                if (
                    quoMessageWebhooks.length > 0 ||
                    quoCallWebhooks.length > 0 ||
                    quoCallSummaryWebhooks.length > 0
                ) {
                    console.warn(
                        '[Webhook Cleanup] You will need to manually delete the Quo webhooks.',
                    );
                }
            }

            await super.onDelete(params);
            return;
        }

        try {
            const notificationChannelId =
                this.config?.zohoNotificationChannelId;

            if (notificationChannelId) {
                console.log('[Zoho CRM] Disabling notification channel');

                try {
                    await this.zoho.api.disableNotification([
                        notificationChannelId,
                    ]);
                    console.log(
                        `[Zoho CRM] ✓ Notification channel ${notificationChannelId} disabled`,
                    );
                } catch (error) {
                    console.error(
                        `[Zoho CRM] Failed to disable notification channel ${notificationChannelId}:`,
                        error,
                    );
                }
            } else {
                console.log('[Zoho CRM] No notification channel to disable');
            }
        } catch (error) {
            console.error('[Zoho CRM] Failed to disable notifications:', error);
        }

        // Clean up scheduled notification renewal job
        try {
            const refreshJobId = this.config?.zohoNotificationRefreshJobId;
            if (refreshJobId) {
                console.log('[Zoho CRM] Deleting scheduled notification renewal job');
                const result = await this.schedulerCommands.deleteJob(refreshJobId);
                if (result.success) {
                    console.log(
                        `[Zoho CRM] ✓ Scheduled renewal job ${refreshJobId} deleted`
                    );
                } else if (result.warning) {
                    console.log(
                        `[Zoho CRM] Scheduler not configured, skipping job deletion`
                    );
                }
            }
        } catch (error) {
            console.warn(
                '[Zoho CRM] Failed to delete scheduled renewal job:',
                error.message
            );
            // Don't throw - continue with deletion
        }

        try {
            const quoMessageWebhooks = this.config?.quoMessageWebhooks || [];

            if (quoMessageWebhooks.length > 0) {
                console.log(
                    `[Quo] Deleting ${quoMessageWebhooks.length} message webhook(s)`,
                );

                for (const webhook of quoMessageWebhooks) {
                    try {
                        await this.quo.api.deleteWebhook(webhook.id);
                        console.log(
                            `[Quo] ✓ Message webhook ${webhook.id} deleted from Quo`,
                        );
                    } catch (error) {
                        console.error(
                            `[Quo] Failed to delete message webhook ${webhook.id} from Quo:`,
                            error.message,
                        );
                        console.warn(
                            `[Quo] Message webhook ID ${webhook.id} preserved in config for manual cleanup`,
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
                        console.log(
                            `[Quo] ✓ Call webhook ${webhook.id} deleted from Quo`,
                        );
                    } catch (error) {
                        console.error(
                            `[Quo] Failed to delete call webhook ${webhook.id} from Quo:`,
                            error.message,
                        );
                        console.warn(
                            `[Quo] Call webhook ID ${webhook.id} preserved in config for manual cleanup`,
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
                        console.log(
                            `[Quo] ✓ Call-summary webhook ${webhook.id} deleted from Quo`,
                        );
                    } catch (error) {
                        console.error(
                            `[Quo] Failed to delete call-summary webhook ${webhook.id} from Quo:`,
                            error.message,
                        );
                        console.warn(
                            `[Quo] Call-summary webhook ID ${webhook.id} preserved in config for manual cleanup`,
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
        } catch (error) {
            console.error('[Quo] Failed to delete Quo webhooks:', error);
        }

        await super.onDelete(params);
    }
}

module.exports = ZohoCRMIntegration;
