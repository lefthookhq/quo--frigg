const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');
const { Definition: QuoDefinition } = require('../api-modules/quo/definition');
const crmScaleTest = require('@friggframework/api-module-frigg-scale-test');
const crypto = require('crypto');

/**
 * ScalingTestIntegration - Refactored to extend BaseCRMIntegration
 *
 * Test harness integration for validating BaseCRMIntegration scalability and performance.
 * Generates synthetic data for load testing.
 */
class ScalingTestIntegration extends BaseCRMIntegration {
    static Definition = {
        name: 'scalingtest',
        version: '1.0.0',
        supportedVersions: ['1.0.0'],
        hasUserConfig: true,

        display: {
            label: 'Scaling Test Integration',
            description:
                'Integration for testing scalability using Quo API and synthetic data',
            category: 'Testing',
            detailsUrl: '',
            icon: '',
        },
        modules: {
            quo: { definition: QuoDefinition },
            'scale-test': {
                definition: crmScaleTest.Definition,
            },
        },
        routes: [],
    };

    /**
     * CRM Configuration - Optimized for scale testing
     */
    static CRMConfig = {
        personObjectTypes: [
            { crmObjectName: 'Contact', quoContactType: 'contact' },
        ],
        syncConfig: {
            reverseChronological: true,
            initialBatchSize: 500, // Large batches for scale testing
            ongoingBatchSize: 250,
            supportsWebhooks: true, // Simulate webhook capability
            pollIntervalMinutes: 5, // Frequent polling for testing
        },
        queueConfig: {
            maxWorkers: 100, // High concurrency for scale testing
            provisioned: 50,
            maxConcurrency: 500,
            batchSize: 10,
            timeout: 300,
        },
    };

    constructor(params) {
        super(params);
        this.events = {
            ...this.events,
            // Test-specific events could go here
        };
    }

    // ============================================================================
    // REQUIRED METHODS - BaseCRMIntegration Abstract Methods
    // ============================================================================

    /**
     * Fetch a page of contacts from scale-test API
     * @param {Object} params
     * @returns {Promise<{data: Array, total: number, hasMore: boolean}>}
     */
    async fetchPersonPage({
        objectType,
        page,
        limit,
        modifiedSince,
        sortDesc = true,
    }) {
        try {
            const accountId = 'scale-test-account';

            // Calculate target offset for this page
            const targetOffset = page * limit;

            // Start from beginning and paginate to the target page
            let currentOffset = 0;
            let cursor = undefined;
            let result;

            // Paginate through until we reach the target page
            while (currentOffset < targetOffset) {
                result = await this['scale-test'].api.listContacts({
                    accountId,
                    limit,
                    cursor,
                    updatedSince: modifiedSince?.toISOString(),
                });

                if (!result.nextCursor) {
                    // No more pages available
                    return {
                        data: [],
                        total: 10000,
                        hasMore: false,
                    };
                }

                cursor = result.nextCursor;
                currentOffset += limit;
            }

            // Fetch the actual target page
            result = await this['scale-test'].api.listContacts({
                accountId,
                limit,
                cursor,
                updatedSince: modifiedSince?.toISOString(),
            });

            // Transform API contacts to internal format
            const data = result.items.map((contact) =>
                this.transformApiContactToQuo(contact),
            );

            console.log(`[ScalingTest] fetchPersonPage: page=${page}, fetched ${data.length} contacts, first 3 IDs:`, data.slice(0, 3).map(c => c.id));

            return {
                data,
                total: 10000, // CONTACT_SEED_COUNT from scale-test API
                hasMore: !!result.nextCursor,
            };
        } catch (error) {
            console.error(`Error fetching ${objectType} page ${page}:`, error);
            throw error;
        }
    }

    /**
     * Fetch a page of synthetic contacts for testing
     * @param {Object} params
     * @returns {Promise<{data: Array, total: number, hasMore: boolean}>}
     */
    async fetchPersonPageWithSyntheticData({
        objectType,
        page,
        limit,
        modifiedSince,
        sortDesc = true,
    }) {
        try {
            // Generate synthetic data for testing
            const totalRecords = 10000; // Simulate 10k records for testing
            const start = page * limit;
            const end = Math.min(start + limit, totalRecords);

            const data = [];
            for (let i = start; i < end; i++) {
                data.push(this.generateSyntheticContact(i));
            }

            return {
                data,
                total: totalRecords,
                hasMore: end < totalRecords,
            };
        } catch (error) {
            console.error(`Error fetching ${objectType} page ${page}:`, error);
            throw error;
        }
    }

