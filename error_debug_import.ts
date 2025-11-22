import * as fs from 'fs';
import { importCompetitiveSurveyExcel } from './server/dataImport';

async function run() {
  console.log('=== IMPORT WITH ERROR DEBUGGING ===\n');
  const buffer = fs.readFileSync('./attached_assets/Competitive Survey Data - Updated_1763824864477.xlsx');
  const result = await importCompetitiveSurveyExcel(buffer, '2025-11');
  console.log('\n=== RESULTS ===');
  console.log(`Total: ${result.totalRecords}, Success: ${result.successfulImports}, Failed: ${result.failedImports}`);
  if (result.errors.length > 0) {
    console.log('\nErrors:');
    result.errors.forEach(e => console.log(`  - ${e}`));
  }
}
run().catch(err => {
  console.error('\n!!! FATAL ERROR !!!');
  console.error(err);
  process.exit(1);
}).finally(() => process.exit(0));
