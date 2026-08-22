/**
 * Shared competitor-matching policy.
 *
 * Both writers of the stored per-unit competitor columns —
 * `competitorRateJobService` (batch job) and `competitorRateMatching`
 * (import/recalculation path) — MUST use this module so their fallback
 * behavior cannot drift apart.
 *
 * Policy:
 *  - Service line → ordered survey-type chain (dedicated type first, legacy
 *    format second, e.g. AL/MC → ['AL/MC', 'AL'], HC/MC → ['HC/MC', 'SMC']).
 *  - Room type → ordered room-type chain. Matching is room-type-specific
 *    first; the only cross-room-type fallbacks are the deterministic ones
 *    below. There is NEVER an "any room type at this location" fallback —
 *    a rate from an unrelated room type is a spurious benchmark.
 *  - Daily-vs-monthly rate basis is decided by the ACTUALLY MATCHED record's
 *    competitor type (an HC/MC unit can match a legacy daily SMC row), never
 *    by the first candidate type.
 */

import { resolveCareLevel2, isDailyServiceLine, DAYS_PER_MONTH } from "@shared/careRates";

/** Ordered survey competitor-type candidates per Trilogy service line. */
export const SURVEY_TYPE_CHAIN: Record<string, string[]> = {
  'AL': ['AL'],
  'AL/MC': ['AL/MC', 'AL'],     // dedicated type first, legacy AL rows second
  'HC': ['HC'],
  'HC/MC': ['HC/MC', 'SMC'],    // dedicated type first, legacy SMC rows second
  'SL': ['IL_IL'],              // Senior Living apartments
  'VIL': ['IL_Villa'],          // Independent Living villas
};

/**
 * Ordered room-type candidates for survey lookups.
 *  - Studio Dlx prefers its own survey rows and only then falls back to Studio.
 *  - Companion in the AL lines must NEVER fall back to a private-room rate
 *    (semi-private pricing is structurally different).
 *  - Everything else falls back to Studio as the like-for-like unit.
 * `roomType` must already be a normalized survey room type (Studio, Studio Dlx,
 * Companion, One Bedroom, Two Bedroom).
 */
export function roomTypeFallbackChain(roomType: string, serviceLine: string): string[] {
  if (roomType === 'Companion') {
    return (serviceLine === 'AL' || serviceLine === 'AL/MC')
      ? ['Companion']
      : ['Companion', 'Studio Dlx', 'Studio'];
  }
  if (roomType === 'Studio Dlx') return ['Studio Dlx', 'Studio'];
  if (roomType === 'Studio') return ['Studio'];
  return [roomType, 'Studio'];
}

/**
 * Normalize a rent-roll unit room type to a canonical survey room type.
 * Shared by every writer so a "Private" or "Semi-Private" unit resolves
 * identically regardless of which path processed it:
 *   Private → Studio, Semi-Private → Companion.
 * Unknown values are returned unchanged; the fallback chain then tries them
 * as-is followed by Studio.
 */
export function normalizeUnitRoomType(roomType: string): string {
  const n = (roomType || '').toLowerCase().trim();
  if (n.includes('studio dlx') || n.includes('deluxe')) return 'Studio Dlx';
  if (n.includes('studio')) return 'Studio';
  if (n.includes('one') || n.includes('1 bed')) return 'One Bedroom';
  if (n.includes('two') || n.includes('2 bed')) return 'Two Bedroom';
  if (n.includes('companion') || n.includes('semi')) return 'Companion';
  if (n.includes('private')) return 'Studio'; // Private room ≈ Studio (after Semi-Private above)
  return roomType;
}

/**
 * Survey types whose rates are entered as DAILY values (subject to the
 * caller's <1000 plausibility heuristic — some rows are entered monthly).
 * Evaluate against the MATCHED record's competitor type.
 */
export function isDailySurveyType(competitorType: string): boolean {
  return competitorType === 'HC' || competitorType === 'HC/MC' || competitorType === 'SMC';
}

/**
 * SURVEY-MONTH POLICY (shared): every writer matches ONLY the client's most
 * recent survey month. A stale month must never override a fresh upload, and
 * a rent-roll month with no matching survey month must not silently walk back
 * to arbitrary older data on a per-unit basis — the whole client moves to the
 * newest survey as one unit.
 */

/** Care Level 2 adjustments apply to the HC and AL lines only. */
export const CARE_LEVEL_2_APPLIES: Record<string, boolean> = {
  'HC': true, 'HC/MC': true, 'AL': true, 'AL/MC': true, 'SL': false, 'VIL': false,
};

