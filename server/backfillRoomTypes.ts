import { db } from "./db";
import { rentRollData, rentRollHistory } from "@shared/schema";
import { normalizeRoomType } from "@shared/roomTypes";
import { sql } from "drizzle-orm";

/**
 * Backfill script to normalize all existing room types in the database
 * This ensures all historical data uses the 5 standardized room types
 */
export async function backfillRoomTypes() {
  console.log('Starting room type normalization backfill...');
  
  const startTime = Date.now();
  let totalUpdated = 0;
  let totalErrors = 0;
  
  try {
    // Start a transaction for safety
    await db.transaction(async (tx) => {
      // Step 1: Backfill rent_roll_data table.
      //
      // Re-derive room_type from source_room_type (the raw string captured at
      // import) whenever it is present. Normalizing the already-normalized
      // room_type is NOT enough: an earlier version of the normalizer keyed on
      // occupancy style, so e.g. "One BR Apt-Double" was collapsed into
      // "Companion" — information that only the source string can recover.
      console.log('Normalizing room types in rent_roll_data table...');

      const uniqueSourceTypes = await tx
        .selectDistinct({ sourceRoomType: rentRollData.sourceRoomType })
        .from(rentRollData);

      console.log(`Found ${uniqueSourceTypes.length} unique source room types in rent_roll_data`);

      // Build the full source -> normalized mapping in memory, then apply it in
      // ONE set-based UPDATE. A per-type UPDATE loop sequential-scans the large
      // table once per type (~500 scans) and took tens of minutes at startup.
      const mappingPairs: [string, string][] = [];
      for (const { sourceRoomType } of uniqueSourceTypes) {
        if (!sourceRoomType) continue;
        mappingPairs.push([sourceRoomType, normalizeRoomType(sourceRoomType)]);
      }

      if (mappingPairs.length > 0) {
        // Drizzle cannot bind JS arrays as text[] params (it serializes them as
        // a record), so ship the mapping as a single JSONB parameter instead.
        const mappingJson = JSON.stringify(mappingPairs);
        const result = await tx.execute(sql`
          UPDATE rent_roll_data rr
          SET room_type = m.target
          FROM (
            SELECT e->>0 AS source, e->>1 AS target
            FROM jsonb_array_elements(${mappingJson}::jsonb) e
          ) m
          WHERE rr.source_room_type = m.source
            AND rr.room_type IS DISTINCT FROM m.target
        `);
        const updatedRows = Number((result as any)?.rowCount ?? 0);
        console.log(`  Source-derived normalization updated ${updatedRows} rows across ${mappingPairs.length} source types`);
        if (updatedRows > 0) totalUpdated += updatedRows;
      }

      // Rows without a source_room_type (older imports) can only be re-normalized
      // from the stored room_type — a no-op for already-standard values.
      const uniqueRoomTypes = await tx
        .selectDistinct({ roomType: rentRollData.roomType })
        .from(rentRollData)
        .where(sql`${rentRollData.sourceRoomType} IS NULL OR ${rentRollData.sourceRoomType} = ''`);

      for (const { roomType } of uniqueRoomTypes) {
        if (!roomType) continue;

        const normalizedType = normalizeRoomType(roomType);

        if (normalizedType !== roomType) {
          try {
            await tx
              .update(rentRollData)
              .set({ roomType: normalizedType })
              .where(sql`${rentRollData.roomType} = ${roomType} AND (${rentRollData.sourceRoomType} IS NULL OR ${rentRollData.sourceRoomType} = '')`);

            console.log(`  Updated (no source) "${roomType}" -> "${normalizedType}"`);
            totalUpdated++;
          } catch (error) {
            console.error(`  Error updating room type "${roomType}":`, error);
            totalErrors++;
          }
        }
      }
      
      // Step 2: Backfill rent_roll_history table
      console.log('\nNormalizing room types in rent_roll_history table...');
      
      const uniqueHistoryRoomTypes = await tx
        .selectDistinct({ roomType: rentRollHistory.roomType })
        .from(rentRollHistory);
      
      console.log(`Found ${uniqueHistoryRoomTypes.length} unique room types in rent_roll_history`);
      
      // Process each unique room type in history
      for (const { roomType } of uniqueHistoryRoomTypes) {
        if (!roomType) continue;
        
        const normalizedType = normalizeRoomType(roomType);
        
        // Only update if the normalized type is different
        if (normalizedType !== roomType) {
          try {
            const result = await tx
              .update(rentRollHistory)
              .set({ roomType: normalizedType })
              .where(sql`${rentRollHistory.roomType} = ${roomType}`);
            
            console.log(`  Updated history "${roomType}" -> "${normalizedType}"`);
            totalUpdated++;
          } catch (error) {
            console.error(`  Error updating history room type "${roomType}":`, error);
            totalErrors++;
          }
        }
      }
      
      console.log('\n--- Backfill Complete ---');
      console.log(`Total room types updated: ${totalUpdated}`);
      console.log(`Total errors: ${totalErrors}`);
      console.log(`Time taken: ${(Date.now() - startTime) / 1000}s`);
      
      // Verify the results - show final unique room types
      const finalRoomTypes = await tx
        .selectDistinct({ roomType: rentRollData.roomType })
        .from(rentRollData);
      
      console.log('\nFinal standardized room types in database:');
      const uniqueFinalTypes = [...new Set(finalRoomTypes.map(r => r.roomType))].sort();
      uniqueFinalTypes.forEach(type => {
        console.log(`  - ${type}`);
      });
    });
    
    return {
      success: true,
      totalUpdated,
      totalErrors,
      duration: Date.now() - startTime
    };
    
  } catch (error) {
    console.error('Fatal error during room type backfill:', error);
    return {
      success: false,
      totalUpdated,
      totalErrors,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Analyze current room types without making changes
 * Useful for understanding what needs to be normalized
 */
export async function analyzeRoomTypes() {
  console.log('Analyzing current room types in database...');
  
  try {
    // Get all unique room types from rent_roll_data
    const rentRollTypes = await db
      .selectDistinct({ roomType: rentRollData.roomType })
      .from(rentRollData);
    
    // Get all unique room types from rent_roll_history
    const historyTypes = await db
      .selectDistinct({ roomType: rentRollHistory.roomType })
      .from(rentRollHistory);
    
    // Combine and deduplicate
    const allTypes = [...new Set([
      ...rentRollTypes.map(r => r.roomType),
      ...historyTypes.map(r => r.roomType)
    ])].filter(Boolean).sort();
    
    console.log('\n--- Room Type Analysis ---');
    console.log(`Total unique room types found: ${allTypes.length}\n`);
    
    // Show mapping for each type
    console.log('Current -> Normalized mapping:');
    allTypes.forEach(type => {
      const normalized = normalizeRoomType(type);
      const symbol = normalized !== type ? '→' : '✓';
      console.log(`  ${symbol} "${type}" ${symbol === '→' ? `-> "${normalized}"` : '(already normalized)'}`);
    });
    
    // Summary of normalized distribution
    const normalizedCounts: Record<string, number> = {};
    allTypes.forEach(type => {
      const normalized = normalizeRoomType(type);
      normalizedCounts[normalized] = (normalizedCounts[normalized] || 0) + 1;
    });
    
    console.log('\nDistribution after normalization:');
    Object.entries(normalizedCounts).forEach(([type, count]) => {
      console.log(`  ${type}: ${count} variations`);
    });
    
    return {
      totalTypes: allTypes.length,
      types: allTypes,
      normalizedDistribution: normalizedCounts
    };
    
  } catch (error) {
    console.error('Error analyzing room types:', error);
    throw error;
  }
}

