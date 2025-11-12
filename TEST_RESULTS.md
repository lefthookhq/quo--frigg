# Quo API Testing Results - November 12, 2025

## Executive Summary

Testing against Quo dev environment (`dev-public-api.openphone.dev`) revealed key behaviors that explain the issues observed in the Attio integration.

## Key Findings

### 1. Bulk Create Endpoint Behavior
- **Status Code**: 202 Accepted (async processing)
- **Response Body**: Empty
- **Impact**: Integration cannot immediately verify success or get contact IDs
- **Recommendation**: Need to implement polling or wait + query strategy

### 2. Single Create Endpoint Behavior  
- **Status Code**: 201 Created (synchronous)
- **Response Body**: Full contact object with ID
- **Advantage**: Immediate verification and ID retrieval

### 3. Duplicate Phone Numbers
- **Behavior**: Quo API **ALLOWS** duplicate phone numbers
- **Result**: Both contacts created successfully (201 Created)
- **No 409 conflicts** when phone numbers are duplicated
- **Each contact gets unique ID**: Different contacts can have same phone

### 4. 409 Conflicts - Root Cause **CONFIRMED**
**🎯 CONFIRMED**: Duplicate `externalId` values cause 409 Conflict!

Testing Results:
- **Duplicate phone numbers**: ✅ Both contacts created (201 Created)
- **Duplicate externalId**: 🔴 Second contact returns 409 Conflict

The 409 conflicts in the transcript are from:
- Duplicate `externalId` values (CONFIRMED via testing)
- Re-syncing same contact without checking if it already exists
- Integration attempting to create contact that already has that externalId

## Test Results Detail

### Test 1: List Contacts
```
✅ SUCCESS
- API Key authentication works
- 10 existing contacts found
- All have source: 'attio'
- Mix of test and real data
```

### Test 2: Bulk Create
```
📦 Request: 2 contacts
📥 Response: 202 Accepted, empty body
⏱️  Processing: Async (contacts appear after ~2-3 seconds)
✅ Result: Both contacts created successfully
```

### Test 3: Single Create
```
📦 Request: 1 contact
📥 Response: 201 Created, full contact object
✅ Result: Immediate success with ID
```

### Test 4: Duplicate Phone Numbers
```
📦 Request: 2 contacts with SAME phone (+16045550123)
📥 Response 1: 201 Created (ID: 69140d9f68555ba7bd003e07)
📥 Response 2: 201 Created (ID: 69140da068555ba7bd003e09)
✅ Result: BOTH created, NO 409 conflict
```

### Test 5: Duplicate externalId
```
📦 Request: 2 contacts with SAME externalId (different phones)
📥 Response 1: 201 Created
📥 Response 2: 409 Conflict
{
  "message": "Failed to create contact",
  "code": "0800409",
  "status": 409,
  "docs": "https://openphone.com/docs",
  "title": "Conflict"
}
🎯 Result: CONFIRMED - Duplicate externalId causes 409!
```

### Test 6: Webhook Endpoints (v1 vs v2)
```
📦 Request: GET /v1/webhooks
📥 Response: 200 OK
✅ v1 endpoints work

📦 Request: GET /v2/webhooks  
📥 Response: 500 Internal Server Error
{
  "message": "An unknown error occurred while fetching webhooks",
  "code": "0301500",
  "status": 500
}
❌ v2 endpoints DO NOT exist/work

⚠️  RECOMMENDATION: Use v1 webhook endpoints only
```

## Recommendations

### For AttioIntegration.js

1. **Already Implemented**: Removed mapping check restriction
   - Location: `_findAttioContactByPhone()` method
   - Change: Now returns first matching contact without requiring sync mapping
   - Benefit: Activity logging works for any contact in Attio

2. **Add Bulk Sync Verification**:
   ```javascript
   async bulkUpsertToQuo(contacts) {
       // Current: sends request, assumes success
       const response = await this.quo.api.bulkCreateContacts(contacts);
       
       // Recommended: Wait and verify
       await new Promise(resolve => setTimeout(resolve, 2000));
       
       // Fetch by externalIds to confirm
       const externalIds = contacts.map(c => c.externalId);
       const created = await this.quo.api.listContacts({ externalIds });
       
       // Return actual success count
       return { successCount: created.data.length, errorCount: contacts.length - created.data.length };
   }
   ```

3. **Handle 409 Conflicts Gracefully** (Already partially implemented in commit 7fb4417cb):
   - In `_syncPersonToQuo()`, catch 409 errors on contact creation
   - On 409 Conflict, the contact with that externalId already exists
   - Query for existing contact by externalId: `listContacts({ externalIds: [externalId] })`
   - Update the existing contact instead of failing
   - Create/update mapping for the existing contact
   - **Root Cause**: Duplicate externalId values (Attio record ID being reused)
   - **When it happens**: Re-syncing contacts, webhook fires multiple times, race conditions

### For Testing

1. **Fresh Account Setup** (Manual):
   - Create new Quo dev account
   - Create new Attio workspace
   - Connect integration
   - Monitor logs during initial sync

2. **Webhook Testing** (Manual with Juraj):
   - Send SMS from Quo to synced contact
   - Verify webhook fires
   - Check activity logs in Attio
   - Confirm permissive lookup works

## Environment Details

- **API Base URL**: `https://dev-public-api.openphone.dev`
- **API Key**: bhCMAoOOb7... (working, dev environment)
- **Existing Contacts**: 10+ test contacts
- **Rate Limits**: 10 requests/second

## Next Steps

1. ✅ **COMPLETED**: Mapping check removed from AttioIntegration.js
2. ✅ **COMPLETED**: Test script created and all tests run successfully
3. ⏭️ **PENDING**: Deploy changes to dev environment
4. ⏭️ **PENDING**: Live testing with Juraj (requires manual intervention)
5. ⏭️ **PENDING**: Verify Pipedrive ENVs in 1Password
6. ⏭️ **PENDING**: Implement click-to-call UI extension (after core issues resolved)

## Files Modified

1. `/Users/sean/Documents/GitHub/quo--frigg/backend/src/integrations/AttioIntegration.js`
   - Removed mapping requirement in `_findAttioContactByPhone()`
   - Lines ~1929-1935: Simplified to return first match

2. `/Users/sean/Documents/GitHub/quo--frigg/backend/test-quo-api.js`
   - NEW: Direct API testing script
   - Supports dev and production environments
   - Tests: bulk-create, list-contacts, single-create, create-duplicate

## Test Script Usage

```bash
# List contacts
node backend/test-quo-api.js bhCMAoOOb7XQRYmF7gWMYgQZRk3YUNhi list-contacts --dev

# Bulk create test
node backend/test-quo-api.js bhCMAoOOb7XQRYmF7gWMYgQZRk3YUNhi bulk-create --dev

# Single create test
node backend/test-quo-api.js bhCMAoOOb7XQRYmF7gWMYgQZRk3YUNhi single-create --dev

# Duplicate phone test
node backend/test-quo-api.js bhCMAoOOb7XQRYmF7gWMYgQZRk3YUNhi create-duplicate --dev

# Duplicate externalId test (confirms 409 behavior)
node backend/test-quo-api.js bhCMAoOOb7XQRYmF7gWMYgQZRk3YUNhi duplicate-externalid --dev

# Webhook v1 vs v2 test
node backend/test-quo-api.js bhCMAoOOb7XQRYmF7gWMYgQZRk3YUNhi test-webhooks --dev
```

---
*Tests completed: November 12, 2025 at 04:31 UTC*

