/**
 * Competitor Rate Matching Service
 * 
 * This service matches rent roll units to competitors from the competitive_survey_data table
 * and calculates adjusted competitor rates based on room type, service line, and care levels.
 */

import { db } from "../db";
import { competitiveSurveyData, rentRollData, locations } from "@shared/schema";
import type { CompetitiveSurveyData, RentRollData } from "@shared/schema";
import { eq, and, or, sql, desc, asc } from "drizzle-orm";
import { calculateAdjustedCompetitorRate } from "./competitorAdjustments";

// Room type mapping: Maps Trilogy room types to competitive survey room types
// Note: Using full names to match the actual survey data format
const ROOM_TYPE_MAPPING = {
  // Assisted Living (AL) mappings
  AL: {
    'Studio': 'Studio',
    'Studio Dlx': 'Studio',
    'One Bedroom': 'One Bedroom',
    'Two Bedroom': 'Two Bedroom',
    'Companion': 'Studio',
    'Studio 300 SQ FT': 'Studio',
    'Legacy Bldng - Private': 'Studio',
    'Private': 'Studio'
  },
  // Health Center (HC) mappings
  // Survey data has: Studio, Companion, Studio Dlx
  HC: {
    'Studio': 'Studio',
    'Studio Dlx': 'Studio Dlx',
    'Companion': 'Companion',
    'One Bedroom': 'Studio',
    'Two Bedroom': 'Studio',
    'Private': 'Studio',
    'Semi-Private': 'Companion'
  },
  // Senior Living (SL) mappings
  SL: {
    'Studio': 'Studio',
    'Studio Dlx': 'Studio',
    'One Bedroom': 'One Bedroom',
    'Two Bedroom': 'Two Bedroom',
    'Companion': 'Studio'
  },
  // Village (VIL) mappings
  VIL: {
    'Studio': 'Studio',
    'One Bedroom': 'One Bedroom',
    'Two Bedroom': 'Two Bedroom',
    'Studio Dlx': 'Studio',
    'Companion': 'Studio',
    'Independent Living - Villa': 'Two Bedroom',
    'Villa': 'Two Bedroom'
  },
  // Memory Care variations
  'AL/MC': {
    'Studio': 'Studio',
    'Studio Dlx': 'Studio',
    'One Bedroom': 'One Bedroom',
    'Two Bedroom': 'Two Bedroom',
    'Companion': 'Studio'
  },
  'HC/MC': {
    'Studio': 'Private',
    'Studio Dlx': 'Private',
    'Companion': 'Semi-Private',
    'One Bedroom': 'Private',
    'Two Bedroom': 'Private'
  }
} as const;

// Service line mapping: Maps Trilogy service lines to competitive survey types
// Based on actual competitor_type values in competitive_survey_data: 'HC' and 'SMC'
const SERVICE_LINE_MAPPING: Record<string, string> = {
  'AL': 'AL',      // No AL data in current survey
  'AL/MC': 'SMC',  // Skilled Memory Care
  'HC': 'HC',      // Health Center (was incorrectly mapped to 'SNF')
  'HC/MC': 'SMC',  // Skilled Memory Care
  'SL': 'IL',      // No IL data in current survey
  'VIL': 'IL'      // No IL data in current survey
};

/**
 * Validate if a rate is reasonable for the given service line
 * @param serviceLine - The service line (AL, HC, SL, etc.)
 * @param monthlyRate - The monthly rate to validate
 * @param wasConvertedFromDaily - Whether the rate was converted from daily
 * @returns true if the rate is reasonable, false if suspicious
 */
