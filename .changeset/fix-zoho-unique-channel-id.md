---
"quo-integrations-frigg": patch
---

fix(zoho): use unique channel IDs per integration and handle 400 on renewal

Replaces the shared static ZOHO_NOTIFICATION_CHANNEL_ID with per-integration unique channel IDs generated from the integration ID. Also treats any 400 error on PATCH renewal as NOT_SUBSCRIBED (since FetchError strips the Zoho response body in prod), falling back to re-subscribe with a fresh unique channel ID.
