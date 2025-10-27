const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');
const pipedrive = require('@friggframework/api-module-pipedrive');
const quo = require('../api-modules/quo');
const { createFriggCommands } = require('@friggframework/core');

/**
 * PipedriveIntegration - Refactored to extend BaseCRMIntegration
 *
 * Pipedrive-specific implementation for syncing persons/deals with Quo.
 * Demonstrates BaseCRMIntegration pattern with webhook support.
 */
class PipedriveIntegration extends BaseCRMIntegration {
    static Definition = {
        name: 'pipedrive',
        version: '1.0.0',
        supportedVersions: ['1.0.0'],
        hasUserConfig: true,

        display: {
            label: 'Pipedrive',
            description:
                'Pipeline management platform integration with Quo API',
            category: 'CRM & Sales',
            detailsUrl: 'https://www.pipedrive.com',
            icon: '',
        },
        modules: {
            pipedrive: { definition: pipedrive.Definition },
            quo: { definition: quo.Definition },
        },
        routes: [
            {
                path: '/pipedrive/deals',
                method: 'GET',
                event: 'LIST_PIPEDRIVE_DEALS',
            },
            {
                path: '/pipedrive/persons',
                method: 'GET',
                event: 'LIST_PIPEDRIVE_PERSONS',
            },
            {
                path: '/pipedrive/organizations',
                method: 'GET',
                event: 'LIST_PIPEDRIVE_ORGANIZATIONS',
            },
            {
                path: '/pipedrive/activities',
                method: 'GET',
                event: 'LIST_PIPEDRIVE_ACTIVITIES',
            },
        ],
    };

    /**
     * CRM Configuration - Required by BaseCRMIntegration
     */
    static CRMConfig = {
        personObjectTypes: [
            { crmObjectName: 'Person', quoContactType: 'contact' },
        ],
        syncConfig: {
            paginationType: 'CURSOR_BASED',
            supportsTotal: false,
            returnFullRecords: true,
            reverseChronological: true,
            initialBatchSize: 100,
            ongoingBatchSize: 50,
            supportsWebhooks: true,  // ✅ Webhook support implemented (programmatic registration)
        },
        queueConfig: {
            maxWorkers: 20,
            provisioned: 8,
            maxConcurrency: 75,
            batchSize: 1,
            timeout: 600,
        },
    };

    constructor(params) {
        super(params);

        // Initialize Frigg commands for database operations
        this.commands = createFriggCommands({
            integrationClass: PipedriveIntegration,
        });

        this.events = {
            ...this.events,

            LIST_PIPEDRIVE_DEALS: {
                handler: this.listDeals,
            },
            LIST_PIPEDRIVE_PERSONS: {
                handler: this.listPersons,
            },
            LIST_PIPEDRIVE_ORGANIZATIONS: {
                handler: this.listOrganizations,
            },
            LIST_PIPEDRIVE_ACTIVITIES: {
                handler: this.listActivities,
            },
            CREATE_PIPEDRIVE_DEAL: {
                type: 'USER_ACTION',
                handler: this.createDeal,
                title: 'Create Pipedrive Deal',
                description: 'Create a new deal in Pipedrive',
                userActionType: 'DATA',
            },
            SEARCH_PIPEDRIVE_DATA: {
                type: 'USER_ACTION',
                handler: this.searchData,
                title: 'Search Pipedrive Data',
                description: 'Search for deals, persons, and organizations',
                userActionType: 'SEARCH',
            },
            GET_PIPEDRIVE_STATS: {
                type: 'USER_ACTION',
                handler: this.getStats,
                title: 'Get Pipedrive Stats',
                description:
                    'Get statistics and performance metrics from Pipedrive',
                userActionType: 'REPORT',
            },
        };
    }

    // ============================================================================
    // REQUIRED METHODS - BaseCRMIntegration Abstract Methods
    // ============================================================================

