const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');
const { createFriggCommands } = require('@friggframework/core');
const axisCare = require('../api-modules/axiscare');
const quo = require('../api-modules/quo');

/**
 * AxisCareIntegration - Refactored to extend BaseCRMIntegration
 *
 * AxisCare-specific implementation for syncing clients/contacts with Quo.
 * AxisCare is a home care management platform, so "clients" are the person objects.
 */
class AxisCareIntegration extends BaseCRMIntegration {
    static Definition = {
        name: 'axisCare',
        version: '1.0.0',
        supportedVersions: ['1.0.0'],
        hasUserConfig: true,
        webhooks: {
            enabled: true,
        },
        display: {
            label: 'AxisCare',
            description:
                'Home care management platform integration with Quo API',
            category: 'Healthcare, CRM',
            detailsUrl: 'https://static.axiscare.com/api/documentation.html',
            icon: '',
        },
        modules: {
            axisCare: { definition: axisCare.Definition },
            quo: { 
                definition: {
                    ...quo.Definition,
                    getName: () => 'quo-axisCare',
                    moduleName: 'quo-axisCare',
                    display: {
                        ...(quo.Definition.display || {}),
                        label: 'Quo (AxisCare)',
                    },
                }
            },
        },
        routes: [
            {
                path: '/axisCare/clients',
                method: 'GET',
                event: 'LIST_AXISCARE_CLIENTS',
            },
        ],
    };

    /**
     * CRM Configuration - Required by BaseCRMIntegration
     */
    static CRMConfig = {
        personObjectTypes: [
            { crmObjectName: 'Client', quoContactType: 'contact' },
            { crmObjectName: 'Lead', quoContactType: 'contact' },
            { crmObjectName: 'Caregiver', quoContactType: 'contact' },
            { crmObjectName: 'Applicant', quoContactType: 'contact' },
        ],
        syncConfig: {
            paginationType: 'CURSOR_BASED',
            supportsTotal: false,
            returnFullRecords: true,
            reverseChronological: true,
            initialBatchSize: 50,
            ongoingBatchSize: 25,
            supportsWebhooks: true, // ✅ Webhook-only integration
        },
        queueConfig: {
            maxWorkers: 10,
            provisioned: 3,
            maxConcurrency: 30,
            batchSize: 1,
            timeout: 600,
        },
    };

    /**
     * Webhook configuration constants
     * Used for webhook labels and identification in webhook processing
     */
    static WEBHOOK_LABELS = {
        QUO_MESSAGES: 'AxisCare Integration - Messages',
        QUO_CALLS: 'AxisCare Integration - Calls',
        QUO_CALL_SUMMARIES: 'AxisCare Integration - Call Summaries',
    };

    /**
     * Webhook event subscriptions
     * Defines which events each webhook type listens for
     */
    static WEBHOOK_EVENTS = {
        QUO_MESSAGES: ['message.received', 'message.delivered'],
        QUO_CALLS: ['call.completed'],
        QUO_CALL_SUMMARIES: ['call.summary.completed'],
    };

    constructor(params) {
        super(params);

        // Initialize Frigg commands for database operations (command pattern)
        this.commands = createFriggCommands({
            integrationClass: AxisCareIntegration,
        });

        this.events = {
            ...this.events,

            LIST_AXISCARE_CLIENTS: {
                handler: this.listClients,
            },
            SYNC_CLIENTS_TO_QUO: {
                type: 'USER_ACTION',
                handler: this.syncClientsToQuo,
                title: 'Sync Clients to Quo',
                description: 'Synchronize AxisCare clients with Quo CRM',
                userActionType: 'DATA',
            },
        };
    }

    /**
     * Override onCreate to trigger initial sync after integration creation
     * @param {Object} params
     * @param {string} params.integrationId - Integration ID
     */
    async onCreate({ integrationId }) {
        // Call parent onCreate (handles webhook setup and status)
        await super.onCreate({ integrationId });

        // Trigger initial sync automatically after setup
        await this.startInitialSync({ integrationId });
    }

