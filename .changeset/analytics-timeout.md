---
'quo-integrations-frigg': patch
---

fix(analytics): add 5s timeout to analytics tracking to prevent Lambda near-timeouts

When the analytics API (integration.openphoneapi.com/v2/analytics) goes down, the
`trackAnalyticsEvent` call would hang indefinitely, blocking Lambda execution for up to
~289 seconds. This adds a 5-second timeout using Promise.race so analytics failures
fail fast without impacting webhook processing.
