---
name: Browser-cached planning results
description: Security and correctness rules for temporarily persisted planning results in the browser.
---

Browser-cached planning results must be scoped by authenticated client and user, and logout or identity changes must purge the cache. Never use a campus/service-line-only browser key for payloads containing resident details.

**Why:** The same browser can be used by multiple tenants or accounts, and a restored result can otherwise disclose another tenant's resident-level data.

Persisted results must retain the exact assumptions used to calculate them. Approval must block when the current editor assumptions differ from the displayed result; otherwise a user may review one recommendation and approve another.

**How to apply:** Any future client-side draft/result cache for pricing or planning should follow the identity-scoped storage and assumption-match gate, or use an authorized server-backed draft instead.