    /**
     * Fetch a page of persons from AxisCare (Clients, Leads, Caregivers, or Applicants)
     * @param {Object} params
     * @param {string} params.objectType - CRM object type (Client, Lead, Caregiver, or Applicant)
     * @param {string|null} [params.cursor] - Cursor for pagination (startAfterId)
     * @param {number} params.limit - Records per page
     * @param {Date} [params.modifiedSince] - Filter by modification date
     * @param {boolean} [params.sortDesc=true] - Sort descending (ignored by AxisCare)
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
                limit: limit || 50,
            };

            if (cursor) {
                params.startAfterId = cursor;
            }

            if (modifiedSince) {
                params.updated_since = modifiedSince.toISOString();
            }

            let response, persons;

            console.log(
                `[AxisCare] Fetching ${objectType} page with cursor=${cursor}`,
            );

            switch (objectType) {
                case 'Client':
                    response = await this.axisCare.api.listClients(params);
                    persons = response.results?.clients || [];
                    break;

                case 'Lead':
                    response = await this.axisCare.api.listLeads(params);
                    persons = response.results?.leads || [];
                    break;

                case 'Caregiver':
                    response = await this.axisCare.api.listCaregivers(params);
                    // ⚠️ Caregivers use different structure (no results wrapper)
                    persons = response.caregivers || [];
                    break;

                case 'Applicant':
                    response = await this.axisCare.api.listApplicants(params);
                    // ⚠️ Applicants use same structure as Caregivers (no results wrapper)
                    persons = response.applicants || [];
                    break;

                default:
                    throw new Error(`Unknown objectType: ${objectType}`);
            }

            let nextCursor = null;
            const nextPageUrl = response.results?.nextPage || response.nextPage;

            if (nextPageUrl) {
                console.log('[AxisCare] DEBUG nextPage:', nextPageUrl);
                try {
                    const url = new URL(nextPageUrl);
                    console.log(
                        '[AxisCare] DEBUG parsed URL searchParams:',
                        url.searchParams.toString(),
                    );
                    nextCursor = url.searchParams.get('startAfterId');
                    console.log(
                        '[AxisCare] DEBUG extracted cursor:',
                        nextCursor,
                    );
                } catch (error) {
                    console.warn(
                        '[AxisCare] Failed to parse nextPage URL:',
                        error.message,
                        'Raw nextPage:',
                        nextPageUrl,
                    );
                }
            } else {
                console.log('[AxisCare] DEBUG no nextPage in response');
            }

            const taggedPersons = persons.map((person) => ({
                ...person,
                _objectType: objectType,
            }));

            console.log(
                `[AxisCare] Fetched ${taggedPersons.length} ${objectType}(s), hasMore=${!!nextPageUrl}`,
            );

            return {
                data: taggedPersons,
                cursor: nextCursor,
                hasMore: !!nextPageUrl,
            };
        } catch (error) {
            console.error(
                `Error fetching ${objectType} with cursor ${cursor}:`,
                error,
            );
            throw error;
        }
    }

    /**
     * Transform AxisCare person object to Quo contact format
     * Handles Clients, Leads, Caregivers, and Applicants with type-specific field mappings
     * @param {Object} person - AxisCare person object (from API - uses camelCase)
     * @returns {Promise<Object>} Quo contact format
     */
    async transformPersonToQuo(person) {
        const objectType = person.objectType || 'Client';

        const phoneNumbers = this._extractPhoneNumbers(person, objectType);
        const emails = this._extractEmails(person);
        const firstName = this._extractFirstName(person, objectType);

        return {
            externalId: person.id ? `${person.id}` : `${person.mobilePhone}`, // Todo: Applicants don't have an id, so we use the mobilePhone, confirm with Quo if that's ok
            source: 'axiscare',
            defaultFields: {
                firstName,
                lastName: person.lastName,
                company: null,
                phoneNumbers,
                emails,
                role: objectType,
            },
            customFields: [],
        };
    }

    /**
     * Extract firstName based on person type
     * @private
     * @param {Object} person - AxisCare person object
     * @param {string} objectType - Person type (Client, Lead, Caregiver, Applicant)
     * @returns {string} First name
     */
    _extractFirstName(person, objectType) {
        if (objectType === 'Lead' || objectType === 'Applicant') {
            return person.firstName; // Leads & Applicants don't have goesBy
        }
        return person.goesBy || person.firstName; // Client/Caregiver
    }

    /**
     * Extract phone numbers based on person type
     * @private
     * @param {Object} person - AxisCare person object
     * @param {string} objectType - Person type (Client, Lead, Caregiver, Applicant)
     * @returns {Array<{name: string, value: string, primary: boolean}>} Phone numbers
     */
    _extractPhoneNumbers(person, objectType) {
        const phones = [];

        if (objectType === 'Lead') {
            // Leads use: phone, mobilePhone
            if (person.homePhone) {
                phones.push({
                    name: 'phone',
                    value: person.phone,
                    primary: true,
                });
            }
            if (person.mobilePhone) {
                phones.push({
                    name: 'mobile',
                    value: person.mobilePhone,
                    primary: false,
                });
            }
        } else {
            // Client/Caregiver/Applicant use: homePhone, mobilePhone, otherPhone
            if (person.homePhone) {
                phones.push({
                    name: 'home',
                    value: person.homePhone,
                    primary: true,
                });
            }
            if (person.mobilePhone) {
                phones.push({
                    name: 'mobile',
                    value: person.mobilePhone,
                    primary: false,
                });
            }
            if (person.otherPhone) {
                phones.push({
                    name: 'other',
                    value: person.otherPhone,
                    primary: false,
                });
            }
        }

        return phones;
    }

    /**
     * Extract emails (same for all types)
     * @private
     * @param {Object} person - AxisCare person object
     * @returns {Array<{name: string, value: string, primary: boolean}>} Emails
     */
    _extractEmails(person) {
        const emails = [];

        if (person.personalEmail) {
            emails.push({
                name: 'primary',
                value: person.personalEmail,
                primary: true,
            });
        }
        if (
            person.billingEmail &&
            person.billingEmail !== person.personalEmail
        ) {
            emails.push({
                name: 'billing',
                value: person.billingEmail,
                primary: false,
            });
        }

        return emails;
    }

