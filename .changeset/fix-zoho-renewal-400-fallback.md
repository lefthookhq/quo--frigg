---
"quo-integrations-frigg": patch
---

fix(zoho): always re-subscribe on PATCH renewal failure with GET/DELETE recovery

When the PATCH /actions/watch renewal fails for any reason (NOT_SUBSCRIBED, FetchError-stripped 400, transient 5xx, schema, etc.), the integration now falls back to re-subscribe via POST. If the initial POST fails, it queries Zoho for the existing channel via GET, deletes it via DELETE if found, and retries POST. If recovery still fails, it throws a HaltError tagged with the integration ID so SQS halts cleanly instead of burning DLQ retries.
