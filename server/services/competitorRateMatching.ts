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
 * 4. Adjust for care level 2 differences (HC/AL only, Trilogy default $55/day)
 * 5. Adjust for medication management (AL only, Trilogy is $0)
 */

import { db } from "../db";
import { competitiveSurveyData, rentRollData } from "@shared/schema";
import type { CompetitiveSurveyData, RentRollData } from "@shared/schema";
import { eq, and, sql, desc, asc } from "drizzle-orm";
import { isDailyRateServiceLine, normalizeToMonthlyRate } from "./rateNormalization";

// Mapping from Trilogy service line to competitor survey type
// From "Competitor Has Service Line Column" in the mapping document
const SERVICE_LINE_TO_COMPETITOR_TYPE: Record<string, string> = {
  'HC': 'HC',
  'HC/MC': 'SMC',
  'AL': 'AL',
  'AL/MC': 'AL',  // AL/MC uses AL competitor type
  'SL': 'IL',
  'VIL': 'IL'
};

// Room type mapping based on the "Base Competitor Rate Column" in the mapping document
// Maps (Trilogy Service Line, Trilogy Room Type) -> Survey Room Type
const ROOM_TYPE_MAPPING: Record<string, Record<string, string>> = {
  'HC': {
    'Studio': 'Studio',           // HC_PrivateRoomRate
    'Studio Dlx': 'Studio Dlx',   // HC_PrivateDeluxeRoomRate
    'Companion': 'Companion',     // HC_CompanionSemiPrivateRoomRate
    'One Bedroom': 'Studio',      // HC_PrivateRoomRate (fallback)
    'Two Bedroom': 'Studio',      // HC_PrivateRoomRate (fallback)
    'Private': 'Studio',
    'Semi-Private': 'Companion'
  },
  'HC/MC': {
    'Studio': 'Studio',           // SMC_PrivateRoomRate
    'Studio Dlx': 'Studio Dlx',   // SMC_PrivateDeluxeRoomRate
    'Companion': 'Companion',     // SMC_CompanionRoomRate
    'One Bedroom': 'Studio',      // SMC_PrivateRoomRate (fallback)
    'Two Bedroom': 'Studio',      // SMC_PrivateRoomRate (fallback)
    'Private': 'Studio',
    'Semi-Private': 'Companion'
  },
  'AL': {
    'Studio': 'Studio',           // AL_StudioRoomRate
    'Studio Dlx': 'Studio',       // AL_StudioRoomRate (fallback)
    'Companion': 'Companion',     // AL_CompanionRoomRate
    'One Bedroom': 'One Bedroom', // AL_1BRRoomRate
    'Two Bedroom': 'Two Bedroom', // AL_2BRRoomRate
    'Private': 'Studio'
  },
  'AL/MC': {
    'Studio': 'Studio',           // AL_MCStudioRoomRate
    'Studio Dlx': 'Studio',       // AL_MCStudioRoomRate (fallback)
    'Companion': 'Companion',     // AL_MCCompanionRoomRate
    'One Bedroom': 'One Bedroom', // AL_MC1BRRoomRate
    'Two Bedroom': 'Two Bedroom', // AL_MC2BRRoomRate
    'Private': 'Studio'
  },
  'SL': {
    'Studio': 'Studio',           // IL_ILStudioRoomRate
    'Studio Dlx': 'Studio',       // IL_ILStudioRoomRate (fallback)
    'Companion': 'Companion',     // IL_ILStudioCompanionRoomRate
    'One Bedroom': 'One Bedroom', // IL_IL1BRRoomRate
    'Two Bedroom': 'Two Bedroom', // IL_IL2BRRoomRate
    'Private': 'Studio'
  },
  'VIL': {
    'Studio': 'Studio',           // IL_VillaStudioPrivateRoomRate
    'Studio Dlx': 'Studio',       // IL_VillaStudioPrivateRoomRate (fallback)
    'Companion': 'Companion',     // IL_VillaStudioCompanionRoomRate
    'One Bedroom': 'One Bedroom', // IL_Villa1BRPrivateRoomRate
    'Two Bedroom': 'Two Bedroom', // IL_Villa2BRPrivateRoomRate
    'Private': 'Studio'
  }
};

