---
name: DATABASE_URL vs NEON_DATABASE_URL
description: The server uses DATABASE_URL; NEON_DATABASE_URL is a different, incomplete database — never use it for manual testing.
---

## Rule
Always use `DATABASE_URL` (not `NEON_DATABASE_URL`) when running manual node.js queries to verify server behavior.

**Why:** The two environment variables point to different Postgres databases. `NEON_DATABASE_URL` is a separate DB that is missing many columns (`locations.client_id`, `rent_roll_data.client_id`, `room_type_occupancy_history` table entirely, etc.). The server exclusively uses `DATABASE_URL`. Queries against `NEON_DATABASE_URL` will produce "column does not exist" or "relation does not exist" errors that look like server bugs but are irrelevant.

**How to apply:** Any time you run `node -e "..."` or a script to test DB behavior, use:
```javascript
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```
Never `process.env.NEON_DATABASE_URL` for server-behavior verification.
