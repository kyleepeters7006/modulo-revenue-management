/**
 * Competitor Rate Matching Service
 * 
 * This service matches rent roll units to competitors from the competitive_survey_data table
 * and calculates adjusted competitor rates based on the Competitive Survey Mapping document.
 * 
 * Logic Flow:
 * 1. Map Trilogy's service line + room type to competitor type + room type
 * 2. Select top competitor using weight (if available) or closest distance
 * 3. Get base rate from the matched competitor
 * 4. Adjust for care level 2 differences (HC/AL only, differential vs Trilogy's actual rate)
 * 5. Adjust for medication management (AL only, Trilogy is $0)
 */

import { db } from "../db";
import { competitiveSurveyData, rentRollData, locations, careLevelRates } from "@shared/schema";
import type { CompetitiveSurveyData, RentRollData } from "@shared/schema";
import { eq, and, sql, desc, asc } from "drizzle-orm";
import { isDailyRateServiceLine, normalizeToMonthlyRate, convertToStoredRate } from "./rateNormalization";
import { buildCompetitorRateUpdate } from "./competitorRateSanitizer";
import { normalizeCompetitorCareRateMonthly, DAYS_PER_MONTH } from "@shared/careRates";
// Shared matching policy — MUST stay identical across all writers of the
// stored competitor columns (this path and competitorRateJobService).
import { SURVEY_TYPE_CHAIN, roomTypeFallbackChain, isDailySurveyType, normalizeUnitRoomType, computeCompetitorAdjustments, formatAdjustmentExplanation, CARE_LEVEL_2_APPLIES } from "./competitorMatchPolicy";

// Primary competitor survey type per service line (first entry of the shared
// chain), kept for callers/tests that reference it.
export const SERVICE_LINE_TO_COMPETITOR_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(SURVEY_TYPE_CHAIN).map(([sl, chain]) => [sl, chain[0]])
);

// Plausibility guard for computed competitor rates.
// Monthly rates above this threshold are treated as corrupt and skipped rather
// than written to the DB, preventing a repeat of the $375M Romeo - 2512 incident
// where a bad care-level value produced an astronomically large final rate.

interface CompetitorRateResult {
  unitId: string;
  location: string;
  roomNumber: string;
  roomType: string;
  serviceLine: string;
  competitorName: string | null;
  competitorBaseRate: number | null;
  competitorWeight: number | null;
  competitorAdjustedRate: number | null;
  careLevel2Adjustment: number | null;
  medicationManagementAdjustment: number | null;
  adjustmentDetails: string | null;
  error?: string;
}

/**
 * Extract weight from the notes JSON field
 */
function extractWeight(notes: string | null): number | null {
  if (!notes) return null;
  try {
    const parsed = JSON.parse(notes);
    const weight = parseFloat(parsed.weight);
    return isNaN(weight) ? null : weight;
  } catch {
    return null;
  }
}

/**
 * Get the best competitor rate for a location, service line, and room type
 * using the Top Comp Selection Logic from the mapping document:
 * 1. If weights exist, use the highest weighted competitor
 * 2. If no weights, use the closest competitor that has the service line
 */
// Latest-survey-month memo per client (shared SURVEY-MONTH POLICY: every
// writer matches only the client's most recent survey month). Short TTL so a
// fresh survey upload is picked up quickly.
const latestSurveyMonthCache = new Map<string, { month: string | null; ts: number }>();

/**
 * Drop the memoized latest survey month. MUST be called whenever
 * competitive_survey_data rows are written (imports/deletes) so an immediately
 * scheduled recalculation never matches against the pre-import month.
 */
export function invalidateLatestSurveyMonthCache(clientId?: string): void {
  if (clientId) latestSurveyMonthCache.delete(clientId);
  else latestSurveyMonthCache.clear();
}
const LATEST_MONTH_TTL_MS = 60_000;

