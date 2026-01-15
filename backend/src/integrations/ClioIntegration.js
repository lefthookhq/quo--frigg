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

    /**
     * Log an SMS message as a Note in Clio
     *
     * @param {Object} activity - Message activity details
     * @param {string} activity.contactExternalId - Clio contact ID
     * @param {string} activity.title - Message title
     * @param {string} activity.content - Message content (rich text/markdown)
     * @param {string} activity.timestamp - ISO timestamp
     * @param {string} activity.direction - 'inbound' or 'outbound'
     * @returns {Promise<number>} Note ID
     */
    async logSMSToActivity(activity) {
        const {
            contactExternalId,
            title,
            content,
            timestamp,
        } = activity;

        if (!contactExternalId) {
            throw new Error('contactExternalId is required to log SMS');
        }

        console.log(
            `[Clio] Creating Note for SMS to contact ${contactExternalId}`,
        );

        try {
            const contactId = parseInt(contactExternalId, 10);

            const noteParams = {
                type: 'Contact',
                contact: { id: contactId },
                subject: title,
                detail: content,
                detail_text_type: 'rich_text',
                date: timestamp,
            };

            const response = await this.clio.api.createNote(noteParams);

            if (!response?.data?.id) {
                throw new Error(
                    'Invalid Clio Note response: missing note ID',
                );
            }

            const noteId = response.data.id;
            console.log(`[Clio] ✓ Created Note ${noteId} for SMS`);

            return noteId;
        } catch (error) {
            console.error(
                `[Clio] Error creating Note for SMS:`,
                error.message,
            );
            throw error;
        }
    }

    /**
     * Log a phone call as a Communication in Clio
     *
     * @param {Object} activity - Call activity details
     * @param {string} activity.contactExternalId - Clio contact ID
     * @param {string} activity.title - Call title
     * @param {string} activity.content - Call content (rich text/markdown)
     * @param {string} activity.timestamp - ISO timestamp
     * @param {number} activity.duration - Call duration in seconds
     * @param {string} activity.direction - 'inbound' or 'outbound'
     * @param {string} [activity.quoCallId] - Quo call ID for external_properties
     * @returns {Promise<number>} Communication ID
     */
    async logCallToActivity(activity) {
        const {
            contactExternalId,
            title,
            content,
            timestamp,
            duration,
            direction,
            quoCallId,
        } = activity;

        if (!contactExternalId) {
            throw new Error('contactExternalId is required to log call');
        }

        console.log(
            `[Clio] Creating PhoneCommunication for contact ${contactExternalId}`,
        );

        try {
            const contactId = parseInt(contactExternalId, 10);

            // Build senders and receivers based on call direction
            const senders = [];
            const receivers = [];

            if (direction === 'inbound') {
                // Incoming call: external contact → user
                senders.push({
                    type: 'Contact',
                    id: contactId,
                });
                // Receiver would be a User, but we don't have userId in this context
                // Clio will handle this via the API user's context
            } else {
                // Outgoing call: user → external contact
                receivers.push({
                    type: 'Contact',
                    id: contactId,
                });
            }

            // Build external_properties for metadata
            const externalProperties = [];
            if (quoCallId) {
                externalProperties.push({
                    name: 'quo_call_id',
                    value: quoCallId,
                });
            }
            if (duration !== undefined) {
                externalProperties.push({
                    name: 'duration',
                    value: String(duration),
                });
            }

            const communicationParams = {
                type: 'PhoneCommunication',
                subject: title,
                body: content,
                date: timestamp,
                received_at: timestamp,
                ...(senders.length > 0 && { senders }),
                ...(receivers.length > 0 && { receivers }),
                ...(externalProperties.length > 0 && { external_properties: externalProperties }),
            };

            // TODO: Optional Matter association if contact is linked to a matter
            // This requires checking if contact has an associated matter
            // Will be implemented based on config setting

            const response =
                await this.clio.api.createCommunication(communicationParams);

            if (!response?.data?.id) {
                throw new Error(
                    'Invalid Clio Communication response: missing communication ID',
                );
            }

            const communicationId = response.data.id;
            console.log(
                `[Clio] ✓ Created PhoneCommunication ${communicationId} for call`,
            );

            return communicationId;
        } catch (error) {
            console.error(
                `[Clio] Error creating PhoneCommunication:`,
                error.message,
            );
            throw error;
        }
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

        try {
            results.quo = await this.setupQuoWebhook();
            console.log('[Webhook Setup] ✓ Quo webhooks configured');
        } catch (error) {
            results.quo = { status: 'failed', error: error.message };
            console.error(
                '[Webhook Setup] ✗ Quo webhook setup failed:',
                error.message,
            );

            if (this.id) {
                await this.updateIntegrationMessages.execute(
                    this.id,
                    'warnings',
                    'Quo Webhook Setup Failed',
                    `Could not register webhooks with Quo: ${error.message}. Call and message logging will not work.`,
                    Date.now(),
                );
            }
            results.overallStatus = 'partial';
        }

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

    async setupQuoWebhook() {
        const createdWebhooks = [];

        try {
            // Check if already configured
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

            // Check for partial configuration (recovery scenario)
            const hasPartialConfig =
                this.config?.quoMessageWebhookId ||
                this.config?.quoCallWebhookId ||
                this.config?.quoCallSummaryWebhookId;

            if (hasPartialConfig) {
                console.warn(
                    '[Quo] Partial webhook configuration detected - cleaning up before retry',
                );

                // Clean up orphaned message webhook
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

                // Clean up orphaned call webhook
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

                // Clean up orphaned call summary webhook
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

            // STEP 1: Fetch phone numbers and store IDs in config
            console.log('[Quo] Fetching phone numbers for webhook filtering');
            await this._fetchAndStoreEnabledPhoneIds();

            // STEP 2: Create webhooks with phone number IDs as resourceIds
            const {
                messageWebhookId,
                messageWebhookKey,
                callWebhookId,
                callWebhookKey,
                callSummaryWebhookId,
                callSummaryWebhookKey,
            } = await this._createQuoWebhooksWithPhoneIds(webhookUrl);

            // Track created webhooks for rollback
            createdWebhooks.push(
                { type: 'message', id: messageWebhookId },
                { type: 'call', id: callWebhookId },
                { type: 'callSummary', id: callSummaryWebhookId },
            );

            console.log(
                `[Quo] ✓ All webhooks registered with phone number filtering`,
            );

            // STEP 3: Save config atomically (only after all webhooks created)
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
                messageWebhookId,
                callWebhookId,
                callSummaryWebhookId,
                webhookUrl,
            };
        } catch (error) {
            console.error('[Quo] Failed to setup webhooks:', error);

            // Rollback: Delete any webhooks that were created
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

            // Log error to integration messages for user visibility
            if (this.id) {
                await this.updateIntegrationMessages.execute(
                    this.id,
                    'errors',
                    'Quo Webhook Setup Failed',
                    `Failed to register Quo webhooks: ${error.message}`,
                    Date.now(),
                );
            }

            return {
                status: 'failed',
                error: error.message,
            };
        }
    }

    async onWebhookReceived({ req, res }) {
        try {
            const hookSecret = req.headers['x-hook-secret'];
            const clioSignature = req.headers['x-hook-signature'];
            const quoSignature = req.headers['openphone-signature'];
            const svixSignature = req.headers['svix-signature'];

            // Handle Clio handshake
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

            // Determine webhook source (Quo uses Svix for delivery)
            const isQuoWebhook = !!(quoSignature || svixSignature);
            const source = isQuoWebhook ? 'quo' : 'clio';
            const signature = quoSignature || svixSignature || clioSignature;

            if (!signature) {
                console.error(
                    `[${source === 'quo' ? 'Quo' : 'Clio'} Webhook] Missing signature header - rejecting`,
                );
                res.status(401).json({ error: 'Signature required' });
                return;
            }

            const webhookData = {
                body: req.body,
                headers: req.headers,
                integrationId: req.params.integrationId,
                signature: signature,
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
            return await this._handleQuoWebhook(data);
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

    /**
     * Handle Quo webhook events
     * Routes events to appropriate processors based on event type
     *
     * @private
     * @param {Object} data - Webhook data from queue
     * @returns {Promise<Object>} Processing result
     */
    async _handleQuoWebhook(data) {
        const { body } = data;
        const eventType = body.type;

        console.log(`[Quo Webhook] Processing event: ${eventType}`);

        try {
            let result;

            // Route message events
            if (
                eventType === 'message.received' ||
                eventType === 'message.delivered'
            ) {
                result = await this._handleQuoMessageEvent(body);
            }
            // Route call events
            else if (eventType === 'call.completed') {
                result = await this._handleQuoCallEvent(body);
            } else if (eventType === 'call.summary.completed') {
                result = await this._handleCallSummaryCompleted(body);
            } else if (eventType === 'call.recording.completed') {
                result = await this._handleCallRecordingCompleted(body);
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

            if (this.id) {
                await this.updateIntegrationMessages.execute(
                    this.id,
                    'errors',
                    'Quo Webhook Processing Error',
                    `Failed to process ${eventType}: ${error.message}`,
                    Date.now(),
                );
            }

            throw error;
        }
    }

    /**
     * Handle Quo message.received and message.delivered webhook events
     * Finds Clio contact by phone number and logs SMS as a Note
     *
     * @private
     * @param {Object} webhookData - Quo webhook payload
     * @returns {Promise<Object>} Processing result
     */
    async _handleQuoMessageEvent(webhookData) {
        const QuoWebhookEventProcessor = require('../base/services/QuoWebhookEventProcessor');
        const { trackAnalyticsEvent } = require('../utils/trackAnalyticsEvent');
        const { QUO_ANALYTICS_EVENTS } = require('../base/constants');

        const result = await QuoWebhookEventProcessor.processMessageEvent({
            webhookData,
            quoApi: this.quo.api,
            crmAdapter: {
                formatMethod: 'markdown',
                useEmoji: true,
                findContactByPhone: (phone) =>
                    this._findClioContactFromQuoWebhook(phone),
                createMessageActivity: async (contactId, activity) => {
                    return this.logSMSToActivity({
                        contactExternalId: contactId,
                        ...activity,
                    });
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
     * Handle Quo call.completed webhook events
     * Finds Clio contact by phone number and logs call as PhoneCommunication
     *
     * @private
     * @param {Object} webhookData - Quo webhook payload
     * @returns {Promise<Object>} Processing result
     */
    async _handleQuoCallEvent(webhookData) {
        const QuoWebhookEventProcessor = require('../base/services/QuoWebhookEventProcessor');
        const { trackAnalyticsEvent } = require('../utils/trackAnalyticsEvent');
        const { QUO_ANALYTICS_EVENTS } = require('../base/constants');

        // Fetch Quo phone numbers for participant filtering
        const phoneNumbersResponse = await this.quo.api.listPhoneNumbers();
        const phoneNumbersMetadata = phoneNumbersResponse?.data || [];

        const callId = webhookData.data?.object?.id;

        const result = await QuoWebhookEventProcessor.processCallEvent({
            webhookData,
            quoApi: this.quo.api,
            phoneNumbersMetadata,
            crmAdapter: {
                formatMethod: 'markdown',
                useEmoji: true,
                findContactByPhone: (phone) =>
                    this._findClioContactFromQuoWebhook(phone),
                createCallActivity: async (contactId, activity) => {
                    return this.logCallToActivity({
                        contactExternalId: contactId,
                        quoCallId: callId,
                        ...activity,
                    });
                },
            },
            mappingRepo: {
                get: (id) => this.getMapping(id),
                upsert: (id, data) => this.upsertMapping(id, data),
            },
            onActivityCreated: ({ callId, activityId }) => {
                trackAnalyticsEvent(this, QUO_ANALYTICS_EVENTS.CALL_LOGGED, {
                    callId,
                    communicationId: activityId,
                });
            },
        });

        return result;
    }

    /**
     * Handle Quo call.summary.completed webhook events
     * Enriches existing Communication with AI summary, recordings, and voicemails
     *
     * @private
     * @param {Object} webhookData - Quo webhook payload
     * @returns {Promise<Object>} Enrichment result
     */
    async _handleCallSummaryCompleted(webhookData) {
        const CallSummaryEnrichmentService = require('../base/services/CallSummaryEnrichmentService');
        const QuoCallContentBuilder = require('../base/services/QuoCallContentBuilder');

        const callId = webhookData.data?.object?.callId;
        const summaryData = webhookData.data?.object || {};
        const deepLink = webhookData.data?.deepLink || '#';

        console.log(
            `[Clio] Enriching call ${callId} with summary and recordings`,
        );

        // Fetch full call details from Quo API
        const callResponse = await this.quo.api.getCall(callId);
        const callDetails = callResponse?.data;

        if (!callDetails) {
            throw new Error(`Call ${callId} not found in Quo API`);
        }

        // Fetch Quo phone numbers for inbox metadata
        const phoneNumbersResponse = await this.quo.api.listPhoneNumbers();
        const phoneNumbersMetadata = phoneNumbersResponse?.data || [];

        // Find inbox details
        const inboxPhone = phoneNumbersMetadata.find(
            (p) => p.id === callDetails.phoneNumberId,
        );
        const inboxName = inboxPhone?.name || 'Unknown Inbox';
        const inboxNumber = inboxPhone?.number || '';

        // Build formatters for content generation
        const formatOptions = QuoCallContentBuilder.getFormatOptions('markdown');
        const formatters = {
            formatCallHeader: (call, recordings, voicemail) =>
                QuoCallContentBuilder.buildCallTitle({
                    call,
                    inboxName,
                    inboxNumber,
                    contactPhone: '', // Will be filled by service
                    formatOptions,
                    useEmoji: true,
                }),
            formatTitle: (call) =>
                QuoCallContentBuilder.buildCallTitle({
                    call,
                    inboxName,
                    inboxNumber,
                    contactPhone: '',
                    formatOptions,
                    useEmoji: true,
                }),
            formatDeepLink: () => {
                return formatOptions.link('View in Quo', deepLink);
            },
            formatMethod: 'markdown',
        };

        // Look up existing mapping to find contactId
        const existingMapping = await this.getMapping(callId);
        const contactId =
            existingMapping?.mapping?.contactId ||
            existingMapping?.contactId;

        if (!contactId) {
            console.warn(
                `[Clio] No contact mapping found for call ${callId}, cannot enrich`,
            );
            return {
                success: false,
                error: 'No contact mapping found',
                callId,
            };
        }

        // Configure CRM adapter for enrichment
        const crmAdapter = {
            canUpdateNote: () => true, // Clio supports PATCH for Communications
            updateNote: async (communicationId, { content, title }) => {
                await this.clio.api.updateCommunication(communicationId, {
                    body: content,
                    subject: title,
                });
            },
            createNote: async ({ contactId, content, title, timestamp }) => {
                return this.logCallToActivity({
                    contactExternalId: contactId,
                    title,
                    content,
                    timestamp,
                    duration: callDetails.duration,
                    direction: callDetails.direction,
                    quoCallId: callId,
                });
            },
            deleteNote: async (communicationId) => {
                await this.clio.api.deleteCommunication(communicationId);
            },
        };

        const result = await CallSummaryEnrichmentService.enrichCallNote({
            callId,
            summaryData,
            callDetails,
            quoApi: this.quo.api,
            crmAdapter,
            mappingRepo: {
                get: (id) => this.getMapping(id),
                upsert: (id, data) => this.upsertMapping(id, data),
            },
            contactId,
            formatters,
        });

        console.log(
            `[Clio] ✓ Enriched Communication ${result.noteId} with summary`,
        );

        return result;
    }

    /**
     * Handle Quo call.recording.completed webhook events
     * Updates existing Communication with recording link
     *
     * @private
     * @param {Object} webhookData - Quo webhook payload
     * @returns {Promise<Object>} Update result
     */
    async _handleCallRecordingCompleted(webhookData) {
        const callId = webhookData.data?.object?.id;
        const recordings = webhookData.data?.object?.recordings || [];
        const recordingUrl = recordings[0]?.url;

        if (!callId || !recordingUrl) {
            throw new Error(
                'Invalid recording webhook: missing callId or url',
            );
        }

        console.log(
            `[Clio] Adding recording link to Communication for call ${callId}`,
        );

        // Find existing Communication via mapping
        const existingMapping = await this.getMapping(callId);
        const communicationId =
            existingMapping?.mapping?.noteId || existingMapping?.noteId;

        if (!communicationId) {
            console.warn(
                `[Clio] No Communication found for call ${callId}, cannot add recording`,
            );
            return {
                success: false,
                error: 'No Communication mapping found',
                callId,
            };
        }

        // Fetch existing Communication to preserve content
        const commResponse =
            await this.clio.api.getCommunication(communicationId);
        const existingBody = commResponse?.data?.body || '';

        // Append recording link to body
        const recordingLink = `\n\n▶️ [Recording](${recordingUrl})`;
        const updatedBody = existingBody + recordingLink;

        await this.clio.api.updateCommunication(communicationId, {
            body: updatedBody,
        });

        console.log(
            `[Clio] ✓ Added recording link to Communication ${communicationId}`,
        );

        return {
            success: true,
            communicationId,
            callId,
            recordingUrl,
        };
    }

    /**
     * Find Clio contact by phone number (with mapping optimization)
     * Uses two-strategy approach: mapping lookup first, then API search
     *
     * @private
     * @param {string} phoneNumber - Phone number to search for
     * @returns {Promise<number|null>} Clio contact ID or null if not found
     */
    async _findClioContactFromQuoWebhook(phoneNumber) {
        if (!phoneNumber) {
            throw new Error('Phone number is required for webhook lookup');
        }

        const normalizedPhone = this._normalizePhoneNumber(phoneNumber);
        console.log(
            `[Webhook Lookup] Searching for Clio contact with phone: ${phoneNumber} (normalized: ${normalizedPhone})`,
        );

        // STRATEGY 1: Try mapping lookup by phone number (O(1) - fast!)
        const externalId =
            await this._getExternalIdFromMappingByPhone(normalizedPhone);
        if (externalId) {
            console.log(
                `[Webhook Lookup] ✓ Found via mapping cache: ${externalId}`,
            );
            return externalId;
        }

        // STRATEGY 2: Fallback to Clio API search (slower)
        console.log(
            `[Webhook Lookup] ✗ No mapping found, searching Clio API`,
        );

        try {
            const contactId = await this._findContactByPhone(normalizedPhone);

            if (contactId) {
                // Cache the mapping for future lookups
                console.log(
                    `[Webhook Lookup] Creating phone mapping for future lookups: ${normalizedPhone} → ${contactId}`,
                );
                await this.upsertMapping(normalizedPhone, {
                    externalId: contactId,
                    phoneNumber: normalizedPhone,
                    entityType: 'contact',
                    lastSyncedAt: new Date().toISOString(),
                    syncMethod: 'webhook',
                });
            }

            return contactId;
        } catch (error) {
            console.error(
                `[Webhook Lookup] Error searching Clio for phone ${normalizedPhone}:`,
                error.message,
            );
            return null;
        }
    }

    /**
     * Search Clio for contact by phone number
     * Note: Clio doesn't have a direct phone search API, so we use query parameter
     *
     * @private
     * @param {string} phone - Normalized phone number
     * @returns {Promise<number|null>} Clio contact ID or null
     */
    async _findContactByPhone(phone) {
        try {
            // Try searching with the phone number as query
            // Clio's query parameter searches across multiple fields
            const response = await this.clio.api.listContacts({
                query: phone,
                limit: 50,
            });

            if (!response?.data || response.data.length === 0) {
                console.log(`[Clio] No contacts found for phone: ${phone}`);
                return null;
            }

            for (const contact of response.data) {
                if (contact.primary_phone_number) {
                    const normalizedPrimary = this._normalizePhoneNumber(
                        contact.primary_phone_number,
                    );
                    if (normalizedPrimary === phone) {
                        console.log(
                            `[Clio] ✓ Found contact ${contact.id} via primary phone`,
                        );
                        return contact.id;
                    }
                }

                if (contact.id) {
                    const phoneNumbersResponse =
                        await this.clio.api.getContactPhoneNumbers(contact.id, {
                            fields: 'id,name,number,default_number',
                        });
                    const phoneNumbers = phoneNumbersResponse?.data || [];

                    for (const phoneObj of phoneNumbers) {
                        const normalizedPhoneNumber =
                            this._normalizePhoneNumber(phoneObj.number);
                        if (normalizedPhoneNumber === phone) {
                            console.log(
                                `[Clio] ✓ Found contact ${contact.id} via phone number ${phoneObj.name}`,
                            );
                            return contact.id;
                        }
                    }
                }
            }

            console.log(
                `[Clio] No exact phone match found among ${response.data.length} contacts`,
            );
            return null;
        } catch (error) {
            console.error(
                `[Clio] Error searching for contact by phone:`,
                error.message,
            );
            throw error;
        }
    }

    async onDelete() {
        console.log('[Clio] Integration being deleted - cleaning up webhooks');

        // Check if API modules are loaded
        if (!this.clio?.api || !this.quo?.api) {
            const missingModules = [];
            if (!this.clio?.api) missingModules.push('clio');
            if (!this.quo?.api) missingModules.push('quo');

            console.error(
                `[Webhook Cleanup] Cannot delete webhooks: Missing API modules: ${missingModules.join(', ')}`,
            );
            console.warn(
                '[Webhook Cleanup] Webhook IDs preserved in config for manual cleanup:',
            );

            if (this.config?.clioWebhookId) {
                console.warn(`  - Clio webhook: ${this.config.clioWebhookId}`);
            }
            if (this.config?.quoMessageWebhookId) {
                console.warn(
                    `  - Quo message webhook: ${this.config.quoMessageWebhookId}`,
                );
            }
            if (this.config?.quoCallWebhookId) {
                console.warn(
                    `  - Quo call webhook: ${this.config.quoCallWebhookId}`,
                );
            }
            if (this.config?.quoCallSummaryWebhookId) {
                console.warn(
                    `  - Quo call-summary webhook: ${this.config.quoCallSummaryWebhookId}`,
                );
            }

            return;
        }

        // Delete Clio webhook
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

        // Delete Quo message webhook
        if (this.config?.quoMessageWebhookId) {
            console.log(
                `[Quo] Deleting message webhook: ${this.config.quoMessageWebhookId}`,
            );
            try {
                await this.quo.api.deleteWebhook(
                    this.config.quoMessageWebhookId,
                );
                console.log(
                    `[Quo] ✓ Message webhook ${this.config.quoMessageWebhookId} deleted`,
                );
            } catch (error) {
                console.error(
                    `[Quo] Failed to delete message webhook:`,
                    error.message,
                );
            }
        }

        // Delete Quo call webhook
        if (this.config?.quoCallWebhookId) {
            console.log(
                `[Quo] Deleting call webhook: ${this.config.quoCallWebhookId}`,
            );
            try {
                await this.quo.api.deleteWebhook(this.config.quoCallWebhookId);
                console.log(
                    `[Quo] ✓ Call webhook ${this.config.quoCallWebhookId} deleted`,
                );
            } catch (error) {
                console.error(
                    `[Quo] Failed to delete call webhook:`,
                    error.message,
                );
            }
        }

        // Delete Quo call-summary webhook
        if (this.config?.quoCallSummaryWebhookId) {
            console.log(
                `[Quo] Deleting call-summary webhook: ${this.config.quoCallSummaryWebhookId}`,
            );
            try {
                await this.quo.api.deleteWebhook(
                    this.config.quoCallSummaryWebhookId,
                );
                console.log(
                    `[Quo] ✓ Call-summary webhook ${this.config.quoCallSummaryWebhookId} deleted`,
                );
            } catch (error) {
                console.error(
                    `[Quo] Failed to delete call-summary webhook:`,
                    error.message,
                );
            }
        }
    }

    _normalizePhoneNumber(phone) {
        if (!phone || typeof phone !== 'string') return phone;
        return phone.replace(/\D/g, '');
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
