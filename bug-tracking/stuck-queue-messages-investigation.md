# Stuck CRM-sync — investigation log

Companion to [`stuck-queue-messages.md`](./stuck-queue-messages.md). Detailed chronology of the 2026-04-20 investigation, reproduction steps, hypotheses-tested table, tools and commands, and follow-up checklist.

---

## Problem statement

For CRM integrations using cursor-based pagination (Attio, AxisCare), the initial-sync chain stops progressing after a tenant-specific number of pages. The stuck point is deterministic per tenant (same cursor every reproduction), but varies across tenants. The Process row stays in `FETCHING_PAGE` state with `hasMore=true` indefinitely. Observable symptoms:

- Only a fraction of the tenant's records are actually synced to Quo (`totalSynced` in the Process row reflects only pages 1 through N where the chain died).
- No errors, no DLQ entries, no halt warnings, no timeouts. The chain simply goes silent.
- Manual SQS re-send of the "missing" next-page message instantly unblocks the chain.

---

## How to reproduce

**Prerequisites:**
- Attio integration configured with a dataset ≥800 records (or any CRM integration with enough records to require ≥16 pages of pagination).
- Access to prod: `AWS_PROFILE=quo-deploy`, bastion key at `backend/security/quo-postgres-bastion.pem`.

**Steps:**

1. Trigger `INITIAL_SYNC` via the Frigg Management API:

   ```bash
   curl -sS -X POST "https://oe4xqic7q9.execute-api.us-east-1.amazonaws.com/api/integrations/800/actions/INITIAL_SYNC" \
     -H "Content-Type: application/json" \
     -H "x-frigg-api-key: $FRIGG_API_KEY" \
     -H "x-frigg-appUserId: US8lMxx8kK" \
     -H "x-frigg-appOrgId: ORays1Jp0J" \
     -d '{}'
   ```

   Response includes `processIds: ["<ID>"]`.

2. Watch CloudWatch logs in near-real-time:

   ```bash
   AWS_PROFILE=quo-deploy aws logs tail /aws/lambda/quo-integrations-prod-attioQueueWorker --follow --filter-pattern '"processId: '\''<ID>'\''"'
   ```

   For integration 800, the chain will run pages 1 through 16 (~60 seconds), then silence.

3. Verify the stuck state in Postgres via bastion tunnel:

   ```bash
   # Tunnel
   ssh -i backend/security/quo-postgres-bastion.pem \
     -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes \
     -f -N -L 15432:quo-integrations-prod-friggauroracluster-baemhxkzcwxu.cluster-c29omoquoikf.us-east-1.rds.amazonaws.com:5432 \
     ec2-user@54.144.229.67

   # Query (password from AWS Lambda env DATABASE_URL)
   PGPASSWORD='<prod-password>' psql -h localhost -p 15432 -U postgres -d postgres -xc \
     "SELECT id, state, \"updatedAt\", context->'metadata' AS metadata, results->'aggregateData' AS agg FROM \"Process\" WHERE id = <ID>;"
   ```

   Expected stuck state for integration 800:
   ```
   state:              FETCHING_PAGE
   updatedAt:          <60 sec after trigger>
   metadata:           { "pageCount": 16, "lastCursor": 750, "totalFetched": 800 }
   agg:                { "totalSynced": 38, "totalFailed": 0 }
   ```

4. Unstick manually:

   ```bash
   AWS_PROFILE=quo-deploy aws sqs send-message \
     --region us-east-1 \
     --queue-url "https://sqs.us-east-1.amazonaws.com/973314620327/quo-integrations--prod-AttioQueue" \
     --message-body '{"event":"FETCH_PERSON_PAGE","data":{"processId":"<ID>","personObjectType":"people","page":null,"cursor":800,"limit":50,"modifiedSince":null,"sortDesc":true}}'
   ```

   The chain resumes within seconds. `processId` MUST be a string.

---

## Timeline of investigation — 2026-04-20

