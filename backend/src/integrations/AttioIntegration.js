const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');
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
     * @returns {Object} Quo contact format
     */
    transformPersonToQuo(person) {
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

        // Extract company - DISABLED for initial sync to avoid N+1 problem
        // TODO: Implement batch company fetch or caching for better performance
        // During initial sync, fetching company for every person = 5000 people × 2 API calls = 10,000 calls!
        let company = null;
        // const companyLinks = attributes.primary_company || [];
        // if (companyLinks.length > 0 && companyLinks[0].target_record_id) {
        //     try {
        //         const companyRecord = await this.attio.api.getRecord(
        //             'companies',
        //             companyLinks[0].target_record_id
        //         );
        //         const companyName = companyRecord.values?.name?.[0]?.value;
        //         company = companyName || null;
        //     } catch (error) {
        //         console.warn(`Failed to fetch company for person ${person.id.record_id}:`, error.message);
        //     }
        // }

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
            customFields: [
                { key: 'crmId', value: person.id.record_id },
                { key: 'crmType', value: 'attio' },
                { key: 'attioWorkspaceId', value: person.id.workspace_id },
                { key: 'attioObjectId', value: person.id.object_id },
                { key: 'attioCreatedAt', value: person.created_at },
                { key: 'attioWebUrl', value: person.web_url },
            ],
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
     * @returns {Promise<void>}
     */
    async setupWebhooks() {
        try {
            const webhookUrl = `${process.env.BASE_URL}/integrations/${this.id}/webhook`;

            // Create webhook for record events
            await this.attio.api.createWebhook({
                target_url: webhookUrl,
                subscriptions: [
                    { event_type: 'record.created', filter: null },
                    { event_type: 'record.updated', filter: null },
                    { event_type: 'record.deleted', filter: null },
                ],
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