function validateRateReasonability(
  serviceLine: string,
  monthlyRate: number,
  wasConvertedFromDaily: boolean = false
): boolean {
  // Define reasonable ranges for monthly rates by service line
  const monthlyRateRanges: Record<string, { min: number; max: number; typical: string }> = {
    'AL': { min: 2000, max: 12000, typical: '$3000-$7000' },
    'HC': { min: 4000, max: 20000, typical: '$6000-$12000' },
    'SMC': { min: 5000, max: 20000, typical: '$7000-$13000' },
    'SL': { min: 2500, max: 10000, typical: '$3500-$6500' },
    'IL': { min: 2000, max: 8000, typical: '$2500-$5500' },
    'VIL': { min: 2000, max: 10000, typical: '$3000-$7000' }
  };
  
  const range = monthlyRateRanges[serviceLine];
  if (!range) {
    console.warn(`⚠️  Unknown service line for rate validation: ${serviceLine}`);
    return true; // Don't flag unknown service lines
  }
  
  if (monthlyRate < range.min) {
    console.warn(
      `⚠️  RATE TOO LOW: ${serviceLine} monthly rate $${monthlyRate.toFixed(2)} is below minimum $${range.min}. ` +
      `Typical range: ${range.typical}. ${wasConvertedFromDaily ? '(Converted from daily)' : '(Stored as monthly)'}`
    );
    return false;
  }
  
  if (monthlyRate > range.max) {
    console.warn(
      `⚠️  RATE TOO HIGH: ${serviceLine} monthly rate $${monthlyRate.toFixed(2)} exceeds maximum $${range.max}. ` +
      `Typical range: ${range.typical}. ${wasConvertedFromDaily ? '(Converted from daily)' : '(Stored as monthly)'}`
    );
    return false;
  }
  
  return true;
}

interface CompetitorRateResult {
  unitId: string;
  location: string;
  roomNumber: string;
  roomType: string;
  serviceLine: string;
  competitorName: string | null;
  competitorBaseRate: number | null;
  competitorAdjustedRate: number | null;
  adjustmentDetails: string | null;
  error?: string;
}

/**
 * Get the best competitor rate for a location, service line, and room type
 * from the competitive_survey_data table
 */