    // ============================================================================
    // WEBHOOK INFRASTRUCTURE - Private Helper Methods
    // ============================================================================

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
     * Normalize phone number for consistent matching
     * Removes formatting characters while preserving E.164 format
     *
     * @private
     * @param {string} phone - Phone number to normalize
     * @returns {string} Normalized phone number
     */
    _normalizePhoneNumber(phone) {
        if (!phone) return phone;
        return phone.replace(/[\s\(\)\-]/g, '');
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

            const matches = computedSignature === receivedSignature;

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

    // ============================================================================
    // WEBHOOK EVENT HANDLERS - HTTP Receiver
    // ============================================================================

    /**
     * HTTP webhook receiver - determines source and queues for processing
     * Called on incoming webhook POST before queuing to SQS
     * Context: NO database connection (fast cold start)
     *
     * @param {Object} params
     * @param {Object} params.req - Express request object
     * @param {Object} params.res - Express response object
     * @returns {Promise<void>}
     */
    async onWebhookReceived({ req, res }) {
        try {
            // Validate request body exists
            if (!req.body || typeof req.body !== 'object') {
                console.error('[Webhook] Invalid or missing request body');
                res.status(400).json({ error: 'Invalid request body' });
                return;
            }

            // Validate integration ID
            if (!req.params.integrationId) {
                console.error('[Webhook] Missing integration ID');
                res.status(400).json({ error: 'Missing integration ID' });
                return;
            }

            const quoSignature = req.headers['openphone-signature'];
            const axiscareUserAgent = req.headers['user-agent'];
            const axiscareWebhookId = req.headers['x-webhook-id'];

            let source;
            if (quoSignature) {
                source = 'quo';
            } else if (
                axiscareUserAgent === 'AWS-Webhook-Service' &&
                axiscareWebhookId
            ) {
                source = 'axiscare';
            } else {
                console.error(
                    `[Webhook] Missing or invalid authentication headers`,
                );
                res.status(401).json({
                    error: 'Signature or authentication required',
                });
                return;
            }

            const webhookData = {
                body: req.body,
                headers: req.headers,
                integrationId: req.params.integrationId,
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

    // ============================================================================
    // WEBHOOK EVENT HANDLERS - Queue Processor
    // ============================================================================

    /**
     * Process webhook events from both AxisCare and Quo
     * Called by queue worker with full database access and hydrated integration
     * Automatically invoked by Frigg's webhook infrastructure
     * Routes to appropriate handler based on webhook source
     *
     * @param {Object} params
     * @param {Object} params.data - Webhook data from queue
     * @param {Object} params.data.body - Webhook payload
     * @param {Object} params.data.headers - HTTP headers
     * @param {string} params.data.source - Webhook source ('axiscare' or 'quo')
     * @param {string} params.data.integrationId - Integration ID
     * @returns {Promise<Object>} Processing result
     */
    async onWebhook({ data }) {
        const { source } = data;

        console.log('[Webhook] Routing webhook:', {
            source,
            timestamp: new Date().toISOString(),
        });

        if (source === 'quo') {
            return await this._handleQuoWebhook(data);
        } else if (source === 'axiscare') {
            return await this._handleAxisCareWebhook(data);
        } else {
            throw new Error(`Unknown webhook source: ${source}`);
        }
    }

    /**
     * Handle AxisCare webhook events
     * Processes entity updates (Client, Caregiver, Lead, Applicant) and syncs to Quo
     *
     * @param {Object} data - Webhook data from queue
     * @returns {Promise<Object>} Processing result
     */
    async _handleAxisCareWebhook(data) {
        const { body, headers } = data;

        console.log(`[AxisCare Webhook] Processing event:`, {
            event: body.event,
            entityId: body.data?.id,
            timestamp: body.timestamp,
        });

        try {
            // Validate webhook source (AxisCare specific)
            const userAgent = headers['user-agent'];
            if (userAgent !== 'AWS-Webhook-Service') {
                console.warn(
                    '[AxisCare Webhook] Invalid user-agent:',
                    userAgent,
                );
                throw new Error(`Invalid webhook source: ${userAgent}`);
            }

            // Validate webhook ID (required header per AxisCare docs)
            const webhookId = headers['x-webhook-id'];
            if (!webhookId) {
                console.error(
                    '[AxisCare Webhook] Missing required x-webhook-id header',
                );
                throw new Error('Missing required x-webhook-id header');
            }

            // Auto-store webhook ID on first webhook (eliminates manual config step)
            if (!this.config?.axiscareWebhookId) {
                console.log(
                    `[AxisCare Webhook] Auto-storing webhook ID from first webhook: ${webhookId}`,
                );

                const updatedConfig = {
                    ...this.config,
                    axiscareWebhookId: webhookId,
                    axiscareWebhookUrl: `${process.env.BASE_URL}/api/axisCare-integration/webhooks/${this.id}`,
                    webhookCreatedAt: new Date().toISOString(),
                };

                await this.commands.updateIntegrationConfig({
                    integrationId: this.id,
                    config: updatedConfig,
                });

                // Update local reference
                this.config = updatedConfig;

                console.log(
                    `[AxisCare Webhook] ✓ Webhook ID ${webhookId} stored in config`,
                );
            } else if (webhookId !== this.config.axiscareWebhookId) {
                // Reject webhooks with mismatched webhook ID
                console.warn('[AxisCare Webhook] Webhook ID mismatch:', {
                    expected: this.config.axiscareWebhookId,
                    received: webhookId,
                });
                throw new Error('Webhook ID mismatch');
            }

            // Parse event type and entity data
            const eventType = body.event; // e.g., "client.updated"
            const entityData = body.data; // { entity, action, id }

            // Route based on entity type
            const { entity, action, id } = entityData;

            switch (entity.toLowerCase()) {
                case 'client':
                    await this._handlePersonWebhook({
                        entity: 'Client',
                        action,
                        id,
                    });
                    break;

                case 'caregiver':
                    await this._handlePersonWebhook({
                        entity: 'Caregiver',
                        action,
                        id,
                    });
                    break;

                case 'lead':
                    await this._handlePersonWebhook({
                        entity: 'Lead',
                        action,
                        id,
                    });
                    break;

                case 'applicant':
                    await this._handlePersonWebhook({
                        entity: 'Applicant',
                        action,
                        id,
                    });
                    break;

                default:
                    console.log(
                        `[AxisCare Webhook] Unhandled entity type: ${entity}`,
                    );
                    return {
                        success: true,
                        skipped: true,
                        reason: `Entity type '${entity}' not configured for sync`,
                    };
            }

            console.log(
                `[AxisCare Webhook] ✓ Successfully processed ${eventType}`,
            );

            return {
                success: true,
                event: eventType,
                entityType: entity,
                entityId: id,
                action: action,
                processedAt: new Date().toISOString(),
            };
        } catch (error) {
            console.error('[AxisCare Webhook] Processing error:', {
                event: body.event,
                entityType: body.data?.entity,
                entityId: body.data?.id,
                error: error.message,
                stack: error.stack,
            });

            // Log error to integration messages
            await this.updateIntegrationMessages.execute(
                this.id,
                'errors',
                'Webhook Processing Error',
                `Failed to process ${body.event} for ${body.data?.entity} ${body.data?.id}: ${error.message}`,
                Date.now(),
            );

            // Re-throw for SQS retry and DLQ
            throw error;
        }
    }

    /**
     * Handle Quo webhook events
     * Routes to appropriate handler based on event type
     *
     * @param {Object} data - Webhook data from queue
     * @returns {Promise<Object>} Processing result
     */
    async _handleQuoWebhook(data) {
        const { body, headers } = data;
        const eventType = body.type;

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

            throw error;
        }
    }

    /**
     * Handle Quo call.completed webhook event
     * Finds AxisCare contact by phone number and logs call activity
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

        const axiscareContact =
            await this._findAxisCareContactByPhone(contactPhone);

        const deepLink = webhookData.data.deepLink || '#';

        const phoneNumberDetails = await this.quo.api.getPhoneNumber(
            callObject.phoneNumberId,
        );
        const inboxName = phoneNumberDetails.name || 'Quo Line';
        const inboxNumber =
            phoneNumberDetails.phoneNumber ||
            participants[callObject.direction === 'outgoing' ? 0 : 1];

        const userDetails = await this.quo.api.getUser(callObject.userId);
        const userName =
            userDetails.name ||
            `${userDetails.firstName || ''} ${userDetails.lastName || ''}`.trim() ||
            'Quo User';

        const duration = callObject.duration || 0;
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
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

        let formattedSummary;
        if (callObject.direction === 'outgoing') {
            formattedSummary = `Call: Quo ${inboxName} (${inboxNumber}) -> ${contactPhone}

${statusDescription}

View the call activity in Quo: ${deepLink}`;
        } else {
            formattedSummary = `Call: ${contactPhone} -> Quo ${inboxName} (${inboxNumber})

${statusDescription}`;

            if (callObject.status === 'completed' && callObject.duration > 0) {
                formattedSummary += ` / Recording (${durationFormatted})`;
            }

            formattedSummary += `

View the call activity in Quo: ${deepLink}`;
        }

        const activityData = {
            contactId: axiscareContact.id,
            contactType: axiscareContact.type,
            direction:
                callObject.direction === 'outgoing' ? 'outbound' : 'inbound',
            timestamp: callObject.createdAt,
            duration: callObject.duration,
            summary: formattedSummary,
            callerPhone: contactPhone,
            callerName: axiscareContact.name,
        };

        await this.logCallToActivity(activityData);

        console.log(
            `[Quo Webhook] ✓ Call logged for ${axiscareContact.type} ${axiscareContact.id}`,
        );

        return { logged: true, contactId: axiscareContact.id };
    }

    /**
     * Handle Quo message.received and message.delivered webhook events
     * Finds AxisCare contact by phone number and logs SMS activity
     *
     * @private
     * @param {Object} webhookData - Quo webhook payload
     * @returns {Promise<Object>} Processing result
     */
    async _handleQuoMessageEvent(webhookData) {
        const messageObject = webhookData.data.object;

        console.log(`[Quo Webhook] Processing message: ${messageObject.id}`);

        const contactPhone =
            messageObject.direction === 'outgoing'
                ? messageObject.to
                : messageObject.from;

        console.log(
            `[Quo Webhook] Message direction: ${messageObject.direction}, contact: ${contactPhone}`,
        );

        const phoneNumberDetails = await this.quo.api.getPhoneNumber(
            messageObject.phoneNumberId,
        );

        const axiscareContact =
            await this._findAxisCareContactByPhone(contactPhone);

        const inboxName = phoneNumberDetails.data.name || 'Quo Inbox';

        const userDetails = await this.quo.api.getUser(messageObject.userId);
        const userName =
            userDetails.name ||
            `${userDetails.firstName || ''} ${userDetails.lastName || ''}`.trim() ||
            'Quo User';

        const deepLink = webhookData.data.deepLink || '#';

        let formattedContent;
        if (messageObject.direction === 'outgoing') {
            formattedContent = `Message Sent

From: Quo ${inboxName} (${messageObject.from})
To: ${messageObject.to}

${userName} sent:
"${messageObject.text || '(no text)'}"

View in Quo: ${deepLink}`;
        } else {
            formattedContent = `Message Received

From: ${messageObject.from}
To: Quo ${inboxName} (${messageObject.to})

Received:
"${messageObject.text || '(no text)'}"

View in Quo: ${deepLink}`;
        }

        const activityData = {
            contactId: axiscareContact.id,
            contactType: axiscareContact.type,
            direction:
                messageObject.direction === 'outgoing' ? 'outbound' : 'inbound',
            content: formattedContent,
            timestamp: messageObject.createdAt,
            callerPhone: contactPhone,
            callerName: axiscareContact.name,
        };

        await this.logSMSToActivity(activityData);

        console.log(
            `[Quo Webhook] ✓ Message logged for ${axiscareContact.type} ${axiscareContact.id}`,
        );

        return { logged: true, contactId: axiscareContact.id };
    }

    /**
     * Handle Quo call.summary.completed webhook event
     * Stores call summary for later enrichment of call activity logs
     *
     * @private
     * @param {Object} webhookData - Quo webhook payload
     * @returns {Promise<Object>} Processing result
     */
    async _handleQuoCallSummaryEvent(webhookData) {
        const summaryObject = webhookData.data.object;

        console.log(
            `[Quo Webhook] Processing call summary for call: ${summaryObject.callId}`,
        );

        const callId = summaryObject.callId;
        const summary = summaryObject.summary || [];
        const nextSteps = summaryObject.nextSteps || [];
        const status = summaryObject.status;

        console.log(
            `[Quo Webhook] Call summary status: ${status}, ${summary.length} summary points, ${nextSteps.length} next steps`,
        );

        return {
            received: true,
            callId,
            summaryPoints: summary.length,
            nextStepsCount: nextSteps.length,
        };
    }

    /**
     * Find AxisCare contact by phone number
     * Searches across Client, Caregiver, Lead, and Applicant entities
     * Only returns contacts that were synced to Quo (have mapping)
     *
     * @private
     * @param {string} phoneNumber - Phone number to search for
     * @returns {Promise<Object>} Contact object with {id, type, name}
     * @throws {Error} If contact not found or not synced to Quo
     */
    async _findAxisCareContactByPhone(phoneNumber) {
        console.log(
            `[Quo Webhook] Looking up AxisCare contact by phone: ${phoneNumber}`,
        );

        const normalizedPhone = this._normalizePhoneNumber(phoneNumber);
        console.log(
            `[Quo Webhook] Normalized phone: ${phoneNumber} → ${normalizedPhone}`,
        );

        try {
            const entityTypes = ['client', 'caregiver', 'lead', 'applicant'];

            for (const entityType of entityTypes) {
                console.log(`[Quo Webhook] Searching in ${entityType}s...`);

                let entities = [];
                switch (entityType) {
                    case 'client': {
                        const response = await this.axisCare.api.listClients({
                            limit: 1000,
                        });
                        entities = response.results?.clients || [];
                        break;
                    }
                    case 'caregiver': {
                        const response = await this.axisCare.api.listCaregivers(
                            {
                                limit: 1000,
                            },
                        );
                        entities = response.caregivers || [];
                        break;
                    }
                    case 'lead': {
                        const response = await this.axisCare.api.listLeads({
                            limit: 1000,
                        });
                        entities = response.results?.leads || [];
                        break;
                    }
                    case 'applicant': {
                        const response = await this.axisCare.api.listApplicants(
                            {
                                limit: 1000,
                            },
                        );
                        entities = response.applicants || [];
                        break;
                    }
                }

                for (const entity of entities) {
                    const phones = [];

                    if (entityType.type === 'lead') {
                        // Leads use different field names
                        if (entity.phone) phones.push(entity.phone);
                        if (entity.mobilePhone) phones.push(entity.mobilePhone);
                    } else {
                        // Clients, Caregivers, Applicants use these fields
                        if (entity.homePhone) phones.push(entity.homePhone);
                        if (entity.mobilePhone) phones.push(entity.mobilePhone);
                        if (entity.otherPhone) phones.push(entity.otherPhone);
                    }

                    for (const phone of phones) {
                        const normalizedEntityPhone =
                            this._normalizePhoneNumber(phone);

                        if (normalizedEntityPhone === normalizedPhone) {
                            const mapping = await this.getMapping(
                                String(entity.id),
                            );

                            if (mapping) {
                                console.log(
                                    `[Quo Webhook] ✓ Found synced ${entityType.type}: ${entity.id}`,
                                );

                                return {
                                    id: entity.id,
                                    type: entityType.type,
                                    name:
                                        entity.name ||
                                        `${entity.firstName || ''} ${entity.lastName || ''}`.trim(),
                                };
                            }
                        }
                    }
                }
            }

            throw new Error(
                `No AxisCare contact found with phone number ${phoneNumber} (normalized: ${normalizedPhone}). ` +
                    `Contact must exist in AxisCare and be synced to Quo to log activities.`,
            );
        } catch (error) {
            console.error(
                `[Quo Webhook] Contact lookup failed:`,
                error.message,
            );
            throw error;
        }
    }

    /**
     * Log SMS message to AxisCare as a call log
     * @param {Object} activity - SMS activity data
     * @returns {Promise<void>}
     */
    async logSMSToActivity(activity) {
        try {
            const callLogData = {
                callerName: activity.callerName,
                callerPhone: activity.callerPhone,
                followUp: false,
                dateTime: activity.timestamp,
                subject: `SMS: ${activity.direction}`,
                notes: activity.content,
                tags: [
                    {
                        type: activity.contactType,
                        entityId: activity.contactId,
                    },
                ],
            };

            await this.axisCare.api.createCallLog(callLogData);

            console.log(
                `[Quo Webhook] ✓ SMS logged to AxisCare ${activity.contactType} ${activity.contactId}`,
            );
        } catch (error) {
            console.error('Failed to log SMS activity to AxisCare:', error);
            throw error;
        }
    }

    /**
     * Log phone call to AxisCare as a call log
     * @param {Object} activity - Call activity data
     * @returns {Promise<void>}
     */
    async logCallToActivity(activity) {
        try {
            const callLogData = {
                callerName: activity.callerName,
                callerPhone: activity.callerPhone,
                followUp: false,
                dateTime: activity.timestamp,
                subject: `Call: ${activity.direction} (${activity.duration}s)`,
                notes: activity.summary || 'Phone call',
                tags: [
                    {
                        type: activity.contactType,
                        entityId: activity.contactId,
                    },
                ],
            };

            await this.axisCare.api.createCallLog(callLogData);

            console.log(
                `[Quo Webhook] ✓ Call logged to AxisCare ${activity.contactType} ${activity.contactId}`,
            );
        } catch (error) {
            console.error('Failed to log call activity to AxisCare:', error);
            throw error;
        }
    }

    /**
     * Handle person entity webhook (Client, Caregiver, Lead, Applicant)
     * Fetches full entity data, transforms to Quo format, and syncs
     *
     * @private
     * @param {Object} params
     * @param {string} params.entity - Entity type (Client, Lead, Caregiver, Applicant)
     * @param {string} params.action - created or updated
     * @param {string} params.id - Entity ID from AxisCare
     * @returns {Promise<void>}
     */
    async _handlePersonWebhook({ entity, action, id }) {
        console.log(`[AxisCare Webhook] Handling ${entity} ${action}: ${id}`);

        try {
            // Fetch full entity data from AxisCare using existing API methods
            let person;

            switch (entity) {
                case 'Client':
                    person = await this.axisCare.api.getClient(id);
                    break;
                case 'Caregiver':
                    person = await this.axisCare.api.getCaregiver(id);
                    break;
                case 'Lead':
                    person = await this.axisCare.api.getLead(id);
                    break;
                case 'Applicant':
                    person = await this.axisCare.api.getApplicant(id);
                    break;
                default:
                    throw new Error(`Unknown entity type: ${entity}`);
            }

            if (!person) {
                console.warn(
                    `[AxisCare Webhook] ${entity} ${id} not found in AxisCare`,
                );
                return;
            }

            // Tag with object type for transformation (existing pattern)
            person.results.objectType = entity;

            // Sync to Quo using dedicated method
            await this._syncPersonToQuo(person.results, action);

            // Update mapping for idempotency tracking
            await this.upsertMapping(id, {
                externalId: person.results.id,
                entityType: entity,
                lastSyncedAt: new Date().toISOString(),
                syncMethod: 'webhook',
                action: action,
            });

            console.log(
                `[AxisCare Webhook] ✓ ${action} webhook processed for ${entity} ${id}`,
            );
        } catch (error) {
            console.error(
                `[AxisCare Webhook] Failed to sync ${entity} ${id}:`,
                error.message,
            );
            throw error; // Re-throw for retry logic
        }
    }

    /**
     * Sync AxisCare person to Quo
     * Transforms person data to Quo contact format and creates/updates in Quo
     *
     * @private
     * @param {Object} person - AxisCare person object (results from API call)
     * @param {string} action - 'created' or 'updated'
     * @returns {Promise<void>}
     */
    async _syncPersonToQuo(person, action) {
        console.log(`[AxisCare] Syncing person to Quo (${action}):`, person.id);

        try {
            const quoContact = await this.transformPersonToQuo(person);

            if (!this.quo?.api) {
                throw new Error('Quo API not available');
            }

            if (action === 'created') {
                const createResponse =
                    await this.quo.api.createContact(quoContact);

                if (!createResponse?.data) {
                    throw new Error(
                        `Create contact failed: Invalid response from Quo API`,
                    );
                }

                console.log(
                    `[AxisCare] ✓ Contact ${createResponse.data.id} created in Quo (externalId: ${quoContact.externalId})`,
                );
            } else {
                // Try to find existing contact by externalId
                const existingContacts = await this.quo.api.listContacts({
                    externalIds: [quoContact.externalId],
                    maxResults: 10,
                });

                const exactMatch =
                    existingContacts?.data && existingContacts.data.length > 0
                        ? existingContacts.data.find(
                              (contact) =>
                                  contact.externalId === quoContact.externalId,
                          )
                        : null;

                if (exactMatch) {
                    const quoContactId = exactMatch.id;
                    const { externalId, ...contactData } = quoContact;
                    const updateResponse = await this.quo.api.updateContact(
                        quoContactId,
                        contactData,
                    );

                    if (!updateResponse?.data) {
                        throw new Error(
                            `Update contact failed: Invalid response from Quo API`,
                        );
                    }

                    console.log(
                        `[AxisCare] ✓ Contact ${quoContactId} updated in Quo (externalId: ${externalId})`,
                    );
                } else {
                    console.log(
                        `[AxisCare] Contact with externalId ${quoContact.externalId} not found in Quo, creating as fallback`,
                    );

                    const createResponse =
                        await this.quo.api.createContact(quoContact);

                    if (!createResponse?.data) {
                        throw new Error(
                            `Create contact failed: Invalid response from Quo API`,
                        );
                    }

                    console.log(
                        `[AxisCare] ✓ Contact ${createResponse.data.id} created in Quo as fallback (externalId: ${quoContact.externalId})`,
                    );
                }
            }

            console.log(`[AxisCare] ✓ Person ${person.id} synced to Quo`);
        } catch (error) {
            console.error(
                `[AxisCare] Failed to sync person ${person.id}:`,
                error.message,
            );
            throw error;
        }
    }

    // ============================================================================
    // WEBHOOK SETUP METHODS
    // ============================================================================

    /**
     * Setup webhooks for both AxisCare and Quo
     * AxisCare webhooks are configured manually via AxisCare admin UI
     * Quo webhooks are created programmatically via this method
     *
     * @returns {Promise<Object>} Setup results
     */
    async setupWebhooks() {
        const results = {
            axiscare: null,
            quo: null,
            overallStatus: 'success',
        };

        try {
            results.quo = await this.setupQuoWebhook();

            if (results.quo.status === 'failed') {
                results.overallStatus = 'failed';
                throw new Error(
                    'Quo webhook setup failed. Quo webhooks are required for call/SMS logging to AxisCare.',
                );
            }

            console.log(
                '[Webhook Setup] ✓ Quo webhooks configured successfully',
            );
            return results;
        } catch (error) {
            console.error('[Webhook Setup] Failed:', error);

            await this.updateIntegrationMessages.execute(
                this.id,
                'errors',
                'Webhook Setup Failed',
                `Failed to setup webhooks: ${error.message}`,
                Date.now(),
            );

            throw error;
        }
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

            const messageWebhookResponse =
                await this.quo.api.createMessageWebhook({
                    url: webhookUrl,
                    events: this.constructor.WEBHOOK_EVENTS.QUO_MESSAGES,
                    label: this.constructor.WEBHOOK_LABELS.QUO_MESSAGES,
                    status: 'enabled',
                });

            if (!messageWebhookResponse?.data?.id) {
                throw new Error(
                    'Invalid Quo message webhook response: missing webhook ID',
                );
            }

            if (!messageWebhookResponse.data.key) {
                throw new Error(
                    'Invalid Quo message webhook response: missing webhook key',
                );
            }

            const messageWebhookId = messageWebhookResponse.data.id;
            const messageWebhookKey = messageWebhookResponse.data.key;

            createdWebhooks.push({
                type: 'message',
                id: messageWebhookId,
            });

            console.log(
                `[Quo] ✓ Message webhook registered with ID: ${messageWebhookId}`,
            );

            const callWebhookResponse = await this.quo.api.createCallWebhook({
                url: webhookUrl,
                events: this.constructor.WEBHOOK_EVENTS.QUO_CALLS,
                label: this.constructor.WEBHOOK_LABELS.QUO_CALLS,
                status: 'enabled',
            });

            if (!callWebhookResponse?.data?.id) {
                throw new Error(
                    'Invalid Quo call webhook response: missing webhook ID',
                );
            }

            if (!callWebhookResponse.data.key) {
                throw new Error(
                    'Invalid Quo call webhook response: missing webhook key',
                );
            }

            const callWebhookId = callWebhookResponse.data.id;
            const callWebhookKey = callWebhookResponse.data.key;

            createdWebhooks.push({
                type: 'call',
                id: callWebhookId,
            });

            console.log(
                `[Quo] ✓ Call webhook registered with ID: ${callWebhookId}`,
            );

            const callSummaryWebhookResponse =
                await this.quo.api.createCallSummaryWebhook({
                    url: webhookUrl,
                    events: this.constructor.WEBHOOK_EVENTS.QUO_CALL_SUMMARIES,
                    label: this.constructor.WEBHOOK_LABELS.QUO_CALL_SUMMARIES,
                    status: 'enabled',
                });

            if (!callSummaryWebhookResponse?.data?.id) {
                throw new Error(
                    'Invalid Quo call-summary webhook response: missing webhook ID',
                );
            }

            if (!callSummaryWebhookResponse.data.key) {
                throw new Error(
                    'Invalid Quo call-summary webhook response: missing webhook key',
                );
            }

            const callSummaryWebhookId = callSummaryWebhookResponse.data.id;
            const callSummaryWebhookKey = callSummaryWebhookResponse.data.key;

            createdWebhooks.push({
                type: 'callSummary',
                id: callSummaryWebhookId,
            });

            console.log(
                `[Quo] ✓ Call-summary webhook registered with ID: ${callSummaryWebhookId}`,
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

            await this.updateIntegrationMessages.execute(
                this.id,
                'errors',
                'Quo Webhook Setup Failed',
                `Could not register webhooks with Quo: ${error.message}. Integration requires both message and call webhooks to function properly.`,
                Date.now(),
            );

            return {
                status: 'failed',
                error: error.message,
            };
        }
    }

    // ============================================================================
    // LIFECYCLE METHODS
    // ============================================================================

    /**
     * Called when integration is deleted
     * Clean up webhook registration with AxisCare
     *
     * @param {Object} params - Deletion parameters
     * @returns {Promise<void>}
     */
    async onDelete(params) {
        const deletionResults = {
            quoMessage: null,
            quoCall: null,
            quoCallSummary: null,
        };

        try {
            // Validate that API modules are loaded before attempting webhook deletion
            if (!this.axiscare?.api || !this.quo?.api) {
                const missingModules = [];
                if (!this.axiscare?.api) missingModules.push('axiscare');
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

                if (this.config?.axiscareWebhookId) {
                    console.warn(
                        `  - AxisCare webhook: ${this.config.axiscareWebhookId}`,
                    );
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

                console.warn(
                    '[Webhook Cleanup] You will need to manually delete these webhooks from the external services.',
                );

                await super.onDelete(params);
                return;
            }

            // AxisCare webhook cleanup note
            const axiscareWebhookId = this.config?.axiscareWebhookId;
            if (axiscareWebhookId) {
                console.log(
                    `[AxisCare] Webhook ${axiscareWebhookId} registered (manual deletion required via AxisCare admin UI)`,
                );
            } else {
                console.log('[AxisCare] No webhook configured');
            }

            // Delete Quo message webhook
            const quoMessageWebhookId = this.config?.quoMessageWebhookId;
            if (quoMessageWebhookId) {
                console.log(
                    `[Quo] Deleting message webhook: ${quoMessageWebhookId}`,
                );

                try {
                    await this.quo.api.deleteWebhook(quoMessageWebhookId);
                    deletionResults.quoMessage = 'success';
                    console.log(
                        `[Quo] ✓ Message webhook ${quoMessageWebhookId} deleted from Quo`,
                    );
                } catch (error) {
                    deletionResults.quoMessage = 'failed';
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

            // Delete Quo call webhook
            const quoCallWebhookId = this.config?.quoCallWebhookId;
            if (quoCallWebhookId) {
                console.log(`[Quo] Deleting call webhook: ${quoCallWebhookId}`);

                try {
                    await this.quo.api.deleteWebhook(quoCallWebhookId);
                    deletionResults.quoCall = 'success';
                    console.log(
                        `[Quo] ✓ Call webhook ${quoCallWebhookId} deleted from Quo`,
                    );
                } catch (error) {
                    deletionResults.quoCall = 'failed';
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

            // Delete Quo call-summary webhook
            const quoCallSummaryWebhookId =
                this.config?.quoCallSummaryWebhookId;
            if (quoCallSummaryWebhookId) {
                console.log(
                    `[Quo] Deleting call-summary webhook: ${quoCallSummaryWebhookId}`,
                );

                try {
                    await this.quo.api.deleteWebhook(quoCallSummaryWebhookId);
                    deletionResults.quoCallSummary = 'success';
                    console.log(
                        `[Quo] ✓ Call-summary webhook ${quoCallSummaryWebhookId} deleted from Quo`,
                    );
                } catch (error) {
                    deletionResults.quoCallSummary = 'failed';
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

            console.log('[Webhook Cleanup] Summary:', deletionResults);
        } catch (error) {
            console.error('[Webhook Cleanup] Error during cleanup:', error);
        }

        // Call parent class cleanup
        await super.onDelete(params);
    }

    async getConfigOptions() {
        // Construct webhook URL (integration ID and siteNumber guaranteed to exist)
        const webhookUrl = `${process.env.BASE_URL}/api/axisCare-integration/webhooks/${this.id}`;

        // Build admin panel URL with authenticated siteNumber
        const adminUrl = `https://${this.axisCare.credential.data.siteNumber}.axiscare.com/?/admin/webhooks`;

        return {
            jsonSchema: {
                type: 'object',
                properties: {
                    webhookUrl: {
                        type: 'string',
                        title: 'Webhook Endpoint URL',
                        default: webhookUrl,
                        readOnly: true,
                    },
                },
            },
            uiSchema: {
                type: 'VerticalLayout',
                elements: [
                    {
                        type: 'Control',
                        scope: '#/properties/webhookUrl',
                        options: {
                            help:
                                `MANUAL SETUP REQUIRED:\n\n` +
                                `1. Copy the webhook URL above\n` +
                                `2. Navigate to: ${adminUrl}\n` +
                                `3. Create a new webhook and paste the URL\n` +
                                `4. Subscribe to these events:\n` +
                                `   • client.created, client.updated\n` +
                                `   • caregiver.created, caregiver.updated\n` +
                                `   • lead.created, lead.updated\n` +
                                `   • applicant.created, applicant.updated\n` +
                                `5. The webhook will auto-activate on first event received`,
                        },
                    },
                ],
            },
        };
    }

    async getActionOptions({ actionId, data }) {
        switch (actionId) {
            case 'SYNC_CLIENTS_TO_QUO':
                return {
                    jsonSchema: {
                        type: 'object',
                        properties: {
                            limit: {
                                type: 'number',
                                title: 'Client Limit',
                                description:
                                    'Maximum clients to retrieve for sync',
                                minimum: 1,
                                maximum: 1000,
                                default: 50,
                            },
                            maxClients: {
                                type: 'number',
                                title: 'Max Clients to Sync',
                                description: 'Maximum clients to actually sync',
                                minimum: 1,
                                maximum: 100,
                                default: 10,
                            },
                            status: {
                                type: 'string',
                                title: 'Client Status Filter',
                                description:
                                    'Only sync clients with this status',
                                enum: [
                                    'active',
                                    'inactive',
                                    'pending',
                                    'archived',
                                ],
                            },
                        },
                        required: [],
                    },
                    uiSchema: {
                        type: 'VerticalLayout',
                        elements: [
                            {
                                type: 'Control',
                                scope: '#/properties/limit',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/maxClients',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/status',
                            },
                        ],
                    },
                };
        }
        return null;
    }

    async syncClientsToQuo(args) {
        try {
            const axiscareClients = await this.axisCare.api.listClients({
                limit: args.limit || 50,
                statuses: args.status,
            });

            const syncResults = [];

            for (const client of axiscareClients.results?.clients?.slice(
                0,
                args.maxClients || 10,
            ) || []) {
                try {
                    const quoContactData =
                        await this.transformPersonToQuo(client);

                    let quoResult = null;
                    if (this.quo?.api) {
                        quoResult =
                            await this.quo.api.createContact(quoContactData);
                    }

                    syncResults.push({
                        axisCareClient: {
                            id: client.id,
                            name: `${client.goesBy || client.firstName} ${client.lastName}`,
                            email: client.personalEmail,
                            phone: client.homePhone || client.mobilePhone,
                            status: client.status?.label || client.status,
                        },
                        quoContact: quoResult,
                        syncStatus: quoResult ? 'success' : 'quo_unavailable',
                        timestamp: new Date().toISOString(),
                    });
                } catch (clientError) {
                    syncResults.push({
                        axisCareClient: client,
                        error: clientError.message,
                        syncStatus: 'error',
                        timestamp: new Date().toISOString(),
                    });
                }
            }

            return {
                label: 'Client Sync Results',
                data: {
                    totalClientsProcessed: syncResults.length,
                    syncSummary: syncResults.reduce((summary, result) => {
                        summary[result.syncStatus] =
                            (summary[result.syncStatus] || 0) + 1;
                        return summary;
                    }, {}),
                    syncResults,
                    timestamp: new Date().toISOString(),
                },
            };
        } catch (error) {
            console.error('Client sync failed:', error);
            throw new Error(`Client sync failed: ${error.message}`);
        }
    }

    /**
     * Fetch a single client by ID
     * @param {string} id - Client ID
     * @returns {Promise<Object>}
     */
    async fetchPersonById(id) {
        return await this.axisCare.api.getClient(id);
    }

    /**
     * Fetch multiple clients by IDs (for webhook batch processing)
     * Optimized: Uses bulk API call when possible, falls back to sequential
     * @param {string[]} ids - Array of client IDs
     * @returns {Promise<Object[]>}
     */
    async fetchPersonsByIds(ids) {
        if (!ids || ids.length === 0) {
            return [];
        }

        try {
            // Use bulk API call (much faster than sequential)
            const response = await this.axisCare.api.listClients({
                clientIds: ids.join(','),
                limit: ids.length,
            });

            return response.results?.clients || [];
        } catch (error) {
            console.warn(
                `Bulk fetch failed for ${ids.length} clients, falling back to sequential:`,
                error.message,
            );

            // Fallback: Fetch one-by-one (slower but more resilient)
            return await this._fetchPersonsByIdsSequential(ids);
        }
    }

    /**
     * Fallback method: Fetch clients sequentially
     * @private
     * @param {string[]} ids - Array of client IDs
     * @returns {Promise<Object[]>}
     */
    async _fetchPersonsByIdsSequential(ids) {
        const clients = [];
        for (const id of ids) {
            try {
                const client = await this.fetchPersonById(id);
                clients.push(client);
            } catch (error) {
                console.error(`Failed to fetch client ${id}:`, error.message);
            }
        }
        return clients;
    }

    async listClients({ req, res }) {
        try {
            const params = {
                startAfterId: req.query.startAfterId
                    ? parseInt(req.query.startAfterId)
                    : undefined,
                limit: req.query.limit ? parseInt(req.query.limit) : 100,
            };

            const clients = await this.axisCare.api.listClients(params);
            res.json(clients);
        } catch (error) {
            console.error('Failed to list AxisCare clients:', error);
            res.status(500).json({
                error: 'Failed to list clients',
                details: error.message,
            });
        }
    }
}

module.exports = AxisCareIntegration;