async function getLatestSurveyMonth(clientId: string): Promise<string | null> {
  const cached = latestSurveyMonthCache.get(clientId);
  if (cached && Date.now() - cached.ts < LATEST_MONTH_TTL_MS) return cached.month;
  const rows = await db.select({ m: sql<string | null>`MAX(${competitiveSurveyData.surveyMonth})` })
    .from(competitiveSurveyData)
    .where(eq(competitiveSurveyData.clientId, clientId));
  const month = rows[0]?.m ?? null;
  latestSurveyMonthCache.set(clientId, { month, ts: Date.now() });
  return month;
}

export async function getBestCompetitorRate(
  location: string,
  serviceLine: string,
  roomType: string,
  clientId: string
): Promise<{
  competitorName: string;
  baseRate: number;
  weight: number | null;
  careLevel2Rate: number | null;
  medicationManagementFee: number | null;
  distanceMiles: number | null;
  surveyData: CompetitiveSurveyData;
} | null> {
  try {
    // Get the ordered survey-type chain for this service line (dedicated type
    // first, legacy format second — e.g. AL/MC → ['AL/MC', 'AL']).
    const surveyTypeChain = SURVEY_TYPE_CHAIN[serviceLine];
    if (!surveyTypeChain) {
      console.warn(`No competitor type mapping for service line: ${serviceLine}`);
      return null;
    }
    
    // Normalize the unit room type with the SHARED normalizer (Private →
    // Studio, Semi-Private → Companion, etc.) so this path resolves the exact
    // same survey room type as the batch job, then take the candidates from
    // the shared fallback chain: exact room type first (room-type-specific
    // comp), then only the deterministic substitutes (e.g. Studio Dlx →
    // Studio; AL Companion never falls back). A rate from an unrelated room
    // type is a spurious benchmark, so there is no "any room type" fallback
    // anywhere below.
    const mappedRoomType = normalizeUnitRoomType(roomType);
    const rtCandidates = roomTypeFallbackChain(mappedRoomType, serviceLine);

    // Shared SURVEY-MONTH POLICY: match only the client's most recent survey
    // month (same as the batch job) — never walk back to older months per unit.
    const latestMonth = await getLatestSurveyMonth(clientId);
    if (!latestMonth) return null;

    // Query competitive survey data for this location, ALWAYS scoped to the
    // unit's client (tenant isolation) and to the latest survey month.
    // Room-type specificity outranks survey-type preference: walk room-type
    // candidates in the outer loop and survey types (dedicated first, legacy
    // second) in the inner loop, so a legacy row for the RIGHT room type beats
    // a dedicated-type row for a substitute room type.
    let surveyRecords: CompetitiveSurveyData[] = [];
    let matchedSurveyType: string | null = null;

    outer:
    for (const rtCandidate of rtCandidates) {
      for (const surveyType of surveyTypeChain) {
        surveyRecords = await db.select()
          .from(competitiveSurveyData)
          .where(and(
            eq(competitiveSurveyData.clientId, clientId),
            eq(competitiveSurveyData.keyStatsLocation, location),
            eq(competitiveSurveyData.competitorType, surveyType),
            eq(competitiveSurveyData.roomType, rtCandidate),
            eq(competitiveSurveyData.surveyMonth, latestMonth),
            sql`${competitiveSurveyData.monthlyRateAvg} IS NOT NULL`
          ));

        if (surveyRecords.length > 0) {
          matchedSurveyType = surveyType;
          break outer;
        }
      }
    }
    
    if (surveyRecords.length === 0) {
      // No survey row for any (survey type, room type) candidate pair —
      // return null (no competitor signal) rather than borrowing a rate
      // from an unrelated room type.
      return null;
    }
    
    // Top Comp Selection Logic:
    // 1. Check if any competitors have weights > 0
    const recordsWithWeights = surveyRecords
      .map(r => ({ ...r, extractedWeight: extractWeight(r.notes) }))
      .filter(r => r.extractedWeight !== null && r.extractedWeight > 0);
    
    let bestRecord: CompetitiveSurveyData;
    let bestWeight: number | null = null;
    
    if (recordsWithWeights.length > 0) {
      // Use highest weighted competitor
      recordsWithWeights.sort((a, b) => (b.extractedWeight || 0) - (a.extractedWeight || 0));
      const best = recordsWithWeights[0];
      bestRecord = best;
      bestWeight = best.extractedWeight;
      console.log(`✓ Selected top competitor by weight: ${best.competitorName} (weight: ${bestWeight})`);
    } else {
      // No weights - use closest competitor
      const recordsWithDistance = surveyRecords
        .filter(r => r.distanceMiles !== null && r.distanceMiles !== undefined);
      
      if (recordsWithDistance.length > 0) {
        recordsWithDistance.sort((a, b) => (a.distanceMiles || 999) - (b.distanceMiles || 999));
        bestRecord = recordsWithDistance[0];
        console.log(`✓ Selected top competitor by distance: ${bestRecord.competitorName} (${bestRecord.distanceMiles} miles)`);
      } else {
        // Fallback to first record
        bestRecord = surveyRecords[0];
        console.log(`✓ Selected top competitor (no weight/distance): ${bestRecord.competitorName}`);
      }
    }
    
    // Convert rates from daily to monthly for HC/HC-MC/SMC competitor types.
    // The basis comes from the ACTUALLY MATCHED record's type — an HC/MC unit
    // can match a legacy daily SMC row via the shared survey-type chain.
    const isHCOrSMC = isDailySurveyType(matchedSurveyType ?? bestRecord.competitorType ?? '');
    
    let baseRate = bestRecord.monthlyRateAvg || 0;
    let careLevel2Rate = bestRecord.careLevel2Rate;
    let medicationManagementFee = bestRecord.medicationManagementFee;
    
    // Care basis is resolved independently of the street-rate basis. The two
    // columns disagree row by row, so gating the care conversion on the base
    // rate (as this did) let an HC row with a monthly base skip conversion
    // entirely. The shared helper also keeps this monthly-oriented writer and
    // the native-basis read path in /api/competitors on one answer: a bare
    // `< 500 -> scale up` test was the mirror image of the read path's old bug,
    // inflating a genuinely monthly $200 into $6,088/mo. Values that are not
    // credible on either basis come back null and surface as no care
    // adjustment rather than a 30x-inflated one.
    if (isHCOrSMC) {
      careLevel2Rate = normalizeCompetitorCareRateMonthly(careLevel2Rate, 'HC');
    }

    // If HC or SMC and rates look like daily rates (< $1000), convert to monthly
    if (isHCOrSMC && baseRate > 0 && baseRate < 1000) {
      const originalRate = baseRate;
      baseRate = baseRate * DAYS_PER_MONTH;

      if (medicationManagementFee && medicationManagementFee < 100) {
        medicationManagementFee = medicationManagementFee * DAYS_PER_MONTH;
      }
      
      console.log(`✓ Converted ${matchedSurveyType} daily rate $${originalRate.toFixed(2)}/day to $${baseRate.toFixed(2)}/month`);
    }
    
    return {
      competitorName: bestRecord.competitorName,
      baseRate,
      weight: bestWeight || extractWeight(bestRecord.notes),
      careLevel2Rate,
      medicationManagementFee,
      distanceMiles: bestRecord.distanceMiles,
      surveyData: bestRecord
    };
    
  } catch (error) {
    console.error('Error getting best competitor rate:', error);
    return null;
  }
}

