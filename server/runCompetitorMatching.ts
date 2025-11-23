import { processAllUnitsForCompetitorRates } from './services/competitorRateMatching';

async function main() {
  console.log('🚀 Starting competitor rate matching for current month...');
  
  try {
    const result = await processAllUnitsForCompetitorRates('2025-11');
    console.log('✅ Competitor rate matching complete!', result);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