async function getBestCompetitorRate(
  location: string,
  serviceLine: string,
  roomType: string,
  surveyMonth?: string
): Promise<{
  competitorName: string;
  baseRate: number;
  careFeesAvg: number;
  careLevel1Rate: number | null;
  careLevel2Rate: number | null;
  careLevel3Rate: number | null;
  careLevel4Rate: number | null;
  medicationManagementFee: number | null;
  surveyData: CompetitiveSurveyData;
} | null> {
  try {
    // Map the Trilogy room type to survey room type
    const serviceLineKey = serviceLine as keyof typeof ROOM_TYPE_MAPPING;
    const roomTypeMapping = ROOM_TYPE_MAPPING[serviceLineKey];
    
    if (!roomTypeMapping) {
      console.warn(`No room type mapping for service line: ${serviceLine}`);
      return null;
    }
    
    const mappedRoomType = roomTypeMapping[roomType as keyof typeof roomTypeMapping];
    
    if (!mappedRoomType) {
      console.warn(`No mapping for room type: ${roomType} in service line: ${serviceLine}`);
      return null;
    }
    
    // Map the service line to competitor type
    const competitorType = SERVICE_LINE_MAPPING[serviceLine];
    
    // Build query conditions
    const conditions: any[] = [
      eq(competitiveSurveyData.keyStatsLocation, location),
      eq(competitiveSurveyData.roomType, mappedRoomType),
      sql`${competitiveSurveyData.monthlyRateAvg} IS NOT NULL`
    ];
    
    // Add survey month filter if provided
    if (surveyMonth) {
      conditions.push(eq(competitiveSurveyData.surveyMonth, surveyMonth));
    }
    
    // Add competitor type filter if available
    if (competitorType) {
      conditions.push(eq(competitiveSurveyData.competitorType, competitorType));
    }
    
    // Query competitive survey data for this location
    const surveyRecords = await db.select()
      .from(competitiveSurveyData)
      .where(and(...conditions));
    
    if (surveyRecords.length === 0) {
      return null;
    }
    
    // Find the best competitor (closest distance or highest rate)
    // Prioritize by distance if available
    let bestRecord = surveyRecords[0];
    
    for (const record of surveyRecords) {
      if (record.distanceMiles && bestRecord.distanceMiles) {
        if (record.distanceMiles < bestRecord.distanceMiles) {
          bestRecord = record;
        }
      } else if (record.monthlyRateAvg && bestRecord.monthlyRateAvg) {
        // If no distance, use the highest rate as a proxy for quality
        if (record.monthlyRateAvg > bestRecord.monthlyRateAvg) {
          bestRecord = record;
        }
      }
    }
    
    // Convert daily rates to monthly rates for HC service lines
    // HC competitor data is stored as daily rates, not monthly
    let baseRate = bestRecord.monthlyRateAvg || 0;
    let careFeesAvg = bestRecord.careFeesAvg || 0;
    let careLevel1Rate = bestRecord.careLevel1Rate;
    let careLevel2Rate = bestRecord.careLevel2Rate;
    let careLevel3Rate = bestRecord.careLevel3Rate;
    let careLevel4Rate = bestRecord.careLevel4Rate;
    let medicationManagementFee = bestRecord.medicationManagementFee;
    
    // Check if rates need to be converted from daily to monthly
    // HC and SMC rates are typically stored as daily rates
    // AL rates under $500 are also likely daily rates that need conversion
    const daysPerMonth = 30.44; // Average days per month
    let isConvertedFromDaily = false;
    
    if (competitorType === 'HC' || competitorType === 'SMC') {
      // HC and SMC rates below $1000 are daily rates
      if (baseRate > 0 && baseRate < 1000) {
        isConvertedFromDaily = true;
        const originalRate = baseRate;
        baseRate = baseRate * daysPerMonth;
        
        // Convert care level rates if they exist
        if (careFeesAvg) careFeesAvg = careFeesAvg * daysPerMonth;
        if (careLevel1Rate) careLevel1Rate = careLevel1Rate * daysPerMonth;
        if (careLevel2Rate) careLevel2Rate = careLevel2Rate * daysPerMonth;
        if (careLevel3Rate) careLevel3Rate = careLevel3Rate * daysPerMonth;
        if (careLevel4Rate) careLevel4Rate = careLevel4Rate * daysPerMonth;
        if (medicationManagementFee) medicationManagementFee = medicationManagementFee * daysPerMonth;
        
        console.log(`✓ Converted ${competitorType} daily rate $${originalRate.toFixed(2)}/day to $${baseRate.toFixed(2)}/month for ${bestRecord.competitorName}`);
      }
    } else if (competitorType === 'AL' || competitorType === 'SL' || competitorType === 'VIL' || competitorType === 'IL') {
      // AL/SL/VIL/IL rates under $500 are clearly daily rates (monthly AL should be $2000+)
      if (baseRate > 0 && baseRate < 500) {
        isConvertedFromDaily = true;
        const originalRate = baseRate;
        baseRate = baseRate * daysPerMonth;
        
        // Convert care level rates if they exist (only if they're also suspiciously low)
        if (careFeesAvg && careFeesAvg < 500) careFeesAvg = careFeesAvg * daysPerMonth;
        if (careLevel1Rate && careLevel1Rate < 500) careLevel1Rate = careLevel1Rate * daysPerMonth;
        if (careLevel2Rate && careLevel2Rate < 500) careLevel2Rate = careLevel2Rate * daysPerMonth;
        if (careLevel3Rate && careLevel3Rate < 500) careLevel3Rate = careLevel3Rate * daysPerMonth;
        if (careLevel4Rate && careLevel4Rate < 500) careLevel4Rate = careLevel4Rate * daysPerMonth;
        if (medicationManagementFee && medicationManagementFee < 100) medicationManagementFee = medicationManagementFee * daysPerMonth;
        
        console.log(`⚠️  WARNING: Converting suspiciously low ${competitorType} rate $${originalRate.toFixed(2)}/day to $${baseRate.toFixed(2)}/month for ${bestRecord.competitorName}`);
      }
    }
    
    // Validate the final rate is reasonable
    if (baseRate > 0) {
      const isReasonable = validateRateReasonability(competitorType || 'Unknown', baseRate, isConvertedFromDaily);
      if (!isReasonable) {
        console.warn(`⚠️  Suspicious rate for ${bestRecord.competitorName} at ${location}: ${competitorType} ${mappedRoomType} = $${baseRate.toFixed(2)}/month`);
      }
    }
    
    return {
      competitorName: bestRecord.competitorName,
      baseRate,
      careFeesAvg,
      careLevel1Rate,
      careLevel2Rate,
      careLevel3Rate,
      careLevel4Rate,
      medicationManagementFee,
      surveyData: bestRecord
    };
    
  } catch (error) {
    console.error('Error getting best competitor rate:', error);
    return null;
  }
}

