import * as fs from 'fs';
import { importCompetitiveSurveyExcel } from './server/dataImport';

async function run() {
  console.log('Starting competitive survey import...');
  const buffer = fs.readFileSync('./attached_assets/Competitive Survey Data - Updated_1763824864477.xlsx');
  const result = await importCompetitiveSurveyExcel(buffer, '2025-11');
  
  console.log('\n=== FINAL RESULTS ===');
  console.log(`Total: ${result.totalRecords}, Success: ${result.successfulImports}, Failed: ${result.failedImports}`);
  if (result.errors.length > 0) {
    console.log(`\nErrors (${result.errors.length}):`);
    result.errors.slice(0, 10).forEach(err => console.log(`  - ${err}`));
  }
}
run().catch(console.error).finally(() => process.exit(0));
