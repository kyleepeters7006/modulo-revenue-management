import * as fs from 'fs';
import { importCompetitiveSurveyExcel } from './server/dataImport';

async function run() {
  const buffer = fs.readFileSync('./attached_assets/Competitive Survey Data - Updated_1763824864477.xlsx');
  console.log('Final import with FULL debug logging...\n');
  const result = await importCompetitiveSurveyExcel(buffer, '2025-11');
  console.log('\n=== Final Results ===');
  console.log(`Total: ${result.totalRecords}, Success: ${result.successfulImports}, Failed: ${result.failedImports}`);
}
run().catch(console.error).finally(() => process.exit(0));