/** Medication management applies to the AL lines only (Trilogy charges $0). */
export const MED_MGMT_APPLIES: Record<string, boolean> = {
  'HC': false, 'HC/MC': false, 'AL': true, 'AL/MC': true, 'SL': false, 'VIL': false,
};

/**
 * Fallback Care Level 2 rate ($55/day), used ONLY when a campus has no entry in
 * care_level_rates (directly or via memory-care inheritance from its base line).
 */
export const FALLBACK_CARE_LEVEL_2_DAILY = 55;

export interface CompetitorAdjustments {
  /** Monthly $: competitor care − our care (0 when not applicable). */
  careLevel2Adjustment: number;
  /** Monthly $: competitor med-mgmt fee (0 when not applicable). */
  medMgmtAdjustment: number;
  /** True when the $55/day care fallback was used (campus missing care rates). */
  usedCareFallback: boolean;
}

/**
 * Shared adjustment math for BOTH writers of the stored competitor columns.
 *
 * - Care Level 2 (HC/AL lines, only when the competitor reports a care rate):
 *   competitor monthly care − our monthly care, where our rate comes from
 *   `resolveCareLevel2` (direct row first, then memory-care inheritance
 *   AL/MC→AL, HC/MC→HC), converted from the line's native basis (daily for
 *   HC lines), with the $55/day fallback when the campus has no entry at all.
 * - Medication management (AL lines): competitor's fee − our $0.
 *
 * All inputs and outputs are MONTHLY dollars.
 *
 * `competitorCareLevel2Monthly` distinguishes two cases that MUST NOT be
 * conflated:
 *  - `null`  → care rate not surveyed / not applicable; no adjustment produced.
 *  - `0`     → competitor bundles care in their room rate (all-inclusive);
 *              adjustment = 0 − ourCare (a negative number for HC lines),
 *              matching the display path in `shared/careRates.computeCompetitorCareAdj`.
 *
 * Callers MUST pass `null` (not `0`) when they have no surveyed care value —
 * the previous `number` type with a `> 0` gate silently converted both "not
 * surveyed" and "all-inclusive ($0)" to "no adjustment".
 */
export function computeCompetitorAdjustments(
  serviceLine: string,
  competitorCareLevel2Monthly: number | null,
  competitorMedMgmtMonthly: number,
  careRatesByServiceLine: Map<string, number> | undefined,
): CompetitorAdjustments {
  let careLevel2Adjustment = 0;
  let medMgmtAdjustment = 0;
  let usedCareFallback = false;

  // `!== null` lets a surveyed $0 (all-inclusive competitor) through;
  // only a true null (unsurveyed) skips the block.
  if (CARE_LEVEL_2_APPLIES[serviceLine] && competitorCareLevel2Monthly !== null) {
    const resolved = resolveCareLevel2(careRatesByServiceLine, serviceLine);
    let trilogyCareLevel2Monthly: number;
    if (resolved) {
      trilogyCareLevel2Monthly = isDailyServiceLine(serviceLine)
        ? resolved.rate * DAYS_PER_MONTH
        : resolved.rate;
    } else {
      trilogyCareLevel2Monthly = FALLBACK_CARE_LEVEL_2_DAILY * DAYS_PER_MONTH;
      usedCareFallback = true;
    }
    careLevel2Adjustment = competitorCareLevel2Monthly - trilogyCareLevel2Monthly;
  }

  if (MED_MGMT_APPLIES[serviceLine] && competitorMedMgmtMonthly > 0) {
    medMgmtAdjustment = competitorMedMgmtMonthly;
  }

  return { careLevel2Adjustment, medMgmtAdjustment, usedCareFallback };
}

/**
 * Shared human-readable explanation of the adjusted rate, so both writers
 * store an identical `competitor_adjustment_explanation`.
 * All inputs are MONTHLY dollars.
 */
export function formatAdjustmentExplanation(baseRateMonthly: number, adj: CompetitorAdjustments): string {
  let s = `Base Rate: $${baseRateMonthly.toFixed(0)}`;
  if (adj.careLevel2Adjustment !== 0) {
    s += `\nCare Level 2: ${adj.careLevel2Adjustment >= 0 ? '+' : ''}$${adj.careLevel2Adjustment.toFixed(0)}${adj.usedCareFallback ? ' (campus care rate missing — $55/day default used)' : ''}`;
  }
  if (adj.medMgmtAdjustment !== 0) {
    s += `\nMedication Management: +$${adj.medMgmtAdjustment.toFixed(0)} (Trilogy $0)`;
  }
  return s;
}
