---
'quo-integrations-frigg': patch
---

Coerce `integrationId` and `userId` to strings in `ProcessManager.createSyncProcess()` before passing to Frigg Core's `CreateProcess` use case. PostgreSQL returns numeric IDs which fail the framework's `typeof !== 'string'` validation, breaking initial sync for newly created integrations (observed on integration 800 in prod, 2026-04-20).
