# Phone Mapping Manual Test Guide

This document contains manual tests for the AxisCare phone mapping and webhook subscription management feature.

## Prerequisites

1. Local server running: `npm run frigg:start`
2. An existing AxisCare integration (both AxisCare and Quo modules connected)
3. Environment variables set:
   - `FRIGG_API_KEY` - Your shared secret for API authentication
   - `BASE_URL` - Your local server URL (default: `http://localhost:3001`)

## Setup Variables

```bash
# Set these before running tests
export BASE_URL="http://localhost:3001"
export FRIGG_API_KEY="your-api-key-here"
export APP_USER_ID="test-user"
export INTEGRATION_ID="your-axiscare-integration-id"
```

To find your integration ID:
```bash
curl -s "$BASE_URL/api/integrations" \
  -H "x-frigg-api-key: $FRIGG_API_KEY" \
  -H "x-frigg-appUserId: $APP_USER_ID" | jq '.[] | select(.type == "axiscare-integration") | .id'
```

---

## Test 1: Validation - Missing phoneNumberSiteMappings

**Purpose**: Verify that the endpoint returns 400 when `phoneNumberSiteMappings` is missing.

```bash
curl -X POST "$BASE_URL/api/axisCare-integration/$INTEGRATION_ID/phone-mapping" \
  -H "Content-Type: application/json" \
  -H "x-frigg-api-key: $FRIGG_API_KEY" \
  -H "x-frigg-appUserId: $APP_USER_ID" \
  -d '{}'
```

**Expected Result**:
```json
{
  "error": "phoneNumberSiteMappings is required"
}
```
**Status**: `400 Bad Request`

---

## Test 2: Validation - phoneNumberSiteMappings is Array (not Object)

**Purpose**: Verify that the endpoint rejects arrays.

```bash
curl -X POST "$BASE_URL/api/axisCare-integration/$INTEGRATION_ID/phone-mapping" \
  -H "Content-Type: application/json" \
  -H "x-frigg-api-key: $FRIGG_API_KEY" \
  -H "x-frigg-appUserId: $APP_USER_ID" \
  -d '{"phoneNumberSiteMappings": []}'
```

**Expected Result**:
```json
{
  "error": "phoneNumberSiteMappings must be an object"
}
```
**Status**: `400 Bad Request`

---

## Test 3: Validation - Missing axisCareSiteNumber

**Purpose**: Verify validation catches missing required field.

```bash
curl -X POST "$BASE_URL/api/axisCare-integration/$INTEGRATION_ID/phone-mapping" \
  -H "Content-Type: application/json" \
  -H "x-frigg-api-key: $FRIGG_API_KEY" \
  -H "x-frigg-appUserId: $APP_USER_ID" \
  -d '{
    "phoneNumberSiteMappings": {
      "+15551234567": {
        "label": "Test Site"
      }
    }
  }'
```

**Expected Result**:
```json
{
  "error": "axisCareSiteNumber is required for phone number '+15551234567'"
}
```
**Status**: `400 Bad Request`

---

## Test 4: Validation - Missing label

**Purpose**: Verify validation catches missing label field.

```bash
curl -X POST "$BASE_URL/api/axisCare-integration/$INTEGRATION_ID/phone-mapping" \
  -H "Content-Type: application/json" \
  -H "x-frigg-api-key: $FRIGG_API_KEY" \
  -H "x-frigg-appUserId: $APP_USER_ID" \
  -d '{
    "phoneNumberSiteMappings": {
      "+15551234567": {
        "axisCareSiteNumber": "demomark"
      }
    }
  }'
```

**Expected Result**:
```json
{
  "error": "label is required for phone number '+15551234567'"
}
```
**Status**: `400 Bad Request`

---

## Test 5: Success - Create First Phone Mapping

**Purpose**: Verify successful creation of phone mapping with webhook sync.