| UTC | Event |
|-----|-------|
| 14:54 | Process 8185 triggered. Stuck at cursor=800 after 16 pages. |
| 15:27 | Process 8189 retry. Stuck at same point. |
| 16:39 | Infra bump: `attioQueueWorker` reservedConcurrency 20→30. Aurora MaxCapacity 1.0→5.0 ACU. |
| 16:49 | Concurrency raised again: 30→50. |
| 16:51 | Process 8218 retry. Stuck at same point. |
| 17:03 | Manual SQS send of cursor=800 with `processId` as string → delivered in <100ms, unblocks 8218. First proof queue + Lambda are functional for the same body. |
| 18:57 | Prod deployed with Frigg canary 578 — observability logs live. |
| 19:02 | Process 8223 retry with new Frigg logs. Stuck at same point. Logs reveal `[Worker] record begin`, `[QueueWorker] hydrating` firing correctly. |
| 19:28 | Process 8224 retry with Quo-local wrapper logs also deployed. Stuck at same point. Full observability across both wrappers now live. |
| 19:28:48 | `[QueuerUtilWrapper] SendMessageBatch ok: 1/1` confirms AWS returned `Successful: [{MessageId: 7059e3c6…}]`. `Failed[]` empty. |
| 19:33 | Manual re-send of same body → delivered in <100ms again. |
| Later | Three parallel adversarial Opus 4.7 agents review findings. Conclude "AWS lost it" is under-evidenced; shift to "root cause unconfirmed, deterministic pattern suggests payload/state-specific". |

---

## Hypotheses tested

Legend: ✅ ruled out with evidence · 🟡 partial evidence, not conclusive · ❌ disconfirmed (opposite observed) · ⏳ not yet tested

### Infrastructure

| # | Hypothesis | Status | Evidence |
|---|------|---|---|
| 1 | Lambda concurrency throttling drops the 17th message | ✅ | `CloudWatch AWS/Lambda Throttles = 0` at 19:28 UTC. `ReservedConcurrentExecutions` raised from 20 → 50. Reproduction persists. |
| 2 | Aurora PostgreSQL CPU-saturated at 1 ACU causes downstream timeouts | ✅ | Aurora `MaxCapacity` raised to 5.0 ACU. CPU dropped from 100% to ~68%. Reproduction persists. |
| 3 | Message retention expiry (4-day default) deletes stuck messages | ❌ | Messages are minutes old; retention irrelevant. |
| 4 | Message went to DLQ after `MaxReceiveCount=3` throttle retries | ✅ | `quo-integrations-prod-InternalErrorQueue` `NumberOfMessagesSent = 0` for the entire day. |
| 5 | AWS SDK `SendMessageBatch` partial-failure silently drops entries | ✅ | `Successful: [{MessageId}]`, `Failed: []`. Also SQS `NumberOfMessagesSent` incremented, confirming the MessageId is a real committed message (not SDK-fabricated). |
| 6 | AWS SDK keep-alive socket pool produces fake `MessageId` on retry | ✅ | Ruled out same as #5 — the MessageId corresponds to an actual SQS-counter-incremented message. |
| 7 | KMS throttling on SSE-encrypted queue silently rejects messages | 🟡 | `SqsManagedSseEnabled: true`. `AWS/KMS ThrottleCount` metric not exposed for SSE-managed keys. No indirect evidence (no spikes in Lambda Errors, no SQS metric anomalies) but can't fully disprove. |
| 8 | Wrong queue URL / queue-URL drift from stale config | ✅ | Buffer log shows exact queue URL matches `EventSourceArn` of the single ESM. |
| 9 | Multiple ESMs on the queue; message delivered to a different Lambda | ✅ | `aws lambda list-event-source-mappings --event-source-arn ...AttioQueue` returns exactly one mapping → `attioQueueWorker`. Adversarial re-check searched all `/aws/lambda/quo-integrations-prod-*` log groups for the lost MessageId — no matches. |
| 10 | Queue URL mismatch between sender and ESM (different accounts or regions) | ✅ | Sender logs the exact ARN. Same as #8 + #9. |

### Framework / code

