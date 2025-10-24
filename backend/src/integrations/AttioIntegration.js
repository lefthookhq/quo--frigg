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

    constructor(params) {
        super(params);

        // Initialize Frigg commands
        this.commands = createFriggCommands({
            integrationClass: AttioIntegration,
        });

        this.events = {
            ...this.events, // BaseCRMIntegration events

            // Existing Attio-specific events
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
     * Resolve Attio object_id to object_type (API slug)
     * Caches results to avoid repeated API calls
     *
     * @private
     * @param {string} objectId - Attio object UUID
     * @returns {Promise<string>} Object type/slug (e.g., 'people', 'companies')
     */
    async _resolveObjectType(objectId) {
        // Initialize cache if needed
        if (!this._objectTypeCache) {
            this._objectTypeCache = new Map();
        }

        // Check cache first
        if (this._objectTypeCache.has(objectId)) {
            return this._objectTypeCache.get(objectId);
        }

        // Fetch object metadata from Attio
        try {
            const object = await this.attio.api.getObject(objectId);
            const objectType =
                object.api_slug || object.plural_noun || objectId;

            // Cache for future use
            this._objectTypeCache.set(objectId, objectType);

            return objectType;
        } catch (error) {
            console.error(
                `[Attio] Failed to resolve object type for ${objectId}:`,
                error,
            );
            // Return objectId as fallback
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

        // Resolve object_id to object_type (e.g., UUID -> 'people')
        const object_type = await this._resolveObjectType(object_id);

        try {
            const record = await this.attio.api.getRecord(object_id, record_id);

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

                case 'companies':
                    await this._syncCompanyToQuo(record, 'created');
                    break;

                case 'deals':
                    await this._syncDealToQuo(record, 'created');
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

        // Resolve object_id to object_type (e.g., UUID -> 'people')
        const object_type = await this._resolveObjectType(object_id);

        // todo: record is an id -> Check this next
        try {
            const record = await this.attio.api.getRecord(object_id, record_id);

            if (!record) {
                console.warn(
                    `[Attio Webhook] Record ${record_id} not found - may have been deleted`,
                );
                return;
            }

            switch (object_type) {
                case 'people':
                    await this._syncPersonToQuo(record, 'updated');
                    break;

                case 'companies':
                    await this._syncCompanyToQuo(record, 'updated');
                    break;

                case 'deals':
                    await this._syncDealToQuo(record, 'updated');
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
                action: 'updated',
            });

            console.log(
                `[Attio Webhook] ✓ Updated ${object_type} ${record_id} in Quo`,
            );
        } catch (error) {
            console.error(
                `[Attio Webhook] Failed to update ${object_type} ${record_id}:`,
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

        // Resolve object_id to object_type (e.g., UUID -> 'people')
        const object_type = await this._resolveObjectType(object_id);

        try {
            await this.deleteMapping(record_id);

            console.log(
                `[Attio Webhook] ✓ Removed mapping for ${object_type} ${record_id}`,
            );
        } catch (error) {
            console.error(
                `[Attio Webhook] Failed to handle deletion of ${record_id}:`,
                error.message,
            );
            throw error;
        }
    }

    /**
     * Handle list-entry.created webhook event
     * Syncs list entry data to Quo
     *
     * @private
     * @param {Object} eventData - Event data from webhook
     * @returns {Promise<void>}
     */
    async _handleListEntryCreated(eventData) {
        console.log(`[Attio Webhook] Handling list-entry.created:`, eventData);

        console.log('[Attio Webhook] List entry sync not yet implemented');
    }

    /**
     * Handle list-entry.updated webhook event
     *
     * @private
     * @param {Object} eventData - Event data from webhook
     * @returns {Promise<void>}
     */
    async _handleListEntryUpdated(eventData) {
        console.log(`[Attio Webhook] Handling list-entry.updated:`, eventData);
    }

    /**
     * Handle list-entry.deleted webhook event
     *
     * @private
     * @param {Object} eventData - Event data from webhook
     * @returns {Promise<void>}
     */
    async _handleListEntryDeleted(eventData) {
        console.log(`[Attio Webhook] Handling list-entry.deleted:`, eventData);
    }

    /**
     * Handle note.created webhook event
     * Syncs note to Quo as activity/comment
     *
     * @private
     * @param {Object} eventData - Event data from webhook
     * @returns {Promise<void>}
     */
    async _handleNoteCreated(eventData) {
        console.log(`[Attio Webhook] Handling note.created:`, eventData);
    }

    /**
     * Handle note.updated webhook event
     *
     * @private
     * @param {Object} eventData - Event data from webhook
     * @returns {Promise<void>}
     */
    async _handleNoteUpdated(eventData) {
        console.log(`[Attio Webhook] Handling note.updated:`, eventData);
    }

    /**
     * Handle note.deleted webhook event
     *
     * @private
     * @param {Object} eventData - Event data from webhook
     * @returns {Promise<void>}
     */
    async _handleNoteDeleted(eventData) {
        console.log(`[Attio Webhook] Handling note.deleted:`, eventData);
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

            // Calculate next cursor (offset)
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
        // Attio uses a flexible attribute-based structure
        const attributes = person.values || {};

        // Extract name from attributes - use active value filtering
        const nameAttr = this.getActiveValue(attributes.name);
        let firstName = nameAttr?.first_name || '';
        const lastName = nameAttr?.last_name || '';

        // Handle missing firstName (required by Quo) - use 'Unknown' fallback
        if (!firstName || firstName.trim() === '') {
            firstName = 'Unknown';
        }

        // Extract role/job title
        const roleAttr =
            this.getActiveValue(attributes.job_title) ||
            this.getActiveValue(attributes.role);
        const role = roleAttr?.value || null;

        // Extract email addresses - filter only active emails
        const emails = [];
        const emailAttrs = attributes.email_addresses || [];
        for (const emailAttr of emailAttrs) {
            // Only include active emails
            if (emailAttr.active_until === null && emailAttr.email_address) {
                emails.push({
                    name: 'email',
                    value: emailAttr.email_address,
                });
            }
        }

        // Extract phone numbers - filter only active phones
        const phoneNumbers = [];
        const phoneAttrs = attributes.phone_numbers || [];
        for (const phoneAttr of phoneAttrs) {
            // Only include active phone numbers
            if (phoneAttr.active_until === null && phoneAttr.phone_number) {
                phoneNumbers.push({
                    name: 'phone',
                    value: phoneAttr.phone_number,
                });
            }
        }

        // Extract company reference and fetch company name
        let company = null;
        const companyAttr = this.getActiveValue(attributes.company);

        if (companyAttr && companyAttr.target_record_id) {
            // Dual-mode: use pre-fetched companyMap if provided, else fetch individually
            if (companyMap && companyMap.has(companyAttr.target_record_id)) {
                // Batch mode: lookup in pre-fetched map
                const companyData = companyMap.get(
                    companyAttr.target_record_id,
                );
                company = companyData?.values?.name?.[0]?.value || null;
            } else {
                // Individual mode: fetch company on-demand (backward compatibility or fallback)
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

        // Return active value or fallback to first item
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

        // Step 1: Collect unique company IDs from all persons
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

        // Step 2: Batch fetch all unique companies (if any)
        let companyMap = new Map();
        if (companyIds.length > 0) {
            const companies = await this.fetchCompaniesByIds(companyIds);
            companyMap = new Map(companies.map((c) => [c.id.record_id, c]));
        }

        // Step 3: Transform all persons with pre-fetched company data
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
            // Find the person by external ID
            const person = await this.attio.api.getRecord(
                'people',
                activity.contactExternalId,
            );
            if (!person) {
                console.warn(
                    `Person not found for SMS logging: ${activity.contactExternalId}`,
                );
                return;
            }

            // Create note entry in Attio
            const noteData = {
                parent_object: 'people',
                parent_record_id: activity.contactExternalId,
                title: `SMS: ${activity.direction}`,
                format: 'plaintext',
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
            // Find the person by external ID
            const person = await this.attio.api.getRecord(
                'people',
                activity.contactExternalId,
            );
            if (!person) {
                console.warn(
                    `Person not found for call logging: ${activity.contactExternalId}`,
                );
                return;
            }

            // Create note entry in Attio
            const noteData = {
                parent_object: 'people',
                parent_record_id: activity.contactExternalId,
                title: `Call: ${activity.direction} (${activity.duration}s)`,
                format: 'plaintext',
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
     * Setup webhooks with Attio
     * Called during onCreate lifecycle (BaseCRMIntegration)
     * Programmatically registers webhook with Attio API and stores webhook ID + secret in config
     * @returns {Promise<Object>} Setup result
     */
    async setupWebhooks() {
        try {
            // 1. Check if webhook already registered
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

            // 2. Construct webhook URL for this integration instance
            const webhookUrl = `${process.env.BASE_URL}/api/attio-integration/webhooks/${this.id}`;

            console.log(`[Attio] Registering webhook at: ${webhookUrl}`);

            // 3. Define webhook subscriptions (events we want to receive)
            const subscriptions = [
                // Record events (core CRM sync)
                { event_type: 'record.created', filter: null },
                { event_type: 'record.updated', filter: null },
                { event_type: 'record.deleted', filter: null },

                // List events (for list-based workflows)
                { event_type: 'list-entry.created', filter: null },
                { event_type: 'list-entry.updated', filter: null },
                { event_type: 'list-entry.deleted', filter: null },

                // Note events (for activity tracking)
                { event_type: 'note.created', filter: null },
                { event_type: 'note.updated', filter: null },
            ];

            // 4. Register webhook with Attio API
            const webhookResponse = await this.attio.api.createWebhook({
                target_url: webhookUrl,
                subscriptions: subscriptions,
            });

            // 5. Extract webhook ID and SECRET (CRITICAL: Secret only shown once!)
            const webhookId = webhookResponse.data.id.webhook_id;
            const webhookSecret = webhookResponse.data.secret;

            if (!webhookSecret) {
                throw new Error(
                    'Webhook creation did not return a secret - this is required for signature verification',
                );
            }

            // 6. Store webhook ID and SECRET using command pattern
            const updatedConfig = {
                ...this.config,
                attioWebhookId: webhookId,
                attioWebhookUrl: webhookUrl,
                attioWebhookSecret: webhookSecret, // ENCRYPTED by Frigg's field-level encryption
                webhookCreatedAt: new Date().toISOString(),
                webhookSubscriptions: subscriptions.map((s) => s.event_type),
            };

            await this.commands.updateIntegrationConfig({
                integrationId: this.id,
                config: updatedConfig,
            });

            // 7. Update local config reference
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
            console.error('[Attio] Failed to setup webhooks:', error);

            // Non-fatal - integration will operate in manual-sync mode only
            await this.updateIntegrationMessages.execute(
                this.id,
                'errors',
                'Webhook Setup Failed',
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
            // Extract signature from headers (adjust header name if needed)
            const signature =
                req.headers['x-attio-signature'] ||
                req.headers['attio-signature'] ||
                req.headers['x-webhook-signature'];

            if (!signature) {
                console.warn('[Attio Webhook] No signature header found');
                // Still accept webhook (signature verification happens in worker)
            }

            // Note: We can't verify signature here because we don't have DB access
            // Signature verification will happen in onWebhook() with full context

            // Queue to SQS with signature included
            const webhookData = {
                body: req.body,
                headers: req.headers,
                integrationId: req.params.integrationId,
                signature: signature,
                receivedAt: new Date().toISOString(),
            };

            // Call parent implementation to queue to SQS
            await super.onWebhookReceived({ req, res, data: webhookData });
        } catch (error) {
            console.error('[Attio Webhook] Receive error:', error);
            throw error;
        }
    }

    /**
     * Process webhook events from Attio
     * Called by queue worker with full database access and hydrated integration
     * Automatically invoked by Frigg's webhook infrastructure
     *
     * @param {Object} params
     * @param {Object} params.data - Webhook data from queue
     * @param {Object} params.data.body - Attio webhook payload
     * @param {Object} params.data.headers - HTTP headers (includes x-attio-signature)
     * @param {string} params.data.integrationId - Integration ID
     * @returns {Promise<Object>} Processing result
     */
    async onWebhook({ data }) {
        const { body, headers, integrationId } = data;

        // Extract signature from headers
        const signature = headers['x-attio-signature'];

        console.log(
            `[Attio Webhook] Processing webhook with ${body.events?.length || 0} event(s)`,
        );

        try {
            // 1. Verify webhook signature
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

            // 2. Validate events array
            if (
                !body.events ||
                !Array.isArray(body.events) ||
                body.events.length === 0
            ) {
                throw new Error(
                    'Webhook payload missing or empty events array',
                );
            }

            // 3. Process each event in the array
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
                    // Prepare event data for handlers (merge id fields with event)
                    const eventData = {
                        ...eventId,
                        actor: event.actor,
                        event_type: eventType,
                    };

                    // 4. Route based on event type
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

                        // List entry events
                        case 'list-entry.created':
                            await this._handleListEntryCreated(eventData);
                            break;

                        case 'list-entry.updated':
                            await this._handleListEntryUpdated(eventData);
                            break;

                        case 'list-entry.deleted':
                            await this._handleListEntryDeleted(eventData);
                            break;

                        // Note events
                        case 'note.created':
                            await this._handleNoteCreated(eventData);
                            break;

                        case 'note.updated':
                            await this._handleNoteUpdated(eventData);
                            break;

                        case 'note.deleted':
                            await this._handleNoteDeleted(eventData);
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
                'Webhook Processing Error',
                `Failed to process webhook: ${error.message}`,
                Date.now(),
            );

            // Re-throw for SQS retry and DLQ
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
            // Use existing comprehensive transformPersonToQuo method
            const quoContact = await this.transformPersonToQuo(attioRecord);

            if (!this.quo?.api) {
                throw new Error('Quo API not available');
            }

            if (action === 'created') {
                await this.quo.api.createContact(quoContact);
            } else {
                await this.quo.api.updateContact(quoContact);
            }

            console.log(`[Attio] ✓ Person ${attioRecord.id} synced to Quo`);
        } catch (error) {
            console.error(
                `[Attio] Failed to sync person ${attioRecord.id}:`,
                error.message,
            );
            throw error;
        }
    }

    /**
     * Sync Attio company record to Quo
     *
     * @private
     * @param {Object} attioRecord - Attio company record
     * @param {string} action - created or updated
     * @returns {Promise<void>}
     */
    async _syncCompanyToQuo(attioRecord, action) {
        console.log(
            `[Attio] Syncing company to Quo (${action}):`,
            attioRecord.id,
        );

        try {
            const quoCompany = this._transformCompanyToQuo(attioRecord);

            if (!this.quo?.api) {
                throw new Error('Quo API not available');
            }

            if (action === 'created') {
                await this.quo.api.createCompany(quoCompany);
            } else {
                await this.quo.api.updateCompany(quoCompany);
            }

            console.log(`[Attio] ✓ Company ${attioRecord.id} synced to Quo`);
        } catch (error) {
            console.error(
                `[Attio] Failed to sync company ${attioRecord.id}:`,
                error.message,
            );
            throw error;
        }
    }

    /**
     * Transform Attio company record to Quo company format
     *
     * @private
     * @param {Object} attioRecord - Attio company record
     * @returns {Object} Quo company object
     */
    _transformCompanyToQuo(attioRecord) {
        // Attio uses a flexible attribute-based structure
        const attributes = attioRecord.values || {};

        const getAttributeValue = (slug) => {
            const attr = attributes[slug];
            return attr?.[0]?.value || null;
        };

        const getDomainValue = () => {
            const domainAttr = attributes.domains;
            return domainAttr?.[0]?.domain || null;
        };

        return {
            name: getAttributeValue('name'),
            domain: getDomainValue(),
            industry: getAttributeValue('industry'),
            description: getAttributeValue('description'),
            externalId: attioRecord.id?.record_id,
            source: 'attio',
            lastModified: attioRecord.updated_at,
        };
    }

    /**
     * Sync Attio deal record to Quo
     *
     * @private
     * @param {Object} attioRecord - Attio deal record
     * @param {string} action - created or updated
     * @returns {Promise<void>}
     */
    async _syncDealToQuo(attioRecord, action) {
        console.log(`[Attio] Syncing deal to Quo (${action}):`, attioRecord.id);
        console.log('[Attio] Deal sync not yet implemented');
    }

    // ============================================================================
    // LIFECYCLE METHODS
    // ============================================================================

    /**
     * Called when integration is deleted
     * Clean up webhook registration with Attio
     *
     * @param {Object} params - Deletion parameters
     * @returns {Promise<void>}
     */
    async onDelete(params) {
        try {
            const webhookId = this.config?.attioWebhookId;

            if (webhookId) {
                console.log(`[Attio] Deleting webhook: ${webhookId}`);

                try {
                    await this.attio.api.deleteWebhook(webhookId);
                    console.log(
                        `[Attio] ✓ Webhook ${webhookId} deleted from Attio`,
                    );
                } catch (error) {
                    console.error(
                        `[Attio] Failed to delete webhook from Attio:`,
                        error,
                    );
                    // Continue with local cleanup
                }

                // Clear webhook config using command pattern
                const updatedConfig = { ...this.config };
                delete updatedConfig.attioWebhookId;
                delete updatedConfig.attioWebhookUrl;
                delete updatedConfig.attioWebhookSecret;
                delete updatedConfig.webhookCreatedAt;
                delete updatedConfig.webhookSubscriptions;

                await this.commands.updateIntegrationConfig({
                    integrationId: this.id,
                    config: updatedConfig,
                });

                console.log(`[Attio] ✓ Webhook config cleared`);
            } else {
                console.log('[Attio] No webhook to delete');
            }
        } catch (error) {
            console.error('[Attio] Failed to delete webhook:', error);
            // Non-fatal - integration is being deleted anyway
        }

        // Call parent class cleanup
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
