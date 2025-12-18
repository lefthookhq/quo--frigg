const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');
const { createFriggCommands } = require('@friggframework/core');
const axisCare = require('../api-modules/axiscare');
const quo = require('../api-modules/quo');
const CallSummaryEnrichmentService = require('../base/services/CallSummaryEnrichmentService');
const QuoCallContentBuilder = require('../base/services/QuoCallContentBuilder');
const QuoWebhookEventProcessor = require('../base/services/QuoWebhookEventProcessor');
const { QuoWebhookEvents } = require('../base/constants');
const { filterExternalParticipants } = require('../utils/participantFilter');

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
                },
            },
        },
        routes: [
            {
                path: '/axisCare/clients',
                method: 'GET',
                event: 'LIST_AXISCARE_CLIENTS',
            },
            {
                path: '/:integrationId/phone-mapping',
                method: 'POST',
                event: 'UPDATE_PHONE_MAPPING',
            },
            {
                path: '/:integrationId/phone-mapping/sync-webhooks',
                method: 'POST',
                event: 'SYNC_PHONE_WEBHOOKS',
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
        QUO_CALLS: 'AxisCare Integration - Calls',
        QUO_CALL_SUMMARIES: 'AxisCare Integration - Call Summaries',
    };

    /**
     * Webhook event subscriptions
     * Defines which events each webhook type listens for
     */
    static WEBHOOK_EVENTS = {
        QUO_CALLS: [QuoWebhookEvents.CALL_COMPLETED],
        QUO_CALL_SUMMARIES: [QuoWebhookEvents.CALL_SUMMARY_COMPLETED],
    };

    /**
     * Maximum number of resourceIds allowed per Quo webhook
     * Phone numbers must be chunked into groups of this size
     */
    static MAX_RESOURCE_IDS_PER_WEBHOOK = 10;

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
            UPDATE_PHONE_MAPPING: {
                handler: this.updatePhoneMapping,
            },
            SYNC_PHONE_WEBHOOKS: {
                handler: this.syncPhoneWebhooks,
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
                objectType: objectType,
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
            sourceEntityType: objectType.toLowerCase(),
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
     * Strips formatting and ensures E.164-like format for comparison
     * Assumes US (+1) country code if not present
     *
     * @private
     * @param {string} phone - Phone number to normalize
     * @returns {string} Normalized phone number (digits only, with country code)
     */
    _normalizePhoneNumber(phone) {
        if (!phone) return phone;

        // Remove all non-digit characters except leading +
        let normalized = phone.replace(/[^\d+]/g, '');

        // If starts with +, remove it and keep digits
        if (normalized.startsWith('+')) {
            normalized = normalized.substring(1);
        }

        // If it's a 10-digit US number (no country code), prepend 1
        if (normalized.length === 10) {
            normalized = '1' + normalized;
        }

        return normalized;
    }

    /**
     * Split an array into chunks of specified size
     * @private
     * @param {Array} array - Array to chunk
     * @param {number} chunkSize - Maximum size of each chunk
     * @returns {Array<Array>} Array of chunks
     */
    _chunkArray(array, chunkSize) {
        const chunks = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }

    /**
     * Resolve phone number to Quo phone ID using stored metadata
     * @private
     * @param {string} phoneNumber - Phone number to resolve
     * @returns {string|null} Quo phone ID or null if not found
     */
    _resolvePhoneToQuoId(phoneNumber) {
        const normalized = this._normalizePhoneNumber(phoneNumber);
        const metadata = this.config?.phoneNumbersMetadata || [];
        const found = metadata.find(
            (p) => this._normalizePhoneNumber(p.number) === normalized,
        );
        return found?.id || null;
    }

    /**
     * Resolve all phone mappings to Quo phone IDs
     * @private
     * @returns {Promise<string[]>} Array of resolved Quo phone IDs
     */
    async _resolvePhoneMappingsToQuoIds() {
        const mappings = this.config?.phoneNumberSiteMappings || {};
        const mappedPhoneNumbers = Object.keys(mappings);

        if (mappedPhoneNumbers.length === 0) {
            return [];
        }

        // Ensure metadata is available (lazy fetch if not populated during setup)
        if (
            !this.config?.phoneNumbersMetadata ||
            this.config.phoneNumbersMetadata.length === 0
        ) {
            if (this.quo?.api) {
                try {
                    console.log(
                        '[AxisCare] Phone metadata not found, fetching from Quo API',
                    );
                    await this._fetchAndStoreEnabledPhoneIds();
                } catch (error) {
                    console.warn(
                        '[AxisCare] Failed to fetch phone numbers:',
                        error.message,
                    );
                }
            }
        }

        // Resolve each phone number to Quo ID
        const resolvedIds = [];
        const unresolvedPhones = [];

        for (const phone of mappedPhoneNumbers) {
            const quoPhoneId = this._resolvePhoneToQuoId(phone);
            if (quoPhoneId) {
                resolvedIds.push(quoPhoneId);
            } else {
                unresolvedPhones.push(phone);
            }
        }

        if (unresolvedPhones.length > 0) {
            console.warn(
                `[AxisCare] Unresolved phone numbers (not found in Quo): ${unresolvedPhones.join(', ')}`,
            );
        }

        return resolvedIds;
    }

    /**
     * Plan webhook subscription operations by comparing required vs existing
     * @private
     * @param {Array<Array<string>>} requiredChunks - Required phone ID chunks
     * @param {Array<Object>} existingSubscriptions - Existing webhook subscriptions
     * @returns {Object} Operations to perform (create, update, delete, keep)
     */
    _planSubscriptionOperations(requiredChunks, existingSubscriptions) {
        const operations = {
            create: [],
            update: [],
            delete: [],
            keep: [],
        };

        const existingSubscriptionByIndex = new Map(
            existingSubscriptions.map((sub, idx) => [idx, sub]),
        );

        // Match required chunks to existing subscriptions
        requiredChunks.forEach((chunk, index) => {
            const existing = existingSubscriptionByIndex.get(index);

            if (!existing) {
                // New chunk needs new webhook
                operations.create.push({ phoneIds: chunk, chunkIndex: index });
            } else {
                // Check if update needed
                const existingIds = new Set(existing.phoneIds || []);
                const requiredIds = new Set(chunk);

                const needsUpdate =
                    existingIds.size !== requiredIds.size ||
                    ![...requiredIds].every((id) => existingIds.has(id));

                if (needsUpdate) {
                    operations.update.push({
                        webhookId: existing.webhookId,
                        webhookKey: existing.webhookKey,
                        phoneIds: chunk,
                        chunkIndex: index,
                    });
                } else {
                    operations.keep.push(existing);
                }
                existingSubscriptionByIndex.delete(index);
            }
        });

        // Remaining existing subscriptions are orphaned
        for (const [, sub] of existingSubscriptionByIndex) {
            operations.delete.push({
                webhookId: sub.webhookId,
                reason: 'chunk_no_longer_needed',
            });
        }

        return operations;
    }

    /**
     * Create a chunked webhook for phone number filtering
     * @private
     * @param {string} webhookType - 'call' or 'callSummary'
     * @param {string[]} phoneIds - Phone IDs for this chunk
     * @param {string} webhookUrl - Webhook endpoint URL
     * @param {number} chunkIndex - Index of this chunk
     * @returns {Promise<Object>} Created webhook subscription info
     */
    async _createChunkedWebhook(webhookType, phoneIds, webhookUrl, chunkIndex) {
        const WEBHOOK_EVENTS = this.constructor.WEBHOOK_EVENTS;
        const WEBHOOK_LABELS = this.constructor.WEBHOOK_LABELS;

        const webhookData = {
            url: webhookUrl,
            status: 'enabled',
            resourceIds: phoneIds,
            events:
                webhookType === 'call'
                    ? WEBHOOK_EVENTS.QUO_CALLS
                    : WEBHOOK_EVENTS.QUO_CALL_SUMMARIES,
            label: `${webhookType === 'call' ? WEBHOOK_LABELS.QUO_CALLS : WEBHOOK_LABELS.QUO_CALL_SUMMARIES} (Chunk ${chunkIndex})`,
        };

        const createMethod =
            webhookType === 'call'
                ? this.quo.api.createCallWebhook.bind(this.quo.api)
                : this.quo.api.createCallSummaryWebhook.bind(this.quo.api);

        const response = await createMethod(webhookData);

        if (!response?.data?.id || !response?.data?.key) {
            throw new Error(`Invalid ${webhookType} webhook response`);
        }

        console.log(
            `[AxisCare] ✓ Created ${webhookType} webhook chunk ${chunkIndex}: ${response.data.id}`,
        );

        return {
            webhookId: response.data.id,
            webhookKey: response.data.key,
            phoneIds: phoneIds,
            chunkIndex: chunkIndex,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
    }

    /**
     * Update a chunked webhook with new phone IDs
     * @private
     * @param {string} webhookId - Webhook ID to update
     * @param {string[]} phoneIds - New phone IDs
     * @returns {Promise<Object>} Update result
     */
    async _updateChunkedWebhook(webhookId, phoneIds) {
        await this.quo.api.updateWebhook(webhookId, { resourceIds: phoneIds });
        console.log(
            `[AxisCare] ✓ Updated webhook ${webhookId} with ${phoneIds.length} phone(s)`,
        );

        return {
            updatedAt: new Date().toISOString(),
            phoneIds: phoneIds,
        };
    }

    /**
     * Manage webhook subscriptions based on phone mappings
     * Creates, updates, and deletes webhooks as needed
     * @private
     * @returns {Promise<Object>} Result with status and subscriptions
     */
    async _managePhoneWebhookSubscriptions() {
        const createdWebhooks = [];

        try {
            // 1. Resolve phone mappings to Quo phone IDs
            const mappedPhoneIds = await this._resolvePhoneMappingsToQuoIds();

            if (mappedPhoneIds.length === 0) {
                console.log('[AxisCare] No phone IDs to manage webhooks for');
                return {
                    status: 'no_phones',
                    subscriptions: { call: [], callSummary: [] },
                };
            }

            // 2. Chunk into groups of MAX_RESOURCE_IDS_PER_WEBHOOK
            const ChunksOfPhoneIds = this._chunkArray(
                mappedPhoneIds,
                this.constructor.MAX_RESOURCE_IDS_PER_WEBHOOK,
            );
            console.log(
                `[AxisCare] Managing webhooks for ${mappedPhoneIds.length} phone(s) in ${ChunksOfPhoneIds.length} chunk(s)`,
            );

            // 3. Get existing subscriptions
            const existingSubs = this.config
                ?.phoneNumberWebhookSubscriptions || {
                call: [],
                callSummary: [],
            };

            // 4. Process each webhook type
            const webhookUrl = this._generateWebhookUrl(`/webhooks/${this.id}`);
            const results = { call: [], callSummary: [] };

            for (const webhookType of ['call', 'callSummary']) {
                const existing = existingSubs[webhookType] || [];
                const operations = this._planSubscriptionOperations(
                    ChunksOfPhoneIds,
                    existing,
                );

                console.log(
                    `[AxisCare] ${webhookType} operations: ${operations.create.length} create, ${operations.update.length} update, ${operations.delete.length} delete, ${operations.keep.length} keep`,
                );

                // Execute creates
                for (const op of operations.create) {
                    const webhook = await this._createChunkedWebhook(
                        webhookType,
                        op.phoneIds,
                        webhookUrl,
                        op.chunkIndex,
                    );
                    createdWebhooks.push({
                        type: webhookType,
                        id: webhook.webhookId,
                    });
                    results[webhookType].push(webhook);
                }

                // Execute updates
                for (const op of operations.update) {
                    const updated = await this._updateChunkedWebhook(
                        op.webhookId,
                        op.phoneIds,
                    );
                    results[webhookType].push({
                        webhookId: op.webhookId,
                        webhookKey: op.webhookKey,
                        chunkIndex: op.chunkIndex,
                        ...updated,
                    });
                }

                // Keep unchanged
                for (const sub of operations.keep) {
                    results[webhookType].push(sub);
                }

                // Execute deletes
                for (const op of operations.delete) {
                    try {
                        await this.quo.api.deleteWebhook(op.webhookId);
                        console.log(
                            `[AxisCare] ✓ Deleted orphaned ${webhookType} webhook: ${op.webhookId}`,
                        );
                    } catch (deleteError) {
                        console.warn(
                            `[AxisCare] Failed to delete ${webhookType} webhook ${op.webhookId}:`,
                            deleteError.message,
                        );
                    }
                }

                // Sort results by chunkIndex for consistency
                results[webhookType].sort(
                    (a, b) => (a.chunkIndex || 0) - (b.chunkIndex || 0),
                );
            }

            // 5. Update config with new subscription state
            const updatedConfig = {
                ...this.config,
                phoneNumberWebhookSubscriptions: results,
                lastPhoneMappingSyncAt: new Date().toISOString(),
            };

            await this.commands.updateIntegrationConfig({
                integrationId: this.id,
                config: updatedConfig,
            });

            this.config = updatedConfig;

            return { status: 'success', subscriptions: results };
        } catch (error) {
            // Rollback created webhooks
            if (createdWebhooks.length > 0) {
                console.warn(
                    `[AxisCare] Rolling back ${createdWebhooks.length} webhook(s)`,
                );
                for (const webhook of createdWebhooks) {
                    try {
                        await this.quo.api.deleteWebhook(webhook.id);
                        console.log(
                            `[AxisCare] ✓ Rolled back ${webhook.type} webhook ${webhook.id}`,
                        );
                    } catch (rollbackError) {
                        console.error(
                            `[AxisCare] Rollback failed for ${webhook.id}:`,
                            rollbackError.message,
                        );
                    }
                }
            }
            throw error;
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

        const [_, version, timestamp, receivedSignature] = parts;

        let webhookKey;
        if (eventType.startsWith('call.summary')) {
            webhookKey = this.config?.quoCallSummaryWebhookKey;
        } else if (eventType.startsWith('call.')) {
            webhookKey = this.config?.quoCallWebhookKey;
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

            // Use timing-safe comparison to prevent timing attacks
            const computedBuffer = Buffer.from(computedSignature, 'utf8');
            const receivedBuffer = Buffer.from(receivedSignature, 'utf8');
            const matches =
                computedBuffer.length === receivedBuffer.length &&
                crypto.timingSafeEqual(computedBuffer, receivedBuffer);

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

            const axiscareWebhookId = req.headers['x-webhook-id'];

            const source = axiscareWebhookId ? 'axiscare' : 'quo';

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
            // TODO(quo-webhooks): Re-enable signature verification once Quo/OpenPhone
            // adds OpenPhone-Signature headers to their new webhook service.
            // await this._verifyQuoWebhookSignature(headers, body, eventType);

            let result;
            if (eventType === QuoWebhookEvents.CALL_COMPLETED) {
                result = await this._handleQuoCallEvent(body);
            } else if (eventType === QuoWebhookEvents.CALL_SUMMARY_COMPLETED) {
                result = await this._handleQuoCallSummaryEvent(body);
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
     * Uses shared QuoWebhookEventProcessor for consistent handling across integrations
     *
     * @private
     * @param {Object} webhookData - Quo webhook payload
     * @returns {Promise<Object>} Processing result
     */
    async _handleQuoCallEvent(webhookData) {
        let axiscareContactDetails = null;
        let currentContactPhone = null;

        let callerName = null;
        const initiatedBy = webhookData?.data?.object?.initiatedBy;
        if (initiatedBy) {
            try {
                const userResponse = await this.quo.api.getUser(initiatedBy);
                const user = userResponse?.data;
                if (user) {
                    callerName =
                        `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
                        null;
                }
            } catch (error) {
                console.warn(
                    `[Quo Webhook] Could not fetch user ${initiatedBy}:`,
                    error.message,
                );
            }
        }

        return QuoWebhookEventProcessor.processCallEvent({
            webhookData,
            quoApi: this.quo.api,
            phoneNumbersMetadata: this.config?.phoneNumbersMetadata || [],
            crmAdapter: {
                formatMethod: 'plainText',
                useEmoji: true,
                findContactByPhone: async (phone) => {
                    currentContactPhone = phone;
                    axiscareContactDetails =
                        await this._findAxisCareContactByPhone(phone);

                    // If callerName not set (incoming call from AxisCare contact), fetch from AxisCare
                    if (
                        !callerName &&
                        axiscareContactDetails?.id &&
                        axiscareContactDetails?.type
                    ) {
                        callerName = await this._fetchAxisCareContactName(
                            axiscareContactDetails.id,
                            axiscareContactDetails.type,
                        );
                    }

                    return axiscareContactDetails?.id;
                },
                createCallActivity: async (
                    contactId,
                    { title, content, timestamp, duration, direction },
                ) => {
                    return await this.logCallToActivity({
                        contactId,
                        contactType: axiscareContactDetails?.type,
                        direction:
                            direction === 'outgoing' ? 'outbound' : 'inbound',
                        timestamp:
                            webhookData?.data?.object?.completedAt || timestamp,
                        duration,
                        subject: title,
                        summary: content,
                        callerPhone: currentContactPhone,
                        callerName,
                    });
                },
            },
            mappingRepo: {
                get: async (id) => await this.getMapping(id),
                upsert: async (id, data) => await this.upsertMapping(id, data),
            },
        });
    }

    /**
     * Handle Quo call.summary.completed webhook event
     * Stores call summary for later enrichment of call activity logs
     * Uses CallSummaryEnrichmentService with QuoCallContentBuilder for formatters
     *
     * @private
     * @param {Object} webhookData - Quo webhook payload
     * @returns {Promise<Object>} Processing result
     */
    async _handleQuoCallSummaryEvent(webhookData) {
        const summaryObject = webhookData.data.object;
        const formatOptions =
            QuoCallContentBuilder.getFormatOptions('plainText');

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

        // Fetch the original call details to get contact info and metadata
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

        // Filter out Quo phone numbers to get only external participants
        const participants = callObject.participants || [];
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

        // Try each external participant until we find one in AxisCare
        let axiscareContact = null;
        let contactPhone = null;
        for (const phone of externalParticipants) {
            axiscareContact = await this._findAxisCareContactByPhone(phone);
            if (axiscareContact) {
                contactPhone = phone;
                break;
            }
        }

        if (!axiscareContact) {
            console.warn(
                `[Quo Webhook] No AxisCare contact found for any participant in call ${callId}`,
            );
            return {
                received: true,
                callId,
                logged: false,
                error: 'Contact not found for any participant',
            };
        }

        const deepLink = webhookData.data.deepLink || '#';

        // Fetch metadata using shared utilities
        const phoneNumberDetails = await this.quo.api.getPhoneNumber(
            callObject.phoneNumberId,
        );
        const inboxName =
            QuoCallContentBuilder.buildInboxName(phoneNumberDetails);
        const inboxNumber =
            phoneNumberDetails.data?.number ||
            participants[callObject.direction === 'outgoing' ? 0 : 1];

        const userDetails = await this.quo.api.getUser(callObject.userId);
        const userName = QuoCallContentBuilder.buildUserName(userDetails);

        // Use CallSummaryEnrichmentService to enrich the call log
        const enrichmentResult =
            await CallSummaryEnrichmentService.enrichCallNote({
                callId,
                summaryData: { summary, nextSteps },
                callDetails: callObject,
                quoApi: this.quo.api,
                crmAdapter: {
                    canUpdateNote: () => true, // AxisCare supports call log updates!
                    createNote: async ({
                        contactId,
                        content,
                        title,
                        timestamp,
                    }) => {
                        const activityData = {
                            contactId: axiscareContact.id,
                            contactType: axiscareContact.type,
                            direction:
                                callObject.direction === 'outgoing'
                                    ? 'outbound'
                                    : 'inbound',
                            timestamp: callObject.completedAt || timestamp,
                            duration: callObject.duration,
                            subject: title,
                            summary: content,
                            callerPhone: contactPhone,
                            callerName: userName,
                        };
                        return await this.logCallToActivity(activityData);
                    },
                    updateNote: async (callLogId, { content, title }) => {
                        return await this.axisCare.api.updateCallLog(
                            callLogId,
                            {
                                subject: title,
                                notes: content,
                            },
                        );
                    },
                },
                mappingRepo: {
                    get: async (id) => await this.getMapping(id),
                    upsert: async (id, data) =>
                        await this.upsertMapping(id, data),
                },
                contactId: axiscareContact.id,
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
            `[Quo Webhook] ✓ Call summary enrichment complete for ${axiscareContact.type} ${axiscareContact.id}`,
        );

        return {
            received: true,
            callId,
            logged: true,
            contactId: axiscareContact.id,
            callLogId: enrichmentResult.noteId, // noteId is generic name, but it's callLogId for AxisCare
            summaryPoints: summary.length,
            nextStepsCount: nextSteps.length,
            recordingsCount: enrichmentResult.recordingsCount,
            hasVoicemail: enrichmentResult.hasVoicemail,
        };
    }

    /**
     * Find AxisCare contact by phone number using mapping lookup
     * O(1) database lookup instead of O(n) API calls
     *
     * @private
     * @param {string} phoneNumber - Phone number to search for
     * @returns {Promise<{id: string, type: string}|null>} Contact info with AxisCare ID and entity type, or null if not found
     */
    async _findAxisCareContactByPhone(phoneNumber) {
        console.log(
            `[Quo Webhook] Looking up AxisCare contact by phone: ${phoneNumber}`,
        );

        const result = await this.getMapping(phoneNumber);

        if (!result) {
            console.log(
                `[Quo Webhook] No AxisCare contact found for phone: ${phoneNumber}`,
            );
            return null;
        }

        console.log(
            `[Quo Webhook] ✓ Found synced contact: ${result.mapping.externalId} (${result.mapping.entityType})`,
        );

        return {
            id: result.mapping.externalId,
            type: result.mapping.entityType,
        };
    }

    /**
     * Fetch AxisCare contact name by ID and type
     * @private
     * @param {string} id - Contact ID
     * @param {string} type - Entity type (client, lead, caregiver, applicant)
     * @returns {Promise<string|null>} Full name or null if not found
     */
    async _fetchAxisCareContactName(id, type) {
        try {
            let response;
            switch (type?.toLowerCase()) {
                case 'client':
                    response = await this.axisCare.api.getClient(id);
                    break;
                case 'lead':
                    response = await this.axisCare.api.getLead(id);
                    break;
                case 'caregiver':
                    response = await this.axisCare.api.getCaregiver(id);
                    break;
                case 'applicant':
                    response = await this.axisCare.api.getApplicant(id);
                    break;
                default:
                    console.warn(`[AxisCare] Unknown entity type: ${type}`);
                    return null;
            }

            const data = response?.results;
            if (data?.firstName || data?.lastName) {
                return `${data.firstName || ''} ${data.lastName || ''}`.trim();
            }
            return null;
        } catch (error) {
            console.warn(
                `[AxisCare] Could not fetch ${type} ${id}:`,
                error.message,
            );
            return null;
        }
    }

    /**
     * Log phone call to AxisCare as a call log
     * @param {Object} activity - Call activity data
     * @returns {Promise<void>}
     */
    async logCallToActivity(activity) {
        try {
            // Format dateTime for AxisCare: remove milliseconds, replace Z with +00:00
            // AxisCare expects format like "2025-07-01T15:23:45-05:00"
            const formatDateTime = (isoString) => {
                if (!isoString) return null;
                return isoString
                    .replace(/\.\d{3}Z$/, '+00:00')
                    .replace(/Z$/, '+00:00');
            };

            const callLogData = {
                callerName: activity.callerName,
                callerPhone: activity.callerPhone,
                followUp: false,
                dateTime: formatDateTime(activity.timestamp),
                subject:
                    activity.subject ||
                    `Call: ${activity.direction} (${activity.duration}s)`,
                notes: activity.summary || 'Phone call',
                tags: [
                    {
                        type: activity.contactType,
                        entityId: parseInt(activity.contactId, 10),
                    },
                ],
            };

            const response = await this.axisCare.api.createCallLog(callLogData);

            console.log(
                `[Quo Webhook] ✓ Call logged to AxisCare ${activity.contactType} ${activity.contactId}`,
            );

            // Return the created call log ID
            return response?.id || null;
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

            const result = await this.upsertContactToQuo(quoContact);

            console.log(
                `[AxisCare] ✓ Contact ${result.action} in Quo (externalId: ${quoContact.externalId}, quoContactId: ${result.quoContactId})`,
            );

            console.log(`[AxisCare] ✓ Person ${person.id} synced to Quo`);
        } catch (error) {
            console.error(
                `[AxisCare] Failed to sync person ${person.id}:`,
                error.message,
            );
            throw error;
        }
    }

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
            throw error;
        }
    }

    /**
     * Setup Quo webhooks (call and call-summary webhooks)
     * Registers webhooks with Quo API and stores webhook IDs + keys in config
     * Uses atomic pattern: creates all webhooks before saving config, with rollback on failure
     * @private
     * @returns {Promise<Object>} Setup result with status, webhookIds, webhookUrls, etc.
     */
    async setupQuoWebhook() {
        const createdWebhooks = [];

        try {
            if (
                this.config?.quoCallWebhookId &&
                this.config?.quoCallSummaryWebhookId
            ) {
                console.log(
                    `[Quo] Webhooks already registered: call=${this.config.quoCallWebhookId}, callSummary=${this.config.quoCallSummaryWebhookId}`,
                );
                return {
                    status: 'already_configured',
                    callWebhookId: this.config.quoCallWebhookId,
                    callSummaryWebhookId: this.config.quoCallSummaryWebhookId,
                    webhookUrl: this.config.quoWebhooksUrl,
                };
            }

            const hasPartialConfig =
                this.config?.quoCallWebhookId ||
                this.config?.quoCallSummaryWebhookId;

            if (hasPartialConfig) {
                console.warn(
                    '[Quo] Partial webhook configuration detected - cleaning up before retry',
                );

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

            console.log(`[Quo] Registering call webhooks at: ${webhookUrl}`);

            // Fetch and store phone numbers metadata for webhook filtering and phone mapping
            // Non-critical: if this fails, phone mapping can still fetch lazily later
            try {
                await this._fetchAndStoreEnabledPhoneIds();
            } catch (error) {
                console.warn(
                    '[Quo] Failed to fetch phone numbers metadata (non-critical):',
                    error.message,
                );
            }

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

            return {
                status: 'failed',
                error: error.message,
            };
        }
    }

    /**
     * Called when integration is deleted
     * Clean up webhook registration with AxisCare
     *
     * @param {Object} params - Deletion parameters
     * @returns {Promise<void>}
     */
    async onDelete(params) {
        const deletionResults = {
            quoCall: null,
            quoCallSummary: null,
            phoneChunkedWebhooks: { call: [], callSummary: [] },
        };

        try {
            // Validate that API modules are loaded before attempting webhook deletion
            if (!this.axisCare?.api || !this.quo?.api) {
                const missingModules = [];
                if (!this.axisCare?.api) missingModules.push('axiscare');
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

                // Log chunked phone webhooks for manual cleanup
                const phoneSubs =
                    this.config?.phoneNumberWebhookSubscriptions || {};
                for (const type of ['call', 'callSummary']) {
                    const subs = phoneSubs[type] || [];
                    for (const sub of subs) {
                        if (sub.webhookId) {
                            console.warn(
                                `  - Phone ${type} webhook (chunk ${sub.chunkIndex}): ${sub.webhookId}`,
                            );
                        }
                    }
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

            // Delete chunked phone webhooks from phone number mappings
            const phoneSubs =
                this.config?.phoneNumberWebhookSubscriptions || {};
            for (const type of ['call', 'callSummary']) {
                const subs = phoneSubs[type] || [];
                if (subs.length > 0) {
                    console.log(
                        `[Quo] Deleting ${subs.length} chunked ${type} webhook(s) for phone mappings`,
                    );
                }
                for (const sub of subs) {
                    if (sub.webhookId) {
                        try {
                            await this.quo.api.deleteWebhook(sub.webhookId);
                            deletionResults.phoneChunkedWebhooks[type].push({
                                webhookId: sub.webhookId,
                                chunkIndex: sub.chunkIndex,
                                status: 'success',
                            });
                            console.log(
                                `[Quo] ✓ Phone ${type} webhook (chunk ${sub.chunkIndex}) ${sub.webhookId} deleted`,
                            );
                        } catch (error) {
                            deletionResults.phoneChunkedWebhooks[type].push({
                                webhookId: sub.webhookId,
                                chunkIndex: sub.chunkIndex,
                                status: 'failed',
                                error: error.message,
                            });
                            console.error(
                                `[Quo] Failed to delete phone ${type} webhook ${sub.webhookId}:`,
                                error.message,
                            );
                        }
                    }
                }
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

    /**
     * Update phone number to AxisCare site mappings
     * Uses PATCH semantics - merges with existing mappings
     * @param {Object} params
     * @param {Object} params.req - Express request object
     * @param {Object} params.res - Express response object
     */
    async updatePhoneMapping({ req, res }) {
        try {
            const { phoneNumberSiteMappings } = req.body;
            const { integrationId } = req.params;

            // Validation: Required field
            if (!phoneNumberSiteMappings) {
                return res.status(400).json({
                    error: 'phoneNumberSiteMappings is required',
                });
            }

            // Validation: Must be object
            if (
                typeof phoneNumberSiteMappings !== 'object' ||
                Array.isArray(phoneNumberSiteMappings)
            ) {
                return res.status(400).json({
                    error: 'phoneNumberSiteMappings must be an object',
                });
            }

            // Validation: Each mapping entry
            for (const [phoneNumber, mapping] of Object.entries(
                phoneNumberSiteMappings,
            )) {
                if (!phoneNumber || typeof phoneNumber !== 'string') {
                    return res.status(400).json({
                        error: 'Phone number keys must be non-empty strings',
                    });
                }

                if (!mapping || typeof mapping !== 'object') {
                    return res.status(400).json({
                        error: `Mapping for phone number '${phoneNumber}' must be an object`,
                    });
                }

                if (
                    !mapping.axisCareSiteNumber ||
                    typeof mapping.axisCareSiteNumber !== 'string'
                ) {
                    return res.status(400).json({
                        error: `axisCareSiteNumber is required for phone number '${phoneNumber}'`,
                    });
                }

                if (!mapping.label || typeof mapping.label !== 'string') {
                    return res.status(400).json({
                        error: `label is required for phone number '${phoneNumber}'`,
                    });
                }
            }

            // Load integration from database using commands (not repositories directly)
            const result =
                await this.commands.loadIntegrationContextById(integrationId);

            if (result.error) {
                const status = result.error === 404 ? 404 : 500;
                return res.status(status).json({
                    error:
                        result.reason ||
                        `Integration not found: ${integrationId}`,
                });
            }

            const integrationRecord = result.context.record;
            const existingConfig = integrationRecord.config || {};

            // PATCH semantics: Merge new mappings with existing
            const existingMappings =
                existingConfig.phoneNumberSiteMappings || {};
            const mergedMappings = {
                ...existingMappings,
                ...phoneNumberSiteMappings,
            };

            const updatedConfig = {
                ...existingConfig,
                phoneNumberSiteMappings: mergedMappings,
            };

            await this.commands.updateIntegrationConfig({
                integrationId,
                config: updatedConfig,
            });

            this.config = updatedConfig;
            this.id = integrationId;

            console.log(
                `[AxisCare] [OK] Phone mappings updated: ${Object.keys(phoneNumberSiteMappings).length} mapping(s) added/updated`,
            );

            // Sync webhook subscriptions with updated phone mappings
            let webhookSyncResult = null;
            if (this.quo?.api) {
                try {
                    webhookSyncResult =
                        await this._managePhoneWebhookSubscriptions();
                    console.log(
                        `[AxisCare] [OK] Webhook subscriptions synced: ${webhookSyncResult.status}`,
                    );
                } catch (webhookError) {
                    console.error(
                        '[AxisCare] Webhook sync failed (mappings saved):',
                        webhookError.message,
                    );
                    webhookSyncResult = {
                        status: 'failed',
                        error: webhookError.message,
                    };
                }
            } else {
                console.warn(
                    '[AxisCare] Quo API not available - skipping webhook sync',
                );
                webhookSyncResult = {
                    status: 'skipped',
                    reason: 'quo_api_not_available',
                };
            }

            res.json({
                success: true,
                message: 'Phone mappings updated successfully',
                mappingsCount: Object.keys(mergedMappings).length,
                updatedMappings: Object.keys(phoneNumberSiteMappings),
                webhookSync: webhookSyncResult,
            });
        } catch (error) {
            console.error('Failed to update phone mappings:', error);
            res.status(500).json({
                error: 'Failed to update phone mappings',
                details: error.message,
            });
        }
    }

    /**
     * Manually sync phone number webhook subscriptions
     * Reconciles webhook state with current phone mappings
     * NOTE: This endpoint requires the full integration context with Quo API.
     * Use via webhook handlers or queue workers that properly hydrate the integration.
     * @param {Object} params
     * @param {Object} params.req - Express request object
     * @param {Object} params.res - Express response object
     */
    async syncPhoneWebhooks({ req, res }) {
        try {
            const { integrationId } = req.params;

            // Load integration from database using commands (not repositories directly)
            const result =
                await this.commands.loadIntegrationContextById(integrationId);

            if (result.error) {
                const status = result.error === 404 ? 404 : 500;
                return res.status(status).json({
                    error:
                        result.reason ||
                        `Integration not found: ${integrationId}`,
                });
            }

            const integrationRecord = result.context.record;
            this.config = integrationRecord.config || {};
            this.id = integrationId;

            // Note: Quo API won't be available without full integration hydration
            // This endpoint is primarily for manual reconciliation via queue workers
            if (!this.quo?.api) {
                return res.status(503).json({
                    error: 'Quo API not available',
                    details:
                        'Cannot sync webhooks without Quo API connection. The sync-webhooks endpoint requires full integration hydration. Use the phone-mapping POST endpoint which triggers sync automatically, or invoke via queue worker.',
                });
            }

            const mappings = this.config?.phoneNumberSiteMappings || {};
            const phoneCount = Object.keys(mappings).length;

            if (phoneCount === 0) {
                return res.json({
                    success: true,
                    message: 'No phone mappings configured - nothing to sync',
                    subscriptions: { call: [], callSummary: [] },
                });
            }

            console.log(
                `[AxisCare] Starting manual webhook sync for ${phoneCount} phone mapping(s)`,
            );

            const syncResult = await this._managePhoneWebhookSubscriptions();

            const callSubs = syncResult.subscriptions?.call || [];
            const summarySubs = syncResult.subscriptions?.callSummary || [];

            res.json({
                success: true,
                message: 'Webhook subscriptions synced successfully',
                status: syncResult.status,
                subscriptions: {
                    call: callSubs.map((s) => ({
                        webhookId: s.webhookId,
                        chunkIndex: s.chunkIndex,
                        phoneCount: s.phoneIds?.length || 0,
                    })),
                    callSummary: summarySubs.map((s) => ({
                        webhookId: s.webhookId,
                        chunkIndex: s.chunkIndex,
                        phoneCount: s.phoneIds?.length || 0,
                    })),
                },
                totalCallWebhooks: callSubs.length,
                totalCallSummaryWebhooks: summarySubs.length,
                syncedAt: new Date().toISOString(),
            });
        } catch (error) {
            console.error('Failed to sync phone webhooks:', error);
            res.status(500).json({
                error: 'Failed to sync phone webhooks',
                details: error.message,
            });
        }
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
