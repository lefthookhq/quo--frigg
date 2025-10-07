const { IntegrationBase } = require('@friggframework/core');
const axiscare = require('../api-modules/axiscare');

class AxisCareIntegration extends IntegrationBase {
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
                definition: axiscare.Definition,
            },
            quo: {
                definition: require('../api-modules/quo').Definition,
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

    constructor() {
        super();
        this.events = {
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
            SYNC_CLIENTS_TO_QUO: {
                type: 'USER_ACTION',
                handler: this.syncClientsToQuo,
                title: 'Sync Clients to Quo',
                description: 'Synchronize AxisCare clients with Quo CRM',
                userActionType: 'DATA',
            },
            SYNC_APPOINTMENTS_TO_QUO: {
                type: 'USER_ACTION',
                handler: this.syncAppointmentsToQuo,
                title: 'Sync Appointments to Quo',
                description: 'Synchronize AxisCare appointments with Quo calendar',
                userActionType: 'DATA',
            },
            CREATE_DUMMY_AXISCARE_DATA: {
                type: 'USER_ACTION',
                handler: this.createDummyData,
                title: 'Create Dummy AxisCare Data',
                description: 'Create sample clients and appointments for testing',
                userActionType: 'TEST',
            },
            GET_AXISCARE_ANALYTICS: {
                type: 'USER_ACTION',
                handler: this.getAnalytics,
                title: 'Get AxisCare Analytics',
                description: 'Retrieve analytics and performance metrics from AxisCare',
                userActionType: 'REPORT',
            },
        };
    }

    async listClients({ req, res }) {
        try {
            const params = {
                page: req.query.page ? parseInt(req.query.page) : 1,
                limit: req.query.limit ? parseInt(req.query.limit) : 50,
                search: req.query.search,
                status: req.query.status,
            };

            const clients = await this.axiscare.api.listClients(params);
            res.json(clients);
        } catch (error) {
            console.error('Failed to list AxisCare clients:', error);
            res.status(500).json({ error: 'Failed to list clients', details: error.message });
        }
    }

    async listAppointments({ req, res }) {
        try {
            const params = {
                page: req.query.page ? parseInt(req.query.page) : 1,
                limit: req.query.limit ? parseInt(req.query.limit) : 50,
                date_from: req.query.date_from,
                date_to: req.query.date_to,
                client_id: req.query.client_id,
            };

            const appointments = await this.axiscare.api.listAppointments(params);
            res.json(appointments);
        } catch (error) {
            console.error('Failed to list AxisCare appointments:', error);
            res.status(500).json({ error: 'Failed to list appointments', details: error.message });
        }
    }

    async listServices({ req, res }) {
        try {
            const params = {
                page: req.query.page ? parseInt(req.query.page) : 1,
                limit: req.query.limit ? parseInt(req.query.limit) : 50,
                category: req.query.category,
            };

            const services = await this.axiscare.api.listServices(params);
            res.json(services);
        } catch (error) {
            console.error('Failed to list AxisCare services:', error);
            res.status(500).json({ error: 'Failed to list services', details: error.message });
        }
    }

    async getReports({ req, res }) {
        try {
            const reportType = req.query.type || 'summary';
            const params = {
                date_from: req.query.date_from,
                date_to: req.query.date_to,
                format: req.query.format || 'json',
            };

            const reports = await this.axiscare.api.getReports(reportType, params);
            res.json(reports);
        } catch (error) {
            console.error('Failed to get AxisCare reports:', error);
            res.status(500).json({ error: 'Failed to get reports', details: error.message });
        }
    }

    async syncClientsToQuo(args) {
        try {
            // Get clients from AxisCare
            const axiscareClients = await this.axiscare.api.listClients({
                limit: args.limit || 50,
                status: args.status,
            });

            const syncResults = [];

            for (const client of axiscareClients.clients?.slice(0, args.maxClients || 10) || []) {
                try {
                    // Transform client data for Quo
                    const quoClientData = await this.transformClientForQuo(client);

                    // Create or update in Quo if available
                    let quoResult = null;
                    if (this.quo?.api) {
                        quoResult = await this.createQuoClient(quoClientData);
                    }

                    syncResults.push({
                        axisCareClient: {
                            id: client.id,
                            name: client.name || `${client.first_name} ${client.last_name}`,
                            email: client.email,
                            phone: client.phone,
                            status: client.status,
                        },
                        quoClient: quoResult,
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
                        summary[result.syncStatus] = (summary[result.syncStatus] || 0) + 1;
                        return summary;
                    }, {}),
                    syncResults,
                    timestamp: new Date().toISOString(),
                }
            };
        } catch (error) {
            console.error('Client sync failed:', error);
            throw new Error(`Client sync failed: ${error.message}`);
        }
    }

    async syncAppointmentsToQuo(args) {
        try {
            // Get appointments from AxisCare
            const axiscareAppointments = await this.axiscare.api.listAppointments({
                limit: args.limit || 50,
                date_from: args.date_from,
                date_to: args.date_to,
            });

            const syncResults = [];

            for (const appointment of axiscareAppointments.appointments?.slice(0, args.maxAppointments || 10) || []) {
                try {
                    // Transform appointment data for Quo
                    const quoAppointmentData = await this.transformAppointmentForQuo(appointment);

                    // Create or update in Quo if available
                    let quoResult = null;
                    if (this.quo?.api) {
                        quoResult = await this.createQuoEvent(quoAppointmentData);
                    }

                    syncResults.push({
                        axisCareAppointment: {
                            id: appointment.id,
                            title: appointment.title || appointment.description,
                            start_time: appointment.start_time,
                            end_time: appointment.end_time,
                            client_id: appointment.client_id,
                            status: appointment.status,
                        },
                        quoEvent: quoResult,
                        syncStatus: quoResult ? 'success' : 'quo_unavailable',
                        timestamp: new Date().toISOString(),
                    });
                } catch (appointmentError) {
                    syncResults.push({
                        axisCareAppointment: appointment,
                        error: appointmentError.message,
                        syncStatus: 'error',
                        timestamp: new Date().toISOString(),
                    });
                }
            }

            return {
                label: 'Appointment Sync Results',
                data: {
                    totalAppointmentsProcessed: syncResults.length,
                    syncSummary: syncResults.reduce((summary, result) => {
                        summary[result.syncStatus] = (summary[result.syncStatus] || 0) + 1;
                        return summary;
                    }, {}),
                    syncResults,
                    timestamp: new Date().toISOString(),
                }
            };
        } catch (error) {
            console.error('Appointment sync failed:', error);
            throw new Error(`Appointment sync failed: ${error.message}`);
        }
    }

    async createDummyData(args) {
        try {
            const dummyData = {
                clients: [],
                appointments: [],
            };

            // Create dummy clients
            for (let i = 1; i <= (args.clientCount || 3); i++) {
                try {
                    const dummyClient = {
                        first_name: `Client ${i}`,
                        last_name: 'Test',
                        email: `client${i}@test.com`,
                        phone: `555-000${i.toString().padStart(4, '0')}`,
                        address: `${i} Test Street, Test City`,
                        date_of_birth: '1980-01-01',
                        status: 'active',
                    };

                    const createdClient = await this.axiscare.api.createClient(dummyClient);
                    dummyData.clients.push(createdClient);

                    // Create dummy appointments for this client
                    for (let j = 1; j <= (args.appointmentCountPerClient || 2); j++) {
                        const dummyAppointment = {
                            client_id: createdClient.id || createdClient.client_id,
                            title: `Appointment ${j}`,
                            description: `Test appointment ${j} for client ${i}`,
                            start_time: new Date(Date.now() + (j * 24 * 60 * 60 * 1000)).toISOString(),
                            end_time: new Date(Date.now() + (j * 24 * 60 * 60 * 1000 + 60 * 60 * 1000)).toISOString(),
                            service_type: 'Home Visit',
                            status: 'scheduled',
                        };

                        const createdAppointment = await this.axiscare.api.createAppointment(dummyAppointment);
                        dummyData.appointments.push(createdAppointment);
                    }
                } catch (error) {
                    console.warn(`Failed to create dummy client ${i}:`, error.message);
                }
            }

            return {
                label: 'Dummy Data Created',
                data: {
                    summary: {
                        clientsCreated: dummyData.clients.length,
                        appointmentsCreated: dummyData.appointments.length,
                    },
                    dummyData,
                    timestamp: new Date().toISOString(),
                }
            };
        } catch (error) {
            console.error('Failed to create dummy data:', error);
            throw new Error(`Failed to create dummy data: ${error.message}`);
        }
    }

    async getAnalytics(args) {
        try {
            const params = {
                period: args.period || 'month',
                metric: args.metric || 'all',
            };

            const analytics = await this.axiscare.api.getAnalytics(params);

            // Generate additional summary statistics
            const summary = {
                totalClients: analytics.clients?.total || 0,
                activeClients: analytics.clients?.active || 0,
                totalAppointments: analytics.appointments?.total || 0,
                completedAppointments: analytics.appointments?.completed || 0,
                upcomingAppointments: analytics.appointments?.upcoming || 0,
                averageRating: analytics.ratings?.average || 0,
                revenue: analytics.revenue?.total || 0,
            };

            return {
                label: 'AxisCare Analytics',
                data: {
                    summary,
                    analytics,
                    timestamp: new Date().toISOString(),
                }
            };
        } catch (error) {
            console.error('Failed to get analytics:', error);
            throw new Error(`Failed to get analytics: ${error.message}`);
        }
    }

    async transformClientForQuo(axisCareClient) {
        return {
            name: axisCareClient.name || `${axisCareClient.first_name} ${axisCareClient.last_name}`,
            email: axisCareClient.email,
            phone: axisCareClient.phone,
            address: axisCareClient.address,
            status: axisCareClient.status,
            customFields: {
                axisCareId: axisCareClient.id,
                dateOfBirth: axisCareClient.date_of_birth,
                source: 'AxisCare',
            },
        };
    }

    async transformAppointmentForQuo(axisCareAppointment) {
        return {
            title: axisCareAppointment.title || axisCareAppointment.description,
            startTime: axisCareAppointment.start_time,
            endTime: axisCareAppointment.end_time,
            description: axisCareAppointment.description,
            status: axisCareAppointment.status,
            customFields: {
                axisCareAppointmentId: axisCareAppointment.id,
                clientId: axisCareAppointment.client_id,
                serviceType: axisCareAppointment.service_type,
                source: 'AxisCare',
            },
        };
    }

    async createQuoClient(clientData) {
        // Placeholder for creating client in Quo
        // Implement specific Quo API calls based on Quo's client creation endpoints
        if (!this.quo?.api) {
            return { message: 'Quo API not available', status: 'simulated' };
        }

        try {
            const quoClient = await this.quo.api.createClient(clientData);
            return {
                quoId: quoClient.id || quoClient.client_id,
                name: clientData.name,
                email: clientData.email,
                status: 'created',
            };
        } catch (error) {
            throw new Error(`Failed to create Quo client: ${error.message}`);
        }
    }

    async createQuoEvent(appointmentData) {
        // Placeholder for creating event in Quo
        // Implement specific Quo API calls based on Quo's event/calendar endpoints
        if (!this.quo?.api) {
            return { message: 'Quo API not available', status: 'simulated' };
        }

        try {
            const quoEvent = await this.quo.api.createEvent(appointmentData);
            return {
                quoId: quoEvent.id || quoEvent.event_id,
                title: appointmentData.title,
                startTime: appointmentData.startTime,
                status: 'created',
            };
        } catch (error) {
            throw new Error(`Failed to create Quo event: ${error.message}`);
        }
    }

    async onCreate(params) {
        this.record.status = 'ENABLED';
        await this.record.save();
        return this.record;
    }

    async onUpdate(params) {
        await this.record.save();
        return this.validateConfig();
    }

    async getConfigOptions() {
        return {
            syncInterval: {
                type: 'number',
                title: 'Sync Interval (minutes)',
                description: 'How often to sync data between AxisCare and Quo',
                default: 60,
                minimum: 5,
                maximum: 1440,
            },
            maxClientsPerSync: {
                type: 'number',
                title: 'Max Clients per Sync',
                description: 'Maximum number of clients to sync in one operation',
                default: 50,
                minimum: 1,
                maximum: 1000,
            },
            maxAppointmentsPerSync: {
                type: 'number',
                title: 'Max Appointments per Sync',
                description: 'Maximum number of appointments to sync in one operation',
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
                                description: 'Maximum clients to retrieve for sync',
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
                                description: 'Only sync clients with this status',
                                enum: ['active', 'inactive', 'pending', 'archived'],
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
            case 'SYNC_APPOINTMENTS_TO_QUO':
                return {
                    jsonSchema: {
                        type: 'object',
                        properties: {
                            limit: {
                                type: 'number',
                                title: 'Appointment Limit',
                                description: 'Maximum appointments to retrieve for sync',
                                minimum: 1,
                                maximum: 1000,
                                default: 50,
                            },
                            maxAppointments: {
                                type: 'number',
                                title: 'Max Appointments to Sync',
                                description: 'Maximum appointments to actually sync',
                                minimum: 1,
                                maximum: 100,
                                default: 10,
                            },
                            date_from: {
                                type: 'string',
                                title: 'Start Date',
                                description: 'Only sync appointments from this date',
                                format: 'date',
                            },
                            date_to: {
                                type: 'string',
                                title: 'End Date',
                                description: 'Only sync appointments until this date',
                                format: 'date',
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
                                scope: '#/properties/maxAppointments',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/date_from',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/date_to',
                            },
                        ],
                    },
                };
            case 'CREATE_DUMMY_AXISCARE_DATA':
                return {
                    jsonSchema: {
                        type: 'object',
                        properties: {
                            clientCount: {
                                type: 'number',
                                title: 'Number of Clients',
                                description: 'How many dummy clients to create',
                                minimum: 1,
                                maximum: 10,
                                default: 3,
                            },
                            appointmentCountPerClient: {
                                type: 'number',
                                title: 'Appointments per Client',
                                description: 'How many appointments to create per client',
                                minimum: 1,
                                maximum: 5,
                                default: 2,
                            },
                        },
                        required: [],
                    },
                    uiSchema: {
                        type: 'VerticalLayout',
                        elements: [
                            {
                                type: 'Control',
                                scope: '#/properties/clientCount',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/appointmentCountPerClient',
                            },
                        ],
                    },
                };
            case 'GET_AXISCARE_ANALYTICS':
                return {
                    jsonSchema: {
                        type: 'object',
                        properties: {
                            period: {
                                type: 'string',
                                title: 'Analytics Period',
                                description: 'Time period for analytics',
                                enum: ['day', 'week', 'month', 'quarter', 'year'],
                                default: 'month',
                            },
                            metric: {
                                type: 'string',
                                title: 'Metric Focus',
                                description: 'Specific metric to focus on',
                                enum: ['all', 'clients', 'appointments', 'revenue', 'ratings'],
                                default: 'all',
                            },
                        },
                        required: [],
                    },
                    uiSchema: {
                        type: 'VerticalLayout',
                        elements: [
                            {
                                type: 'Control',
                                scope: '#/properties/period',
                            },
                            {
                                type: 'Control',
                                scope: '#/properties/metric',
                            },
                        ],
                    },
                };
        }
        return null;
    }
}

module.exports = AxisCareIntegration;
