const { ApiKeyRequester } = require('@friggframework/core');

/**
 * @typedef {Object} Address
 * @property {string} name - Name associated with the address
 * @property {string} streetAddress1 - Street address line 1
 * @property {string|null} [streetAddress2] - Street address line 2
 * @property {string} city - City name
 * @property {string} state - Two-letter state code (e.g., "WI", "CA")
 * @property {string} postalCode - Postal/ZIP code
 * @property {string|null} [latitude] - Geographic latitude
 * @property {string|null} [longitude] - Geographic longitude
 */

/**
 * @typedef {Object} ResponsibleParty
 * @property {string} listNumber - Position number (1=Primary, 2=Secondary, 3=Tertiary)
 * @property {string} name - Full name of the responsible party
 * @property {string} relationship - Relationship to the client/lead
 * @property {string} email - Email address
 * @property {string} dateOfBirth - Date of birth (YYYY-MM-DD)
 * @property {string} hipaaDisclosureAuthorization - HIPAA authorization ('0' or '1')
 * @property {string} canMakeMedicalDecisions - Medical decision authority ('0' or '1')
 * @property {Object} address - Address information
 * @property {Array<{type: string, number: string}>} phones - Phone numbers
 */

class Api extends ApiKeyRequester {
    static API_KEY_VERSION = '2023-10-01';

    constructor(params = {}) {
        super(params);

        this.siteNumber = params.siteNumber;
        // Build baseUrl dynamically using siteNumber
        if (this.siteNumber) {
            this.baseUrl = `https://${this.siteNumber}.axiscare.com`;
        }

        this.api_key_name = 'Authorization';
        this.API_KEY_VALUE = `Bearer ${params.api_key}`;
        // Get API key from params
        if (params.api_key) {
            this.setApiKey(params.api_key);
        }
    }

    /**
     * Override setApiKey to properly format the Authorization header with Bearer token
     * Handles both raw API keys and keys already prefixed with "Bearer "
     * @param {string} apiKey - The API key (with or without Bearer prefix)
     */
    setApiKey(apiKey) {
        if (apiKey && apiKey.startsWith('Bearer ')) {
            this.api_key = apiKey;
        } else {
            this.api_key = `Bearer ${apiKey}`;
        }
    }

    /**
     * Sets the site number and updates the base URL
     * @param {string} siteNumber - The AxisCare site number (e.g., 'agency123')
     */
    setSiteNumber(siteNumber) {
        if (!siteNumber) {
            throw new Error('Site number is required for AxisCare API');
        }

        this.siteNumber = siteNumber;
        this.baseUrl = `https://${siteNumber}.axiscare.com`;
    }

    // ==================== CLIENT ENDPOINTS ====================

    /**
     * List clients with optional filtering
     * @param {Object} [params] - Query parameters
     * @param {string} [params.clientIds] - Comma-delimited client IDs
     * @param {string} [params.statuses] - Comma-delimited statuses
     * @param {string} [params.regionIds] - Comma-delimited region IDs
     * @param {string} [params.regionNames] - Comma-delimited region names
     * @param {string} [params.classCodes] - Comma-delimited class codes
     * @param {string} [params.classLabels] - Comma-delimited class labels
     * @param {string} [params.adminIds] - Comma-delimited administrator IDs
     * @param {string} [params.adminUsernames] - Comma-delimited administrator usernames
     * @param {string} [params.externalIds] - Comma-delimited external IDs
     * @param {number} [params.startAfterId] - Pagination cursor
     * @param {number} [params.limit=100] - Results limit (max: 500)
     * @param {string} [params.requestedSensitiveFields] - Comma-delimited sensitive fields (e.g., 'ssn')
     * @returns {Promise<Object>} Response with results.clients array and nextPage URL
     */
    async listClients(params = {}) {
        const options = {
            url: `${this.baseUrl}/api/clients`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
            query: params,
        };
        return this._get(options);
    }

