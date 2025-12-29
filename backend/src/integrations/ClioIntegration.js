const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');
const { createFriggCommands } = require('@friggframework/core');
const clio = require('../api-modules/clio');
const quo = require('../api-modules/quo');
// QUO_ANALYTICS_EVENTS will be used in future tasks for tracking sync operations
// eslint-disable-next-line no-unused-vars
const { QUO_ANALYTICS_EVENTS, QuoWebhookEvents } = require('../base/constants');

/**
 * ClioIntegration - Legal practice management integration with Quo
 *
 * Clio-specific implementation for syncing contacts with Quo.
 * Supports Person and Company contact types with multi-region API support.
 *
 * Features:
 * - One-way contact sync (Clio → Quo)
 * - Activity logging (calls, messages) to Clio Communications/Notes
 * - Webhook-based real-time synchronization
 * - Multi-region support (US, EU, CA, AU)
 */
class ClioIntegration extends BaseCRMIntegration {
    static Definition = {
        name: 'clio',
        version: '1.0.0',
        supportedVersions: ['1.0.0'],
        hasUserConfig: true,
        webhooks: {
            enabled: true,
        },

        display: {
            label: 'Clio',
            description: 'Legal practice management integration with Quo',
            category: 'CRM, Legal',
            detailsUrl: 'https://www.clio.com',
            icon: '',
        },
        modules: {
            clio: { definition: clio.Definition },
            quo: {
                definition: {
                    ...quo.Definition,
                    getName: () => 'quo-clio',
                    moduleName: 'quo-clio',
                    display: {
                        ...(quo.Definition.display || {}),
                        label: 'Quo (Clio)',
                    },
                },
            },
        },
        routes: [
            {
                path: '/clio/contacts',
                method: 'GET',
                event: 'LIST_CLIO_CONTACTS',
            },
            {
                path: '/clio/matters',
                method: 'GET',
                event: 'LIST_CLIO_MATTERS',
            },
        ],
    };

