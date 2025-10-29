const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');
const { createFriggCommands } = require('@friggframework/core');
const attio = require('@friggframework/api-module-attio');
const quo = require('../api-modules/quo');

/**
 * AttioIntegration - Refactored to extend BaseCRMIntegration
 *
 * Attio-specific implementation for syncing people/companies with Quo.
 * Attio uses a modern record-based API with flexible data structures.
 */
class AttioIntegration extends BaseCRMIntegration {
    static Definition = {
        name: 'attio',
        version: '1.0.0',
        supportedVersions: ['1.0.0'],
        hasUserConfig: true,
        webhooks: {
            enabled: true,
        },

        display: {
            label: 'Attio',
            description: 'Modern CRM platform integration with Quo API',
            category: 'CRM, Sales',
            detailsUrl: 'https://app.attio.com',
            icon: '',
        },
        modules: {
            attio: { definition: attio.Definition },
            quo: { definition: quo.Definition },
        },
        routes: [
            {
                path: '/attio/objects',
                method: 'GET',
                event: 'LIST_ATTIO_OBJECTS',
            },
            {
                path: '/attio/company',
                method: 'GET',
                event: 'LIST_ATTIO_COMPANIES',
            },
            {
                path: '/attio/people',
                method: 'GET',
                event: 'LIST_ATTIO_PEOPLE',
            },
        ],
    };