    /**
     * Create a new client
     * @param {Object} clientData - Client data
     * @param {string} clientData.firstName - Client's first name (required)
     * @param {string} clientData.lastName - Client's last name (required)
     * @param {string} [clientData.status] - Status (defaults to 'Active')
     * @param {string} [clientData.dateOfBirth] - Date of birth (YYYY-MM-DD)
     * @param {string} [clientData.ssn] - Social Security Number
     * @param {Address} [clientData.residentialAddress] - Residential address
     * @param {string} [clientData.personalEmail] - Email address
     * @param {string} [clientData.homePhone] - Home phone number
     * @param {string} [clientData.mobilePhone] - Mobile phone number
     * @returns {Promise<Object>} Created client object
     */
    async createClient(clientData) {
        const options = {
            url: `${this.baseUrl}/api/clients`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
            body: clientData,
        };
        return this._post(options);
    }

    /**
     * Get a single client by ID
     * @param {number} clientId - Client ID
     * @param {Object} [params] - Query parameters
     * @param {string} [params.requestedSensitiveFields] - Comma-delimited sensitive fields (e.g., 'ssn')
     * @returns {Promise<Object>} Client object
     */
    async getClient(clientId, params = {}) {
        const options = {
            url: `${this.baseUrl}/api/clients/${clientId}`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
            query: params,
        };
        return this._get(options);
    }

    /**
     * Update an existing client
     * @param {number} clientId - Client ID
     * @param {Object} clientData - Partial client data to update
     * @returns {Promise<Object>} Updated client object
     */
    async updateClient(clientId, clientData) {
        const options = {
            url: `${this.baseUrl}/api/clients/${clientId}`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
            body: clientData,
        };
        return this._patch(options);
    }

    /**
     * List all responsible parties for a client (always returns exactly 3)
     * @param {number} clientId - Client ID
     * @returns {Promise<{results: ResponsibleParty[], errors: Array|null}>} Array of 3 responsible parties
     */
    async listClientResponsibleParties(clientId) {
        const options = {
            url: `${this.baseUrl}/api/clients/${clientId}/responsibleParties`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
        };
        return this._get(options);
    }

    /**
     * Get a single responsible party for a client
     * @param {number} clientId - Client ID
     * @param {number} listNumber - Position number (1=Primary, 2=Secondary, 3=Tertiary)
     * @returns {Promise<{results: ResponsibleParty, errors: Array|null}>} Responsible party object
     */
    async getClientResponsibleParty(clientId, listNumber) {
        const options = {
            url: `${this.baseUrl}/api/clients/${clientId}/responsibleParties/${listNumber}`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
        };
        return this._get(options);
    }

    /**
     * Update a responsible party for a client
     * @param {number} clientId - Client ID
     * @param {number} listNumber - Position number (1=Primary, 2=Secondary, 3=Tertiary)
     * @param {Object} data - Responsible party data
     * @param {string} data.name - Full name (required)
     * @param {string} [data.relationship] - Relationship to client
     * @param {Object} [data.address] - Address object
     * @param {Array<{type: string, number: string}>} [data.phones] - Phone numbers
     * @param {string} [data.email] - Email address
     * @param {string} [data.dateOfBirth] - Date of birth (YYYY-MM-DD)
     * @param {boolean} [data.hipaaDisclosureAuthorization] - HIPAA authorization
     * @param {boolean} [data.canMakeMedicalDecisions] - Medical decision authority
     * @returns {Promise<{results: ResponsibleParty[], errors: Array|null}>} All 3 responsible parties after update
     */
    async updateClientResponsibleParty(clientId, listNumber, data) {
        const options = {
            url: `${this.baseUrl}/api/clients/${clientId}/responsibleParties/${listNumber}`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
            body: data,
        };
        return this._put(options);
    }

    // ==================== LEAD ENDPOINTS ====================

    /**
     * List leads with optional filtering
     * @param {Object} [params] - Query parameters
     * @param {string} [params.leadIds] - Comma-delimited lead IDs
     * @param {string} [params.statuses] - Comma-delimited statuses
     * @param {string} [params.regionIds] - Comma-delimited region IDs
     * @param {string} [params.adminIds] - Comma-delimited administrator IDs
     * @param {string} [params.externalIds] - Comma-delimited external IDs
     * @param {number} [params.startAfterId] - Pagination cursor
     * @param {number} [params.limit=100] - Results limit (max: 500)
     * @returns {Promise<Object>} Response with results.leads array and nextPage URL
     */
    async listLeads(params = {}) {
        const options = {
            url: `${this.baseUrl}/api/leads`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
            query: params,
        };
        return this._get(options);
    }

