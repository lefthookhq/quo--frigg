const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');
const { createFriggCommands } = require('@friggframework/core');
const clio = require('../api-modules/clio');
const quo = require('../api-modules/quo');
// eslint-disable-next-line no-unused-vars
const { QUO_ANALYTICS_EVENTS, QuoWebhookEvents } = require('../base/constants');

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

    static CRMConfig = {
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

    static WEBHOOK_LABELS = {
        QUO_MESSAGES: 'Clio Integration - Messages',
        QUO_CALLS: 'Clio Integration - Calls',
        QUO_CALL_SUMMARIES: 'Clio Integration - Call Summaries',
    };

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

    static CONTACT_FIELDS =
        'id,etag,name,first_name,middle_name,last_name,prefix,title,type,' +
        'created_at,updated_at,is_client,primary_email_address,primary_phone_number,' +
        'phone_numbers{id,number,name,default_number},' +
        'email_addresses{id,address,name,default_email},' +
        'company{id,name}';

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
                type: objectType,
                fields: ClioIntegration.CONTACT_FIELDS,
            };

            if (cursor) {
                if (cursor.startsWith('http')) {
                    try {
                        const cursorUrl = new URL(cursor);
                        params.page_token =
                            cursorUrl.searchParams.get('page_token');
                    } catch {
                        params.page_token = cursor;
                    }
                } else {
                    params.page_token = cursor;
                }
            }

            if (modifiedSince) {
                params.updated_since = modifiedSince.toISOString();
            }

            params.order = sortDesc ? 'id(desc)' : 'id(asc)';

            const response = await this.clio.api.listContacts(params);
            const contacts = response.data || [];

            let nextCursor = null;
            if (response.meta?.paging?.next) {
                try {
                    const nextUrl = new URL(response.meta.paging.next);
                    nextCursor = nextUrl.searchParams.get('page_token');
                } catch {
                    nextCursor = null;
                }
            }

            console.log(
                `[Clio] Fetched ${contacts.length} ${objectType}(s) at cursor ${cursor || 'start'}, ` +
                    `hasMore=${!!nextCursor}`,
            );

            return {
                data: contacts,
                cursor: nextCursor,
                hasMore: !!nextCursor,
            };
        } catch (error) {
            console.error(
                `[Clio] Error fetching ${objectType} at cursor ${cursor}:`,
                error,
            );
            throw error;
        }
    }

    async transformPersonToQuo(contact, companyMap = null) {
        const isPerson = contact.type === 'Person';

        let firstName;
        let lastName;

        if (isPerson) {
            firstName = contact.middle_name
                ? `${contact.first_name || ''} ${contact.middle_name}`.trim()
                : contact.first_name || '';
            lastName = contact.last_name || '';

            if (!firstName && !lastName) {
                firstName = 'Unknown';
            }
        } else {
            firstName = contact.name || 'Unknown';
            lastName = '';
        }

        const phoneNumbers = (contact.phone_numbers || [])
            .filter((p) => p.number)
            .map((p) => ({
                name: this._capitalizeLabel(p.name) || 'Work',
                value: p.number,
                primary: p.default_number || false,
            }));

        const emails = (contact.email_addresses || [])
            .filter((e) => e.address)
            .map((e) => ({
                name: this._capitalizeLabel(e.name) || 'Work',
                value: e.address,
                primary: e.default_email || false,
            }));

        let company = null;
        if (isPerson && contact.company) {
            if (contact.company.name) {
                company = contact.company.name;
            } else if (companyMap && companyMap.has(contact.company.id)) {
                const companyData = companyMap.get(contact.company.id);
                company = companyData?.name || null;
            }
        }

        const sourceUrl = this._generateClioSourceUrl(contact.id);

        return {
            externalId: String(contact.id),
            source: 'openphone-clio',
            sourceUrl,
            isEditable: false,
            defaultFields: {
                firstName,
                lastName,
                company,
                role: contact.title || null,
                phoneNumbers,
                emails,
            },
            customFields: [],
            sourceEntityType: isPerson ? 'person' : 'company',
        };
    }

    async transformPersonsToQuo(contacts) {
        if (!contacts || contacts.length === 0) {
            return [];
        }

        const companyIds = new Set();
        for (const contact of contacts) {
            if (
                contact.type === 'Person' &&
                contact.company?.id &&
                !contact.company?.name
            ) {
                companyIds.add(contact.company.id);
            }
        }

        let companyMap = new Map();
        if (companyIds.size > 0) {
            console.log(
                `[Clio] Pre-fetching ${companyIds.size} companies for batch transform`,
            );

            const companyPromises = [...companyIds].map(async (id) => {
                try {
                    const response = await this.clio.api.getContact(
                        id,
                        'id,name',
                    );
                    return { id, data: response.data };
                } catch (error) {
                    console.warn(
                        `[Clio] Failed to fetch company ${id}:`,
                        error.message,
                    );
                    return { id, data: null };
                }
            });

            const companyResults = await Promise.all(companyPromises);
            for (const { id, data } of companyResults) {
                if (data) {
                    companyMap.set(id, data);
                }
            }
        }

        return Promise.all(
            contacts.map((contact) =>
                this.transformPersonToQuo(contact, companyMap),
            ),
        );
    }

    async logSMSToActivity() {
        throw new Error('ClioIntegration.logSMSToActivity() not implemented');
    }

    async logCallToActivity() {
        throw new Error('ClioIntegration.logCallToActivity() not implemented');
    }

    async setupWebhooks() {
        const results = {
            clio: null,
            quo: null,
            overallStatus: 'success',
        };

        try {
            results.clio = await this.setupClioWebhook();
            console.log('[Webhook Setup] ✓ Clio webhooks configured');
        } catch (error) {
            results.clio = { status: 'failed', error: error.message };
            console.error(
                '[Webhook Setup] ✗ Clio webhook setup failed:',
                error.message,
            );

            if (this.id) {
                await this.updateIntegrationMessages.execute(
                    this.id,
                    'warnings',
                    'Clio Webhook Setup Failed',
                    `Could not register webhooks with Clio: ${error.message}. Contact changes in Clio will not sync automatically.`,
                    Date.now(),
                );
            }
            results.overallStatus = 'partial';
        }

        // TODO: Add Quo webhook setup in ticket 86ae3cum3
        results.quo = {
            status: 'pending',
            note: 'Quo webhooks implementation in separate ticket',
        };

        return results;
    }

    async setupClioWebhook() {
        if (this.config?.clioWebhookId && this.config?.clioWebhookSecret) {
            console.log(
                `[Clio] Webhook already registered: ${this.config.clioWebhookId}`,
            );

            if (this.config.clioWebhookExpiresAt) {
                const expiresAt = new Date(this.config.clioWebhookExpiresAt);
                const daysRemaining =
                    (expiresAt - Date.now()) / (1000 * 60 * 60 * 24);

                if (daysRemaining < 7) {
                    console.log(
                        `[Clio] Webhook expires in ${daysRemaining.toFixed(1)} days - renewing`,
                    );
                    return await this._renewClioWebhook();
                }
            }

            return {
                status: 'already_configured',
                webhookId: this.config.clioWebhookId,
                webhookUrl: this.config.clioWebhookUrl,
                expiresAt: this.config.clioWebhookExpiresAt,
            };
        }

        if (this.config?.clioWebhookId) {
            try {
                await this.clio.api.deleteWebhook(this.config.clioWebhookId);
                console.log(
                    `[Clio] Cleaned up orphaned webhook: ${this.config.clioWebhookId}`,
                );
            } catch (cleanupError) {
                console.warn(
                    `[Clio] Could not clean up webhook: ${cleanupError.message}`,
                );
            }
        }

        const webhookUrl = this._generateWebhookUrl(`/webhooks/${this.id}`);
        console.log(`[Clio] Registering webhook at: ${webhookUrl}`);

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 31);

        const response = await this.clio.api.createWebhook({
            url: webhookUrl,
            model: 'contact',
            events: this.constructor.WEBHOOK_EVENTS.CLIO,
            fields: ClioIntegration.CONTACT_FIELDS,
            expires_at: expiresAt.toISOString(),
        });

        if (!response.data?.id) {
            throw new Error(
                'Invalid Clio webhook response: missing webhook ID',
            );
        }

        const webhookId = response.data.id;

        console.log(`[Clio] ✓ Webhook created with ID: ${webhookId}`);
        console.log(
            `[Clio] Waiting for handshake POST from Clio with X-Hook-Secret...`,
        );

        // Don't expect shared_secret in response - Clio will POST it to our webhook URL
        // The webhook will be activated when we receive the handshake and call activateWebhook()
        const updatedConfig = {
            ...this.config,
            clioWebhookId: webhookId,
            clioWebhookUrl: webhookUrl,
            clioWebhookSecret: null, // Will be set during handshake
            clioWebhookStatus: 'pending_handshake', // Not yet activated
            clioWebhookExpiresAt: expiresAt.toISOString(),
            clioWebhookCreatedAt: new Date().toISOString(),
        };

        await this.commands.updateIntegrationConfig({
            integrationId: this.id,
            config: updatedConfig,
        });

        this.config = updatedConfig;

        console.log(`[Clio] ✓ Webhook expires at: ${expiresAt.toISOString()}`);

        return {
            status: 'pending_handshake',
            webhookId,
            webhookUrl,
            expiresAt: expiresAt.toISOString(),
        };
    }

    async _renewClioWebhook() {
        const newExpiresAt = new Date();
        newExpiresAt.setDate(newExpiresAt.getDate() + 31);

        await this.clio.api.updateWebhook(this.config.clioWebhookId, {
            expires_at: newExpiresAt.toISOString(),
        });

        const updatedConfig = {
            ...this.config,
            clioWebhookExpiresAt: newExpiresAt.toISOString(),
        };

        await this.commands.updateIntegrationConfig({
            integrationId: this.id,
            config: updatedConfig,
        });

        this.config = updatedConfig;

        console.log(
            `[Clio] ✓ Webhook renewed until: ${newExpiresAt.toISOString()}`,
        );

        return {
            status: 'renewed',
            webhookId: this.config.clioWebhookId,
            webhookUrl: this.config.clioWebhookUrl,
            expiresAt: newExpiresAt.toISOString(),
        };
    }

    async onWebhookReceived({ req, res }) {
        try {
            const hookSecret = req.headers['x-hook-secret'];
            const clioSignature = req.headers['x-hook-signature'];

            // Handle handshake POST from Clio (delayed option)
            // Clio sends X-Hook-Secret header when setting up webhook
            // Queue it for processing in onWebhook where we have full context
            if (hookSecret) {
                console.log(
                    '[Clio Webhook] Received handshake request - queueing for processing',
                );

                const webhookData = {
                    body: req.body,
                    headers: req.headers,
                    integrationId: req.params.integrationId,
                    source: 'clio',
                    isHandshake: true,
                    hookSecret: hookSecret,
                    receivedAt: new Date().toISOString(),
                };

                await this.queueWebhook(webhookData);
                res.status(200).json({ received: true, handshake: true });
                return;
            }

            // Regular webhook - verify signature exists
            if (!clioSignature) {
                console.error(
                    '[Clio Webhook] Missing signature header - rejecting',
                );
                res.status(401).json({ error: 'Signature required' });
                return;
            }

            const webhookData = {
                body: req.body,
                headers: req.headers,
                integrationId: req.params.integrationId,
                signature: clioSignature,
                source: 'clio',
                receivedAt: new Date().toISOString(),
            };

            await this.queueWebhook(webhookData);

            res.status(200).json({ received: true });
        } catch (error) {
            console.error('[Clio Webhook] Receive error:', error);
            throw error;
        }
    }

    /**
     * Handle webhook handshake from Clio (delayed option).
     * Clio POSTs to our webhook URL with X-Hook-Secret header.
     * We activate the webhook by calling PUT with that secret.
     */
    async _handleWebhookHandshake(secret, body) {
        const webhookId = body?.data?.webhook_id;

        if (!webhookId) {
            throw new Error(
                'Cannot complete webhook handshake: no webhook_id in body.data',
            );
        }

        console.log(`[Clio] Received webhook handshake for ID: ${webhookId}`);

        // Activate the webhook using the delayed option
        await this.clio.api.activateWebhook(webhookId, secret);

        console.log(`[Clio] ✓ Webhook activated via handshake`);

        // Save the secret and update status
        const updatedConfig = {
            ...this.config,
            clioWebhookSecret: secret,
            clioWebhookStatus: 'enabled',
        };

        await this.commands.updateIntegrationConfig({
            integrationId: this.id,
            config: updatedConfig,
        });

        this.config = updatedConfig;
        console.log(`[Clio] ✓ Webhook secret saved to config`);
    }

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

    onWebhook = async ({ data }) => {
        const { source } = data;

        console.log(`[Webhook] Processing ${source} webhook`);

        if (source === 'clio') {
            return await this._handleClioWebhook(data);
        } else if (source === 'quo') {
            // TODO: Implement in ticket 86ae3cum3
            console.log('[Webhook] Quo webhook processing not yet implemented');
            return {
                success: false,
                reason: 'Quo webhooks pending implementation',
            };
        }

        throw new Error(`Unknown webhook source: ${source}`);
    };

    async _handleClioWebhook(data) {
        const { body, headers, isHandshake, hookSecret } = data;

        // Handle webhook handshake (delayed option)
        if (isHandshake && hookSecret) {
            console.log('[Clio Webhook] Processing handshake');
            await this._handleWebhookHandshake(hookSecret, body);
            return { success: true, type: 'handshake' };
        }

        const signature = headers['x-hook-signature'];

        console.log('[Clio Webhook] Processing webhook:', {
            event: body.meta?.event,
            webhookId: body.meta?.webhook_id,
            contactId: body.data?.id,
        });

        try {
            const webhookSecret = this.config?.clioWebhookSecret;
            if (webhookSecret && signature) {
                const payloadString = JSON.stringify(body);
                const isValid = this._verifyWebhookSignature({
                    signature,
                    payload: payloadString,
                    secret: webhookSecret,
                });

                if (!isValid) {
                    console.error('[Clio Webhook] Invalid signature!');
                    throw new Error('Webhook signature verification failed');
                }
                console.log('[Clio Webhook] ✓ Signature verified');
            }

            if (this.config?.clioWebhookExpiresAt) {
                const expiresAt = new Date(this.config.clioWebhookExpiresAt);
                const daysRemaining =
                    (expiresAt - Date.now()) / (1000 * 60 * 60 * 24);
                if (daysRemaining < 7) {
                    console.log(
                        `[Clio Webhook] Renewal needed - ${daysRemaining.toFixed(1)} days remaining`,
                    );
                    await this._renewClioWebhook();
                }
            }

            const { meta, data: contactData } = body;

            if (!meta?.event || !contactData) {
                throw new Error(
                    'Invalid webhook payload: missing meta.event or data',
                );
            }

            const eventType = meta.event;
            const contactId = contactData.id;

            console.log(
                `[Clio Webhook] Handling contact ${eventType}: ${contactId}`,
            );

            switch (eventType) {
                case 'created':
                    await this._handleContactCreated(contactData);
                    break;

                case 'updated':
                    await this._handleContactUpdated(contactData);
                    break;

                case 'deleted':
                    await this._handleContactDeleted(contactId);
                    break;

                default:
                    console.log(
                        `[Clio Webhook] Unhandled event type: ${eventType}`,
                    );
                    return {
                        success: true,
                        skipped: true,
                        reason: `Event type '${eventType}' not configured`,
                    };
            }

            console.log(`[Clio Webhook] ✓ Successfully processed ${eventType}`);

            return {
                success: true,
                event: eventType,
                contactId,
                processedAt: new Date().toISOString(),
            };
        } catch (error) {
            console.error('[Clio Webhook] Processing error:', error);

            await this.updateIntegrationMessages.execute(
                this.id,
                'errors',
                'Webhook Processing Error',
                `Failed to process ${body.meta?.event}: ${error.message}`,
                Date.now(),
            );

            throw error;
        }
    }

    async _handleContactCreated(contactData) {
        const quoContact = await this.transformPersonToQuo(contactData);

        console.log(`[Clio Webhook] Creating contact in Quo:`, {
            externalId: quoContact.externalId,
            firstName: quoContact.defaultFields.firstName,
            lastName: quoContact.defaultFields.lastName,
        });

        await this.quo.api.createFriggContact(quoContact);
    }

    async _handleContactUpdated(contactData) {
        const quoContact = await this.transformPersonToQuo(contactData);
        const externalId = quoContact.externalId;

        console.log(`[Clio Webhook] Updating contact in Quo:`, {
            externalId,
            firstName: quoContact.defaultFields.firstName,
            lastName: quoContact.defaultFields.lastName,
        });

        // Find the Quo contact by externalId
        const contacts = await this.quo.api.listContacts({
            externalIds: [externalId],
        });

        if (!contacts?.data?.length) {
            console.log(
                `[Clio Webhook] Contact ${externalId} not found in Quo - creating instead`,
            );
            await this.quo.api.createFriggContact(quoContact);
            return;
        }

        const quoContactId = contacts.data[0].id;
        await this.quo.api.updateFriggContact(quoContactId, quoContact);
    }

    async _handleContactDeleted(contactId) {
        console.log(`[Clio Webhook] Deleting contact from Quo: ${contactId}`);

        try {
            // Find the contact by externalId first
            const externalId = String(contactId);
            const contacts = await this.quo.api.listContacts({
                externalIds: [externalId],
            });

            if (!contacts?.data?.length) {
                console.log(
                    `[Clio Webhook] Contact ${contactId} not found in Quo - nothing to delete`,
                );
                return;
            }

            const quoContactId = contacts.data[0].id;
            await this.quo.api.deleteContact(quoContactId);
            console.log(
                `[Clio Webhook] ✓ Deleted contact ${quoContactId} (external: ${externalId})`,
            );
        } catch (error) {
            if (error.status === 404 || error.message?.includes('not found')) {
                console.log(
                    `[Clio Webhook] Contact ${contactId} already deleted or not synced`,
                );
                return;
            }
            throw error;
        }
    }

    async onDelete() {
        console.log('[Clio] Integration being deleted - cleaning up webhooks');

        if (this.config?.clioWebhookId) {
            try {
                await this.clio.api.deleteWebhook(this.config.clioWebhookId);
                console.log(
                    `[Clio] ✓ Deleted webhook: ${this.config.clioWebhookId}`,
                );
            } catch (error) {
                console.warn(
                    `[Clio] Could not delete webhook: ${error.message}`,
                );
            }
        }

        // TODO: Clean up Quo webhooks in ticket 86ae3cum3
    }

    _normalizePhoneNumber(phone) {
        if (!phone || typeof phone !== 'string') return phone;
        return phone.replace(/[\s\(\)\-]/g, '');
    }

    _generateWebhookUrl(path) {
        if (!process.env.BASE_URL) {
            throw new Error(
                'BASE_URL environment variable is required for webhook setup.',
            );
        }

        const integrationName = this.constructor.Definition.name;
        return `${process.env.BASE_URL}/api/${integrationName}-integration${path}`;
    }

    _capitalizeLabel(label) {
        if (!label || typeof label !== 'string') {
            return label;
        }
        return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
    }

    _generateClioSourceUrl(contactId) {
        const region = this.clio?.api?.region || 'us';
        const baseUrl =
            region === 'us'
                ? 'https://app.clio.com'
                : `https://${region}.app.clio.com`;
        return `${baseUrl}/contacts/${contactId}`;
    }
}

module.exports = ClioIntegration;
