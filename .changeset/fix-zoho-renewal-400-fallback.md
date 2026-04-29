---
"quo-integrations-frigg": patch
---

fix(zoho): treat 400 on PATCH renewal as NOT_SUBSCRIBED

When Zoho expires a notification channel, the PATCH renewal returns 400 with `NOT_SUBSCRIBED` in the response body. In prod, FetchError strips that body, so the existing string-match detection never fired and the renewal kept retrying. Now `_isNotSubscribedError` also returns true for `error.statusCode === 400`, triggering the existing re-subscribe fallback path.
