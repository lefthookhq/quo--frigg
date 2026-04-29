---
'quo-integrations-frigg': patch
---

Add SQS `DelaySeconds` (default 5s) to every paginated `FETCH_PERSON_PAGE` enqueue in `QueueManager.queueFetchPersonPage` and `QueueManager.fanOutPages`. Cursor-based pagination self-publishes the next page from inside the queue worker — Lambda → SQS → same Lambda — and AWS Lambda's recursive-loop detector terminates that chain at depth 16. The math is exact: any sync >800 records (16 pages × 50) was being silently truncated. On 2026-04-27 this fired four times in account 973314620327: prod `attioQueueWorker` (first drop 02:05Z, 17 total), prod `pipedriveQueueWorker` (15:05Z, 12), prod `zohoQueueWorker` (15:30Z, 6), and dev `zohoQueueWorker` (2026-04-28 21:20Z, 3). A non-zero `DelaySeconds` severs the trace lineage so each page starts fresh — AWS's recommended fix for tight Lambda→SQS→Lambda self-publish patterns.

Default of 5s is configurable per-integration via `static CRMConfig.syncConfig.paginationDelaySeconds`. Sync-time impact: ~5s × pages — about +8 minutes on a 5,000-record Attio initial sync, which is a small price for not silently dropping the last 80% of the data. Pass `paginationDelaySeconds: 0` to opt out for syncs known to stay under 16 pages.

Wires through `BaseCRMIntegration._handleCursorBasedPagination` and `_handlePageBasedPagination`. `AxisCareIntegration` and `SyncOrchestrator` (which call `queueFetchPersonPage` directly) inherit the default automatically — no changes needed there.
