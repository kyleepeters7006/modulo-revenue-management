---
name: Security transactions on the Neon pool
description: Security mutations that combine MFA state and recovery-code rows must use one checked-out database client.
---

Pool-level query calls do not guarantee that `BEGIN`, subsequent statements, and
`COMMIT` use the same connection. Security mutations that update MFA state and
recovery codes must use `pool.connect()`, a single transaction client, and
`release()` in `finally`.

**Why:** A pool-level transaction can appear to succeed while updates are
outside the transaction or are not visible as one atomic security change.

**How to apply:** Use a checked-out client for MFA enrollment, recovery-code
regeneration, account recovery, and any future security operation that couples
multiple tables.