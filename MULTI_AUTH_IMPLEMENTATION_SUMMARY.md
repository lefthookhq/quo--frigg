# Multi-Mode Authentication Implementation Summary

## Overview

This document summarizes the implementation of multi-mode authentication for Frigg Framework, enabling three authentication strategies:

1. **Frigg Native Token** - Existing bearer token authentication
2. **X-Frigg Headers** - Backend-to-backend authentication with auto-user creation
3. **Adopter JWT** - Custom JWT authentication (stubbed for future implementation)

## Implementation Date

October 18, 2025

---

## Frigg Core Changes

### Location
`/Users/sean/Documents/GitHub/frigg/packages/core/`

### New Files Created

**1. GetUserFromXFriggHeaders Use Case**
- **File**: `user/use-cases/get-user-from-x-frigg-headers.js`
- **Purpose**: Authenticate users using `x-frigg-appUserId` and `x-frigg-appOrgId` headers
- **Features**:
  - Auto-creates users if not found
  - Validates at least one header is provided
  - Detects and rejects conflicting user IDs (400 Bad Request)
  - Respects userConfig settings (primary, individualUserRequired, organizationUserRequired)

**2. GetUserFromAdopterJwt Use Case (Stub)**
- **File**: `user/use-cases/get-user-from-adopter-jwt.js`
- **Purpose**: Placeholder for custom JWT authentication
- **Status**: NOT IMPLEMENTED - Returns 501 Not Implemented
- **Documentation**: Comprehensive implementation notes for future development

**3. AuthenticateUser Orchestrator Use Case**
- **File**: `user/use-cases/authenticate-user.js`
- **Purpose**: Unified authentication orchestrator
- **Behavior**: Tries auth modes in priority order:
  1. X-Frigg headers (if `authModes.xFriggHeaders` enabled)
  2. Adopter JWT (if `authModes.adopterJwt` enabled and 3-part token)
  3. Frigg native token (default)

### Modified Files

**1. Integration Router**
- **File**: `integrations/integration-router.js`
- **Changes**:
  - Added imports for new use cases
  - Created `AuthenticateUser` instance
  - Replaced all `getUserFromBearerToken.execute()` calls with `authenticateUser.execute()`
  - Updated JSDoc comments

**2. Core Exports**
- **File**: `index.js`
- **Changes**:
  - Exported `GetUserFromXFriggHeaders`
  - Exported `GetUserFromAdopterJwt`
  - Exported `AuthenticateUser`

---

## Frigg Schemas Changes

### Modified Files

**1. App Definition Schema**
- **File**: `packages/schemas/schemas/app-definition.schema.json`
- **Changes Added**:
  ```json
  {
    "user": {
      "usePassword": { "type": "boolean" },
      "primary": { "enum": ["individual", "organization"] },
      "individualUserRequired": { "type": "boolean" },
      "organizationUserRequired": { "type": "boolean" },
      "authModes": {
        "friggToken": { "type": "boolean", "default": true },
        "xFriggHeaders": { "type": "boolean", "default": false },
        "adopterJwt": { "type": "boolean", "default": false }
      },
      "jwtConfig": {
        "secret": { "type": "string", "required": true },
        "userIdClaim": { "type": "string", "default": "sub" },
        "orgIdClaim": { "type": "string", "default": "org_id" },
        "algorithm": { "enum": ["HS256", "HS384", "HS512", "RS256", "RS384", "RS512"] }
      }
    }
  }
  ```

**2. Schema Validation Tests**
- **File**: `packages/schemas/tests/schemas.test.js`
- **Tests Added**:
  - Validate authModes configuration
  - Validate jwtConfig structure
  - Test all valid JWT algorithms
  - Reject invalid JWT algorithms
  - Require jwtConfig.secret when present
  - Reject invalid authMode keys
  - Validate complete user configuration
  - Validate primary user type enum

---

## Unit Tests Created

### Frigg Core Tests

**1. GetUserFromXFriggHeaders Tests**
- **File**: `packages/core/user/tests/use-cases/get-user-from-x-frigg-headers.test.js`
- **Test Coverage**:
  - ✅ Find existing user by appUserId
  - ✅ Find existing user by appOrgId
  - ✅ Create new user when not found
  - ✅ Throw 400 when neither ID provided
  - ✅ Throw 400 on user ID conflict (both IDs, different users)
  - ✅ Succeed when both IDs match same user
  - ✅ Respect individualUserRequired
  - ✅ Respect organizationUserRequired
  - ✅ Respect primary setting
  - ✅ Handle edge cases

