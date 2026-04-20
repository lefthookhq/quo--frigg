# Stuck CRM-sync chains — cursor=800 SQS message vanishes

**Status:** Active. Workaround: manual SQS re-send of the missing message. Long-term mitigation: watchdog Lambda (not yet built).

**First observed:** 2026-04-20 during Attio integration 800 (Murphy Advisory Solutions) onboarding.

**Reproductions on integration 800:** processes 8185, 8189, 8218, 8223, 8224 — every single `INITIAL_SYNC` run hits the same wall after fetching exactly 16 pages.

---

## TL;DR

For the Attio CRM sync, every `initial sync` that has to paginate past 16 pages gets stuck at cursor=800. The 16th page-fetch Lambda runs cleanly, enqueues the 17th message (`FETCH_PERSON_PAGE` cursor=800) to SQS, and AWS acknowledges it with a MessageId. **No Lambda ever runs with that MessageId.** The message doesn't show up visible in the queue, isn't NotVisible, isn't in the DLQ, and doesn't trigger an orphan Lambda invocation. It just… vanishes.

Manually re-sending the same body via `aws sqs send-message` delivers it instantly. So the queue and Lambda are both healthy at the moment of the manual test — the issue is time-correlated with the chain's 17th send.

---

## Symptoms

**Process row, always identical pattern:**

```
state:              FETCHING_PAGE
context.metadata:   { pageCount: 16, lastCursor: 750, totalFetched: 800 }
context.pagination: { hasMore: true, pageSize: 50, currentCursor: null }
results.aggregate:  { totalSynced: 38, totalFailed: 0 }
updatedAt:          <timestamp of the 16th Lambda's exit>
```

**Integration 800 sync chain behavior:**

```
cursor=null → fetch 50 at offset 0   → page 1 synced (2-3 records)
cursor=50   → fetch 50 at offset 50  → page 2 synced
cursor=100  → …
…
cursor=700  → fetch 50 at offset 700 → page 15 synced
cursor=750  → fetch 50 at offset 750 → page 16 synced
cursor=800  → ❌ never delivered to Lambda
```

Total synced stays at 38 across all 5 reproductions (sum of 2-3 phone-having contacts per page × 16 pages; the other ~762 records have no phone and are skipped by design).

---

## Normal chain — how the sync is supposed to work

```
 ┌─────────────────┐
 │ HTTP: POST /api │
 │ /actions/       │
 │ INITIAL_SYNC    │
 └────────┬────────┘
          │
          ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  Lambda: auth  (HTTP handler)                                │
 │  SyncOrchestrator.startInitialSync({processId, cursor=null}) │
 │  → SendMessageBatch([FETCH_PERSON_PAGE cursor=null])         │
 └────────┬─────────────────────────────────────────────────────┘
          │
          │   ╔═══════════════════════════╗
          ├──▶║  SQS: AttioQueue          ║
          │   ╚═══════════════════════════╝
          ▼            │
                       │ ESM polls, invokes Lambda
                       ▼
 ┌────────────────────────────────────────────────────────────┐
 │  Lambda #1: attioQueueWorker                               │
 │  fetchPersonPageHandler({cursor=null})                     │
 │  • Attio API → 50 records at offset 0                      │
 │  • inline: bulkUpsertToQuo(50) → 2 synced, 48 no-phone     │
 │  • processManager.updateMetadata({lastCursor: null,        │
 │                                   pageCount: 1,            │
 │                                   totalFetched: 50})       │
 │  • SendMessageBatch([FETCH_PERSON_PAGE cursor=50])  ◀──┐   │
 │  • return {batchItemFailures: []} → SQS deletes input  │   │
 └────────────────────────────────────────────────────────│───┘
                                                          │
                                   ┌──────────────────────┘
                                   │ same pattern
                                   ▼
 ┌────────────────────────────────────────────────────────────┐
 │  Lambda #2-16: each fetches 50 records at next offset,     │
 │  processes inline, enqueues the next cursor, exits         │
 │                                                            │
 │  cursor=50  → enqueue cursor=100                           │
 │  cursor=100 → enqueue cursor=150                           │
 │  …                                                         │
 │  cursor=700 → enqueue cursor=750                           │
 │  cursor=750 → enqueue cursor=800  ◀── the 17th send!       │
 └────────────────────────────────────────────────────────────┘
                            │
                            ▼
 ┌────────────────────────────────────────────────────────────┐
 │  Lambda #17 (SHOULD run next): cursor=800                  │
 │  • Would fetch 50 records at offset 800                    │
 │  • Would sync them                                         │
 │  • Would enqueue cursor=850                                │
 └────────────────────────────────────────────────────────────┘

   Chain continues until Attio returns < 50 records (hasMore=false),
   at which point COMPLETE_SYNC is enqueued and Process moves to COMPLETED.
```

