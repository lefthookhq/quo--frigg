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