/**
 * Calculate competitor rate for a single unit
 */
export async function calculateCompetitorRateForUnit(
  unit: RentRollData
): Promise<CompetitorRateResult> {
  const result: CompetitorRateResult = {
    unitId: unit.id,
    location: unit.location,
    roomNumber: unit.roomNumber,
    roomType: unit.roomType,
    serviceLine: unit.serviceLine,
    competitorName: null,
    competitorBaseRate: null,
    competitorWeight: null,
    competitorAdjustedRate: null,
    careLevel2Adjustment: null,
    medicationManagementAdjustment: null,
    adjustmentDetails: null
  };
  
  try {
    const clientId = unit.clientId || 'demo';

    // Get the best competitor rate for this location, service line, and room
    // type — ALWAYS scoped to the unit's client (tenant isolation) and to the
    // client's latest survey month (shared SURVEY-MONTH POLICY).
    const competitorData = await getBestCompetitorRate(
      unit.location,
      unit.serviceLine,
      unit.roomType,
      clientId
    );
    
    if (!competitorData) {
      return result;
    }
    
    result.competitorName = competitorData.competitorName;
    result.competitorBaseRate = competitorData.baseRate;
    result.competitorWeight = competitorData.weight;
    
    // Load our campus care rates for ALL service lines at this location so the
    // shared resolver can apply memory-care inheritance (AL/MC→AL, HC/MC→HC).
    // Rates are stored in the line's native basis (daily for HC lines).
    let careRatesByServiceLine: Map<string, number> | undefined;
    if (CARE_LEVEL_2_APPLIES[unit.serviceLine]) {
      const careRows = await db.select({
          serviceLine: careLevelRates.serviceLine,
          level2Rate: careLevelRates.level2Rate,
        })
        .from(careLevelRates)
        .innerJoin(locations, eq(careLevelRates.locationId, locations.id))
        .where(and(
          eq(locations.name, unit.location),
          eq(locations.clientId, clientId),
          eq(careLevelRates.clientId, clientId)
        ));
      if (careRows.length > 0) {
        careRatesByServiceLine = new Map(
          careRows
            .filter(r => r.serviceLine != null && r.level2Rate != null)
            .map(r => [r.serviceLine as string, r.level2Rate as number])
        );
      }
    }

    // SHARED adjustment math — identical to the batch job: care resolution
    // with inheritance and native-basis conversion, $55/day fallback when the
    // campus has no care entry at all, med mgmt for the AL lines. All monthly.
    const adj = computeCompetitorAdjustments(
      unit.serviceLine,
      competitorData.careLevel2Rate ?? 0,
      competitorData.medicationManagementFee ?? 0,
      careRatesByServiceLine
    );
    const adjustment = {
      adjustedRate: competitorData.baseRate + adj.careLevel2Adjustment + adj.medMgmtAdjustment,
      careLevel2Adjustment: adj.careLevel2Adjustment,
      medicationManagementAdjustment: adj.medMgmtAdjustment,
      explanation: formatAdjustmentExplanation(competitorData.baseRate, adj),
    };
    
    result.competitorAdjustedRate = adjustment.adjustedRate;
    result.careLevel2Adjustment = adjustment.careLevel2Adjustment;
    result.medicationManagementAdjustment = adjustment.medicationManagementAdjustment;
    result.adjustmentDetails = JSON.stringify({
      baseRate: competitorData.baseRate,
      weight: competitorData.weight,
      careLevel2Adjustment: adjustment.careLevel2Adjustment,
      medicationManagementAdjustment: adjustment.medicationManagementAdjustment,
      explanation: adjustment.explanation,
      competitorDistance: competitorData.distanceMiles,
      surveyMonth: competitorData.surveyData.surveyMonth
    });
    
  } catch (error) {
    console.error('Error calculating competitor rate for unit:', error);
    result.error = error instanceof Error ? error.message : 'Unknown error';
  }
  
  return result;
}

