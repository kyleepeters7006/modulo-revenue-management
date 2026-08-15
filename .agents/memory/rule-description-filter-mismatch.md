---
name: Rule description vs action-filter mismatch
description: Why a rule's plain-English description can promise a filter its action never encodes, how to detect it, and what deleting a rule safely requires.
---

# When a rule does not do what its own description says

A rule's `description` is generated prose; `action.filters` is what the engine actually
enforces. They are produced by different code paths and can disagree, so a rule can claim to
target "vacant Studio Dlx units" while its filters say only `{"roomType":["Studio Dlx"]}` —
silently repricing occupied units too.

**Detection:** for every active rule, compare vacancy/occupancy words in the description
against `action.filters.occupancyStatus`. The mismatch is invisible in the UI because the card
renders the description, not the filters.

**Why it happened:** the natural-language filter parser tested for a literal `vacant unit`
substring. Real descriptions interpose a room type — "vacant Studio Dlx units", "vacant One
Bedroom units" — so the phrase never matched and the filter was dropped. Rules phrased "for
vacant units" (no room type) parsed correctly, which is why the defect clustered in
room-type-scoped rules and looked random.

**How to apply:** when adding any filter keyword to the parser, match across a bounded run of
intervening words rather than a fixed substring, and refuse clause words (`and`, `or`, `if`,
`when`, `than`) inside the gap so the match cannot leak across conditions. Test the compound
phrasing, not just the bare one — this is the same failure mode as compound trigger drops.

## execution_count is not evidence a rule is unused

A rule can show `execution_count = 0` and `monthly_impact = 0` and still be applied to real
units. The authoritative check is `rent_roll_data.applied_rule_name` (it stores the rule
**name**, not the id — searching by id finds nothing and looks reassuringly clean).

**Why:** a rule deleted on the strength of `execution_count = 0` left dozens of rent-roll rows
carrying its `rule_adjusted_rate` and a dangling `applied_rule_name`. Since the served proposed
rate is the rule-adjusted rate, those units keep serving a rate from a rule that no longer
exists until something reprices them.

**How to apply:** before deleting or disabling a rule, count
`rent_roll_data WHERE applied_rule_name = '<rule name>'`. If it is non-zero, plan a reprice.
Note that `applied_rule_name` can also disagree in direction with the rule it names (a +6% rule
appearing on rows whose stored rate is below street), so treat the column as "a rule touched
this row", not as a reliable audit trail of which adjustment produced the number.

## Deleting a rule outside the API skips the repricing hook

The delete endpoint calls a rules-changed hook that purges caches and schedules a debounced
repricing run. A direct SQL delete does neither, leaving stale rates behind.

Worse, every rule/pricing endpoint resolves the client from the **session** only, defaulting to
`demo`. An unauthenticated call therefore purges and reprices the wrong tenant while happily
deleting a global rule that belongs to the real one.

**How to apply:** after any out-of-band rule mutation, reprice the affected client explicitly by
creating a pricing job for that `clientId` (the same path the hook uses) rather than relying on
an HTTP call that will silently run as `demo`. A full portfolio run is minutes, not seconds.
