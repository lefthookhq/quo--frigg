# Stuck CRM-sync chains — SQS messages vanish mid-pagination

**Status:** Active. **Root cause unconfirmed.** Mitigations: manual SQS re-send (workaround), watchdog Lambda (designed, not built). Observability patches shipped.

**First observed:** 2026-04-20 on Attio integration 800 (Murphy Advisory Solutions) onboarding.

**Scope:** Confirmed reproductions on integration 800 (5/5). Likely affects **~347 other stuck processes** across many integrations — but investigation has not verified whether those stick via the same mechanism.

**Companion document:** [`stuck-queue-messages-investigation.md`](./stuck-queue-messages-investigation.md) — detailed investigation log, all tested hypotheses, reproduction steps.

---

## Symptom

CRM initial-sync chains get stuck mid-pagination. For each affected tenant, the stuck point is consistent — always the same cursor, always after the same `pageCount`. But stuck cursors vary across tenants: integration 800 stops at cursor 800, others at 750 / 184 / 1500.

**Process row, always identical pattern per tenant:**

```
state:              FETCHING_PAGE
context.metadata:   { pageCount: N, lastCursor: X, totalFetched: N*50 }
context.pagination: { hasMore: true, pageSize: 50, currentCursor: null }
results.aggregate:  { totalSynced: <tenant-specific>, totalFailed: 0 }
updatedAt:          <timestamp of the last successful Lambda's exit>
```

For integration 800: after Lambda #16 successfully fetches 50 records at `offset=750`, enqueues a `FETCH_PERSON_PAGE` message for `cursor=800`, and exits cleanly — **no Lambda ever executes the cursor=800 message**. The chain is silently truncated.

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
                             │ AWS SQS confirms MessageId 7059e3c6
                             │ (SQS NumberOfMessagesSent counter incremented)
                             ▼
                   ╔═══════════════════════════╗
                   ║  SQS: AttioQueue          ║
                   ║                           ║
                   ║  Message IS in the queue  ║
                   ║  at this point            ║
                   ║                           ║
                   ║  Received counter also    ║
                   ║  increments, matching     ║
                   ║  Sent → message was       ║
                   ║  delivered to some        ║
                   ║  consumer                 ║
                   ╚═══════════════════════════╝
                             │
                             ▼
              ??? No Lambda logs for MessageId 7059e3c6 ???
              (Verified across ALL quo-integrations-prod-*
               log groups — not just attioQueueWorker)
                             │
                             ▼
        Process 8224 sits frozen at:
          state: FETCHING_PAGE
          updatedAt: 19:28:48.052
          synced: 38, pages: 16, fetched: 800
```

---

## Proof the queue + Lambda are currently functional — manual re-send

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
│  19:33:57.081  [Worker] record success                           │
│  (continues the chain: enqueues cursor=850, 900, 950, …)         │
└──────────────────────────────────────────────────────────────────┘

  → Same body, same queue, same Lambda, same concurrency. Manual
    send delivers in <100ms. The failure mode is time-correlated
    with the end of a rapid 16-send burst, not with the message
    body or the infrastructure in general.
```

---

## What's been ruled out (verified)

| Hypothesis | Ruled out by |
|-----------|----------|
| Lambda concurrency throttling | CloudWatch `Throttles=0` at 19:28 UTC. `ReservedConcurrentExecutions` bumped to 50. |
| Aurora connection exhaustion | Aurora `MaxCapacity` raised to 5.0 ACU. Peak connections ~53 of ~540 available. |
| Messages accumulating in DLQ | `quo-integrations-prod-InternalErrorQueue` `NumberOfMessagesSent = 0` for entire day. |
| Message retention expiry | 4-day retention; messages are minutes old. |
| AWS `SendMessageBatch` partial failure | `Successful: [{MessageId}]`, `Failed: []`. Also independently verified via SQS `NumberOfMessagesSent` counter increment. |
| HaltError silent-discard path | No `[createHandler] halt error suppressed` or `[Worker] record halted` logs for the lost MessageIds. |
| State-machine code bug (17th message skipped) | Same body sent manually → delivered and processed. |
| Integration `DISABLED`/`ERROR` status | Integration 800 `status = ENABLED` throughout. |
| KMS throttling on SSE-encrypted queue | `AWS/KMS ThrottleCount` metric is not exposed. Indirect signals (no spikes in `AWS/Lambda Errors`, `AWS/SQS` metrics consistent) don't support this. Remains partially unconfirmed. |
| Zero orphan Lambda invocations | 94 RequestIds in post-send window, all have handler logs. BUT — this check searched only attioQueueWorker; adversarial re-audit confirmed the MessageId isn't in any other `quo-integrations-prod-*` log group either. |
| Cold-start init failure | No `InitDuration` anomalies, `Errors=0`. |
| Wrong queue / queue-URL drift | Buffer log shows exact AttioQueue URL. Only ONE ESM on this queue (verified). |
| AWS SDK keep-alive socket with fake MessageId | Ruled out: SQS `NumberOfMessagesSent` incremented, confirming the MessageId corresponds to a real committed message. |

