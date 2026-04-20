---
'quo-integrations-frigg': patch
---

Add `SendMessageBatchResult.Failed[]` inspection + structured success logging to `backend/src/base/services/QueuerUtilWrapper.js`. This is the queue-send code path actually used by all CRM sync chains (BaseCRMIntegration routes through the local wrapper, not Frigg core's `QueuerUtil`).

Without this, AWS `SendMessageBatch` can succeed at the HTTP level while silently rejecting individual entries — producing the exact failure mode we observed on Attio integration 800 today: the 17th (cursor=800) FETCH_PERSON_PAGE message was enqueued per Frigg logs, but no Lambda ever received it, the DLQ stayed empty, and there was no trace of what happened. Now every batch send emits either `[QueuerUtilWrapper] SendMessageBatch ok: N/M to <queue>` with per-entry `MessageId + event + processId + integrationId`, or `[QueuerUtilWrapper] SendMessageBatch partial failure: N/M failed` with AWS's `Code`/`Message` plus the same correlation context pulled from the MessageBody. The single-send path also logs `SendMessage ok: MessageId=... to <queue>`.

No control-flow changes beyond logging. Follow-up to Frigg PR #578 — same logic mirrored into the local wrapper so it fires on the code path `BaseCRMIntegration._createQueueManager` uses today.