```bash
curl -X POST "$BASE_URL/api/axisCare-integration/$INTEGRATION_ID/phone-mapping" \
  -H "Content-Type: application/json" \
  -H "x-frigg-api-key: $FRIGG_API_KEY" \
  -H "x-frigg-appUserId: $APP_USER_ID" \
  -d '{
    "phoneNumberSiteMappings": {
      "+15551234567": {
        "axisCareSiteNumber": "demomark",
        "label": "Demo Mark Office"
      }
    }
  }'
```

**Expected Result**:
```json
{
  "success": true,
  "message": "Phone mappings updated successfully",
  "mappingsCount": 1,
  "updatedMappings": ["+15551234567"],
  "webhookSync": {
    "status": "success",
    "subscriptions": {
      "call": [...],
      "callSummary": [...]
    }
  }
}
```
**Status**: `200 OK`

**Verify**: Check `webhookSync.status` is one of:
- `"success"` - Webhooks created/updated
- `"no_phones"` - No phone IDs resolved (phone not in Quo)
- `"skipped"` - Quo API not available
- `"failed"` - Error occurred (check `webhookSync.error`)

---

## Test 6: PATCH Semantics - Add Second Phone Mapping

**Purpose**: Verify new mappings are merged with existing ones.

```bash
curl -X POST "$BASE_URL/api/axisCare-integration/$INTEGRATION_ID/phone-mapping" \
  -H "Content-Type: application/json" \
  -H "x-frigg-api-key: $FRIGG_API_KEY" \
  -H "x-frigg-appUserId: $APP_USER_ID" \
  -d '{
    "phoneNumberSiteMappings": {
      "+15559876543": {
        "axisCareSiteNumber": "site2",
        "label": "Second Site Office"
      }
    }
  }'
```

**Expected Result**:
```json
{
  "success": true,
  "message": "Phone mappings updated successfully",
  "mappingsCount": 2,
  "updatedMappings": ["+15559876543"],
  "webhookSync": {...}
}
```
**Status**: `200 OK`

**Verify**: `mappingsCount` should be 2 (original + new), `updatedMappings` should only contain the new phone number.

---

## Test 7: PATCH Semantics - Update Existing Mapping

**Purpose**: Verify updating an existing phone mapping overwrites it.

```bash
curl -X POST "$BASE_URL/api/axisCare-integration/$INTEGRATION_ID/phone-mapping" \
  -H "Content-Type: application/json" \
  -H "x-frigg-api-key: $FRIGG_API_KEY" \
  -H "x-frigg-appUserId: $APP_USER_ID" \
  -d '{
    "phoneNumberSiteMappings": {
      "+15551234567": {
        "axisCareSiteNumber": "newsite",
        "label": "Updated Site Name"
      }
    }
  }'
```

**Expected Result**:
```json
{
  "success": true,
  "message": "Phone mappings updated successfully",
  "mappingsCount": 2,
  "updatedMappings": ["+15551234567"],
  "webhookSync": {...}
}
```
**Status**: `200 OK`

**Verify**: The mapping for `+15551234567` should now have `axisCareSiteNumber: "newsite"`.

---

## Test 8: Manual Webhook Sync

**Purpose**: Verify manual webhook reconciliation endpoint works.

```bash
curl -X POST "$BASE_URL/api/axisCare-integration/$INTEGRATION_ID/phone-mapping/sync-webhooks" \
  -H "Content-Type: application/json" \
  -H "x-frigg-api-key: $FRIGG_API_KEY" \
  -H "x-frigg-appUserId: $APP_USER_ID"
```

**Expected Result (with mappings)**:
```json
{
  "success": true,
  "message": "Webhook subscriptions synced successfully",
  "status": "success",
  "subscriptions": {
    "call": [
      {
        "webhookId": "...",
        "chunkIndex": 0,
        "phoneCount": 2
      }
    ],
    "callSummary": [...]
  },
  "totalCallWebhooks": 1,
  "totalCallSummaryWebhooks": 1,
  "syncedAt": "2025-12-15T..."
}
```
**Status**: `200 OK`

**Expected Result (no mappings)**:
```json
{
  "success": true,
  "message": "No phone mappings configured - nothing to sync",
  "subscriptions": { "call": [], "callSummary": [] }
}
```

