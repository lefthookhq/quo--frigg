const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');
const { Definition: QuoDefinition } = require('../api-modules/quo/definition');
const zohoCrm = require('@friggframework/api-module-zoho-crm');
const { createFriggCommands } = require('@friggframework/core');
const CallSummaryEnrichmentService = require('../base/services/CallSummaryEnrichmentService');

class ZohoCRMIntegration extends BaseCRMIntegration {
    static Definition = {
        name: 'zohoCrm',
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
                    getName: () => 'quo-zohoCrm',
                    moduleName: 'quo-zohoCrm',
                    display: {
                        ...(QuoDefinition.display || {}),
                        label: 'Quo (Zoho CRM)',
                    },
                },
            },
            zohoCrm: {
                definition: zohoCrm.Definition,
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
        QUO_MESSAGES: ['message.received', 'message.delivered'],
        QUO_CALLS: ['call.completed'],
        QUO_CALL_SUMMARIES: ['call.summary.completed'],
    };

    static ZOHO_NOTIFICATION_CHANNEL_ID = 1735593600000; // Unique bigint channel ID for Zoho webhooks

    constructor(params) {
        super(params);

        this.commands = createFriggCommands({
            integrationClass: ZohoCRMIntegration,
        });

        this.events = {
            ...this.events,

            LIST_ZOHO_CONTACTS: {
                handler: this.listContacts,
            },
            LIST_ZOHO_ACCOUNTS: {
                handler: this.listAccounts,
            },
        };
    }

    /**
     * Verify Zoho notification token
     * Validates the token field from notification payload against stored token
     *
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
            // Direct comparison (notifications use simple token matching)
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
                    response = await this.zohoCrm.api.listContacts(params);
                    break;

                case 'Account':
                    response = await this.zohoCrm.api.listAccounts(params);
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
     * Verify Quo webhook signature
     * Tests multiple payload/key combinations to handle format variations
     *
     * @private
     * @async
     * @param {Object} headers - HTTP headers from webhook request
     * @param {Object} body - Webhook payload body
     * @param {string} eventType - Event type (e.g., 'call.completed', 'message.received', 'call.summary.completed')
     * @throws {Error} If signature is missing, invalid format, or verification fails
     * @returns {Promise<void>}
     *
     * @description
     * OpenPhone signature format: 'hmac;version;timestamp;signature'
     * Tests 4 combinations:
     * 1. timestamp + body (no separator, plain key)
     * 2. timestamp + body (no separator, base64 key)
     * 3. timestamp + "." + body (dot separator, plain key)
     * 4. timestamp + "." + body (dot separator, base64 key)
     *
     * Selects webhook key based on event type:
     * - call.summary.* → quoCallSummaryWebhookKey
     * - call.* → quoCallWebhookKey
     * - message.* → quoMessageWebhookKey
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

        let webhookKey;
        if (eventType.startsWith('call.summary')) {
            webhookKey = this.config?.quoCallSummaryWebhookKey;
        } else if (eventType.startsWith('call.')) {
            webhookKey = this.config?.quoCallWebhookKey;
        } else if (eventType.startsWith('message.')) {
            webhookKey = this.config?.quoMessageWebhookKey;
        } else {
            throw new Error(
                `Unknown event type for key selection: ${eventType}`,
            );
        }

        if (!webhookKey) {
            throw new Error('Webhook key not found in config');
        }

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

            // Use constant-time comparison to prevent timing attacks
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

        console.log('[Quo Webhook] ✓ Signature verified');
    }

    /**
     * Setup Zoho CRM notification channel
     * Programmatically registers a notification channel with Zoho CRM Notifications API
     * Uses a single channel for both Contacts and Accounts events with no expiry
     *
     * @async
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

            const notificationUrl = `${process.env.BASE_URL}/api/zohoCrm-integration/webhooks/${this.id}`;

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
                await this.zohoCrm.api.enableNotification(notificationConfig);

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
     * Setup Quo webhooks for call and message events
     * Registers 3 webhooks (messages, calls, call summaries) atomically with rollback on failure
     *
     * @async
     * @returns {Promise<Object>} Status object with webhook IDs or error
     * @returns {string} return.status - 'configured', 'already_configured', or 'failed'
     * @returns {string} [return.messageWebhookId] - Message webhook ID
     * @returns {string} [return.callWebhookId] - Call webhook ID
     * @returns {string} [return.callSummaryWebhookId] - Call summary webhook ID
     * @returns {string} [return.webhookUrl] - Webhook URL
     * @returns {string} [return.error] - Error message if failed
     *
     * @description
     * This method implements atomic webhook creation:
     * 1. Checks if webhooks already exist (early return)
     * 2. Cleans up partial configurations (recovery)
     * 3. Creates all 3 webhooks (message, call, call-summary)
     * 4. Tracks created webhooks for rollback on failure
     * 5. Stores webhook IDs and keys in encrypted config
     * 6. Returns success or rolls back all webhooks on any failure
     *
     * The method is idempotent and safe to retry.
     */
    async setupQuoWebhook() {
        const createdWebhooks = [];

        try {
            if (
                this.config?.quoMessageWebhookId &&
                this.config?.quoCallWebhookId &&
                this.config?.quoCallSummaryWebhookId
            ) {
                console.log(
                    `[Quo] Webhooks already registered: message=${this.config.quoMessageWebhookId}, call=${this.config.quoCallWebhookId}, callSummary=${this.config.quoCallSummaryWebhookId}`,
                );
                return {
                    status: 'already_configured',
                    messageWebhookId: this.config.quoMessageWebhookId,
                    callWebhookId: this.config.quoCallWebhookId,
                    callSummaryWebhookId: this.config.quoCallSummaryWebhookId,
                    webhookUrl: this.config.quoWebhooksUrl,
                };
            }

            const hasPartialConfig =
                this.config?.quoMessageWebhookId ||
                this.config?.quoCallWebhookId ||
                this.config?.quoCallSummaryWebhookId;

            if (hasPartialConfig) {
                console.warn(
                    '[Quo] Partial webhook configuration detected - cleaning up before retry',
                );

                if (this.config?.quoMessageWebhookId) {
                    try {
                        await this.quo.api.deleteWebhook(
                            this.config.quoMessageWebhookId,
                        );
                        console.log(
                            `[Quo] Cleaned up orphaned message webhook: ${this.config.quoMessageWebhookId}`,
                        );
                    } catch (cleanupError) {
                        console.warn(
                            `[Quo] Could not clean up message webhook (may have been deleted): ${cleanupError.message}`,
                        );
                    }
                }

                if (this.config?.quoCallWebhookId) {
                    try {
                        await this.quo.api.deleteWebhook(
                            this.config.quoCallWebhookId,
                        );
                        console.log(
                            `[Quo] Cleaned up orphaned call webhook: ${this.config.quoCallWebhookId}`,
                        );
                    } catch (cleanupError) {
                        console.warn(
                            `[Quo] Could not clean up call webhook (may have been deleted): ${cleanupError.message}`,
                        );
                    }
                }

                if (this.config?.quoCallSummaryWebhookId) {
                    try {
                        await this.quo.api.deleteWebhook(
                            this.config.quoCallSummaryWebhookId,
                        );
                        console.log(
                            `[Quo] Cleaned up orphaned call-summary webhook: ${this.config.quoCallSummaryWebhookId}`,
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

            // Use base class method to create webhooks with resourceIds support
            const {
                messageWebhookId,
                messageWebhookKey,
                callWebhookId,
                callWebhookKey,
                callSummaryWebhookId,
                callSummaryWebhookKey,
            } = await this._createQuoWebhooksWithPhoneIds(webhookUrl);

            // Track created webhooks for rollback on error
            createdWebhooks.push(
                { type: 'message', id: messageWebhookId },
                { type: 'call', id: callWebhookId },
                { type: 'callSummary', id: callSummaryWebhookId },
            );

            const updatedConfig = {
                ...this.config,
                quoMessageWebhookId: messageWebhookId,
                quoMessageWebhookKey: messageWebhookKey,
                quoCallWebhookId: callWebhookId,
                quoCallWebhookKey: callWebhookKey,
                quoCallSummaryWebhookId: callSummaryWebhookId,
                quoCallSummaryWebhookKey: callSummaryWebhookKey,
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
                messageWebhookId: messageWebhookId,
                callWebhookId: callWebhookId,
                callSummaryWebhookId: callSummaryWebhookId,
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
     * Setup webhooks with both Zoho CRM and Quo
     * Called during onCreate lifecycle (BaseCRMIntegration)
     * Orchestrates webhook setup for both services
     * @returns {Promise<Object>} Setup result
     */
    async setupWebhooks() {
        const results = {
            zoho: null,
            quo: null,
            overallStatus: 'success',
        };

        // Use Promise.allSettled to attempt both webhook setups independently
        // This ensures Quo webhooks are created even if Zoho setup fails
        const [zohoResult, quoResult] = await Promise.allSettled([
            this.setupZohoNotifications(),
            this.setupQuoWebhook(),
        ]);

        // Process Zoho notification result
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
            // Quo webhooks working is sufficient for basic functionality
            results.overallStatus = 'partial';
            console.log(
                '[Webhook Setup] ⚠ Partial success - Quo webhooks configured, Zoho CRM notifications failed',
            );
        } else if (zohoSuccess) {
            // Zoho notifications alone are not sufficient (need Quo for core functionality)
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
                'Both Zoho CRM and Quo webhook setups failed. Integration cannot function without Quo webhooks.',
            );
        }

        return results;
    }

    /**
     * Override HTTP webhook receiver to detect and route Zoho CRM and Quo webhooks
     * Called on incoming webhook POST before queuing to SQS
     * Context: NO database connection (fast cold start)
     *
     * @param {Object} params
     * @param {Object} params.req - Express request object
     * @param {Object} params.res - Express response object
     * @returns {Promise<void>}
     *
     * @description
     * Detects webhook source based on headers:
     * - Quo webhooks: Have 'openphone-signature' header
     * - Zoho CRM webhooks: Have 'authorization' header with bearer token
     *
     * Note: Full signature/token verification happens in onWebhook() with database access
     */
    async onWebhookReceived({ req, res }) {
        try {
            const quoSignature = req.headers['openphone-signature'];
            const hasZohoNotificationFormat =
                req.body?.channel_id && req.body?.ids;

            const source = quoSignature ? 'quo' : 'zoho';

            if (source === 'quo' && !quoSignature) {
                console.error(
                    '[Quo Webhook] Missing openphone-signature header - rejecting webhook',
                );
                res.status(401).json({ error: 'Signature required' });
                return;
            }

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
     * Process webhook events from both Zoho CRM and Quo
     * Called by queue worker with full database access and hydrated integration
     * Automatically invoked by Frigg's webhook infrastructure
     * Routes to appropriate handler based on webhook source
     *
     * @param {Object} params
     * @param {Object} params.data - Webhook data from queue
     * @param {Object} params.data.body - Webhook payload
     * @param {Object} params.data.headers - HTTP headers
     * @param {string} params.data.source - Webhook source ('zoho' or 'quo')
     * @param {string} params.data.integrationId - Integration ID
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
     * Process notification events from Zoho CRM
     * Called by onWebhook() router
     *
     * @private
     * @param {Object} data - Notification data from queue
     * @param {Object} data.body - Zoho CRM notification payload (NotificationCallbackPayload)
     * @param {string} data.body.module - Module name (e.g., "Contacts", "Accounts")
     * @param {string[]} data.body.ids - Array of affected record IDs
     * @param {string} data.body.operation - Operation type: 'insert' | 'update' | 'delete'
     * @param {string} data.body.token - Verification token
     * @param {number|string} data.body.channel_id - Channel ID
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
                    // Continue with other records
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
     * Process webhook events from Quo (OpenPhone)
     * Called by onWebhook() router
     *
     * @private
     * @param {Object} data - Webhook data from queue
     * @param {Object} data.body - Quo webhook payload
     * @param {Object} data.headers - HTTP headers
     * @returns {Promise<Object>} Processing result
     *
     * @description
     * Routes Quo webhooks to appropriate handlers based on event type:
     * - call.completed → _handleQuoCallEvent
     * - call.summary.completed → _handleQuoCallSummaryEvent
     * - message.received/delivered → _handleQuoMessageEvent
     *
     * Verifies webhook signature before processing.
     * Logs activities to Zoho CRM if possible (limited by API availability).
     */
    async _handleQuoWebhook(data) {
        const { body, headers } = data;
        const eventType = body.type; // "call.completed", "message.received", etc.

        console.log(`[Quo Webhook] Processing event: ${eventType}`);

        try {
            await this._verifyQuoWebhookSignature(headers, body, eventType);

            let result;
            if (eventType === 'call.completed') {
                result = await this._handleQuoCallEvent(body);
            } else if (eventType === 'call.summary.completed') {
                result = await this._handleQuoCallSummaryEvent(body);
            } else if (
                eventType === 'message.received' ||
                eventType === 'message.delivered'
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
     * Find Zoho CRM contact by phone number
     * Searches for contacts with matching phone number
     *
     * @private
     * @param {string} phoneNumber - Phone number to search for
     * @returns {Promise<string>} Zoho CRM record ID
     * @throws {Error} If contact not found or search fails
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

            const searchResults = await this.zohoCrm.api.searchContacts({
                criteria: searchCriteria,
            });

            if (searchResults?.data && searchResults.data.length > 0) {
                const contactId = searchResults.data[0].id;
                console.log(
                    `[Quo Webhook] ✓ Found Zoho CRM contact: ${contactId}`,
                );
                return contactId;
            }

            throw new Error(
                `No Zoho CRM contact found for phone: ${phoneNumber}. ` +
                    `Contact must exist in Zoho CRM to process Quo events. ` +
                    `Please ensure contacts are synced from Zoho CRM to Quo.`,
            );
        } catch (error) {
            if (!error.message.includes('No Zoho CRM contact found')) {
                throw new Error(
                    `Failed to search for Zoho CRM contact: ${error.message}`,
                );
            }
            throw error;
        }
    }

    /**
     * Handle Quo call.completed webhook event
     *
     * Note: The Zoho CRM API module now supports note creation via createNote().
     * This handler prepares formatted PLAIN TEXT content (Zoho does not support
     * markdown formatting in notes).
     *
     * Currently returns logged: false because note logging hasn't been enabled yet.
     * To enable logging, uncomment the createNote() call below.
     *
     * @private
     * @param {Object} webhookData - Quo webhook payload
     * @returns {Promise<Object>} Processing result
     */
    async _handleQuoCallEvent(webhookData) {
        const callObject = webhookData.data.object;

        console.log(`[Quo Webhook] Processing call: ${callObject.id}`);

        const participants = callObject.participants || [];

        if (participants.length < 2) {
            throw new Error('Call must have at least 2 participants');
        }

        const contactPhone =
            callObject.direction === 'outgoing'
                ? participants[1]
                : participants[0];

        const contactId = await this._findZohoContactByPhone(contactPhone);

        if (!contactId) {
            console.log(
                `[Quo Webhook] ℹ️ No contact found for phone ${contactPhone} in Zoho CRM, skipping call sync`,
            );
            return;
        }

        const deepLink = webhookData.data.deepLink || '#';

        const phoneNumberDetails = await this.quo.api.getPhoneNumber(
            callObject.phoneNumberId,
        );
        const inboxName =
            phoneNumberDetails.data?.symbol && phoneNumberDetails.data?.name
                ? `${phoneNumberDetails.data.symbol} ${phoneNumberDetails.data.name}`
                : phoneNumberDetails.data?.name || 'Quo Line';
        const inboxNumber =
            phoneNumberDetails.data?.number ||
            phoneNumberDetails.data?.formattedNumber ||
            participants[callObject.direction === 'outgoing' ? 0 : 1];

        const userDetails = await this.quo.api.getUser(callObject.userId);
        const userName =
            `${userDetails.data.firstName || ''} ${userDetails.data.lastName || ''}`.trim() ||
            'Quo User';

        const minutes = Math.floor(callObject.duration / 60);
        const seconds = callObject.duration % 60;
        const durationFormatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        let statusDescription;
        if (callObject.status === 'completed') {
            statusDescription =
                callObject.direction === 'outgoing'
                    ? `Outgoing initiated by ${userName}`
                    : `Incoming answered by ${userName}`;
        } else if (
            callObject.status === 'no-answer' ||
            callObject.status === 'missed'
        ) {
            statusDescription = 'Incoming missed';
        } else {
            statusDescription = `${callObject.direction === 'outgoing' ? 'Outgoing' : 'Incoming'} ${callObject.status}`;
        }

        let formattedNote;
        if (callObject.direction === 'outgoing') {
            formattedNote = `${statusDescription}

[View the call activity in Quo](${deepLink})`;
        } else {
            // Incoming call
            let statusLine = statusDescription;

            // Add recording indicator if completed with duration
            if (callObject.status === 'completed' && callObject.duration > 0) {
                statusLine += ` / ▶️ Recording (${durationFormatted})`;
            }

            // Add voicemail indicator if present
            if (callObject.voicemail) {
                const voicemailDuration = callObject.voicemail.duration || 0;
                const vmMinutes = Math.floor(voicemailDuration / 60);
                const vmSeconds = voicemailDuration % 60;
                const vmFormatted = `${vmMinutes}:${vmSeconds.toString().padStart(2, '0')}`;
                statusLine += ` / ➿ Voicemail (${vmFormatted})`;
            }

            formattedNote = `${statusLine}

[View the call activity in Quo](${deepLink})`;
        }

        // Create title with phone numbers
        const callTitle =
            callObject.direction === 'outgoing'
                ? `☎️  Call ${inboxName} ${inboxNumber} → ${contactPhone}`
                : `☎️  Call ${contactPhone} → ${inboxName} ${inboxNumber}`;

        const noteResponse = await this.zohoCrm.api.createNote('Contacts', contactId, {
            Note_Title: callTitle,
            Note_Content: formattedNote,
        });

        // Extract note ID from response
        const noteId = noteResponse?.data?.[0]?.details?.id || null;

        // Store mapping: call ID -> note ID (for later enrichment in call.summary.completed)
        if (noteId) {
            await this.upsertMapping(callObject.id, {
                noteId,
                callId: callObject.id,
                zohoContactId: contactId,
                createdAt: new Date().toISOString(),
            });
            console.log(
                `[Quo Webhook] ✓ Mapping stored: call ${callObject.id} -> note ${noteId}`,
            );
        }

        console.log(
            `[Quo Webhook] ✓ Call logged as note for contact ${contactId}`,
        );

        return {
            logged: true,
            contactId: contactId,
            callId: callObject.id,
            noteId,
        };
    }

    /**
     * Handle Quo message.received and message.delivered webhook events
     *
     * Note: The Zoho CRM API module now supports note creation via createNote().
     * This handler prepares formatted PLAIN TEXT content (Zoho does not support
     * markdown formatting in notes).
     *
     * Currently returns logged: false because note logging hasn't been enabled yet.
     * To enable logging, uncomment the createNote() call below.
     *
     * @private
     * @param {Object} webhookData - Quo webhook payload
     * @returns {Promise<Object>} Processing result
     */
    async _handleQuoMessageEvent(webhookData) {
        const messageObject = webhookData.data.object;

        console.log(`[Quo Webhook] Processing message: ${messageObject.id}`);

        // Determine contact phone based on direction
        // - Outgoing: we sent to contact (use 'to')
        // - Incoming: contact sent to us (use 'from')
        const contactPhone =
            messageObject.direction === 'outgoing'
                ? messageObject.to
                : messageObject.from;

        console.log(
            `[Quo Webhook] Message direction: ${messageObject.direction}, contact: ${contactPhone}`,
        );

        const contactId = await this._findZohoContactByPhone(contactPhone);

        if (!contactId) {
            console.log(
                `[Quo Webhook] ℹ️ No contact found for phone ${contactPhone} in Zoho CRM, skipping message sync`,
            );
            return;
        }

        const phoneNumberDetails = await this.quo.api.getPhoneNumber(
            messageObject.phoneNumberId,
        );
        const inboxName =
            phoneNumberDetails.data?.symbol && phoneNumberDetails.data?.name
                ? `${phoneNumberDetails.data.symbol} ${phoneNumberDetails.data.name}`
                : phoneNumberDetails.data?.name || 'Quo Inbox';

        const inboxNumber =
            phoneNumberDetails.data?.number ||
            phoneNumberDetails.data?.formattedNumber ||
            messageObject.to;

        const userDetails = await this.quo.api.getUser(messageObject.userId);
        const userName =
            `${userDetails.data.firstName || ''} ${userDetails.data.lastName || ''}`.trim() ||
            'Quo User';

        const deepLink = webhookData.data.deepLink || '#';

        let formattedNote;
        if (messageObject.direction === 'outgoing') {
            formattedNote = `${userName} sent: ${messageObject.text || '(no text)'}

[View the message activity in Quo](${deepLink})`;
        } else {
            formattedNote = `Received: ${messageObject.text || '(no text)'}

[View the message activity in Quo](${deepLink})`;
        }

        // Create title with phone numbers
        const messageTitle =
            messageObject.direction === 'outgoing'
                ? `💬 Message ${inboxName} ${inboxNumber} → ${contactPhone}`
                : `💬 Message ${contactPhone} → ${inboxName} ${inboxNumber}`;

        const noteResponse = await this.zohoCrm.api.createNote(
            'Contacts',
            contactId,
            {
                Note_Title: messageTitle,
                Note_Content: formattedNote,
            },
        );

        if (noteResponse.data.code !== 'SUCCESS') {
            throw new Error(`Failed to create note: ${noteResponse.message}`);
        }

        console.log(`[Quo Webhook] ✓ Message logged for contact ${contactId}`);

        return {
            logged: true,
            noteId: noteResponse.data.id,
        };
    }

    /**
     * Handle Quo call.summary.completed webhook event
     * Enriches existing Zoho CRM note with AI summary, recordings, and voicemails
     * using the CallSummaryEnrichmentService
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

        const contactPhone =
            callObject.direction === 'outgoing'
                ? participants[1]
                : participants[0];

        const zohoContactId = await this._findZohoContactByPhone(contactPhone);

        if (!zohoContactId) {
            console.log(
                `[Quo Webhook] ℹ️ No contact found for phone ${contactPhone} in Zoho CRM, skipping call summary sync`,
            );
            return {
                received: true,
                callId,
                logged: false,
                error: 'No Zoho contact found',
            };
        }

        const deepLink = webhookData.data.deepLink || '#';

        const phoneNumberDetails = await this.quo.api.getPhoneNumber(
            callObject.phoneNumberId,
        );
        const inboxName =
            phoneNumberDetails.data?.symbol && phoneNumberDetails.data?.name
                ? `${phoneNumberDetails.data.symbol} ${phoneNumberDetails.data.name}`
                : phoneNumberDetails.data?.name || 'Quo Line';
        const inboxNumber =
            phoneNumberDetails.data?.number ||
            phoneNumberDetails.data?.formattedNumber ||
            participants[callObject.direction === 'outgoing' ? 0 : 1];

        const userDetails = await this.quo.api.getUser(callObject.userId);
        const userName =
            `${userDetails.data.firstName || ''} ${userDetails.data.lastName || ''}`.trim() ||
            'Quo User';

        // Use CallSummaryEnrichmentService to enrich the note
        const enrichmentResult = await CallSummaryEnrichmentService.enrichCallNote({
            callId,
            summaryData: { summary, nextSteps },
            callDetails: callObject,
            quoApi: this.quo.api,
            crmAdapter: {
                canUpdateNote: () => true, // Zoho CRM supports note updates!
                createNote: async ({ contactId, content, title, timestamp }) => {
                    const noteResponse = await this.zohoCrm.api.createNote(
                        'Contacts',
                        contactId,
                        {
                            Note_Title: title,
                            Note_Content: content,
                        },
                    );
                    return noteResponse?.data?.[0]?.details?.id || null;
                },
                updateNote: async (noteId, { content, title }) => {
                    return await this.zohoCrm.api.updateNote(
                        'Contacts',
                        zohoContactId,
                        noteId,
                        {
                            Note_Title: title,
                            Note_Content: content,
                        },
                    );
                },
            },
            mappingRepo: {
                get: async (id) => await this.getMapping(id),
                upsert: async (id, data) => await this.upsertMapping(id, data),
            },
            contactId: zohoContactId,
            formatters: {
                formatCallHeader: (call) => {
                    let statusDescription;
                    if (call.status === 'completed') {
                        statusDescription =
                            call.direction === 'outgoing'
                                ? `Outgoing initiated by ${userName}`
                                : `Incoming answered by ${userName}`;
                    } else if (
                        call.status === 'no-answer' ||
                        call.status === 'missed'
                    ) {
                        statusDescription = 'Incoming missed';
                    } else {
                        statusDescription = `${call.direction === 'outgoing' ? 'Outgoing' : 'Incoming'} ${call.status}`;
                    }
                    return statusDescription;
                },
                formatTitle: (call) => {
                    if (call.direction === 'outgoing') {
                        return `☎️ Call Summary: ${inboxName} (${inboxNumber}) → ${contactPhone}`;
                    } else {
                        return `☎️ Call Summary: ${contactPhone} → ${inboxName} (${inboxNumber})`;
                    }
                },
                formatDeepLink: () => {
                    return `\n\nView in Quo: ${deepLink}`;
                },
            },
        });

        console.log(
            `[Quo Webhook] ✓ Call summary enrichment complete for contact ${zohoContactId}`,
        );

        return {
            received: true,
            callId,
            logged: true,
            contactId: zohoContactId,
            noteId: enrichmentResult.noteId,
            oldNoteId: enrichmentResult.oldNoteId,
            summaryPoints: summary.length,
            nextStepsCount: nextSteps.length,
            recordingsCount: enrichmentResult.recordingsCount,
            hasVoicemail: enrichmentResult.hasVoicemail,
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
            const response = await this.zohoCrm.api.getContact(recordId);

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
            const response = await this.zohoCrm.api.getAccount(recordId);

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
                } else {
                    console.log(
                        `[Zoho CRM] Contact for ${objectType} ${externalId} not found in Quo, nothing to delete`,
                    );
                }
                return;
            }

            const person = await this._fetchZohoObject(objectType, recordId);
            const quoContact = await this.transformPersonToQuo(person);

            // Use bulkUpsertToQuo for both insert and update operations
            const result = await this.bulkUpsertToQuo([quoContact]);

            if (result.errorCount > 0) {
                const error = result.errors[0];
                throw new Error(
                    `Failed to ${operation} contact: ${error?.error || 'Unknown error'}`,
                );
            }

            console.log(
                `[Zoho CRM] ✓ Contact synced to Quo via bulkUpsertToQuo (${operation}, externalId: ${quoContact.externalId})`,
            );

            console.log(
                `[Zoho CRM] ✓ ${objectType} ${externalId} synced to Quo`,
            );
        } catch (error) {
            console.error(
                `[Zoho CRM] Failed to sync ${objectType} ${recordId}:`,
                error.message,
            );
            throw error;
        }
    }

    async fetchPersonById(id) {
        try {
            const contact = await this.zohoCrm.api.getContact(id);
            return { ...contact.data, _objectType: 'Contact' };
        } catch (contactError) {
            try {
                const account = await this.zohoCrm.api.getAccount(id);
                return { ...account.data, _objectType: 'Account' };
            } catch (accountError) {
                throw new Error(`Person not found: ${id}`);
            }
        }
    }

    async findPersonByExternalId(externalId) {
        try {
            const contact = await this.zohoCrm.api.getContact(externalId);
            return { ...contact.data, _objectType: 'Contact' };
        } catch (contactError) {
            try {
                const account = await this.zohoCrm.api.getAccount(externalId);
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

            const contacts = await this.zohoCrm.api.listContacts(params);
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

            const accounts = await this.zohoCrm.api.listAccounts(params);
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
     * Called when integration is deleted
     * Clean up webhook registrations with Zoho CRM
     *
     * @param {Object} params - Deletion parameters
     * @returns {Promise<void>}
     */
    async onDelete(params) {
        // Validate that API modules are loaded before attempting webhook deletion
        if (!this.zohoCrm?.api || !this.quo?.api) {
            const missingModules = [];
            if (!this.zohoCrm?.api) missingModules.push('zohoCrm');
            if (!this.quo?.api) missingModules.push('quo');

            console.error(
                `[Webhook Cleanup] Cannot delete webhooks: Missing API modules: ${missingModules.join(', ')}`,
            );
            console.error(
                '[Webhook Cleanup] This likely means modules were not loaded during the deletion lifecycle.',
            );

            const notificationChannelId =
                this.config?.zohoNotificationChannelId;
            if (notificationChannelId) {
                console.warn(
                    '[Webhook Cleanup] Notification channel preserved in config for manual cleanup:',
                );
                console.warn(
                    `  - Zoho CRM notification channel: ${notificationChannelId}`,
                );
                console.warn(
                    '[Webhook Cleanup] You will need to manually disable this notification channel from Zoho CRM.',
                );
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
                    await this.zohoCrm.api.disableNotification([
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

        try {
            const quoMessageWebhookId = this.config?.quoMessageWebhookId;

            if (quoMessageWebhookId) {
                console.log(
                    `[Quo] Deleting message webhook: ${quoMessageWebhookId}`,
                );

                try {
                    await this.quo.api.deleteWebhook(quoMessageWebhookId);
                    console.log(
                        `[Quo] ✓ Message webhook ${quoMessageWebhookId} deleted from Quo`,
                    );
                } catch (error) {
                    console.error(
                        `[Quo] Failed to delete message webhook from Quo:`,
                        error.message,
                    );
                    console.warn(
                        `[Quo] Message webhook ID ${quoMessageWebhookId} preserved in config for manual cleanup`,
                    );
                }
            } else {
                console.log('[Quo] No message webhook to delete');
            }

            const quoCallWebhookId = this.config?.quoCallWebhookId;

            if (quoCallWebhookId) {
                console.log(`[Quo] Deleting call webhook: ${quoCallWebhookId}`);

                try {
                    await this.quo.api.deleteWebhook(quoCallWebhookId);
                    console.log(
                        `[Quo] ✓ Call webhook ${quoCallWebhookId} deleted from Quo`,
                    );
                } catch (error) {
                    console.error(
                        `[Quo] Failed to delete call webhook from Quo:`,
                        error.message,
                    );
                    console.warn(
                        `[Quo] Call webhook ID ${quoCallWebhookId} preserved in config for manual cleanup`,
                    );
                }
            } else {
                console.log('[Quo] No call webhook to delete');
            }

            const quoCallSummaryWebhookId =
                this.config?.quoCallSummaryWebhookId;

            if (quoCallSummaryWebhookId) {
                console.log(
                    `[Quo] Deleting call-summary webhook: ${quoCallSummaryWebhookId}`,
                );

                try {
                    await this.quo.api.deleteWebhook(quoCallSummaryWebhookId);
                    console.log(
                        `[Quo] ✓ Call-summary webhook ${quoCallSummaryWebhookId} deleted from Quo`,
                    );
                } catch (error) {
                    console.error(
                        `[Quo] Failed to delete call-summary webhook from Quo:`,
                        error.message,
                    );
                    console.warn(
                        `[Quo] Call-summary webhook ID ${quoCallSummaryWebhookId} preserved in config for manual cleanup`,
                    );
                }
            } else {
                console.log('[Quo] No call-summary webhook to delete');
            }
        } catch (error) {
            console.error('[Quo] Failed to delete Quo webhooks:', error);
        }

        await super.onDelete(params);
    }
}

module.exports = ZohoCRMIntegration;
