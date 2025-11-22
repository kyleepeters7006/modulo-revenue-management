import { processAllUnitsForCompetitorRates } from './server/services/competitorRateMatching';

async function run() {
  const uploadMonth = '2025-11'; // Current month
  
  console.log(`Starting competitor rate matching for ${uploadMonth} units...\n`);
  const result = await processAllUnitsForCompetitorRates(uploadMonth);
  
  console.log('\n=== MATCHING RESULTS ===');
  console.log(`Total units processed: ${result.processed}`);
  console.log(`Units updated: ${result.updated}`);
  console.log(`Errors: ${result.errors}`);
  console.log(`\nFirst 10 matches:`);
  result.details.slice(0, 10).forEach((d, i) => {
    if (d.competitorName) {
      console.log(`  ${i+1}. Unit ${d.roomNumber}: ${d.competitorName} - $${d.competitorAdjustedRate}`);
    }
  });
}

run().catch(console.error).finally(() => process.exit(0));
