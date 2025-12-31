import { OAuth2Requester, get } from '@friggframework/core';
import crypto from 'crypto';
import {
    ClioRegion,
    ClioOAuth2Options,
    ClioResponse,
    ClioUser,
    ClioContact,
    ClioPhoneNumber,
    ClioEmailAddress,
    ClioNote,
    ClioCommunication,
    ClioWebhook,
    ClioCustomAction,
    ClioMatter,
    ListContactsParams,
    ListPhoneNumbersParams,
    ListEmailAddressesParams,
    ListNotesParams,
    CreateNoteParams,
    UpdateNoteParams,
    ListCommunicationsParams,
    CreateCommunicationParams,
    UpdateCommunicationParams,
    ListWebhooksParams,
    CreateWebhookParams,
    UpdateWebhookParams,
    ListCustomActionsParams,
    CreateCustomActionParams,
    ListMattersParams,
} from './types';

const REGION_BASE_URLS: Record<ClioRegion, string> = {
    us: 'https://app.clio.com/api/v4',
    eu: 'https://eu.app.clio.com/api/v4',
    ca: 'https://ca.app.clio.com/api/v4',
    au: 'https://au.app.clio.com/api/v4',
};

const REGION_AUTH_URLS: Record<ClioRegion, string> = {
    us: 'https://app.clio.com',
    eu: 'https://eu.app.clio.com',
    ca: 'https://ca.app.clio.com',
    au: 'https://au.app.clio.com',
};

const API_VERSION = '4.0.12';

const CLIO_HEADERS = {
    'X-API-VERSION': API_VERSION,
};

const CLIO_HEADERS_JSON = {
    ...CLIO_HEADERS,
    'Content-Type': 'application/json',
};

export class Api extends OAuth2Requester {
    region: ClioRegion;
    URLs: {
        whoAmI: string;
        contacts: string;
        contactById: (id: number | string) => string;
        contactPhoneNumbers: (contactId: number | string) => string;
        contactEmailAddresses: (contactId: number | string) => string;
        notes: string;
        noteById: (id: number | string) => string;
        communications: string;
        communicationById: (id: number | string) => string;
        webhooks: string;
        webhookById: (id: number | string) => string;
        customActions: string;
        customActionById: (id: number | string) => string;
        matters: string;
        matterById: (id: number | string) => string;
        matterContacts: (matterId: number | string) => string;
    };

    constructor(params: ClioOAuth2Options = {}) {
        super(params);

        this.region = get(params, 'region', 'us') as ClioRegion;
        this.setRegion(this.region);

        this.URLs = {
            whoAmI: '/users/who_am_i.json',
            contacts: '/contacts.json',
            contactById: (id: number | string) => `/contacts/${id}.json`,
            contactPhoneNumbers: (contactId: number | string) =>
                `/contacts/${contactId}/phone_numbers.json`,
            contactEmailAddresses: (contactId: number | string) =>
                `/contacts/${contactId}/email_addresses.json`,
            notes: '/notes.json',
            noteById: (id: number | string) => `/notes/${id}.json`,
            communications: '/communications.json',
            communicationById: (id: number | string) =>
                `/communications/${id}.json`,
            webhooks: '/webhooks.json',
            webhookById: (id: number | string) => `/webhooks/${id}.json`,
            customActions: '/custom_actions.json',
            customActionById: (id: number | string) =>
                `/custom_actions/${id}.json`,
            matters: '/matters.json',
            matterById: (id: number | string) => `/matters/${id}.json`,
            matterContacts: (matterId: number | string) =>
                `/matters/${matterId}/contacts.json`,
        };
    }

    /**
     * Override setTokens to preserve region during token refresh
     */
    async setTokens(params: any): Promise<any> {
        const currentRegion = this.region;
        const result = await super.setTokens(params);
        if (currentRegion && currentRegion !== this.region) {
            this.setRegion(currentRegion);
        }
        return result;
    }

    /**
     * Sets the region and updates all OAuth URLs accordingly
     */
    setRegion(region: ClioRegion): void {
        if (!REGION_BASE_URLS[region]) {
            throw new Error(
                `Invalid Clio region: ${region}. Must be one of: us, eu, ca, au`,
            );
        }

        this.region = region;
        this.baseUrl = REGION_BASE_URLS[region];

        const authUrl = REGION_AUTH_URLS[region];
        this.authorizationUri = encodeURI(
            `${authUrl}/oauth/authorize?client_id=${this.client_id}&redirect_uri=${this.redirect_uri}&response_type=code`,
        );
        this.tokenUri = `${authUrl}/oauth/token`;
    }

