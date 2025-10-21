const { ApiKeyRequester } = require('@friggframework/core');

/**
 * Pipedrive API Client
 * Implements API key authentication for Pipedrive CRM
 */
class Api extends ApiKeyRequester {
    constructor(params = {}) {
        super(params);
        this.baseUrl = params.baseUrl || 'https://api.pipedrive.com/v1';
        this.API_KEY_NAME = 'api_token';

        // Get API key from params
        if (params.apiKey) {
            this.setApiKey(params.apiKey);
            this.access_token = params.apiKey;
        }
    }

    /**
     * Override setApiKey to set the API token as a query parameter
     * @param {string} apiKey - The Pipedrive API token
     */
    setApiKey(apiKey) {
        this.API_KEY_VALUE = apiKey;
        this.apiToken = apiKey;
    }

    /**
     * Helper to build URL with API token
     * @private
     */
    _buildUrl(path, params = {}) {
        const queryParams = { ...params, api_token: this.apiToken };
        const queryString = new URLSearchParams(queryParams).toString();
        return `${this.baseUrl}${path}?${queryString}`;
    }

    /**
     * Override _get to include API token in query params
     * @private
     */
    async _get(options) {
        const url = this._buildUrl(options.url.replace(this.baseUrl, ''), options.query || {});
        return super._get({ ...options, url, query: {} });
    }

    /**
     * Override _post to include API token in query params
     * @private
     */
    async _post(options) {
        const url = this._buildUrl(options.url.replace(this.baseUrl, ''), options.query || {});
        return super._post({ ...options, url, query: {} });
    }

    /**
     * Override _put to include API token in query params
     * @private
     */
    async _put(options) {
        const url = this._buildUrl(options.url.replace(this.baseUrl, ''), options.query || {});
        return super._put({ ...options, url, query: {} });
    }

    /**
     * Override _delete to include API token in query params
     * @private
     */
    async _delete(options) {
        const url = this._buildUrl(options.url.replace(this.baseUrl, ''), options.query || {});
        return super._delete({ ...options, url, query: {} });
    }

    // ==================== PERSON ENDPOINTS ====================

    /**
     * Get current user details
     * @returns {Promise<Object>} User details
     */
    async getCurrentUser() {
        const options = {
            url: `${this.baseUrl}/users/me`,
            headers: {
                'Accept': 'application/json',
            },
        };
        const response = await this._get(options);
        return response.data;
    }

    /**
     * Persons API namespace
     */
    persons = {
        /**
         * Get all persons
         * @param {Object} [params] - Query parameters
         * @param {number} [params.start=0] - Offset for pagination
         * @param {number} [params.limit=100] - Results limit
         * @param {string} [params.sort] - Sort field and order (e.g., 'update_time DESC')
         * @param {string} [params.search] - Search term
         * @returns {Promise<Object>} Response with data array
         */
        getAll: async (params = {}) => {
            const options = {
                url: `${this.baseUrl}/persons`,
                query: params,
            };
            return this._get(options);
        },

        /**
         * Get a single person by ID
         * @param {number} id - Person ID
         * @returns {Promise<Object>} Person data
         */
        get: async (id) => {
            const options = {
                url: `${this.baseUrl}/persons/${id}`,
            };
            return this._get(options);
        },

        /**
         * Create a new person
         * @param {Object} personData - Person data
         * @returns {Promise<Object>} Created person
         */
        create: async (personData) => {
            const options = {
                url: `${this.baseUrl}/persons`,
                headers: {
                    'Content-Type': 'application/json',
                },
                data: personData,
            };
            return this._post(options);
        },

        /**
         * Update a person
         * @param {number} id - Person ID
         * @param {Object} personData - Person data
         * @returns {Promise<Object>} Updated person
         */
        update: async (id, personData) => {
            const options = {
                url: `${this.baseUrl}/persons/${id}`,
                headers: {
                    'Content-Type': 'application/json',
                },
                data: personData,
            };
            return this._put(options);
        },
    };

    // ==================== DEAL ENDPOINTS ====================

