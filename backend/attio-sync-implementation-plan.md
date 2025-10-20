# Implementation Plan: Add INITIAL_SYNC to Attio Integration (CORRECTED)

## Critical Discovery: Attio API Has No Total Count

**From `attio-api-spec.json` lines 5747-5756:**
```json
{
  "data": [...]  // ONLY field in response
}
```

**No pagination metadata:**
- ❌ No `total` count
- ❌ No `has_more` boolean
- ❌ No `next_cursor` or `next_page`

**Only way to know we're done**: When `data.length < limit`

---

## Correct Classification: CURSOR_BASED (Like AxisCare)

Attio uses **offset-based pagination without total**, which in BaseCRMIntegration terms means:
- ✅ `paginationType: 'CURSOR_BASED'` (uses offset as "cursor")
- ✅ `supportsTotal: false` (API doesn't return total count)
- ✅ `returnFullRecords: true` (API returns complete objects)

**Why CURSOR_BASED not PAGE_BASED?**
- PAGE_BASED requires `total` count for fan-out optimization
- Without `total`, we must process sequentially (like AxisCare)
- Offset acts as a "cursor" (0, 50, 100, 150...)

---

## Implementation Steps

### Step 1: Update CRMConfig (AttioIntegration.js lines 72-90)

**CHANGE** to CURSOR_BASED configuration:

```javascript
static CRMConfig = {
    personObjectTypes: [
        { crmObjectName: 'people', quoContactType: 'contact' },
    ],
    syncConfig: {
        paginationType: 'CURSOR_BASED',     // ← CRITICAL: Not PAGE_BASED!
        supportsTotal: false,                // ← No total in API response
        returnFullRecords: true,             // ← API returns full objects
        reverseChronological: true,          // ✓ Already present
        initialBatchSize: 50,                // ✓ Already present
        ongoingBatchSize: 25,                // ✓ Already present
        supportsWebhooks: true,              // ✓ Already present
        pollIntervalMinutes: 30,             // ✓ Already present
    },
    queueConfig: {
        maxWorkers: 15,
        provisioned: 5,
        maxConcurrency: 50,
        batchSize: 1,
        timeout: 600,
    },
};
```

---

### Step 2: Fix fetchPersonPage() Return Structure

**Current code** (lines 150-181) is **WRONG** for CURSOR_BASED:

```javascript
// ❌ WRONG - Returns PAGE_BASED structure
async fetchPersonPage({ objectType, page, limit, modifiedSince, sortDesc = true }) {
    const params = {
        limit,
        offset: page * limit,  // ← Uses page param
        //...
    };

    const response = await this.attio.api.objects.listRecords(objectType, params);

    return {
        data: response.data || [],
        total: response.total || null,    // ← API doesn't have this!
        hasMore: response.has_more || false, // ← API doesn't have this!
    };
}
```

**CHANGE TO** CURSOR_BASED structure (like AxisCare):

```javascript
async fetchPersonPage({
    objectType,
    cursor = null,    // ← Change from 'page' to 'cursor' (offset)
    limit,
    modifiedSince,
    sortDesc = true
}) {
    try {
        const params = {
            limit,
            offset: cursor || 0,  // ← Cursor IS the offset
            sorts: [{
                attribute: 'updated_at',
                direction: sortDesc ? 'desc' : 'asc',
            }],
        };

        // Add modification filter if provided
        if (modifiedSince) {
            params.filter = {
                updated_at: {
                    $gte: modifiedSince.toISOString(),
                }
            };
        }

        const response = await this.attio.api.objects.listRecords(objectType, params);
        const persons = response.data || [];

        // Calculate next cursor (offset)
        const nextCursor = persons.length === limit
            ? (cursor || 0) + limit   // ← More pages exist
            : null;                    // ← Last page

        console.log(
            `[Attio] Fetched ${persons.length} ${objectType} at offset ${cursor || 0}, ` +
            `hasMore=${!!nextCursor}`
        );

        return {
            data: persons,
            cursor: nextCursor,              // ← Next offset (or null)
            hasMore: persons.length === limit, // ← True if full page
        };
    } catch (error) {
        console.error(`Error fetching ${objectType} at cursor ${cursor}:`, error);
        throw error;
    }
}
```

---

### Step 3: Verify Handler Flow (CURSOR_BASED Path)

**BaseCRMIntegration automatically routes to `_handleCursorBasedPagination()`:**

```
1. User triggers INITIAL_SYNC
   ↓
2. SyncOrchestrator.startInitialSync()
   - Creates Process (state=INITIALIZING)
   - Queues FETCH_PERSON_PAGE (cursor=null, limit=50)
   ↓
3. fetchPersonPageHandler() - Routes to _handleCursorBasedPagination()
   ↓
4. _handleCursorBasedPagination() - First page
   - Calls fetchPersonPage({ cursor: null, limit: 50 })
   - Returns { data: [50 people], cursor: 50, hasMore: true }
   - Processes inline: transform + bulk upsert to Quo
   - Updates Process.metadata (totalFetched=50, pageCount=1)
   - Queues FETCH_PERSON_PAGE (cursor=50) for next page
   ↓
5. _handleCursorBasedPagination() - Second page
   - Calls fetchPersonPage({ cursor: 50, limit: 50 })
   - Returns { data: [50 people], cursor: 100, hasMore: true }
   - Processes inline again
   - Updates metadata (totalFetched=100, pageCount=2)
   - Queues next page (cursor=100)
   ↓
6. Continues sequentially until last page
   - fetchPersonPage({ cursor: 4950, limit: 50 })
   - Returns { data: [30 people], cursor: null, hasMore: false }
   - Processes inline
   - metadata (totalFetched=4980, pageCount=100)
   - Queues COMPLETE_SYNC
   ↓
7. completeSyncHandler()
   - Process state → COMPLETED
   - Duration: ~10-15 minutes for 5000 records (sequential)
```

**Key Difference from PAGE_BASED:**
- ✅ **Sequential processing** (one page at a time)
- ✅ **Inline transform/upsert** (no separate batch queue)
- ✅ **Progressive total** (updates as we go)
- ❌ **No fan-out** (can't parallelize without total count)

---

### Step 4: Remove Unused Methods (Optional Cleanup)

Since we're using CURSOR_BASED with inline processing:

**fetchPersonsByIds() is NEVER called** - Can remove or leave for webhooks

```javascript
// This method is only used in PAGE_BASED pagination
// CURSOR_BASED processes records inline in _handleCursorBasedPagination
async fetchPersonsByIds(ids) {
    // Not used in CURSOR_BASED sync flow
    // But keep for potential webhook use
    const persons = [];
    for (const id of ids) {
        try {
            const person = await this.fetchPersonById(id);
            persons.push(person);
        } catch (error) {
            console.error(`Failed to fetch person ${id}:`, error.message);
        }
    }
    return persons;
}
```

---

## Performance Comparison

| Metric | PAGE_BASED (w/ total) | CURSOR_BASED (no total) |
|--------|----------------------|-------------------------|
| **Pattern** | Fan-out (parallel) | Sequential |
| **5000 records** | ~2-3 minutes | ~10-15 minutes |
| **Concurrency** | 50-100 workers | 1 worker at a time |
| **Memory** | Low (IDs only) | Low (same) |
| **API Calls** | Same (100 pages) | Same (100 pages) |
| **Progress Tracking** | Estimated from start | Updates as we go |

**Trade-off**: Slower sync, but works without total count API support.

---

## Testing Strategy

### Unit Tests
1. **Test fetchPersonPage() with cursor**:
   - `cursor=null` → Returns offset 0, next cursor 50
   - `cursor=50` → Returns offset 50, next cursor 100
   - Last page → `cursor=null`, `hasMore=false`

2. **Test cursor calculation**:
   - Full page (50 records) → cursor increments
   - Partial page (30 records) → cursor = null

3. **Mock Attio API response**:
   ```javascript
   { data: [...50 records...] }  // Only field!
   ```

### Integration Tests
1. **Small sync** (100 people):
   - Verify 2 pages processed sequentially
   - Check metadata updates progressively
   - Verify all 100 in Quo

2. **Empty response** (0 people):
   - First page returns `{ data: [] }`
   - Should complete immediately
   - No errors

3. **Exact page boundary** (100 people, limit=50):
   - Page 1: 50 records, cursor=50
   - Page 2: 50 records, cursor=null (end)

---

## Potential Issues & Mitigations

### Issue 1: Slow Sync Speed
- **Reality**: 5000 people = 10-15 minutes (vs 2-3 min for PAGE_BASED)
- **Acceptable?**: For initial sync, this is fine
- **Mitigation**: Users can trigger during off-hours

### Issue 2: Company Lookup N+1 Problem (CRITICAL)
- **Risk**: `transformPersonToQuo()` line 228 fetches company for EVERY person
- **Impact**: 5000 people × 2 API calls = 10,000 API calls total!
- **Solution**: **Disable company lookup in initial sync**, add comment:

```javascript
async transformPersonToQuo(person) {
    // ... existing code ...

    // Extract company - DISABLED for initial sync (N+1 problem)
    // TODO: Implement batch company fetch or cache
    let company = null;
    // const companyLinks = attributes.primary_company || [];
    // if (companyLinks.length > 0...) { ... }

    return { ... };
}
```

### Issue 3: Rate Limiting
- **Risk**: Sequential sync makes many consecutive API calls
- **Mitigation**: Add delay between pages if needed
- **Monitor**: Watch for 429 errors

### Issue 4: Lambda Timeout
- **Risk**: Each page fetch runs in same Lambda (not new invocation)
- **Reality**: BaseCRM queues each page separately, so each is a new Lambda
- **Safe**: Each Lambda processes 1 page (~50 records) then completes

---

## Files to Modify

### 1. `backend/src/integrations/AttioIntegration.js`

**Lines 72-90** - Update CRMConfig:
```javascript
paginationType: 'CURSOR_BASED',
supportsTotal: false,
returnFullRecords: true,
```

**Lines 150-181** - Rewrite fetchPersonPage():
- Change `page` param to `cursor`
- Calculate next cursor: `(cursor || 0) + limit`
- Return `{ data, cursor, hasMore }`

**Lines 228-237** - Disable company lookup (optional):
```javascript
// Company lookup disabled for performance
let company = null;
```

### 2. `backend/src/integrations/AttioIntegration.test.js` (if exists)
- Update tests for cursor-based pagination
- Mock response: `{ data: [...] }` only

---

## Rollback Plan

If sync is too slow or has issues:

1. **Disable INITIAL_SYNC**: Remove `paginationType` from CRMConfig
2. **Keep manual routes**: Existing list routes still work
3. **Investigate**: Check logs for errors
4. **Alternative**: Implement custom sync with caching/batching

---

## Success Criteria

✅ INITIAL_SYNC event appears in UI
✅ Process created and tracks progress
✅ All people synced to Quo (verify counts match)
✅ No duplicate contacts
✅ Process.metadata shows progressive totals
✅ Sync completes within 20 minutes for 5000 records
✅ No 429 rate limit errors
✅ Error rate < 1%

---

## Estimated Effort

- **CRMConfig update**: 2 minutes (3 lines)
- **fetchPersonPage() rewrite**: 15 minutes
- **Company lookup fix**: 5 minutes (comment out)
- **Testing**: 1-2 hours
- **Optimization** (if needed): 2-4 hours

**Total**: 2-4 hours including testing

---

## Summary of Changes

1. **Set `paginationType: 'CURSOR_BASED'`** (not PAGE_BASED)
2. **Set `supportsTotal: false`** (API doesn't provide total)
3. **Rewrite fetchPersonPage()** to use cursor (offset) instead of page
4. **Return structure**: `{ data, cursor, hasMore }`
5. **Disable company lookup** to avoid N+1 problem
6. **Test with small dataset** before full sync

That's it! The CURSOR_BASED path in BaseCRMIntegration handles everything else automatically.
