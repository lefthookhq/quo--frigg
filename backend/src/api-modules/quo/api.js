const { ApiKeyRequester, get } = require('@friggframework/core');

class Api extends ApiKeyRequester {
    constructor(params = {}) {
        super(params);
        this.baseUrl = process.env.QUO_BASE_URL;

        this.API_KEY_NAME = 'Authorization';

        if (params.api_key) {
            this.setApiKey(params.api_key);
        }

        this.URLs = {
            // Call endpoints
            calls: '/v1/calls',
            callById: (callId) => `/v1/calls/${callId}`,
            callRecordings: (callId) => `/v1/call-recordings/${callId}`,
            callSummaries: (callId) => `/v1/call-summaries/${callId}`,
            callTranscripts: (id) => `/v1/call-transcripts/${id}`,
            callVoicemails: (callId) => `/v1/call-voicemails/${callId}`,

            // Contact endpoints
            contacts: '/v1/contacts',
            contactById: (id) => `/v1/contacts/${id}`,
            contactCustomFields: '/v1/contact-custom-fields',

            // Conversation endpoints
            conversations: '/v1/conversations',

            // Message endpoints
            messages: '/v1/messages',
            messageById: (id) => `/v1/messages/${id}`,

            // Phone number endpoints
            phoneNumbers: '/v1/phone-numbers',
            phoneNumberById: (phoneNumberId) =>
                `/v1/phone-numbers/${phoneNumberId}`,

            // User endpoints
            users: '/v1/users',
            userById: (userId) => `/v1/users/${userId}`,

            // Webhook endpoints
            webhooks: '/v2/webhooks',
            webhookById: (id) => `/v2/webhooks/${id}`,
            webhookCalls: '/v2/webhooks/calls',
            webhookMessages: '/v2/webhooks/messages',
            webhookCallSummaries: '/v2/webhooks/call-summaries',
            webhookCallTranscripts: '/v2/webhooks/call-transcripts',
        };
    }

    // Call Management
    async listCalls(params = {}) {
        const options = {
            url: this.baseUrl + this.URLs.calls,
            query: params,
        };
        return this._get(options);
    }

    async getCall(callId) {
        const options = {
            url: this.baseUrl + this.URLs.callById(callId),
        };
        return this._get(options);
    }

    async getCallRecordings(callId) {
        const options = {
            url: this.baseUrl + this.URLs.callRecordings(callId),
        };
        return this._get(options);
    }

    async getCallSummary(callId) {
        const options = {
            url: this.baseUrl + this.URLs.callSummaries(callId),
        };
        return this._get(options);
    }

    async getCallTranscript(id) {
        const options = {
            url: this.baseUrl + this.URLs.callTranscripts(id),
        };
        return this._get(options);
    }

    async getCallVoicemails(callId) {
        const options = {
            url: this.baseUrl + this.URLs.callVoicemails(callId),
        };
        return this._get(options);
    }