---

## Test 9: Verify Config Contains Phone Metadata

**Purpose**: Verify that `phoneNumbersMetadata` is populated after setup.

```bash
curl -s "$BASE_URL/api/integrations" \
  -H "x-frigg-api-key: $FRIGG_API_KEY" \
  -H "x-frigg-appUserId: $APP_USER_ID" | jq '.[] | select(.id == "'$INTEGRATION_ID'") | .config | {phoneNumbersMetadata, phoneNumberSiteMappings, phoneNumberWebhookSubscriptions}'
```

**Expected Result**:
```json
{
  "phoneNumbersMetadata": [
    { "id": "phone-uuid-1", "phoneNumber": "+15551234567", ... },
    { "id": "phone-uuid-2", "phoneNumber": "+15559876543", ... }
  ],
  "phoneNumberSiteMappings": {
    "+15551234567": { "axisCareSiteNumber": "newsite", "label": "Updated Site Name" },
    "+15559876543": { "axisCareSiteNumber": "site2", "label": "Second Site Office" }
  },
  "phoneNumberWebhookSubscriptions": {
    "call": [...],
    "callSummary": [...]
  }
}
```

---

## Test 10: Chunking (10+ Phone Numbers)

**Purpose**: Verify that more than 10 phones creates multiple webhook chunks.

```bash
curl -X POST "$BASE_URL/api/axisCare-integration/$INTEGRATION_ID/phone-mapping" \
  -H "Content-Type: application/json" \
  -H "x-frigg-api-key: $FRIGG_API_KEY" \
  -H "x-frigg-appUserId: $APP_USER_ID" \
  -d '{
    "phoneNumberSiteMappings": {
      "+15550000001": { "axisCareSiteNumber": "site1", "label": "Site 1" },
      "+15550000002": { "axisCareSiteNumber": "site2", "label": "Site 2" },
      "+15550000003": { "axisCareSiteNumber": "site3", "label": "Site 3" },
      "+15550000004": { "axisCareSiteNumber": "site4", "label": "Site 4" },
      "+15550000005": { "axisCareSiteNumber": "site5", "label": "Site 5" },
      "+15550000006": { "axisCareSiteNumber": "site6", "label": "Site 6" },
      "+15550000007": { "axisCareSiteNumber": "site7", "label": "Site 7" },
      "+15550000008": { "axisCareSiteNumber": "site8", "label": "Site 8" },
      "+15550000009": { "axisCareSiteNumber": "site9", "label": "Site 9" },
      "+15550000010": { "axisCareSiteNumber": "site10", "label": "Site 10" },
      "+15550000011": { "axisCareSiteNumber": "site11", "label": "Site 11" },
      "+15550000012": { "axisCareSiteNumber": "site12", "label": "Site 12" }
    }
  }'
```

**Expected Result**:
- `webhookSync.subscriptions.call` should have 2 entries (chunk 0 with 10 phones, chunk 1 with 2 phones)
- `webhookSync.subscriptions.callSummary` should have 2 entries

**Note**: This test requires all 12 phone numbers to exist in your Quo account. Unresolved phones will be skipped.

---

## Cleanup: Remove Test Mappings

To reset the phone mappings for fresh testing, you'll need to either:
1. Delete and recreate the integration, OR
2. Directly update the integration config to remove `phoneNumberSiteMappings`

---

## Troubleshooting

### Webhook sync returns `no_phones`
- The phone numbers in your mappings don't match any phones in your Quo account
- Check that `phoneNumbersMetadata` contains the phones you're trying to map
- Phone number formats must match (with or without country code)

### Webhook sync returns `skipped`
- Quo module is not connected or API is unavailable
- Verify the integration has a valid Quo credential

### Webhook sync returns `failed`
- Check the `error` field for details
- Common causes: Quo API rate limits, network issues, invalid webhook URL

### 503 Service Unavailable on sync-webhooks
- Quo API not available
- Ensure Quo module is properly connected to the integration
