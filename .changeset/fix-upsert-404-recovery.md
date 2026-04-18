---
"quo-integrations-frigg-backend": patch
---

fix(base): recover from 404 on contact update by falling back to create

When `upsertContactToQuo` finds a contact by externalId but the Quo API returns 404 on the PATCH (contact was deleted/archived), the method now falls back to the create path instead of throwing an unrecoverable error. This prevents silently discarding webhook-driven contact updates.
