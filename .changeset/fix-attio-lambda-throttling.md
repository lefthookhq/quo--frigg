---
"quo-integrations-frigg-backend": patch
---

fix(attio): increase Lambda concurrency to prevent DLQ from throttling

Increase attioQueueWorker maxConcurrency from 50 to 150 to handle pagination burst volume that was causing Lambda throttling and DLQ message loss. Add optional staggered delay support to QueueManager.fanOutPages() for page-based integrations.
