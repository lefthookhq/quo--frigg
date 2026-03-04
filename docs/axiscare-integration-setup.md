# AxisCare Integration Setup

Step-by-step guide to create an AxisCare integration via the Frigg Management API.

## Prerequisites

```bash
export FRIGG_URL="https://your-frigg-instance.execute-api.us-east-1.amazonaws.com"
export FRIGG_API_KEY="your-shared-secret-key"
export APP_USER_ID="your-app-user-id"
export APP_ORG_ID="your-app-org-id"
```

## Step 1: Authorize Quo API Module (`quo-axisCare`)

```bash
curl -X POST "${FRIGG_URL}/api/authorize" \
  -H "Content-Type: application/json" \
  -H 'x-frigg-api-key: '"${FRIGG_API_KEY}" \
  -H "x-frigg-appuserid: ${APP_USER_ID}" \
  -H "x-frigg-apporgid: ${APP_ORG_ID}" \
  -d '{
    "entityType": "quo-axisCare",
    "data": { "apiKey": "<QUO_API_KEY>" }
  }'
# Returns: { "entity_id": "...", "credential_id": "...", "type": "quo-axisCare" }
```

## Step 2: Authorize AxisCare API Module

```bash
curl -X POST "${FRIGG_URL}/api/authorize" \
  -H "Content-Type: application/json" \
  -H 'x-frigg-api-key: '"${FRIGG_API_KEY}" \
  -H "x-frigg-appuserid: ${APP_USER_ID}" \
  -H "x-frigg-apporgid: ${APP_ORG_ID}" \
  -d '{
    "entityType": "axisCare",
    "data": {
      "apiKey": "<AXISCARE_API_KEY>",
      "siteNumber": "<SITE_NUMBER>"
    }
  }'
# Returns: { "entity_id": "...", "credential_id": "...", "type": "axisCare" }
```

## Step 3: Create Integration

```bash
curl -X POST "${FRIGG_URL}/api/integrations" \
  -H "Content-Type: application/json" \
  -H 'x-frigg-api-key: '"${FRIGG_API_KEY}" \
  -H "x-frigg-appuserid: ${APP_USER_ID}" \
  -H "x-frigg-apporgid: ${APP_ORG_ID}" \
  -d '{
    "entities": ["<QUO_ENTITY_ID>", "<AXISCARE_ENTITY_ID>"],
    "config": { "type": "axisCare" }
  }'
# Returns: { "id": "...", "status": "ENABLED", ... }
```

## Step 4: Configure Phone Number Site Mappings

Maps Quo phone numbers to AxisCare site numbers for webhook routing. See [axiscare-phone-mapping.md](axiscare-phone-mapping.md) for full details.

```bash
curl -X POST "${FRIGG_URL}/api/axisCare-integration/<INTEGRATION_ID>/phone-mapping" \
  -H "Content-Type: application/json" \
  -H 'x-frigg-api-key: '"${FRIGG_API_KEY}" \
  -H "x-frigg-appuserid: ${APP_USER_ID}" \
  -H "x-frigg-apporgid: ${APP_ORG_ID}" \
  -d '{
    "phoneNumberSiteMappings": {
      "<SITE_NUMBER>": {
        "quoPhoneNumbers": ["(207) 424-0486", "(329) 219-0700"]
      }
    }
  }'
# Automatically sets up Quo call/callSummary webhooks for the mapped phones
```

## Step 5: Trigger Initial Sync

```bash
curl -X POST "${FRIGG_URL}/api/integrations/<INTEGRATION_ID>/actions/INITIAL_SYNC" \
  -H "Content-Type: application/json" \
  -H 'x-frigg-api-key: '"${FRIGG_API_KEY}" \
  -H "x-frigg-appuserid: ${APP_USER_ID}" \
  -H "x-frigg-apporgid: ${APP_ORG_ID}" \
  -d '{}'
# Syncs Client, Lead, Caregiver, and Applicant records from AxisCare to Quo
```