    // ==================== User ====================

    /**
     * Get current authenticated user info
     */
    async getUser(): Promise<ClioResponse<ClioUser>> {
        return this._get({
            url: this.baseUrl + this.URLs.whoAmI,
            headers: CLIO_HEADERS,
        });
    }

    // ==================== Contacts ====================

    /**
     * List contacts with optional filtering
     */
    async listContacts(
        params?: ListContactsParams,
    ): Promise<ClioResponse<ClioContact[]>> {
        return this._get({
            url: this.baseUrl + this.URLs.contacts,
            headers: CLIO_HEADERS,
            ...(params && Object.keys(params).length > 0 && { query: params }),
        });
    }

    /**
     * Get a single contact by ID
     */
    async getContact(
        contactId: number | string,
        fields?: string,
    ): Promise<ClioResponse<ClioContact>> {
        return this._get({
            url: this.baseUrl + this.URLs.contactById(contactId),
            headers: CLIO_HEADERS,
            ...(fields && { query: { fields } }),
        });
    }

    /**
     * Get phone numbers for a contact
     */
    async getContactPhoneNumbers(
        contactId: number | string,
        params?: ListPhoneNumbersParams,
    ): Promise<ClioResponse<ClioPhoneNumber[]>> {
        return this._get({
            url: this.baseUrl + this.URLs.contactPhoneNumbers(contactId),
            headers: CLIO_HEADERS,
            ...(params && Object.keys(params).length > 0 && { query: params }),
        });
    }

    /**
     * Get email addresses for a contact
     */
    async getContactEmailAddresses(
        contactId: number | string,
        params?: ListEmailAddressesParams,
    ): Promise<ClioResponse<ClioEmailAddress[]>> {
        return this._get({
            url: this.baseUrl + this.URLs.contactEmailAddresses(contactId),
            headers: CLIO_HEADERS,
            ...(params && Object.keys(params).length > 0 && { query: params }),
        });
    }

    // ==================== Notes ====================

    /**
     * List notes with optional filtering
     */
    async listNotes(
        params?: ListNotesParams,
    ): Promise<ClioResponse<ClioNote[]>> {
        return this._get({
            url: this.baseUrl + this.URLs.notes,
            headers: CLIO_HEADERS,
            ...(params && Object.keys(params).length > 0 && { query: params }),
        });
    }

    /**
     * Get a single note by ID
     */
    async getNote(
        noteId: number | string,
        fields?: string,
    ): Promise<ClioResponse<ClioNote>> {
        return this._get({
            url: this.baseUrl + this.URLs.noteById(noteId),
            headers: CLIO_HEADERS,
            ...(fields && { query: { fields } }),
        });
    }

    /**
     * Create a new note
     */
    async createNote(
        params: CreateNoteParams,
    ): Promise<ClioResponse<ClioNote>> {
        return this._post({
            url: this.baseUrl + this.URLs.notes,
            headers: CLIO_HEADERS_JSON,
            body: { data: params },
        });
    }

    /**
     * Update an existing note
     */
    async updateNote(
        noteId: number | string,
        params: UpdateNoteParams,
    ): Promise<ClioResponse<ClioNote>> {
        return this._patch({
            url: this.baseUrl + this.URLs.noteById(noteId),
            headers: CLIO_HEADERS_JSON,
            body: { data: params },
        });
    }

    /**
     * Delete a note
     */
    async deleteNote(noteId: number | string): Promise<void> {
        return this._delete({
            url: this.baseUrl + this.URLs.noteById(noteId),
            headers: CLIO_HEADERS,
        });
    }

    // ==================== Communications (Call Logging) ====================

    /**
     * List communications with optional filtering
     */
    async listCommunications(
        params?: ListCommunicationsParams,
    ): Promise<ClioResponse<ClioCommunication[]>> {
        return this._get({
            url: this.baseUrl + this.URLs.communications,
            headers: CLIO_HEADERS,
            ...(params && Object.keys(params).length > 0 && { query: params }),
        });
    }

    /**
     * Get a single communication by ID
     */
    async getCommunication(
        communicationId: number | string,
        fields?: string,
    ): Promise<ClioResponse<ClioCommunication>> {
        return this._get({
            url: this.baseUrl + this.URLs.communicationById(communicationId),
            headers: CLIO_HEADERS,
            ...(fields && { query: { fields } }),
        });
    }

