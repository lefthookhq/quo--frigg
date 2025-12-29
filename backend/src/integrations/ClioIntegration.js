const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');
const { createFriggCommands } = require('@friggframework/core');
const clio = require('../api-modules/clio');
const quo = require('../api-modules/quo');
// eslint-disable-next-line no-unused-vars
const { QUO_ANALYTICS_EVENTS, QuoWebhookEvents } = require('../base/constants');

class ClioIntegration extends BaseCRMIntegration {
    static Definition = {
        name: 'clio',
        version: '1.0.0',
        supportedVersions: ['1.0.0'],
        hasUserConfig: true,
        webhooks: {
            enabled: true,
        },

        display: {
            label: 'Clio',
            description: 'Legal practice management integration with Quo',
            category: 'CRM, Legal',
            detailsUrl: 'https://www.clio.com',
            icon: '',
        },
        modules: {
            clio: { definition: clio.Definition },
            quo: {
                definition: {
                    ...quo.Definition,
                    getName: () => 'quo-clio',
                    moduleName: 'quo-clio',
                    display: {
                        ...(quo.Definition.display || {}),
                        label: 'Quo (Clio)',
                    },
                },
            },
        },
        routes: [
            {
                path: '/clio/contacts',
                method: 'GET',
                event: 'LIST_CLIO_CONTACTS',
            },
            {
                path: '/clio/matters',
                method: 'GET',
                event: 'LIST_CLIO_MATTERS',
            },
        ],
    };

    static CRMConfig = {
        personObjectTypes: [
            { crmObjectName: 'Person', quoContactType: 'contact' },
            { crmObjectName: 'Company', quoContactType: 'company' },
        ],
        syncConfig: {
            paginationType: 'CURSOR_BASED',
            supportsTotal: true,
            returnFullRecords: true,
            reverseChronological: true,
            initialBatchSize: 100,
            ongoingBatchSize: 50,
            supportsWebhooks: true,
        },
        queueConfig: {
            maxWorkers: 15,
            provisioned: 5,
            maxConcurrency: 50,
            batchSize: 1,
            timeout: 600,
        },
    };

    static WEBHOOK_LABELS = {
        QUO_MESSAGES: 'Clio Integration - Messages',
        QUO_CALLS: 'Clio Integration - Calls',
        QUO_CALL_SUMMARIES: 'Clio Integration - Call Summaries',
    };

    static WEBHOOK_EVENTS = {
        CLIO: ['created', 'updated', 'deleted'],
        QUO_MESSAGES: [
            QuoWebhookEvents.MESSAGE_RECEIVED,
            QuoWebhookEvents.MESSAGE_DELIVERED,
        ],
        QUO_CALLS: [
            QuoWebhookEvents.CALL_COMPLETED,
            QuoWebhookEvents.CALL_RECORDING_COMPLETED,
        ],
        QUO_CALL_SUMMARIES: [QuoWebhookEvents.CALL_SUMMARY_COMPLETED],
    };

    constructor(params) {
        super(params);

        this.commands = createFriggCommands({
            integrationClass: ClioIntegration,
        });

        this.events = {
            ...this.events,

            LIST_CLIO_CONTACTS: {
                handler: this.listContacts,
            },
            LIST_CLIO_MATTERS: {
                handler: this.listMatters,
            },
            ON_WEBHOOK: {
                handler: this.onWebhook,
            },
        };
    }

    static CONTACT_FIELDS =
        'id,etag,name,first_name,middle_name,last_name,prefix,title,type,' +
        'created_at,updated_at,is_client,primary_email_address,primary_phone_number,' +
        'phone_numbers{id,number,name,default_number},' +
        'email_addresses{id,address,name,default_email},' +
        'company{id,name}';

    async fetchPersonPage({
        objectType,
        cursor = null,
        limit,
        modifiedSince,
        sortDesc = true,
    }) {
        try {
            const params = {
                limit,
                type: objectType,
                fields: ClioIntegration.CONTACT_FIELDS,
            };

            if (cursor) {
                if (cursor.startsWith('http')) {
                    try {
                        const cursorUrl = new URL(cursor);
                        params.page_token = cursorUrl.searchParams.get('page_token');
                    } catch {
                        params.page_token = cursor;
                    }
                } else {
                    params.page_token = cursor;
                }
            }

            if (modifiedSince) {
                params.updated_since = modifiedSince.toISOString();
            }

            params.order = sortDesc ? 'id(desc)' : 'id(asc)';

            const response = await this.clio.api.listContacts(params);
            const contacts = response.data || [];

            let nextCursor = null;
            if (response.meta?.paging?.next) {
                try {
                    const nextUrl = new URL(response.meta.paging.next);
                    nextCursor = nextUrl.searchParams.get('page_token');
                } catch {
                    nextCursor = null;
                }
            }

            console.log(
                `[Clio] Fetched ${contacts.length} ${objectType}(s) at cursor ${cursor || 'start'}, ` +
                    `hasMore=${!!nextCursor}`,
            );

            return {
                data: contacts,
                cursor: nextCursor,
                hasMore: !!nextCursor,
            };
        } catch (error) {
            console.error(
                `[Clio] Error fetching ${objectType} at cursor ${cursor}:`,
                error,
            );
            throw error;
        }
    }

