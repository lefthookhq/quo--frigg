# Integration Specification Template

This template follows spec-kit best practices for AI-assisted code generation of Frigg integrations.

## Meta Information

**Integration Name**: [Service Name]
**Service Type**: [Practice Management / Document Management / CRM / Project Management / etc.]
**Authentication Method**: [OAuth2 / API Key / Basic Auth / Custom]
**Use Case**: [1-2 sentence description of what this integration does for Nagaris users]

---

## 1. Service Overview

### What Problem Does This Solve?
[Describe the problem this integration solves for accountants using Nagaris]

### User Stories
- As an accountant, I want to [action] so that [benefit]
- As an accountant, I want to [action] so that [benefit]

### Key Features
- [ ] Feature 1: [Description]
- [ ] Feature 2: [Description]
- [ ] Feature 3: [Description]

---

## 2. Authentication Details

### Authentication Type
- **Type**: [OAuth2 / API Key / Basic Auth / Dual API Key / Custom]
- **Flow**: [Describe the authentication flow]

### Required Credentials
```
Field 1: [name, type, description]
Field 2: [name, type, description]
```

### OAuth2 Specific (if applicable)
- **Authorization URL**: [URL]
- **Token URL**: [URL]
- **Redirect URI**: [Pattern, e.g., ${REDIRECT_URI}/servicename]
- **Scopes**: [List of scopes]
- **Special Notes**: [Any unique aspects of the OAuth flow]

### Environment Variables Needed
```bash
SERVICE_CLIENT_ID=
SERVICE_CLIENT_SECRET=
SERVICE_API_KEY= (if applicable)
```

---

## 3. API Documentation

### Base URL
- **Production**: [URL]
- **Staging/UAT**: [URL if available]

### API Documentation Links
- Main Docs: [URL]
- Authentication Guide: [URL]
- API Reference: [URL]

### Key Endpoints to Implement

#### Endpoint 1: [Name]
- **Method**: GET/POST/PUT/PATCH/DELETE
- **Path**: `/endpoint/path`
- **Purpose**: [What this endpoint does]
- **Required Parameters**:
  ```json
  {
    "param1": "type - description",
    "param2": "type - description"
  }
  ```
- **Response Format**: [Describe expected response]
- **Use Case in Nagaris**: [When/why this is used]

#### Endpoint 2: [Name]
[Repeat structure above]

---

## 4. Data Mapping

### Client/Contact Sync
**Nagaris → Service Mapping**:
```
Nagaris Field          → Service Field
-----------------        ----------------
client.name            → contact.name
client.email           → contact.email
client.phone           → contact.phone
client.address         → contact.address
[etc.]
```

### Entity/Organization Sync
**Nagaris → Service Mapping**:
```
Nagaris Field              → Service Field
-----------------            ----------------
entity.name                → organization.name
entity.businessNumber      → organization.abn
[etc.]
```

### Special Field Handling
- **Field transformations**: [Any data transformations needed]
- **Conditional fields**: [Fields that depend on certain conditions]
- **Validation rules**: [Any validation specific to this service]

---

## 5. Integration Behavior

### Sync Operations

#### Create/Update Logic
- **When to create new**: [Conditions]
- **When to update existing**: [Conditions]
- **Matching strategy**: [How to identify existing records - by email, by ID, etc.]

#### Data Flow Direction
- [ ] Nagaris → Service (one-way)
- [ ] Service → Nagaris (one-way)
- [ ] Bidirectional sync

### Edge Cases to Handle
1. **Case 1**: [Scenario and expected behavior]
2. **Case 2**: [Scenario and expected behavior]
3. **Case 3**: [Scenario and expected behavior]

### Error Handling
- **Invalid credentials**: [What to do]
- **Duplicate records**: [How to handle]
- **API rate limits**: [Strategy]
- **Network failures**: [Retry logic]

---

## 6. Routes & Integration Events

### Required Routes
```javascript
[
  {
    path: '/auth',
    method: 'GET',
    event: 'AUTH_REQUEST',
    purpose: 'Initiate authentication'
  },
  {
    path: '/callback',
    method: 'GET',
    event: 'HANDLE_CALLBACK',
    purpose: 'Handle OAuth callback'
  },
  {
    path: '/sync/client',
    method: 'POST',
    event: 'SYNC_CLIENT',
    purpose: 'Sync client data to service'
  }
  // Add more routes as needed
]
```