/**
 * Process all units in rent roll and update competitor rates
 */
export async function processAllUnitsForCompetitorRates(
  uploadMonth?: string,
  clientId: string = 'demo'
): Promise<{
  processed: number;
  updated: number;
  errors: number;
  details: CompetitorRateResult[];
}> {
  // Never trust a pre-import memo: recalculation is scheduled right after
  // survey imports, so re-resolve the latest survey month fresh for this run.
  invalidateLatestSurveyMonthCache(clientId);

  const stats = {
    processed: 0,
    updated: 0,
    errors: 0,
    details: [] as CompetitorRateResult[]
  };
  
  try {
    // Get all rent roll units for the specified month (or all if not specified), scoped by clientId
    const baseCondition = eq(rentRollData.clientId, clientId);
    const units = uploadMonth
      ? await db.select().from(rentRollData).where(and(baseCondition, eq(rentRollData.uploadMonth, uploadMonth)))
      : await db.select().from(rentRollData).where(baseCondition);
    
    console.log(`Processing ${units.length} units for competitor rate calculation...`);
    
    // Process units in batches to avoid overwhelming the database
    const batchSize = 100;
    for (let i = 0; i < units.length; i += batchSize) {
      const batch = units.slice(i, i + batchSize);
      
      const batchResults = await Promise.all(
        batch.map(unit => calculateCompetitorRateForUnit(unit))
      );
      
      // Update the database with calculated rates
      for (const result of batchResults) {
        stats.processed++;
        stats.details.push(result);
        
        if (result.error) {
          stats.errors++;
          console.warn(`Error for unit ${result.roomNumber}: ${result.error}`);
          continue;
        }

        // Plausibility guard — uses the shared sanitizer so the same rule applies
        // to every write path.  When the rate is implausible the sanitizer returns
        // a NULL-filled update object, which explicitly CLEARS any corrupt value
        // previously stored (e.g. the $375M Romeo - 2512 row) rather than leaving it.
        let adjustmentData: any = {};
        if (result.adjustmentDetails) {
          try { adjustmentData = JSON.parse(result.adjustmentDetails); }
          catch (e) { console.warn('Failed to parse adjustment details:', e); }
        }

        // Convert monthly values to stored-rate units (daily for HC/HC-MC) before
        // writing.  The plausibility check receives the monthly value so the limit
        // is unit-consistent; the fields object carries the already-converted values
        // that go directly into the DB columns.
        const sl = result.serviceLine ?? null;
        const storedFinal   = result.competitorAdjustedRate !== null
          ? convertToStoredRate(result.competitorAdjustedRate, sl)
          : null;
        const storedBase    = result.competitorBaseRate !== null
          ? convertToStoredRate(result.competitorBaseRate, sl)
          : null;
        const storedCareAdj = result.careLevel2Adjustment !== null && result.careLevel2Adjustment !== undefined
          ? convertToStoredRate(result.careLevel2Adjustment, sl)
          : null;
        const storedMedAdj  = result.medicationManagementAdjustment !== null && result.medicationManagementAdjustment !== undefined
          ? convertToStoredRate(result.medicationManagementAdjustment, sl)
          : null;

        const sanitized = buildCompetitorRateUpdate(
          result.competitorAdjustedRate, // monthly — used for plausibility limit
          {
            competitorName: result.competitorName,
            competitorBaseRate: storedBase,
            competitorFinalRate: storedFinal,
            competitorCareLevel2Adjustment: storedCareAdj ?? 0,
            competitorMedManagementAdjustment: storedMedAdj ?? 0,
            competitorWeight: result.competitorWeight,
          }
        );

        if (!sanitized.plausible) {
          console.warn(
            `[CompetitorRate] Implausible rate for unit ${result.roomNumber} ` +
            `(${result.location} / ${result.serviceLine} / ${result.roomType}): ` +
            `${sanitized.reason} — clearing competitor fields`
          );
        }

        // Always write (valid fields or NULLs) so stale corrupt values are cleared.
        try {
          await db.update(rentRollData)
            .set({
              competitorRate: sanitized.update.competitorFinalRate,
              competitorFinalRate: sanitized.update.competitorFinalRate,
              competitorName: sanitized.update.competitorName,
              competitorBaseRate: sanitized.update.competitorBaseRate,
              competitorWeight: sanitized.update.competitorWeight,
              competitorCareLevel2Adjustment: sanitized.update.competitorCareLevel2Adjustment ?? null,
              competitorMedManagementAdjustment: sanitized.update.competitorMedManagementAdjustment ?? null,
              competitorAdjustmentExplanation: sanitized.plausible ? (adjustmentData.explanation || null) : null,
            })
            .where(eq(rentRollData.id, result.unitId));

          if (sanitized.plausible) stats.updated++;
          else stats.errors++;
        } catch (updateError) {
          console.error(`Error updating unit ${result.unitId}:`, updateError);
          stats.errors++;
        }
      }
      
      console.log(`Processed ${Math.min(i + batchSize, units.length)} / ${units.length} units`);
    }
    
  } catch (error) {
    console.error('Error processing units for competitor rates:', error);
  }
  
  return stats;
}

