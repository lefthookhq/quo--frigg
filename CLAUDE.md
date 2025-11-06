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

## Management API Reference

Complete reference for all Frigg Management API endpoints. For detailed workflow examples with curl commands, see `frigg-management-api.md`.

### Base URL Setup

```bash
# Local development
export FRIGG_URL="http://localhost:3001"

# Production/Deployed
export FRIGG_URL="https://your-frigg-instance.execute-api.us-east-1.amazonaws.com"
```

### Authentication Methods

The Frigg framework supports multiple authentication methods:

**1. Bearer Token (JWT)** - Most common for user operations
```bash
Authorization: Bearer <jwt-token>
```

**2. X-Frigg Headers** - Custom user identification
```bash
x-frigg-user-id: <user-id>
x-frigg-app-user-id: <app-user-id>
x-frigg-organization-user-id: <org-user-id>  # Optional
```

**3. Admin API Key** - For health and migration endpoints
```bash
x-frigg-admin-api-key: <admin-api-key>
```

**4. Health API Key** - For health check endpoints
```bash
x-frigg-health-api-key: <health-api-key>
```

### User Management

**POST /user/create** - Create new user account
```bash
curl -X POST "${FRIGG_URL}/user/create" \
  -H "Content-Type: application/json" \
  -d '{"username": "user@example.com", "password": "securePassword123"}'
```
Response: `{ "token": "jwt-token-string" }`

**POST /user/login** - Authenticate and receive JWT
```bash
curl -X POST "${FRIGG_URL}/user/login" \
  -H "Content-Type: application/json" \
  -d '{"username": "user@example.com", "password": "securePassword123"}'
```
Response: `{ "token": "jwt-token-string" }`

### Integration Management

**GET /api/integrations** - List all integrations for authenticated user
- Returns: `{ entities: {...}, integrations: [...] }`
- Auth: Bearer token required

**POST /api/integrations** - Create new integration
```bash
curl -X POST "${FRIGG_URL}/api/integrations" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "entities": ["entity-id-1", "entity-id-2"],
    "config": {"type": "attio"}
  }'
```
Response: Integration object with id, entities, status, config

**GET /api/integrations/:integrationId** - Get integration details
- Auth: Bearer token required

**PATCH /api/integrations/:integrationId** - Update integration config
- Body: `{ "config": { "updatedField": "newValue" } }`
- Auth: Bearer token required

**DELETE /api/integrations/:integrationId** - Delete integration
- Returns: 204 No Content
- Auth: Bearer token required

**GET /api/integrations/:integrationId/config/options** - Get dynamic form fields for configuration
- Auth: Bearer token required

**POST /api/integrations/:integrationId/config/options/refresh** - Refresh config options based on selection
- Auth: Bearer token required

**ALL /api/integrations/:integrationId/actions** - List available user actions
- Returns: `{ actions: [{ id: "INITIAL_SYNC", label: "...", type: "USER_ACTION" }] }`
- Auth: Bearer token required

**POST /api/integrations/:integrationId/actions/:actionId** - Execute user action
```bash
curl -X POST "${FRIGG_URL}/api/integrations/${INTEGRATION_ID}/actions/INITIAL_SYNC" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}'
```
Common actions: `INITIAL_SYNC`, `TRIGGER_SYNC`, `PAUSE_SYNC`, `RESUME_SYNC`

**GET /api/integrations/:integrationId/test-auth** - Test authentication for all entities
- Returns: `{ status: "ok" }` or error details
- Auth: Bearer token required

### Entity & Credential Management

**GET /api/authorize?entityType=\{type\}** - Get OAuth authorization requirements
```bash
curl -X GET "${FRIGG_URL}/api/authorize?entityType=quo" \
  -H "Authorization: Bearer ${TOKEN}"
```
Returns: For API key modules: `{ type: "apiKey", jsonSchema: {...} }`
Returns: For OAuth modules: `{ type: "oauth2", url: "https://..." }`

**POST /api/authorize** - Submit credentials to create entity
```bash
curl -X POST "${FRIGG_URL}/api/authorize" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "entityType": "quo",
    "data": {"apiKey": "your-api-key"}
  }'
```
Response: `{ entity_id: "7", credential_id: "12", entityType: "quo" }`

**POST /api/entity** - Create entity from existing credential
- Body: `{ entityType: "...", data: { credential_id: "..." } }`
- Auth: Bearer token required

**GET /api/entity/options/:credentialId?entityType=\{type\}** - Get entity options
- Auth: Bearer token required

**GET /api/entities/:entityId** - Get entity details
- Auth: Bearer token required

**GET /api/entities/:entityId/test-auth** - Test entity authentication
- Auth: Bearer token required

**POST /api/entities/:entityId/options** - Get entity-specific options (workspaces, projects)
- Auth: Bearer token required

### Health & Monitoring

