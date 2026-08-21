---
name: Competitor care rate — null vs zero
description: care_level_2_rate has three meaningful states (never surveyed / charges nothing / real rate); coalescing null to 0 fabricates data. Has caused two separate bugs.
---

# Competitor care rate is a THREE-state value

`competitive_survey_data.care_level_2_rate` means three different things, and code
that collapses it to two gets a wrong answer:

- **NULL — never surveyed.** We do not know what they charge. Roughly **half** of
  all survey rows are in this state (and 100% of the demo client's rows).
- **0 — they charge no separate care fee.** A real, valid signal. All-inclusive
  competitors legitimately have zero. This *must* produce a real negative
  adjustment (their rent drops by our care rate to compare like for like).
- **positive — a real care rate.**

**Why:** this distinction has now caused two separate bugs.
1. A normalizer guarded `rate <= 0 → null`, which silently killed the care
   adjustment for every all-inclusive competitor.
2. A read path did `record.careLevel2Rate || 0` for the arithmetic, then reused
   that same coalesced value for display — so a never-surveyed competitor was
   presented to users as "charges no separate care fee, $0". That is fabricated
   data on half the rows.

**How to apply:**
- Never reuse the arithmetic's `|| 0` value on a display surface. Track
  "was it surveyed" separately (`raw != null`) and emit `null` for unknown.
- A UI showing care must branch on **both** sides independently: not applicable
  to the service line / our rate missing / their rate missing / both known
  (zero included). Checking only our side reintroduces the bug.
- If a normalizer rejects a non-null rate as implausible, that is *unusable*,
  not zero — fall back to the unknown state, not to `0`.
- Changing the *adjustment math* for missing rates is a separate, wider decision
  than fixing the *display* — it moves rates across the whole app. Keep them separate.
