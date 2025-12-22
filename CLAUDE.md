# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Quo Integrations Framework** - A serverless integration platform built on the Frigg framework that synchronizes data between Quo CRM and various third-party services (AxisCare, Attio, PipeDrive, Zoho CRM).

- **Tech Stack**: Node.js 18+, MongoDB (replica set), AWS Lambda (Serverless Framework), Frigg Framework v2.0
- **Architecture**: Event-driven integration platform with API modules and integration classes
- **Deployment**: AWS via Serverless Framework with VPC, KMS encryption, and PostgreSQL support
- **Local Dev**: Docker Compose (MongoDB + LocalStack for SQS/SNS)

## Development Commands

### Setup & Running
```bash
# Install dependencies
npm install

# Start local infrastructure (MongoDB + LocalStack)
npm run docker:start

# Start local development server (Frigg CLI)
npm run frigg:start
# or from root: npm start

# Stop Docker services
npm run docker:stop

# Setup database
npm run frigg:db:setup
```

### Testing
```bash
# Run all tests (excludes interactive and live-api tests)
npm test

# Run all tests including live API tests
npm run test:full

# Run specific test patterns
npm run test:process          # Process tests
npm run test:unit            # Unit tests only
npm run test:auth            # Auth tests

# Run with coverage
npm run test:coverage

# Watch mode for TDD
npm run test:watch

# Debug tests (no timeout)
npm run debug
```

### Code Quality
```bash
# Lint code
npm run lint

# Lint and auto-fix
npm run lint:fix

# Format code with Prettier
npm run format

# Check CloudFormation templates
npm run lint:cloudformation

# Check for unused dependencies
npm run knip
```

### Deployment
```bash
# Deploy to AWS (uses Frigg CLI)
npm run frigg:deploy

# Or manually with specific profile/stage
cd backend
AWS_PROFILE=your-profile npx serverless deploy --config infrastructure.js --stage prod --verbose
```

## Architecture Overview

### Project Structure
```
backend/
├── index.js                    # App definition and integration registry
├── infrastructure.js           # Serverless infrastructure config (Frigg)
├── src/
│   ├── integrations/          # Integration classes (extend IntegrationBase)
│   │   ├── AttioIntegration.js
│   │   ├── AxisCareIntegration.js
│   │   ├── PipeDriveIntegration.js
│   │   ├── ScalingTestIntegration.js
│   │   └── ZohoCRMIntegration.js
│   ├── api-modules/           # API wrappers for external services
│   │   ├── quo/              # Quo CRM API module
│   │   │   ├── api.js        # API requester implementation
│   │   │   ├── definition.js # Frigg module definition
│   │   │   └── defaultConfig.json
│   │   └── axiscare/         # AxisCare API module
│   └── utils/
├── test/                      # Jest tests
│   └── jest-setup.js
└── docker-compose.yml         # MongoDB + LocalStack
```

### Integration Pattern

Each integration follows the Frigg framework pattern:

1. **Integration Class** (`src/integrations/*.js`):
   - Extends `IntegrationBase` from `@friggframework/core`
   - Contains `static Definition` with metadata, routes, and modules
   - Implements event handlers in constructor (`this.events`)
   - Handler methods execute integration logic

2. **API Module** (`src/api-modules/*/`):
   - `api.js`: Extends `ApiKeyRequester` or `OAuth2Requester`
   - `definition.js`: Exports Frigg module definition with auth methods
   - Required auth methods: `getToken`, `getEntityDetails`, `testAuthRequest`

3. **Routes & Events**:
   - Routes defined in `static Definition.routes[]`
   - Each route maps to an event (e.g., `LIST_ATTIO_WORKSPACES`)
   - Events handled via `this.events[EVENT_NAME].handler`
   - User actions can be defined with `type: 'USER_ACTION'`

### App Definition (`backend/index.js`)

Central configuration file that:
- Registers all integrations in the `integrations[]` array
- Configures app-wide settings (encryption, VPC, database)
- **Note**: Integrations are currently commented out in the array - uncomment to enable

Key configurations:
- **Encryption**: KMS field-level encryption for API credentials
- **VPC**: Auto-discovery mode for existing VPC infrastructure
- **Database**: PostgreSQL support enabled, MongoDB via connection string
- **User Auth**: Password-based authentication enabled

## Key Patterns

### Creating a New Integration