    /**
     * Create a new lead
     * @param {Object} leadData - Lead data
     * @param {string} leadData.firstName - Lead's first name (required)
     * @param {string} leadData.lastName - Lead's last name (required)
     * @param {string} [leadData.status] - Status (defaults to 'Active')
     * @param {string} [leadData.dateOfBirth] - Date of birth (YYYY-MM-DD)
     * @param {string} [leadData.assessmentDate] - Assessment date (YYYY-MM-DD)
     * @param {Address} [leadData.residentialAddress] - Residential address
     * @param {string} [leadData.personalEmail] - Email address
     * @param {string} [leadData.homePhone] - Home phone number
     * @param {string} [leadData.mobilePhone] - Mobile phone number
     * @returns {Promise<Object>} Created lead object
     */
    async createLead(leadData) {
        const options = {
            url: `${this.baseUrl}/api/leads`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
            body: leadData,
        };
        return this._post(options);
    }

    /**
     * Get a single lead by ID
     * @param {number} leadId - Lead ID
     * @returns {Promise<Object>} Lead object
     */
    async getLead(leadId) {
        const options = {
            url: `${this.baseUrl}/api/leads/${leadId}`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
        };
        return this._get(options);
    }

    /**
     * Update an existing lead
     * @param {number} leadId - Lead ID
     * @param {Object} leadData - Partial lead data to update (must include both firstName and lastName if updating names)
     * @returns {Promise<Object>} Updated lead object
     */
    async updateLead(leadId, leadData) {
        const options = {
            url: `${this.baseUrl}/api/leads/${leadId}`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
            body: leadData,
        };
        return this._patch(options);
    }

    /**
     * List all responsible parties for a lead (always returns exactly 3)
     * @param {number} leadId - Lead ID
     * @returns {Promise<{results: ResponsibleParty[], errors: Array|null}>} Array of 3 responsible parties
     */
    async listLeadResponsibleParties(leadId) {
        const options = {
            url: `${this.baseUrl}/api/leads/${leadId}/responsibleParties`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
        };
        return this._get(options);
    }

    /**
     * Get a single responsible party for a lead
     * @param {number} leadId - Lead ID
     * @param {number} listNumber - Position number (1=Primary, 2=Secondary, 3=Tertiary)
     * @returns {Promise<{results: ResponsibleParty, errors: Array|null}>} Responsible party object
     */
    async getLeadResponsibleParty(leadId, listNumber) {
        const options = {
            url: `${this.baseUrl}/api/leads/${leadId}/responsibleParties/${listNumber}`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
        };
        return this._get(options);
    }

    /**
     * Update a responsible party for a lead
     * @param {number} leadId - Lead ID
     * @param {number} listNumber - Position number (1=Primary, 2=Secondary, 3=Tertiary)
     * @param {Object} data - Responsible party data
     * @param {string} data.name - Full name (required)
     * @returns {Promise<{results: ResponsibleParty[], errors: Array|null}>} All 3 responsible parties after update
     */
    async updateLeadResponsibleParty(leadId, listNumber, data) {
        const options = {
            url: `${this.baseUrl}/api/leads/${leadId}/responsibleParties/${listNumber}`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
            body: data,
        };
        return this._put(options);
    }

    // ==================== CAREGIVER ENDPOINTS ====================

    /**
     * List caregivers with optional filtering
     * @param {Object} [params] - Query parameters
     * @param {string} [params.caregiverIds] - Comma-delimited caregiver IDs
     * @param {string} [params.statuses] - Comma-delimited statuses
     * @param {string} [params.regionIds] - Comma-delimited region IDs
     * @param {string} [params.regionNames] - Comma-delimited region names
     * @param {string} [params.classCodes] - Comma-delimited class codes
     * @param {string} [params.classLabels] - Comma-delimited class labels
     * @param {string} [params.adminIds] - Comma-delimited administrator IDs
     * @param {string} [params.adminUsernames] - Comma-delimited administrator usernames
     * @param {string} [params.startAfterId] - Pagination cursor
     * @param {number} [params.limit] - Results limit
     * @param {string} [params.requestedSensitiveFields] - Comma-delimited sensitive fields (e.g., 'ssn')
     * @returns {Promise<Object>} Response with caregivers array, nextPage URL, and caregiversNotFound array
     */
    async listCaregivers(params = {}) {
        const options = {
            url: `${this.baseUrl}/api/caregivers`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
            query: params,
        };
        return this._get(options);
    }

