---
'quo-integrations-frigg': patch
---

Bump `@friggframework/*` deps to canary `2.0.0--canary.578.e866a27.0` to pick up structured observability logs in the queue-worker pipeline (Frigg PR #578). This adds visible logs at every queue hop — `[QueuerUtil]` SendMessageBatch results (with per-entry success/failure details), `[Worker]` per-record `begin`/`success`/`halted`/`failed` (with `ApproximateReceiveCount`), `[QueueWorker]` hydration phases, and `[createHandler]` warnings on suppressed `HaltError`s — so we can tell "never delivered" vs "delivered and silently halted" vs "delivered and failed" when a CRM sync gets stuck. Motivated by today's investigation into Attio integration 800 where the 17th SQS fetch-page message disappeared with zero trace.

Affects all queue-worker functions (`attioQueueWorker`, `pipedriveQueueWorker`, `zohoQueueWorker`, `axisCareQueueWorker`, `scalingtestQueueWorker`, `dbMigrationWorker`, `dlqProcessor`). No control-flow changes upstream — pure logging addition.