### Event Handlers to Implement
1. **AUTH_REQUEST**: [Description of behavior]
2. **HANDLE_CALLBACK**: [Description of behavior]
3. **SYNC_CLIENT**: [Description of behavior]
[etc.]

---

## 7. Implementation Checklist

### API Module (`/backend/src/api-modules/[servicename]/`)
- [ ] `defaultConfig.json` - Service configuration
- [ ] `definition.js` - Frigg definition with auth methods
- [ ] `api.js` - API client extending OAuth2Requester/Requester/BasicAuthRequester
- [ ] `index.js` - Module exports

### Integration (`/backend/src/integrations/[ServiceName]Integration.js`)
- [ ] Integration class extending IntegrationBase
- [ ] Static Definition with display info and routes
- [ ] Event handlers for all routes
- [ ] Error handling for all operations

### Backend Index
- [ ] Add integration to `backend/index.js` imports
- [ ] Add integration to integrations array

---

## 8. Testing & Validation

### Test Scenarios
1. **Authentication**:
   - [ ] Successfully authenticate with valid credentials
   - [ ] Reject invalid credentials
   - [ ] Handle token refresh (if applicable)

2. **Data Sync**:
   - [ ] Create new record in service
   - [ ] Update existing record
   - [ ] Handle duplicate detection
   - [ ] Sync all required fields

3. **Error Handling**:
   - [ ] Handle network errors gracefully
   - [ ] Display meaningful error messages
   - [ ] Retry failed operations

### Manual Testing Steps
1. Step 1: [Description]
2. Step 2: [Description]
3. Step 3: [Description]

---

## 9. Reference Files

### Similar Integrations to Reference
**For OAuth2 patterns**:
- `/backend/src/api-modules/monday/` - GraphQL-based OAuth2
- `/backend/src/api-modules/suitefiles/` - Modified OAuth2 (token in redirect)
- `/backend/src/api-modules/cas360/` - Standard OAuth2

**For API Key patterns**:
- `/backend/src/api-modules/karbonhq/` - Dual API key (Authorization + AccessKey)

**For Basic Auth patterns**:
- `/backend/src/api-modules/asic/` - SOAP with Basic Auth
- `/backend/src/api-modules/twilio/` - REST with Basic Auth

### Integration Patterns to Follow
- **OAuth2 with standard flow**: See `MondayIntegration.js`
- **API Key authentication**: See `KarbonHqIntegration.js`
- **Form-based auth**: See `CreditorWatchIntegration.js`
- **Sync operations**: See `Cas360Integration.js` syncCompany/syncTrust methods

---

## 10. Special Notes & Considerations

### Service-Specific Quirks
- [Any unusual aspects of this API]
- [Special rate limits or throttling]
- [Unique authentication requirements]

### Nagaris-Specific Requirements
- **Client Type Restrictions**: [Which Nagaris client types use this - Company/Trust/SMSF/Individual]
- **Workflow Integration**: [How this fits into accountant workflow]
- **Future Enhancements**: [Planned features or improvements]

---

## Appendix: Code Generation Instructions

### For AI Assistant

When generating code for this integration:

1. **Read these reference files first**:
   ```
   /backend/src/api-modules/[similar-service]/api.js
   /backend/src/api-modules/[similar-service]/definition.js
   /backend/src/integrations/[SimilarService]Integration.js
   ```

2. **Follow this exact structure**:
   - Use the appropriate Requester base class (OAuth2Requester, Requester, BasicAuthRequester)
   - Include `index.js` in the api-module directory
   - Match the naming convention: `[ServiceName]Integration.js` (PascalCase)

3. **Include all required methods**:
   - API module: setCredential, addAuthHeaders, list/get/create/update operations, sync methods
   - Integration: authRequest, handleCallback, all event handlers from routes

4. **Use consistent error handling**:
   - Try-catch blocks in all integration event handlers
   - Return proper HTTP status codes (400 for validation, 401 for auth, 500 for server errors)
   - Include meaningful error messages

5. **Update backend/index.js**:
   - Add require statement at top
   - Add integration to integrations array

6. **Test the implementation**:
   - Verify all routes are defined
   - Check that auth flow works end-to-end
   - Validate data mapping is complete
