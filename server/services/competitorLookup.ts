/**
 * Competitor Lookup Service
 *
 * Centralizes room-type matching and care/med-management adjustment for survey
 * competitor data.  All pricing endpoints (single-unit and batch) call
 * matchAndAdjustCompetitor so the logic lives in exactly one place.
 *
 * Formula: adjustedRate = base + (theirCareL2 - ourCareL2) + (theirMedMgmt - ourMedMgmt)
 */

import { calculateAdjustedCompetitorRate } from './competitorAdjustments';
import type { CompetitorInfo } from '../moduloPricingAlgorithm';

export interface SurveyRow {
  competitorName: string;
  roomType: string;
  monthlyRateAvg: number;
  careLevel2Rate: number | null;
  medicationManagementFee: number | null;
  weight: number;
  distanceMiles: number | null;
}

export interface CompetitorContext {
  competitorPrices: number[];
  competitorInfo: CompetitorInfo | undefined;
}

/**
 * Match survey rows for a unit's room type and apply care-level / med-management
 * adjustments.  Returns { competitorPrices, competitorInfo }.
 *
 * Room-type fallback chain:
 *   Companion (AL / AL/MC) → Companion only (no Studio fallback for AL companion)
 *   Companion (other SLs)  → Companion → Studio Dlx → Studio
 *   All others             → exact room type → Studio
 *
 * Neutral state: when no room-type row has a usable rate, competitorPrices stays
 * empty and competitorInfo is a stub that names the selected competitor (from
 * surveyRows[0]) so explanation text can reference it.
 */
export function matchAndAdjustCompetitor(
  surveyRows: SurveyRow[] | null | undefined,
  roomType: string,
  ourCareLevel2: number,
  ourMedMgmt: number,
  serviceLine?: string
): CompetitorContext {
  const competitorPrices: number[] = [];
  let competitorInfo: CompetitorInfo | undefined;

  if (!surveyRows || surveyRows.length === 0) {
    return { competitorPrices, competitorInfo };
  }

  const originalRoomType = roomType;
  const isAlCompanion = originalRoomType === 'Companion' &&
    (serviceLine === 'AL' || serviceLine === 'AL/MC');
  const fallbackChain = originalRoomType === 'Companion'
    ? (isAlCompanion ? ['Companion'] : ['Companion', 'Studio Dlx', 'Studio'])
    : [originalRoomType, 'Studio'];

  let matchedRow: SurveyRow | null = null;
  let usedRoomType = originalRoomType;
  for (const rt of fallbackChain) {
    const candidate = surveyRows.find(r => r.roomType === rt && r.monthlyRateAvg > 0);
    if (candidate) { matchedRow = candidate; usedRoomType = rt; break; }
  }

  if (matchedRow) {
    const adjustmentResult = calculateAdjustedCompetitorRate({
      competitorBaseRate: matchedRow.monthlyRateAvg,
      competitorCareLevel2Rate: matchedRow.careLevel2Rate || 0,
      competitorMedicationManagementFee: matchedRow.medicationManagementFee || 0,
      trilogyCareLevel2Rate: ourCareLevel2,
      trilogyMedicationManagementFee: ourMedMgmt
    });
    if (adjustmentResult.adjustedRate > 0) {
      competitorPrices.push(adjustmentResult.adjustedRate);
      competitorInfo = {
        name: matchedRow.competitorName,
        weight: matchedRow.weight || 0,
        adjustedRate: adjustmentResult.adjustedRate,
        baseRate: matchedRow.monthlyRateAvg,
        careLevel2Adj: adjustmentResult.careLevel2Adjustment,
        medMgmtAdj: adjustmentResult.medicationManagementAdjustment,
        theirCareL2: matchedRow.careLevel2Rate || 0,
        ourCareL2: ourCareLevel2,
        theirMedMgmt: matchedRow.medicationManagementFee || 0,
        ourMedMgmt,
        originalRoomType,
        usedRoomType,
        usedFallback: usedRoomType !== originalRoomType
      };
    }
    // If adjustedRate <= 0 (pathological), leave competitorPrices as [] → neutral state
  } else {
    // No room-type row with a usable rate: stub so explanation can name the selected competitor.
    // surveyRows[0] is safe here because surveyRows.length > 0 is checked above.
    competitorInfo = {
      name: surveyRows[0].competitorName,
      weight: surveyRows[0].weight || 0,
      adjustedRate: 0, baseRate: 0,
      careLevel2Adj: 0, medMgmtAdj: 0,
      theirCareL2: 0, ourCareL2: ourCareLevel2, theirMedMgmt: 0, ourMedMgmt,
      originalRoomType, usedRoomType: originalRoomType, usedFallback: false
    };
  }

  return { competitorPrices, competitorInfo };
}
