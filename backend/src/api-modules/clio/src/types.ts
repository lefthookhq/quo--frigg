// Clio API Type Definitions

// ==================== Base Types ====================

export type ClioRegion = 'us' | 'eu' | 'ca' | 'au';

export interface ClioOAuth2Options {
    access_token?: string;
    refresh_token?: string;
    region?: ClioRegion;
}

export interface ClioTokenResponse {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
}

// ==================== Response Wrapper ====================

export interface ClioResponse<T = any> {
    data: T;
    meta?: {
        paging?: {
            next?: string;
            previous?: string;
        };
        records?: number;
    };
}

// ==================== User Types ====================

export interface ClioUser {
    id: number;
    etag: string;
    name: string;
    first_name: string;
    last_name: string;
    email: string;
    created_at: string;
    updated_at: string;
    enabled: boolean;
    subscription_type: string;
    time_zone: string;
}

// ==================== Contact Types ====================

export interface ListContactsParams {
    fields?: string;
    limit?: number;
    page_token?: string;
    order?: string;
    query?: string;
    type?: 'Person' | 'Company';
    created_since?: string;
    updated_since?: string;
}

export interface ClioContact {
    id: number;
    etag: string;
    name: string;
    first_name?: string;
    middle_name?: string;
    last_name?: string;
    prefix?: string;
    title?: string;
    type: 'Person' | 'Company';
    created_at: string;
    updated_at: string;
    is_client: boolean;
    primary_email_address?: string;
    primary_phone_number?: string;
    phone_numbers?: ClioPhoneNumber[];
    email_addresses?: ClioEmailAddress[];
    company?: {
        id: number;
        name?: string;
    };
}

export interface ClioPhoneNumber {
    id: number;
    etag?: string;
    number: string;
    name: string;
    default_number: boolean;
    created_at?: string;
    updated_at?: string;
}

export interface ClioEmailAddress {
    id: number;
    etag?: string;
    address: string;
    name: string;
    default_email: boolean;
    created_at?: string;
    updated_at?: string;
}

export interface ListPhoneNumbersParams {
    fields?: string;
    limit?: number;
    page_token?: string;
}

export interface ListEmailAddressesParams {
    fields?: string;
    limit?: number;
    page_token?: string;
}

// ==================== Note Types ====================

export interface ListNotesParams {
    fields?: string;
    limit?: number;
    page_token?: string;
    order?: string;
    regarding_id?: number;
    regarding_type?: string;
    created_since?: string;
    updated_since?: string;
}

export interface ClioNote {
    id: number;
    etag: string;
    subject: string;
    detail: string;
    date: string;
    created_at: string;
    updated_at: string;
    regarding?: {
        id: number;
        type: string;
        name?: string;
    };
}

export interface CreateNoteParams {
    subject: string;
    detail: string;
    detail_text_type?: 'plain_text' | 'rich_text';
    date?: string;
    regarding?: {
        type: string;
        id: number;
    };
}

export interface UpdateNoteParams {
    subject?: string;
    detail?: string;
    detail_text_type?: 'plain_text' | 'rich_text';
    date?: string;
}

// ==================== Communication Types (Call Logging) ====================

export interface ListCommunicationsParams {
    fields?: string;
    limit?: number;
    page_token?: string;
    order?: string;
    matter_id?: number;
    type?: 'PhoneCommunication' | 'EmailCommunication';
    created_since?: string;
    updated_since?: string;
}

// ==================== Matter Types ====================

export interface ListMattersParams {
    fields?: string;
    limit?: number;
    page_token?: string;
    order?: string;
    query?: string;
    status?: 'Open' | 'Pending' | 'Closed';
    client_id?: number;
    created_since?: string;
    updated_since?: string;
}

export interface ClioMatter {
    id: number;
    etag: string;
    display_number: string;
    description: string;
    status: 'Open' | 'Pending' | 'Closed';
    open_date: string;
    close_date?: string;
    pending_date?: string;
    created_at: string;
    updated_at: string;
    client?: {
        id: number;
        name?: string;
    };
    responsible_attorney?: {
        id: number;
        name?: string;
    };
    practice_area?: {
        id: number;
        name?: string;
    };
}

export interface ClioCommunication {
    id: number;
    etag: string;
    type: string;
    subject: string;
    body?: string;
    date: string;
    received_at: string;
    created_at: string;
    updated_at: string;
    senders?: Array<{
        id: number;
        type: string;
        name?: string;
    }>;
    receivers?: Array<{
        id: number;
        type: string;
        name?: string;
    }>;
    matter?: {
        id: number;
        display_number?: string;
    };
    external_properties?: Array<{
        name: string;
        value: string;
    }>;
}

export interface CreateCommunicationParams {
    type: 'PhoneCommunication' | 'EmailCommunication';
    subject: string;
    body?: string;
    date?: string;
    received_at: string;
    senders?: Array<{
        type: string;
        id: number;
        name?: string;
    }>;
    receivers?: Array<{
        type: string;
        id: number;
        name?: string;
    }>;
    matter?: {
        id: number;
    };
    external_properties?: Array<{
        name: string;
        value: string;
    }>;
}

export interface UpdateCommunicationParams {
    subject?: string;
    body?: string;
    date?: string;
    received_at?: string;
    external_properties?: Array<{
        name: string;
        value: string;
    }>;
}

// ==================== Webhook Types ====================

export interface ListWebhooksParams {
    fields?: string;
    limit?: number;
    page_token?: string;
}

export interface ClioWebhook {
    id: number;
    etag: string;
    url: string;
    fields?: string;
    events: string[];
    model: string;
    status: 'pending' | 'enabled' | 'suspended';
    expires_at: string;
    shared_secret?: string;
    created_at: string;
    updated_at: string;
}

export interface CreateWebhookParams {
    url: string;
    fields?: string;
    events: string[];
    model: string;
    expires_at?: string;
    status?: 'pending' | 'enabled' | 'suspended';
}

export interface UpdateWebhookParams {
    url?: string;
    fields?: string;
    events?: string[];
    expires_at?: string;
    status?: 'pending' | 'enabled' | 'suspended';
}

// ==================== Custom Action Types (Click-to-Call) ====================

export interface ListCustomActionsParams {
    fields?: string;
    limit?: number;
    page_token?: string;
}

export interface ClioCustomAction {
    id: number;
    etag: string;
    label: string;
    url: string;
    ui_reference: string;
    created_at: string;
    updated_at: string;
}

export interface CreateCustomActionParams {
    label: string;
    url: string;
    ui_reference: string;
}
