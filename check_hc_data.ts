import { db } from './server/db';
import { rentRollData } from './shared/schema';
import { eq, sql } from 'drizzle-orm';

(async () => {
  try {
    // Get count of units by service line
    const serviceLineCounts = await db
      .select({
        serviceLine: rentRollData.serviceLine,
        count: sql<number>`COUNT(*)`.as('count')
      })
      .from(rentRollData)
      .groupBy(rentRollData.serviceLine);
    
    console.log('Service Line Distribution:');
    serviceLineCounts.forEach(row => {
      console.log(`  ${row.serviceLine || 'NULL'}: ${row.count} units`);
    });

    // Check if we have any HC or HC/MC units
    const hasHC = serviceLineCounts.some(row => 
      row.serviceLine === 'HC' || row.serviceLine === 'HC/MC'
    );
    
    if (!hasHC) {
      console.log('\nNo HC or HC/MC units found. Adding test data...');
      
      // Add a few HC test units based on existing AL units
      const sampleALUnits = await db
        .select()
        .from(rentRollData)
        .where(eq(rentRollData.serviceLine, 'AL'))
        .limit(3);
      
      if (sampleALUnits.length > 0) {
        const hcTestUnits = sampleALUnits.map((unit, index) => ({
          ...unit,
          id: crypto.randomUUID(),
          roomNumber: `HC-${100 + index}`,
          serviceLine: 'HC',
          streetRate: 6450,  // Monthly rate (will display as ~$212/day)
          moduloSuggestedRate: 6600,  // Monthly rate (will display as ~$217/day)
          aiSuggestedRate: 6300,  // Monthly rate (will display as ~$207/day)
          competitorFinalRate: 6700,  // Monthly rate (will display as ~$220/day)
        }));
        
        await db.insert(rentRollData).values(hcTestUnits);
        console.log(`Added ${hcTestUnits.length} HC test units.`);
      }
    } else {
      console.log('\nHC units already exist in the database.');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
})();