/**
 * Get competitor rate summary for reporting
 */
export async function getCompetitorRateSummary(uploadMonth?: string, clientId: string = 'demo') {
  try {
    const baseConditions = [
      eq(rentRollData.clientId, clientId),
      sql`${rentRollData.competitorRate} IS NOT NULL`
    ];
    const query = uploadMonth 
      ? db.select({
          location: rentRollData.location,
          serviceLine: rentRollData.serviceLine,
          roomType: rentRollData.roomType,
          avgStreetRate: sql<number>`AVG(CASE WHEN ${rentRollData.serviceLine} IN ('AL', 'AL/MC', 'SL', 'VIL') AND ${rentRollData.roomNumber} ~* '/[B-Zb-z]$' THEN NULL ELSE ${rentRollData.streetRate} END)`,
          avgCompetitorRate: sql<number>`AVG(CASE WHEN ${rentRollData.serviceLine} IN ('AL', 'AL/MC', 'SL', 'VIL') AND ${rentRollData.roomNumber} ~* '/[B-Zb-z]$' THEN NULL ELSE ${rentRollData.competitorRate} END)`,
          avgDifference: sql<number>`AVG(CASE WHEN ${rentRollData.serviceLine} IN ('AL', 'AL/MC', 'SL', 'VIL') AND ${rentRollData.roomNumber} ~* '/[B-Zb-z]$' THEN NULL ELSE ${rentRollData.competitorRate} - ${rentRollData.streetRate} END)`,
          count: sql<number>`COUNT(*) FILTER (WHERE NOT (${rentRollData.serviceLine} IN ('AL', 'AL/MC', 'SL', 'VIL') AND ${rentRollData.roomNumber} ~* '/[B-Zb-z]$'))`,
        })
        .from(rentRollData)
        .where(and(
          eq(rentRollData.uploadMonth, uploadMonth),
          ...baseConditions
        ))
        .groupBy(rentRollData.location, rentRollData.serviceLine, rentRollData.roomType)
      : db.select({
          location: rentRollData.location,
          serviceLine: rentRollData.serviceLine,
          roomType: rentRollData.roomType,
          avgStreetRate: sql<number>`AVG(CASE WHEN ${rentRollData.serviceLine} IN ('AL', 'AL/MC', 'SL', 'VIL') AND ${rentRollData.roomNumber} ~* '/[B-Zb-z]$' THEN NULL ELSE ${rentRollData.streetRate} END)`,
          avgCompetitorRate: sql<number>`AVG(CASE WHEN ${rentRollData.serviceLine} IN ('AL', 'AL/MC', 'SL', 'VIL') AND ${rentRollData.roomNumber} ~* '/[B-Zb-z]$' THEN NULL ELSE ${rentRollData.competitorRate} END)`,
          avgDifference: sql<number>`AVG(CASE WHEN ${rentRollData.serviceLine} IN ('AL', 'AL/MC', 'SL', 'VIL') AND ${rentRollData.roomNumber} ~* '/[B-Zb-z]$' THEN NULL ELSE ${rentRollData.competitorRate} - ${rentRollData.streetRate} END)`,
          count: sql<number>`COUNT(*) FILTER (WHERE NOT (${rentRollData.serviceLine} IN ('AL', 'AL/MC', 'SL', 'VIL') AND ${rentRollData.roomNumber} ~* '/[B-Zb-z]$'))`,
        })
        .from(rentRollData)
        .where(and(...baseConditions))
        .groupBy(rentRollData.location, rentRollData.serviceLine, rentRollData.roomType);
    
    const summary = await query;
    
    return summary.map(row => ({
      ...row,
      avgStreetRate: Math.round(row.avgStreetRate || 0),
      avgCompetitorRate: Math.round(row.avgCompetitorRate || 0),
      avgDifference: Math.round(row.avgDifference || 0)
    }));
    
  } catch (error) {
    console.error('Error getting competitor rate summary:', error);
    return [];
  }
}
