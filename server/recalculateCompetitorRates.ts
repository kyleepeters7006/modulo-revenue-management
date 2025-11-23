import { db } from './db';
import { rentRollData } from '@shared/schema';
import { calculateCompetitorRateForUnit } from './services/competitorRateMatching';
import { eq } from 'drizzle-orm';

async function recalculateAllCompetitorRates() {
  console.log('🔄 Starting complete competitor rate recalculation...\n');
  
  try {
    // Get all units
    const allUnits = await db.select().from(rentRollData);
    console.log(`📊 Found ${allUnits.length} units to process\n`);
    
    let processed = 0;
    let updated = 0;
    let errors = 0;
    
    // Process in batches of 100
    const batchSize = 100;
    for (let i = 0; i < allUnits.length; i += batchSize) {
      const batch = allUnits.slice(i, Math.min(i + batchSize, allUnits.length));
      
      for (const unit of batch) {
        try {
          // Get the matched competitor data
          const competitorData = await calculateCompetitorRateForUnit(
            unit.location || '',
            unit.serviceLine || '',
            unit.roomType || ''
          );
          
          if (competitorData) {
            // Update the unit with competitor data
            await db.update(rentRollData)
              .set({
                competitorRate: competitorData.finalRate,
                competitorName: competitorData.competitorName,
                competitorBaseRate: competitorData.baseRate,
                competitorWeight: competitorData.weight,
                competitorCareLevel2Adjustment: competitorData.careLevel2Adjustment,
                competitorMedManagementAdjustment: competitorData.medManagementAdjustment,
                competitorAdjustmentExplanation: competitorData.adjustmentExplanation
              })
              .where(eq(rentRollData.id, unit.id));
            
            updated++;
            
            // Log significant updates
            if (competitorData.finalRate > 1000 && processed % 100 === 0) {
              console.log(`✅ Updated ${unit.location} - ${unit.serviceLine} ${unit.roomType}: $${competitorData.finalRate.toFixed(2)}/month`);
            }
          }
          
          processed++;
        } catch (error) {
          errors++;
          console.error(`❌ Error processing unit ${unit.id}:`, error);
        }
      }
      
      // Progress update
      if (processed % 500 === 0) {
        console.log(`\n📈 Progress: ${processed}/${allUnits.length} units processed (${updated} updated, ${errors} errors)`);
      }
    }
    
    console.log('\n✨ Recalculation complete!');
    console.log(`📊 Final stats:`);
    console.log(`   - Total units processed: ${processed}`);
    console.log(`   - Units updated: ${updated}`);
    console.log(`   - Errors: ${errors}`);
    console.log(`   - Success rate: ${((updated / processed) * 100).toFixed(1)}%\n`);
    
    return {
      success: true,
      processed,
      updated,
      errors
    };
  } catch (error) {
    console.error('Fatal error during recalculation:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  recalculateAllCompetitorRates()
    .then(result => {
      console.log('Script completed:', result);
      process.exit(result.success ? 0 : 1);
    })
    .catch(err => {
      console.error('Script failed:', err);
      process.exit(1);
    });
}

export { recalculateAllCompetitorRates };