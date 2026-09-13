---
name: Startup migration readiness
description: The safety boundary for running schema work in the background during application startup
---

The web server may bind before idempotent schema work finishes. API requests must fail fast with a retryable 503 while the readiness promise is pending; they must not await it and occupy sockets indefinitely. Destructive or data-mutating background startup jobs must await the readiness promise. Scheduler activation itself is startup work: do not start a loop that immediately reads or writes migration-owned tables before readiness.

**Why:** Moving migrations behind the listener exposed a race where demo-data regeneration began while a rent-roll schema migration was still active, producing a foreign-key failure. Port readiness alone is not data readiness.

**How to apply:** Pass the startup migration promise into route registration. Track pending/fulfilled/rejected state synchronously at the API gate: pending returns 503 plus `Retry-After`, failed returns 503, fulfilled continues. Client loaders for required startup data should retry boundedly. Seeders, backfills, repair jobs, resumptions, scheduler activation, and initial calculations await the combined readiness barrier before touching database data. Keep per-migration elapsed-time logs so a slow restart is attributable.