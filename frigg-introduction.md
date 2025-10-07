# Frigg Integration Framework: A Comprehensive Introduction

## What is Frigg?

Frigg is a powerful, opinionated **integration framework** designed to accelerate the development of **direct/native integrations** between software products and external partners. It solves the perennial problem of integration development—eliminating the need to reinvent the wheel for every new integration project while providing enterprise-grade scalability and maintainability.

### The Vision

Imagine a world where you can:
- **Spin up an integration** requested by customers, product teams, or partnership teams in **minutes**
- **Deploy to production** within a **single day**
- Receive **automated notifications** when upstream APIs change
- Get **automatic version bumps** with new updates incorporated and tested
- Run everything on **your own cloud accounts** (no vendor lock-in)

This is Frigg's vision: transforming integration development from a time-consuming, repetitive process into a streamlined, scalable operation.

## The Problem Frigg Solves

### Traditional Integration Challenges

Software integrations have plagued developers since the first "hello world" application. The traditional approach involves:

1. **Reinventing the Wheel**: Building custom solutions for each integration
2. **API Learning Overhead**: Developers spend time learning APIs they may only use once
3. **Maintenance Burden**: Each integration becomes a potential time sink
4. **Lack of Scalability**: No reusable patterns or standardized approaches
5. **High Operational Costs**: Traditional solutions require expensive servers or create vendor lock-in

### The Frigg Solution

Frigg addresses these challenges by providing:

- **Structured, Reusable Codebase**: Opinionated architecture that promotes consistency
- **Rapid Development**: Get from concept to production in hours, not weeks
- **Serverless Architecture**: Low-cost, highly scalable deployment model
- **No Vendor Lock-in**: Run on your own cloud infrastructure
- **Enterprise-Grade Features**: Built-in security, monitoring, and error handling

## How Frigg Works

### Core Architecture

Frigg implements a **hexagonal architecture** (ports and adapters pattern) that separates business logic from external concerns. This architectural approach ensures:

- **Clean Separation of Concerns**: Domain logic remains independent of infrastructure
- **High Testability**: Each component can be tested in isolation
- **Maintainability**: Changes to external systems don't affect core business logic
- **Extensibility**: New integrations can be added without modifying existing code

