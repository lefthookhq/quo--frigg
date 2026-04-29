---
"quo-integrations-frigg": patch
---

fix(zoho): always re-subscribe on PATCH renewal failure with GET/DELETE recovery

When the PATCH /actions/watch renewal fails for any reason (NOT_SUBSCRIBED, FetchError-stripped 400, transient 5xx, schema, etc.), the integration now falls back to re-subscribe via POST. If the initial POST fails, it queries Zoho for the existing channel via GET, deletes it via DELETE if found, then retries POST. Cleanup (GET/DELETE) is best-effort — a transient failure there doesn't block the recovery POST. On final failure, retriable errors (5xx, network) propagate as-is so SQS can retry, while non-retriable errors (4xx, logical refusals) throw HaltError tagged with the integration ID.
