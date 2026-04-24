---
"quo-integrations-frigg-backend": patch
---

fix(attio): handle 404 from Attio getRecord in webhook handlers

When Attio sends a record.created or record.updated webhook but the record has been deleted before processing, getRecord throws a 404 FetchError. Previously this propagated uncaught, causing SQS retries and eventual DLQ placement. Now returns early with a warning log.
