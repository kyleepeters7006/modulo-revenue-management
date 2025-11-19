import { db } from './server/db';
import { enquireData, locations } from './shared/schema';
import { sql, eq } from 'drizzle-orm';

async function mapEnquireLocations() {
  console.log('Fetching locations and enquire data...');
  
  const allLocations = await db.select().from(locations);
  const enquireRecords = await db.execute(sql`
    SELECT DISTINCT enquire_location, data_source 
    FROM enquire_data 
    WHERE mapped_location_id IS NULL
  `);
  
  console.log(`Found ${allLocations.length} Trilogy locations`);
  console.log(`Found ${enquireRecords.rows.length} unique unmapped enquire locations`);
  
  let mapped = 0;
  let unmapped = 0;
  
  for (const record of enquireRecords.rows as any[]) {
    const enquireLoc = record.enquire_location;
    
    if (enquireLoc === 'Unknown') {
      unmapped++;
      continue;
    }
    
    // Try to find matching location by fuzzy name match
    // Remove "SL", "SM", "WS" suffixes and try to match
    const cleanedName = enquireLoc
      .replace(/ SL$/, '')
      .replace(/ SM$/, '')
      .replace(/ WS$/, '')
      .trim();
    
    const matchedLocation = allLocations.find(loc => {
      const locName = loc.name.toLowerCase();
      const searchName = cleanedName.toLowerCase();
      
      // Exact match
      if (locName === searchName) return true;
      
      // Contains match
      if (locName.includes(searchName) || searchName.includes(locName)) return true;
      
      // Check if location name contains any word from enquire location
      const words = searchName.split(' ');
      return words.length > 1 && words.every(word => word.length > 2 && locName.includes(word));
    });
    
    if (matchedLocation) {
      // Update all records with this enquire_location
      await db.execute(sql`
        UPDATE enquire_data 
        SET mapped_location_id = ${matchedLocation.id}
        WHERE enquire_location = ${enquireLoc}
      `);
      
      mapped++;
      console.log(`✓ Mapped "${enquireLoc}" → ${matchedLocation.name}`);
    } else {
      unmapped++;
      if (unmapped <= 10) {
        console.log(`✗ No match for "${enquireLoc}"`);
      }
    }
  }
  
  console.log(`\n✅ Mapped ${mapped} locations | ${unmapped} unmapped`);
  
  // Show mapping summary
  const summary = await db.execute(sql`
    SELECT 
      data_source,
      COUNT(*) as total_records,
      COUNT(mapped_location_id) as mapped_records,
      COUNT(DISTINCT enquire_location) as unique_locations
    FROM enquire_data
    GROUP BY data_source
  `);
  
  console.log('\nMapping Summary:');
  for (const row of summary.rows as any[]) {
    console.log(`  ${row.data_source}:`);
    console.log(`    Total records: ${row.total_records}`);
    console.log(`    Mapped records: ${row.mapped_records} (${Math.round(row.mapped_records/row.total_records*100)}%)`);
    console.log(`    Unique locations: ${row.unique_locations}`);
  }
}

mapEnquireLocations().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