| # | Hypothesis | Status | Evidence |
|---|------|---|---|
| 11 | State-machine code skips the 17th message (pagination-math bug) | ✅ | Same body manually resent → delivered and processed. `_handleCursorBasedPagination` line 908 `if (hasMore && nextCursor)` passes for cursor=800. |
| 12 | HaltError silent-discard path swallows the message | ✅ | No `[Worker] record halted (discarded, no retry)` or `[createHandler] halt error suppressed` logs for the lost MessageIds. `console.error('Error in FETCH_PERSON_PAGE for attio: …')` would also fire in this path — not present. |
| 13 | Integration `DISABLED`/`ERROR` status causes `_run` to early-return | ✅ | Integration 800 `status = ENABLED` throughout (verified in DB). |
| 14 | Cold-start `INIT_FAILURE` silently drops the message | 🟡 | No `AWS/Lambda Errors` metric increments. No `InitDuration` anomalies. But INIT_FAILUREs can sometimes produce no logs at all — a "zero orphans" check can miss them. |
| 15 | `callbackWaitsForEmptyEventLoop = false` leaves `sqs.send()` in-flight when Lambda returns | ✅ | `await sqs.send(command)` is properly awaited in `QueuerUtilWrapper.batchSend` before the handler returns. Adversarial audit confirmed the chain is sequential, no dangling promises. |
| 16 | Prisma DB write + SQS send race in the same Lambda corrupts one of them | ✅ | `processManager.updateMetadata(...)` is `await`ed before the `queueFetchPersonPage(...)` call in `BaseCRMIntegration._handleCursorBasedPagination`. |
| 17 | Module-level singleton `SQSClient` keep-alive sockets go stale across Lambda warm thaws | 🟡 | Architecturally plausible. Would explain 16-page / ~48-sec timing correlation (Node keep-alive socket reuse window). Not directly tested — would require SDK debug logging or disabling keep-alive. |
| 18 | Log-stream delivery race at high throughput drops the 17th Lambda's logs | 🟡 | Can't verify from CloudWatch alone. Adversarial re-check found 94 RequestIds in post-send window, zero orphans — but only within attioQueueWorker log group. |

### Data / state

| # | Hypothesis | Status | Evidence |
|---|------|---|---|
| 19 | Attio API returns malformed data at offset=800 that crashes the next Lambda before it logs | ❌ | Same request body manually resent → delivered and processed successfully. Attio returns 50 records at offset=800 normally. |
| 20 | `cursor=800` is a universal stuck boundary (fixed-point bug) | ❌ | Other affected tenants stuck at different cursors (750, 184, 1500). Value is tenant-specific, not universal. |
| 21 | `totalSynced=38` is suspiciously consistent across 5 runs → stale cache | ❌ | Expected given deterministic dataset: same Attio records, same phone-having subset, same upsert-idempotent writes. |
| 22 | Integration 800 has some malformed `Credential` row causing intermittent auth failure on the 17th fetch | ⏳ | Not directly verified. Integration status is ENABLED; previous pages all succeeded with same credentials. |

### AWS durability

| # | Hypothesis | Status | Evidence |
|---|------|---|---|
| 23 | AWS SQS lost the message despite returning 200 + MessageId (original theory) | ❌ | Not supported. SQS `NumberOfMessagesSent` incremented. `NumberOfMessagesReceived` matched `Sent` (199 vs 199 at 19:28 UTC), implying a consumer did pull the message. Deterministic reproduction across 5 different UTC times also argues against a server-side race. |
| 24 | Chain-ending-send race between SQS delete-in and send-out | ❌ | Physically implausible on Standard queues. Same reason as #23. |
| 25 | Message is still alive in an SQS invisible-backoff cycle not reflected in `NotVisible` count | 🟡 | `ApproximateAgeOfOldestMessage` climbed to 52 min during the incident — consistent with backlogged messages. Current queue shows 0 visible + 0 NotVisible, but these are approximate metrics. Can't fully confirm or deny. |

---

## What's been done to improve the codebase

### Observability

