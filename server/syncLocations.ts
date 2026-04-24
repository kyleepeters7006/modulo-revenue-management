import { db } from './db';
import { rentRollData, locations } from '../shared/schema';
import { sql, eq } from 'drizzle-orm';

/**
 * Extract a zero-padded 4-digit location code from a location name string.
 * Matches patterns like "Sylvania KSL-0560" or "KSL-560" → "0560".
 * Returns null if no code pattern is found.
 */
function extractLocationCode(name: string): string | null {
  const match = name.match(/[A-Za-z]+-(\d{3,4})\b/);
  if (!match) return null;
  return match[1].padStart(4, '0');
}

/**
 * Sync locations from rent roll data
 * This ensures the locations table reflects all unique campuses in rent_roll_data
 * OPTIMIZED: Uses batch operations instead of individual queries
 */
export async function syncLocationsFromRentRoll() {
  try {
    const startTime = Date.now();
    console.log('Syncing locations from rent roll data...');
    
    // Get all existing locations in one query
    const existingLocations = await db.select().from(locations);
    const existingLocationMap = new Map(existingLocations.map(loc => [loc.name, loc]));
    
    // Get location names and counts in a single query (MUCH faster)
    const locationStatsResult = await db.execute<{ location: string, count: number }>(
      sql`
        SELECT location, COUNT(*)::int as count 
        FROM ${rentRollData} 
        WHERE location IS NOT NULL AND location != '' 
        GROUP BY location 
        ORDER BY location
      `
    );
    
    const locationStats = locationStatsResult.rows;
    console.log(`Found ${locationStats.length} unique locations in rent roll data`);
    
    let created = 0;
    let updated = 0;
    let codeBackfilled = 0;
    const locationsToCreate: Array<{ name: string; totalUnits: number; locationCode: string | null }> = [];
    const locationsToUpdate: Array<{ id: string; name: string; totalUnits: number }> = [];
    
    // Prepare batch operations
    for (const stat of locationStats) {
      const locationName = stat.location;
      const unitCount = stat.count || 0;
      
      const existing = existingLocationMap.get(locationName);
      
      if (!existing) {
        locationsToCreate.push({
          name: locationName,
          totalUnits: unitCount,
          locationCode: extractLocationCode(locationName)
        });
      } else if (existing.totalUnits !== unitCount) {
        locationsToUpdate.push({
          id: existing.id,
          name: locationName,
          totalUnits: unitCount
        });
      }
    }
    
    // Batch create new locations
    if (locationsToCreate.length > 0) {
      const newLocations = await db.insert(locations)
        .values(locationsToCreate.map(loc => ({
          name: loc.name,
          region: null,
          division: null,
          totalUnits: loc.totalUnits,
          locationCode: loc.locationCode
        })))
        .returning();
      
      created = newLocations.length;
      
      // Update locationId for new locations in batch
      for (const newLoc of newLocations) {
        await db.execute(
          sql`UPDATE ${rentRollData} SET location_id = ${newLoc.id} WHERE location = ${newLoc.name} AND location_id IS NULL`
        );
      }
    }
    
    // Batch update existing locations
    if (locationsToUpdate.length > 0) {
      for (const loc of locationsToUpdate) {
        await db
          .update(locations)
          .set({ 
            totalUnits: loc.totalUnits,
            updatedAt: new Date()
          })
          .where(eq(locations.id, loc.id));
      }
      updated = locationsToUpdate.length;
    }
    
    // Backfill location_code for existing locations that have NULL code but a code pattern in their name
    const nullCodeLocations = existingLocations.filter(loc => !loc.locationCode);
    for (const loc of nullCodeLocations) {
      const code = extractLocationCode(loc.name);
      if (code) {
        await db
          .update(locations)
          .set({ locationCode: code, updatedAt: new Date() })
          .where(eq(locations.id, loc.id));
        codeBackfilled++;
      }
    }
    if (codeBackfilled > 0) {
      console.log(`Backfilled location_code for ${codeBackfilled} existing locations`);
    }

    const duration = Date.now() - startTime;
    console.log(`Location sync complete: ${created} created, ${updated} updated, ${codeBackfilled} codes backfilled in ${duration}ms`);
    
    return {
      success: true,
      created,
      updated,
      codeBackfilled,
      total: locationStats.length
    };
  } catch (error) {
    console.error('Error syncing locations:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}