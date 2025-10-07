# AI Assistant Guide: Building Frigg Integrations for Nagaris

This document provides AI assistants with the context and patterns needed to build accurate, production-ready integrations for the Nagaris platform.

## Quick Start

To build a new integration, you need:
1. A completed `INTEGRATION_SPEC_TEMPLATE.md` filled out for the service
2. Access to API documentation for the service
3. Understanding of the authentication method
4. Reference to similar existing integrations

---

## Project Context

### What is Nagaris?
Nagaris is a practice management system for accountants that integrates with multiple third-party services to streamline workflows around client management, compliance, and data synchronization.

### What is Frigg?
Frigg (@friggframework/core) is the integration framework used by Nagaris. It provides base classes and patterns for building standardized API integrations.

### Repository Structure
```
backend/
├── index.js                          # Main app definition with all integrations
├── src/
│   ├── api-modules/
│   │   ├── [servicename]/
│   │   │   ├── index.js             # Module exports
│   │   │   ├── api.js               # API client class
│   │   │   ├── definition.js        # Frigg definition
│   │   │   └── defaultConfig.json   # Service config
│   └── integrations/
│       └── [ServiceName]Integration.js  # Integration event handlers
```

---

## Core Patterns

### 1. API Module Structure

Every API module follows this pattern:

#### `defaultConfig.json`
```json
{
    "name": "servicename",
    "config": {
        "oauth": true/false,
        "baseUrl": "https://api.service.com",
        "authUrl": "https://auth.service.com/oauth/authorize",
        "tokenUrl": "https://api.service.com/oauth/token"
    }
}
```

#### `definition.js`
```javascript
require('dotenv').config();
const { Api } = require('./api');
const { get } = require('@friggframework/core');
const config = require('./defaultConfig.json');

const Definition = {
    API: Api,
    getName: () => config.name,
    moduleName: config.name,
    modelName: 'ServiceName',
    requiredAuthMethods: {
        getToken: async (api, params) => {
            // Extract and return credentials/tokens
        },
        getEntityDetails: async (api, callbackParams, tokenResponse, userId) => {
            // Return user/entity details
        },
        apiPropertiesToPersist: {
            credential: ['access_token', 'refresh_token'], // or ['apiKey', 'apiSecret']
            entity: [],
        },
        getCredentialDetails: async (api, userId) => {
            // Return credential details
        },
        testAuthRequest: async (api) => {
            // Test API connection
        },
    },
    env: {
        client_id: process.env.SERVICE_CLIENT_ID,
        client_secret: process.env.SERVICE_CLIENT_SECRET,
        redirect_uri: `${process.env.REDIRECT_URI}/servicename`,
    }
};

module.exports = { Definition };
```

#### `api.js` - Choose the right base class:

**OAuth2 Pattern**:
```javascript
const { OAuth2Requester } = require('@friggframework/core');

class Api extends OAuth2Requester {
    constructor(params) {
        super(params);
        this.baseUrl = 'https://api.service.com';
        this.authorizationUri = 'https://auth.service.com/oauth/authorize?...';
        this.tokenUri = 'https://api.service.com/oauth/token';

        this.URLs = {
            resource: '/resource',
            resourceById: (id) => `/resource/${id}`,
        };
    }

    async someApiMethod() {
        const options = {
            url: this.baseUrl + this.URLs.resource,
        };
        return this._get(options);
    }
}
```

**API Key Pattern**:
```javascript
const { Requester } = require('@friggframework/core');

class Api extends Requester {
    constructor(params) {
        super(params);
        this.baseUrl = 'https://api.service.com';
        this.apiKey = null;
    }

    async setCredential(credential) {
        this.credential = credential;
        this.apiKey = credential.apiKey;
    }

    async addAuthHeaders(headers) {
        if (this.apiKey) {
            headers['X-API-Key'] = this.apiKey;
        }
        return headers;
    }
}
```

**Basic Auth Pattern**:
```javascript
const { BasicAuthRequester } = require('@friggframework/core');

class Api extends BasicAuthRequester {
    constructor(params) {
        super(params);
        this.baseUrl = 'https://api.service.com';
    }

    // Username/password handled by parent class
}
```

#### `index.js`
```javascript
const { Definition } = require('./definition');
const { Api } = require('./api');

module.exports = {
    Definition,
    Api,
};
```

---