1. **Frigg framework PR #578** (`friggframework/frigg`, branch `feat/worker-observability-logs`)
   Files:
   - `packages/core/queues/queuer-util.js` — `SendMessageBatchResult.Failed[]` inspection + per-entry `event`/`processId`/`integrationId` summary in success + failure logs.
   - `packages/core/core/Worker.js` — per-record `begin`/`success`/`halted`/`failed` logs with `messageId` + `ApproximateReceiveCount`.
   - `packages/core/handlers/backend-utils.js` — hydration-phase logs (`hydrating by processId`, `hydrated`, `dispatching`, `dispatched ok`).
   - `packages/core/core/create-handler.js` — WARN log on suppressed HaltErrors, with correlation context (`messageIds`, `processId`, or HTTP `method`/`path`).

2. **Quo local wrapper patch** (`quo--frigg`, branch `chore/local-queuer-wrapper-partial-failure-logs`)
   File: `backend/src/base/services/QueuerUtilWrapper.js`
   - Ports the `SendMessageBatchResult.Failed[]` inspection into the local wrapper. Required because `BaseCRMIntegration._createQueueManager` routes through the local wrapper, not Frigg core's `QueuerUtil`.
   - `[QueuerUtilWrapper] SendMessageBatch ok: N/M to <queue>` + per-entry summary, or `partial failure` with AWS `Code`/`Message`.

3. **Bump PR** (`quo--frigg`, branch `chore/bump-frigg-canary-578-observability`)
   - `backend/package.json`: bumps six `@friggframework/*` deps from `2.0.0-next.79` → `2.0.0--canary.578.e866a27.0`.

### Infrastructure (prod, applied manually via AWS CLI)

1. `attioQueueWorker` `ReservedConcurrentExecutions`: **20 → 50**
   ```bash
   AWS_PROFILE=quo-deploy aws lambda put-function-concurrency \
     --region us-east-1 \
     --function-name quo-integrations-prod-attioQueueWorker \
     --reserved-concurrent-executions 50
   ```

2. Aurora `ServerlessV2ScalingConfiguration.MaxCapacity`: **1.0 → 5.0 ACU**
   ```bash
   AWS_PROFILE=quo-deploy aws rds modify-db-cluster \
     --region us-east-1 \
     --db-cluster-identifier quo-integrations-prod-friggauroracluster-baemhxkzcwxu \
     --serverless-v2-scaling-configuration MinCapacity=0.5,MaxCapacity=5.0 \
     --apply-immediately
   ```