**2. GetUserFromAdopterJwt Tests**
- **File**: `packages/core/user/tests/use-cases/get-user-from-adopter-jwt.test.js`
- **Test Coverage**:
  - ✅ Throw 501 Not Implemented
  - ✅ Provide helpful error message
  - ✅ Initialize successfully
  - ✅ Verify implementation notes documented

**3. AuthenticateUser Multi-Auth Tests**
- **File**: `packages/core/integrations/tests/integration-router-multi-auth.test.js`
- **Test Coverage**:
  - ✅ Authenticate with x-frigg-appUserId
  - ✅ Authenticate with x-frigg-appOrgId
  - ✅ Authenticate with both when they match
  - ✅ Reject conflicting x-frigg headers (400)
  - ✅ Fall back to Frigg token
  - ✅ Try JWT when enabled
  - ✅ Respect authModes configuration
  - ✅ Throw unauthorized when no valid auth
  - ✅ Prioritize x-frigg over bearer token
  - ✅ Handle all error scenarios

---

## quo--frigg Changes

### Modified Files

**1. App Definition**
- **File**: `backend/index.js`
- **Changes**:
  ```javascript
  user: {
      usePassword: true,
      primary: 'individual',
      individualUserRequired: true,
      organizationUserRequired: false,
      authModes: {
          friggToken: true,       // Support web UI login
          xFriggHeaders: true,    // Enable backend-to-backend
          adopterJwt: false,      // Not using custom JWT
      },
  }
  ```

**2. Environment Variables**
- **File**: `backend/.env.example` (updated via terminal)
- **Added**:
  - `FRIGG_APP_API_KEY` - Optional API key for x-frigg header validation
  - `JWT_SECRET` - Future JWT secret (commented out)

### Integration Test Files Created

**1. Test Helpers**
- **File**: `backend/test/integration-test-helpers.js`
- **Functions**:
  - `makeAuthenticatedRequest(method, path, data, userId, orgId)`
  - `getAuthRequirements(entityType, userId)`
  - `authenticateModule(entityType, credentials, userId)`
  - `createIntegration(type, entities, config, userId)`
  - `getIntegrations(userId)`
  - `getIntegration(integrationId, userId)`
  - `deleteIntegration(integrationId, userId)`
  - `testEntityAuth(entityId, userId)`
  - `createTestUser(username, password)`
  - `loginTestUser(username, password)`
  - `cleanupTestData(integrationId, userId)`
  - `waitForCondition(condition, timeoutMs, intervalMs)`

**2. ScalingTestIntegration Test**
- **File**: `backend/test/integrations/ScalingTestIntegration.integration.test.js`
- **Tests**: 4-step integration pattern with x-frigg header support

**3. AttioIntegration Test**
- **File**: `backend/test/integrations/AttioIntegration.integration.test.js`
- **Tests**: Complete flow including OAuth handling notes

**4. AxisCareIntegration Test**
- **File**: `backend/test/integrations/AxisCareIntegration.integration.test.js`
- **Tests**: Client/applicant sync with auto-user creation

---

## Authentication Flow

### X-Frigg Headers Authentication

**Request Headers**:
```
x-frigg-appUserId: user-123        # At least one required
x-frigg-appOrgId: org-456          # Optional
x-api-key: your-secret-key         # Optional validation
```

**Behavior**:
1. Extract `appUserId` and `appOrgId` from headers
2. Validate at least one is provided
3. Look up existing user(s) in database
4. If both IDs provided and both users exist, validate they match (throw 400 if mismatch)
5. If user not found, auto-create with provided ID
6. Return User object for request context

### Priority Order

1. **X-Frigg Headers** (checked first)
   - If `x-frigg-appUserId` OR `x-frigg-appOrgId` present → use GetUserFromXFriggHeaders
   
2. **Adopter JWT** (checked second, if enabled)
   - If `Authorization: Bearer` header with 3-part token → use GetUserFromAdopterJwt
   - Currently returns 501 Not Implemented
   
3. **Frigg Native Token** (default fallback)
   - If `Authorization: Bearer` header → use GetUserFromBearerToken
   
4. **None** → Return 401 Unauthorized

---