1. **Create API Module** in `src/api-modules/[service]/`:
   - Implement API wrapper extending `ApiKeyRequester` or `OAuth2Requester`
   - Define auth flow in `definition.js` with required methods
   - Add URLs, request methods, and response handling

2. **Create Integration Class** in `src/integrations/[Service]Integration.js`:
   ```javascript
   class ServiceIntegration extends IntegrationBase {
       static Definition = {
           name: 'service-name',
           version: '1.0.0',
           display: { label, description, category },
           modules: { service: { definition }, quo: { definition } },
           routes: [{ path, method, event }],
       };

       constructor() {
           super();
           this.events = {
               EVENT_NAME: { handler: this.handlerMethod },
           };
       }
   }
   ```

3. **Register in App** (`backend/index.js`):
   - Import integration class
   - Add to `integrations[]` array
   - Uncomment if needed

### Authentication & Encryption

- **API Keys**: Stored encrypted at rest using AWS KMS
- **Field-Level Encryption**: Automatic via Frigg framework
- **Auth Flow**: Handled by module definition's `requiredAuthMethods`
- **Testing Auth**: Implement `testAuthRequest` in module definition

### Using Frigg Commands (Important Architecture Pattern)

**CRITICAL**: Integration classes should NEVER use repositories directly. Instead, use Frigg Commands for all database operations.

**Why?**
- Commands encapsulate use cases and follow hexagonal architecture
- Repositories are internal implementation details of the framework
- Commands handle error mapping and provide consistent interfaces

**Available Commands** (via `createFriggCommands({ integrationClass })`):
```javascript
// In your integration constructor:
this.commands = createFriggCommands({ integrationClass: MyIntegration });

// Available methods:
this.commands.loadIntegrationContextById(integrationId)     // Returns { context: { record, modules } }
this.commands.updateIntegrationConfig({ integrationId, config })
this.commands.findIntegrationsByUserId(userId)
this.commands.createIntegration({ entityIds, userId, config })
this.commands.findIntegrationContextByExternalEntityId(externalEntityId)
```

**Example - Loading Integration Config in Route Handler**:
```javascript
async myHandler({ req, res }) {
    const { integrationId } = req.params;

    // ✅ CORRECT: Use commands
    const result = await this.commands.loadIntegrationContextById(integrationId);
    if (result.error) {
        return res.status(result.error).json({ error: result.reason });
    }
    const config = result.context.record.config;

    // ❌ WRONG: Never use repositories directly
    // const repo = createIntegrationRepository();
    // const record = await repo.findIntegrationById(integrationId);
}
```

### Environment Variables

Required vars in `.env` (copy from `.env.example`):
```bash
# Frigg Core
MONGO_URI=mongodb://root:rootpassword@localhost:27017?retryWrites=true&w=majority
WEBSOCKET_API_ENDPOINT=http://localhost:3002
REDIRECT_PATH=/api/[integration]/auth/redirect

# Service-specific API credentials
# (Add per integration as needed)
```

## Testing Strategy

- **Test Location**: `backend/test/`
- **Test Pattern**: `*.test.js` files
- **Groups**: Tests can be grouped (`--group=-interactive --group=-live-api`)
- **Timeout**: 240s default for integration tests
- **Coverage Thresholds**: Low (10-20%) - room for improvement

## Deployment Architecture

- **Framework**: Serverless Framework via Frigg CLI
- **Infrastructure**: Defined in `infrastructure.js` (calls `createFriggInfrastructure()`)
- **VPC Management**: Auto-discovery of existing VPC/subnets/NAT
- **Encryption**: KMS for field-level encryption, auto-creates keys if needed
- **Database**: Supports both MongoDB (via connection string) and PostgreSQL

## Important Notes

- **Frigg Framework**: This project uses `@friggframework/core` v2.0 (canary)
- **Integration Registration**: Integrations in `index.js` are currently commented out - they must be uncommented to be deployed
- **Docker Required**: MongoDB runs as replica set in Docker for local development
- **Workspace Structure**: Monorepo with `backend/` workspace
- **Prettier Config**: Uses `@friggframework/prettier-config`

## Common Workflows

### Adding a Route to an Existing Integration

1. Add route definition to `static Definition.routes[]`
2. Add event handler to `this.events` in constructor
3. Implement handler method in integration class
4. Test via local server or add test case

### Debugging Integration Issues

