const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');

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
            description: 'Pipeline management platform integration with Quo API',
            category: 'CRM & Sales',
            detailsUrl: 'https://www.pipedrive.com',
            icon: '',
        },
        modules: {
            pipedrive: {
                definition: {
                    name: 'pipedrive',
                    version: '1.0.0',
                    display: {
                        name: 'Pipedrive',
                        description: 'Pipedrive API',
                    },
                },
            },
            quo: {
                definition: {
                    name: 'quo',
                    version: '1.0.0',
                    display: {
                        name: 'Quo CRM',
                        description: 'Quo CRM API',
                    },
                },
            },
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
            reverseChronological: true,
            initialBatchSize: 100,
            ongoingBatchSize: 50,
            supportsWebhooks: true, // Pipedrive has good webhook support
            pollIntervalMinutes: 30, // Fallback polling interval
        },
        queueConfig: {
            maxWorkers: 20,
            provisioned: 8,
            maxConcurrency: 75,
            batchSize: 1,
            timeout: 600,
        },
    };

    constructor() {
        super();
        
        // Add existing events (backward compatibility)
        this.events = {
            ...this.events, // BaseCRMIntegration events

            // Existing Pipedrive-specific events
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
                description: 'Get statistics and performance metrics from Pipedrive',
                userActionType: 'REPORT',
            },
        };
    }

    // ============================================================================
    // REQUIRED METHODS - BaseCRMIntegration Abstract Methods
    // ============================================================================

    /**
     * Fetch a page of persons from Pipedrive
     * @param {Object} params
     * @param {string} params.objectType - CRM object type (Person)
     * @param {number} params.page - Page number (0-indexed)
     * @param {number} params.limit - Records per page
     * @param {Date} [params.modifiedSince] - Filter by modification date
     * @param {boolean} [params.sortDesc=true] - Sort descending
     * @returns {Promise<{data: Array, total: number, hasMore: boolean}>}
     */
    async fetchPersonPage({ objectType, page, limit, modifiedSince, sortDesc = true }) {
        try {
            const params = {
                start: page * limit, // Pipedrive uses offset-based pagination
                limit,
                sort: `update_time ${sortDesc ? 'DESC' : 'ASC'}`,
            };

            // Add modification filter if provided
            if (modifiedSince) {
                // Pipedrive uses filter_id for complex queries
                // For simplicity, we'll fetch all and filter in memory for now
                // In production, you'd want to create a Pipedrive filter
                params.since = modifiedSince.toISOString().split('T')[0];
            }

            const response = await this.pipedrive.api.persons.getAll(params);
            
            return {
                data: response.data || [],
                total: response.additional_data?.pagination?.total || null,
                hasMore: response.additional_data?.pagination?.more_items_in_collection || false,
            };
        } catch (error) {
            console.error(`Error fetching ${objectType} page ${page}:`, error);
            throw error;
        }
    }

    /**
     * Transform Pipedrive person object to Quo contact format
     * @param {Object} person - Pipedrive person object
     * @returns {Promise<Object>} Quo contact format
     */
    async transformPersonToQuo(person) {
        // Extract phone numbers from Pipedrive's phone array
        const phoneNumbers = [];
        if (person.phone && person.phone.length > 0) {
            phoneNumbers.push(...person.phone.map(p => ({
                name: p.label || 'work',
                value: p.value,
                primary: p.primary || false,
            })));
        }

        // Extract emails from Pipedrive's email array
        const emails = [];
        if (person.email && person.email.length > 0) {
            emails.push(...person.email.map(e => ({
                name: e.label || 'work',
                value: e.value,
                primary: e.primary || false,
            })));
        }

        // Get organization name if available
        let company = null;
        if (person.org_id) {
            try {
                const org = await this.pipedrive.api.organizations.get(person.org_id.value);
                company = org.data?.name;
            } catch (error) {
                console.warn(`Failed to fetch organization ${person.org_id.value}:`, error.message);
            }
        } else if (person.org_name) {
            company = person.org_name;
        }

        return {
            externalId: String(person.id),
            source: 'pipedrive',
            defaultFields: {
                firstName: person.first_name,
                lastName: person.last_name,
                company,
                phoneNumbers,
                emails,
            },
            customFields: {
                crmId: person.id,
                crmType: 'pipedrive',
                label: person.label,
                openDealsCount: person.open_deals_count,
                closedDealsCount: person.closed_deals_count,
                wonDealsCount: person.won_deals_count,
                lostDealsCount: person.lost_deals_count,
                nextActivityDate: person.next_activity_date,
                lastActivityDate: person.last_activity_date,
                updateTime: person.update_time,
                addTime: person.add_time,
                // Pipedrive-specific fields
                visibleTo: person.visible_to,
                ownerId: person.owner_id?.id,
                ownerName: person.owner_id?.name,
            },
        };
    }

    /**
     * Log SMS message to Pipedrive as an activity
     * @param {Object} activity - SMS activity
     * @returns {Promise<void>}
     */
    async logSMSToActivity(activity) {
        try {
            // Find the person by external ID
            const person = await this.pipedrive.api.persons.get(activity.contactExternalId);
            if (!person || !person.data) {
                console.warn(`Person not found for SMS logging: ${activity.contactExternalId}`);
                return;
            }

            // Create activity in Pipedrive
            const activityData = {
                subject: `SMS: ${activity.direction}`,
                type: 'sms', // Custom activity type (may need to be configured in Pipedrive)
                done: 1, // Mark as done
                note: activity.content,
                person_id: person.data.id,
                due_date: activity.timestamp.split('T')[0], // YYYY-MM-DD format
                due_time: activity.timestamp.split('T')[1]?.substring(0, 5), // HH:MM format
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
            // Find the person by external ID
            const person = await this.pipedrive.api.persons.get(activity.contactExternalId);
            if (!person || !person.data) {
                console.warn(`Person not found for call logging: ${activity.contactExternalId}`);
                return;
            }

            // Create activity in Pipedrive
            const activityData = {
                subject: `Call: ${activity.direction} (${activity.duration}s)`,
                type: 'call',
                done: 1, // Mark as done
                note: activity.summary || 'Phone call',
                person_id: person.data.id,
                due_date: activity.timestamp.split('T')[0], // YYYY-MM-DD format
                due_time: activity.timestamp.split('T')[1]?.substring(0, 5), // HH:MM format
                duration: Math.floor(activity.duration / 60), // Convert seconds to minutes
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
            
            // Create webhook for person.added
            await this.pipedrive.api.webhooks.create({
                subscription_url: webhookUrl,
                event_action: 'added',
                event_object: 'person',
            });

            // Create webhook for person.updated
            await this.pipedrive.api.webhooks.create({
                subscription_url: webhookUrl,
                event_action: 'updated',
                event_object: 'person',
            });

            // Create webhook for person.deleted
            await this.pipedrive.api.webhooks.create({
                subscription_url: webhookUrl,
                event_action: 'deleted',
                event_object: 'person',
            });

            console.log(`Pipedrive webhooks created for integration ${this.id}`);
        } catch (error) {
            console.error('Failed to setup Pipedrive webhooks:', error);
            // Don't throw - fallback to polling
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

            const organizations = await this.pipedrive.api.organizations.getAll(params);
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

            const activities = await this.pipedrive.api.activities.getAll(params);
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
            // Fetch various statistics from Pipedrive
            const [deals, persons, activities] = await Promise.all([
                this.pipedrive.api.deals.getAll({ limit: 1 }),
                this.pipedrive.api.persons.getAll({ limit: 1 }),
                this.pipedrive.api.activities.getAll({ limit: 1 }),
            ]);

            const stats = {
                totalDeals: deals.additional_data?.pagination?.total || 0,
                totalPersons: persons.additional_data?.pagination?.total || 0,
                totalActivities: activities.additional_data?.pagination?.total || 0,
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

