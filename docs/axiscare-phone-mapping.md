# AxisCare Phone Mapping API

Map Quo phone numbers to AxisCare sites to enable call routing and webhook subscriptions.

## Endpoint

```
POST /api/axisCare-integration/:integrationId/phone-mapping
```

## Data Structure

The `phoneNumberSiteMappings` object uses **AxisCare site numbers as keys** with arrays of Quo phone numbers:

```json
{
  "phoneNumberSiteMappings": {
    "demomark": {
      "quoPhoneNumbers": ["(778) 654-4283", "(850) 468-2241"]
    },
    "berlinSite": {
      "quoPhoneNumbers": ["(555) 123-4567"]
    }
  }
}
```

## PATCH Semantics

| Element | Behavior |
|---------|----------|
| **Sites** | **Merged** - New sites are added, existing sites are updated |
| **Phone arrays** | **Replaced** - The `quoPhoneNumbers` array is replaced entirely (not merged) |

### Example

**Existing config:**
```json
{
  "site1": { "quoPhoneNumbers": ["phone1", "phone2", "phone3"] },
  "site2": { "quoPhoneNumbers": ["phone4"] }
}
```

**PATCH request:**
```json
{
  "site1": { "quoPhoneNumbers": ["phone1", "phone2"] },
  "site3": { "quoPhoneNumbers": ["phone5"] }
}
```

**Result:**
```json
{
  "site1": { "quoPhoneNumbers": ["phone1", "phone2"] },
  "site2": { "quoPhoneNumbers": ["phone4"] },
  "site3": { "quoPhoneNumbers": ["phone5"] }
}
```

- `site1`: Phone array **replaced** (phone3 removed)
- `site2`: **Unchanged** (not in PATCH request)
- `site3`: **Added** (new site)

### Removing Phones from a Site

Send an empty array to remove all phones from a site:

```json
{
  "site1": { "quoPhoneNumbers": [] }
}
```

## Response

```json
{
  "success": true,
  "message": "Phone mappings updated successfully",
  "sitesCount": 2,
  "totalPhoneCount": 3,
  "updatedSites": ["demomark", "berlinSite"],
  "webhookSync": {
    "status": "success",
    "subscriptions": {
      "call": [...],
      "callSummary": [...]
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `sitesCount` | Total number of sites configured |
| `totalPhoneCount` | Total phone numbers across all sites |
| `updatedSites` | Sites modified in this request |
| `webhookSync.status` | `success`, `no_phones`, `skipped`, or `failed` |

## Curl Examples

### Basic Setup

```bash
export BASE_URL="http://localhost:3001"
export FRIGG_API_KEY="your-api-key"
export APP_USER_ID="your-user-id"
export INTEGRATION_ID="your-integration-id"
```

### Map One Site with One Phone

```bash
curl -X POST "$BASE_URL/api/axisCare-integration/$INTEGRATION_ID/phone-mapping" \
  -H "Content-Type: application/json" \
  -H "x-frigg-api-key: $FRIGG_API_KEY" \
  -H "x-frigg-appUserId: $APP_USER_ID" \
  -d '{
    "phoneNumberSiteMappings": {
      "demomark": {
        "quoPhoneNumbers": ["(778) 654-4283"]
      }
    }
  }'
```

### Map Multiple Sites with Multiple Phones

```bash
curl -X POST "$BASE_URL/api/axisCare-integration/$INTEGRATION_ID/phone-mapping" \
  -H "Content-Type: application/json" \
  -H "x-frigg-api-key: $FRIGG_API_KEY" \
  -H "x-frigg-appUserId: $APP_USER_ID" \
  -d '{
    "phoneNumberSiteMappings": {
      "demomark": {
        "quoPhoneNumbers": ["(778) 654-4283", "(850) 468-2241"]
      },
      "berlinSite": {
        "quoPhoneNumbers": ["(555) 123-4567"]
      }
    }
  }'
```

### Update Phones for Existing Site

```bash
curl -X POST "$BASE_URL/api/axisCare-integration/$INTEGRATION_ID/phone-mapping" \
  -H "Content-Type: application/json" \
  -H "x-frigg-api-key: $FRIGG_API_KEY" \
  -H "x-frigg-appUserId: $APP_USER_ID" \
  -d '{
    "phoneNumberSiteMappings": {
      "demomark": {
        "quoPhoneNumbers": ["(778) 654-4283", "(555) 999-8888"]
      }
    }
  }'
```

### Manual Webhook Sync

Trigger webhook reconciliation without changing mappings:

```bash
curl -X POST "$BASE_URL/api/axisCare-integration/$INTEGRATION_ID/phone-mapping/sync-webhooks" \
  -H "Content-Type: application/json" \
  -H "x-frigg-api-key: $FRIGG_API_KEY" \
  -H "x-frigg-appUserId: $APP_USER_ID"
```

## Validation Errors

| Error | Cause |
|-------|-------|
| `phoneNumberSiteMappings is required` | Missing request body field |
| `phoneNumberSiteMappings must be an object` | Sent array instead of object |
| `quoPhoneNumbers must be an array for site 'X'` | Site config missing `quoPhoneNumbers` |
| `Invalid phone number in site 'X'` | Empty string in phone array |

## Webhook Sync Status

| Status | Meaning |
|--------|---------|
| `success` | Webhooks created/updated successfully |
| `no_phones` | Phone numbers not found in Quo account |
| `skipped` | Quo API not available |
| `failed` | Error occurred (check `error` field) |
