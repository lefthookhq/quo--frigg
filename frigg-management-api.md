# Frigg Management API Guide

Complete guide for interacting with the Frigg Management API using curl commands.

## Table of Contents

- [Setup & Configuration](#setup--configuration)
- [Authentication Methods](#authentication-methods)
- [Workflow 1: Create a Frigg User](#workflow-1-create-a-frigg-user)
- [Workflow 2: Login with a Frigg User](#workflow-2-login-with-a-frigg-user)
- [Workflow 3: Authenticate with API Modules](#workflow-3-authenticate-with-api-modules)
- [Workflow 4: Create Integration](#workflow-4-create-integration)

---

## Setup & Configuration

### Base URL

```bash
# Local development
export FRIGG_URL="http://localhost:3001"

# Production/Deployed
export FRIGG_URL="https://your-frigg-instance.execute-api.us-east-1.amazonaws.com"
```

### Required Environment Variables

For API module authentication, ensure these are configured in your Frigg deployment:

```bash
# Backend-to-Backend Authentication (for x-frigg headers)
FRIGG_APP_API_KEY=your-secret-api-key-here

# Quo CRM
QUO_API_KEY=your-quo-api-key

# AxisCare
AXISCARE_API_KEY=your-axiscare-api-key
AXISCARE_BASE_URL=https://demomark.axiscare.com

# Attio OAuth
ATTIO_CLIENT_ID=your-client-id
ATTIO_CLIENT_SECRET=your-client-secret
ATTIO_SCOPE=user_management:read-write record_permission:read-write...

# ScaleTest (development only)
SCALE_TEST_API_KEY=any-dummy-key
```

**Note:** The `FRIGG_APP_API_KEY` is required if you plan to use X-Frigg headers for backend-to-backend authentication.

---

## Authentication Methods

Frigg Management API supports two authentication methods:

### Method 1: JWT Token Authentication (User-Facing)

Use JWT tokens for user-facing applications. Users must create an account and login to get a token.

**Required Headers:**
```bash
Authorization: Bearer ${FRIGG_JWT_TOKEN}
```

**Use Case:** Web applications, mobile apps, user dashboards

### Method 2: Shared Secret Authentication (Backend-to-Backend)

Use x-frigg headers for backend-to-backend communication, automated scripts, and testing.

**Required Headers:**
```bash
x-frigg-api-key: ${FRIGG_API_KEY}
x-frigg-appuserid: ${FRIGG_APP_USER_ID}
```

**Use Case:** Backend services, automated scripts, CI/CD pipelines, OAuth redirect handlers

**Environment Variables:**
```bash
export FRIGG_API_KEY="your-shared-secret-key"
export FRIGG_APP_USER_ID="your-user-identifier"
```

**Example Request:**
```bash
curl -X GET "${FRIGG_URL}/api/integrations" \
  -H "Content-Type: application/json" \
  -H "x-frigg-api-key: ${FRIGG_API_KEY}" \
  -H "x-frigg-appuserid: ${FRIGG_APP_USER_ID}"
```

**Note:** The shared secret credentials (`FRIGG_API_KEY` and `FRIGG_APP_USER_ID`) should be provided by the system administrator who deployed the Frigg instance.

---

## Workflow 1: Create a Frigg User

### Method A: Password-Based User Creation

Create a new user account with username (email) and password:

```bash
curl -X POST "${FRIGG_URL}/user/create" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "user@example.com",
    "password": "securePassword123"
  }'
```

**Response:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

## Workflow 2: Login with a Frigg User

Login with existing credentials to get an authentication token:

```bash
curl -X POST "${FRIGG_URL}/user/login" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "user@example.com",
    "password": "securePassword123"
  }'
```

**Response:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

## Workflow 3: Authenticate with API Modules

Before creating an integration, you must authenticate each API module to create "entities" (authenticated connections).

### API Key Modules (Quo, AxisCare, ScaleTest)

API key modules use a simple 2-step process:

#### Step 1: Get Authorization Requirements

**Using JWT Token:**
```bash
curl -X GET "${FRIGG_URL}/api/authorize?entityType=quo" \
  -H "Authorization: Bearer ${FRIGG_JWT_TOKEN}"
```

**Using Shared Secret:**
```bash
curl -X GET "${FRIGG_URL}/api/authorize?entityType=quo" \
  -H "x-frigg-api-key: ${FRIGG_API_KEY}" \
  -H "x-frigg-appuserid: ${FRIGG_APP_USER_ID}"
```

**Response:**

```json
{
  "type": "apiKey",
  "jsonSchema": {
    "type": "object",
    "properties": {
      "apiKey": {
        "type": "string",
        "title": "API Key"
      }
    },
    "required": ["apiKey"]
  }
}
```

#### Step 2: Submit Credentials to Create Entity

**Quo Example (Using JWT Token):**

```bash
curl -X POST "${FRIGG_URL}/api/authorize" \
  -H "Authorization: Bearer ${FRIGG_JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "entityType": "quo",
    "data": {
      "apiKey": "'"${QUO_API_KEY}"'"
    }
  }'
```

**Quo Example (Using Shared Secret):**

```bash
curl -X POST "${FRIGG_URL}/api/authorize" \
  -H "x-frigg-api-key: ${FRIGG_API_KEY}" \
  -H "x-frigg-appuserid: ${FRIGG_APP_USER_ID}" \
  -H "Content-Type: application/json" \
  -d '{
    "entityType": "quo",
    "data": {
      "apiKey": "'"${QUO_API_KEY}"'"
    }
  }'
```

**Response:**

```json
{
  "entity_id": "7",
  "credential_id": "12",
  "entityType": "quo"
}
```

### OAuth Modules (Attio)

OAuth modules require user interaction through a browser:

#### Step 1: Get OAuth Authorization URL

**Using JWT Token:**
```bash
curl -X GET "${FRIGG_URL}/api/authorize?entityType=attio" \
  -H "Authorization: Bearer ${FRIGG_JWT_TOKEN}"
```

**Using Shared Secret:**
```bash
curl -X GET "${FRIGG_URL}/api/authorize?entityType=attio" \
  -H "x-frigg-api-key: ${FRIGG_API_KEY}" \
  -H "x-frigg-appuserid: ${FRIGG_APP_USER_ID}"
```

**Response:**

```json
{
  "type": "oauth2",
  "url": "https://app.attio.com/authorize?client_id=...&redirect_uri=...&scope=...&state=..."
}
```

#### Step 2: User Completes OAuth Flow

1. **Extract the URL** from the response
2. **Open URL in browser** - User logs into Attio and authorizes
3. **User is redirected back** to your Frigg instance
4. **Frigg automatically creates** the entity

---

## Workflow 4: Create Integration

Once you have authenticated multiple API modules (entities), you can create an integration.

### Create Integration

**Important**: The `entities` parameter must be an **array of entity IDs**, not an object.

**Using JWT Token:**
```bash
curl -X POST "${FRIGG_URL}/api/integrations" \
  -H "Authorization: Bearer ${FRIGG_JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "entities": ["3", "4"],
    "config": {
      "type": "attio"
    }
  }'
```

**Using Shared Secret:**
```bash
curl -X POST "${FRIGG_URL}/api/integrations" \
  -H "x-frigg-api-key: ${FRIGG_API_KEY}" \
  -H "x-frigg-appuserid: ${FRIGG_APP_USER_ID}" \
  -H "Content-Type: application/json" \
  -d '{
    "entities": ["3", "4"],
    "config": {
      "type": "attio"
    }
  }'
```

**Response:**

```json
{
  "id": "16",
  "entities": ["7", "11"],
  "status": "ENABLED",
  "config": {
    "type": "attio"
  }
}
```

### Integration Types

The `config.type` field determines which integration class is used:

| Type           | API Modules     | Description                      |
| -------------- | --------------- | -------------------------------- |
| `axiscare`     | quo + axiscare  | AxisCare to Quo client sync      |
| `attio`        | quo + attio     | Attio to Quo person/company sync |
| `scaling-test` | quo + scaletest | Development/testing integration  |

### Get Integration Details

```bash
curl -X GET "${FRIGG_URL}/api/integrations/${INTEGRATION_ID}" \
  -H "Authorization: Bearer ${FRIGG_JWT_TOKEN}"
```

### List All Integrations

```bash
curl -X GET "${FRIGG_URL}/api/integrations" \
  -H "Authorization: Bearer ${FRIGG_JWT_TOKEN}"
```

### Update Integration Configuration

```bash
curl -X PATCH "${FRIGG_URL}/api/integrations/${INTEGRATION_ID}" \
  -H "Authorization: Bearer ${FRIGG_JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "syncDirection": "unidirectional",
      "autoSync": true
    }
  }'
```

### Delete Integration

```bash
curl -X DELETE "${FRIGG_URL}/api/integrations/${INTEGRATION_ID}" \
  -H "Authorization: Bearer ${FRIGG_JWT_TOKEN}"
```

### Trigger Integration Actions

Many integrations support actions like initial sync:

```bash
curl -X POST "${FRIGG_URL}/api/integrations/${INTEGRATION_ID}/actions/INITIAL_SYNC" \
  -H "Authorization: Bearer ${FRIGG_JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "message": "Initial sync started for AxisCare clients",
  "processIds": ["36"],
  "clientObjectTypes": ["clients"]
}
```