    /**
     * CRM Configuration - Required by BaseCRMIntegration
     *
     * Clio uses cursor-based pagination with page_token
     * Supports both Person and Company contact types
     */
    static CRMConfig = {
        // Clio contact types as returned by /contacts.json in the 'type' field
        // 'Person' = individual contact, 'Company' = organization/business
        personObjectTypes: [
            { crmObjectName: 'Person', quoContactType: 'contact' },
            { crmObjectName: 'Company', quoContactType: 'company' },
        ],
        syncConfig: {
            paginationType: 'CURSOR_BASED',
            supportsTotal: true,
            returnFullRecords: true,
            reverseChronological: true,
            initialBatchSize: 100,
            ongoingBatchSize: 50,
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
     * Webhook configuration constants
     * Used for webhook labels and identification in webhook processing
     */
    static WEBHOOK_LABELS = {
        QUO_MESSAGES: 'Clio Integration - Messages',
        QUO_CALLS: 'Clio Integration - Calls',
        QUO_CALL_SUMMARIES: 'Clio Integration - Call Summaries',
    };

    /**
     * Webhook event subscriptions
     * Defines which events each webhook type listens for
     */
    static WEBHOOK_EVENTS = {
        CLIO: ['created', 'updated', 'deleted'],
        QUO_MESSAGES: [
            QuoWebhookEvents.MESSAGE_RECEIVED,
            QuoWebhookEvents.MESSAGE_DELIVERED,
        ],
        QUO_CALLS: [
            QuoWebhookEvents.CALL_COMPLETED,
            QuoWebhookEvents.CALL_RECORDING_COMPLETED,
        ],
        QUO_CALL_SUMMARIES: [QuoWebhookEvents.CALL_SUMMARY_COMPLETED],
    };

    constructor(params) {
        super(params);

        this.commands = createFriggCommands({
            integrationClass: ClioIntegration,
        });

        this.events = {
            ...this.events,

            LIST_CLIO_CONTACTS: {
                handler: this.listContacts,
            },
            LIST_CLIO_MATTERS: {
                handler: this.listMatters,
            },
            ON_WEBHOOK: {
                handler: this.onWebhook,
            },
        };
    }

    // =========================================================================
    // Abstract Methods from BaseCRMIntegration (to be implemented in future tasks)
    // =========================================================================

    /**
     * Fetch a page of contacts from Clio
     * @abstract
     * @throws {Error} Not implemented - Task 2
     */
    async fetchPersonPage() {
        throw new Error('ClioIntegration.fetchPersonPage() not implemented');
    }

    /**
     * Transform a Clio contact to Quo format
     * @abstract
     * @throws {Error} Not implemented - Task 2
     */
    async transformPersonToQuo() {
        throw new Error('ClioIntegration.transformPersonToQuo() not implemented');
    }

    /**
     * Log an SMS message to Clio as a Note
     * @abstract
     * @throws {Error} Not implemented - Task 5
     */
    async logSMSToActivity() {
        throw new Error('ClioIntegration.logSMSToActivity() not implemented');
    }

    /**
     * Log a call to Clio as a Communication
     * @abstract
     * @throws {Error} Not implemented - Task 6
     */
    async logCallToActivity() {
        throw new Error('ClioIntegration.logCallToActivity() not implemented');
    }

    /**
     * Set up webhooks for both Clio and Quo
     * @abstract
     * @throws {Error} Not implemented - Tasks 3/4
     */
    async setupWebhooks() {
        throw new Error('ClioIntegration.setupWebhooks() not implemented');
    }

    // =========================================================================
    // Webhook Signature Verification
    // =========================================================================

    /**
     * Verify Clio webhook signature
     * Uses HMAC-SHA256 to verify the webhook payload against the stored secret
     *
     * Clio sends X-Hook-Signature header with HMAC-SHA256 signature
     *
     * @private
     * @param {Object} params
     * @param {string} params.signature - Signature from X-Hook-Signature header
     * @param {string} params.payload - Raw webhook payload (stringified JSON)
     * @param {string} params.secret - Stored webhook secret (shared during handshake)
     * @returns {boolean} True if signature is valid
     */
    _verifyWebhookSignature({ signature, payload, secret }) {
        if (!signature || !secret) {
            return false;
        }

        try {
            const crypto = require('crypto');
            const hmac = crypto.createHmac('sha256', secret);
            hmac.update(payload);
            const expectedSignature = hmac.digest('hex');

            if (signature.length !== expectedSignature.length) {
                return false;
            }

            return crypto.timingSafeEqual(
                Buffer.from(signature),
                Buffer.from(expectedSignature),
            );
        } catch (error) {
            console.error('[Clio] Signature verification error:', error);
            return false;
        }
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

        const parts = signatureHeader.split(';');
        if (parts.length !== 4 || parts[0] !== 'hmac') {
            throw new Error('Invalid Openphone-Signature format');
        }

        // eslint-disable-next-line no-unused-vars
        const [_hmacPrefix, _version, timestamp, receivedSignature] = parts;

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

            if (computedSignature === receivedSignature) {
                matchFound = true;
                break;
            }
        }

        if (!matchFound) {
            throw new Error(
                'Webhook signature verification failed - no matching format found',
            );
        }

        console.log('[Quo Webhook] Signature verified');
    }

    // =========================================================================
    // Route Handlers
    // =========================================================================

    /**
     * List contacts from Clio
     * Route: GET /clio/contacts
     *
     * @param {Object} params
     * @param {Object} params.req - Express request
     * @param {Object} params.res - Express response
     */
    listContacts = async ({ req, res }) => {
        try {
            const { page_token } = req.query;
            const limitParam = parseInt(req.query.limit, 10);
            const limit =
                !isNaN(limitParam) && limitParam > 0 && limitParam <= 200
                    ? limitParam
                    : 50;

            const response = await this.clio.api.listContacts({
                limit,
                page_token,
            });

            res.json({
                data: response.data,
                paging: response.meta?.paging,
            });
        } catch (error) {
            console.error('[Clio] listContacts error:', error.message);
            res.status(500).json({
                error: error.message,
            });
        }
    };

    /**
     * List matters from Clio
     * Route: GET /clio/matters
     *
     * @param {Object} params
     * @param {Object} params.req - Express request
     * @param {Object} params.res - Express response
     */
    listMatters = async ({ req, res }) => {
        try {
            const { page_token } = req.query;
            const limitParam = parseInt(req.query.limit, 10);
            const limit =
                !isNaN(limitParam) && limitParam > 0 && limitParam <= 200
                    ? limitParam
                    : 50;

            const response = await this.clio.api.listMatters({
                limit,
                page_token,
            });

            res.json({
                data: response.data,
                paging: response.meta?.paging,
            });
        } catch (error) {
            console.error('[Clio] listMatters error:', error.message);
            res.status(500).json({
                error: error.message,
            });
        }
    };

    // =========================================================================
    // Webhook Handler
    // =========================================================================

    /**
     * Main webhook handler
     * Routes webhook events to appropriate handlers
     *
     * @param {Object} params
     * @param {Object} params.data - Webhook payload
     */
    onWebhook = async ({ data }) => {
        // Log only event type and identifiers, not full payload (security)
        const eventType = data?.type || data?.event || 'unknown';
        const eventId = data?.id || data?.data?.id || 'unknown';
        console.log(`[Clio] Webhook received: type=${eventType}, id=${eventId}`);

        // TODO: Implement webhook routing in future tasks
        // - Clio webhooks (contact created/updated/deleted)
        // - Quo webhooks (calls, messages, call summaries)

        throw new Error('ClioIntegration.onWebhook() not fully implemented');
    };

    // =========================================================================
    // Helper Methods
    // =========================================================================

    /**
     * Normalize phone number for consistent matching
     * Removes formatting characters while preserving E.164 format
     *
     * @private
     * @param {string} phone - Phone number to normalize
     * @returns {string} Normalized phone number
     */
    _normalizePhoneNumber(phone) {
        if (!phone || typeof phone !== 'string') return phone;
        return phone.replace(/[\s\(\)\-]/g, '');
    }

    /**
     * Generate webhook URL with BASE_URL validation
     *
     * @private
     * @param {string} path - Webhook path
     * @returns {string} Complete webhook URL
     * @throws {Error} If BASE_URL is not configured
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
}

module.exports = ClioIntegration;