    async transformPersonToQuo(contact, companyMap = null) {
        const isPerson = contact.type === 'Person';

        let firstName;
        let lastName;

        if (isPerson) {
            firstName = contact.middle_name
                ? `${contact.first_name || ''} ${contact.middle_name}`.trim()
                : contact.first_name || '';
            lastName = contact.last_name || '';

            if (!firstName && !lastName) {
                firstName = 'Unknown';
            }
        } else {
            firstName = contact.name || 'Unknown';
            lastName = '';
        }

        const phoneNumbers = (contact.phone_numbers || [])
            .filter((p) => p.number)
            .map((p) => ({
                name: this._capitalizeLabel(p.name) || 'Work',
                value: p.number,
                primary: p.default_number || false,
            }));

        const emails = (contact.email_addresses || [])
            .filter((e) => e.address)
            .map((e) => ({
                name: this._capitalizeLabel(e.name) || 'Work',
                value: e.address,
                primary: e.default_email || false,
            }));

        let company = null;
        if (isPerson && contact.company) {
            if (contact.company.name) {
                company = contact.company.name;
            } else if (companyMap && companyMap.has(contact.company.id)) {
                const companyData = companyMap.get(contact.company.id);
                company = companyData?.name || null;
            }
        }

        const sourceUrl = this._generateClioSourceUrl(contact.id);

        return {
            externalId: String(contact.id),
            source: 'openphone-clio',
            sourceUrl,
            isEditable: false,
            defaultFields: {
                firstName,
                lastName,
                company,
                role: contact.title || null,
                phoneNumbers,
                emails,
            },
            customFields: [],
            sourceEntityType: isPerson ? 'person' : 'company',
        };
    }

    async transformPersonsToQuo(contacts) {
        if (!contacts || contacts.length === 0) {
            return [];
        }

        const companyIds = new Set();
        for (const contact of contacts) {
            if (
                contact.type === 'Person' &&
                contact.company?.id &&
                !contact.company?.name
            ) {
                companyIds.add(contact.company.id);
            }
        }

        let companyMap = new Map();
        if (companyIds.size > 0) {
            console.log(
                `[Clio] Pre-fetching ${companyIds.size} companies for batch transform`,
            );

            const companyPromises = [...companyIds].map(async (id) => {
                try {
                    const response = await this.clio.api.getContact(
                        id,
                        'id,name',
                    );
                    return { id, data: response.data };
                } catch (error) {
                    console.warn(
                        `[Clio] Failed to fetch company ${id}:`,
                        error.message,
                    );
                    return { id, data: null };
                }
            });

            const companyResults = await Promise.all(companyPromises);
            for (const { id, data } of companyResults) {
                if (data) {
                    companyMap.set(id, data);
                }
            }
        }

        return Promise.all(
            contacts.map((contact) =>
                this.transformPersonToQuo(contact, companyMap),
            ),
        );
    }

    async logSMSToActivity() {
        throw new Error('ClioIntegration.logSMSToActivity() not implemented');
    }

    async logCallToActivity() {
        throw new Error('ClioIntegration.logCallToActivity() not implemented');
    }

    async setupWebhooks() {
        throw new Error('ClioIntegration.setupWebhooks() not implemented');
    }

    _verifyWebhookSignature({ signature, payload, secret }) {
        if (!signature || !secret) {
            return false;
        }

        try {
            const crypto = require('crypto');
            const hmac = crypto.createHmac('sha256', secret);
            hmac.update(payload);
            const expectedSignature = hmac.digest('hex');

            if (signature.length !== expectedSignature.length) {
                return false;
            }

            return crypto.timingSafeEqual(
                Buffer.from(signature),
                Buffer.from(expectedSignature),
            );
        } catch (error) {
            console.error('[Clio] Signature verification error:', error);
            return false;
        }
    }