    /**
     * Create a new caregiver
     * @param {Object} caregiverData - Caregiver data
     * @param {string} caregiverData.firstName - Caregiver's first name (required)
     * @param {string} caregiverData.lastName - Caregiver's last name (required)
     * @param {string} [caregiverData.ssn] - Social Security Number
     * @param {string} [caregiverData.dateOfBirth] - Date of birth (YYYY-MM-DD)
     * @param {string} [caregiverData.gender] - Gender ('M' or 'F')
     * @param {Object} [caregiverData.mailingAddress] - Mailing address
     * @param {string} [caregiverData.personalEmail] - Email address
     * @param {string} [caregiverData.mobilePhone] - Mobile phone number
     * @returns {Promise<Object>} Created caregiver object
     */
    async createCaregiver(caregiverData) {
        const options = {
            url: `${this.baseUrl}/api/caregivers`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
            body: caregiverData,
        };
        return this._post(options);
    }

    /**
     * Get a single caregiver by ID
     * @param {number} caregiverId - Caregiver ID
     * @param {Object} [params] - Query parameters
     * @param {string} [params.requestedSensitiveFields] - Comma-delimited sensitive fields (e.g., 'ssn')
     * @returns {Promise<Object>} Caregiver object
     */
    async getCaregiver(caregiverId, params = {}) {
        const options = {
            url: `${this.baseUrl}/api/caregivers/${caregiverId}`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
            query: params,
        };

        const response = await this._get(options);
        return { results: response.results?.data, errors: response.errors };
    }

    /**
     * Update an existing caregiver
     * @param {number} caregiverId - Caregiver ID
     * @param {Object} caregiverData - Partial caregiver data to update (must include both firstName and lastName if updating names)
     * @returns {Promise<Object>} Updated caregiver object
     */
    async updateCaregiver(caregiverId, caregiverData) {
        const options = {
            url: `${this.baseUrl}/api/caregivers/${caregiverId}`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
            body: caregiverData,
        };
        return this._patch(options);
    }

    // ==================== APPLICANT ENDPOINTS ====================

    /**
     * List applicants with optional filtering
     * @param {Object} [params] - Query parameters
     * @param {string} [params.applicantIds] - Comma-delimited applicant IDs
     * @param {string} [params.statuses] - Comma-delimited statuses
     * @param {string} [params.requestedSensitiveFields] - Comma-delimited sensitive fields (e.g., 'ssn')
     * @param {string} [params.startAfterId] - Pagination cursor
     * @returns {Promise<Object>} Response with applicants array, nextPage URL, and applicantsNotFound array
     */
    async listApplicants(params = {}) {
        const options = {
            url: `${this.baseUrl}/api/applicants`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
            query: params,
        };
        return this._get(options);
    }

    /**
     * Create a new applicant
     * @param {Object} applicantData - Applicant data
     * @param {string} applicantData.firstName - Applicant's first name (required)
     * @param {string} applicantData.lastName - Applicant's last name (required)
     * @param {string} [applicantData.ssn] - Social Security Number
     * @param {string} [applicantData.dateOfBirth] - Date of birth (YYYY-MM-DD)
     * @param {Object} [applicantData.mailingAddress] - Mailing address (requires all 5 properties if provided)
     * @param {string} [applicantData.personalEmail] - Email address
     * @param {string} [applicantData.mobilePhone] - Mobile phone number
     * @returns {Promise<Object>} Created applicant object
     */
    async createApplicant(applicantData) {
        const options = {
            url: `${this.baseUrl}/api/applicants`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
            body: applicantData,
        };
        return this._post(options);
    }

