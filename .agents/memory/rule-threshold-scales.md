---
name: Rule threshold scales
description: Rule thresholds live on two scales and evaluators silently rescale values they judge to be on the wrong one, so an out-of-range threshold is multiplied by 100 rather than rejected.
---

# Rule threshold scales

Rule trigger thresholds are stored on **two different scales**, and the metrics they are
compared against are on a third arrangement. The occupancy family is stored as a fraction
(0–1) while the variance and mix metrics are stored as percentage points (0–100). Every
`campus_metrics` value they are compared against is 0–100.

**Why this is dangerous rather than merely inconsistent:** the evaluators do not reject a
threshold that looks like it is on the wrong scale — they *rescale* it, multiplying any value
of 1 or less by 100. So a threshold that is out of range for its field is silently reinterpreted
as a different number, and nothing surfaces the substitution. A percentage-point metric given
`0.5` becomes `50`.

**How to apply:**

- Before adding or changing a metric mapping, confirm which scale the metric it is compared
  against actually uses, and mark the mapping accordingly. A mapping on the wrong scale is
  invisible in tests that only check parsing.
- Any threshold outside its field's representable range must be refused at creation time. The
  representable range is bounded by the rescaling rule, not by the metric's natural domain.
- When one branch of an evaluator normalises and a sibling branch does not, treat the
  un-normalised branch as the bug. Divergence between the pricing path and the impact/preview
  path is the symptom to look for: preview normalised while live pricing did not, so a gate
  that filtered correctly in the preview passed for every row in production.

## Inferred scale is a design smell

The rule designer composes a **sentence** and the server **re-parses** it; no structured
threshold is transmitted. Every scale is therefore inferred from the magnitude of a number,
which cannot distinguish a fraction from a small percentage.

- Treat an explicit `%` as the author declaring the scale, and let it win over any
  magnitude heuristic. Reserve the heuristic for when the sign is absent.
- Have the composing UI always emit the unit it means, so the parser never has to guess.
- A written minus must be captured. Dropping it turns a decrease into an increase; a minus
  that contradicts a direction verb is ambiguous and belongs in the refusal path, not in a
  guess.
