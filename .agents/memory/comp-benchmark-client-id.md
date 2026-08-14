---
name: Competitive survey data client_id is NULL
description: competitive_survey_data rows have client_id=NULL; compBenchmark queries must use (client_id=$1 OR client_id IS NULL); AL/MC must also search competitor_type=AL
---

## The rule
All queries against `competitive_survey_data` in `server/services/compBenchmark.ts` must use:
```sql
WHERE (client_id = $1 OR client_id IS NULL)
```
not `WHERE client_id = $1` alone, because every row in the table has `client_id = NULL`.

Additionally, `SL_TO_COMP["AL/MC"]` must include `"AL"` as a fallback: survey data stores AL/MC-range competitors under `competitor_type = "AL"`. The old mapping `["AL/MC"]` always returned zero competitors for AL/MC service lines.

**Why:** The `competitive_survey_data` table was imported without a client_id value (all rows are null). Using `client_id = $1` ('trilogy', 'demo', etc.) filtered out every single row, so `loadCompBenchmark` and `loadStudioCompBenchmark` both returned empty results for all non-implicit clients. The Competitors tab works because `storage.ts` uses a different query path. The competitive-position scatter chart and commentary both went blank as a result.

**How to apply:**
- Any new query touching `competitive_survey_data` must use the `(client_id = $1 OR client_id IS NULL)` pattern.
- `SL_TO_COMP` in compBenchmark.ts: `"AL/MC": ["AL/MC", "AL"]` — don't revert to `["AL/MC"]` only.
- If the Competitive Position scatter or top-competitor name goes blank for any client, check this first before suspecting route logic.
