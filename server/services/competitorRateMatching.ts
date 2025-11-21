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
  HC: {
    'Studio': 'Private',
    'Studio Dlx': 'Private',
    'Companion': 'Semi-Private',
    'One Bedroom': 'Private',
    'Two Bedroom': 'Private',
    'Private': 'Private',
    'Semi-Private': 'Semi-Private'
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
const SERVICE_LINE_MAPPING: Record<string, string> = {
  'AL': 'AL',
  'AL/MC': 'MC',
  'HC': 'SNF',
  'HC/MC': 'SNF',
  'SL': 'IL',
  'VIL': 'IL'
};

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
    
    return {
      competitorName: bestRecord.competitorName,
      baseRate: bestRecord.monthlyRateAvg || 0,
      careFeesAvg: bestRecord.careFeesAvg || 0,
      surveyData: bestRecord
    };
    
  } catch (error) {
    console.error('Error getting best competitor rate:', error);
    return null;
  }
}

/**
 * Get Trilogy's care level 2 rate for a location and service line
 */
async function getTrilogyCareLevel2Rate(
  location: string,
  serviceLine: string
): Promise<number | null> {
  try {
    // This would typically come from your rate card or assumptions table
    // For now, we'll use a standard rate by service line
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
    
    // Get Trilogy's care level 2 rate
    const trilogyCareLevel2 = await getTrilogyCareLevel2Rate(unit.location, unit.serviceLine);
    
    // Calculate adjusted rate using the formula
    // The competitor's care fees are considered as their care level 2 rate
    const adjustmentResult = calculateAdjustedCompetitorRate({
      competitorBaseRate: competitorData.baseRate,
      competitorCareLevel2Rate: competitorData.careFeesAvg,
      competitorMedicationManagementFee: 0, // Not in survey data
      trilogyCareLevel2Rate: trilogyCareLevel2
    });
    
    result.competitorAdjustedRate = adjustmentResult.adjustedRate;
    result.adjustmentDetails = JSON.stringify({
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