// Service lines that should apply care level 2 adjustments
// From "Trilogy Campus Care Level 2" column - "Default to $55" for HC/AL, "Does not apply" for SL/VIL
const CARE_LEVEL_2_APPLIES: Record<string, boolean> = {
  'HC': true,      // Default to $55/day
  'HC/MC': true,   // Default to $55/day
  'AL': true,      // Default to $55/day
  'AL/MC': true,   // Default to $55/day
  'SL': false,     // Does not apply, no adjustment
  'VIL': false     // Does not apply, no adjustment
};

// Default Trilogy care level 2 rate (daily) when applicable
const TRILOGY_CARE_LEVEL_2_DEFAULT = 55; // $55/day

// Service lines that should apply medication management adjustments
// From "Competitor Medication Management" column - "Do not apply" for HC, add fee for AL
const MEDICATION_MGMT_APPLIES: Record<string, boolean> = {
  'HC': false,     // Do not apply
  'HC/MC': false,  // Do not apply
  'AL': true,      // Apply competitor's med mgmt fee (Trilogy is $0)
  'AL/MC': true,   // Apply competitor's med mgmt fee (Trilogy is $0)
  'SL': false,     // Does not apply, no adjustment
  'VIL': false     // Does not apply, no adjustment
};

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
async function getBestCompetitorRate(
  location: string,
  serviceLine: string,
  roomType: string,
  surveyMonth?: string
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
    // Get the competitor type for this service line
    const competitorType = SERVICE_LINE_TO_COMPETITOR_TYPE[serviceLine];
    if (!competitorType) {
      console.warn(`No competitor type mapping for service line: ${serviceLine}`);
      return null;
    }
    
    // Get the room type mapping for this service line
    const roomTypeMap = ROOM_TYPE_MAPPING[serviceLine];
    if (!roomTypeMap) {
      console.warn(`No room type mapping for service line: ${serviceLine}`);
      return null;
    }
    
    const mappedRoomType = roomTypeMap[roomType];
    if (!mappedRoomType) {
      console.warn(`No mapping for room type: ${roomType} in service line: ${serviceLine}`);
      return null;
    }
    
    // Build query conditions
    const conditions: any[] = [
      eq(competitiveSurveyData.keyStatsLocation, location),
      eq(competitiveSurveyData.competitorType, competitorType),
      eq(competitiveSurveyData.roomType, mappedRoomType),
      sql`${competitiveSurveyData.monthlyRateAvg} IS NOT NULL`
    ];
    
    // Add survey month filter if provided
    if (surveyMonth) {
      conditions.push(eq(competitiveSurveyData.surveyMonth, surveyMonth));
    }
    
    // Query competitive survey data for this location
    const surveyRecords = await db.select()
      .from(competitiveSurveyData)
      .where(and(...conditions));
    
    if (surveyRecords.length === 0) {
      // Try without room type filter as fallback
      const fallbackConditions: any[] = [
        eq(competitiveSurveyData.keyStatsLocation, location),
        eq(competitiveSurveyData.competitorType, competitorType),
        sql`${competitiveSurveyData.monthlyRateAvg} IS NOT NULL`
      ];
      
      if (surveyMonth) {
        fallbackConditions.push(eq(competitiveSurveyData.surveyMonth, surveyMonth));
      }
      
      const fallbackRecords = await db.select()
        .from(competitiveSurveyData)
        .where(and(...fallbackConditions));
      
      if (fallbackRecords.length === 0) {
        return null;
      }
      
      // Use first available record as fallback
      const record = fallbackRecords[0];
      
      // Convert rates from daily to monthly for HC/SMC competitor types
      const DAYS_PER_MONTH = 30.44;
      const isHCOrSMC = competitorType === 'HC' || competitorType === 'SMC';
      
      let baseRate = record.monthlyRateAvg || 0;
      let careLevel2Rate = record.careLevel2Rate;
      let medicationManagementFee = record.medicationManagementFee;
      
      if (isHCOrSMC && baseRate > 0 && baseRate < 1000) {
        baseRate = baseRate * DAYS_PER_MONTH;
        if (careLevel2Rate && careLevel2Rate < 500) {
          careLevel2Rate = careLevel2Rate * DAYS_PER_MONTH;
        }
        if (medicationManagementFee && medicationManagementFee < 100) {
          medicationManagementFee = medicationManagementFee * DAYS_PER_MONTH;
        }
      }
      
      return {
        competitorName: record.competitorName,
        baseRate,
        weight: extractWeight(record.notes),
        careLevel2Rate,
        medicationManagementFee,
        distanceMiles: record.distanceMiles,
        surveyData: record
      };
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
    
    // Convert rates from daily to monthly for HC/SMC competitor types
    // Survey data for HC and SMC is stored as daily rates
    const DAYS_PER_MONTH = 30.44;
    const isHCOrSMC = competitorType === 'HC' || competitorType === 'SMC';
    
    let baseRate = bestRecord.monthlyRateAvg || 0;
    let careLevel2Rate = bestRecord.careLevel2Rate;
    let medicationManagementFee = bestRecord.medicationManagementFee;
    
    // If HC or SMC and rates look like daily rates (< $1000), convert to monthly
    if (isHCOrSMC && baseRate > 0 && baseRate < 1000) {
      const originalRate = baseRate;
      baseRate = baseRate * DAYS_PER_MONTH;
      
      if (careLevel2Rate && careLevel2Rate < 500) {
        careLevel2Rate = careLevel2Rate * DAYS_PER_MONTH;
      }
      if (medicationManagementFee && medicationManagementFee < 100) {
        medicationManagementFee = medicationManagementFee * DAYS_PER_MONTH;
      }
      
      console.log(`✓ Converted ${competitorType} daily rate $${originalRate.toFixed(2)}/day to $${baseRate.toFixed(2)}/month`);
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
 * Calculate the adjusted competitor rate based on the mapping document logic:
 * 
 * Adjusted Rate = Base Rate + Care Level 2 Adjustment + Medication Management Adjustment
 * 
 * Care Level 2 Adjustment (HC/AL only):
 *   = Competitor Care Level 2 - Trilogy Care Level 2 (default $55/day)
 *   
 * Medication Management Adjustment (AL only):
 *   = Competitor Med Mgmt Fee - Trilogy Med Mgmt Fee ($0)
 *   = Competitor Med Mgmt Fee (since Trilogy is $0)
 */
function calculateAdjustedRate(
  serviceLine: string,
  baseRate: number,
  competitorCareLevel2Rate: number | null,
  competitorMedicationManagementFee: number | null,
  trilogyCareLevel2Rate: number = TRILOGY_CARE_LEVEL_2_DEFAULT
): {
  adjustedRate: number;
  careLevel2Adjustment: number;
  medicationManagementAdjustment: number;
  explanation: string;
} {
  let careLevel2Adjustment = 0;
  let medicationManagementAdjustment = 0;
  const explanationParts: string[] = [];
  
  explanationParts.push(`Base Rate: $${baseRate.toFixed(0)}`);
  
  // Care Level 2 Adjustment (only for HC/AL service lines)
  if (CARE_LEVEL_2_APPLIES[serviceLine]) {
    if (competitorCareLevel2Rate !== null && competitorCareLevel2Rate > 0) {
      // Calculate difference: Competitor - Trilogy
      // A positive value means competitor charges more, so we add it to make comparison fair
      careLevel2Adjustment = competitorCareLevel2Rate - trilogyCareLevel2Rate;
      
      if (careLevel2Adjustment !== 0) {
        explanationParts.push(
          `Care Level 2: Competitor $${competitorCareLevel2Rate.toFixed(0)} - Trilogy $${trilogyCareLevel2Rate.toFixed(0)} = ${careLevel2Adjustment >= 0 ? '+' : ''}$${careLevel2Adjustment.toFixed(0)}`
        );
      } else {
        explanationParts.push(
          `Care Level 2: No adjustment (both $${trilogyCareLevel2Rate.toFixed(0)})`
        );
      }
    } else {
      explanationParts.push(`Care Level 2: No competitor data (Trilogy default $${trilogyCareLevel2Rate})`);
    }
  } else {
    explanationParts.push(`Care Level 2: Does not apply for ${serviceLine}`);
  }
  
  // Medication Management Adjustment (only for AL service lines)
  if (MEDICATION_MGMT_APPLIES[serviceLine]) {
    if (competitorMedicationManagementFee !== null && competitorMedicationManagementFee > 0) {
      // Trilogy doesn't charge for med mgmt ($0), so we add the full competitor fee
      medicationManagementAdjustment = competitorMedicationManagementFee;
      explanationParts.push(
        `Medication Management: Competitor $${competitorMedicationManagementFee.toFixed(0)}, Trilogy $0 = +$${medicationManagementAdjustment.toFixed(0)}`
      );
    } else {
      explanationParts.push(`Medication Management: No adjustment (competitor $0)`);
    }
  } else if (serviceLine === 'HC' || serviceLine === 'HC/MC') {
    explanationParts.push(`Medication Management: Does not apply for ${serviceLine}`);
  } else {
    explanationParts.push(`Medication Management: Does not apply for ${serviceLine}`);
  }
  
  // Calculate adjusted rate
  const adjustedRate = baseRate + careLevel2Adjustment + medicationManagementAdjustment;
  
  explanationParts.push(`Adjusted Rate: $${baseRate.toFixed(0)} + $${careLevel2Adjustment.toFixed(0)} + $${medicationManagementAdjustment.toFixed(0)} = $${adjustedRate.toFixed(0)}`);
  
  return {
    adjustedRate,
    careLevel2Adjustment,
    medicationManagementAdjustment,
    explanation: explanationParts.join('\n')
  };
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
    // Get the best competitor rate for this location, service line, and room type
    const competitorData = await getBestCompetitorRate(
      unit.location,
      unit.serviceLine,
      unit.roomType,
      unit.uploadMonth
    );
    
    if (!competitorData) {
      return result;
    }
    
    result.competitorName = competitorData.competitorName;
    result.competitorBaseRate = competitorData.baseRate;
    result.competitorWeight = competitorData.weight;
    
    // Calculate adjusted rate using the mapping document logic
    const adjustment = calculateAdjustedRate(
      unit.serviceLine,
      competitorData.baseRate,
      competitorData.careLevel2Rate,
      competitorData.medicationManagementFee
    );
    
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
  uploadMonth?: string
): Promise<{
  processed: number;
  updated: number;
  errors: number;
  details: CompetitorRateResult[];
}> {
  const stats = {
    processed: 0,
    updated: 0,
    errors: 0,
    details: [] as CompetitorRateResult[]
  };
  
  try {
    // Get all rent roll units for the specified month (or all if not specified)
    const units = uploadMonth
      ? await db.select().from(rentRollData).where(eq(rentRollData.uploadMonth, uploadMonth))
      : await db.select().from(rentRollData);
    
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
        
        // Update the database with calculated competitor data
        try {
          let adjustmentData: any = {};
          if (result.adjustmentDetails) {
            try {
              adjustmentData = JSON.parse(result.adjustmentDetails);
            } catch (e) {
              console.warn('Failed to parse adjustment details:', e);
            }
          }
          
          await db.update(rentRollData)
            .set({
              competitorRate: result.competitorAdjustedRate,
              competitorFinalRate: result.competitorAdjustedRate,
              competitorName: result.competitorName,
              competitorBaseRate: result.competitorBaseRate,
              competitorWeight: result.competitorWeight,
              competitorCareLevel2Adjustment: result.careLevel2Adjustment || 0,
              competitorMedManagementAdjustment: result.medicationManagementAdjustment || 0,
              competitorAdjustmentExplanation: adjustmentData.explanation || null
            })
            .where(eq(rentRollData.id, result.unitId));
          
          stats.updated++;
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
export async function getCompetitorRateSummary(uploadMonth?: string) {
  try {
    const query = uploadMonth 
      ? db.select({
          location: rentRollData.location,
          serviceLine: rentRollData.serviceLine,
          roomType: rentRollData.roomType,
          avgStreetRate: sql<number>`AVG(${rentRollData.streetRate})`,
          avgCompetitorRate: sql<number>`AVG(${rentRollData.competitorRate})`,
          avgDifference: sql<number>`AVG(${rentRollData.competitorRate} - ${rentRollData.streetRate})`,
          count: sql<number>`COUNT(*)`,
        })
        .from(rentRollData)
        .where(and(
          eq(rentRollData.uploadMonth, uploadMonth),
          sql`${rentRollData.competitorRate} IS NOT NULL`
        ))
        .groupBy(rentRollData.location, rentRollData.serviceLine, rentRollData.roomType)
      : db.select({
          location: rentRollData.location,
          serviceLine: rentRollData.serviceLine,
          roomType: rentRollData.roomType,
          avgStreetRate: sql<number>`AVG(${rentRollData.streetRate})`,
          avgCompetitorRate: sql<number>`AVG(${rentRollData.competitorRate})`,
          avgDifference: sql<number>`AVG(${rentRollData.competitorRate} - ${rentRollData.streetRate})`,
          count: sql<number>`COUNT(*)`,
        })
        .from(rentRollData)
        .where(sql`${rentRollData.competitorRate} IS NOT NULL`)
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