    // Contact Management
    async listContacts(params = {}) {
        // Build URL with proper array handling for externalIds[] and phoneNumbers[]
        let url = this.baseUrl + this.URLs.contacts;

        const queryParts = [];
        for (const [key, value] of Object.entries(params)) {
            if (Array.isArray(value)) {
                // Handle arrays with bracket notation: key[]=val1&key[]=val2
                value.forEach((item) => {
                    queryParts.push(
                        `${encodeURIComponent(key)}[]=${encodeURIComponent(item)}`,
                    );
                });
            } else {
                // Handle regular params
                queryParts.push(
                    `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
                );
            }
        }

        if (queryParts.length > 0) {
            url += '?' + queryParts.join('&');
        }

        const options = { url };
        return this._get(options);
    }

    async getContact(id) {
        const options = {
            url: this.baseUrl + this.URLs.contactById(id),
        };
        return this._get(options);
    }

    /**
     * @typedef {Object} ContactEmailField
     * @property {string} name - The name for the contact's email address (e.g., "company email")
     * @property {string|null} value - The contact's email address (e.g., "abc@example.com")
     */

    /**
     * @typedef {Object} ContactPhoneField
     * @property {string} name - The name of the contact's phone number (e.g., "company phone")
     * @property {string|null} value - The contact's phone number in E.164 format (e.g., "+12345678901")
     */

    /**
     * @typedef {Object} ContactDefaultFields
     * @property {string|null} firstName - The contact's first name (required)
     * @property {string|null} [lastName] - The contact's last name
     * @property {string|null} [company] - The contact's company name
     * @property {ContactEmailField[]} [emails] - Array of email addresses for the contact
     * @property {ContactPhoneField[]} [phoneNumbers] - Array of phone numbers for the contact
     * @property {string|null} [role] - The contact's role (e.g., "Sales")
     */

    /**
     * @typedef {Object} ContactCustomField
     * @property {string} key - The identifying key for the custom field (e.g., "inbound-lead")
     * @property {string[]|string|boolean|number|null} value - The value for the custom field (type varies by field definition)
     */

    /**
     * @typedef {Object} CreateContactData
     * @property {ContactDefaultFields} defaultFields - The contact's default fields (required)
     * @property {ContactCustomField[]} [customFields] - Array of custom fields for the contact
     * @property {string} [createdByUserId] - The unique identifier of the user creating the contact (pattern: ^US(.*)$)
     * @property {string} [source] - The contact's source. Defaults to "public-api". Cannot use reserved words: "openphone", "device", "csv", "zapier", "google-people", "other" or start with "openphone", "csv" (max 72 chars)
     * @property {string} [sourceUrl] - A link to the contact in the source system (URI format, max 200 chars)
     * @property {string|null} [externalId] - A unique identifier from an external system for cross-referencing (max 75 chars)
     */

    /**
     * Create a contact in OpenPhone
     *
     * @param {CreateContactData} data - The contact data to create
     * @returns {Promise<Object>} The created contact with id, externalId, source, defaultFields, customFields, createdAt, updatedAt, and createdByUserId
     * @throws {Error} 400 - Invalid custom field item
     * @throws {Error} 401 - Unauthorized
     * @throws {Error} 403 - Not phone number user
     * @throws {Error} 404 - Not found
     * @throws {Error} 409 - Conflict
     * @throws {Error} 500 - Unknown error
     */
    async createContact(data) {
        const options = {
            url: this.baseUrl + this.URLs.contacts,
            headers: {
                'Content-Type': 'application/json',
            },
            body: data,
        };
        return this._post(options);
    }

    /**
     * Bulk create multiple contacts in OpenPhone
     *
     * @param {string} orgId - Organization ID
     * @param {CreateContactData[]} data - Array of contact data objects to create
     * @returns {Promise<Object>} Response containing the created contacts with their ids, externalIds, sources, defaultFields, customFields, createdAt, updatedAt, and createdByUserIds
     * @throws {Error} 400 - Invalid custom field item
     * @throws {Error} 401 - Unauthorized
     * @throws {Error} 403 - Not phone number user
     * @throws {Error} 404 - Not found
     * @throws {Error} 409 - Conflict
     * @throws {Error} 500 - Unknown error
     */
    async bulkCreateContacts(orgId, data) {
        const options = {
            url: this.baseUrl + this.URLs.contacts + '/bulk',
            headers: {
                'Content-Type': 'application/json',
            },
            body: {
                // orgId,
                // TODO: Uncomment this when orgId is available
                contacts: data,
            },
        };
        return this._post(options);
    }

    async updateContact(id, data) {
        const options = {
            url: this.baseUrl + this.URLs.contactById(id),
            headers: {
                'Content-Type': 'application/json',
            },
            body: data,
        };
        return this._patch(options);
    }

    async deleteContact(id) {
        const options = {
            url: this.baseUrl + this.URLs.contactById(id),
        };
        return this._delete(options);
    }

    async listContactCustomFields() {
        const options = {
            url: this.baseUrl + this.URLs.contactCustomFields,
        };
        return this._get(options);
    }

    // Conversation Management
    async listConversations(params = {}) {
        const options = {
            url: this.baseUrl + this.URLs.conversations,
            query: params,
        };
        return this._get(options);
    }

    // Message Management
    async listMessages(params = {}) {
        const options = {
            url: this.baseUrl + this.URLs.messages,
            query: params,
        };
        return this._get(options);
    }

    async getMessage(id) {
        const options = {
            url: this.baseUrl + this.URLs.messageById(id),
        };
        return this._get(options);
    }

    async sendMessage(data) {
        const options = {
            url: this.baseUrl + this.URLs.messages,
            headers: {
                'Content-Type': 'application/json',
            },
            body: data,
        };
        return this._post(options);
    }

    // Phone Number Management
    async listPhoneNumbers(params = {}) {
        const options = {
            url: this.baseUrl + this.URLs.phoneNumbers,
            query: params,
        };
        return this._get(options);
    }

    async getPhoneNumber(phoneNumberId) {
        const options = {
            url: this.baseUrl + this.URLs.phoneNumberById(phoneNumberId),
        };
        return this._get(options);
    }

    // User Management
    async listUsers(params = {}) {
        const options = {
            url: this.baseUrl + this.URLs.users,
            query: params,
        };
        return this._get(options);
    }

    async getUser(userId) {
        const options = {
            url: this.baseUrl + this.URLs.userById(userId),
        };
        return this._get(options);
    }

    // Webhook Management
    async listWebhooks(params = {}) {
        const options = {
            url: this.baseUrl + this.URLs.webhooks,
            query: params,
        };
        return this._get(options);
    }

    async getWebhook(id) {
        const options = {
            url: this.baseUrl + this.URLs.webhookById(id),
        };
        return this._get(options);
    }

    async createWebhook(data) {
        const options = {
            url: this.baseUrl + this.URLs.webhooks,
            headers: {
                'Content-Type': 'application/json',
            },
            body: data,
        };
        return this._post(options);
    }

    async createMessageWebhook(data) {
        const options = {
            url: this.baseUrl + this.URLs.webhookMessages,
            headers: {
                'Content-Type': 'application/json',
            },
            body: data,
        };
        return this._post(options);
    }

    async createCallWebhook(data) {
        const options = {
            url: this.baseUrl + this.URLs.webhookCalls,
            headers: {
                'Content-Type': 'application/json',
            },
            body: data,
        };
        return this._post(options);
    }

    async createCallSummaryWebhook(data) {
        const options = {
            url: this.baseUrl + this.URLs.webhookCallSummaries,
            headers: {
                'Content-Type': 'application/json',
            },
            body: data,
        };
        return this._post(options);
    }

    async updateWebhook(id, data) {
        const options = {
            url: this.baseUrl + this.URLs.webhookById(id),
            headers: {
                'Content-Type': 'application/json',
            },
            body: data,
        };
        return this._patch(options);
    }

    async deleteWebhook(id) {
        const options = {
            url: this.baseUrl + this.URLs.webhookById(id),
        };
        return this._delete(options);
    }
}

module.exports = { Api };
