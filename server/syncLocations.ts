import { db } from './db';
import { rentRollData, locations } from '../shared/schema';
import { sql, eq } from 'drizzle-orm';

/**
 * Sync locations from rent roll data
 * This ensures the locations table reflects all unique campuses in rent_roll_data
 */
export async function syncLocationsFromRentRoll() {
  try {
    console.log('Syncing locations from rent roll data...');
    
    // Get all unique locations from rent_roll_data using raw SQL
    const uniqueLocationsResult = await db.execute<{ location: string }>(
      sql`SELECT DISTINCT location FROM ${rentRollData} WHERE location IS NOT NULL AND location != '' ORDER BY location`
    );
    
    const uniqueLocations = uniqueLocationsResult.rows;
    console.log(`Found ${uniqueLocations.length} unique locations in rent roll data`);
    
    let created = 0;
    let updated = 0;
    
    for (const row of uniqueLocations) {
      const locationName = row.location;
      if (!locationName) continue;
      
      // Check if location already exists
      const existing = await db
        .select()
        .from(locations)
        .where(eq(locations.name, locationName))
        .limit(1);
      
      // Count units for this location
      const unitCountResult = await db.execute<{ count: number }>(
        sql`SELECT COUNT(*)::int as count FROM ${rentRollData} WHERE location = ${locationName}`
      );
      const unitCount = unitCountResult.rows[0]?.count || 0;
      
      if (existing.length === 0) {
        // Create new location
        await db.insert(locations).values({
          name: locationName,
          region: null,
          division: null,
          totalUnits: unitCount
        });
        created++;
        console.log(`Created location: ${locationName} (${unitCount} units)`);
      } else {
        // Update unit count
        await db
          .update(locations)
          .set({ 
            totalUnits: unitCount,
            updatedAt: new Date()
          })
          .where(eq(locations.id, existing[0].id));
        updated++;
      }
    }
    
    console.log(`Location sync complete: ${created} created, ${updated} updated`);
    
    return {
      success: true,
      created,
      updated,
      total: uniqueLocations.length
    };
  } catch (error) {
    console.error('Error syncing locations:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}