    /**
     * Get a single applicant by ID
     * @param {number} applicantId - Applicant ID
     * @param {Object} [params] - Query parameters
     * @param {string} [params.requestedSensitiveFields] - Comma-delimited sensitive fields (e.g., 'ssn')
     * @returns {Promise<Object>} Applicant object
     */
    async getApplicant(applicantId, params = {}) {
        const options = {
            url: `${this.baseUrl}/api/applicants/${applicantId}`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
            query: params,
        };
        const response = await this._get(options);
        return { results: response.results?.data, errors: response.errors };
    }

    // ==================== VISIT ENDPOINTS ====================

    /**
     * List visits with filtering
     * @param {Object} params - Query parameters (at least one filter required)
     * @param {string} [params.startDate] - Visit start date (YYYY-MM-DD, required if updatedSinceDate not used)
     * @param {string} [params.endDate] - Visit end date (YYYY-MM-DD, required if updatedSinceDate not used)
     * @param {string} [params.updatedSinceDate] - UTC datetime to get visits updated since (ISO 8601)
     * @param {string} [params.visitIds] - Comma-delimited visit IDs (if used, no other filters allowed)
     * @param {string} [params.clientIds] - Comma-delimited client IDs
     * @param {string} [params.caregiverIds] - Comma-delimited caregiver IDs
     * @param {boolean} [params.verified] - Filter by verification status
     * @returns {Promise<Object>} Response with results.visits array and nextPage URL
     */
    async listVisits(params = {}) {
        const options = {
            url: `${this.baseUrl}/api/visits`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
            query: params,
        };
        return this._get(options);
    }

    /**
     * Create a new visit
     * @param {Object} visitData - Visit data
     * @param {number} visitData.clientId - Client ID (required)
     * @param {string} visitData.visitDate - Visit date (YYYY-MM-DD, required)
     * @param {string} visitData.startTime - Start time (HH:MM format, e.g., "09:00", required)
     * @param {string} visitData.endTime - End time (HH:MM format, e.g., "10:00", required)
     * @param {number} [visitData.caregiverId] - Caregiver ID
     * @param {boolean} [visitData.doNotBill] - Do not bill flag
     * @param {boolean} [visitData.doNotPay] - Do not pay flag
     * @param {string} [visitData.serviceCode] - Service code (mutually exclusive with serviceDescription)
     * @param {string} [visitData.serviceDescription] - Service description (mutually exclusive with serviceCode)
     * @param {number} [visitData.mileage] - Mileage
     * @param {number} [visitData.expenses] - Expenses
     * @param {string} [visitData.billableRateMode] - Billable rate mode (e.g., "custom")
     * @param {number} [visitData.chargeRate] - Charge rate (required if billableRateMode is "custom")
     * @returns {Promise<Object>} Created visit object
     */
    async createVisit(visitData) {
        const options = {
            url: `${this.baseUrl}/api/visits`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
            body: visitData,
        };
        return this._post(options);
    }

    /**
     * Update an existing visit
     * @param {string} visitId - Visit ID (format: s=222:d=2024-03-04)
     * @param {Object} visitData - Partial visit data to update
     * @param {string} [visitData.startTime] - Start time (HH:MM format)
     * @param {string} [visitData.endTime] - End time (HH:MM format)
     * @param {number} [visitData.caregiverId] - Caregiver ID
     * @param {boolean} [visitData.doNotBill] - Do not bill flag
     * @param {boolean} [visitData.doNotPay] - Do not pay flag
     * @param {string} [visitData.serviceCode] - Service code
     * @param {string} [visitData.serviceDescription] - Service description
     * @returns {Promise<Object>} Updated visit object
     */
    async updateVisit(visitId, visitData) {
        const options = {
            url: `${this.baseUrl}/api/visits/${visitId}`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
            body: visitData,
        };
        return this._patch(options);
    }

    /**
     * Delete a visit
     * @param {string} visitId - Visit ID (format: s=222:d=2024-03-04)
     * @param {Object} [params] - Query parameters
     * @param {number} [params.modificationReason] - Modification reason ID
     * @returns {Promise<void>} 204 No Content on success
     */
    async deleteVisit(visitId, params = {}) {
        const options = {
            url: `${this.baseUrl}/api/visits/${visitId}`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
            query: params,
        };
        return this._delete(options);
    }

