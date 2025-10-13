const { ApiKeyRequester, get } = require('@friggframework/core');

class Api extends ApiKeyRequester {
    constructor(params) {
        super(params);
        this.baseUrl = 'https://dev-public-api.openphone.dev'; //'https://api.openphone.com';

        // OpenPhone uses 'Authorization' header for API key
        this.API_KEY_NAME = 'Authorization';

        let apiKey;
        try {
            apiKey = get(params, 'access_token');
        } catch (error) {
            apiKey = get(params, 'api_key');
        }

        this.access_token = apiKey;

        if (this.access_token) {
            this.setApiKey(this.access_token);
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
            webhooks: '/v1/webhooks',
            webhookById: (id) => `/v1/webhooks/${id}`,
            webhookCalls: '/v1/webhooks/calls',
            webhookMessages: '/v1/webhooks/messages',
            webhookCallSummaries: '/v1/webhooks/call-summaries',
            webhookCallTranscripts: '/v1/webhooks/call-transcripts',
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
        const options = {
            url: this.baseUrl + this.URLs.contacts,
            query: params,
        };
        return this._get(options);
    }

    async getContact(id) {
        const options = {
            url: this.baseUrl + this.URLs.contactById(id),
        };
        return this._get(options);
    }

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
