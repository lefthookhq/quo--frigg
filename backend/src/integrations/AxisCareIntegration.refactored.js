const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');

/**
 * AxisCareIntegration - Refactored to extend BaseCRMIntegration
 * 
 * AxisCare-specific implementation for syncing clients/contacts with Quo.
 * AxisCare is a home care management platform, so "clients" are the person objects.
 */
class AxisCareIntegration extends BaseCRMIntegration {
    static Definition = {
        name: 'axiscare',
        version: '1.0.0',
        supportedVersions: ['1.0.0'],
        hasUserConfig: true,

        display: {
            label: 'AxisCare',
            description: 'Home care management platform integration with Quo API',
            category: 'Healthcare, CRM',
            detailsUrl: 'https://static.axiscare.com/api/documentation.html',
            icon: '',
        },
        modules: {
            axiscare: {
                definition: {
                    name: 'axiscare',
                    version: '1.0.0',
                    display: {
                        name: 'AxisCare',
                        description: 'AxisCare API',
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
                path: '/axiscare/clients',
                method: 'GET',
                event: 'LIST_AXISCARE_CLIENTS',
            },
            {
                path: '/axiscare/appointments',
                method: 'GET',
                event: 'LIST_AXISCARE_APPOINTMENTS',
            },
            {
                path: '/axiscare/services',
                method: 'GET',
                event: 'LIST_AXISCARE_SERVICES',
            },
            {
                path: '/axiscare/reports',
                method: 'GET',
                event: 'GET_AXISCARE_REPORTS',
            },
        ],
    };

    /**
     * CRM Configuration - Required by BaseCRMIntegration
     */
    static CRMConfig = {
        personObjectTypes: [
            { crmObjectName: 'Client', quoContactType: 'contact' },
        ],
        syncConfig: {
            reverseChronological: true,
            initialBatchSize: 50,
            ongoingBatchSize: 25,
            supportsWebhooks: false, // AxisCare has limited webhook support
            pollIntervalMinutes: 60,
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

        // Add existing events (backward compatibility)
        this.events = {
            ...this.events, // BaseCRMIntegration events

            // Existing AxisCare-specific events
            LIST_AXISCARE_CLIENTS: {
                handler: this.listClients,
            },
            LIST_AXISCARE_APPOINTMENTS: {
                handler: this.listAppointments,
            },
            LIST_AXISCARE_SERVICES: {
                handler: this.listServices,
            },
            GET_AXISCARE_REPORTS: {
                handler: this.getReports,
            },
        };
    }

    // ============================================================================
    // REQUIRED METHODS - BaseCRMIntegration Abstract Methods
    // ============================================================================

    /**
     * Fetch a page of clients from AxisCare
     * @param {Object} params
     * @param {string} params.objectType - CRM object type (Client)
     * @param {number} params.page - Page number (0-indexed)
     * @param {number} params.limit - Records per page
     * @param {Date} [params.modifiedSince] - Filter by modification date
     * @param {boolean} [params.sortDesc=true] - Sort descending
     * @returns {Promise<{data: Array, total: number, hasMore: boolean}>}
     */
    async fetchPersonPage({ objectType, page, limit, modifiedSince, sortDesc = true }) {
        try {
            const params = {
                page: page + 1, // AxisCare uses 1-indexed pages
                per_page: limit,
                sort_by: 'updated_at',
                sort_order: sortDesc ? 'desc' : 'asc',
            };

            // Add modification filter if provided
            if (modifiedSince) {
                params.updated_since = modifiedSince.toISOString();
            }

            const response = await this.axiscare.api.clients.getAll(params);

            return {
                data: response.clients || [],
                total: response.total_count || null,
                hasMore: response.has_more || false,
            };
        } catch (error) {
            console.error(`Error fetching ${objectType} page ${page}:`, error);
            throw error;
        }
    }

    /**
     * Transform AxisCare client object to Quo contact format
     * @param {Object} client - AxisCare client object
     * @returns {Promise<Object>} Quo contact format
     */
    async transformPersonToQuo(client) {
        // Extract phone numbers
        const phoneNumbers = [];
        if (client.phone) {
            phoneNumbers.push({ name: 'home', value: client.phone, primary: true });
        }
        if (client.mobile_phone) {
            phoneNumbers.push({ name: 'mobile', value: client.mobile_phone, primary: false });
        }
        if (client.work_phone) {
            phoneNumbers.push({ name: 'work', value: client.work_phone, primary: false });
        }

        // Extract emails
        const emails = [];
        if (client.email) {
            emails.push({ name: 'primary', value: client.email, primary: true });
        }

        return {
            externalId: String(client.id),
            source: 'axiscare',
            defaultFields: {
                firstName: client.first_name,
                lastName: client.last_name,
                company: null, // Healthcare clients typically don't have companies
                phoneNumbers,
                emails,
            },
            customFields: {
                crmId: client.id,
                crmType: 'axiscare',
                status: client.status,
                dateOfBirth: client.date_of_birth,
                address: {
                    street: client.address,
                    city: client.city,
                    state: client.state,
                    zip: client.zip_code,
                },
                emergencyContact: {
                    name: client.emergency_contact_name,
                    phone: client.emergency_contact_phone,
                },
                primaryDiagnosis: client.primary_diagnosis,
                careLevel: client.care_level,
                // AxisCare-specific fields
                clientNumber: client.client_number,
                referralSource: client.referral_source,
                admissionDate: client.admission_date,
                dischargeDate: client.discharge_date,
                lastAppointment: client.last_appointment_date,
                nextAppointment: client.next_appointment_date,
            },
        };
    }

    /**
     * Log SMS message to AxisCare as a communication record
     * @param {Object} activity - SMS activity
     * @returns {Promise<void>}
     */
    async logSMSToActivity(activity) {
        try {
            // Find the client by external ID
            const client = await this.axiscare.api.clients.get(activity.contactExternalId);
            if (!client) {
                console.warn(`Client not found for SMS logging: ${activity.contactExternalId}`);
                return;
            }

            // Create communication record in AxisCare
            const commData = {
                client_id: client.id,
                communication_type: 'sms',
                direction: activity.direction,
                content: activity.content,
                timestamp: activity.timestamp,
                created_by: 'Quo Integration',
            };

            await this.axiscare.api.communications.create(commData);
        } catch (error) {
            console.error('Failed to log SMS activity to AxisCare:', error);
            throw error;
        }
    }

    /**
     * Log phone call to AxisCare as a communication record
     * @param {Object} activity - Call activity
     * @returns {Promise<void>}
     */
    async logCallToActivity(activity) {
        try {
            // Find the client by external ID
            const client = await this.axiscare.api.clients.get(activity.contactExternalId);
            if (!client) {
                console.warn(`Client not found for call logging: ${activity.contactExternalId}`);
                return;
            }

            // Create communication record in AxisCare
            const commData = {
                client_id: client.id,
                communication_type: 'call',
                direction: activity.direction,
                content: activity.summary || 'Phone call',
                duration: activity.duration,
                timestamp: activity.timestamp,
                created_by: 'Quo Integration',
            };

            await this.axiscare.api.communications.create(commData);
        } catch (error) {
            console.error('Failed to log call activity to AxisCare:', error);
            throw error;
        }
    }

    /**
     * Setup webhooks with AxisCare
     * @returns {Promise<void>}
     */
    async setupWebhooks() {
        // AxisCare has limited webhook support, use polling fallback
        console.log('AxisCare webhooks not configured - using polling fallback');
    }

    // ============================================================================
    // OPTIONAL HELPER METHODS
    // ============================================================================

    /**
     * Fetch a single client by ID
     * @param {string} id - Client ID
     * @returns {Promise<Object>}
     */
    async fetchPersonById(id) {
        return await this.axiscare.api.clients.get(id);
    }

    /**
     * Fetch multiple clients by IDs (for webhook batch processing)
     * @param {string[]} ids - Array of client IDs
     * @returns {Promise<Object[]>}
     */
    async fetchPersonsByIds(ids) {
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

    // ============================================================================
    // EXISTING METHODS - Backward Compatibility
    // ============================================================================

    async listClients({ req, res }) {
        try {
            const params = {
                page: req.query.page ? parseInt(req.query.page) : 1,
                per_page: req.query.per_page ? parseInt(req.query.per_page) : 50,
                sort_by: req.query.sort_by || 'updated_at',
                sort_order: req.query.sort_order || 'desc',
            };

            const clients = await this.axiscare.api.clients.getAll(params);
            res.json(clients);
        } catch (error) {
            console.error('Failed to list AxisCare clients:', error);
            res.status(500).json({
                error: 'Failed to list clients',
                details: error.message,
            });
        }
    }

    async listAppointments({ req, res }) {
        try {
            const params = {
                page: req.query.page ? parseInt(req.query.page) : 1,
                per_page: req.query.per_page ? parseInt(req.query.per_page) : 50,
                start_date: req.query.start_date,
                end_date: req.query.end_date,
            };

            const appointments = await this.axiscare.api.appointments.getAll(params);
            res.json(appointments);
        } catch (error) {
            console.error('Failed to list AxisCare appointments:', error);
            res.status(500).json({
                error: 'Failed to list appointments',
                details: error.message,
            });
        }
    }

    async listServices({ req, res }) {
        try {
            const services = await this.axiscare.api.services.getAll();
            res.json(services);
        } catch (error) {
            console.error('Failed to list AxisCare services:', error);
            res.status(500).json({
                error: 'Failed to list services',
                details: error.message,
            });
        }
    }

    async getReports({ req, res }) {
        try {
            const { report_type, start_date, end_date } = req.query;

            if (!report_type) {
                return res.status(400).json({
                    error: 'report_type is required',
                });
            }

            const report = await this.axiscare.api.reports.get({
                type: report_type,
                start_date,
                end_date,
            });

            res.json(report);
        } catch (error) {
            console.error('Failed to get AxisCare report:', error);
            res.status(500).json({
                error: 'Failed to get report',
                details: error.message,
            });
        }
    }
}

module.exports = AxisCareIntegration;