    // ==================== CALL LOG ENDPOINTS ====================

    /**
     * List call logs with optional filtering
     * @param {Object} [params] - Query parameters
     * @param {string} [params.callLogIds] - Comma-delimited call log IDs
     * @param {string} [params.fromDateTime] - Start datetime (ISO 8601, e.g., "2025-01-29T23:00:00-05:00")
     * @param {string} [params.toDateTime] - End datetime (ISO 8601)
     * @param {number} [params.startAfterId] - Pagination cursor
     * @param {number} [params.limit=100] - Results limit (max: 100)
     * @returns {Promise<Object>} Response with results.callLogs array and nextPage URL
     */
    async listCallLogs(params = {}) {
        const options = {
            url: `${this.baseUrl}/api/call-logs`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
            query: params,
        };
        return this._get(options);
    }

    /**
     * Create a new call log
     * @param {Object} callLogData - Call log data
     * @param {string} callLogData.callerName - Caller's name (required)
     * @param {string} callLogData.callerPhone - Caller's phone number (required)
     * @param {boolean} callLogData.followUp - Follow-up required flag (required)
     * @param {string} callLogData.dateTime - Call datetime (ISO 8601, e.g., "2025-07-01T15:23:45-05:00", required)
     * @param {string} callLogData.subject - Call subject (required)
     * @param {string} callLogData.notes - Call notes (required)
     * @param {Array<{type: string, entityId: number}>} callLogData.tags - Tags array (required, can be empty)
     * @returns {Promise<Object>} Created call log object
     */
    async createCallLog(callLogData) {
        const options = {
            url: `${this.baseUrl}/api/call-logs`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
            body: callLogData,
        };
        return this._post(options);
    }

    /**
     * Get a single call log by ID
     * @param {number} callLogId - Call log ID
     * @returns {Promise<Object>} Call log object with tags and comments
     */
    async getCallLog(callLogId) {
        const options = {
            url: `${this.baseUrl}/api/call-logs/${callLogId}`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
        };
        return this._get(options);
    }

    /**
     * Update an existing call log
     * @param {number} callLogId - Call log ID
     * @param {Object} callLogData - Partial call log data to update
     * @param {string} [callLogData.callerName] - Caller's name
     * @param {string} [callLogData.callerPhone] - Caller's phone number
     * @param {boolean} [callLogData.followUp] - Follow-up required flag
     * @param {boolean} [callLogData.followUpDone] - Follow-up completed flag
     * @param {string} [callLogData.dateTime] - Call datetime (ISO 8601)
     * @param {string} [callLogData.subject] - Call subject
     * @param {string} [callLogData.notes] - Call notes
     * @param {Array<{type: string, entityId: number}>} [callLogData.tags] - Tags array
     * @param {Array<{comment: string, dateTime: string, userId: number}>} [callLogData.comments] - Comments to add
     * @returns {Promise<Object>} Updated call log object
     */
    async updateCallLog(callLogId, callLogData) {
        const options = {
            url: `${this.baseUrl}/api/call-logs/${callLogId}`,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
            body: callLogData,
        };
        return this._patch(options);
    }

    // ==================== PAGINATION HELPER ====================

    /**
     * Fetch from a full URL (used for pagination nextPage URLs)
     *
     * AxisCare provides complete URLs in the nextPage field that include
     * all necessary query parameters (startAfterId, limit, etc).
     * This method allows us to follow those URLs directly without parsing.
     *
     * @param {string} fullUrl - Complete URL from response.nextPage field
     * @returns {Promise<Object>} API response with same structure as listClients
     * @example
     * const nextUrl = "https://agency.axiscare.com/api/clients?startAfterId=100&limit=50";
     * const response = await api.getFromUrl(nextUrl);
     */
    async getFromUrl(fullUrl) {
        const options = {
            url: fullUrl,
            headers: {
                'X-AxisCare-Api-Version': Api.API_KEY_VERSION,
                Accept: 'application/json',
            },
        };
        return this._get(options);
    }
}

module.exports = { Api };