---

## What actually happens — process 8224, CloudWatch evidence

```
Lambda #16 — RequestId 1118fe46
┌──────────────────────────────────────────────────────────────────┐
│ 19:28:45.640  [Worker] record begin  msg=9a6d69..  (page 16)     │
│ 19:28:45.709  [QueueWorker] dispatching FETCH_PERSON_PAGE        │
│ 19:28:45.709  [BaseCRM] Cursor-based pagination: cursor=750      │
│ 19:28:46.045  [Attio] Fetched 50 people at offset 750            │
│ 19:28:46.046  [BaseCRM] Fetched 50 records, hasMore=true         │
│ 19:28:46.082  [BaseCRM] Processing 50 records inline             │
│ 19:28:46–48  (bulkUpsertToQuo — 2 synced, 48 no-phone)           │
│ 19:28:48.056  [BaseCRM] Queuing next page with cursor=800        │
│ 19:28:48.056  Enqueuing 1 entries on SQS                         │
│ 19:28:48.056  [buffer logged: Id=a4c946f4, body=cursor:800]      │
│ 19:28:48.064  ┌─────────────────────────────────────────────┐    │
│               │ sqs.send(SendMessageBatchCommand)           │    │
│               │   AWS HTTP 200 response                     │    │
│               │   Successful: [{MessageId: '7059e3c6...'}]  │    │
│               │   Failed: []                                │    │
│               └─────────────────────────────────────────────┘    │
│ 19:28:48.064  [QueuerUtilWrapper] SendMessageBatch ok: 1/1       │
│ 19:28:48.064  [QueueWorker] FETCH_PERSON_PAGE dispatched ok      │
│ 19:28:48.064  [Worker] record success                            │
│ 19:28:48.066  END RequestId                                      │
│ 19:28:48.066  REPORT  Duration: 2426ms                           │
└──────────────────────────────────────────────────────────────────┘
                             │
                             │ AWS SQS says "I have message 7059e3c6"
                             ▼
                   ╔═══════════════════════════╗
                   ║  SQS: AttioQueue          ║
                   ║                           ║
                   ║  MessageId 7059e3c6 is…   ║
                   ║        ???                ║
                   ║                           ║
                   ║  • Not visible            ║
                   ║  • Not in-flight          ║
                   ║  • Not in DLQ             ║
                   ║  • Never delivered to     ║
                   ║    Lambda (no logs, no    ║
                   ║    orphan invocations)    ║
                   ╚═══════════════════════════╝
                             │
                     ┌───────┴────────┐
                     │                │
                     ▼                ▼
           Other messages       cursor=800 message
           continue flowing     (never seen again)
           through normally
                     │
                     ▼
        Process 8224 sits frozen at:
          state: FETCHING_PAGE
          updatedAt: 19:28:48.052
          synced: 38, pages: 16, fetched: 800
          (forever, because nothing will ever trigger the next step)
```

---

## Proof the queue + Lambda are fine — manual re-send

```
19:33:54.103 (5 minutes later, manual re-send of identical body via AWS CLI)
                                                   │
                                                   ▼
                    ╔═══════════════════════════╗
                    ║  SQS accepts: MessageId   ║
                    ║   2d33a9fe-221c-…         ║
                    ╚═══════════════╦═══════════╝
                                    │ ← instant delivery by ESM
                                    ▼
┌──────────────────────────────────────────────────────────────────┐
│  Lambda — RequestId 3ab8c04b                                     │
│  19:33:54.103  [Worker] record begin  msg=2d33a9fe  cursor=800   │
│  19:33:54.192  [BaseCRM] Cursor-based pagination: cursor=800     │
│  19:33:54.xxx  [Attio] Fetched 50 people at offset 800           │
│  19:33:54.xxx  [BaseCRM] Processing 50 records inline            │
│  19:33:57.081  [Worker] record success                           │
│  (continues the chain: enqueues cursor=850, 900, 950, …)         │
└──────────────────────────────────────────────────────────────────┘

  → Chain resumes. Process 8224 unblocks. Same body, same queue,
    same concurrency settings. The only difference is the TIMING.
```

Same MessageBody, same queue, same Lambda ESM, same concurrency — the manual send delivers in <100ms. The issue is narrowly time-correlated with the 17th send at the end of a rapid chain.

---

## What we ruled out