### 2. Integration Structure

Every integration follows this pattern:

```javascript
const { IntegrationBase } = require('@friggframework/core');
const servicename = require('../api-modules/servicename');

class ServiceNameIntegration extends IntegrationBase {
    static Definition = {
        name: 'servicename',
        version: '1.0.0',
        supportedVersions: ['1.0.0'],
        hasUserConfig: false,

        display: {
            label: 'Service Name',
            description: 'Use case description here',
            category: 'Practice Management',
            detailsUrl: 'https://service.com',
            icon: 'https://service.com/icon.png',
        },
        modules: {
            servicename: {
                definition: servicename.Definition,
            },
        },
        routes: [
            {
                path: '/auth',
                method: 'GET',
                event: 'AUTH_REQUEST',
            },
            {
                path: '/callback',
                method: 'GET',
                event: 'HANDLE_CALLBACK',
            },
            // Add more routes as needed
        ],
    };

    constructor() {
        super();
        this.events = {
            AUTH_REQUEST: {
                handler: this.authRequest.bind(this),
            },
            HANDLE_CALLBACK: {
                handler: this.handleCallback.bind(this),
            },
            // Add more event handlers
        };
    }

    async authRequest({ req, res }) {
        // Return auth URL or form config
    }

    async handleCallback({ req, res }) {
        // Handle OAuth callback or form submission
    }
}

module.exports = ServiceNameIntegration;
```

---

## Authentication Patterns

### OAuth2 Standard Flow
See: `MondayIntegration.js`, `Cas360Integration.js`

```javascript
// In authRequest
async authRequest({ req, res }) {
    const authUrl = this.servicename.api.authorizationUri;
    return res.json({
        url: authUrl,
        type: 'oauth2',
    });
}

// In handleCallback
async handleCallback({ req, res }) {
    const { code } = req.query;
    const tokenResponse = await this.servicename.api.getTokenFromCode(code);
    await this.servicename.api.setTokens(tokenResponse);
    await this.servicename.api.testAuth();
    return res.json({ success: true, authenticated: true });
}
```

### Modified OAuth2 (Token in Redirect)
See: `SuiteFilesIntegration.js`

```javascript
// Token comes directly in URL params
const { suitetoken } = req.query;
await this.servicename.api.setCredential({ access_token: suitetoken });
```

### Form-Based API Key
See: `KarbonHqIntegration.js`

```javascript
async authRequest({ res }) {
    return res.json({
        url: null,
        type: 'credentials',
        data: {
            jsonSchema: {
                title: 'Service Authentication',
                type: 'object',
                required: ['apiKey'],
                properties: {
                    apiKey: {
                        type: 'string',
                        title: 'API Key',
                        description: 'Your API key',
                    },
                },
            },
            uiSchema: {
                apiKey: {
                    'ui:widget': 'password',
                    'ui:help': 'Found in service settings',
                },
            },
        },
    });
}
```

---

## Common Operations

### Sync Pattern (Create or Update)
```javascript
async syncResource(resourceData) {
    const { name, uniqueId, ...otherData } = resourceData;

    // Check if exists
    let existing = null;
    if (uniqueId) {
        const results = await this.listResources({ uniqueId });
        if (results && results.length > 0) {
            existing = results[0];
        }
    }

    const params = { name, uniqueId, ...otherData };

    if (existing) {
        return await this.updateResource(existing.id, params);
    } else {
        return await this.createResource(params);
    }
}
```

### Error Handling Pattern
```javascript
async eventHandler({ req, res }) {
    try {
        const { field1, field2 } = req.body;

        if (!field1 || !field2) {
            return res.status(400).json({
                error: 'Missing required fields',
                message: 'Field1 and field2 are required',
            });
        }

        const result = await this.servicename.api.someOperation({ field1, field2 });

        return res.json({
            success: true,
            message: 'Operation completed successfully',
            data: result,
        });
    } catch (error) {
        console.error('Operation error:', error);
        return res.status(500).json({
            error: 'Operation failed',
            message: error.message || 'An error occurred',
        });
    }
}
```

---

## Checklist for New Integration

### Before Starting
- [ ] Read the service's API documentation thoroughly
- [ ] Identify the authentication method
- [ ] Find a similar existing integration to use as reference
- [ ] Fill out `INTEGRATION_SPEC_TEMPLATE.md`