```
┌─────────────────────────────────────────────────────────────────┐
│                     Frigg Architecture                         │
├─────────────────────────────────────────────────────────────────┤
│  Inbound Adapters    │    Application Layer   │ Outbound Adapters│
│                      │                        │                  │
│  ├─ Express Routes   │  ├─ Use Cases          │ ├─ Database Repos│
│  ├─ Lambda Handlers  │  ├─ Services           │ ├─ API Modules   │
│  ├─ WebSocket APIs   │  ├─ Coordinators       │ ├─ Event Publishers
│                      │                        │                  │
│       ▼              │         ▼              │        ▲         │
│                      │                        │                  │
│              Domain Layer (Core Business Logic)                  │
│              ├─ Integration Aggregates                           │
│              ├─ Entities                                         │
│              ├─ Domain Events                                    │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

1. **Integration Base**: Core abstract class that all integrations extend
2. **API Modules**: Reusable connectors for third-party services
3. **Module Factory**: Creates and manages module instances
4. **Event Bus**: Handles cross-cutting concerns and notifications
5. **Repository Layer**: Manages data persistence and retrieval
6. **Use Cases**: Encapsulate business logic operations

### Development Workflow

1. **Install Frigg CLI**: `npm install -g @friggframework/devtools`
2. **Create Integration Project**: `create-frigg-app my-integration`
3. **Install API Modules**: `npm install @friggframework/api-module-[service]`
4. **Define Integration Logic**: Extend `IntegrationBase` with your business rules
5. **Configure Deployment**: Use built-in Serverless Framework support
6. **Deploy**: `frigg deploy`

## System Requirements

### Runtime Requirements

- **Node.js**: Version 18 or higher
- **npm**: Version 9 or higher
- **MongoDB**: For data persistence (MongoDB Atlas recommended)

### Development Dependencies

```json
{
  "node": ">=18",
  "npm": ">=9",
  "auto": "11.3.0",
  "nx": "20.3.2",
  "lerna": "8.1.9"
}
```

### Cloud Infrastructure (Production)

- **AWS Account**: For serverless deployment
- **API Gateway**: REST and WebSocket APIs
- **AWS Lambda**: Function execution
- **CloudFormation**: Infrastructure as code
- **MongoDB Atlas**: Database hosting (recommended)

### Optional Tools

- **Docker**: For containerized development
- **Serverless Framework**: Enhanced deployment capabilities
- **Jest**: Testing framework (included)

## API Modules: The Heart of Frigg

### What are API Modules?

API Modules are **reusable connector packages** that define how to connect to third-party systems and what APIs are available. They are the building blocks that make Frigg integrations powerful and efficient.

### API Module Structure

Every API module follows a standardized contract:

```javascript
module.exports = {
    moduleName: 'service-name',        // Unique identifier
    API: ServiceAPIClass,              // Main API class
    requiredAuthMethods: {             // Authentication methods
        getToken: function,
        getEntityDetails: function,
        getCredentialDetails: function,
        apiPropertiesToPersist: object,
        testAuthRequest: function
    },
    env: {},                          // Environment variables
    modelName: 'ServiceModel'         // Optional model name
};
```

### How API Modules Work

1. **Installation**: `npm install @friggframework/api-module-hubspot`
2. **Module Loading**: Frigg automatically discovers installed modules
3. **Instance Creation**: Modules are instantiated with user credentials
4. **API Access**: Access third-party APIs through standardized interface

### API Module Integration Pattern

In your integration file, API modules are accessed through a clean, intuitive pattern:

```javascript
class MyIntegration extends IntegrationBase {
    async syncContacts() {
        // Direct access to third-party APIs
        const contacts = await this.hubspot.api.getContacts();
        const leads = await this.salesforce.api.createLeads(contacts);
        return leads;
    }
}
```

The pattern `this.{moduleName}.api.{method}()` provides:
- **Consistent Interface**: Same pattern across all integrations
- **Automatic Authentication**: Token management handled transparently
- **Error Handling**: Built-in retry logic and error recovery
- **Type Safety**: TypeScript definitions included

## Why API Modules are Critical

### 1. **Eliminates Redundant Work**

Without API modules, every integration team would need to:
- Learn each third-party API from scratch
- Implement authentication flows
- Handle rate limiting and pagination
- Build error handling and retry logic
- Maintain API client libraries

API modules encapsulate all this complexity into reusable packages.

### 2. **Ensures Consistency**

API modules provide:
- **Standardized Authentication**: OAuth2, API keys, JWT tokens handled uniformly
- **Consistent Error Handling**: Standardized error types and retry strategies
- **Uniform Data Formats**: Normalized responses across different services
- **Predictable Interfaces**: Same method patterns regardless of underlying API

### 3. **Accelerates Development**

With API modules, developers can:
- **Skip API Learning Curve**: Use familiar patterns instead of reading docs
- **Reuse Existing Work**: Leverage modules built by the community
- **Focus on Business Logic**: Spend time on integration value, not API mechanics
- **Rapid Prototyping**: Test integration concepts in minutes

### 4. **Improves Maintainability**

API modules provide:
- **Centralized Updates**: API changes handled in one place
- **Version Management**: Controlled rollout of API updates
- **Backward Compatibility**: Smooth migration paths for breaking changes
- **Community Support**: Shared maintenance burden across users

### 5. **Enterprise-Grade Features**

Built-in capabilities include:
- **Automatic Token Refresh**: OAuth2 tokens refreshed transparently
- **Rate Limit Handling**: Automatic backoff and retry logic
- **Request Logging**: Detailed audit trails for compliance
- **Error Recovery**: Graceful handling of transient failures

### 6. **Ecosystem Benefits**

The API module ecosystem provides:
- **Growing Library**: Expanding collection of pre-built connectors
- **Community Contributions**: Shared development and maintenance
- **Quality Assurance**: Tested and validated by multiple users
- **Documentation**: Comprehensive guides and examples

## Advanced Features

### Event-Driven Architecture

Frigg uses an event-driven architecture for handling cross-cutting concerns:

```javascript
// Token refresh events
eventBus.publish(new TokenRefreshedEvent({
    userId: 'user123',
    tokenData: { access_token: 'new_token' },
    timestamp: Date.now()
}));