Both survived a subsequent `serverless deploy` (CloudFormation diff didn't regenerate these properties). Not guaranteed long-term — should be codified in `infrastructure.js` or the Frigg framework's `integration-builder.js`.

---

## Long-term mitigation — watchdog Lambda

### Design: periodic janitor

New scheduled Lambda (every 2-5 min via EventBridge) that scans `Process` rows and re-enqueues stuck ones.

**Scan query:**

```sql
SELECT id, "integrationId", state, context, results, "updatedAt"
FROM "Process"
WHERE state IN ('FETCHING_PAGE', 'PROCESSING_BATCHES')
  AND "updatedAt" < NOW() - INTERVAL '3 minutes'
  AND type = 'CRM_SYNC'
ORDER BY "updatedAt" ASC
LIMIT 50;
```

**Per-candidate logic:**

1. Load the integration via `integrationRepository.findById(row.integrationId)`. Skip if `status !== 'ENABLED'`.
2. Read `context.metadata.watchdogResends` (int, default 0). Cap at 5 to avoid runaway loops.
3. Reconstruct next cursor: `nextCursor = context.metadata.lastCursor + context.pagination.pageSize`.
4. Guard: only re-enqueue if `context.pagination.hasMore === true`.
5. Send `FETCH_PERSON_PAGE` via existing `QueueManager.queueFetchPersonPage`.
6. Atomically increment `context.metadata.watchdogResends` in the Process row.
7. Log `[Watchdog] re-enqueued { processId, cursor, stuckFor, resends }`.

**Idempotency properties:**

- `fetchPersonPage(offset=N)` is deterministic under stable Attio reads.
- `bulkUpsertToQuo` upserts by `externalId` → re-running produces the same mapping, not a duplicate.
- `upsertMapping` is keyed on `(integrationId, phoneNumber)` → re-running refreshes `lastSyncedAt`.
- Worst case: one page processed twice → harmless.

**Implementation shape:**

- New function in `backend/serverless.js`: `watchdogStuckProcesses` with scheduled event (every 3 min).
- Handler at `backend/src/handlers/watchdogStuckProcesses.js` (~150 lines).
- Reuses existing `QueueManager` / `ProcessManager` / repositories.
- DB read through the same Aurora cluster via the existing Prisma client.

**Observability:**

- CloudWatch metric filter on `[Watchdog] re-enqueued` → Slack alarm if counts spike (signal of an underlying regression somewhere).
- Separate metric for `watchdogResends >= 5` → strong signal of a truly broken integration.

### Design: inline verify-and-resend (rejected)

Wrap `QueuerUtilWrapper.batchSend` to verify the outbound message landed by polling `GetQueueAttributes` after a short delay. Rejected because:
- Adds 2+ seconds to every page Lambda.
- `ApproximateNumberOfMessages` is unreliable at high concurrency.
- Same underlying AWS bug could hit the verify call.

---

## Follow-up checklist to conclusively root-cause

### High value

- [ ] **Add Lambda-entry MessageId log** — single line at the very top of `create-handler.js` that logs `event.Records?.map(r => r.messageId)` before any other work. On next reproduction, if the lost MessageId appears here but not in `[Worker] record begin`, it's a bug in our Worker instrumentation. If it never appears, open an AWS Support ticket with the MessageId.

- [ ] **Enable SQS data-event logging in CloudTrail** for the AttioQueue. Provides server-side visibility into `ReceiveMessage` / `DeleteMessage` / `SendMessageBatch` events with MessageIds, independent of application logs.

- [ ] **Query the 347 stuck processes to verify shared mechanism.** If they all stuck at the "last-fetch + pageSize" boundary, the pattern is confirmed across tenants. If they stuck at varied, random-looking offsets, the "deterministic boundary" hypothesis is wrong and we need a different theory.

### Medium value

- [ ] **Disable keep-alive on the local SQSClient** (`backend/src/base/services/QueuerUtilWrapper.js:51`). If the reproduction disappears, the AWS SDK HTTP agent is the cause. ~10 lines of change.

- [ ] **Build and deploy the watchdog Lambda.** This is the robust mitigation regardless of whether root cause is identified.

- [ ] **Codify the infra bumps in `infrastructure.js`** so they don't silently drift on future deploys. Ideally: make `reservedConcurrency` configurable per integration via `CRMConfig.queueConfig.maxConcurrency` in the Frigg framework.

### Low value / nice-to-have

- [ ] Add `ApproximateReceiveCount > 1` alarm on the AttioQueue — detect messages being redelivered (which would mean the stuck message IS cycling, not truly lost).
- [ ] Add per-integration CloudWatch metric dimensions on SQS send/receive, so we can slice by integration instead of aggregating the whole queue.

---

## Lessons learned

1. **"AWS lost the message" is almost always wrong.** AWS SQS has 11 9s of durability; the first hypothesis should be "my code or my observability is lying to me."
2. **Always verify SDK log claims against AWS-side counters.** A `SendMessageBatch ok` log is evidence from the SDK, not from SQS. CloudWatch's `NumberOfMessagesSent` is the authoritative signal.
3. **Deterministic reproductions rule out races.** 5/5 at the same cursor across different times → the bug is deterministic → not a server-side race → look for state-dependent or payload-dependent code.
4. **"Zero orphan Lambda invocations" is a necessary but not sufficient check.** CloudWatch log streams can drop under backpressure. A hard-coded log line at the very top of the handler (before framework code) is the only way to definitively prove Lambda was invoked.
5. **Adversarial review is worth the cost.** Three parallel Opus-4.7 agents found three distinct flaws in the original framing that I'd missed after hours of direct investigation. The value of fresh perspective on a stuck debugging session is real.
6. **Observability-first debugging pays off.** The Frigg `[QueuerUtilWrapper]` partial-failure check ended the "is AWS lying?" speculation within one reproduction. Without it, we'd still be arguing about whether the SDK was returning fabricated MessageIds.
