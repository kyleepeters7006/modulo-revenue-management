/**
 * Competitor Rate Matching Service
 * 
 * This service matches rent roll units to competitors and calculates
 * adjusted competitor rates based on room type, service line, and care levels.
 */

import { db } from "../db";
import { competitors, rentRollData, locations } from "@shared/schema";
import type { Competitor, RentRollData } from "@shared/schema";
import { eq, and, or, sql, desc, asc } from "drizzle-orm";
import { calculateAdjustedCompetitorRate } from "./competitorAdjustments";

// Room type mapping based on service line
const ROOM_TYPE_MAPPING = {
  // Assisted Living (AL) mappings
  AL: {
    'Studio': 'studio',
    'Studio Dlx': 'studio_deluxe',
    'One Bedroom': 'one_bedroom',
    'Two Bedroom': 'two_bedroom',
    'Companion': 'companion'
  },
  // Health Center (HC) mappings
  HC: {
    'Studio': 'private',
    'Studio Dlx': 'private_deluxe',
    'Companion': 'semi_private',
    'One Bedroom': 'private_suite',
    'Two Bedroom': 'private_suite'
  },
  // Senior Living (SL) mappings
  SL: {
    'Studio': 'studio',
    'Studio Dlx': 'studio_deluxe',
    'One Bedroom': 'one_bedroom',
    'Two Bedroom': 'two_bedroom',
    'Companion': 'companion'
  },
  // Village (VIL) mappings
  VIL: {
    'Studio': 'studio',
    'One Bedroom': 'one_bedroom',
    'Two Bedroom': 'two_bedroom',
    'Studio Dlx': 'studio_deluxe',
    'Companion': 'studio'
  },
  // Memory Care variations
  'AL/MC': {
    'Studio': 'memory_care_studio',
    'Studio Dlx': 'memory_care_deluxe',
    'One Bedroom': 'memory_care_suite',
    'Two Bedroom': 'memory_care_suite',
    'Companion': 'memory_care_companion'
  },
  'HC/MC': {
    'Studio': 'memory_care_private',
    'Studio Dlx': 'memory_care_deluxe',
    'Companion': 'memory_care_semi',
    'One Bedroom': 'memory_care_suite',
    'Two Bedroom': 'memory_care_suite'
  }
} as const;

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
 * Get the best competitor for a location based on weight or drive time
 */
async function getBestCompetitorForLocation(
  location: string,
  serviceLine?: string
): Promise<Competitor | null> {
  try {
    // Handle different location formats:
    // rent_roll_data format: "Anderson - 112" 
    // competitor format: "Anderson-Bethany" or "Anderson-112"
    
    // Extract the base location name (before the dash)
    const baseName = location.split(' - ')[0].trim();
    const locationCode = location.split(' - ')[1]?.trim();
    
    // Try multiple matching strategies
    let competitorList: Competitor[] = [];
    
    // First try exact match
    competitorList = await db.select().from(competitors)
      .where(eq(competitors.location, location))
      .orderBy(desc(competitors.weight))
      .limit(10);
    
    // If no exact match, try with location code format (e.g., "Anderson-112")
    if (competitorList.length === 0 && locationCode) {
      const alternateFormat = `${baseName}-${locationCode}`;
      competitorList = await db.select().from(competitors)
        .where(eq(competitors.location, alternateFormat))
        .orderBy(desc(competitors.weight))
        .limit(10);
    }
    
    // If still no match, try base name prefix match
    if (competitorList.length === 0) {
      competitorList = await db.select().from(competitors)
        .where(sql`${competitors.location} LIKE ${baseName + '%'}`)
        .orderBy(desc(competitors.weight))
        .limit(10);
    }
    
    // If service line is specified, filter by it
    if (serviceLine && competitorList.length > 0) {
      // Filter competitors that support this service line
      competitorList = competitorList.filter(comp => {
        const serviceLines = comp.serviceLines as string[] | null;
        if (!serviceLines) return true; // If no service lines specified, include
        return serviceLines.includes(serviceLine);
      });
    }
    
    if (competitorList.length === 0) {
      return null;
    }
    
    // Return the best competitor (highest weight or shortest drive time)
    let bestCompetitor = competitorList[0];
    
    // If the first competitor has no weight, try to find one with drive time
    if (!bestCompetitor.weight) {
      for (const comp of competitorList) {
        // Check if attributes has drive_time_minutes
        const driveTime = (comp.attributes as any)?.drive_time_minutes;
        const bestDriveTime = (bestCompetitor.attributes as any)?.drive_time_minutes;
        
        if (driveTime && (!bestDriveTime || driveTime < bestDriveTime)) {
          bestCompetitor = comp;
        }
      }
    }
    
    return bestCompetitor;
  } catch (error) {
    console.error('Error getting best competitor for location:', error);
    return null;
  }
}

