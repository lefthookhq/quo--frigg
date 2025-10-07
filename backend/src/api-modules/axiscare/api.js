const axios = require('axios');
const { get } = require('@friggframework/core');

class AxisCareAPI {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl || 'https://static.axiscare.com/api';
        this.apiKey = options.apiKey;
        this.headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        };

        if (this.apiKey) {
            this.headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
    }

    setApiKey(apiKey) {
        this.apiKey = apiKey;
        this.headers['Authorization'] = `Bearer ${apiKey}`;
    }

    async makeRequest(method, endpoint, data = null) {
        try {
            const config = {
                method,
                url: `${this.baseUrl}${endpoint}`,
                headers: this.headers,
            };

            if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
                config.data = data;
            }

            const response = await axios(config);
            return response.data;
        } catch (error) {
            if (error.response) {
                throw new Error(`AxisCare API Error: ${error.response.status} - ${error.response.data?.message || error.response.statusText}`);
            } else if (error.request) {
                throw new Error('AxisCare API Error: No response received');
            } else {
                throw new Error(`AxisCare API Error: ${error.message}`);
            }
        }
    }

    // Health check endpoint
    async healthCheck() {
        return this.makeRequest('GET', '/health');
    }

    // Documentation endpoint
    async getDocumentation() {
        return this.makeRequest('GET', '/documentation');
    }

    // Authentication methods
    async authenticate(credentials) {
        const authData = await this.makeRequest('POST', '/auth', {
            email: credentials.email,
            password: credentials.password,
        });

        if (authData.token) {
            this.setApiKey(authData.token);
        }

        return authData;
    }

    // User management
    async getCurrentUser() {
        return this.makeRequest('GET', '/user/current');
    }

    async getUserById(userId) {
        return this.makeRequest('GET', `/user/${userId}`);
    }

    async listUsers(params = {}) {
        const queryParams = new URLSearchParams();

        if (params.page) queryParams.append('page', params.page);
        if (params.limit) queryParams.append('limit', params.limit);
        if (params.search) queryParams.append('search', params.search);
        if (params.status) queryParams.append('status', params.status);

        const endpoint = `/users${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
        return this.makeRequest('GET', endpoint);
    }

    async createUser(userData) {
        return this.makeRequest('POST', '/users', userData);
    }

    async updateUser(userId, userData) {
        return this.makeRequest('PUT', `/users/${userId}`, userData);
    }

    async deleteUser(userId) {
        return this.makeRequest('DELETE', `/users/${userId}`);
    }

    // Client management
    async listClients(params = {}) {
        const queryParams = new URLSearchParams();

        if (params.page) queryParams.append('page', params.page);
        if (params.limit) queryParams.append('limit', params.limit);
        if (params.search) queryParams.append('search', params.search);
        if (params.status) queryParams.append('status', params.status);

        const endpoint = `/clients${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
        return this.makeRequest('GET', endpoint);
    }

    async getClientById(clientId) {
        return this.makeRequest('GET', `/clients/${clientId}`);
    }

    async createClient(clientData) {
        return this.makeRequest('POST', '/clients', clientData);
    }

    async updateClient(clientId, clientData) {
        return this.makeRequest('PUT', `/clients/${clientId}`, clientData);
    }

    async deleteClient(clientId) {
        return this.makeRequest('DELETE', `/clients/${clientId}`);
    }

    // Contact management
    async listContacts(params = {}) {
        const queryParams = new URLSearchParams();

        if (params.page) queryParams.append('page', params.page);
        if (params.limit) queryParams.append('limit', params.limit);
        if (params.search) queryParams.append('search', params.search);

        const endpoint = `/contacts${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
        return this.makeRequest('GET', endpoint);
    }

    async getContactById(contactId) {
        return this.makeRequest('GET', `/contacts/${contactId}`);
    }

    async createContact(contactData) {
        return this.makeRequest('POST', '/contacts', contactData);
    }

    async updateContact(contactId, contactData) {
        return this.makeRequest('PUT', `/contacts/${contactId}`, contactData);
    }

    async deleteContact(contactId) {
        return this.makeRequest('DELETE', `/contacts/${contactId}`);
    }

    // Appointment management
    async listAppointments(params = {}) {
        const queryParams = new URLSearchParams();

        if (params.page) queryParams.append('page', params.page);
        if (params.limit) queryParams.append('limit', params.limit);
        if (params.date_from) queryParams.append('date_from', params.date_from);
        if (params.date_to) queryParams.append('date_to', params.date_to);
        if (params.client_id) queryParams.append('client_id', params.client_id);

        const endpoint = `/appointments${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
        return this.makeRequest('GET', endpoint);
    }

    async getAppointmentById(appointmentId) {
        return this.makeRequest('GET', `/appointments/${appointmentId}`);
    }

    async createAppointment(appointmentData) {
        return this.makeRequest('POST', '/appointments', appointmentData);
    }

    async updateAppointment(appointmentId, appointmentData) {
        return this.makeRequest('PUT', `/appointments/${appointmentId}`, appointmentData);
    }

    async deleteAppointment(appointmentId) {
        return this.makeRequest('DELETE', `/appointments/${appointmentId}`);
    }

    // Service management
    async listServices(params = {}) {
        const queryParams = new URLSearchParams();

        if (params.page) queryParams.append('page', params.page);
        if (params.limit) queryParams.append('limit', params.limit);
        if (params.category) queryParams.append('category', params.category);

        const endpoint = `/services${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
        return this.makeRequest('GET', endpoint);
    }

    async getServiceById(serviceId) {
        return this.makeRequest('GET', `/services/${serviceId}`);
    }

    // Billing and invoicing
    async listInvoices(params = {}) {
        const queryParams = new URLSearchParams();

        if (params.page) queryParams.append('page', params.page);
        if (params.limit) queryParams.append('limit', params.limit);
        if (params.client_id) queryParams.append('client_id', params.client_id);
        if (params.status) queryParams.append('status', params.status);

        const endpoint = `/invoices${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
        return this.makeRequest('GET', endpoint);
    }

    async getInvoiceById(invoiceId) {
        return this.makeRequest('GET', `/invoices/${invoiceId}`);
    }

    async createInvoice(invoiceData) {
        return this.makeRequest('POST', '/invoices', invoiceData);
    }

    // Reports and analytics
    async getReports(reportType, params = {}) {
        const queryParams = new URLSearchParams();

        if (params.date_from) queryParams.append('date_from', params.date_from);
        if (params.date_to) queryParams.append('date_to', params.date_to);
        if (params.format) queryParams.append('format', params.format);

        const endpoint = `/reports/${reportType}${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
        return this.makeRequest('GET', endpoint);
    }

    async getAnalytics(params = {}) {
        const queryParams = new URLSearchParams();

        if (params.period) queryParams.append('period', params.period);
        if (params.metric) queryParams.append('metric', params.metric);

        const endpoint = `/analytics${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
        return this.makeRequest('GET', endpoint);
    }
}

module.exports = AxisCareAPI;