    /**
     * Create a new communication (e.g., log a phone call)
     */
    async createCommunication(
        params: CreateCommunicationParams,
    ): Promise<ClioResponse<ClioCommunication>> {
        return this._post({
            url: this.baseUrl + this.URLs.communications,
            headers: CLIO_HEADERS_JSON,
            body: { data: params },
        });
    }

    /**
     * Update an existing communication
     */
    async updateCommunication(
        communicationId: number | string,
        params: UpdateCommunicationParams,
    ): Promise<ClioResponse<ClioCommunication>> {
        return this._patch({
            url: this.baseUrl + this.URLs.communicationById(communicationId),
            headers: CLIO_HEADERS_JSON,
            body: { data: params },
        });
    }

    /**
     * Delete a communication
     */
    async deleteCommunication(communicationId: number | string): Promise<void> {
        return this._delete({
            url: this.baseUrl + this.URLs.communicationById(communicationId),
            headers: CLIO_HEADERS,
        });
    }

    // ==================== Webhooks ====================

    /**
     * List webhooks
     */
    async listWebhooks(
        params?: ListWebhooksParams,
    ): Promise<ClioResponse<ClioWebhook[]>> {
        return this._get({
            url: this.baseUrl + this.URLs.webhooks,
            headers: CLIO_HEADERS,
            ...(params && Object.keys(params).length > 0 && { query: params }),
        });
    }

    /**
     * Get a single webhook by ID
     */
    async getWebhook(
        webhookId: number | string,
        fields?: string,
    ): Promise<ClioResponse<ClioWebhook>> {
        return this._get({
            url: this.baseUrl + this.URLs.webhookById(webhookId),
            headers: CLIO_HEADERS,
            ...(fields && { query: { fields } }),
        });
    }

    /**
     * Create a new webhook
     */
    async createWebhook(
        params: CreateWebhookParams,
    ): Promise<ClioResponse<ClioWebhook>> {
        return this._post({
            url: this.baseUrl + this.URLs.webhooks,
            headers: CLIO_HEADERS_JSON,
            body: { data: params },
        });
    }

    /**
     * Update an existing webhook
     */
    async updateWebhook(
        webhookId: number | string,
        params: UpdateWebhookParams,
    ): Promise<ClioResponse<ClioWebhook>> {
        return this._patch({
            url: this.baseUrl + this.URLs.webhookById(webhookId),
            headers: CLIO_HEADERS_JSON,
            body: { data: params },
        });
    }

    /**
     * Delete a webhook
     */
    async deleteWebhook(webhookId: number | string): Promise<void> {
        return this._delete({
            url: this.baseUrl + this.URLs.webhookById(webhookId),
            headers: CLIO_HEADERS,
        });
    }

