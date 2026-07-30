/**
 * Competitor Rate Sanitizer
 *
 * Centralizes the plausibility check for computed competitor rates and produces
 * the exact DB update object that every write path should use.
 *
 * Design rationale
 * ────────────────
 * Three separate paths can write `competitor_final_rate`:
 *   1. competitorRateJobService  (bulk job)
 *   2. competitorRateMatching    (recalculation endpoint)
 *   3. routes.ts /api/competitor-rates/test
 *
 * Previously each path skipped the update on an implausible rate but left any
 * pre-existing corrupt value (e.g. $375 531 072 for Romeo - 2512 Studio) in
 * the row.  Now all three paths call `buildCompetitorRateUpdate` which returns
 * a NULL-filled object when the rate is implausible, ensuring the corrupt value
 * is actively cleared on the next recalculation run.
 */

/** Monthly rates above this threshold are treated as corrupt and cleared. */
export const MAX_PLAUSIBLE_MONTHLY_RATE = 50_000;

export interface CompetitorRateFields {
  competitorName: string | null;
  competitorBaseRate: number | null;
  competitorFinalRate: number | null;
  competitorCareLevel2Adjustment: number | null;
  competitorMedManagementAdjustment: number | null;
  competitorWeight: number | null;
}

export interface PlausibilityResult {
  plausible: boolean;
  /** The object to pass to db.update().set() — nulls for implausible rates */
  update: CompetitorRateFields;
  /** Human-readable reason when implausible */
  reason?: string;
}

/**
 * Determine whether a computed monthly rate is plausible, and return the DB
 * update object.  When implausible, every competitor-rate column is explicitly
 * set to NULL so any previously-stored corrupt value is cleared.
 *
 * @param monthlyRate  Final computed monthly rate (BEFORE daily conversion for HC)
 * @param fields       Rate fields to persist when plausible
 */
export function buildCompetitorRateUpdate(
  monthlyRate: number | null,
  fields: CompetitorRateFields
): PlausibilityResult {
  if (monthlyRate === null) {
    // No rate computed — leave existing values unchanged (return null update)
    return {
      plausible: false,
      reason: 'No rate computed (null)',
      update: {
        competitorName: null,
        competitorBaseRate: null,
        competitorFinalRate: null,
        competitorCareLevel2Adjustment: null,
        competitorMedManagementAdjustment: null,
        competitorWeight: null,
      },
    };
  }

  if (monthlyRate <= 0) {
    return {
      plausible: false,
      reason: `Rate is non-positive (${monthlyRate})`,
      update: {
        competitorName: null,
        competitorBaseRate: null,
        competitorFinalRate: null,
        competitorCareLevel2Adjustment: null,
        competitorMedManagementAdjustment: null,
        competitorWeight: null,
      },
    };
  }

  if (monthlyRate > MAX_PLAUSIBLE_MONTHLY_RATE) {
    return {
      plausible: false,
      reason: `Rate ${monthlyRate.toFixed(2)} exceeds MAX_PLAUSIBLE_MONTHLY_RATE (${MAX_PLAUSIBLE_MONTHLY_RATE})`,
      update: {
        competitorName: null,
        competitorBaseRate: null,
        competitorFinalRate: null,
        competitorCareLevel2Adjustment: null,
        competitorMedManagementAdjustment: null,
        competitorWeight: null,
      },
    };
  }

  return { plausible: true, update: fields };
}
