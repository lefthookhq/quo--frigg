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
            quo: { definition: quo.Definition },
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
        const objectType = person._objectType || 'Client';

        const phoneNumbers = this._extractPhoneNumbers(person, objectType);
        const emails = this._extractEmails(person);
        const firstName = this._extractFirstName(person, objectType);
        const customFields = this._buildCustomFields(person, objectType);

        return {
            externalId: `${person.id}_${Date.now()}`,
            source: 'axiscare',
            defaultFields: {
                firstName,
                lastName: person.lastName,
                company: null,
                phoneNumbers,
                emails,
                role: objectType,
            },
            customFields,
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
            if (person.phone) {
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
     * Build customFields array with type-specific logic
     * @private
     * @param {Object} person - AxisCare person object
     * @param {string} objectType - Person type (Client, Lead, Caregiver, Applicant)
     * @returns {Array<{key: string, value: string}>} Custom fields array
     */
    _buildCustomFields(person, objectType) {
        const customFields = [];

        const addField = (key, value) => {
            if (value !== null && value !== undefined && value !== '') {
                customFields.push({
                    key,
                    value:
                        typeof value === 'object'
                            ? JSON.stringify(value)
                            : String(value),
                });
            }
        };

        addField('crmId', person.id);
        addField('crmType', 'axiscare');
        addField('objectType', objectType); // Track which type this is
        addField('status', person.status?.label || person.status);
        addField('dateOfBirth', person.dateOfBirth);
        addField('gender', person.gender);
        addField('goesBy', person.goesBy);
        addField('priorityNote', person.priorityNote);

        // Addresses (all types have these)
        if (person.residentialAddress) {
            addField('residentialAddress', person.residentialAddress);
        }
        if (person.billingAddress) {
            addField('billingAddress', person.billingAddress);
        }

        // Classes (Client and Caregiver only)
        if (
            (objectType === 'Client' || objectType === 'Caregiver') &&
            person.classes &&
            person.classes.length > 0
        ) {
            addField('classes', person.classes);
        }

        // Other Client/Caregiver specific fields
        if (objectType !== 'Lead' && objectType !== 'Applicant') {
            addField('medicaidNumber', person.medicaidNumber);
            addField('region', person.region);
            addField('administrators', person.administrators);
            addField('preferredCaregiver', person.preferredCaregiver);
            addField('referredBy', person.referredBy);
        }

        // Date fields
        addField('createdDate', person.createdDate);
        addField('assessmentDate', person.assessmentDate);
        addField('conversionDate', person.conversionDate);
        addField('startDate', person.startDate);
        addField('effectiveEndDate', person.effectiveEndDate);

        return customFields;
    }

    /**
     * Setup webhooks with AxisCare
     * Called during onCreate lifecycle (BaseCRMIntegration line 378-386)
     * Registers webhook with AxisCare API and stores webhook ID in config
     *
     * NOTE: AxisCare requires manual webhook configuration via support.
     * This method returns instructions for manual setup.
     *
     * @returns {Promise<Object>} Setup result with instructions
     */
    async setupWebhooks() {
        try {
            // 1. Check if webhook already registered
            if (this.config?.axiscareWebhookId) {
                console.log(`[AxisCare] Webhook already registered: ${this.config.axiscareWebhookId}`);
                return {
                    status: 'already_configured',
                    webhookId: this.config.axiscareWebhookId,
                    webhookUrl: this.config.axiscareWebhookUrl,
                };
            }

            // 2. Construct webhook URL for this integration instance
            const webhookUrl = `${process.env.BASE_URL}/api/axisCare-integration/webhooks/${this.id}`;

            console.log(`[AxisCare] Webhook endpoint available at: ${webhookUrl}`);

            // 3. Return manual setup instructions
            // AxisCare requires contacting support to enable webhooks
            return {
                status: 'manual_setup_required',
                message: 'AxisCare webhooks must be configured manually via AxisCare support',
                instructions: [
                    '1. Contact AxisCare support to enable webhook functionality',
                    '2. Provide your webhook endpoint URL (below)',
                    '3. You will receive an x-webhook-id identifier from AxisCare',
                    '4. Configure these events: client.created, client.updated, caregiver.created, caregiver.updated, lead.created, lead.updated, applicant.created, applicant.updated',
                    '5. After setup, update integration config with the webhook ID',
                ],
                webhookEndpoint: webhookUrl,
                supportedEvents: [
                    'client.created',
                    'client.updated',
                    'caregiver.created',
                    'caregiver.updated',
                    'lead.created',
                    'lead.updated',
                    'applicant.created',
                    'applicant.updated',
                ],
                configUpdateInstructions: {
                    message: 'After receiving webhook ID from AxisCare, update config with:',
                    requiredFields: {
                        axiscareWebhookId: '<webhook-id-from-axiscare>',
                        axiscareWebhookUrl: webhookUrl,
                        webhookCreatedAt: '<iso-timestamp>',
                    },
                },
            };

            // COMMENTED OUT: Programmatic registration code for when AxisCare adds API support
            /*
            // 3. Register webhook with AxisCare API
            const webhookResponse = await this.axisCare.api.createWebhook({
                url: webhookUrl,
                events: [
                    'client.created',
                    'client.updated',
                    'caregiver.created',
                    'caregiver.updated',
                    'lead.created',
                    'lead.updated',
                    'applicant.created',
                    'applicant.updated',
                ],
                active: true,
            });

            // 4. Store webhook ID using command pattern
            const updatedConfig = {
                ...this.config,
                axiscareWebhookId: webhookResponse.id,
                axiscareWebhookUrl: webhookUrl,
                webhookCreatedAt: new Date().toISOString(),
            };

            await this.commands.updateIntegrationConfig({
                integrationId: this.id,
                config: updatedConfig
            });

            // 5. Update local config reference
            this.config = updatedConfig;

            console.log(`[AxisCare] ✓ Webhook registered with ID: ${webhookResponse.id}`);

            return {
                status: 'configured',
                webhookId: webhookResponse.id,
                webhookUrl: webhookUrl,
            };
            */

        } catch (error) {
            console.error('[AxisCare] Failed to setup webhooks:', error);

            // Webhook setup is required - log error
            await this.updateIntegrationMessages.execute(
                this.id,
                'errors',
                'Webhook Setup Failed',
                `Could not setup webhook with AxisCare: ${error.message}. Please contact AxisCare support to manually configure webhooks.`,
                Date.now()
            );

            return {
                status: 'failed',
                error: error.message,
                message: 'Webhook setup required - contact AxisCare support for manual configuration',
            };
        }
    }

    /**
     * Process webhook events from AxisCare
     * Called by queue worker with full database access and hydrated integration
     * Automatically invoked by Frigg's webhook infrastructure
     *
     * @param {Object} params
     * @param {Object} params.data - Webhook data from queue
     * @param {Object} params.data.body - AxisCare webhook payload
     * @param {Object} params.data.headers - HTTP headers
     * @param {string} params.data.integrationId - Integration ID
     * @returns {Promise<Object>} Processing result
     */
    async onWebhook({ data }) {
        const { body, headers, integrationId } = data;

        console.log(`[AxisCare Webhook] Processing event:`, {
            event: body.event,
            entityId: body.data?.id,
            timestamp: body.timestamp,
        });

        try {
            // Validate webhook source (AxisCare specific)
            const userAgent = headers['user-agent'];
            if (userAgent !== 'AWS-Webhook-Service') {
                console.warn('[AxisCare Webhook] Invalid user-agent:', userAgent);
                throw new Error(`Invalid webhook source: ${userAgent}`);
            }

            // Validate webhook ID (required header per AxisCare docs)
            const webhookId = headers['x-webhook-id'];
            if (!webhookId) {
                console.error('[AxisCare Webhook] Missing required x-webhook-id header');
                throw new Error('Missing required x-webhook-id header');
            }

            // Auto-store webhook ID on first webhook (eliminates manual config step)
            if (!this.config?.axiscareWebhookId) {
                console.log(`[AxisCare Webhook] Auto-storing webhook ID from first webhook: ${webhookId}`);

                const updatedConfig = {
                    ...this.config,
                    axiscareWebhookId: webhookId,
                    axiscareWebhookUrl: `${process.env.BASE_URL}/api/axisCare-integration/webhooks/${this.id}`,
                    webhookCreatedAt: new Date().toISOString(),
                };

                await this.commands.updateIntegrationConfig({
                    integrationId: this.id,
                    config: updatedConfig
                });

                // Update local reference
                this.config = updatedConfig;

                console.log(`[AxisCare Webhook] ✓ Webhook ID ${webhookId} stored in config`);
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
                    await this._handlePersonWebhook({ entity: 'Client', action, id });
                    break;

                case 'caregiver':
                    await this._handlePersonWebhook({ entity: 'Caregiver', action, id });
                    break;

                case 'lead':
                    await this._handlePersonWebhook({ entity: 'Lead', action, id });
                    break;

                case 'applicant':
                    await this._handlePersonWebhook({ entity: 'Applicant', action, id });
                    break;

                default:
                    console.log(`[AxisCare Webhook] Unhandled entity type: ${entity}`);
                    return {
                        success: true,
                        skipped: true,
                        reason: `Entity type '${entity}' not configured for sync`,
                    };
            }

            console.log(`[AxisCare Webhook] ✓ Successfully processed ${eventType}`);

            return {
                success: true,
                event: eventType,
                entityType: entity,
                entityId: id,
                action: action,
                processedAt: new Date().toISOString(),
            };

        } catch (error) {
            console.error('[AxisCare Webhook] Processing error:', error);

            // Log error to integration messages
            await this.updateIntegrationMessages.execute(
                this.id,
                'errors',
                'Webhook Processing Error',
                `Failed to process ${body.event}: ${error.message}`,
                Date.now()
            );

            // Re-throw for SQS retry and DLQ
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
                console.warn(`[AxisCare Webhook] ${entity} ${id} not found in AxisCare`);
                return;
            }

            // Tag with object type for transformation (existing pattern)
            person._objectType = entity;

            // Transform to Quo format using existing method
            const quoContact = await this.transformPersonToQuo(person);

            // Sync to Quo using existing API
            if (!this.quo?.api) {
                throw new Error('Quo API not available');
            }

            await this.quo.api.createContact(quoContact);

            // Update mapping for idempotency tracking
            await this.upsertMapping(id, {
                externalId: id,
                entityType: entity,
                lastSyncedAt: new Date().toISOString(),
                syncMethod: 'webhook',
                action: action,
            });

            console.log(`[AxisCare Webhook] ✓ Synced ${entity} ${id} to Quo`);

        } catch (error) {
            console.error(`[AxisCare Webhook] Failed to sync ${entity} ${id}:`, error.message);
            throw error; // Re-throw for retry logic
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
        try {
            // Check if webhook ID exists in config
            const webhookId = this.config?.axiscareWebhookId;

            if (webhookId) {
                console.log(`[AxisCare] Deleting webhook: ${webhookId}`);

                // Unregister webhook from AxisCare (if programmatic API available)
                // NOTE: If AxisCare adds programmatic webhook API, uncomment:
                /*
                try {
                    await this.axisCare.api.deleteWebhook(webhookId);
                    console.log(`[AxisCare] ✓ Webhook ${webhookId} deleted from AxisCare`);
                } catch (error) {
                    console.error(`[AxisCare] Failed to delete webhook from AxisCare:`, error);
                    // Continue with local cleanup
                }
                */

                // Clear webhook config using command pattern
                const updatedConfig = { ...this.config };
                delete updatedConfig.axiscareWebhookId;
                delete updatedConfig.axiscareWebhookUrl;
                delete updatedConfig.webhookCreatedAt;

                await this.commands.updateIntegrationConfig({
                    integrationId: this.id,
                    config: updatedConfig
                });

                console.log(`[AxisCare] ✓ Webhook config cleared`);
            } else {
                console.log('[AxisCare] No webhook to delete');
            }
        } catch (error) {
            console.error('[AxisCare] Failed to delete webhook:', error);
            // Non-fatal - integration is being deleted anyway
        }

        // Call parent class cleanup
        await super.onDelete(params);
    }

    async getConfigOptions() {
        return {
            maxClientsPerSync: {
                type: 'number',
                title: 'Max Clients per Manual Sync',
                description:
                    'Maximum number of clients to sync when using manual sync action',
                default: 50,
                minimum: 1,
                maximum: 1000,
            },
            maxAppointmentsPerSync: {
                type: 'number',
                title: 'Max Appointments per Manual Sync',
                description:
                    'Maximum number of appointments to sync when using manual sync action',
                default: 100,
                minimum: 1,
                maximum: 1000,
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
