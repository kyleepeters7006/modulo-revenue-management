import { db } from './server/db';
import { competitors, locations } from './shared/schema';
import { findNearestLocation } from './server/geocoding';

async function updateExistingCompetitors() {
  console.log('Fetching existing competitors and locations...');
  
  const allCompetitors = await db.select().from(competitors);
  const allLocations = await db.select().from(locations);
  
  console.log(`Found ${allCompetitors.length} competitors and ${allLocations.length} locations`);
  
  let updated = 0;
  
  for (const competitor of allCompetitors) {
    if (!competitor.lat || !competitor.lng) {
      console.log(`Skipping ${competitor.name} - no coordinates`);
      continue;
    }
    
    // Find nearest Trilogy location
    const nearest = findNearestLocation(
      competitor.lat,
      competitor.lng,
      allLocations.filter(loc => loc.lat && loc.lng).map(loc => ({
        name: loc.name,
        lat: loc.lat!,
        lng: loc.lng!
      }))
    );
    
    if (nearest) {
      // Update competitor with nearest location info
      const updatedAttributes = {
        ...(competitor.attributes as any || {}),
        nearestTrilogyLocation: nearest.name,
        distanceToNearest: nearest.distance
      };
      
      await db.update(competitors)
        .set({ attributes: updatedAttributes })
        .where(sql`id = ${competitor.id}`);
      
      updated++;
      if (updated % 25 === 0) {
        console.log(`Updated ${updated} competitors...`);
      }
    }
  }
  
  console.log(`✅ Updated ${updated} competitors with nearest Trilogy location data`);
}

import { sql } from 'drizzle-orm';
updateExistingCompetitors().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
