const {OAuth2Requester, get} = require('@friggframework/core');

class Api extends OAuth2Requester {
    constructor(params) {
        super(params);
        // The majority of the properties for OAuth are default loaded by OAuth2Requester.
        // This includes the `client_id`, `client_secret`, `scopes`, and `redirect_uri`.
        this.baseUrl = 'https://api.hubapi.com';

        this.URLs = {
            authorization: '/oauth/authorize',
            access_token: '/oauth/v1/token',
            contacts: '/crm/v3/objects/contacts',
            contactById: (contactId) => `/crm/v3/objects/contacts/${contactId}`,
            getBatchContactsById: '/crm/v3/objects/contacts/batch/read',
            companies: '/crm/v3/objects/companies',
            companyById: (compId) => `/crm/v3/objects/companies/${compId}`,
            companySearch: '/crm/v3/objects/companies/search',
            getBatchCompaniesById: '/crm/v3/objects/companies/batch/read',
            createTimelineEvent: '/crm/v3/timeline/events',
            userDetails: '/integrations/v1/me',
            domain: (accessToken) => `/oauth/v1/access-tokens/${accessToken}`,
            properties: (objType) => `/crm/v3/properties/${objType}`,
            propertiesByName: (objType, propName) =>
                `/crm/v3/properties/${objType}/${propName}`,
            deals: '/crm/v3/objects/deals',
            dealById: (dealId) => `/crm/v3/objects/deals/${dealId}`,
            searchDeals: '/crm/v3/objects/deals/search',
            readBatchAssociations: (fromObjectType, toObjectType) =>
                `/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/read`,
            createBatchAssociations: (fromObjectType, toObjectType) =>
                `/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/create`,
            createBatchAssociationsDefault: (fromObjectType, toObjectType) =>
                `/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/associate/default`,
            deleteBatchAssociations: (fromObjectType, toObjectType) =>
                `/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/archive`,
            deleteBatchAssociationLabels: (fromObjectType, toObjectType) =>
                `/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/labels/archive`,
            v1DealInfo: (dealId) => `/deals/v1/deal/${dealId}`,
            getPipelineDetails: (objType) => `/crm/v3/pipelines/${objType}`,
            getOwnerById: (ownerId) => `/owners/v2/owners/${ownerId}`,
            contactList: '/contacts/v1/lists',
            contactListById: (listId) => `/contacts/v1/lists/${listId}`,
            customObjectSchemas: '/crm/v3/schemas',
            customObjectSchemaByObjectType: (objectType) =>
                `/crm/v3/schemas/${objectType}`,
            customObjects: (objectType) => `/crm/v3/objects/${objectType}`,
            customObjectsSearch: (objectType) => `/crm/v3/objects/${objectType}/search`,
            customObjectById: (objectType, objId) =>
                `/crm/v3/objects/${objectType}/${objId}`,
            bulkCreateCustomObjects: (objectType) =>
                `/crm/v3/objects/${objectType}/batch/create`,
            bulkReadCustomObjects: (objectType) =>
                `/crm/v3/objects/${objectType}/batch/read`,
            bulkUpdateCustomObjects: (objectType) =>
                `/crm/v3/objects/${objectType}/batch/update`,
            bulkArchiveCustomObjects: (objectType) =>
                `/crm/v3/objects/${objectType}/batch/archive`,
            landingPages: '/cms/v3/pages/landing-pages',
            sitePages: '/cms/v3/pages/site-pages',
            blogPosts: '/cms/v3/blogs/posts',
            landingPageById: (landingPageId) => `/cms/v3/pages/landing-pages/${landingPageId}`,
            sitePageById: (sitePageId) => `/cms/v3/pages/site-pages/${sitePageId}`,
            blogPostById: (blogPostId) => `/cms/v3/blogs/posts/${blogPostId}`,
            emailTemplates: '/content/api/v2/templates',
            emailTemplateById: (templateId) => `/content/api/v2/templates/${templateId}`,
            lists: '/crm/v3/lists',
            listById: (listId) => `/crm/v3/lists/${listId}`,
            listSearch: '/crm/v3/lists/search',
            listMemberships: (listId) => `/crm/v3/lists/${listId}/memberships`,
            listMembershipsAddRemove: (listId) => `/crm/v3/lists/${listId}/memberships/add-and-remove`,
            associations: (fromObject, toObject) => `/crm/v4/associations/${fromObject}/${toObject}`,
            associationLabels: (fromObject, toObject) => `/crm/v4/associations/${fromObject}/${toObject}/labels`,

        };

        this.authorizationUri = encodeURI(
            `https://app.hubspot.com/oauth/authorize?client_id=${this.client_id}&redirect_uri=${this.redirect_uri}&scope=${this.scope}&state=${this.state}`
        );
        this.tokenUri = 'https://api.hubapi.com/oauth/v1/token';

        this.access_token = get(params, 'access_token', null);
        this.refresh_token = get(params, 'refresh_token', null);
    }

