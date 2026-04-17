# quo-integrations-frigg

## 0.1.1

### Patch Changes

- [#75](https://github.com/lefthookhq/quo--frigg/pull/75) [`591c0e0`](https://github.com/lefthookhq/quo--frigg/commit/591c0e041779e698fdb13f78f99d53079334ce43) Thanks [@d-klotz](https://github.com/d-klotz)! - Recover Zoho CRM integrations when notification renewal returns `NOT_SUBSCRIBED`. Zoho garbage-collects expired notification channels server-side; the 7-day renewal then PATCHes a channel Zoho no longer knows about and fails with `400 NOT_SUBSCRIBED`, leaving the integration silently broken (no webhook events, no recovery). `_renewZohoNotificationWithRetry` now falls back to `enableNotification` (POST) to re-create the subscription, preserving the original `return_affected_field_values: true` and `notify_on_related_action: false` flags so webhook payloads keep field-level diff data. Non-NOT_SUBSCRIBED 400s still retry 3×; logical failures on the re-subscribe POST throw `HaltError` so the SQS message is discarded instead of wasting retries + hitting the DLQ. Affected prod integrations at the time of the fix: 7130, 7132, 7133, 7195.
