---
name: Latest tenant source cache
description: Shared latest-month rent-roll snapshots must invalidate both source and derived analytics data safely.
---

The latest-month rent-roll snapshot is tenant-scoped, and any invalidation must evict the tenant's in-flight load and derived analytics responses as well as its stored snapshot. A generation check prevents a pre-import load from repopulating the cache after invalidation.

**Why:** Analytics endpoints can open concurrently while a rent-roll import or replacement is committing; retaining either a derived response or an old in-flight result serves stale tenant data after the write.

**How to apply:** Use the shared latest-month loader for analytics that scan the same current rent roll, invalidate it from every successful rent-roll write path, and keep the generation guard when changing its concurrency behavior.