// Authentication failure events
eventBus.publish(new AuthenticationInvalidEvent({
    userId: 'user123',
    reason: 'Token expired'
}));
```

### Automatic Token Management

API modules handle OAuth2 token refresh automatically:

1. **Token Expiry Detection**: Monitors token expiration
2. **Automatic Refresh**: Refreshes tokens using refresh tokens
3. **Transparent Updates**: API calls continue without interruption
4. **Credential Persistence**: Updated tokens saved to database
5. **Event Notification**: Other components notified of token changes

### Integration Lifecycle Management

Frigg provides comprehensive lifecycle management:

- **Creation**: Initialize integrations with proper configuration
- **Configuration**: Dynamic configuration options based on connected services
- **Authentication**: Test and validate API credentials
- **Monitoring**: Track integration health and performance
- **Updates**: Handle configuration and credential updates
- **Deletion**: Clean up resources and revoke access

### Testing and Quality Assurance

Frigg promotes Test-Driven Development (TDD):

- **Unit Tests**: Isolated testing of business logic
- **Integration Tests**: End-to-end testing with real APIs
- **Mock Support**: Built-in mocking for development and testing
- **Test Utilities**: Shared testing infrastructure and helpers

## Deployment and Scalability

### Serverless Deployment

Frigg leverages serverless architecture for optimal cost and scalability:

```yaml
# Automatic serverless.yml generation
service: my-integration
provider:
  name: aws
  runtime: nodejs18.x
functions:
  app:
    handler: index.handler
    events:
      - http:
          path: /{proxy+}
          method: ANY
      - websocket:
          route: $connect
```

### Infrastructure as Code

- **CloudFormation Templates**: Reproducible infrastructure
- **Environment Management**: Separate dev/staging/production
- **Resource Optimization**: Cost-effective resource allocation
- **Monitoring Integration**: CloudWatch logs and metrics

### Scaling Characteristics

- **Automatic Scaling**: Lambda functions scale with demand
- **Cost Efficiency**: Pay only for actual usage
- **High Availability**: Multi-AZ deployment by default
- **Global Distribution**: Deploy to multiple regions

## Getting Started

### Quick Start

1. **Install CLI**:
   ```bash
   npm install -g @friggframework/devtools
   ```

2. **Create Project**:
   ```bash
   create-frigg-app my-integration
   cd my-integration
   ```

3. **Install API Modules**:
   ```bash
   npm install @friggframework/api-module-hubspot
   npm install @friggframework/api-module-salesforce
   ```

4. **Define Integration**:
   ```javascript
   const { IntegrationBase } = require('@friggframework/core');
   
   class MyIntegration extends IntegrationBase {
       static Definition = {
           name: 'HubSpot to Salesforce Sync',
           version: '1.0.0',
           modules: {
               hubspot: require('@friggframework/api-module-hubspot'),
               salesforce: require('@friggframework/api-module-salesforce')
           }
       };
       
       async syncContacts() {
           const contacts = await this.hubspot.api.getContacts();
           return await this.salesforce.api.createContacts(contacts);
       }
   }
   
   module.exports = MyIntegration;
   ```

5. **Deploy**:
   ```bash
   frigg deploy
   ```

### Learning Resources

- **Documentation**: [docs.friggframework.org](https://docs.friggframework.org)
- **Community**: [Frigg Framework Slack](https://friggframework.org/#contact)
- **Examples**: Browse the `api-module-library` for real-world examples
- **GitHub**: [github.com/friggframework/frigg](https://github.com/friggframework/frigg)

## Community and Ecosystem

Frigg is built with community collaboration in mind:

- **Open Source**: MIT licensed with transparent development
- **Community Contributions**: API modules contributed by users
- **Shared Maintenance**: Distributed maintenance burden
- **Quality Standards**: Rigorous testing and documentation requirements

### Contributing

Ways to contribute to the Frigg ecosystem:

1. **Build API Modules**: Create connectors for new services
2. **Improve Documentation**: Help others learn and adopt Frigg
3. **Report Issues**: Help identify and fix bugs
4. **Share Examples**: Contribute integration patterns and recipes
5. **Community Support**: Help others in Slack and GitHub discussions

## Conclusion

Frigg represents a paradigm shift in integration development. By providing a structured, opinionated framework with reusable API modules, it transforms integration development from a time-consuming, error-prone process into a streamlined, scalable operation.

The combination of hexagonal architecture, serverless deployment, and a thriving ecosystem of API modules makes Frigg an ideal choice for organizations looking to build enterprise-grade integrations quickly and cost-effectively.

Whether you're building your first integration or managing dozens of complex data flows, Frigg provides the tools, patterns, and community support needed to succeed in today's interconnected software landscape.

---

*For more information, visit [FriggFramework.org](https://friggframework.org) or explore the [documentation](https://docs.friggframework.org).*