    /**
     * Deals API namespace
     */
    deals = {
        /**
         * Get all deals
         * @param {Object} [params] - Query parameters
         * @param {number} [params.start=0] - Offset for pagination
         * @param {number} [params.limit=100] - Results limit
         * @param {string} [params.sort] - Sort field and order
         * @param {string} [params.status] - Filter by status (open, won, lost)
         * @returns {Promise<Object>} Response with data array
         */
        getAll: async (params = {}) => {
            const options = {
                url: `${this.baseUrl}/deals`,
                query: params,
            };
            return this._get(options);
        },

        /**
         * Get a single deal by ID
         * @param {number} id - Deal ID
         * @returns {Promise<Object>} Deal data
         */
        get: async (id) => {
            const options = {
                url: `${this.baseUrl}/deals/${id}`,
            };
            return this._get(options);
        },

        /**
         * Create a new deal
         * @param {Object} dealData - Deal data
         * @returns {Promise<Object>} Created deal
         */
        create: async (dealData) => {
            const options = {
                url: `${this.baseUrl}/deals`,
                headers: {
                    'Content-Type': 'application/json',
                },
                data: dealData,
            };
            return this._post(options);
        },
    };

    // ==================== ORGANIZATION ENDPOINTS ====================

    /**
     * Organizations API namespace
     */
    organizations = {
        /**
         * Get all organizations
         * @param {Object} [params] - Query parameters
         * @returns {Promise<Object>} Response with data array
         */
        getAll: async (params = {}) => {
            const options = {
                url: `${this.baseUrl}/organizations`,
                query: params,
            };
            return this._get(options);
        },

        /**
         * Get a single organization by ID
         * @param {number} id - Organization ID
         * @returns {Promise<Object>} Organization data
         */
        get: async (id) => {
            const options = {
                url: `${this.baseUrl}/organizations/${id}`,
            };
            return this._get(options);
        },
    };

    // ==================== ACTIVITY ENDPOINTS ====================

    /**
     * Activities API namespace
     */
    activities = {
        /**
         * Get all activities
         * @param {Object} [params] - Query parameters
         * @returns {Promise<Object>} Response with data array
         */
        getAll: async (params = {}) => {
            const options = {
                url: `${this.baseUrl}/activities`,
                query: params,
            };
            return this._get(options);
        },

        /**
         * Create a new activity
         * @param {Object} activityData - Activity data
         * @returns {Promise<Object>} Created activity
         */
        create: async (activityData) => {
            const options = {
                url: `${this.baseUrl}/activities`,
                headers: {
                    'Content-Type': 'application/json',
                },
                data: activityData,
            };
            return this._post(options);
        },
    };

    // ==================== WEBHOOK ENDPOINTS ====================

    /**
     * Webhooks API namespace
     */
    webhooks = {
        /**
         * Get all webhooks
         * @returns {Promise<Object>} Response with data array
         */
        getAll: async () => {
            const options = {
                url: `${this.baseUrl}/webhooks`,
            };
            return this._get(options);
        },

        /**
         * Create a new webhook
         * @param {Object} webhookData - Webhook data
         * @param {string} webhookData.subscription_url - The URL to send webhook notifications to
         * @param {string} webhookData.event_action - Event action (added, updated, deleted, etc.)
         * @param {string} webhookData.event_object - Event object (person, deal, organization, etc.)
         * @returns {Promise<Object>} Created webhook
         */
        create: async (webhookData) => {
            const options = {
                url: `${this.baseUrl}/webhooks`,
                headers: {
                    'Content-Type': 'application/json',
                },
                data: webhookData,
            };
            return this._post(options);
        },

        /**
         * Delete a webhook
         * @param {number} id - Webhook ID
         * @returns {Promise<Object>} Deletion result
         */
        delete: async (id) => {
            const options = {
                url: `${this.baseUrl}/webhooks/${id}`,
            };
            return this._delete(options);
        },
    };

    // ==================== SEARCH ENDPOINTS ====================

    /**
     * Search across all data types
     * @param {Object} params - Search parameters
     * @param {string} params.term - Search term
     * @param {string} [params.item_types] - Comma-separated item types (person, organization, deal, etc.)
     * @param {boolean} [params.exact_match] - Whether to perform exact match
     * @returns {Promise<Object>} Search results
     */
    async search(params) {
        const options = {
            url: `${this.baseUrl}/itemSearch`,
            query: params,
        };
        return this._get(options);
    }
}

module.exports = { Api };
