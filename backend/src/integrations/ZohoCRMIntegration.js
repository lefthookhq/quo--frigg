const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');
const { Definition: QuoDefinition } = require('../api-modules/quo/definition');
const zohoCrm = require('@friggframework/api-module-zoho-crm');
const { createFriggCommands } = require('@friggframework/core');

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
            quo: { definition: QuoDefinition },
            zohoCrm: {
                definition: zohoCrm.Definition,
            },
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
     * Verify Zoho webhook bearer token
     * Validates the Authorization header against the stored bearer token in config
     *
     * @private
     * @param {Object} params
     * @param {string} params.authHeader - Authorization header from webhook request
     * @param {string} params.storedToken - Stored bearer token from config
     * @returns {boolean} True if token is valid
     */
    _verifyWebhookToken({ authHeader, storedToken }) {
        if (!authHeader || !storedToken) {
            console.warn('[Zoho CRM] Missing authorization header or stored token');
            return false;
        }

        try {
            // Extract token from "Bearer {token}" or "Zoho-oauthtoken {token}" format
            const tokenMatch = authHeader.match(/(?:Bearer|Zoho-oauthtoken)\s+(.+)/i);

            if (!tokenMatch) {
                console.warn('[Zoho CRM] Invalid authorization header format');
                return false;
            }

            const receivedToken = tokenMatch[1].trim();

            // Direct comparison (Zoho webhooks use the bearer token you provide during setup)
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
        const source =
            objectType === 'Account' ? 'zoho-account' : 'zoho-contact';

        return {
            externalId,
            source,
            defaultFields: {
                firstName,
                lastName: person.Last_Name || '',
                company,
                phoneNumbers,
                emails,
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
            phones.push({ name: 'work', value: person.Phone });
        }

        if (objectType === 'Contact' && person.Mobile) {
            phones.push({ name: 'mobile', value: person.Mobile });
        }

        return phones;
    }

    _extractEmails(person, objectType) {
        const emails = [];

        if (objectType === 'Contact' && person.Email) {
            emails.push({ name: 'work', value: person.Email });
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
     * Setup webhooks with Zoho CRM
     * Called during onCreate lifecycle (BaseCRMIntegration)
     * Programmatically registers webhook with Zoho CRM API and stores webhook ID + bearer token in config
     * @returns {Promise<Object>} Setup result
     */
    async setupWebhooks() {
        try {
            // 1. Check if webhook already registered
            if (this.config?.zohoWebhookIds && this.config.zohoWebhookIds.length > 0) {
                console.log(`[Zoho CRM] Webhooks already registered: ${this.config.zohoWebhookIds.map(w => w.id).join(', ')}`);
                return {
                    status: 'already_configured',
                    webhookIds: this.config.zohoWebhookIds,
                    webhookUrl: this.config.zohoWebhookUrl,
                    modules: this.config.webhookModules,
                };
            }

            // 2. Construct webhook URL for this integration instance
            // Validate BASE_URL is configured
            if (!process.env.BASE_URL) {
                throw new Error('BASE_URL environment variable is required for webhook registration');
            }

            const webhookUrl = `${process.env.BASE_URL}/api/zohoCrm-integration/webhooks/${this.id}`;

            console.log(`[Zoho CRM] Registering webhook at: ${webhookUrl}`);

            // 3. Generate bearer token for webhook authentication
            // This token will be included in Zoho's webhook requests to our endpoint
            const crypto = require('crypto');
            const bearerToken = crypto.randomBytes(32).toString('hex');

            // 4. Define webhook configuration for each CRM object type
            // Zoho requires separate webhooks per module
            const webhookConfigs = this.constructor.CRMConfig.personObjectTypes.map(({ crmObjectName }) => ({
                module: crmObjectName === 'Contact' ? 'Contacts' : 'Accounts',
                name: `Quo Sync - ${crmObjectName} Changes`,
                url: webhookUrl,
                http_method: 'POST',
                description: `Webhook for ${crmObjectName} create/update events to sync with Quo`,
                authentication: {
                    type: 'general',
                    authorization_type: 'bearer',
                    authorization_key: bearerToken,
                },
                module_params: [
                    {
                        name: 'record_id',
                        value: crmObjectName === 'Contact'
                            ? '${Contacts.id}'
                            : '${Accounts.id}',
                    },
                    {
                        name: 'module_name',
                        value: crmObjectName === 'Contact' ? 'Contacts' : 'Accounts',
                    },
                    {
                        name: 'modified_time',
                        value: crmObjectName === 'Contact'
                            ? '${Contacts.Modified_Time}'
                            : '${Accounts.Modified_Time}',
                    },
                    {
                        name: 'owner_id',
                        value: crmObjectName === 'Contact'
                            ? '${Contacts.Owner.id}'
                            : '${Accounts.Owner.id}',
                    },
                ],
                custom_params: [
                    {
                        name: 'source',
                        value: 'zoho_crm',
                    },
                    {
                        name: 'integration_id',
                        value: this.id,
                    },
                    {
                        name: 'event_type',
                        value: 'record_changed',
                    },
                ],
            }));

            // 5. Register webhooks with Zoho CRM API
            const webhookIds = [];

            for (const config of webhookConfigs) {
                try {
                    const webhookResponse = await this.zohoCrm.api.createWebhook({
                        webhooks: [config],
                    });

                    if (webhookResponse.webhooks?.[0]?.status === 'success') {
                        const webhookId = webhookResponse.webhooks[0].details.id;
                        webhookIds.push({
                            id: webhookId,
                            module: config.module,
                        });
                        console.log(`[Zoho CRM] ✓ Webhook registered for ${config.module}: ${webhookId}`);
                    } else {
                        console.error(`[Zoho CRM] Failed to create webhook for ${config.module}:`, webhookResponse);
                    }
                } catch (moduleError) {
                    console.error(`[Zoho CRM] Error creating webhook for ${config.module}:`, moduleError);
                    // Continue with other modules
                }
            }

            if (webhookIds.length === 0) {
                throw new Error('Failed to create any webhooks');
            }

            // 6. Store webhook IDs and bearer token using command pattern
            const updatedConfig = {
                ...this.config,
                zohoWebhookIds: webhookIds, // Array of { id, module }
                zohoWebhookUrl: webhookUrl,
                zohoWebhookBearerToken: bearerToken, // ENCRYPTED by Frigg's field-level encryption
                webhookCreatedAt: new Date().toISOString(),
                webhookModules: webhookIds.map(w => w.module),
            };

            await this.commands.updateIntegrationConfig({
                integrationId: this.id,
                config: updatedConfig,
            });

            // 7. Update local config reference
            this.config = updatedConfig;

            console.log(`[Zoho CRM] ✓ ${webhookIds.length} webhooks registered successfully`);
            console.log(`[Zoho CRM] ✓ Bearer token stored securely (encrypted at rest)`);

            return {
                status: 'configured',
                webhookIds: webhookIds,
                webhookUrl: webhookUrl,
                modules: webhookIds.map(w => w.module),
            };

        } catch (error) {
            console.error('[Zoho CRM] Failed to setup webhooks:', error);

            // Fatal error - webhooks are required for Zoho CRM
            await this.updateIntegrationMessages.execute(
                this.id,
                'errors',
                'Webhook Setup Failed',
                `Could not register webhook with Zoho CRM: ${error.message}. Please ensure OAuth scopes include webhook permissions (ZohoCRM.settings.webhooks.CREATE, UPDATE, DELETE, READ).`,
                Date.now()
            );

            // Re-throw to prevent integration from being created without webhooks
            throw error;
        }
    }

    /**
     * Optional: Override HTTP webhook receiver to add bearer token validation
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
            // Extract authorization header
            const authHeader = req.headers.authorization || req.headers.Authorization;

            if (!authHeader) {
                console.warn('[Zoho CRM Webhook] No authorization header found');
                // Still accept webhook (full verification happens in worker)
            }

            // Note: We can't verify token here because we don't have DB access
            // Token verification will happen in onWebhook() with full context

            // Extract webhook data from request
            const webhookData = {
                body: req.body,
                headers: req.headers,
                integrationId: req.params.integrationId,
                authHeader: authHeader,
                receivedAt: new Date().toISOString(),
            };

            // Log incoming webhook for debugging
            console.log('[Zoho CRM Webhook] Received:', {
                module: req.body.module_name,
                recordId: req.body.record_id,
                eventType: req.body.event_type,
            });

            // Call parent implementation to queue to SQS
            await super.onWebhookReceived({ req, res, data: webhookData });

        } catch (error) {
            console.error('[Zoho CRM Webhook] Receive error:', error);
            throw error;
        }
    }

    /**
     * Process webhook events from Zoho CRM
     * Called by queue worker with full database access and hydrated integration
     * Automatically invoked by Frigg's webhook infrastructure
     *
     * @param {Object} params
     * @param {Object} params.data - Webhook data from queue
     * @param {Object} params.data.body - Zoho CRM webhook payload
     * @param {Object} params.data.headers - HTTP headers
     * @param {string} params.data.authHeader - Authorization header
     * @param {string} params.data.integrationId - Integration ID
     * @returns {Promise<Object>} Processing result
     */
    async onWebhook({ data }) {
        const { body, headers, authHeader, integrationId } = data;

        console.log(`[Zoho CRM Webhook] Processing event:`, {
            module: body.module_name,
            recordId: body.record_id,
            eventType: body.event_type,
            timestamp: body.modified_time,
        });

        try {
            // 1. Verify webhook bearer token
            const storedToken = this.config?.zohoWebhookBearerToken;

            if (storedToken && authHeader) {
                const isValid = this._verifyWebhookToken({
                    authHeader: authHeader,
                    storedToken: storedToken,
                });

                if (!isValid) {
                    console.error('[Zoho CRM Webhook] Invalid bearer token - possible security issue!');
                    throw new Error('Webhook bearer token verification failed');
                }

                console.log('[Zoho CRM Webhook] ✓ Bearer token verified');
            } else {
                console.warn('[Zoho CRM Webhook] No token or header - skipping verification');
            }

            // 2. Extract event details from Zoho webhook payload
            const moduleName = body.module_name; // "Contacts" or "Accounts"
            const recordId = body.record_id;
            const eventType = body.event_type || 'record_changed';

            if (!moduleName || !recordId) {
                throw new Error('Webhook payload missing module_name or record_id');
            }

            // 3. Map Zoho module name to internal object type
            let objectType;
            if (moduleName === 'Contacts') {
                objectType = 'Contact';
            } else if (moduleName === 'Accounts') {
                objectType = 'Account';
            } else {
                console.log(`[Zoho CRM Webhook] Unhandled module: ${moduleName}`);
                return {
                    success: true,
                    skipped: true,
                    reason: `Module '${moduleName}' not configured for sync`,
                };
            }

            // 4. Process the record change
            await this._handlePersonWebhook({
                objectType: objectType,
                recordId: recordId,
                moduleName: moduleName,
            });

            console.log(`[Zoho CRM Webhook] ✓ Successfully processed ${moduleName} ${recordId}`);

            return {
                success: true,
                event: eventType,
                module: moduleName,
                recordId: recordId,
                processedAt: new Date().toISOString(),
            };

        } catch (error) {
            console.error('[Zoho CRM Webhook] Processing error:', error);

            // Log error to integration messages
            await this.updateIntegrationMessages.execute(
                this.id,
                'errors',
                'Webhook Processing Error',
                `Failed to process ${body.module_name} ${body.record_id}: ${error.message}`,
                Date.now()
            );

            // Re-throw for SQS retry and DLQ
            throw error;
        }
    }

    /**
     * Handle person entity webhook (Contact or Account)
     * Fetches full entity data, transforms to Quo format, and syncs
     *
     * @private
     * @param {Object} params
     * @param {string} params.objectType - Object type (Contact or Account)
     * @param {string} params.recordId - Record ID from Zoho CRM
     * @param {string} params.moduleName - Module name (Contacts or Accounts)
     * @returns {Promise<void>}
     */
    async _handlePersonWebhook({ objectType, recordId, moduleName }) {
        console.log(`[Zoho CRM Webhook] Handling ${objectType}: ${recordId}`);

        try {
            // 1. Fetch full entity data from Zoho CRM using existing API methods
            let person;

            if (objectType === 'Contact') {
                const response = await this.zohoCrm.api.getContact(recordId);

                if (!response.data) {
                    throw new Error(`No data returned for Contact ${recordId}`);
                }

                // Handle array response
                if (Array.isArray(response.data)) {
                    if (response.data.length === 0) {
                        console.warn(`[Zoho CRM Webhook] Contact ${recordId} not found (empty array)`);
                        return;
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

                // Handle array response
                if (Array.isArray(response.data)) {
                    if (response.data.length === 0) {
                        console.warn(`[Zoho CRM Webhook] Account ${recordId} not found (empty array)`);
                        return;
                    }
                    person = response.data[0];
                } else {
                    person = response.data;
                }
            } else {
                throw new Error(`Unknown object type: ${objectType}`);
            }

            if (!person) {
                console.warn(`[Zoho CRM Webhook] ${objectType} ${recordId} not found in Zoho CRM`);
                return;
            }

            // 2. Tag with object type for transformation (existing pattern)
            person._objectType = objectType;

            // 3. Transform to Quo format using existing method
            const quoContact = await this.transformPersonToQuo(person);

            // 4. Sync to Quo using existing API
            if (!this.quo?.api) {
                throw new Error('Quo API not available');
            }

            await this.quo.api.createContact(quoContact);

            // 5. Update mapping for idempotency tracking
            await this.upsertMapping(recordId, {
                externalId: recordId,
                entityType: objectType,
                lastSyncedAt: new Date().toISOString(),
                syncMethod: 'webhook',
                moduleName: moduleName,
            });

            console.log(`[Zoho CRM Webhook] ✓ Synced ${objectType} ${recordId} to Quo`);

        } catch (error) {
            console.error(`[Zoho CRM Webhook] Failed to sync ${objectType} ${recordId}:`, error.message);
            throw error; // Re-throw for retry logic
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
        try {
            const webhookIds = this.config?.zohoWebhookIds || [];

            if (webhookIds.length > 0) {
                console.log(`[Zoho CRM] Deleting ${webhookIds.length} webhooks`);

                // Delete each webhook
                for (const { id, module } of webhookIds) {
                    try {
                        await this.zohoCrm.api.deleteWebhook(id);
                        console.log(`[Zoho CRM] ✓ Webhook ${id} (${module}) deleted from Zoho CRM`);
                    } catch (error) {
                        console.error(`[Zoho CRM] Failed to delete webhook ${id}:`, error);
                        // Continue with other webhooks
                    }
                }

                // Clear webhook config using command pattern
                const updatedConfig = { ...this.config };
                delete updatedConfig.zohoWebhookIds;
                delete updatedConfig.zohoWebhookUrl;
                delete updatedConfig.zohoWebhookBearerToken;
                delete updatedConfig.webhookCreatedAt;
                delete updatedConfig.webhookModules;

                await this.commands.updateIntegrationConfig({
                    integrationId: this.id,
                    config: updatedConfig,
                });

                console.log(`[Zoho CRM] ✓ Webhook config cleared`);
            } else {
                console.log('[Zoho CRM] No webhooks to delete');
            }
        } catch (error) {
            console.error('[Zoho CRM] Failed to delete webhooks:', error);
            // Non-fatal - integration is being deleted anyway
        }

        // Call parent class cleanup
        await super.onDelete(params);
    }
}

module.exports = ZohoCRMIntegration;