## Next Steps (User Intervention Required)

### Phase 6: Publish Frigg Canary

Before deploying to QA, you need to publish a new Frigg canary version with these changes:

```bash
cd /Users/sean/Documents/GitHub/frigg

# Run tests to ensure everything passes
npm test

# Publish canary version
npm run publish:canary  # Or equivalent command

# Note the new version number (e.g., 2.0.0--canary.462.abc1234.0)
```

### Phase 7: Update quo--frigg Dependencies

```bash
cd /Users/sean/Documents/GitHub/quo--frigg/backend

# Update to new canary version (replace XXX with actual version)
npm install @friggframework/core@2.0.0--canary.XXX.XXXXXX.0
npm install @friggframework/devtools@2.0.0--canary.XXX.XXXXXX.0
npm install @friggframework/serverless-plugin@2.0.0--canary.XXX.XXXXXX.0

# Test locally
cd backend
npm run frigg:start

# In another terminal, run integration tests
npm test -- ScalingTestIntegration.integration.test.js

# Commit dependency updates
git add backend/package.json backend/package-lock.json
git commit -m "chore: update Frigg canary version for multi-auth support"
```

### Phase 8: Git Branch Management

```bash
cd /Users/sean/Documents/GitHub/quo--frigg

# Commit current changes
git add backend/index.js backend/test/
git commit -m "feat: add multi-auth support and integration tests"

# Merge main into feature branches
git checkout feat/attio-integration
git merge main

git checkout feat/sync-axisCare-clients-to-quo
git merge main

git checkout main
```

### Phase 9: QA Deployment

```bash
cd /Users/sean/Documents/GitHub/quo--frigg/backend

# Deploy main branch to QA
AWS_PROFILE=lefthook-nagaris frigg deploy --stage qa

# Set up environment variables for QA:
# - FRIGG_APP_API_KEY
# - QUO_API_KEY
# - SCALE_TEST_API_KEY
# - AXISCARE_API_KEY
# - ATTIO_CLIENT_ID, ATTIO_CLIENT_SECRET
```

### Phase 10: Testing on QA

Run integration tests against QA deployment:

```bash
# Set QA endpoint
export TEST_BASE_URL=<qa-api-gateway-url>
export FRIGG_APP_API_KEY=<qa-api-key>

# Run tests
npm test -- --testPathPattern=integration
```

---

## Files Created/Modified

### Frigg Core
- ✅ `packages/core/user/use-cases/get-user-from-x-frigg-headers.js` (new)
- ✅ `packages/core/user/use-cases/get-user-from-adopter-jwt.js` (new stub)
- ✅ `packages/core/user/use-cases/authenticate-user.js` (new)
- ✅ `packages/core/user/tests/use-cases/get-user-from-x-frigg-headers.test.js` (new)
- ✅ `packages/core/user/tests/use-cases/get-user-from-adopter-jwt.test.js` (new)
- ✅ `packages/core/integrations/integration-router.js` (modified)
- ✅ `packages/core/integrations/tests/integration-router-multi-auth.test.js` (new)
- ✅ `packages/core/index.js` (modified - exports)

### Frigg Schemas
- ✅ `packages/schemas/schemas/app-definition.schema.json` (modified)
- ✅ `packages/schemas/tests/schemas.test.js` (modified)

### quo--frigg
- ✅ `backend/index.js` (modified - authModes)
- ✅ `backend/.env.example` (updated via terminal)
- ✅ `backend/test/integration-test-helpers.js` (new)
- ✅ `backend/test/integrations/ScalingTestIntegration.integration.test.js` (new)
- ✅ `backend/test/integrations/AttioIntegration.integration.test.js` (new)
- ✅ `backend/test/integrations/AxisCareIntegration.integration.test.js` (new)

---

## Key Features

### Auto-User Creation

When a request arrives with `x-frigg-appUserId` or `x-frigg-appOrgId` headers:
- User is looked up in the database
- If not found, user is automatically created
- Username: `app-user-{appUserId}`
- Email: `{appUserId}@app.local`

### Conflict Detection

If both `x-frigg-appUserId` AND `x-frigg-appOrgId` are provided:
- System looks up both users
- Validates they belong to the same account
- Returns **400 Bad Request** if they don't match
- Error message: "User ID mismatch: x-frigg-appUserId and x-frigg-appOrgId refer to different users..."