### API Module (`/backend/src/api-modules/[servicename]/`)
- [ ] Create `defaultConfig.json` with correct base URLs
- [ ] Create `definition.js` with proper auth methods
- [ ] Create `api.js` extending the appropriate base class:
  - OAuth2Requester for OAuth2
  - Requester for API key
  - BasicAuthRequester for basic auth
- [ ] Implement all required API methods (list, get, create, update, delete, sync)
- [ ] Create `index.js` that exports Definition and Api
- [ ] Add proper auth headers in `addAuthHeaders()` if using Requester
- [ ] Implement `setCredential()` if using custom auth

### Integration (`/backend/src/integrations/[ServiceName]Integration.js`)
- [ ] Extend `IntegrationBase`
- [ ] Define static `Definition` with:
  - Correct name, version, display info
  - All routes needed
  - Module definition reference
- [ ] Create constructor with event handlers for all routes
- [ ] Implement `authRequest()` handler
- [ ] Implement `handleCallback()` or form auth handler
- [ ] Implement all business logic event handlers
- [ ] Add try-catch error handling to all handlers
- [ ] Return proper HTTP status codes

### Backend Index (`/backend/index.js`)
- [ ] Add `require()` statement at top for new integration
- [ ] Add integration to `integrations` array

### Testing
- [ ] Test authentication flow end-to-end
- [ ] Test each API operation
- [ ] Test error cases (invalid auth, missing fields, etc.)
- [ ] Verify data mapping is complete and accurate

---

## Common Pitfalls to Avoid

1. **Missing index.js**: Every api-module MUST have an index.js file
2. **Wrong base class**: Match the base class to the auth type
3. **Inconsistent naming**: Use PascalCase for Integration files, lowercase for module folders
4. **Forgetting backend/index.js**: Always update this to register the new integration
5. **Hardcoded values**: Use environment variables for all credentials
6. **Poor error handling**: Always wrap in try-catch and return meaningful errors
7. **Missing validation**: Validate required fields before API calls
8. **Incorrect HTTP methods**: Use _get, _post, _patch, _put, _delete from base class

---

## Reference Matrix

| Authentication Type | Base Class | Example Integration | Key Files to Reference |
|---------------------|------------|---------------------|------------------------|
| OAuth2 Standard | OAuth2Requester | Monday.com | monday/api.js, MondayIntegration.js |
| OAuth2 Modified | OAuth2Requester | SuiteFiles | suitefiles/api.js, SuiteFilesIntegration.js |
| Dual API Key | Requester | KarbonHQ | karbonhq/api.js, KarbonHqIntegration.js |
| Basic Auth | BasicAuthRequester | Twilio | twilio/Api.js, TwilioIntegration.js |
| Form Auth | Requester | CreditorWatch | creditor-watch/api.js, CreditorWatchIntegration.js |
| SOAP | Requester | ASIC | asic/api.js, AsicIntegration.js |

---

## Git Workflow

Each integration should be on its own feature branch:

```bash
# Branch naming: feat/add-[servicename]-integration
git checkout -b feat/add-servicename-integration

# After completing the integration
git add backend/src/api-modules/servicename/
git add backend/src/integrations/ServiceNameIntegration.js
git add backend/index.js

git commit -m "Add ServiceName integration

- Create ServiceName API module with [auth type]
- Implement [list of key features]
- Add [specific operations]
- Use case: [use case description]

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"

# Use graphite to manage the stack
gt modify
```

---

## Next Steps After Generating Code

1. **Code Review**: Check generated code against this guide
2. **Manual Testing**: Test auth flow and each operation
3. **Documentation**: Update any integration-specific docs
4. **Deployment**: Follow team's deployment process
5. **Monitoring**: Watch for errors in production

---

## Questions to Ask Before Starting

1. What is the authentication method?
2. What is the base API URL?
3. What are the key resources/entities to manage?
4. What is the primary use case for Nagaris users?
5. Are there rate limits to consider?
6. Which Nagaris client types use this (Company/Trust/SMSF/Individual)?
7. Is this a one-way or two-way sync?
8. What fields map between Nagaris and this service?

---

## Getting Help

- **Similar integrations**: Look in `/backend/src/integrations/` for examples
- **Frigg documentation**: Check @friggframework/core for base class docs
- **API documentation**: Always start with the service's official API docs
- **This guide**: Reference the patterns and checklists above