| Hypothesis | Disproof |
|-----------|----------|
| Lambda concurrency throttling | Zero Lambda throttles in the minute of the send (CloudWatch) and ReservedConcurrentExecutions bumped to 50 |
| Aurora connection exhaustion | Aurora MaxCapacity raised to 5.0 ACU, peak connections ~53/~540 max |
| SQS DLQ after MaxReceiveCount=3 | DLQ `NumberOfMessagesSent = 0` for the entire day |
| Message retention expiry | 4-day retention; messages are minutes old |
| AWS partial-batch failure | `SendMessageBatchResult.Failed[]` is empty; AWS returned `Successful: [{ MessageId }]` |
| HaltError swallow path | No `[createHandler] halt error suppressed` / `[Worker] record halted` logs for these messages |
| Silent Lambda crash before first log | 94 RequestIds in the post-send window, zero orphans (every START has matching handler logs) |
| State-machine code bug (17th message skipped) | Same body sent manually → delivered and processed correctly |
| Message body invalid | Same body works when sent manually |
| Integration DISABLED/ERROR guard | Integration 800 status = ENABLED throughout |
| KMS / SSE issue | Would affect all messages equally; other messages deliver fine |
| Cold start init failure | Would produce an orphan RequestId (no orphans found) |
| Queue name mismatch / wrong queue | Buffer log shows the exact AttioQueue URL being targeted |

---

## Most plausible remaining explanation

**SQS durability / delivery edge case at the boundary of a chain's final send.** When a Lambda finishes a batch and immediately returns success to the ESM (`batchItemFailures: []`), AWS commits a DELETE of the inbound message. If the same Lambda's `SendMessageBatchCommand` for the outbound message is still being committed on AWS's side (distributed storage replication), there may be a rare race where the outbound send's MessageId is issued but the message never lands durably.

Across 5 reproductions on integration 800:
- Every run fails at the same spot
- Each at a different UTC time, across different infra configurations (pre-bump, post-bump, post-deploy)
- 100% reproducible for this specific sync, 0% for manual sends → pattern is tied to the chain-ending send

Without AWS Support inspecting the ESM's internal state, this can't be conclusively proven. But it fits every observed symptom.

---

## Current workaround

Manual SQS re-send via AWS CLI unblocks the chain. Example for process 8224 at cursor=800:

```bash
AWS_PROFILE=quo-deploy aws sqs send-message \
  --region us-east-1 \
  --queue-url "https://sqs.us-east-1.amazonaws.com/973314620327/quo-integrations--prod-AttioQueue" \
  --message-body '{"event":"FETCH_PERSON_PAGE","data":{"processId":"<ID>","personObjectType":"people","page":null,"cursor":<LOST_CURSOR>,"limit":50,"modifiedSince":null,"sortDesc":true}}'
```