    /**
     * Transform synthetic contact to Quo format
     * @param {Object} contact - Synthetic contact
     * @returns {Promise<Object>} Quo contact format matching OpenAPI spec
     */
    async transformPersonToQuo(contact) {
        const quoContact = {
            externalId: String(contact.id),
            source: 'scalingtest',
            defaultFields: {
                firstName: contact.first_name,
                lastName: contact.last_name,
                company: contact.company,
                phoneNumbers: contact.phones.map((p) => ({
                    name: p.type,
                    value: p.number,
                })),
                emails: contact.emails.map((e) => ({
                    name: e.type,
                    value: e.address,
                })),
            },
            // Omit customFields - they must be pre-created in OpenPhone workspace
        };

        console.log(`[ScalingTest] transformPersonToQuo: contact.id=${contact.id} -> externalId=${quoContact.externalId}, name=${contact.first_name} ${contact.last_name}`);
        return quoContact;
    }

    /**
     * Transform scale-test API contact to internal format for Quo sync
     * @param {Object} apiContact - Contact from scale-test API {id: "uuid", email, phone, firstName, lastName, company, updatedAt, ...}
     * @returns {Object} Internal format {id: "uuid", first_name, last_name, emails, phones, ...}
     */
    transformApiContactToQuo(apiContact) {
        // Use UUID directly as the ID (no need to parse numeric IDs anymore)
        const contactId = apiContact.id;

        // Generate a batch_id based on email for grouping (since we can't use numeric division)
        const emailHash = apiContact.email.split('@')[0].charCodeAt(0) || 0;
        const batch_id = Math.floor(emailHash / 10);

        const result = {
            id: contactId,
            first_name: apiContact.firstName,
            last_name: apiContact.lastName,
            company: apiContact.company,
            emails: [
                {
                    type: 'work',
                    address: apiContact.email,
                    primary: true,
                },
            ],
            phones: [
                {
                    type: 'work',
                    number: apiContact.phone,
                    primary: true,
                },
            ],
            batch_id,
            created_at: apiContact.updatedAt,
        };

        console.log(`[ScalingTest] transformApiContactToQuo: ${apiContact.id} -> id=${contactId}, name=${apiContact.firstName} ${apiContact.lastName}`);
        return result;
    }

    /**
     * Log SMS - no-op for test integration
     */
    async logSMSToActivity(activity) {
        console.log(
            'ScalingTest: SMS logged (simulated)',
            activity.contactExternalId,
        );
    }

    /**
     * Log call - no-op for test integration
     */
    async logCallToActivity(activity) {
        console.log(
            'ScalingTest: Call logged (simulated)',
            activity.contactExternalId,
        );
    }

    /**
     * Setup webhooks - simulate webhook registration
     */
    async setupWebhooks() {
        console.log('ScalingTest: Webhooks configured (simulated)');
    }

    // ============================================================================
    // TEST HELPER METHODS
    // ============================================================================

    /**
     * Generate synthetic contact for testing
     * @param {number} index - Contact index
     * @returns {Object} Synthetic contact
     */
    generateSyntheticContact(index) {
        return {
            id: index + 1,
            first_name: `Test${index}`,
            last_name: `Contact${index}`,
            company: `Company ${Math.floor(index / 10)}`,
            emails: [
                {
                    type: 'work',
                    address: `test${index}@example.com`,
                    primary: true,
                },
            ],
            phones: [
                {
                    type: 'work',
                    // E.164 format: +1 (US country code) + 10-digit number
                    number: `+1555${String(index).padStart(7, '0')}`,
                    primary: true,
                },
            ],
            batch_id: Math.floor(index / 100),
            created_at: new Date().toISOString(),
        };
    }

    async fetchPersonById(id) {
        const contacts = await this.fetchPersonsByIds([id]);
        return contacts[0];
    }

    async fetchPersonsByIds(ids) {
        console.log(`[ScalingTest] fetchPersonsByIds: requested ${ids.length} IDs, first 5:`, ids.slice(0, 5));

        // With UUIDs, we can't calculate which page contains them
        // For scale test purposes, we'll scan pages until we find all contacts
        const pageSize = 500;
        const requestedIds = new Set(ids);
        const foundContacts = [];
        let page = 0;
        let hasMore = true;

        while (hasMore && foundContacts.length < ids.length) {
            const pageData = await this.fetchPersonPage({
                objectType: 'Contact',
                page,
                limit: pageSize,
            });

            // Filter contacts that match requested IDs
            const matches = pageData.data.filter((contact) =>
                requestedIds.has(contact.id),
            );
            foundContacts.push(...matches);

            hasMore = pageData.hasMore;
            page++;

            console.log(`[ScalingTest] fetchPersonsByIds: scanned page ${page}, found ${matches.length} matches, total ${foundContacts.length}/${ids.length}`);

            // Early exit if we found all contacts
            if (foundContacts.length >= ids.length) {
                break;
            }
        }

        console.log(`[ScalingTest] fetchPersonsByIds: completed, found ${foundContacts.length} contacts`);
        return foundContacts;
    }
}

module.exports = ScalingTestIntegration;
