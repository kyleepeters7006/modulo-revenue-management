import * as fs from 'fs';
import { importCompetitiveSurveyExcel } from './server/dataImport';

async function run() {
  const buffer = fs.readFileSync('./attached_assets/Competitive Survey Data - Updated_1763824864477.xlsx');
  const result = await importCompetitiveSurveyExcel(buffer, '2025-11');
  
  console.log('\n=== IMPORT RESULTS ===');
  console.log(`Total: ${result.totalRecords}`);
  console.log(`Success: ${result.successfulImports}`);
  console.log(`Failed: ${result.failedImports}`);
  console.log(`\nErrors (${result.errors.length}):`);
  if (result.errors.length > 0) {
    result.errors.slice(0, 20).forEach(err => console.log(`  - ${err}`));
    if (result.errors.length > 20) {
      console.log(`  ... and ${result.errors.length - 20} more errors`);
    }
  } else {
    console.log('  No errors!');
  }
}
run().catch(console.error).finally(() => process.exit(0));
