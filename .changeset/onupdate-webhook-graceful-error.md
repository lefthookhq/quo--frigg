---
'quo-integrations-frigg': patch
---

Return structured error response instead of HTTP 500 when OpenPhone webhook creation fails during integration config update. When a user updates phone IDs and the Quo/OpenPhone API rejects webhook creation (e.g., 403 Forbidden due to missing permissions), `onUpdate` now returns `{ success: false, error: 'webhook_creation_failed', message, config }` instead of throwing an unhandled exception. The previous configuration remains active since `_recreateQuoWebhooks` creates new webhooks before deleting old ones — on failure, old webhooks are untouched.

Observed in production on 2026-04-21: integrations 3437 (Pipedrive) and 7723 (Attio) both received HTTP 500 when their OpenPhone API keys lacked webhook creation scope. Affects any CRM integration using BaseCRMIntegration's phone configuration update flow.
