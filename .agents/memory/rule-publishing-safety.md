---
name: Rule publishing safety
description: Durable transaction, tenancy, audit, and cache constraints for committing proposed rule rates to Street Rates.
---

Publish must calculate from the exact locked active-rule set and latest tenant rent-roll snapshot inside a serializable transaction. Street Rate writes, rule-lineage clearing, lifecycle archival, and the tenant-scoped immutable before/after audit must commit together. Bulk pricing writers must share the publish advisory fence so an older calculation cannot restore stale rule lineage afterward.

**Why:** Rule calculation is expensive and can overlap imports, rule activation, and background pricing writes. Without locking, row-count assertions, and a shared writer fence, Publish can archive rules after committing stale or incomplete rates.

**How to apply:** Any path that commits rule-derived Street Rates must use the canonical evaluator with an explicitly supplied locked rule set, verify every planned row changed, and retry serialization conflicts rather than partially succeeding.

Legacy `client_id=NULL` active rules are migration data. A confirmed publish may claim a known legacy rule for the authenticated client as it archives it; new rules must remain tenant-owned.

**Why:** Leaving an archived publish globally scoped leaks history across tenants, while silently ignoring the legacy row makes the visible Publish action fail to include the rule the user reviewed.

**How to apply:** Claim only during the guarded publish transaction, preserve the immutable audit, and do not generalize NULL ownership to new rule creation.

Do not regenerate the legacy `rate_card` cache from a tenant publish until that table and all of its readers/writers are client-scoped.

**Why:** Its month-only delete/rebuild can mix or replace another tenant's same-month cards.

**How to apply:** Treat client-scoped `rent_roll_data.street_rate` as authoritative for Publish and invalidate safe read caches only.