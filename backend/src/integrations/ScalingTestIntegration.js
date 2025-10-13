const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');
const { Definition: QuoDefinition } = require('../api-modules/quo/definition');
const crmScaleTest = require('@friggframework/api-module-frigg-scale-test');

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
     * Fetch a page of synthetic contacts for testing
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
     * @returns {Promise<Object>} Quo contact format
     */
    async transformPersonToQuo(contact) {
        return {
            externalId: String(contact.id),
            source: 'scalingtest',
            defaultFields: {
                firstName: contact.first_name,
                lastName: contact.last_name,
                company: contact.company,
                phoneNumbers: contact.phones.map((p) => ({
                    name: p.type,
                    value: p.number,
                    primary: p.primary,
                })),
                emails: contact.emails.map((e) => ({
                    name: e.type,
                    value: e.address,
                    primary: e.primary,
                })),
            },
            customFields: {
                crmId: contact.id,
                crmType: 'scalingtest',
                testBatch: contact.batch_id,
                generatedAt: contact.created_at,
            },
        };
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
                    number: `555-${String(index).padStart(4, '0')}`,
                    primary: true,
                },
            ],
            batch_id: Math.floor(index / 100),
            created_at: new Date().toISOString(),
        };
    }

    async fetchPersonById(id) {
        return this.generateSyntheticContact(parseInt(id) - 1);
    }

    async fetchPersonsByIds(ids) {
        return ids.map((id) => this.generateSyntheticContact(parseInt(id) - 1));
    }
}

module.exports = ScalingTestIntegration;