Where `<ID>` is the stuck Process ID and `<LOST_CURSOR>` is `context.metadata.lastCursor + context.pagination.pageSize`. The `processId` MUST be a string (without quoting it, Frigg's `UpdateProcessState` validation throws "processId must be a non-empty string").

---

## Long-term mitigation — watchdog Lambda

**Not yet built.** Design notes below.

### Variant A: Periodic janitor (recommended)

A new scheduled Lambda that scans for stuck processes and re-enqueues their next message.

**Schedule:** every 2-5 min via EventBridge / serverless `@schedule`.

**Scan query (Postgres):**
```sql
SELECT id, "integrationId", state, context, results, "updatedAt"
FROM "Process"
WHERE state IN ('FETCHING_PAGE', 'PROCESSING_BATCHES')
  AND "updatedAt" < NOW() - INTERVAL '3 minutes'
  AND type = 'CRM_SYNC'
ORDER BY "updatedAt" ASC
LIMIT 50;
```

**Per-candidate action:**
1. Load the integration; skip if `status !== 'ENABLED'`
2. Read `context.metadata.watchdogResends` (int, default 0); cap at 5 to avoid infinite loops
3. Compute next cursor: `lastCursor = context.metadata.lastCursor`; `nextCursor = lastCursor + context.pagination.pageSize`
4. Guard: only re-enqueue if `context.pagination.hasMore === true`
5. Send `FETCH_PERSON_PAGE` via the existing local `QueueManager.queueFetchPersonPage`
6. Increment `context.metadata.watchdogResends` in the Process row
7. Log `[Watchdog] re-enqueued { processId, cursor, stuckFor, resends }`

**Idempotency guarantees:**
- `fetchPersonPage(offset=N)` is deterministic under stable reads
- `bulkUpsertToQuo` upserts by `externalId` — re-running produces the same mapping, not a duplicate
- `upsertMapping` is keyed on `(integrationId, phoneNumber)` — re-running updates `lastSyncedAt`, no duplicates
- If the original message somehow surfaces after the re-enqueue, worst case is one page processed twice, which is harmless

**Rollout plan:**
1. Build watchdog Lambda + EventBridge rule in `backend/serverless.js`
2. Handler at `backend/src/handlers/watchdogStuckProcesses.js` (~150 lines)
3. Deploy to dev; verify metrics for a day (ideally 0 re-enqueues for healthy syncs, occasional for real stuck cases)
4. Deploy to prod
5. Add CloudWatch metric filter on `[Watchdog] re-enqueued` → alarm if counts spike (would indicate an underlying regression)

### Variant B: End-of-chain verify-and-resend (rejected)

Wrap `QueuerUtilWrapper.batchSend` to verify the outbound message landed by polling `GetQueueAttributes` after a short delay. Rejected because:
- Adds 2+ seconds to every page Lambda
- `ApproximateNumberOfMessages` is unreliable under concurrent traffic
- Same AWS bug could hit the verify call

---

## Observability changes already landed

Shipped as part of debugging this incident so that future occurrences (or recurrences) are fully traceable:

### Frigg framework PR #578
`friggframework/frigg` PR **#578** — observability logs in `@friggframework/core`:
- `packages/core/queues/queuer-util.js`: inspects `SendMessageBatchResult.Failed[]` on every send; logs partial failures with per-entry `Code` / `Message` / `event` / `processId` / `integrationId`
- `packages/core/core/Worker.js`: per-record `begin` / `success` / `halted` / `failed` logs with `messageId` + `ApproximateReceiveCount`
- `packages/core/handlers/backend-utils.js`: hydration phase logs (`hydrating by processId`, `hydrated`, `dispatching`, `dispatched ok`)
- `packages/core/core/create-handler.js`: WARN log when HaltErrors are suppressed (previously silent)

### Quo-side local wrapper
`quo--frigg` PR — same `SendMessageBatch` inspection ported into `backend/src/base/services/QueuerUtilWrapper.js`. This was necessary because `BaseCRMIntegration._createQueueManager` wires `QueueManager` to the local wrapper, not to Frigg core's `QueuerUtil`. Without this, the framework-level logs never fire on the active code path.

### Infra bumps (also related)
- `attioQueueWorker` `ReservedConcurrentExecutions`: 20 → 50 (`aws lambda put-function-concurrency`). Survives deploys because Serverless's CloudFormation diff doesn't regenerate the property when unchanged in the template.
- Aurora `MaxCapacity`: 1.0 → 5.0 ACU (`aws rds modify-db-cluster`). Aurora CPU was pinned at 100% for a week before this; immediately dropped to ~68% after the bump.

---

## Open questions

- Is this AWS SQS issue specific to a queue attribute, region, or account, or is it a general SDK/service-integration quirk? Would AWS Support be willing to inspect the ESM's internal state for a specific lost MessageId?
- Would switching to FIFO queues (with content-based deduplication disabled) avoid the issue? FIFO has stronger ordering + exactly-once delivery semantics, at the cost of 300 msg/sec throughput cap per message group. Probably not worth it for CRM syncs, but worth knowing.
- Could we bypass the issue entirely by using SQS Worker Pool batching (fetching multiple pages per Lambda invocation with a while-loop) instead of a message-per-page chain? That trades off retry granularity for fewer SQS hops.
- Once Quo fixes the API-key-propagation delay, `QueuerUtilWrapper` can be deleted entirely and everything routes through Frigg core's `QueuerUtil`. At that point the Quo-side observability patch becomes obsolete.

---

## Affected tenants

- **Integration 800** (Murphy Advisory Solutions, org `ORays1Jp0J`, user `US8lMxx8kK` — Jeff Murphy). 5 confirmed stuck sync attempts on 2026-04-20.
- Likely many more — DB query showed **347 processes in `FETCHING_PAGE` state** across all integrations. Every CRM sync that paginates past a certain threshold is at risk until the watchdog lands. Biggest candidates by `fetched` count: integrations 8912 (184), 8911 (750), 8847 (750), 8845 (1500), 8812 (750), 4211, 5183, 4232, 5249, 4203, 4725, 4267, 4095, 7132.

---

## Timeline — 2026-04-20

| UTC | Event |
|-----|-------|
| 14:54 | Process 8185 for int 800 triggered. Stuck at cursor=800. |
| 15:27 | Process 8189 retry. Same stuck pattern. |
| 16:39 | Infra bumps: attioQueueWorker concurrency 20→30, Aurora 1.0→5.0 ACU. |
| 16:51 | Process 8218 retry. Stuck again. |
| 16:49 | attioQueueWorker concurrency bumped again: 30→50. |
| 17:03 | Manual SQS send of cursor=800 (string processId) unblocks process 8218. |
| 19:02 | Process 8223 retry (post-Frigg-canary deploy). Stuck. |
| 19:26 | Process 8224 retry (post-local-wrapper-logs deploy). Stuck. First run with full observability across both wrappers. |
| 19:28 | Confirmed: `SendMessageBatch` returned `Successful: [{MessageId: 7059e3c6…}]`, Failed: []. No Lambda ever ran with this MessageId. |
| 19:33 | Manual SQS re-send of same body → delivered in <100ms. Proof the queue + Lambda are healthy; the original message was lost AWS-side. |
