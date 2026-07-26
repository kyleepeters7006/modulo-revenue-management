---
name: Excel round-trip rule import
description: Design pattern for importing rules/rates from the Reference Data Excel export
---
Rule: the Reference Data export/import round-trip uses two writable columns — a natural-language rule description and an exact rate. Identical descriptions across rows are combined into ONE rule scoped to those rows (campus/SL/room type, with room_type_groupings expansion); exact rates become manual_rate_overrides (the existing "set exact proposed rate" mechanism), since rule actions only support adjust-by, not set-to.
**Why:** The NL parser + from-filters scope-merging path already exists; reusing it keeps preview/engine parity and avoids a parallel rule format. Manual overrides are the only exact-rate mechanism.
**How to apply:** Any future import that creates rules should group by description, merge scope into action.filters, and route exact rates through manual_rate_overrides — not synthesize absolute-adjustment rules from rate deltas.
