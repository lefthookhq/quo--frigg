---
'quo-integrations-frigg': patch
---

Bump `@friggframework/*` deps from `2.0.0--canary.578.e866a27.0` → `2.0.0--canary.578.3f8e78e.0`. Pulls in the latest commit on Frigg PR #578 (`feat/worker-observability-logs`), which continues to mature the queue-worker observability logs while we investigate the stuck-sync issue on Attio integration 800 (see `bug-tracking/stuck-queue-messages.md`). No control-flow changes upstream — still pure logging + correlation-ID enrichment.