    /**
     * Verify webhook signature using HMAC-SHA256
     * @param payload - The raw request body
     * @param signature - The X-Hook-Signature header value
     * @param secret - The shared secret from webhook creation
     * @returns boolean indicating if signature is valid
     */
    verifyWebhookSignature(
        payload: string,
        signature: string,
        secret: string,
    ): boolean {
        if (!payload || !signature || !secret) {
            return false;
        }

        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(payload)
            .digest('hex');

        // Check lengths match before comparing to prevent timingSafeEqual from throwing
        if (signature.length !== expectedSignature.length) {
            return false;
        }

        return crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature),
        );
    }

    // ==================== Custom Actions (Click-to-Call) ====================

    /**
     * List custom actions
     */
    async listCustomActions(
        params?: ListCustomActionsParams,
    ): Promise<ClioResponse<ClioCustomAction[]>> {
        return this._get({
            url: this.baseUrl + this.URLs.customActions,
            headers: CLIO_HEADERS,
            ...(params && Object.keys(params).length > 0 && { query: params }),
        });
    }

    /**
     * Get a single custom action by ID
     */
    async getCustomAction(
        customActionId: number | string,
        fields?: string,
    ): Promise<ClioResponse<ClioCustomAction>> {
        return this._get({
            url: this.baseUrl + this.URLs.customActionById(customActionId),
            headers: CLIO_HEADERS,
            ...(fields && { query: { fields } }),
        });
    }

    /**
     * Create a new custom action
     */
    async createCustomAction(
        params: CreateCustomActionParams,
    ): Promise<ClioResponse<ClioCustomAction>> {
        return this._post({
            url: this.baseUrl + this.URLs.customActions,
            headers: CLIO_HEADERS_JSON,
            body: { data: params },
        });
    }

    /**
     * Delete a custom action
     */
    async deleteCustomAction(customActionId: number | string): Promise<void> {
        return this._delete({
            url: this.baseUrl + this.URLs.customActionById(customActionId),
            headers: CLIO_HEADERS,
        });
    }

    /**
     * Verify custom action nonce for security
     * @param nonce - The nonce from the custom action request
     * @param expectedNonce - The expected nonce stored for this action
     * @returns boolean indicating if nonce is valid
     */
    verifyCustomActionNonce(nonce: string, expectedNonce: string): boolean {
        if (!nonce || !expectedNonce) {
            return false;
        }

        // Check lengths match before comparing to prevent timingSafeEqual from throwing
        if (nonce.length !== expectedNonce.length) {
            return false;
        }

        return crypto.timingSafeEqual(
            Buffer.from(nonce),
            Buffer.from(expectedNonce),
        );
    }

    // ==================== Matters ====================

    /**
     * List matters with optional filtering
     */
    async listMatters(
        params?: ListMattersParams,
    ): Promise<ClioResponse<ClioMatter[]>> {
        return this._get({
            url: this.baseUrl + this.URLs.matters,
            headers: CLIO_HEADERS,
            ...(params && Object.keys(params).length > 0 && { query: params }),
        });
    }

    /**
     * Get a single matter by ID
     */
    async getMatter(
        matterId: number | string,
        fields?: string,
    ): Promise<ClioResponse<ClioMatter>> {
        return this._get({
            url: this.baseUrl + this.URLs.matterById(matterId),
            headers: CLIO_HEADERS,
            ...(fields && { query: { fields } }),
        });
    }

    /**
     * Get contacts associated with a matter
     */
    async getMatterContacts(
        matterId: number | string,
        params?: ListContactsParams,
    ): Promise<ClioResponse<ClioContact[]>> {
        return this._get({
            url: this.baseUrl + this.URLs.matterContacts(matterId),
            headers: CLIO_HEADERS,
            ...(params && Object.keys(params).length > 0 && { query: params }),
        });
    }

    // ==================== Pagination Helpers ====================

    /**
     * Generic pagination helper that fetches all pages of a paginated endpoint
     * @param fetchFn - Function that fetches a single page
     * @param params - Initial params (page_token will be added automatically)
     * @returns Array of all items from all pages
     */
    async fetchAllPages<T, P extends { page_token?: string }>(
        fetchFn: (params?: P) => Promise<ClioResponse<T[]>>,
        params?: P,
    ): Promise<T[]> {
        const allItems: T[] = [];
        let pageToken: string | undefined;

        do {
            const queryParams = { ...params, page_token: pageToken } as P;
            const response = await fetchFn(queryParams);
            allItems.push(...response.data);
            pageToken = response.meta?.paging?.next;
        } while (pageToken);

        return allItems;
    }

    /**
     * Fetch all contacts with automatic pagination
     */
    async listAllContacts(
        params?: Omit<ListContactsParams, 'page_token'>,
    ): Promise<ClioContact[]> {
        return this.fetchAllPages(
            (p) => this.listContacts(p),
            params as ListContactsParams,
        );
    }

    /**
     * Fetch all matters with automatic pagination
     */
    async listAllMatters(
        params?: Omit<ListMattersParams, 'page_token'>,
    ): Promise<ClioMatter[]> {
        return this.fetchAllPages(
            (p) => this.listMatters(p),
            params as ListMattersParams,
        );
    }

    /**
     * Fetch all notes with automatic pagination
     */
    async listAllNotes(
        params?: Omit<ListNotesParams, 'page_token'>,
    ): Promise<ClioNote[]> {
        return this.fetchAllPages(
            (p) => this.listNotes(p),
            params as ListNotesParams,
        );
    }

    /**
     * Fetch all communications with automatic pagination
     */
    async listAllCommunications(
        params?: Omit<ListCommunicationsParams, 'page_token'>,
    ): Promise<ClioCommunication[]> {
        return this.fetchAllPages(
            (p) => this.listCommunications(p),
            params as ListCommunicationsParams,
        );
    }
}