/**
 * Get Trilogy's care level 2 rate for a location and service line from actual rent roll data
 */
async function getTrilogyCareLevel2Rate(
  location: string,
  serviceLine: string,
  uploadMonth?: string
): Promise<number | null> {
  try {
    // Get actual care rates from rent roll data for this location and service line
    const conditions: any[] = [
      eq(rentRollData.location, location),
      eq(rentRollData.serviceLine, serviceLine),
      sql`${rentRollData.careRate} IS NOT NULL`,
      sql`${rentRollData.careRate} > 0`
    ];
    
    if (uploadMonth) {
      conditions.push(eq(rentRollData.uploadMonth, uploadMonth));
    }
    
    const careRates = await db.select({ careRate: rentRollData.careRate })
      .from(rentRollData)
      .where(and(...conditions))
      .limit(10);
    
    if (careRates.length > 0) {
      // Calculate average care rate from actual data
      const avgCareRate = careRates.reduce((sum, r) => sum + (r.careRate || 0), 0) / careRates.length;
      return avgCareRate;
    }
    
    // Fallback to standard rates if no data available
    const standardRates: Record<string, number> = {
      'AL': 500,
      'AL/MC': 750,
      'HC': 800,
      'HC/MC': 950,
      'SL': 300,
      'VIL': 200
    };
    
    return standardRates[serviceLine] || null;
  } catch (error) {
    console.error('Error getting Trilogy care level 2 rate:', error);
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
    competitorAdjustedRate: null,
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
      // No competitor data is a normal case, not an error
      // Just return the result with null values
      return result;
    }
    
    result.competitorName = competitorData.competitorName;
    result.competitorBaseRate = competitorData.baseRate;
    
    // Get Trilogy's care level 2 rate from actual rent roll data
    const trilogyCareLevel2 = await getTrilogyCareLevel2Rate(unit.location, unit.serviceLine, unit.uploadMonth);
    
    // Calculate adjusted rate using the 4-level care formula with actual competitor data
    const adjustmentResult = calculateAdjustedCompetitorRate({
      competitorBaseRate: competitorData.baseRate,
      competitorCareLevel1Rate: competitorData.careLevel1Rate,
      competitorCareLevel2Rate: competitorData.careLevel2Rate,
      competitorCareLevel3Rate: competitorData.careLevel3Rate,
      competitorCareLevel4Rate: competitorData.careLevel4Rate,
      competitorMedicationManagementFee: competitorData.medicationManagementFee,
      trilogyCareLevel2Rate: trilogyCareLevel2
    });
    
    result.competitorAdjustedRate = adjustmentResult.adjustedRate;
    result.adjustmentDetails = JSON.stringify({
      normalizedRate: adjustmentResult.normalizedRate,
      baseRate: adjustmentResult.baseRate,
      careLevel2Adjustment: adjustmentResult.careLevel2Adjustment,
      medicationManagementAdjustment: adjustmentResult.medicationManagementAdjustment,
      explanation: adjustmentResult.explanation,
      competitorDistance: competitorData.surveyData.distanceMiles,
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
        
        // Only count as error if there was an actual exception (not just missing data)
        if (result.error) {
          stats.errors++;
          console.warn(`Error for unit ${result.roomNumber}: ${result.error}`);
          continue; // Skip database update if there was an error
        } 
        
        // Always update the database, even if competitor data is null
        // This ensures we clear stale data when no competitor match exists
        try {
          // Parse adjustment details if available
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
              // Detailed competitor information for dialog display
              competitorName: result.competitorName,
              competitorBaseRate: result.competitorBaseRate,
              competitorWeight: null, // Not in survey data
              competitorCareLevel2Adjustment: adjustmentData.careLevel2Adjustment || 0,
              competitorMedManagementAdjustment: adjustmentData.medicationManagementAdjustment || 0,
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