1. Check `docker-compose` services are running
2. Verify `.env` has required credentials
3. Check integration is uncommented in `index.js`
4. Review handler implementation and module definition
5. Test API module's `testAuthRequest` method

### Syncing Data Between Services

- Use integration event handlers to orchestrate data flow
- Access API modules via `this.modules.service.api`
- Implement mapping logic in handler methods
- Consider batch operations for performance
- Handle errors and implement retry logic

## Authentication Methods

The Frigg framework supports multiple authentication methods for accessing the Management API. Configure which methods are enabled in `backend/index.js` under `user.authModes`.

### 1. Frigg Native Token (JWT)

**Use Case**: Web UI login, user-facing applications

**Configuration**: Enabled by default (`friggToken: true`)

**How to Use**:
1. Create user: `POST /user/create` with `{username, password}`
2. Login: `POST /user/login` with credentials
3. Use returned JWT in header: `Authorization: Bearer <token>`

**Example**:
```bash
# Create or login to get token
curl -X POST "http://localhost:3001/user/login" \
  -H "Content-Type: application/json" \
  -d '{"username": "user@example.com", "password": "securePassword123"}'

# Use token in requests
curl -X GET "http://localhost:3001/api/integrations" \
  -H "Authorization: Bearer <jwt-token>"
```

### 2. Shared Secret (x-frigg-api-key)

**Use Case**: Backend-to-backend integration, OAuth redirect handlers, automated services

**Configuration**: Enable in `backend/index.js`:
```javascript
user: {
    authModes: {
        sharedSecret: true,  // Enable x-frigg-api-key authentication
    }
}
```

**Required Environment Variables**:
- `FRIGG_API_KEY` - Shared secret (must match on both client and server)

**Required Headers**:
```bash
x-frigg-api-key: <FRIGG_API_KEY>        # Shared secret for authentication
x-frigg-appUserId: <user-identifier>     # Application's user ID (required)
```

**How It Works**:
1. Client sends `x-frigg-api-key` header with shared secret
2. Backend validates against `process.env.FRIGG_API_KEY`
3. Client provides `x-frigg-appUserId` to identify the user
4. Backend auto-creates user if doesn't exist
5. Request proceeds with user context

**Example**:
```bash
# Set up environment variable in backend/.env
FRIGG_API_KEY=test-backend-api-key-2024

# Make authenticated request
curl -X GET "http://localhost:3001/api/integrations" \
  -H "Content-Type: application/json" \
  -H "x-frigg-api-key: test-backend-api-key-2024" \
  -H "x-frigg-appUserId: test-user-oauth"
```

**Use in OAuth Redirect Handler**:
```javascript
// backend/auth-server/server.js example
const headers = {
    'Content-Type': 'application/json',
    'x-frigg-api-key': process.env.FRIGG_API_KEY,
    'x-frigg-appUserId': 'test-user-oauth'
};

const response = await fetch(`${BACKEND_URL}/api/authorize`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
        entityType: 'attio',
        data: { code: oauthCode }
    })
});
```

**Benefits**:
- No user login required
- Automatic user provisioning
- Perfect for server-to-server communication
- Simplifies OAuth callback handlers

**Security Notes**:
- Keep `FRIGG_API_KEY` secret and never commit to version control
- Use different keys for dev/staging/prod environments
- Rotate keys periodically
- API key must match exactly (case-sensitive, no trimming)

### 3. Adopter JWT (Custom JWT)

**Use Case**: External applications with their own JWT tokens

**Configuration**: Enable in `backend/index.js`:
```javascript
user: {
    authModes: {
        adopterJwt: true,  // Enable custom JWT authentication
    }
}
```

**How to Use**: Provide your custom JWT token in Authorization header

### Authentication Priority Order

When multiple auth modes are enabled, the framework checks in this order:

1. **Shared Secret** (Priority 1) - Checks for `x-frigg-api-key` header
2. **Adopter JWT** (Priority 2) - Checks for JWT format token in Authorization header
3. **Frigg Native Token** (Priority 3) - Validates Frigg-issued JWT

### Configuring Auth Modes

**Location**: `backend/index.js`

```javascript
const appDefinition = {
    user: {
        usePassword: true,
        authModes: {
            friggToken: true,     // Frigg native JWT (default: true)
            sharedSecret: true,   // x-frigg-api-key (default: false)
            adopterJwt: false,    // Custom JWT (default: false)
        },
    },
};
```

**Best Practice**: Enable only the auth methods you need for better security.
