# quo-integrations-frigg

## 0.1.2

### Patch Changes

- [#85](https://github.com/lefthookhq/quo--frigg/pull/85) [`78b050c`](https://github.com/lefthookhq/quo--frigg/commit/78b050ca5daeda5a9fd73d68068ed92d5b46ff34) Thanks [@d-klotz](https://github.com/d-klotz)! - Bump `@friggframework/*` deps from `2.0.0--canary.578.e866a27.0` → `2.0.0--canary.578.3f8e78e.0`. Pulls in the latest commit on Frigg PR #578 (`feat/worker-observability-logs`), which continues to mature the queue-worker observability logs while we investigate the stuck-sync issue on Attio integration 800 (see `bug-tracking/stuck-queue-messages.md`). No control-flow changes upstream — still pure logging + correlation-ID enrichment.

- [#82](https://github.com/lefthookhq/quo--frigg/pull/82) [`1d0ed3e`](https://github.com/lefthookhq/quo--frigg/commit/1d0ed3ed275a3ea13ea41d8be55a288f479efdb8) Thanks [@d-klotz](https://github.com/d-klotz)! - Bump `@friggframework/*` deps to canary `2.0.0--canary.578.e866a27.0` to pick up structured observability logs in the queue-worker pipeline (Frigg PR #578). This adds visible logs at every queue hop — `[QueuerUtil]` SendMessageBatch results (with per-entry success/failure details), `[Worker]` per-record `begin`/`success`/`halted`/`failed` (with `ApproximateReceiveCount`), `[QueueWorker]` hydration phases, and `[createHandler]` warnings on suppressed `HaltError`s — so we can tell "never delivered" vs "delivered and silently halted" vs "delivered and failed" when a CRM sync gets stuck. Motivated by today's investigation into Attio integration 800 where the 17th SQS fetch-page message disappeared with zero trace.

  Affects all queue-worker functions (`attioQueueWorker`, `pipedriveQueueWorker`, `zohoQueueWorker`, `axisCareQueueWorker`, `scalingtestQueueWorker`, `dbMigrationWorker`, `dlqProcessor`). No control-flow changes upstream — pure logging addition.

- [#84](https://github.com/lefthookhq/quo--frigg/pull/84) [`6cfa24c`](https://github.com/lefthookhq/quo--frigg/commit/6cfa24c5b7aaa9ee7bbc542ccab443ac3dda8d32) Thanks [@d-klotz](https://github.com/d-klotz)! - Add `SendMessageBatchResult.Failed[]` inspection + structured success logging to `backend/src/base/services/QueuerUtilWrapper.js`. This is the queue-send code path actually used by all CRM sync chains (BaseCRMIntegration routes through the local wrapper, not Frigg core's `QueuerUtil`).

  Without this, AWS `SendMessageBatch` can succeed at the HTTP level while silently rejecting individual entries — producing the exact failure mode we observed on Attio integration 800 today: the 17th (cursor=800) FETCH_PERSON_PAGE message was enqueued per Frigg logs, but no Lambda ever received it, the DLQ stayed empty, and there was no trace of what happened. Now every batch send emits either `[QueuerUtilWrapper] SendMessageBatch ok: N/M to <queue>` with per-entry `MessageId + event + processId + integrationId`, or `[QueuerUtilWrapper] SendMessageBatch partial failure: N/M failed` with AWS's `Code`/`Message` plus the same correlation context pulled from the MessageBody. The single-send path also logs `SendMessage ok: MessageId=... to <queue>`.

  No control-flow changes beyond logging. Follow-up to Frigg PR #578 — same logic mirrored into the local wrapper so it fires on the code path `BaseCRMIntegration._createQueueManager` uses today.

## 0.1.1

### Patch Changes

- [#75](https://github.com/lefthookhq/quo--frigg/pull/75) [`591c0e0`](https://github.com/lefthookhq/quo--frigg/commit/591c0e041779e698fdb13f78f99d53079334ce43) Thanks [@d-klotz](https://github.com/d-klotz)! - Recover Zoho CRM integrations when notification renewal returns `NOT_SUBSCRIBED`. Zoho garbage-collects expired notification channels server-side; the 7-day renewal then PATCHes a channel Zoho no longer knows about and fails with `400 NOT_SUBSCRIBED`, leaving the integration silently broken (no webhook events, no recovery). `_renewZohoNotificationWithRetry` now falls back to `enableNotification` (POST) to re-create the subscription, preserving the original `return_affected_field_values: true` and `notify_on_related_action: false` flags so webhook payloads keep field-level diff data. Non-NOT_SUBSCRIBED 400s still retry 3×; logical failures on the re-subscribe POST throw `HaltError` so the SQS message is discarded instead of wasting retries + hitting the DLQ. Affected prod integrations at the time of the fix: 7130, 7132, 7133, 7195.