---

## What the evidence actually supports

**Confirmed facts:**

1. The `SendMessageBatch` API call succeeded at AWS side — `NumberOfMessagesSent` counter incremented, not just the local SDK log claiming success.
2. A consumer received the message — SQS `NumberOfMessagesReceived` matches `NumberOfMessagesSent` at the minute granularity (199 vs 199 at 19:28 UTC).
3. attioQueueWorker has no log entries for MessageId `7059e3c6`. No other Lambda function in `quo-integrations-prod-*` does either.
4. Across 5 reproductions on integration 800, the failure is **deterministic**: same cursor (800), same pageCount (16), same totalSynced (38). Different UTC times, different deploys, different concurrency configs. A probabilistic race would produce variance.
5. For other affected tenants, the stuck cursor is consistent per tenant but different across tenants (750, 184, 1500) — suggests the bug is state-dependent or dataset-size-dependent, not strictly "cursor=800".

**What this implies:**

- Not an AWS SQS durability failure (the original framing of this doc was wrong).
- Not a code bug in Frigg's cursor-math or state machine (manual resend works).
- Something happens **after** SQS accepts the message **before** handler logs are emitted, and it reproduces deterministically per tenant.

**Possibilities we can't currently distinguish between:**

- (A) Lambda invoked but CloudWatch dropped the log stream for that specific invocation (rare; no direct evidence).
- (B) The message received state-bit was incremented but no Lambda invocation actually ran (possible CloudWatch metric approximation).
- (C) The message is still alive in an SQS invisible-backoff cycle, not yet delivered — the agent found `ApproximateAgeOfOldestMessage = 52 min` during the incident window, which is consistent with some messages languishing.

---

## Current workaround

Manual SQS re-send via AWS CLI unblocks the chain:

```bash
AWS_PROFILE=quo-deploy aws sqs send-message \
  --region us-east-1 \
  --queue-url "https://sqs.us-east-1.amazonaws.com/973314620327/quo-integrations--prod-AttioQueue" \
  --message-body '{"event":"FETCH_PERSON_PAGE","data":{"processId":"<ID>","personObjectType":"people","page":null,"cursor":<LOST_CURSOR>,"limit":50,"modifiedSince":null,"sortDesc":true}}'
```

- `<ID>` must be a string (without quoting it, Frigg's `UpdateProcessState` validation throws `"processId must be a non-empty string"`).
- `<LOST_CURSOR>` = `context.metadata.lastCursor + context.pagination.pageSize`.

---

## Long-term mitigation — watchdog Lambda (designed, not built)

A scheduled Lambda (every 2–5 min) that scans the `Process` table for rows stuck in `FETCHING_PAGE` / `PROCESSING_BATCHES` with stale `updatedAt`, reconstructs the next expected cursor from `context.metadata`, and re-enqueues the `FETCH_PERSON_PAGE` message. Idempotent: re-fetching the same Attio page and re-running `bulkUpsertToQuo` produces identical side effects.

Full design in the [investigation log](./stuck-queue-messages-investigation.md#long-term-mitigation-watchdog-lambda).

---

## Observability changes already landed

1. **Frigg framework PR #578** (`friggframework/frigg`) — queue-worker observability logs in `@friggframework/core`.
2. **Quo local wrapper patch** (`quo--frigg` PR on branch `chore/local-queuer-wrapper-partial-failure-logs`) — mirrors the partial-failure inspection into `backend/src/base/services/QueuerUtilWrapper.js`, which is the code path actually used by `BaseCRMIntegration`.
3. **Infra bumps (prod):**
   - `attioQueueWorker` `ReservedConcurrentExecutions`: 20 → 50.
   - Aurora `ServerlessV2ScalingConfiguration.MaxCapacity`: 1.0 → 5.0 ACU.

Details, commands, and verification steps in the investigation log.

---

## Affected tenants

- **Integration 800** (Murphy Advisory Solutions, org `ORays1Jp0J`, user `US8lMxx8kK` — Jeff Murphy). 5 confirmed stuck sync attempts on 2026-04-20. Now progressing past the stuck point via manual re-sends.
- **~347 other processes** DB-wide in `FETCHING_PAGE` state. NOT VERIFIED whether they stick via the same mechanism — some may be stuck for unrelated reasons. Candidates by `fetched` count: integrations 8912, 8911, 8847, 8845, 8812, 4211, 5183, 4232, 5249, 4203, 4725, 4267, 4095, 7132.

---

## What's still needed to conclusively identify the root cause

Two high-value instrumentation changes to run on the next reproduction:

1. **Log `event.Records[].messageId` as the very first line of the Lambda handler** — before `createHandler`, before any framework code. If the lost MessageId appears here but not in `[Worker] record begin`, it's a bug in the Worker instrumentation. If it never appears, Lambda was truly never invoked for that message.

2. **Enable SQS data-event logging in CloudTrail** for the AttioQueue. Gives server-side visibility into `ReceiveMessage` / `DeleteMessage` calls with MessageIds, independent of our own logs.

Without one of these, the root cause remains probable but unconfirmed.