/**
 * Get the competitor rate for a specific room type
 * Handles both column-based and attribute-based storage
 */
function getCompetitorRateForRoomType(
  competitor: Competitor,
  roomType: string,
  mappedRoomType: string,
  serviceLine: string
): number | null {
  // First, try to get room-specific rate from attributes
  const attributes = competitor.attributes as any;
  
  if (attributes) {
    // Check various possible attribute keys for room-specific rates
    const possibleKeys = [
      `${serviceLine.toLowerCase()}_${mappedRoomType}_rate`,
      `${mappedRoomType}_rate`,
      `${roomType.toLowerCase().replace(' ', '_')}_rate`,
      mappedRoomType,
      roomType.toLowerCase()
    ];
    
    for (const key of possibleKeys) {
      if (attributes[key] && typeof attributes[key] === 'number') {
        return attributes[key];
      }
    }
  }
  
  // If no room-specific rate found, use the street_rate as base rate
  return competitor.streetRate;
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
    // Get the best competitor for this location
    const competitor = await getBestCompetitorForLocation(unit.location, unit.serviceLine);
    
    if (!competitor) {
      result.error = 'No competitor found for location';
      return result;
    }
    
    result.competitorName = competitor.name;
    
    // Map the room type based on service line
    const serviceLineKey = unit.serviceLine as keyof typeof ROOM_TYPE_MAPPING;
    const roomTypeMapping = ROOM_TYPE_MAPPING[serviceLineKey];
    
    if (!roomTypeMapping) {
      result.error = `No room type mapping for service line: ${unit.serviceLine}`;
      return result;
    }
    
    const mappedRoomType = roomTypeMapping[unit.roomType as keyof typeof roomTypeMapping];
    
    if (!mappedRoomType) {
      result.error = `No mapping for room type: ${unit.roomType} in service line: ${unit.serviceLine}`;
      return result;
    }
    
    // Get the competitor's base rate for this room type
    const baseRate = getCompetitorRateForRoomType(
      competitor,
      unit.roomType,
      mappedRoomType,
      unit.serviceLine
    );
    
    if (!baseRate) {
      result.error = 'No base rate found for competitor';
      return result;
    }
    
    result.competitorBaseRate = baseRate;
    
    // Get Trilogy's care level 2 rate
    const trilogyCareLevel2 = await getTrilogyCareLevel2Rate(unit.location, unit.serviceLine);
    
    // Calculate adjusted rate using the formula
    const adjustmentResult = calculateAdjustedCompetitorRate({
      competitorBaseRate: baseRate,
      competitorCareLevel2Rate: competitor.careLevel2Rate,
      competitorMedicationManagementFee: competitor.medicationManagementFee,
      trilogyCareLevel2Rate: trilogyCareLevel2
    });
    
    result.competitorAdjustedRate = adjustmentResult.adjustedRate;
    result.adjustmentDetails = JSON.stringify({
      baseRate: adjustmentResult.baseRate,
      careLevel2Adjustment: adjustmentResult.careLevel2Adjustment,
      medicationManagementAdjustment: adjustmentResult.medicationManagementAdjustment,
      explanation: adjustmentResult.explanation,
      competitorWeight: competitor.weight,
      competitorDriveTime: (competitor.attributes as any)?.drive_time_minutes
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
    let query = db.select().from(rentRollData);
    
    if (uploadMonth) {
      query = query.where(eq(rentRollData.uploadMonth, uploadMonth));
    }
    
    const units = await query;
    
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
        } else if (result.competitorAdjustedRate !== null) {
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
                competitorName: result.competitorName || null,
                competitorBaseRate: result.competitorBaseRate || null,
                competitorWeight: adjustmentData.competitorWeight || null,
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