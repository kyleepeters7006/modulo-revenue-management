---
name: Rule parser silently drops unmatched compound conditions
description: Why a trigger phrase can parse standalone but vanish inside "A AND B", and the rule that prevents it.
---

# Rule parser silently drops unmatched compound conditions

The natural-language rule parser has **two independent matching paths**, and they do not know about each other:

1. A set of whole-input regex fallbacks, which accept loose natural phrasing.
2. The `METRIC_TO_FIELD` table, used for each part after an `AND`/`OR` split, which matches by `startsWith || includes` against literal keys.

A metric whose only table key is a canonical column label therefore parses correctly **standalone** (path 1) but matches nothing **inside a compound trigger** (path 2). The unmatched part is dropped without any error, and the saved rule keeps its full human-readable description while its stored trigger contains only the conditions that happened to match. The rule then looks right in the UI and fires on the wrong population.

**Why:** this bit the AI rule generator, whose prompt used natural phrasing for in-house-to-street variance. Standalone rules were fine; every `AND` rule quietly lost the variance gate and fired on occupancy alone.

**How to apply:**
- When adding or referencing a trigger metric, add every phrasing users and the AI actually write to `METRIC_TO_FIELD`, not just the canonical column label. The whole-input regex fallback is not sufficient.
- Verify with a compound rule (`"if <metric> ... AND <occupancy> ..."`), not just a standalone one — a standalone test passes even when the table entry is missing entirely.
- Assert on parsed condition **count**, not just that parsing succeeded. Silent drops always return a valid-looking trigger.
- Watch per-metric value scale: `rawPct: true` keeps the 0–100 % scale, omitting it divides by 100. Occupancy is stored as a fraction, IH-to-street variance as raw %. Set the flag to match the engines rather than relying on their legacy fraction-vs-percent compensation, and make sure **every** evaluation site applies the same normalisation — a display/preview evaluator that skips it will disagree with the pricing engine on legacy rules.