    async _verifyQuoWebhookSignature(headers, body, eventType) {
        const signatureHeader = headers['openphone-signature'];

        if (!signatureHeader) {
            throw new Error('Missing Openphone-Signature header');
        }

        const parts = signatureHeader.split(';');
        if (parts.length !== 4 || parts[0] !== 'hmac') {
            throw new Error('Invalid Openphone-Signature format');
        }

        // eslint-disable-next-line no-unused-vars
        const [_hmacPrefix, _version, timestamp, receivedSignature] = parts;

        let webhookKey;
        if (eventType.startsWith('call.summary')) {
            webhookKey = this.config?.quoCallSummaryWebhookKey;
        } else if (eventType.startsWith('call.')) {
            webhookKey = this.config?.quoCallWebhookKey;
        } else if (eventType.startsWith('message.')) {
            webhookKey = this.config?.quoMessageWebhookKey;
        } else {
            throw new Error(
                `Unknown event type for key selection: ${eventType}`,
            );
        }

        if (!webhookKey) {
            throw new Error('Webhook key not found in config');
        }

        const crypto = require('crypto');

        const testFormats = [
            {
                name: 'timestamp + body (no separator)',
                payload: timestamp + JSON.stringify(body),
                keyTransform: 'plain',
            },
            {
                name: 'timestamp + body (no separator, base64 key)',
                payload: timestamp + JSON.stringify(body),
                keyTransform: 'base64',
            },
            {
                name: 'timestamp + "." + body (dot separator)',
                payload: timestamp + '.' + JSON.stringify(body),
                keyTransform: 'plain',
            },
            {
                name: 'timestamp + "." + body (dot separator, base64 key)',
                payload: timestamp + '.' + JSON.stringify(body),
                keyTransform: 'base64',
            },
        ];

        let matchFound = false;

        for (const format of testFormats) {
            const key =
                format.keyTransform === 'base64'
                    ? Buffer.from(webhookKey, 'base64')
                    : webhookKey;

            const hmac = crypto.createHmac('sha256', key);
            hmac.update(format.payload);
            const computedSignature = hmac.digest('base64');

            if (computedSignature === receivedSignature) {
                matchFound = true;
                break;
            }
        }

        if (!matchFound) {
            throw new Error(
                'Webhook signature verification failed - no matching format found',
            );
        }

        console.log('[Quo Webhook] Signature verified');
    }

    listContacts = async ({ req, res }) => {
        try {
            const { page_token } = req.query;
            const limitParam = parseInt(req.query.limit, 10);
            const limit =
                !isNaN(limitParam) && limitParam > 0 && limitParam <= 200
                    ? limitParam
                    : 50;

            const response = await this.clio.api.listContacts({
                limit,
                page_token,
            });

            res.json({
                data: response.data,
                paging: response.meta?.paging,
            });
        } catch (error) {
            console.error('[Clio] listContacts error:', error.message);
            res.status(500).json({
                error: error.message,
            });
        }
    };

    listMatters = async ({ req, res }) => {
        try {
            const { page_token } = req.query;
            const limitParam = parseInt(req.query.limit, 10);
            const limit =
                !isNaN(limitParam) && limitParam > 0 && limitParam <= 200
                    ? limitParam
                    : 50;

            const response = await this.clio.api.listMatters({
                limit,
                page_token,
            });

            res.json({
                data: response.data,
                paging: response.meta?.paging,
            });
        } catch (error) {
            console.error('[Clio] listMatters error:', error.message);
            res.status(500).json({
                error: error.message,
            });
        }
    };

    onWebhook = async ({ data }) => {
        const eventType = data?.type || data?.event || 'unknown';
        const eventId = data?.id || data?.data?.id || 'unknown';
        console.log(
            `[Clio] Webhook received: type=${eventType}, id=${eventId}`,
        );

        throw new Error('ClioIntegration.onWebhook() not fully implemented');
    };

    _normalizePhoneNumber(phone) {
        if (!phone || typeof phone !== 'string') return phone;
        return phone.replace(/[\s\(\)\-]/g, '');
    }

    _generateWebhookUrl(path) {
        if (!process.env.BASE_URL) {
            throw new Error(
                'BASE_URL environment variable is required for webhook setup.',
            );
        }

        const integrationName = this.constructor.Definition.name;
        return `${process.env.BASE_URL}/api/${integrationName}-integration${path}`;
    }

    _capitalizeLabel(label) {
        if (!label || typeof label !== 'string') {
            return label;
        }
        return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
    }

    _generateClioSourceUrl(contactId) {
        const region = this.clio?.api?.region || 'us';
        const baseUrl =
            region === 'us'
                ? 'https://app.clio.com'
                : `https://${region}.app.clio.com`;
        return `${baseUrl}/contacts/${contactId}`;
    }
}

module.exports = ClioIntegration;