    /**
     * Fetch a page of persons from Pipedrive (CURSOR_BASED)
     * @param {Object} params
     * @param {string} params.objectType - CRM object type (Person)
     * @param {string|null} [params.cursor] - Cursor for pagination
     * @param {number} params.limit - Records per page
     * @param {Date} [params.modifiedSince] - Filter by modification date
     * @param {boolean} [params.sortDesc=true] - Sort descending
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
                limit,
            };

            if (cursor) {
                params.cursor = cursor;
            }

            if (modifiedSince) {
                params.updated_since = modifiedSince.toISOString();
            }

            params.sort_by = 'update_time';
            params.sort_direction = sortDesc ? 'desc' : 'asc';

            const response = await this.pipedrive.api.listPersons(params);
            const persons = response.data || [];
            const nextCursor = response.additional_data?.next_cursor || null;

            console.log(
                `[Pipedrive] Fetched ${persons.length} ${objectType}(s) at cursor ${cursor || 'start'}, ` +
                    `hasMore=${!!nextCursor}`,
            );

            return {
                data: persons,
                cursor: nextCursor,
                hasMore: !!nextCursor,
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
     * Transform Pipedrive person object to Quo contact format
     * @param {Object} person - Pipedrive person object
     * @param {Map<string, Object>|null} orgMap - Optional pre-fetched organization map (id -> org data)
     * @returns {Promise<Object>} Quo contact format
     */
    async transformPersonToQuo(person, orgMap = null) {
        const phoneNumbers = [];
        if (person.phones && person.phones.length > 0) {
            phoneNumbers.push(
                ...person.phones.map((p) => ({
                    name: p.label || 'work',
                    value: p.value,
                    primary: p.primary || false,
                })),
            );
        }

        const emails = [];
        if (person.emails && person.emails.length > 0) {
            emails.push(
                ...person.emails.map((e) => ({
                    name: e.label || 'work',
                    value: e.value,
                    primary: e.primary || false,
                })),
            );
        }

        let company = null;
        if (person.org_id) {
            if (orgMap && orgMap.has(person.org_id)) {
                const orgData = orgMap.get(person.org_id);
                company = orgData?.name || null;
            } else {
                try {
                    const orgResponse =
                        await this.pipedrive.api.getOrganization(person.org_id);
                    company = orgResponse.data?.name || null;
                } catch (error) {
                    console.warn(
                        `[PipedriveIntegration] Failed to fetch organization ${person.org_id} for person ${person.id}:`,
                        error.message,
                    );
                    company = null;
                }
            }
        }

        const firstName = person.first_name || 'Unknown';

        return {
            externalId: String(person.id),
            source: 'pipedrive',
            defaultFields: {
                firstName,
                lastName: person.last_name,
                company,
                phoneNumbers,
                emails,
            },
            customFields: [],
        };
    }

    /**
     * Log SMS message to Pipedrive as an activity
     * @param {Object} activity - SMS activity
     * @returns {Promise<void>}
     */
    async logSMSToActivity(activity) {
        try {
            const person = await this.pipedrive.api.persons.get(
                activity.contactExternalId,
            );
            if (!person || !person.data) {
                console.warn(
                    `Person not found for SMS logging: ${activity.contactExternalId}`,
                );
                return;
            }

            const activityData = {
                subject: `SMS: ${activity.direction}`,
                type: 'sms',
                done: 1,
                note: activity.content,
                person_id: person.data.id,
                due_date: activity.timestamp.split('T')[0],
                due_time: activity.timestamp.split('T')[1]?.substring(0, 5),
            };

            await this.pipedrive.api.activities.create(activityData);
        } catch (error) {
            console.error('Failed to log SMS activity to Pipedrive:', error);
            throw error;
        }
    }

    /**
     * Log phone call to Pipedrive as an activity
     * @param {Object} activity - Call activity
     * @returns {Promise<void>}
     */
    async logCallToActivity(activity) {
        try {
            const person = await this.pipedrive.api.persons.get(
                activity.contactExternalId,
            );
            if (!person || !person.data) {
                console.warn(
                    `Person not found for call logging: ${activity.contactExternalId}`,
                );
                return;
            }

            const activityData = {
                subject: `Call: ${activity.direction} (${activity.duration}s)`,
                type: 'call',
                done: 1,
                note: activity.summary || 'Phone call',
                person_id: person.data.id,
                due_date: activity.timestamp.split('T')[0],
                due_time: activity.timestamp.split('T')[1]?.substring(0, 5),
                duration: Math.floor(activity.duration / 60),
            };

            await this.pipedrive.api.activities.create(activityData);
        } catch (error) {
            console.error('Failed to log call activity to Pipedrive:', error);
            throw error;
        }
    }

