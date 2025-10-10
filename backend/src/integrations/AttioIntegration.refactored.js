const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');

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

        display: {
            label: 'Attio',
            description: 'Modern CRM platform integration with Quo API',
            category: 'CRM, Sales',
            detailsUrl: 'https://app.attio.com',
            icon: '',
        },
        modules: {
            attio: {
                definition: {
                    name: 'attio',
                    version: '1.0.0',
                    display: {
                        name: 'Attio',
                        description: 'Attio CRM API',
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
                path: '/attio/workspaces',
                method: 'GET',
                event: 'LIST_ATTIO_WORKSPACES',
            },
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
            reverseChronological: true,
            initialBatchSize: 50,
            ongoingBatchSize: 25,
            supportsWebhooks: true, // Attio has webhook support
            pollIntervalMinutes: 30,
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

        // Add existing events (backward compatibility)
        this.events = {
            ...this.events, // BaseCRMIntegration events

            // Existing Attio-specific events
            LIST_ATTIO_WORKSPACES: {
                handler: this.listWorkspaces,
            },
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
        };
    }

    // ============================================================================
    // REQUIRED METHODS - BaseCRMIntegration Abstract Methods
    // ============================================================================

    /**
     * Fetch a page of persons from Attio
     * @param {Object} params
     * @param {string} params.objectType - CRM object type (people)
     * @param {number} params.page - Page number (0-indexed)
     * @param {number} params.limit - Records per page
     * @param {Date} [params.modifiedSince] - Filter by modification date
     * @param {boolean} [params.sortDesc=true] - Sort descending
     * @returns {Promise<{data: Array, total: number, hasMore: boolean}>}
     */
    async fetchPersonPage({ objectType, page, limit, modifiedSince, sortDesc = true }) {
        try {
            const params = {
                limit,
                offset: page * limit,
                sort: {
                    attribute: 'updated_at',
                    direction: sortDesc ? 'desc' : 'asc',
                },
            };

            // Add modification filter if provided
            if (modifiedSince) {
                params.filter = {
                    attribute: 'updated_at',
                    gte: modifiedSince.toISOString(),
                };
            }

            // Attio uses object slugs (e.g., 'people', 'companies')
            const response = await this.attio.api.objects.listRecords(objectType, params);
            
            return {
                data: response.data || [],
                total: response.total || null,
                hasMore: response.has_more || false,
            };
        } catch (error) {
            console.error(`Error fetching ${objectType} page ${page}:`, error);
            throw error;
        }
    }

    /**
     * Transform Attio person object to Quo contact format
     * @param {Object} person - Attio person record
     * @returns {Promise<Object>} Quo contact format
     */
    async transformPersonToQuo(person) {
        // Attio uses a flexible attribute-based structure
        const attributes = person.values || {};

        // Extract name from attributes
        const nameAttr = attributes.name?.[0];
        const firstName = nameAttr?.first_name || '';
        const lastName = nameAttr?.last_name || '';

        // Extract email addresses
        const emails = [];
        const emailAttrs = attributes.email_addresses || [];
        for (const emailAttr of emailAttrs) {
            if (emailAttr.email_address) {
                emails.push({
                    name: emailAttr.attribute_type || 'work',
                    value: emailAttr.email_address,
                    primary: emailAttr.is_primary || false,
                });
            }
        }

        // Extract phone numbers
        const phoneNumbers = [];
        const phoneAttrs = attributes.phone_numbers || [];
        for (const phoneAttr of phoneAttrs) {
            if (phoneAttr.phone_number) {
                phoneNumbers.push({
                    name: phoneAttr.attribute_type || 'work',
                    value: phoneAttr.phone_number,
                    primary: phoneAttr.is_primary || false,
                });
            }
        }

        // Extract company (from primary company relationship)
        let company = null;
        const companyLinks = attributes.primary_company || [];
        if (companyLinks.length > 0 && companyLinks[0].target_record_id) {
            try {
                const companyRecord = await this.attio.api.objects.getRecord(
                    'companies',
                    companyLinks[0].target_record_id
                );
                const companyName = companyRecord.values?.name?.[0]?.value;
                company = companyName || null;
            } catch (error) {
                console.warn(`Failed to fetch company for person ${person.id.record_id}:`, error.message);
            }
        }

        return {
            externalId: person.id.record_id,
            source: 'attio',
            defaultFields: {
                firstName,
                lastName,
                company,
                phoneNumbers,
                emails,
            },
            customFields: {
                crmId: person.id.record_id,
                crmType: 'attio',
                objectId: person.id.object_id,
                createdAt: person.created_at,
                updatedAt: person.updated_at,
                // Store all Attio attributes for reference
                attioAttributes: attributes,
            },
        };
    }

    /**
     * Log SMS message to Attio as a note/interaction
     * @param {Object} activity - SMS activity
     * @returns {Promise<void>}
     */
    async logSMSToActivity(activity) {
        try {
            // Find the person by external ID
            const person = await this.attio.api.objects.getRecord('people', activity.contactExternalId);
            if (!person) {
                console.warn(`Person not found for SMS logging: ${activity.contactExternalId}`);
                return;
            }

            // Create note entry in Attio
            const noteData = {
                parent_object: 'people',
                parent_record_id: activity.contactExternalId,
                title: `SMS: ${activity.direction}`,
                content: activity.content,
                created_at: activity.timestamp,
            };

            await this.attio.api.notes.create(noteData);
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
            const person = await this.attio.api.objects.getRecord('people', activity.contactExternalId);
            if (!person) {
                console.warn(`Person not found for call logging: ${activity.contactExternalId}`);
                return;
            }

            // Create note entry in Attio
            const noteData = {
                parent_object: 'people',
                parent_record_id: activity.contactExternalId,
                title: `Call: ${activity.direction} (${activity.duration}s)`,
                content: activity.summary || 'Phone call',
                created_at: activity.timestamp,
            };

            await this.attio.api.notes.create(noteData);
        } catch (error) {
            console.error('Failed to log call activity to Attio:', error);
            throw error;
        }
    }

    /**
     * Setup webhooks with Attio
     * @returns {Promise<void>}
     */
    async setupWebhooks() {
        try {
            const webhookUrl = `${process.env.BASE_URL}/integrations/${this.id}/webhook`;
            
            // Create webhook for record.created events
            await this.attio.api.webhooks.create({
                url: webhookUrl,
                subscribed_events: [
                    'record.created',
                    'record.updated',
                    'record.deleted',
                ],
                object_types: ['people'],
            });

            console.log(`Attio webhooks created for integration ${this.id}`);
        } catch (error) {
            console.error('Failed to setup Attio webhooks:', error);
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
    // EXISTING METHODS - Backward Compatibility
    // ============================================================================

    async listWorkspaces({ req, res }) {
        try {
            const workspaces = await this.attio.api.workspaces.list();
            res.json(workspaces);
        } catch (error) {
            console.error('Failed to list Attio workspaces:', error);
            res.status(500).json({
                error: 'Failed to list workspaces',
                details: error.message,
            });
        }
    }

    async listObjects({ req, res }) {
        try {
            const objects = await this.attio.api.objects.list();
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

            const companies = await this.attio.api.objects.listRecords('companies', params);
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

            const people = await this.attio.api.objects.listRecords('people', params);
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
            const objects = await this.attio.api.objects.list();
            // Filter to only custom objects (not standard ones like 'people', 'companies')
            const customObjects = objects.data?.filter(obj => 
                !['people', 'companies'].includes(obj.api_slug)
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

            const result = await this.attio.api.objects.createRecord(objectType, { values });
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

            const result = await this.attio.api.search({
                query,
                object_types: object_types || ['people', 'companies'],
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