    getAuthUri() {
        return this.authorizationUri;
    }

    addJsonHeaders(options) {
        const jsonHeaders = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
        };
        options.headers = {
            ...jsonHeaders,
            ...options.headers,
        }
    }
    async _post(options, stringify) {
        this.addJsonHeaders(options);
        return super._post(options, stringify);
    }

    async _patch(options, stringify) {
        this.addJsonHeaders(options);
        return super._patch(options, stringify);
    }

    async _put(options, stringify) {
        this.addJsonHeaders(options);
        return super._put(options, stringify);
    }

    // **************************   Companies   **********************************

    async createCompany(body) {
        const options = {
            url: this.baseUrl + this.URLs.companies,
            body: {
                properties: body,
            },
        };

        return this._post(options);
    }

    async listCompanies() {
        const options = {
            url: this.baseUrl + this.URLs.companies,
        };

        return this._get(options);
    }

    async updateCompany(id, body) {
        const options = {
            url: this.baseUrl + this.URLs.companyById(id),
            body,
        };
        return this._patch(options);
    }

    async searchCompanies(body) {
        const options = {
            url: this.baseUrl + this.URLs.companySearch,
            body,
        };
        return this._post(options);
    }

    // Docs described endpoint as archive company instead of delete. Will have to make due.
    async archiveCompany(compId) {
        const options = {
            url: this.baseUrl + this.URLs.companyById(compId),
        };

        return this._delete(options);
    }

    async getCompanyById(compId) {
        const propsString = await this._propertiesList('company');

        const options = {
            url: this.baseUrl + this.URLs.companyById(compId),
            query: {
                properties: propsString,
                associations: 'contacts',
            },
        };

        return this._get(options);
    }

    async batchGetCompaniesById(params) {
        // inputs.length should be < 100
        const inputs = get(params, 'inputs');
        const properties = get(params, 'properties', []);

        const body = {
            inputs,
            properties,
        };
        const options = {
            url: this.baseUrl + this.URLs.getBatchCompaniesById,
            body,
            query: {
                archived: 'false',
            },
        };
        return this._post(options);
    }

    // **************************   Contacts   **********************************

    async createContact(body) {
        const options = {
            url: this.baseUrl + this.URLs.contacts,
            body: {
                properties: body,
            },
        };

        return this._post(options);
    }

    async listContacts(params) {
        const limit = get(params, 'limit', 100);
        const after = get(params, 'after', null);

        let properties = get(params, 'properties', null);
        if (!properties) {
            properties = await this._propertiesList('contact');
        }

        const options = {
            url: this.baseUrl + this.URLs.contacts,
            query: {
                limit,
                after,
                properties,
            }
        };

        return this._get(options);
    }

    async archiveContact(id) {
        const options = {
            url: this.baseUrl + this.URLs.contactById(id),
        };

        return this._delete(options);
    }

    async getContactById(contactId) {
        const propsString = await this._propertiesList('contact');

        const options = {
            url: this.baseUrl + this.URLs.contactById(contactId),
            query: {
                properties: propsString,
            },
        };

        return this._get(options);
    }

    async updateContact(contactId, properties) {
        const options = {
            url: this.baseUrl + this.URLs.contactById(contactId),
            body: {
                properties,
            },
        }
        return this._patch(options);
    }

    async batchGetContactsById(body) {
        // const props = await this.listProperties('contact');
        // const properties = props.results.map((prop) => prop.name);
        /* Example Contacts:
        [{id: 1}] */
        /* Example properties:
        [''] */

        const options = {
            url: this.baseUrl + this.URLs.getBatchContactsById,
            body,
            query: {
                archived: 'false',
            },
        };
        return this._post(options);
    }

    // **************************   Deals   **********************************

    async createDeal(body) {
        const options = {
            url: this.baseUrl + this.URLs.deals,
            body: {
                properties: body,
            },
        };

        return this._post(options);
    }

    async archiveDeal(dealId) {
        const options = {
            url: this.baseUrl + this.URLs.dealById(dealId),
        };

        return this._delete(options);
    }

    async getDealById(dealId) {
        const propsString = await this._propertiesList('deal');

        const options = {
            url: this.baseUrl + this.URLs.dealById(dealId),
            query: {
                properties: propsString,
                associations: 'contacts,company',
            },
        };
        return this._get(options);
    }

    async getDealStageHistory(dealId) {
        const options = {
            url: this.baseUrl + this.URLs.v1DealInfo(dealId),
            query: {includePropertyVersions: true},
        };
        const res = await this._get(options);
        return res.properties.dealstage.versions;
    }

    // pageObj can look something like this:
    // { limit: 10, after: 10 }
    async listDeals(pageObj) {
        const propsString = await this._propertiesList('deal');

        const options = {
            url: this.baseUrl + this.URLs.deals,
            query: {
                properties: propsString,
                associations: 'contacts,companies',
            },
        };
        if (pageObj) {
            Object.assign(options.query, pageObj);
        }
        return this._get(options);
    }

    async searchDeals(params) {
        const allProps = get(params, 'allProps', true);
        const propsArray = get(params, 'props', []);
        const limit = get(params, 'limit', 10);
        const after = get(params, 'after', 0);
        const filterGroups = get(params, 'filterGroups', []);
        const sorts = get(params, 'sorts', []);

        if (allProps && propsArray.length === 0) {
            const dealProps = await this.listProperties('deal');
            for (const prop of dealProps.results) {
                propsArray.push(prop.name);
            }
        }

        const searchBody = {
            filterGroups,
            sorts,
            after,
            properties: propsArray,
            limit,
        };

        const options = {
            url: this.baseUrl + this.URLs.searchDeals,
            body: searchBody,
        };
        return this._post(options);
    }

    async updateDeal(params) {
        const dealId = get(params, 'dealId');
        const properties = get(params, 'properties');
        const body = {properties};
        const options = {
            url: this.baseUrl + this.URLs.getDealById(dealId),
            body,
        };
        return this._patch(options);
    }

    // **************************   Contact Lists *****************************

    async createContactList(body) {
        const options = {
            url: this.baseUrl + this.URLs.contactList,
            body,
        };

        return this._post(options);
    }

    async deleteContactList(listId) {
        const options = {
            url: this.baseUrl + this.URLs.contactListById(listId),
        };

        return this._delete(options);
    }

    async getContactListById(listId) {
        const options = {
            url: this.baseUrl + this.URLs.contactListById(listId),
        };

        return this._get(options);
    }

    async listContactLists() {
        const options = {
            url: this.baseUrl + this.URLs.contactList,
        };

        return this._get(options);
    }

    async updateContactList(listId, body) {
        const options = {
            url: this.baseUrl + this.URLs.contactListById(listId),
            body,
        };
        return this._post(options);
    }

    //* **************************   Custom Object Schemas   ******************* */

    async createCustomObjectSchema(body) {
        const options = {
            url: this.baseUrl + this.URLs.customObjectSchemas,
            body,
        };


        return this._post(options);
    }

    async deleteCustomObjectSchema(objectType, hardDelete) {
        // This is a hard delete. Softer would be without query
        // Either way, this can only be done after all records of the objectType are deleted.
        const options = {
            url:
                this.baseUrl +
                this.URLs.customObjectSchemaByObjectType(objectType),
            query: {},
        };

        if (this.api_key) {
            options.query.hapikey = this.api_key;
        }
        if (hardDelete) {
            options.query.archived = true;
        }

        return this._delete(options);
    }

    async getCustomObjectSchema(objectType, query) {
        const options = {
            url:
                this.baseUrl +
                this.URLs.customObjectSchemaByObjectType(objectType),
        };
        return this._get(options);
    }

    async listCustomObjectSchemas() {
        const options = {
            url: this.baseUrl + this.URLs.customObjectSchemas,
        };
        return this._get(options);
    }

    async updateCustomObjectSchema(objectType, body) {
        const options = {
            url:
                this.baseUrl +
                this.URLs.customObjectSchemaByObjectType(objectType),
            body,
        };
        return this._patch(options);
    }

    //* **************************   Custom Object   *************************** */

    async createCustomObject(objectType, body) {
        const options = {
            url: this.baseUrl + this.URLs.customObjects(objectType),
            body,
        };
        return this._post(options);
    }

    async bulkCreateCustomObjects(objectType, body) {
        const options = {
            url: this.baseUrl + this.URLs.bulkCreateCustomObjects(objectType),
            body,
        };
        return this._post(options);
    }

    async deleteCustomObject(objectType, objId) {
        const options = {
            url: this.baseUrl + this.URLs.customObjectById(objectType, objId),
            query: {},
        };
        return this._delete(options);
    }

    async bulkArchiveCustomObjects(objectType, body) {
        const url =
            this.baseUrl + this.URLs.bulkArchiveCustomObjects(objectType);
        const options = {
            method: 'POST',
            body: JSON.stringify(body),
            query: {},
        };
        this.addJsonHeaders(options);
        if (this.api_key) {
            options.query.hapikey = this.api_key;
        }

        // Using _request because it's a post request that returns an empty body
        return this._request(url, options);
    }

    async getCustomObject(objectType, objId) {
        const options = {
            url: this.baseUrl + this.URLs.customObjectById(objectType, objId),
        };
        return this._get(options);
    }

    async bulkReadCustomObjects(objectType, body) {
        const options = {
            url: this.baseUrl + this.URLs.bulkReadCustomObjects(objectType),
            body,
        };
        return this._post(options);
    }

    async listCustomObjects(objectType, query = {}) {
        const options = {
            url: this.baseUrl + this.URLs.customObjects(objectType),
            query,
        };
        return this._get(options);
    }

    async searchCustomObjects(objectType, body) {
        const options = {
            url: this.baseUrl + this.URLs.customObjectsSearch(objectType),
            body,
        };
        return this._post(options);
    }

    async updateCustomObject(objectType, objId, body) {
        const options = {
            url: this.baseUrl + this.URLs.customObjectById(objectType, objId),
            body,
        };
        return this._patch(options);
    }

    async bulkUpdateCustomObjects(objectType, body) {
        const options = {
            url: this.baseUrl + this.URLs.bulkUpdateCustomObjects(objectType),
            body,
        };
        return this._post(options);
    }

    // **************************   Properties / Custom Fields   **********************************

    // Same as below, but kept for legacy purposes. IE, don't break anything if we update module in projects
    async getProperties(objType) {
        return this.listProperties(objType);
    }

    // This better fits naming conventions
    async listProperties(objType) {
        return this._get({
            url: `${this.baseUrl}${this.URLs.properties(objType)}`,
        });
    }

    async createProperty(objType, body) {
        const options = {
            url: this.baseUrl + this.URLs.properties(objType),
            body,
        };

        return this._post(options);
    }

    async deleteProperty(objType, propName) {
        const options = {
            url: this.baseUrl + this.URLs.propertiesByName(objType, propName),
        };

        return this._delete(options);
    }

    async getPropertyByName(objType, propName) {
        const options = {
            url: this.baseUrl + this.URLs.propertiesByName(objType, propName),
        };

        return this._get(options);
    }

    async updateProperty(objType, propName, body) {
        const options = {
            url: this.baseUrl + this.URLs.propertiesByName(objType, propName),
            body,
        };
        return this._patch(options);
    }

    // **************************   Owners   **********************************

    async getOwnerById(ownerId) {
        const options = {
            url: this.baseUrl + this.URLs.getOwnerById(ownerId),
        };
        return this._get(options);
    }

    // **************************   Timeline Events   **********************************

    async createTimelineEvent(
        objId,
        data,
        eventTemplateId = process.env.HUBSPOT_TIMELINE_EVENT_TEMPLATE_ID
    ) {
        /*
        Example data:
        {
          "activityName": "Custom property for deal"
        }
         */
        const body = {
            eventTemplateId,
            objectId: objId,
            tokens: data.tokens,
            extraData: data.extraData,
        };
        return this._post(this.URLs.createTimelineEvent, body);
    }

    // **************************   Pages   *****************************

    async getLandingPages(query = '') {
        const options = {
            url: `${this.baseUrl}${this.URLs.landingPages}`,
        };
        if (query !== '') {
            options.url = `${options.url}?${query}`
        }
        return this._get(options);
    }

    async getLandingPage(id) {
        const options = {
            url: `${this.baseUrl}${this.URLs.landingPageById(id)}`,
        };
        return this._get(options);
    }

    async updateLandingPage(objId, body, isDraft = false) {
        const draft = isDraft ? '/draft' : ''
        const options = {
            url: `${this.baseUrl}${this.URLs.landingPageById(objId)}${draft}`,
            body,
        };
        return this._patch(options);
    }

    async pushLandingPageDraftToLive(objId) {
        const options = {
            url: `${this.baseUrl}${this.URLs.landingPageById(objId)}/draft/push-live`,
        };
        return this._post(options);
    }

    async publishLandingPage(objId, publishDate) {
        const options = {
            url: `${this.baseUrl}${this.URLs.landingPages}/schedule`,
            body: {
                id: objId,
                publishDate
            },
        };
        return this._post(options);
    }

    async getSitePages(query = '') {
        const options = {
            url: `${this.baseUrl}${this.URLs.sitePages}`,
        };
        if (query !== '') {
            options.url = `${options.url}?${query}`
        }
        return this._get(options);
    }

    async getSitePage(id) {
        const options = {
            url: `${this.baseUrl}${this.URLs.sitePageById(id)}`,
        };
        return this._get(options);
    }


    async updateSitePage(objId, body, isDraft = false) {
        const draft = isDraft ? '/draft' : ''
        const options = {
            url: `${this.baseUrl}${this.URLs.sitePageById(objId)}${draft}`,
            body: body,
        };
        return this._patch(options);
    }

    async pushSitePageDraftToLive(objId) {
        const options = {
            url: `${this.baseUrl}${this.URLs.sitePageById(objId)}/draft/push-live`,
        };
        return this._post(options);
    }

    async publishSitePage(objId, publishDate) {
        const options = {
            url: `${this.baseUrl}${this.URLs.sitePages}/schedule`,
            body: {
                id: objId,
                publishDate
            },
        };
        return this._post(options);
    }

    // **************************   Blogs   *****************************

    async getBlogPosts(query = '') {
        const options = {
            url: `${this.baseUrl}${this.URLs.blogPosts}`,
        };
        if (query !== '') {
            options.url = `${options.url}?${query}`
        }
        return this._get(options);
    }

    async getBlogPost(id) {
        const options = {
            url: `${this.baseUrl}${this.URLs.blogPostById(id)}`,
        };
        return this._get(options);
    }

    async updateBlogPost(objId, body, isDraft = false) {
        const draft = isDraft ? '/draft' : ''
        const options = {
            url: `${this.baseUrl}${this.URLs.blogPostById(objId)}${draft}`,
            body: body,
        };
        return this._patch(options);
    }

    async pushBlogPostDraftToLive(objId) {
        const options = {
            url: `${this.baseUrl}${this.URLs.blogPostById(objId)}/draft/push-live`,
        };
        return this._post(options);
    }

    async publishBlogPost(objId, publishDate) {
        const options = {
            url: `${this.baseUrl}${this.URLs.blogPosts}/schedule`,
            body: {
                id: objId,
                publishDate
            },
        };
        return this._post(options);
    }

    // ***********************   Email Templates   **************************

    async getEmailTemplates(query = '') {
        const options = {
            url: `${this.baseUrl}${this.URLs.emailTemplates}`,
        };
        if (query !== '') {
            options.url = `${options.url}?${query}`
        }
        return this._get(options);
    }

    async getEmailTemplate(id) {
        const options = {
            url: `${this.baseUrl}${this.URLs.emailTemplateById(id)}`,
        };
        return this._get(options);
    }

    async updateEmailTemplate(objId, body) {
        const options = {
            url: `${this.baseUrl}${this.URLs.emailTemplateById(objId)}`,
            body: body,
        };
        return this._put(options);
    }

    async createEmailTemplate(body) {
        const options = {
            url: `${this.baseUrl}${this.URLs.emailTemplates}`,
            body: body,
        };
        return this._post(options);
    }

    async deleteEmailTemplate(id) {
        const options = {
            url: `${this.baseUrl}${this.URLs.emailTemplateById(id)}`,
        };
        return this._delete(options);
    }

    // **************************   Other/All   **********************************

    async getUserDetails() {
        const res1 = await this._get({
            url: this.baseUrl + this.URLs.userDetails,
        });
        const url2 = this.URLs.domain(this.access_token);
        const res2 = await this._get({url: this.baseUrl + url2});
        return Object.assign(res1, res2);
    }

    async getPipelineDetails(objType) {
        const options = {
            url: this.baseUrl + this.URLs.getPipelineDetails(objType),
        };
        return this._get(options);
    }

    async getBatchAssociations(fromObjectType, toObjectType, inputs) {
        const postBody = {inputs};

        const options = {
            url:
                this.baseUrl +
                this.URLs.readBatchAssociations(fromObjectType, toObjectType),
            body: postBody,
        };

        const res = await this._post(options);
        const {results} = res;
        return results;
    }

    async createBatchAssociations(fromObjectType, toObjectType, inputs) {
        const postBody = {inputs};

        const options = {
            url:
                this.baseUrl +
                this.URLs.createBatchAssociations(fromObjectType, toObjectType),
            body: postBody,
        };

        const res = await this._post(options);
        const {results} = res;
        return results;
    }

    async createBatchAssociationsDefault(fromObjectType, toObjectType, inputs) {
        const options = {
            url:
                this.baseUrl +
                this.URLs.createBatchAssociationsDefault(fromObjectType, toObjectType),
            body: {inputs},
        };

        const res = await this._post(options);
        const {results} = res;
        return results;
    }

    async deleteBatchAssociations(fromObjectType, toObjectType, inputs) {
        const options = {
            url:
                this.baseUrl +
                this.URLs.deleteBatchAssociations(fromObjectType, toObjectType),
            body: {inputs},
            returnFullRes: true,
        };

        return this._post(options);
    }

    async deleteBatchAssociationLabels(fromObjectType, toObjectType, inputs) {
        const options = {
            url:
                this.baseUrl +
                this.URLs.deleteBatchAssociationLabels(fromObjectType, toObjectType),
            body: {inputs},
            returnFullRes: true,
        };

        return this._post(options);
    }

    async _propertiesList(objType) {
        const props = await this.listProperties(objType);
        let propsString = '';
        for (let i = 0; i < props.results.length; i++) {
            propsString += `${props.results[i].name},`;
        }
        propsString = propsString.slice(0, propsString.length - 1);
        return propsString;
    }

    async getAssociationLabels(fromObjType, toObjType) {
        const options = {
            url: this.baseUrl + this.URLs.associationLabels(fromObjType, toObjType),
        };
        return this._get(options);
    }

    async createAssociationLabel(fromObjType, toObjType, label) {
        const options = {
            url: this.baseUrl + this.URLs.associationLabels(fromObjType, toObjType),
            body: label
        };
        return this._post(options);
    }

    async deleteAssociationLabel(fromObjType, toObjType, associationTypeId) {
        const options = {
            url: this.baseUrl + this.URLs.associationLabels(fromObjType, toObjType) + `/${associationTypeId}`,
        };
        return this._delete(options, false);
    }

    async searchLists(query = "", offset = 0, count = 500, additionalProperties = []) {
        const options = {
            url: this.baseUrl + this.URLs.listSearch,
            body: {
                query,
                offset,
                count,
                additionalProperties
            },
        };
        return this._post(options);
    }

    async getListById(listId) {
        const options = {
            url: this.baseUrl + this.URLs.listById(listId),
        };
        return this._get(options);
    }

    async createList(name, objectTypeId, processingType = 'MANUAL', listFolderId = null) {
        const options = {
            url: this.baseUrl + this.URLs.lists,
            body: {
                name,
                objectTypeId,
                processingType,
                listFolderId
            },
        };
        return this._post(options);
    }

    async deleteList(listId) {
        const options = {
            url: this.baseUrl + this.URLs.listById(listId),
        };
        return this._delete(options);
    }

    async removeAllListMembers(listId) {
        const options = {
            url: this.baseUrl + this.URLs.listMemberships(listId),
        };
        return this._delete(options);
    }

    async addAndRemoveFromList(listId, idsToAdd, idsToRemove)  {
        const options = {
            url: this.baseUrl + this.URLs.listMembershipsAddRemove(listId),
            body: {
                "recordIdsToAdd": idsToAdd,
                "recordIdsToRemove": idsToRemove
            },
        };
        return this._put(options);
    }

    async addToList(listId, recordIds)  {
        return this.addAndRemoveFromList(listId, recordIds, []);
    }

    async removeFromList(listId, recordIds)  {
        return this.addAndRemoveFromList(listId, [], recordIds);
    }


}

module.exports = {Api};