    /**
     * Setup webhooks with Pipedrive
     * Called during onCreate lifecycle (BaseCRMIntegration)
     * Programmatically registers multiple webhooks with Pipedrive API
     * Stores webhook IDs in config for later cleanup
     * @returns {Promise<Object>} Setup result
     */
    async setupWebhooks() {
        try {
            // 1. Check if webhooks already registered
            if (
                this.config?.pipedriveWebhookIds &&
                this.config.pipedriveWebhookIds.length > 0
            ) {
                console.log(
                    `[Pipedrive] Webhooks already registered:`,
                    this.config.pipedriveWebhookIds,
                );
                return {
                    status: 'already_configured',
                    webhookIds: this.config.pipedriveWebhookIds,
                    webhookUrl: this.config.pipedriveWebhookUrl,
                };
            }

            // 2. Construct webhook URL for this integration instance
            const webhookUrl = `${process.env.BASE_URL}/api/pipedrive-integration/webhooks/${this.id}`;

            console.log(`[Pipedrive] Registering webhooks at: ${webhookUrl}`);

            // 3. Define webhook subscriptions (one webhook per event combination)
            const subscriptions = [
                {
                    event_action: 'added',
                    event_object: 'person',
                    name: 'Person Added',
                },
                {
                    event_action: 'updated',
                    event_object: 'person',
                    name: 'Person Updated',
                },
                {
                    event_action: 'deleted',
                    event_object: 'person',
                    name: 'Person Deleted',
                },
                {
                    event_action: 'merged',
                    event_object: 'person',
                    name: 'Person Merged',
                },
            ];

            // 4. Register each webhook with Pipedrive API
            const webhookIds = [];
            const createdWebhooks = [];

            for (const sub of subscriptions) {
                try {
                    const webhookResponse =
                        await this.pipedrive.api.createWebhook({
                            subscription_url: webhookUrl,
                            event_action: sub.event_action,
                            event_object: sub.event_object,
                            name: `Quo - ${sub.name}`,
                            version: '2.0',
                            // Optional: Add HTTP Basic Auth for additional security
                            // http_auth_user: process.env.PIPEDRIVE_WEBHOOK_USER,
                            // http_auth_password: process.env.PIPEDRIVE_WEBHOOK_PASSWORD,
                        });

                    if (webhookResponse?.data?.id) {
                        webhookIds.push(webhookResponse.data.id);
                        createdWebhooks.push({
                            id: webhookResponse.data.id,
                            event: `${sub.event_action}.${sub.event_object}`,
                            name: sub.name,
                        });
                        console.log(
                            `[Pipedrive] ✓ Created webhook ${webhookResponse.data.id}: ${sub.event_action}.${sub.event_object}`,
                        );
                    } else {
                        console.warn(
                            `[Pipedrive] No webhook ID returned for ${sub.event_action}.${sub.event_object}`,
                        );
                    }
                } catch (error) {
                    console.error(
                        `[Pipedrive] Failed to create webhook for ${sub.event_action}.${sub.event_object}:`,
                        error.message,
                    );
                    // Continue with other webhooks even if one fails
                }
            }

            if (webhookIds.length === 0) {
                throw new Error('Failed to create any webhooks');
            }

            // 5. Store webhook IDs using command pattern
            const updatedConfig = {
                ...this.config,
                pipedriveWebhookIds: webhookIds,
                pipedriveWebhookUrl: webhookUrl,
                pipedriveWebhooks: createdWebhooks,
                webhookCreatedAt: new Date().toISOString(),
            };

            await this.commands.updateIntegrationConfig({
                integrationId: this.id,
                config: updatedConfig,
            });

            // 6. Update local config reference
            this.config = updatedConfig;

            console.log(
                `[Pipedrive] ✓ Registered ${webhookIds.length} webhooks successfully`,
            );

            return {
                status: 'configured',
                webhookIds: webhookIds,
                webhookUrl: webhookUrl,
                webhooks: createdWebhooks,
            };
        } catch (error) {
            console.error('[Pipedrive] Failed to setup webhooks:', error);

            // Fatal error - webhooks are required
            await this.updateIntegrationMessages.execute(
                this.id,
                'errors',
                'Webhook Setup Failed',
                `Could not register webhooks with Pipedrive: ${error.message}. Webhooks are required for this integration. Check API credentials and BASE_URL configuration.`,
                Date.now(),
            );

            // Re-throw to prevent integration creation
            throw error;
        }
    }

