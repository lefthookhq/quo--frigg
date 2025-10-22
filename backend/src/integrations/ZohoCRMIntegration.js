const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');
const { Definition: QuoDefinition } = require('../api-modules/quo/definition');
const zohoCrm = require('@friggframework/api-module-zoho-crm');

class ZohoCRMIntegration extends BaseCRMIntegration {
    static Definition = {
        name: 'zohoCrm',
        version: '1.0.0',
        supportedVersions: ['1.0.0'],
        hasUserConfig: true,

        display: {
            label: 'Zoho CRM',
            description: 'Zoho CRM platform integration with Quo API',
            category: 'CRM & Sales',
            detailsUrl: 'https://www.zoho.com/crm',
            icon: '',
        },
        modules: {
            quo: { definition: QuoDefinition },
            zohoCrm: {
                definition: zohoCrm.Definition,
            },
        },
        routes: [
            {
                path: '/zoho/contacts',
                method: 'GET',
                event: 'LIST_ZOHO_CONTACTS',
            },
            {
                path: '/zoho/accounts',
                method: 'GET',
                event: 'LIST_ZOHO_ACCOUNTS',
            },
        ],
    };

    static CRMConfig = {
        personObjectTypes: [
            { crmObjectName: 'Contact', quoContactType: 'contact' },
            { crmObjectName: 'Account', quoContactType: 'contact' },
        ],
        syncConfig: {
            paginationType: 'CURSOR_BASED',
            supportsTotal: false,
            returnFullRecords: true,
            reverseChronological: true,
            initialBatchSize: 50,
            ongoingBatchSize: 25,
            supportsWebhooks: false,
            pollIntervalMinutes: 60,
        },
        queueConfig: {
            maxWorkers: 15,
            provisioned: 5,
            maxConcurrency: 50,
            batchSize: 1,
            timeout: 600,
        },
    };

    constructor(params) {
        super(params);

        this.events = {
            ...this.events,

            LIST_ZOHO_CONTACTS: {
                handler: this.listContacts,
            },
            LIST_ZOHO_ACCOUNTS: {
                handler: this.listAccounts,
            },
        };
    }

    async fetchPersonPage({
        objectType,
        cursor = null,
        limit,
        modifiedSince,
        sortDesc = true,
    }) {
        try {
            const params = {
                per_page: limit,
                sort_order: sortDesc ? 'desc' : 'asc',
                sort_by: 'Modified_Time',
            };

            if (cursor) {
                params.page_token = cursor;
            }

            if (modifiedSince) {
                params.modified_since = modifiedSince
                    .toISOString()
                    .split('T')[0];
            }

            let response;

            switch (objectType) {
                case 'Contact':
                    response = await this.zohoCrm.api.listContacts(params);
                    break;

                case 'Account':
                    response = await this.zohoCrm.api.listAccounts(params);
                    break;

                default:
                    throw new Error(`Unsupported objectType: ${objectType}`);
            }

            const persons = response.data || [];

            const taggedPersons = persons.map((person) => ({
                ...person,
                _objectType: objectType,
            }));

            const nextCursor = response.info?.next_page_token || null;
            const hasMore = response.info?.more_records || false;

            console.log(
                `[Zoho] Fetched ${taggedPersons.length} ${objectType}(s) at cursor ${cursor || 'start'}, ` +
                    `hasMore=${hasMore}`,
            );

            return {
                data: taggedPersons,
                cursor: nextCursor,
                hasMore: hasMore,
            };
        } catch (error) {
            console.error(
                `Error fetching ${objectType} at cursor ${cursor}:`,
                error,
            );
            throw error;
        }
    }

    transformPersonToQuo(person) {
        const objectType = person._objectType || 'Contact';

        const phoneNumbers = this._extractPhoneNumbers(person, objectType);
        const emails = this._extractEmails(person, objectType);
        const firstName = this._extractFirstName(person, objectType);
        const company = this._extractCompany(person, objectType);

        const externalId = String(person.id || person.Id || 'unknown');
        const source =
            objectType === 'Account' ? 'zoho-account' : 'zoho-contact';

        return {
            externalId,
            source,
            defaultFields: {
                firstName,
                lastName: person.Last_Name || '',
                company,
                phoneNumbers,
                emails,
            },
            customFields: [],
        };
    }