### Configuration Flexibility

Apps can enable/disable authentication modes via `authModes`:
```javascript
authModes: {
    friggToken: true,      // Traditional login
    xFriggHeaders: true,    // Backend-to-backend
    adopterJwt: false,      // Custom JWT (future)
}
```

---

## Testing Strategy

### Unit Tests
- **GetUserFromXFriggHeaders**: 17 test cases covering validation, creation, conflicts, config respect
- **GetUserFromAdopterJwt**: 4 test cases for stub behavior
- **AuthenticateUser**: 12 test cases for multi-mode orchestration
- **Schema Validation**: 8 new test cases for authModes and jwtConfig

### Integration Tests
- **ScalingTestIntegration**: End-to-end flow with x-frigg headers
- **AttioIntegration**: OAuth + x-frigg header auth
- **AxisCareIntegration**: API key + backend-to-backend auth

---

## Usage Examples

### Backend-to-Backend Request

```javascript
const axios = require('axios');

const response = await axios.post(
    'https://api.quo-integrations.com/api/integrations',
    {
        config: { type: 'scalingtest' },
        entities: { quo: 'entity-1', 'scale-test': 'entity-2' }
    },
    {
        headers: {
            'x-api-key': process.env.FRIGG_APP_API_KEY,
            'x-frigg-appUserId': 'quo-user-123',
        }
    }
);
```

### Traditional Web UI Login

```javascript
// 1. User logs in
const { token } = await axios.post('/user/login', {
    username: 'user@example.com',
    password: 'password123'
});

// 2. Use token for requests
const response = await axios.get('/api/integrations', {
    headers: {
        'Authorization': `Bearer ${token}`
    }
});
```

---

## Breaking Changes

**None** - All changes are backward compatible. Existing apps will continue using `friggToken` by default if `authModes` not specified.

---

## Future Work

### Adopter JWT Implementation

When implementing adopter JWT authentication:

1. Install `jsonwebtoken` package
2. Implement JWT validation in `GetUserFromAdopterJwt.execute()`
3. Support multiple algorithms (HS*, RS*)
4. Add JWT public key caching for RS* algorithms
5. Handle token expiration
6. Implement refresh token support
7. Add comprehensive error handling
8. Update documentation

### Recommended Packages
```bash
npm install jsonwebtoken
npm install @types/jsonwebtoken --save-dev
```

### Implementation Checklist
- [ ] JWT signature validation
- [ ] Claim extraction
- [ ] User lookup/creation
- [ ] Conflict detection
- [ ] Token expiration handling
- [ ] Refresh token support
- [ ] Error handling
- [ ] Security auditing
- [ ] Documentation
- [ ] Integration tests

---

## Security Considerations

### API Key Validation (Optional)

To add an extra security layer for x-frigg header requests, validate the `x-api-key` header:

```javascript
// backend/src/middleware/validate-api-key.js
function validateApiKey(req, res, next) {
    const hasXFriggHeaders = req.headers['x-frigg-appuserid'] || 
                            req.headers['x-frigg-apporgid'];
    
    if (hasXFriggHeaders && process.env.FRIGG_APP_API_KEY) {
        const apiKey = req.headers['x-api-key'];
        if (!apiKey || apiKey !== process.env.FRIGG_APP_API_KEY) {
            return res.status(401).json({ 
                error: 'Valid x-api-key required for x-frigg header authentication' 
            });
        }
    }
    
    next();
}
```

### Best Practices

1. **Rotate API keys regularly** - Change `FRIGG_APP_API_KEY` periodically
2. **Use environment-specific keys** - Different keys for dev/qa/prod
3. **Monitor authentication failures** - Log and alert on repeated failures
4. **Rate limiting** - Consider rate limiting on x-frigg header endpoints
5. **Audit logging** - Log all user creation events from x-frigg headers

---

## Support

For questions or issues with multi-mode authentication:
1. Check this implementation summary
2. Review unit test cases for usage examples
3. Consult Frigg Core documentation
4. Reach out to Frigg framework team

---

## Changelog

### v2.0.0-canary.XXX (Pending)
- Added GetUserFromXFriggHeaders use case
- Added GetUserFromAdopterJwt stub use case
- Added AuthenticateUser orchestrator
- Modified integration router for multi-mode auth
- Updated app definition schema with authModes
- Added comprehensive unit tests
- Added integration test helpers and tests