**GET /health** - Basic health check (public endpoint)
```bash
curl -X GET "${FRIGG_URL}/health"
```
Response: `{ status: "ok", timestamp: "...", service: "frigg-core-api" }`

**GET /health/detailed** - Comprehensive health check
- Checks: network, KMS, database, encryption, external APIs, integrations
- Auth: `x-frigg-health-api-key` required
- Returns: 200 OK (healthy) or 503 Service Unavailable (unhealthy)

**GET /health/live** - Liveness probe for Kubernetes/ECS
- Auth: `x-frigg-health-api-key` required

**GET /health/ready** - Readiness probe (checks database and modules)
- Auth: `x-frigg-health-api-key` required

### Database Migration (Admin)

**GET /db-migrate/status?stage=\{stage\}** - Check migration status
```bash
curl -X GET "${FRIGG_URL}/db-migrate/status?stage=production" \
  -H "x-frigg-admin-api-key: ${ADMIN_API_KEY}"
```
Response: `{ upToDate: false, pendingMigrations: 3, recommendation: "..." }`

**POST /db-migrate** - Trigger database migration (async via SQS)
```bash
curl -X POST "${FRIGG_URL}/db-migrate" \
  -H "x-frigg-admin-api-key: ${ADMIN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"stage": "production"}'
```
Response: `{ success: true, processId: "...", statusUrl: "/db-migrate/..." }`

**GET /db-migrate/:migrationId** - Get migration status
- Auth: `x-frigg-admin-api-key` required

### WebSocket Events

**Pattern**: `wss://${WEBSOCKET_API_ENDPOINT}`

- **CONNECT** - Establish WebSocket connection
- **DISCONNECT** - Close WebSocket connection
- **MESSAGE** - Handle incoming message: `{ action: "message-type", data: {...} }`

### Integration-Specific Routes (Dynamic)

**Pattern**: `/api/{integration-name}-integration/{custom-path}`

Each integration can define custom routes in `static Definition.routes[]`. These routes are dynamically generated and map to integration event handlers.

Example for HubSpot integration:
- `GET /api/hubspot-integration/workspaces` → `LIST_WORKSPACES` event
- `POST /api/hubspot-integration/sync` → `TRIGGER_SYNC` event
- `GET /api/hubspot-integration/status` → `GET_STATUS` event

Auth: Bearer token required for all integration-specific routes

### Webhook Endpoints

**POST /api/{integration-name}-integration/webhooks** - Generic webhook receiver
- No integration ID required
- Integration handles routing based on payload
- Auth: Integration-specific signature headers (e.g., `X-Hub-Signature-256`)

**POST /api/{integration-name}-integration/webhooks/:integrationId** - Integration-specific webhook
- Routes to specific integration instance
- Auth: Integration-specific signature headers

Examples:
- `POST /api/hubspot-integration/webhooks`
- `POST /api/salesforce-integration/webhooks/abc123`

### OAuth Redirect Handler

**GET /api/integrations/redirect/:appId** - OAuth callback handler
- Handles OAuth redirects from external services
- Forwards query params (code, state, error) to frontend
- Redirects to: `${FRONTEND_URI}/redirect/${appId}?${queryParams}`

### Common Error Responses

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Missing Parameter: entityType is required."
}
```

**Status Codes**:
- `400` Bad Request - Invalid parameters or validation errors
- `401` Unauthorized - Missing or invalid authentication
- `403` Forbidden - User doesn't have access
- `404` Not Found - Resource doesn't exist
- `500` Internal Server Error - Server-side error
- `503` Service Unavailable - Service unhealthy

### Required Environment Variables

```bash
# Database
MONGO_URI=mongodb://...
DATABASE_URL=postgresql://...  # Auto-set by infrastructure
DB_TYPE=postgresql  # or 'mongodb'

# AWS
AWS_REGION=us-east-1
KMS_KEY_ARN=arn:aws:kms:...  # For encryption
S3_BUCKET_NAME=...  # For migration status

# API Configuration
FRONTEND_URI=https://your-frontend.com  # OAuth redirects
WEBSOCKET_API_ENDPOINT=wss://...  # WebSocket connections

# Authentication
HEALTH_API_KEY=secret-health-key
ADMIN_API_KEY=secret-admin-key

# Stage
STAGE=production  # 'local' bypasses encryption
```

### Integration Config Types

The `config.type` field determines which integration class is used:

| Type           | API Modules     | Description                      |
| -------------- | --------------- | -------------------------------- |
| `axiscare`     | quo + axiscare  | AxisCare to Quo client sync      |
| `attio`        | quo + attio     | Attio to Quo person/company sync |
| `pipedrive`    | quo + pipedrive | PipeDrive to Quo sync            |
| `zoho-crm`     | quo + zoho-crm  | Zoho CRM to Quo sync             |
| `scaling-test` | quo + scaletest | Development/testing integration  |