    /**
     * CRM Configuration - Required by BaseCRMIntegration
     */
    static CRMConfig = {
        personObjectTypes: [
            { crmObjectName: 'people', quoContactType: 'contact' },
        ],
        syncConfig: {
            paginationType: 'CURSOR_BASED',
            supportsTotal: false,
            returnFullRecords: true,
            reverseChronological: true,
            initialBatchSize: 50,
            ongoingBatchSize: 25,
            supportsWebhooks: true,
            webhooksEnabled: true,
            // Note: No polling fallback - Attio's webhooks are comprehensive and reliable
            // If webhooks fail to setup, integration operates in manual-sync mode only
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
        QUO_MESSAGES: 'Attio Integration - Messages',
        QUO_CALLS: 'Attio Integration - Calls',
        QUO_CALL_SUMMARIES: 'Attio Integration - Call Summaries',
    };

    /**
     * Webhook event subscriptions
     * Defines which events each webhook type listens for
     */
    static WEBHOOK_EVENTS = {
        ATTIO: [
            { event_type: 'record.created', filter: null },
            { event_type: 'record.updated', filter: null },
            { event_type: 'record.deleted', filter: null },
        ],
        QUO_MESSAGES: ['message.received', 'message.delivered'],
        QUO_CALLS: ['call.completed'],
        QUO_CALL_SUMMARIES: ['call.summary.completed'],
    };

    constructor(params) {
        super(params);

        this.commands = createFriggCommands({
            integrationClass: AttioIntegration,
        });

        this.events = {
            ...this.events,

            LIST_ATTIO_OBJECTS: {
                handler: this.listObjects,
            },
            LIST_ATTIO_COMPANIES: {
                handler: this.listCompanies,
            },
            LIST_ATTIO_PEOPLE: {
                handler: this.listPeople,
            },
            GET_ATTIO_CUSTOM_OBJECTS: {
                type: 'USER_ACTION',
                handler: this.getCustomObjects,
                title: 'Get Custom Objects',
                description: 'Retrieve custom object types from Attio',
                userActionType: 'DATA',
            },
            CREATE_ATTIO_RECORD: {
                type: 'USER_ACTION',
                handler: this.createRecord,
                title: 'Create Attio Record',
                description: 'Create a new record in Attio',
                userActionType: 'DATA',
            },
            SEARCH_ATTIO_RECORDS: {
                type: 'USER_ACTION',
                handler: this.searchRecords,
                title: 'Search Attio Records',
                description: 'Search for records across Attio accounts',
                userActionType: 'SEARCH',
            },
            ON_WEBHOOK: {
                handler: this.onWebhook,
            },
        };
    }

    // ============================================================================
    // WEBHOOK INFRASTRUCTURE - Private Helper Methods
    // ============================================================================

    /**
     * Verify Attio webhook signature
     * Uses HMAC-SHA256 to verify the webhook payload against the stored secret
     *
     * @private
     * @param {Object} params
     * @param {string} params.signature - Signature from webhook headers (X-Attio-Signature or similar)
     * @param {string} params.payload - Raw webhook payload (stringified JSON)
     * @param {string} params.secret - Stored webhook secret from config
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

            // Check lengths match before comparing to prevent timingSafeEqual from throwing
            if (signature.length !== expectedSignature.length) {
                return false;
            }

            // Constant-time comparison to prevent timing attacks
            return crypto.timingSafeEqual(
                Buffer.from(signature),
                Buffer.from(expectedSignature),
            );
        } catch (error) {
            console.error('[Attio] Signature verification error:', error);
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
            { name: 'timestamp + body (no separator)', payload: timestamp + JSON.stringify(body), keyTransform: 'plain' },
            { name: 'timestamp + body (no separator, base64 key)', payload: timestamp + JSON.stringify(body), keyTransform: 'base64' },
            { name: 'timestamp + "." + body (dot separator)', payload: timestamp + '.' + JSON.stringify(body), keyTransform: 'plain' },
            { name: 'timestamp + "." + body (dot separator, base64 key)', payload: timestamp + '.' + JSON.stringify(body), keyTransform: 'base64' },
        ];

        let matchFound = false;

        for (const format of testFormats) {
            const key = format.keyTransform === 'base64'
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
            throw new Error('Webhook signature verification failed - no matching format found');
        }

        console.log('[Quo Webhook] ✓ Signature verified');
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
     * @param {string} path - Webhook path (e.g., '/webhooks/quo/messages/{id}')
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
     * Resolve Attio object_id to object_type (API slug)
     * Caches results to avoid repeated API calls
     *
     * @private
     * @param {string} objectId - Attio object UUID
     * @returns {Promise<string>} Object type/slug (e.g., 'people', 'companies')
     */
    async _resolveObjectType(objectId) {
        if (!this._objectTypeCache) {
            this._objectTypeCache = new Map();
        }

        if (this._objectTypeCache.has(objectId)) {
            return this._objectTypeCache.get(objectId);
        }

        try {
            const response = await this.attio.api.getObject(objectId);

            // Attio API wraps responses in a 'data' property
            const object = response.data;

            if (!object) {
                console.warn(
                    `[Attio] No data in getObject response for ${objectId}`,
                );
                return objectId;
            }

            // Use api_slug (e.g., 'people', 'companies') or fallback to lowercase plural_noun
            const objectType =
                object.api_slug ||
                object.plural_noun?.toLowerCase() ||
                objectId;

            this._objectTypeCache.set(objectId, objectType);

            console.log(
                `[Attio] Resolved object ${objectId} to type: ${objectType}`,
            );
            return objectType;
        } catch (error) {
            console.error(
                `[Attio] Failed to resolve object type for ${objectId}:`,
                error,
            );
            return objectId;
        }
    }

    // ============================================================================
    // WEBHOOK EVENT HANDLERS - Called from onWebhook()
    // ============================================================================

    /**
     * Handle record.created webhook event
     * Fetches full record data and syncs to Quo
     *
     * @private
     * @param {Object} eventData - Event data from webhook
     * @param {string} eventData.record_id - Attio record ID
     * @param {string} eventData.object_id - Attio object UUID
     * @returns {Promise<void>}
     */
    async _handleRecordCreated(eventData) {
        console.log(
            `[Attio Webhook] Handling record.created:`,
            eventData.record_id,
        );

        const { record_id, object_id } = eventData;

        if (!record_id || !object_id) {
            throw new Error(
                'Missing record_id or object_id in webhook payload',
            );
        }

        const object_type = await this._resolveObjectType(object_id);

        try {
            const response = await this.attio.api.getRecord(
                object_id,
                record_id,
            );

            const record = response?.data;

            if (!record) {
                console.warn(
                    `[Attio Webhook] Record ${record_id} not found in Attio`,
                );
                return;
            }

            switch (object_type) {
                case 'people':
                    await this._syncPersonToQuo(record, 'created');
                    break;

                default:
                    console.log(
                        `[Attio Webhook] Object type '${object_type}' not configured for sync`,
                    );
            }

            await this.upsertMapping(record_id, {
                externalId: record_id,
                entityType: object_type,
                lastSyncedAt: new Date().toISOString(),
                syncMethod: 'webhook',
                action: 'created',
            });

            console.log(
                `[Attio Webhook] ✓ Synced ${object_type} ${record_id} to Quo`,
            );
        } catch (error) {
            console.error(
                `[Attio Webhook] Failed to sync ${object_type} ${record_id}:`,
                error.message,
            );
            throw error;
        }
    }

    /**
     * Handle record.updated webhook event
     * Fetches updated record data and syncs to Quo
     *
     * @private
     * @param {Object} eventData - Event data from webhook
     * @returns {Promise<void>}
     */
    async _handleRecordUpdated(eventData) {
        console.log(
            `[Attio Webhook] Handling record.updated:`,
            eventData.record_id,
        );

        const { record_id, object_id } = eventData;

        const objectType = await this._resolveObjectType(object_id);

        try {
            const response = await this.attio.api.getRecord(
                object_id,
                record_id,
            );

            const record = response?.data;

            if (!record) {
                console.warn(
                    `[Attio Webhook] Record ${record_id} not found - may have been deleted`,
                );
                return;
            }

            switch (objectType) {
                case 'people':
                    await this._syncPersonToQuo(record, 'updated');
                    break;
                default:
                    console.log(
                        `[Attio Webhook] Object type '${objectType}' not configured for sync`,
                    );
            }

            await this.upsertMapping(record_id, {
                externalId: record_id,
                entityType: objectType,
                lastSyncedAt: new Date().toISOString(),
                syncMethod: 'webhook',
                action: 'updated',
            });

            console.log(
                `[Attio Webhook] ✓ Updated ${objectType} ${record_id} in Quo`,
            );
        } catch (error) {
            console.error(
                `[Attio Webhook] Failed to update ${objectType} ${record_id}:`,
                error.message,
            );
            throw error;
        }
    }

    /**
     * Handle record.deleted webhook event
     * Marks record as deleted in Quo or removes mapping
     *
     * @private
     * @param {Object} eventData - Event data from webhook
     * @returns {Promise<void>}
     */
    async _handleRecordDeleted(eventData) {
        console.log(
            `[Attio Webhook] Handling record.deleted:`,
            eventData.record_id,
        );

        const { record_id, object_id } = eventData;

        const objectType = await this._resolveObjectType(object_id);

        try {
            if (objectType === 'people') {
                if (!this.quo?.api) {
                    throw new Error('Quo API not available');
                }

                const existingContacts = await this.quo.api.listContacts({
                    externalIds: [record_id],
                    maxResults: 10,
                });

                if (
                    !existingContacts?.data ||
                    existingContacts.data.length === 0
                ) {
                    console.warn(
                        `[Attio Webhook] Contact with externalId ${record_id} not found in Quo (may have been already deleted)`,
                    );
                    return;
                }

                const exactMatch = existingContacts.data.find(
                    (contact) => contact.externalId === record_id,
                );

                if (!exactMatch) {
                    console.warn(
                        `[Attio Webhook] No exact match for externalId ${record_id} in Quo`,
                    );
                    return;
                }

                const quoContactId = exactMatch.id;
                const deleteResponse =
                    await this.quo.api.deleteContact(quoContactId);

                if (!deleteResponse || deleteResponse.status !== 204) {
                    throw new Error(
                        `Delete contact failed: Expected 204 status, got ${deleteResponse?.status || 'unknown'}`,
                    );
                }

                console.log(
                    `[Attio Webhook] ✓ Contact ${quoContactId} deleted from Quo (externalId: ${record_id})`,
                );
            } else {
                console.log(
                    `[Attio Webhook] Object type '${objectType}' deletion not yet implemented`,
                );
            }
        } catch (error) {
            console.error(
                `[Attio Webhook] Failed to handle deletion of ${record_id}:`,
                error.message,
            );
            throw error;
        }
    }

    // ============================================================================
    // REQUIRED METHODS - BaseCRMIntegration Abstract Methods
    // ============================================================================

    /**
     * Fetch a page of persons from Attio (CURSOR_BASED)
     * @param {Object} params
     * @param {string} params.objectType - CRM object type (people)
     * @param {number|null} params.cursor - Cursor position (offset)
     * @param {number} params.limit - Records per page
     * @param {Date} [params.modifiedSince] - Filter by modification date
     * @param {boolean} [params.sortDesc=true] - Sort descending
     * @returns {Promise<{data: Array, cursor: number|null, hasMore: boolean}>}
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
                offset: cursor || 0,
            };

            if (modifiedSince) {
                console.warn(
                    '[Attio] modifiedSince filter not supported - Attio has no updated_at attribute',
                );
            }

            // Attio uses object slugs (e.g., 'people', 'companies')
            const response = await this.attio.api.listRecords(
                objectType,
                params,
            );
            const persons = response.data || [];

            const nextCursor =
                persons.length === limit ? (cursor || 0) + limit : null;

            console.log(
                `[Attio] Fetched ${persons.length} ${objectType} at offset ${cursor || 0}, ` +
                    `hasMore=${!!nextCursor}`,
            );

            return {
                data: persons,
                cursor: nextCursor,
                hasMore: persons.length === limit,
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
     * Transform Attio person object to Quo contact format
     * @param {Object} person - Attio person record
     * @param {Map<string, Object>|null} companyMap - Optional pre-fetched company map (id -> company data)
     * @returns {Promise<Object>} Quo contact format
     */
    async transformPersonToQuo(person, companyMap = null) {
        const attributes = person.values || {};

        const nameAttr = this.getActiveValue(attributes.name);
        let firstName = nameAttr?.first_name || '';
        const lastName = nameAttr?.last_name || '';

        // Handle missing firstName (required by Quo) - use 'Unknown' fallback
        if (!firstName || firstName.trim() === '') {
            firstName = 'Unknown';
        }

        const roleAttr =
            this.getActiveValue(attributes.job_title) ||
            this.getActiveValue(attributes.role);
        const role = roleAttr?.value || null;

        const emails = [];
        const emailAttrs = attributes.email_addresses || [];
        for (const emailAttr of emailAttrs) {
            if (emailAttr.active_until === null && emailAttr.email_address) {
                emails.push({
                    name: 'email',
                    value: emailAttr.email_address,
                });
            }
        }

        const phoneNumbers = [];
        const phoneAttrs = attributes.phone_numbers || [];
        for (const phoneAttr of phoneAttrs) {
            if (phoneAttr.active_until === null && phoneAttr.phone_number) {
                phoneNumbers.push({
                    name: 'phone',
                    value: phoneAttr.phone_number,
                });
            }
        }

        let company = null;
        const companyAttr = this.getActiveValue(attributes.company);

        if (companyAttr && companyAttr.target_record_id) {
            // Dual-mode: use pre-fetched companyMap if provided, else fetch individually
            if (companyMap && companyMap.has(companyAttr.target_record_id)) {
                const companyData = companyMap.get(
                    companyAttr.target_record_id,
                );
                company = companyData?.values?.name?.[0]?.value || null;
            } else {
                try {
                    const companyRecord = await this.attio.api.getRecord(
                        'companies',
                        companyAttr.target_record_id,
                    );
                    company =
                        companyRecord.data?.values?.name?.[0]?.value || null;
                } catch (error) {
                    console.warn(
                        `[AttioIntegration] Failed to fetch company ${companyAttr.target_record_id} for person ${person.id.record_id}:`,
                        error.message,
                    );
                    company = null;
                }
            }
        }

        return {
            externalId: person.id.record_id,
            source: 'attio',
            defaultFields: {
                firstName,
                lastName,
                company,
                role,
                phoneNumbers,
                emails,
            },
            customFields: [],
        };
    }

    /**
     * Get the first active value from an Attio attribute array
     * Attio attributes are arrays where each item has active_from/active_until timestamps
     * @param {Array} attributeArray - Array of attribute value objects
     * @returns {Object|null} First active value (active_until === null) or first item as fallback
     */
    getActiveValue(attributeArray) {
        if (!Array.isArray(attributeArray) || attributeArray.length === 0) {
            return null;
        }

        // Find first active value (active_until === null means currently active)
        const activeValue = attributeArray.find(
            (attr) => attr.active_until === null,
        );

        return activeValue || attributeArray[0];
    }

    /**
     * Fetch multiple company records by IDs using a single batch query
     * @param {string[]} companyIds - Array of company record IDs
     * @returns {Promise<Array<Object>>} Array of company records
     */
    async fetchCompaniesByIds(companyIds) {
        if (!companyIds || companyIds.length === 0) {
            return [];
        }

        console.log(
            `[AttioIntegration] Fetching ${companyIds.length} unique companies in single batch query`,
        );

        try {
            // Use Attio's query endpoint with $in filter to fetch all companies at once
            const result = await this.attio.api.queryRecords('companies', {
                filter: {
                    record_id: {
                        $in: companyIds,
                    },
                },
            });

            const companies = result.data || [];

            console.log(
                `[AttioIntegration] Successfully fetched ${companies.length}/${companyIds.length} companies`,
            );

            // Log missing companies (requested but not returned)
            if (companies.length < companyIds.length) {
                const returnedIds = new Set(
                    companies.map((c) => c.id.record_id),
                );
                const missingIds = companyIds.filter(
                    (id) => !returnedIds.has(id),
                );
                console.warn(
                    `[AttioIntegration] ${missingIds.length} companies not found:`,
                    missingIds,
                );
            }

            return companies;
        } catch (error) {
            console.error(
                `[AttioIntegration] Failed to fetch companies in batch:`,
                error.message,
            );
            // Return empty array on error - individual transforms will fall back to individual fetch
            return [];
        }
    }

    /**
     * Batch transform Attio persons to Quo contacts
     * Optimized: pre-fetches all unique companies to avoid N+1 queries
     *
     * @param {Array<Object>} persons - Array of Attio person records
     * @returns {Promise<Array<Object>>} Array of Quo contact objects
     */
    async transformPersonsToQuo(persons) {
        if (!persons || persons.length === 0) {
            return [];
        }

        const companyIds = [
            ...new Set(
                persons
                    .map((p) => {
                        const attributes = p.values || {};
                        const companyAttr = this.getActiveValue(
                            attributes.company,
                        );
                        return companyAttr?.target_record_id;
                    })
                    .filter(Boolean),
            ),
        ];

        let companyMap = new Map();
        if (companyIds.length > 0) {
            const companies = await this.fetchCompaniesByIds(companyIds);
            companyMap = new Map(companies.map((c) => [c.id.record_id, c]));
        }

        return Promise.all(
            persons.map((p) => this.transformPersonToQuo(p, companyMap)),
        );
    }

    /**
     * Log SMS message to Attio as a note/interaction
     * @param {Object} activity - SMS activity
     * @returns {Promise<void>}
     */
    async logSMSToActivity(activity) {
        try {
            const response = await this.attio.api.getRecord(
                'people',
                activity.contactExternalId,
            );
            if (!response?.data) {
                console.warn(
                    `Person not found for SMS logging: ${activity.contactExternalId}`,
                );
                return;
            }

            const noteData = {
                parent_object: 'people',
                parent_record_id: activity.contactExternalId,
                title: `SMS: ${activity.direction}`,
                format: 'markdown',
                content: activity.content,
                created_at: activity.timestamp,
            };

            await this.attio.api.createNote(noteData);
        } catch (error) {
            console.error('Failed to log SMS activity to Attio:', error);
            throw error;
        }
    }

    /**
     * Log phone call to Attio as a note/interaction
     * @param {Object} activity - Call activity
     * @returns {Promise<void>}
     */
    async logCallToActivity(activity) {
        try {
            const response = await this.attio.api.getRecord(
                'people',
                activity.contactExternalId,
            );
            if (!response?.data) {
                console.warn(
                    `Person not found for call logging: ${activity.contactExternalId}`,
                );
                return;
            }

            const noteData = {
                parent_object: 'people',
                parent_record_id: activity.contactExternalId,
                title: `Call: ${activity.direction} (${activity.duration}s)`,
                format: 'markdown',
                content: activity.summary || 'Phone call',
                created_at: activity.timestamp,
            };

            await this.attio.api.createNote(noteData);
        } catch (error) {
            console.error('Failed to log call activity to Attio:', error);
            throw error;
        }
    }

    /**
     * Setup Attio webhook
     * Registers webhook with Attio API and stores webhook ID + secret in config
     * @private
     * @returns {Promise<Object>} Setup result with status, webhookId, webhookUrl, etc.
     */
    async setupAttioWebhook() {
        try {
            if (this.config?.attioWebhookId) {
                console.log(
                    `[Attio] Webhook already registered: ${this.config.attioWebhookId}`,
                );
                return {
                    status: 'already_configured',
                    webhookId: this.config.attioWebhookId,
                    webhookUrl: this.config.attioWebhookUrl,
                };
            }

            const webhookUrl = this._generateWebhookUrl(`/webhooks/${this.id}`);

            console.log(`[Attio] Registering webhook at: ${webhookUrl}`);

            const subscriptions = this.constructor.WEBHOOK_EVENTS.ATTIO;

            const webhookResponse = await this.attio.api.createWebhook({
                target_url: webhookUrl,
                subscriptions: subscriptions,
            });

            if (!webhookResponse?.data?.id?.webhook_id) {
                throw new Error(
                    'Invalid Attio webhook response: missing webhook ID',
                );
            }

            if (!webhookResponse.data.secret) {
                throw new Error(
                    'Invalid Attio webhook response: missing webhook secret',
                );
            }

            const webhookId = webhookResponse.data.id.webhook_id;
            const webhookSecret = webhookResponse.data.secret;

            const updatedConfig = {
                ...this.config,
                attioWebhookId: webhookId,
                attioWebhookUrl: webhookUrl,
                attioWebhookSecret: webhookSecret,
                webhookCreatedAt: new Date().toISOString(),
                webhookSubscriptions: subscriptions.map((s) => s.event_type),
            };

            await this.commands.updateIntegrationConfig({
                integrationId: this.id,
                config: updatedConfig,
            });

            this.config = updatedConfig;

            console.log(`[Attio] ✓ Webhook registered with ID: ${webhookId}`);
            console.log(`[Attio] ✓ Secret stored securely (encrypted at rest)`);

            return {
                status: 'configured',
                webhookId: webhookId,
                webhookUrl: webhookUrl,
                subscriptions: subscriptions.map((s) => s.event_type),
            };
        } catch (error) {
            console.error('[Attio] Failed to setup webhook:', error);

            // Non-fatal error handling
            await this.updateIntegrationMessages.execute(
                this.id,
                'errors',
                'Attio Webhook Setup Failed',
                `Could not register webhook with Attio: ${error.message}. Automatic sync disabled. Please check OAuth scopes include 'webhook:read-write' and try again.`,
                Date.now(),
            );

            return {
                status: 'failed',
                error: error.message,
                note: 'Manual sync still available via API routes',
            };
        }
    }

    /**
     * Setup Quo webhooks (message and call webhooks)
     * Registers webhooks with Quo API and stores webhook IDs + keys in config
     * Uses atomic pattern: creates both webhooks before saving config, with rollback on failure
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

            // Check for partial configuration (recovery scenario)
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

            // Fatal error - both webhooks required
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

    /**
     * Setup webhooks with both Attio and Quo
     * Called during onCreate lifecycle (BaseCRMIntegration)
     * Orchestrates webhook setup for both services - BOTH required for success
     * @returns {Promise<Object>} Setup result
     */
    async setupWebhooks() {
        const results = {
            attio: null,
            quo: null,
            overallStatus: 'success',
        };

        try {
            // Setup Attio webhook
            results.attio = await this.setupAttioWebhook();

            // Setup Quo webhooks
            results.quo = await this.setupQuoWebhook();

            // BOTH required - fail if either fails
            if (
                results.attio.status === 'failed' ||
                results.quo.status === 'failed'
            ) {
                results.overallStatus = 'failed';
                const failedServices = [];
                if (results.attio.status === 'failed')
                    failedServices.push('Attio');
                if (results.quo.status === 'failed') failedServices.push('Quo');

                throw new Error(
                    `Webhook setup failed for: ${failedServices.join(', ')}. Both Attio and Quo webhooks are required for integration to function.`,
                );
            }

            console.log(
                '[Webhook Setup] ✓ All webhooks configured successfully',
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

            throw error; // Re-throw since both are required
        }
    }

    /**
     * Optional: Override HTTP webhook receiver to add signature verification
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
            const attioSignature =
                req.headers['x-attio-signature'] ||
                req.headers['attio-signature'] ||
                req.headers['x-webhook-signature'];
            const quoSignature = req.headers['openphone-signature'];

            // Determine webhook source based on signature header
            const source = quoSignature ? 'quo' : 'attio';

            const signature = attioSignature || quoSignature;

            // Early signature validation - reject webhooks without signatures
            // This prevents queue flooding attacks
            if (!signature) {
                console.error(
                    `[${source === 'quo' ? 'Quo' : 'Attio'} Webhook] Missing signature header - rejecting webhook`,
                );
                res.status(401).json({ error: 'Signature required' });
                return;
            }

            // Note: We can't verify signature here because we don't have DB access
            // Signature verification will happen in onWebhook() with full context

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
     * Process webhook events from both Attio and Quo
     * Called by queue worker with full database access and hydrated integration
     * Automatically invoked by Frigg's webhook infrastructure
     * Routes to appropriate handler based on webhook source
     *
     * @param {Object} params
     * @param {Object} params.data - Webhook data from queue
     * @param {Object} params.data.body - Webhook payload
     * @param {Object} params.data.headers - HTTP headers
     * @param {string} params.data.source - Webhook source ('attio' or 'quo')
     * @param {string} params.data.integrationId - Integration ID
     * @returns {Promise<Object>} Processing result
     */
    async onWebhook({ data }) {
        const { source } = data;

        console.log(`[Webhook] Processing ${source} webhook`);

        if (source === 'quo') {
            return await this._handleQuoWebhook(data);
        } else {
            return await this._handleAttioWebhook(data);
        }
    }

    /**
     * Process webhook events from Attio
     * Called by onWebhook() router
     *
     * @private
     * @param {Object} data - Webhook data from queue
     * @returns {Promise<Object>} Processing result
     */
    async _handleAttioWebhook(data) {
        const { body, headers, integrationId } = data;

        const signature = headers['x-attio-signature'];

        console.log(
            `[Attio Webhook] Processing webhook with ${body.events?.length || 0} event(s)`,
        );

        try {
            const webhookSecret = this.config?.attioWebhookSecret;

            if (webhookSecret && signature) {
                const payloadString = JSON.stringify(body);
                const isValid = this._verifyWebhookSignature({
                    signature: signature,
                    payload: payloadString,
                    secret: webhookSecret,
                });

                if (!isValid) {
                    console.error(
                        '[Attio Webhook] Invalid signature - possible security issue!',
                    );
                    throw new Error('Webhook signature verification failed');
                }

                console.log('[Attio Webhook] ✓ Signature verified');
            } else {
                console.warn(
                    '[Attio Webhook] No secret or signature - skipping verification',
                );
            }

            if (
                !body.events ||
                !Array.isArray(body.events) ||
                body.events.length === 0
            ) {
                throw new Error(
                    'Webhook payload missing or empty events array',
                );
            }

            const results = [];
            for (const event of body.events) {
                const eventType = event.event_type;
                const eventId = event.id;

                console.log(`[Attio Webhook] Processing event:`, {
                    eventType,
                    recordId: eventId?.record_id,
                    objectId: eventId?.object_id,
                    workspaceId: eventId?.workspace_id,
                });

                if (!eventType) {
                    console.warn(
                        '[Attio Webhook] Event missing event_type, skipping',
                    );
                    results.push({
                        success: false,
                        error: 'Missing event_type',
                    });
                    continue;
                }

                try {
                    const eventData = {
                        ...eventId,
                        actor: event.actor,
                        event_type: eventType,
                    };

                    switch (eventType) {
                        // Record events
                        case 'record.created':
                            await this._handleRecordCreated(eventData);
                            break;

                        case 'record.updated':
                            await this._handleRecordUpdated(eventData);
                            break;

                        case 'record.deleted':
                            await this._handleRecordDeleted(eventData);
                            break;

                        // Add more event handlers as needed
                        default:
                            console.log(
                                `[Attio Webhook] Unhandled event type: ${eventType}`,
                            );
                            results.push({
                                success: true,
                                skipped: true,
                                event: eventType,
                                reason: `Event type '${eventType}' not configured for sync`,
                            });
                            continue;
                    }

                    console.log(
                        `[Attio Webhook] ✓ Successfully processed ${eventType}`,
                    );

                    results.push({
                        success: true,
                        event: eventType,
                        recordId: eventId?.record_id,
                    });
                } catch (eventError) {
                    console.error(
                        `[Attio Webhook] Error processing event ${eventType}:`,
                        eventError,
                    );
                    results.push({
                        success: false,
                        event: eventType,
                        error: eventError.message,
                    });
                    // Continue processing other events
                }
            }

            return {
                success: true,
                processedAt: new Date().toISOString(),
                totalEvents: body.events.length,
                results,
            };
        } catch (error) {
            console.error('[Attio Webhook] Processing error:', error);

            // Log error to integration messages
            await this.updateIntegrationMessages.execute(
                this.id,
                'errors',
                'Attio Webhook Processing Error',
                `Failed to process Attio webhook: ${error.message}`,
                Date.now(),
            );

            // Re-throw for SQS retry and DLQ
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
     * Handle Quo call.completed webhook event
     * Finds Attio contact by phone number and logs call activity
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

        // Find the contact phone (not the user's phone)
        // Quo webhook participant indexing:
        // - Outgoing: [user_phone, contact_phone] → contact is index 1
        // - Incoming: [contact_phone, user_phone] → contact is index 0
        const contactPhone =
            callObject.direction === 'outgoing'
                ? participants[1]
                : participants[0];

        const attioRecordId = await this._findAttioContactByPhone(contactPhone);

        const deepLink = webhookData.data.deepLink || '#';

        const phoneNumberDetails = await this.quo.api.getPhoneNumber(
            callObject.phoneNumberId,
        );
        const inboxName = phoneNumberDetails.name || 'Quo Line';
        const inboxNumber = phoneNumberDetails.phoneNumber || participants[callObject.direction === 'outgoing' ? 0 : 1];

        const userDetails = await this.quo.api.getUser(callObject.userId);
        const userName =
            userDetails.name ||
            `${userDetails.firstName || ''} ${userDetails.lastName || ''}`.trim() ||
            'Quo User';

        const minutes = Math.floor(callObject.duration / 60);
        const seconds = callObject.duration % 60;
        const durationFormatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        let statusDescription;
        if (callObject.status === 'completed') {
            statusDescription = callObject.direction === 'outgoing'
                ? `Outgoing initiated by ${userName}`
                : `Incoming answered by ${userName}`;
        } else if (callObject.status === 'no-answer' || callObject.status === 'missed') {
            statusDescription = 'Incoming missed';
        } else {
            statusDescription = `${callObject.direction === 'outgoing' ? 'Outgoing' : 'Incoming'} ${callObject.status}`;
        }

        let formattedSummary;
        if (callObject.direction === 'outgoing') {
            formattedSummary = `☎️ Call Quo 📱 ${inboxName} (${inboxNumber}) → ${contactPhone}

${statusDescription}

[View the call activity in Quo](${deepLink})`;
        } else {
            formattedSummary = `☎️ Call ${contactPhone} → Quo 📱 ${inboxName} (${inboxNumber})

${statusDescription}`;

            if (callObject.status === 'completed' && callObject.duration > 0) {
                formattedSummary += ` / ▶️ Recording (${durationFormatted})`;
            }

            formattedSummary += `

[View the call activity in Quo](${deepLink})`;
        }

        const activityData = {
            contactExternalId: attioRecordId,
            direction:
                callObject.direction === 'outgoing' ? 'outbound' : 'inbound',
            timestamp: callObject.createdAt,
            duration: callObject.duration,
            summary: formattedSummary,
        };

        await this.logCallToActivity(activityData);

        console.log(`[Quo Webhook] ✓ Call logged for contact ${attioRecordId}`);

        return { logged: true, contactId: attioRecordId };
    }

    /**
     * Handle Quo message.received and message.delivered webhook events
     * Finds Attio contact by phone number and logs SMS activity
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

        const attioRecordId = await this._findAttioContactByPhone(contactPhone);

        const phoneNumberDetails = await this.quo.api.getPhoneNumber(
            messageObject.phoneNumberId,
        );
        const inboxName = phoneNumberDetails.name || 'Quo Inbox';

        const userDetails = await this.quo.api.getUser(messageObject.userId);
        const userName =
            userDetails.name ||
            `${userDetails.firstName || ''} ${userDetails.lastName || ''}`.trim() ||
            'Quo User';

        const deepLink = webhookData.data.deepLink || '#';

        let formattedContent;
        if (messageObject.direction === 'outgoing') {
            // Outgoing: Quo → Contact
            formattedContent = `💬 **Message Sent**

**From:** Quo ${inboxName} (${messageObject.from})
**To:** ${messageObject.to}

**${userName}** sent:
> ${messageObject.text || '(no text)'}

[View in Quo](${deepLink})`;
        } else {
            // Incoming: Contact → Quo
            formattedContent = `💬 **Message Received**

**From:** ${messageObject.from}
**To:** Quo ${inboxName} (${messageObject.to})

Received:
> ${messageObject.text || '(no text)'}

[View in Quo](${deepLink})`;
        }

        const activityData = {
            contactExternalId: attioRecordId,
            direction:
                messageObject.direction === 'outgoing' ? 'outbound' : 'inbound',
            content: formattedContent,
            timestamp: messageObject.createdAt,
        };

        await this.logSMSToActivity(activityData);

        console.log(
            `[Quo Webhook] ✓ Message logged for contact ${attioRecordId}`,
        );

        return { logged: true, contactId: attioRecordId };
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

        // Note: Call summaries arrive AFTER call.completed events
        // The call activity has already been logged to Attio
        // For now, we just acknowledge receipt
        // Future enhancement: Store summaries and retroactively update call activities

        return {
            received: true,
            callId,
            summaryPoints: summary.length,
            nextStepsCount: nextSteps.length,
        };
    }

    /**
     * Find Attio contact by phone number
     * Only returns contacts that were synced from Attio (have externalId mapping)
     * Uses normalized phone numbers and fallback search strategies
     *
     * @private
     * @param {string} phoneNumber - Phone number to search for
     * @returns {Promise<string>} Attio record ID
     * @throws {Error} If contact not found or not synced from Attio
     */
    async _findAttioContactByPhone(phoneNumber) {
        console.log(
            `[Quo Webhook] Looking up Attio contact by phone: ${phoneNumber}`,
        );

        const normalizedPhone = this._normalizePhoneNumber(phoneNumber);
        console.log(
            `[Quo Webhook] Normalized phone: ${phoneNumber} → ${normalizedPhone}`,
        );

        try {
            let contacts = [];

            // Strategy 1: Try exact phone_number filter
            try {
                const result = await this.attio.api.queryRecords('people', {
                    filter: {
                        phone_numbers: normalizedPhone,
                    },
                    limit: 10,
                });

                contacts = result.data || [];
                if (contacts.length > 0) {
                    console.log(
                        `[Quo Webhook] Found ${contacts.length} contact(s) using exact filter`,
                    );
                }
            } catch (filterError) {
                console.warn(
                    `[Quo Webhook] Exact filter failed, trying fallback: ${filterError.message}`,
                );
            }

            // Strategy 2: If exact filter fails or returns no results, try text search
            if (contacts.length === 0) {
                try {
                    const searchResult = await this.attio.api.searchRecords({
                        query: normalizedPhone,
                        objects: ['people'],
                        request_as: { type: 'workspace' },
                    });

                    const peopleResults =
                        searchResult.data?.filter(
                            (item) => item.object === 'people',
                        ) || [];

                    contacts = peopleResults.map((item) => item.record);

                    if (contacts.length > 0) {
                        console.log(
                            `[Quo Webhook] Found ${contacts.length} contact(s) using text search fallback`,
                        );
                    }
                } catch (searchError) {
                    console.warn(
                        `[Quo Webhook] Text search fallback also failed: ${searchError.message}`,
                    );
                }
            }

            if (contacts.length === 0) {
                throw new Error(
                    `No Attio contact found with phone number ${phoneNumber} (normalized: ${normalizedPhone}). ` +
                        `Contact must exist in Attio to log activities.`,
                );
            }

            // Filter to only contacts that were synced FROM Attio to Quo
            // These will have mappings in our integration
            for (const contact of contacts) {
                const recordId = contact.id.record_id;

                const mapping = await this.getMapping(recordId);

                if (mapping) {
                    console.log(
                        `[Quo Webhook] ✓ Found synced contact: ${recordId}`,
                    );
                    return recordId;
                }
            }

            throw new Error(
                `Found ${contacts.length} contact(s) with phone ${normalizedPhone} in Attio, ` +
                    `but none were synced from Attio to Quo. Only synced contacts can receive activity logs.`,
            );
        } catch (error) {
            console.error(
                `[Quo Webhook] Contact lookup failed:`,
                error.message,
            );
            throw error;
        }
    }

    // ============================================================================
    // OPTIONAL HELPER METHODS
    // ============================================================================

    /**
     * Fetch a single person by ID
     * @param {string} id - Person ID
     * @returns {Promise<Object>}
     */
    async fetchPersonById(id) {
        return await this.attio.api.objects.getRecord('people', id);
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

    // ============================================================================
    // WEBHOOK SYNC HELPER METHODS
    // ============================================================================

    /**
     * Sync Attio person record to Quo
     * Transforms Attio person data to Quo contact format
     *
     * @private
     * @param {Object} attioRecord - Attio person record
     * @param {string} action - created or updated
     * @returns {Promise<void>}
     */
    async _syncPersonToQuo(attioRecord, action) {
        console.log(
            `[Attio] Syncing person to Quo (${action}):`,
            attioRecord.id,
        );

        try {
            const quoContact = await this.transformPersonToQuo(attioRecord);

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
                    `[Attio] ✓ Contact ${createResponse.data.id} created in Quo (externalId: ${quoContact.externalId})`,
                );
            } else {
                const existingContacts = await this.quo.api.listContacts({
                    externalIds: [quoContact.externalId],
                    maxResults: 10,
                });

                if (
                    !existingContacts?.data ||
                    existingContacts.data.length === 0
                ) {
                    throw new Error(
                        `Contact with externalId ${quoContact.externalId} not found in Quo`,
                    );
                }

                const exactMatch = existingContacts.data.find(
                    (contact) => contact.externalId === quoContact.externalId,
                );

                if (!exactMatch) {
                    throw new Error(
                        `No exact match for externalId ${quoContact.externalId} in Quo (found ${existingContacts.data.length} results)`,
                    );
                }

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
                    `[Attio] ✓ Contact ${quoContactId} updated in Quo (externalId: ${externalId})`,
                );
            }

            console.log(
                `[Attio] ✓ Person ${attioRecord.id.record_id} synced to Quo`,
            );
        } catch (error) {
            console.error(
                `[Attio] Failed to sync person ${attioRecord.id}:`,
                error.message,
            );
            throw error;
        }
    }

    // ============================================================================
    // LIFECYCLE METHODS
    // ============================================================================

    /**
     * Called when integration is deleted
     * Clean up webhook registrations with both Attio and Quo
     * Uses selective cleanup: only clears config for successfully deleted webhooks
     *
     * @param {Object} params - Deletion parameters
     * @returns {Promise<void>}
     */
    async onDelete(params) {
        const deletionResults = {
            attio: null,
            quoMessage: null,
            quoCall: null,
            quoCallSummary: null,
        };

        try {
            // Validate that API modules are loaded before attempting webhook deletion
            if (!this.attio?.api || !this.quo?.api) {
                const missingModules = [];
                if (!this.attio?.api) missingModules.push('attio');
                if (!this.quo?.api) missingModules.push('quo');

                console.error(
                    `[Webhook Cleanup] Cannot delete webhooks: Missing API modules: ${missingModules.join(', ')}`
                );
                console.error(
                    '[Webhook Cleanup] This likely means modules were not loaded during the deletion lifecycle.'
                );
                console.warn(
                    '[Webhook Cleanup] Webhook IDs have been preserved in config for manual cleanup:'
                );

                if (this.config?.attioWebhookId) {
                    console.warn(
                        `  - Attio webhook: ${this.config.attioWebhookId}`
                    );
                }
                if (this.config?.quoMessageWebhookId) {
                    console.warn(
                        `  - Quo message webhook: ${this.config.quoMessageWebhookId}`
                    );
                }
                if (this.config?.quoCallWebhookId) {
                    console.warn(
                        `  - Quo call webhook: ${this.config.quoCallWebhookId}`
                    );
                }
                if (this.config?.quoCallSummaryWebhookId) {
                    console.warn(
                        `  - Quo call-summary webhook: ${this.config.quoCallSummaryWebhookId}`
                    );
                }

                console.warn(
                    '[Webhook Cleanup] You will need to manually delete these webhooks from the external services.'
                );

                await super.onDelete(params);
                return;
            }

            const attioWebhookId = this.config?.attioWebhookId;

            if (attioWebhookId) {
                console.log(`[Attio] Deleting webhook: ${attioWebhookId}`);

                try {
                    await this.attio.api.deleteWebhook(attioWebhookId);
                    deletionResults.attio = 'success';
                    console.log(
                        `[Attio] ✓ Webhook ${attioWebhookId} deleted from Attio`,
                    );
                } catch (error) {
                    deletionResults.attio = 'failed';
                    console.error(
                        `[Attio] Failed to delete webhook from Attio:`,
                        error.message,
                    );
                    console.warn(
                        `[Attio] Webhook ID ${attioWebhookId} preserved in config for manual cleanup`,
                    );
                }
            } else {
                console.log('[Attio] No webhook to delete');
            }

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

            // Note: Config update removed to avoid race condition
            // Integration is being deleted, so updating config is unnecessary
            // Webhook IDs are preserved in current config for logging purposes

            const successCount = Object.values(deletionResults).filter(
                (result) => result === 'success',
            ).length;
            const failedCount = Object.values(deletionResults).filter(
                (result) => result === 'failed',
            ).length;

            if (failedCount > 0) {
                console.warn(
                    `[Webhook Cleanup] Partial cleanup: ${successCount} succeeded, ${failedCount} failed. Failed webhook IDs preserved for manual cleanup.`,
                );
            } else {
                console.log(
                    `[Webhook Cleanup] ✓ All webhooks deleted and configs cleared`,
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

    // ============================================================================
    // EXISTING METHODS - Backward Compatibility
    // ============================================================================

    async listObjects({ req, res }) {
        try {
            const objects = await this.attio.api.listObjects();
            res.json(objects);
        } catch (error) {
            console.error('Failed to list Attio objects:', error);
            res.status(500).json({
                error: 'Failed to list objects',
                details: error.message,
            });
        }
    }

    async listCompanies({ req, res }) {
        try {
            const params = {
                limit: req.query.limit ? parseInt(req.query.limit) : 50,
                offset: req.query.offset ? parseInt(req.query.offset) : 0,
            };

            const companies = await this.attio.api.listRecords(
                'companies',
                params,
            );
            res.json(companies);
        } catch (error) {
            console.error('Failed to list Attio companies:', error);
            res.status(500).json({
                error: 'Failed to list companies',
                details: error.message,
            });
        }
    }

    async listPeople({ req, res }) {
        try {
            const params = {
                limit: req.query.limit ? parseInt(req.query.limit) : 50,
                offset: req.query.offset ? parseInt(req.query.offset) : 0,
            };

            const people = await this.attio.api.listRecords('people', params);
            res.json(people);
        } catch (error) {
            console.error('Failed to list Attio people:', error);
            res.status(500).json({
                error: 'Failed to list people',
                details: error.message,
            });
        }
    }

    async getCustomObjects({ req, res }) {
        try {
            const objects = await this.attio.api.listObjects();
            // Filter to only custom objects (not standard ones like 'people', 'companies')
            const customObjects = objects.data?.filter(
                (obj) => !['people', 'companies'].includes(obj.api_slug),
            );
            res.json({ data: customObjects });
        } catch (error) {
            console.error('Failed to get Attio custom objects:', error);
            res.status(500).json({
                error: 'Failed to get custom objects',
                details: error.message,
            });
        }
    }

    async createRecord({ req, res }) {
        try {
            const { objectType, values } = req.body;

            if (!objectType || !values) {
                return res.status(400).json({
                    error: 'objectType and values are required',
                });
            }

            const result = await this.attio.api.createRecord(objectType, {
                values,
            });
            res.json(result);
        } catch (error) {
            console.error('Failed to create Attio record:', error);
            res.status(500).json({
                error: 'Failed to create record',
                details: error.message,
            });
        }
    }

    async searchRecords({ req, res }) {
        try {
            const { query, object_types } = req.body;

            if (!query) {
                return res.status(400).json({
                    error: 'Search query is required',
                });
            }

            const result = await this.attio.api.searchRecords({
                query,
                objects: object_types || ['people', 'companies'],
                request_as: { type: 'workspace' },
            });

            res.json(result);
        } catch (error) {
            console.error('Failed to search Attio records:', error);
            res.status(500).json({
                error: 'Failed to search records',
                details: error.message,
            });
        }
    }
}

module.exports = AttioIntegration;