    _extractFirstName(person, objectType) {
        if (objectType === 'Account') {
            return person.Account_Name || 'Unknown';
        }
        return person.First_Name || 'Unknown';
    }

    _extractPhoneNumbers(person, objectType) {
        const phones = [];

        if (person.Phone) {
            phones.push({ name: 'work', value: person.Phone });
        }

        if (objectType === 'Contact' && person.Mobile) {
            phones.push({ name: 'mobile', value: person.Mobile });
        }

        return phones;
    }

    _extractEmails(person, objectType) {
        const emails = [];

        if (objectType === 'Contact' && person.Email) {
            emails.push({ name: 'work', value: person.Email });
        }

        return emails;
    }

    _extractCompany(person, objectType) {
        if (objectType === 'Account') {
            return person.Parent_Account?.name || null;
        }
        return person.Account_Name?.name || person.Company || null;
    }

    async logSMSToActivity(activity) {
        console.warn(
            'SMS activity logging not supported - Zoho CRM API module lacks activities endpoint',
        );
        return;
    }

    async logCallToActivity(activity) {
        console.warn(
            'Call activity logging not supported - Zoho CRM API module lacks activities endpoint',
        );
        return;
    }

    async setupWebhooks() {
        console.log(
            'Zoho CRM webhooks not configured - using polling fallback',
        );
    }

    async fetchPersonById(id) {
        try {
            const contact = await this.zohoCrm.api.getContact(id);
            return { ...contact.data, _objectType: 'Contact' };
        } catch (contactError) {
            try {
                const account = await this.zohoCrm.api.getAccount(id);
                return { ...account.data, _objectType: 'Account' };
            } catch (accountError) {
                throw new Error(`Person not found: ${id}`);
            }
        }
    }

    async findPersonByExternalId(externalId) {
        try {
            const contact = await this.zohoCrm.api.getContact(externalId);
            return { ...contact.data, _objectType: 'Contact' };
        } catch (contactError) {
            try {
                const account = await this.zohoCrm.api.getAccount(externalId);
                return { ...account.data, _objectType: 'Account' };
            } catch (accountError) {
                return null;
            }
        }
    }

    async fetchPersonsByIds(ids) {
        if (!ids || ids.length === 0) {
            return [];
        }

        const contacts = [];
        for (const id of ids) {
            try {
                const contact = await this.fetchPersonById(id);
                contacts.push(contact);
            } catch (error) {
                console.error(`Failed to fetch contact ${id}:`, error.message);
            }
        }
        return contacts;
    }

    async listContacts({ req, res }) {
        try {
            const params = {
                per_page: req.query.per_page
                    ? parseInt(req.query.per_page)
                    : 50,
                page: req.query.page ? parseInt(req.query.page) : 1,
                sort_order: req.query.sort_order || 'asc',
                sort_by: req.query.sort_by || 'Created_Time',
            };

            const contacts = await this.zohoCrm.api.listContacts(params);
            res.json(contacts);
        } catch (error) {
            console.error('Failed to list Zoho contacts:', error);
            res.status(500).json({
                error: 'Failed to list contacts',
                details: error.message,
            });
        }
    }

    async listAccounts({ req, res }) {
        try {
            const params = {
                per_page: req.query.per_page
                    ? parseInt(req.query.per_page)
                    : 50,
                page: req.query.page ? parseInt(req.query.page) : 1,
                sort_order: req.query.sort_order || 'asc',
                sort_by: req.query.sort_by || 'Created_Time',
            };

            const accounts = await this.zohoCrm.api.listAccounts(params);
            res.json(accounts);
        } catch (error) {
            console.error('Failed to list Zoho accounts:', error);
            res.status(500).json({
                error: 'Failed to list accounts',
                details: error.message,
            });
        }
    }
}

module.exports = ZohoCRMIntegration;
