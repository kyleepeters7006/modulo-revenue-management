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

### AL/MC competitor type — unresolved tension, check the code before trusting either side
`SL_TO_COMP["AL/MC"]` has since been set back to `["AL/MC"]` alone, with a comment asserting that
AL and AL/MC are distinct service lines with separate survey entries. That is true wherever the
survey import actually populated AL/MC rows — the trilogy import does, for ~137 of 148 locations.
It is false for any client whose survey has no AL/MC rows at all (the demo dataset has none), and
those locations then get **no competitor benchmark and no price position at all**, silently.

So both mappings are defensible and the right one depends on the client's survey import. Do not
flip it without first checking `SELECT competitor_type, COUNT(DISTINCT keystats_location) FROM
competitive_survey_data GROUP BY 1` per client — and remember the change moves every surface that
uses the benchmark, not just the one you are looking at.

**Why:** The `competitive_survey_data` table was imported without a client_id value (all rows are null). Using `client_id = $1` ('trilogy', 'demo', etc.) filtered out every single row, so `loadCompBenchmark` and `loadStudioCompBenchmark` both returned empty results for all non-implicit clients. The Competitors tab works because `storage.ts` uses a different query path. The competitive-position scatter chart and commentary both went blank as a result.

**How to apply:**
- Any new query touching `competitive_survey_data` must use the `(client_id = $1 OR client_id IS NULL)` pattern.
- `SL_TO_COMP` in compBenchmark.ts: `"AL/MC": ["AL/MC", "AL"]` — don't revert to `["AL/MC"]` only.
- If the Competitive Position scatter or top-competitor name goes blank for any client, check this first before suspecting route logic.
