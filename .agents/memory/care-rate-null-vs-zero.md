---
name: Competitor care rate — null vs zero
description: care_level_2_rate has three meaningful states (never surveyed / charges nothing / real rate); coalescing null to 0 fabricates data, and dropping 0 hides the most competitive competitors. Has caused several separate bugs.
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

A zero looks like a legacy "not surveyed" default because the earliest survey
months have none at all and all-positive care — it is the opposite, a newer
convention. Confirm against the newest month before assuming.

**Why:** this distinction has now caused several separate bugs.
1. A normalizer guarded `rate <= 0 → null`, which silently killed the care
   adjustment for every all-inclusive competitor.
2. A read path did `record.careLevel2Rate || 0` for the arithmetic, then reused
   that same coalesced value for display — so a never-surveyed competitor was
   presented to users as "charges no separate care fee, $0". That is fabricated
   data on half the rows.
3. A benchmark averaged only the usable care values and fell back to `0` for an
   empty list, so an unsurveyed competitor was plotted as if it bundled care and
   received a discount the size of our own care rate — on the HC lines ~$33/day
   against a ~$300/day rate, roughly 11% of the comparison.

**How to apply:**
- Never reuse the arithmetic's `|| 0` value on a display surface. Track
  "was it surveyed" separately (`raw != null`) and emit `null` for unknown.
- A UI showing care must branch on **both** sides independently: not applicable
  to the service line / our rate missing / their rate missing / both known
  (zero included). Checking only our side reintroduces the bug.
- If a normalizer rejects a non-null rate as implausible, that is *unusable*,
  not zero — fall back to the unknown state, not to `0`.
- Averaging is where this hides. Summing usable values and defaulting an empty
  list to 0 makes absence indistinguishable from bundled care, and the obvious
  test (bundled care yields −(our care)) then passes for the wrong reason.
  Always assert that the two states land in **different** places.
- Changing the *adjustment math* for missing rates is a separate, wider decision
  than fixing the *display* — it moves rates across the whole app. Keep them separate.

## Zero has to clear two independent gates

Care values pass a missing-data check *and* a plausibility band that decides
daily-vs-monthly basis and rejects import noise. Relaxing only the first leaves
the behaviour unchanged and looks like the fix never took effect — the band's
lower bound catches the zero immediately afterwards. An exact zero is
basis-independent ($0/day and $0/month are the same charge), so it belongs
outside the band entirely rather than inside its lower bound.

**How to apply:** whenever "0 means something specific" for a value, check every
threshold on its path before declaring it fixed. Bands calibrated on positive
values silently swallow it.
