---
name: Development vs production database URLs
description: Replit injects environment-specific DATABASE_URL values; manually stored production connection strings can become stale or disabled.
---

## Rule
Each Replit environment must use its own managed `DATABASE_URL`; never depend on a manually copied production database endpoint from the editor.

**Why:** Environment-scoped database endpoints can differ in availability and schema, and a copied production URL may be paused while the published application remains healthy.

**How to apply:** Use the published application as the authenticated bridge for development-to-production data transfer. Keep that transfer allowlisted, transactional, and count-verified; do not revive a direct editor-to-production database pipeline.
