---
name: Development vs production database URLs
description: Replit injects environment-specific DATABASE_URL values; manually stored production connection strings can become stale or disabled.
---

## Rule
Always use `DATABASE_URL` (not `NEON_DATABASE_URL`) when running manual node.js queries to verify server behavior.

**Why:** The two environment variables point to different Postgres databases. `NEON_DATABASE_URL` is a separate DB that is missing many columns (`locations.client_id`, `rent_roll_data.client_id`, `room_type_occupancy_history` table entirely, etc.). The server exclusively uses `DATABASE_URL`. Queries against `NEON_DATABASE_URL` will produce "column does not exist" or "relation does not exist" errors that look like server bugs but are irrelevant.

**How to apply:** Any time you run `node -e "..."` or a script to test DB behavior, use:
```javascript
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```
Never `process.env.NEON_DATABASE_URL` for server-behavior verification.

Replit gives the editor and published app separate managed databases; each runtime receives its own environment-scoped `DATABASE_URL`. The editor cannot infer the published database URL from its own `DATABASE_URL`.

**Why:** The admin data-sync feature relies on a separately copied production connection string. That URL once remained present while its Neon endpoint had been disabled, so the first production command failed before any data was changed.

**How to apply:** Any development-to-production sync must preflight the production connection with a read-only query before truncating, stop on every `psql`/pipeline error, and give an actionable stale-endpoint message. Refresh the sync secret from Database → Production → Settings; never substitute the editor's `DATABASE_URL`.
