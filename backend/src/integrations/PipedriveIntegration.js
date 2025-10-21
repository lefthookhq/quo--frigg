const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');
const pipedrive = require('@friggframework/api-module-pipedrive');
const quo = require('../api-modules/quo');

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
            supportsWebhooks: true,
            pollIntervalMinutes: 30,
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
     * @returns {Object} Quo contact format
     */
    transformPersonToQuo(person) {
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

        const company = null;
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
     * @returns {Promise<void>}
     */
    async setupWebhooks() {
        try {
            const webhookUrl = `${process.env.BASE_URL}/integrations/${this.id}/webhook`;

            await this.pipedrive.api.webhooks.create({
                subscription_url: webhookUrl,
                event_action: 'added',
                event_object: 'person',
            });

            await this.pipedrive.api.webhooks.create({
                subscription_url: webhookUrl,
                event_action: 'updated',
                event_object: 'person',
            });

            await this.pipedrive.api.webhooks.create({
                subscription_url: webhookUrl,
                event_action: 'deleted',
                event_object: 'person',
            });

            console.log(
                `Pipedrive webhooks created for integration ${this.id}`,
            );
        } catch (error) {
            console.error('Failed to setup Pipedrive webhooks:', error);
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
}

module.exports = PipedriveIntegration;