    /**
     * Process webhook events from Pipedrive
     * Called by queue worker with full database access and hydrated integration
     * Automatically invoked by Frigg's webhook infrastructure
     *
     * @param {Object} params
     * @param {Object} params.data - Webhook data from queue
     * @param {Object} params.data.body - Pipedrive webhook payload (v2.0)
     * @param {Object} params.data.headers - HTTP headers
     * @param {string} params.data.integrationId - Integration ID
     * @returns {Promise<Object>} Processing result
     */
    async onWebhook({ data }) {
        const { body, headers, integrationId } = data;

        console.log(`[Pipedrive Webhook] Processing event:`, {
            event: body.event,
            action: body.meta?.action,
            object: body.meta?.object,
            objectId: body.meta?.id,
            timestamp: body.meta?.timestamp,
        });

        try {
            // 1. Extract event details from Pipedrive webhook payload (v2.0)
            const { meta, current, previous, event } = body;

            if (!meta || !event) {
                throw new Error('Invalid webhook payload: missing meta or event');
            }

            // 2. Parse event type (e.g., "updated.person" -> action: updated, object: person)
            const [action, object] = event.split('.');

            // 3. Route based on object type
            switch (object) {
                case 'person':
                    await this._handlePersonWebhook({ action, data: current, previous, meta });
                    break;

                case 'organization':
                    await this._handleOrganizationWebhook({ action, data: current, previous, meta });
                    break;

                case 'deal':
                    await this._handleDealWebhook({ action, data: current, previous, meta });
                    break;

                case 'activity':
                    await this._handleActivityWebhook({ action, data: current, previous, meta });
                    break;

                default:
                    console.log(`[Pipedrive Webhook] Unhandled object type: ${object}`);
                    return {
                        success: true,
                        skipped: true,
                        reason: `Object type '${object}' not configured for sync`,
                    };
            }

            console.log(`[Pipedrive Webhook] ✓ Successfully processed ${event}`);

            return {
                success: true,
                event: event,
                action: action,
                object: object,
                objectId: meta.id,
                processedAt: new Date().toISOString(),
            };

        } catch (error) {
            console.error('[Pipedrive Webhook] Processing error:', error);

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
     * Handle person webhook events (added, updated, deleted, merged)
     * Fetches full person data and syncs to Quo
     *
     * @private
     * @param {Object} params
     * @param {string} params.action - Event action: added, updated, deleted, merged
     * @param {Object} params.data - Current person data from webhook
     * @param {Object} params.previous - Previous person data (for updates)
     * @param {Object} params.meta - Webhook metadata (ids, timestamp, etc.)
     * @returns {Promise<void>}
     */
    async _handlePersonWebhook({ action, data, previous, meta }) {
        console.log(`[Pipedrive Webhook] Handling person ${action}:`, meta.id);

        try {
            // Handle deletion separately
            if (action === 'deleted') {
                await this._handlePersonDeleted(meta.id, data);
                return;
            }

            // Handle merge separately
            if (action === 'merged') {
                await this._handlePersonMerged(data, previous, meta);
                return;
            }

            // For added/updated: Fetch full person data to ensure we have all fields
            // (webhook payload may be incomplete)
            let person;
            try {
                const response = await this.pipedrive.api.getPerson(meta.id);
                person = response.data;
            } catch (error) {
                console.warn(`[Pipedrive Webhook] Could not fetch person ${meta.id}, using webhook data:`, error.message);
                person = data;
            }

            if (!person) {
                console.warn(`[Pipedrive Webhook] Person ${meta.id} not found`);
                return;
            }

            // Transform to Quo format using existing method
            const quoContact = await this.transformPersonToQuo(person);

            // Sync to Quo using existing API
            if (!this.quo?.api) {
                throw new Error('Quo API not available');
            }

            await this.quo.api.createContact(quoContact);

            // Update mapping for idempotency tracking
            await this.upsertMapping(String(meta.id), {
                externalId: String(meta.id),
                entityType: 'Person',
                lastSyncedAt: new Date().toISOString(),
                syncMethod: 'webhook',
                action: action,
            });

            console.log(`[Pipedrive Webhook] ✓ Synced person ${meta.id} to Quo`);

        } catch (error) {
            console.error(`[Pipedrive Webhook] Failed to sync person ${meta.id}:`, error.message);
            throw error;
        }
    }

    /**
     * Handle person deleted event
     * @private
     */
    async _handlePersonDeleted(personId, data) {
        console.log(`[Pipedrive Webhook] Handling person deletion:`, personId);

        try {
            // Strategy: Remove mapping (stop syncing)
            // Alternative: Soft delete in Quo or mark as inactive
            await this.deleteMapping(String(personId));

            console.log(`[Pipedrive Webhook] ✓ Removed mapping for person ${personId}`);
        } catch (error) {
            console.error(`[Pipedrive Webhook] Failed to handle person deletion ${personId}:`, error.message);
            throw error;
        }
    }

    /**
     * Handle person merged event
     * When two persons are merged, sync the winner and remove the loser
     * @private
     */
    async _handlePersonMerged(current, previous, meta) {
        console.log(`[Pipedrive Webhook] Handling person merge:`, meta.id);

        try {
            // In Pipedrive, merged records have the winner's ID in current.id
            // and may include merge information in meta or current

            // 1. Fetch the winner person (current)
            const winnerResponse = await this.pipedrive.api.getPerson(meta.id);
            const winner = winnerResponse.data;

            if (winner) {
                // 2. Transform and sync winner to Quo
                const quoContact = await this.transformPersonToQuo(winner);
                await this.quo.api.createContact(quoContact);

                // 3. Update mapping for winner
                await this.upsertMapping(String(meta.id), {
                    externalId: String(meta.id),
                    entityType: 'Person',
                    lastSyncedAt: new Date().toISOString(),
                    syncMethod: 'webhook',
                    action: 'merged',
                });
            }

            // 4. TODO: Identify and remove mapping for loser person
            // Pipedrive may not provide the loser's ID in the webhook
            // Consider tracking merge events separately or querying Pipedrive API

            console.log(`[Pipedrive Webhook] ✓ Handled person merge for ${meta.id}`);
        } catch (error) {
            console.error(`[Pipedrive Webhook] Failed to handle person merge ${meta.id}:`, error.message);
            throw error;
        }
    }

    /**
     * Handle organization webhook events (added, updated, deleted, merged)
     * @private
     */
    async _handleOrganizationWebhook({ action, data, previous, meta }) {
        console.log(`[Pipedrive Webhook] Handling organization ${action}:`, meta.id);

        try {
            if (action === 'deleted') {
                await this.deleteMapping(`org_${meta.id}`);
                console.log(`[Pipedrive Webhook] ✓ Removed mapping for organization ${meta.id}`);
                return;
            }

            // For added/updated/merged: Fetch full organization data
            let organization;
            try {
                const response = await this.pipedrive.api.getOrganization(meta.id);
                organization = response.data;
            } catch (error) {
                console.warn(`[Pipedrive Webhook] Could not fetch organization ${meta.id}, using webhook data:`, error.message);
                organization = data;
            }

            if (!organization) {
                console.warn(`[Pipedrive Webhook] Organization ${meta.id} not found`);
                return;
            }

            // TODO: Implement organization sync to Quo
            // For now, just update mapping
            await this.upsertMapping(`org_${meta.id}`, {
                externalId: String(meta.id),
                entityType: 'Organization',
                lastSyncedAt: new Date().toISOString(),
                syncMethod: 'webhook',
                action: action,
            });

            console.log(`[Pipedrive Webhook] ✓ Organization ${meta.id} processed (sync not yet implemented)`);
        } catch (error) {
            console.error(`[Pipedrive Webhook] Failed to process organization ${meta.id}:`, error.message);
            throw error;
        }
    }

    /**
     * Handle deal webhook events (added, updated, deleted, merged)
     * @private
     */
    async _handleDealWebhook({ action, data, previous, meta }) {
        console.log(`[Pipedrive Webhook] Handling deal ${action}:`, meta.id);

        try {
            // TODO: Implement deal sync logic
            // For now, just log the event
            console.log('[Pipedrive Webhook] Deal sync not yet implemented');
        } catch (error) {
            console.error(`[Pipedrive Webhook] Failed to process deal ${meta.id}:`, error.message);
            throw error;
        }
    }

    /**
     * Handle activity webhook events (added, updated, deleted)
     * @private
     */
    async _handleActivityWebhook({ action, data, previous, meta }) {
        console.log(`[Pipedrive Webhook] Handling activity ${action}:`, meta.id);

        try {
            // TODO: Implement activity sync logic
            // For now, just log the event
            console.log('[Pipedrive Webhook] Activity sync not yet implemented');
        } catch (error) {
            console.error(`[Pipedrive Webhook] Failed to process activity ${meta.id}:`, error.message);
            throw error;
        }
    }

    /**
     * Fetch multiple organization records by IDs using a single batch query
     * @param {string[]|number[]} orgIds - Array of organization IDs
     * @returns {Promise<Array<Object>>} Array of organization records
     */
    async fetchOrganizationsByIds(orgIds) {
        if (!orgIds || orgIds.length === 0) {
            return [];
        }

        console.log(
            `[PipedriveIntegration] Fetching ${orgIds.length} unique organizations in single batch query`,
        );

        try {
            const result = await this.pipedrive.api.listOrganizations({
                ids: orgIds,
            });

            const organizations = result.data || [];

            console.log(
                `[PipedriveIntegration] Successfully fetched ${organizations.length}/${orgIds.length} organizations`,
            );

            if (organizations.length < orgIds.length) {
                const returnedIds = new Set(organizations.map((org) => org.id));
                const missingIds = orgIds.filter((id) => !returnedIds.has(id));
                console.warn(
                    `[PipedriveIntegration] ${missingIds.length} organizations not found:`,
                    missingIds,
                );
            }

            return organizations;
        } catch (error) {
            console.error(
                `[PipedriveIntegration] Failed to fetch organizations in batch:`,
                error.message,
            );
            return [];
        }
    }

    /**
     * Batch transform Pipedrive persons to Quo contacts
     * Optimized: pre-fetches all unique organizations to avoid N+1 queries
     *
     * @param {Array<Object>} persons - Array of Pipedrive person records
     * @returns {Promise<Array<Object>>} Array of Quo contact objects
     */
    async transformPersonsToQuo(persons) {
        if (!persons || persons.length === 0) {
            return [];
        }

        const orgIds = [
            ...new Set(persons.map((p) => p.org_id).filter(Boolean)),
        ];

        let orgMap = new Map();
        if (orgIds.length > 0) {
            const organizations = await this.fetchOrganizationsByIds(orgIds);
            orgMap = new Map(organizations.map((org) => [org.id, org]));
        }

        return Promise.all(
            persons.map((p) => this.transformPersonToQuo(p, orgMap)),
        );
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
        const response = await this.pipedrive.api.persons.get(id);
        return response.data;
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
    // EXISTING METHODS - Backward Compatibility
    // ============================================================================

    async listDeals({ req, res }) {
        try {
            const params = {
                start: req.query.start ? parseInt(req.query.start) : 0,
                limit: req.query.limit ? parseInt(req.query.limit) : 50,
                sort: req.query.sort || 'update_time DESC',
            };

            const deals = await this.pipedrive.api.deals.getAll(params);
            res.json(deals);
        } catch (error) {
            console.error('Failed to list Pipedrive deals:', error);
            res.status(500).json({
                error: 'Failed to list deals',
                details: error.message,
            });
        }
    }

    async listPersons({ req, res }) {
        try {
            const params = {
                start: req.query.start ? parseInt(req.query.start) : 0,
                limit: req.query.limit ? parseInt(req.query.limit) : 50,
                sort: req.query.sort || 'update_time DESC',
            };

            const persons = await this.pipedrive.api.persons.getAll(params);
            res.json(persons);
        } catch (error) {
            console.error('Failed to list Pipedrive persons:', error);
            res.status(500).json({
                error: 'Failed to list persons',
                details: error.message,
            });
        }
    }

    async listOrganizations({ req, res }) {
        try {
            const params = {
                start: req.query.start ? parseInt(req.query.start) : 0,
                limit: req.query.limit ? parseInt(req.query.limit) : 50,
                sort: req.query.sort || 'update_time DESC',
            };

            const organizations =
                await this.pipedrive.api.organizations.getAll(params);
            res.json(organizations);
        } catch (error) {
            console.error('Failed to list Pipedrive organizations:', error);
            res.status(500).json({
                error: 'Failed to list organizations',
                details: error.message,
            });
        }
    }

    async listActivities({ req, res }) {
        try {
            const params = {
                start: req.query.start ? parseInt(req.query.start) : 0,
                limit: req.query.limit ? parseInt(req.query.limit) : 50,
            };

            const activities =
                await this.pipedrive.api.activities.getAll(params);
            res.json(activities);
        } catch (error) {
            console.error('Failed to list Pipedrive activities:', error);
            res.status(500).json({
                error: 'Failed to list activities',
                details: error.message,
            });
        }
    }

    async createDeal({ req, res }) {
        try {
            const dealData = req.body;

            if (!dealData.title) {
                return res.status(400).json({
                    error: 'Deal title is required',
                });
            }

            const result = await this.pipedrive.api.deals.create(dealData);
            res.json(result);
        } catch (error) {
            console.error('Failed to create Pipedrive deal:', error);
            res.status(500).json({
                error: 'Failed to create deal',
                details: error.message,
            });
        }
    }

    async searchData({ req, res }) {
        try {
            const { term, item_types, exact_match } = req.body;

            if (!term) {
                return res.status(400).json({
                    error: 'Search term is required',
                });
            }

            const result = await this.pipedrive.api.search({
                term,
                item_types: item_types || 'person,organization,deal',
                exact_match: exact_match || false,
            });

            res.json(result);
        } catch (error) {
            console.error('Failed to search Pipedrive data:', error);
            res.status(500).json({
                error: 'Failed to search data',
                details: error.message,
            });
        }
    }

    async getStats({ req, res }) {
        try {
            const [deals, persons, activities] = await Promise.all([
                this.pipedrive.api.deals.getAll({ limit: 1 }),
                this.pipedrive.api.persons.getAll({ limit: 1 }),
                this.pipedrive.api.activities.getAll({ limit: 1 }),
            ]);

            const stats = {
                totalDeals: deals.additional_data?.pagination?.total || 0,
                totalPersons: persons.additional_data?.pagination?.total || 0,
                totalActivities:
                    activities.additional_data?.pagination?.total || 0,
            };

            res.json(stats);
        } catch (error) {
            console.error('Failed to get Pipedrive stats:', error);
            res.status(500).json({
                error: 'Failed to get stats',
                details: error.message,
            });
        }
    }

    /**
     * Called when integration is deleted
     * Clean up webhook registrations with Pipedrive
     *
     * @param {Object} params - Deletion parameters
     * @returns {Promise<void>}
     */
    async onDelete(params) {
        try {
            const webhookIds = this.config?.pipedriveWebhookIds || [];

            if (webhookIds.length > 0) {
                console.log(
                    `[Pipedrive] Deleting ${webhookIds.length} webhooks`,
                );

                // Delete each webhook from Pipedrive
                for (const webhookId of webhookIds) {
                    try {
                        await this.pipedrive.api.deleteWebhook(webhookId);
                        console.log(
                            `[Pipedrive] ✓ Deleted webhook ${webhookId}`,
                        );
                    } catch (error) {
                        console.error(
                            `[Pipedrive] Failed to delete webhook ${webhookId}:`,
                            error.message,
                        );
                        // Continue with other webhooks
                    }
                }
            } else {
                console.log('[Pipedrive] No webhooks to delete');
            }
        } catch (error) {
            console.error('[Pipedrive] Failed to delete webhooks:', error);
            // Non-fatal - integration is being deleted anyway
        }

        // Call parent class cleanup
        await super.onDelete(params);
    }
}

module.exports = PipedriveIntegration;
