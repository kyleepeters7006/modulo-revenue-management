import * as fs from 'fs';
import { importCompetitiveSurveyExcel } from './server/dataImport';

async function run() {
  console.log('=== FINAL DEBUG IMPORT ===\n');
  const buffer = fs.readFileSync('./attached_assets/Competitive Survey Data - Updated_1763824864477.xlsx');
  const result = await importCompetitiveSurveyExcel(buffer, '2025-11');
  console.log('\n=== IMPORT COMPLETE ===');
  console.log(`Total: ${result.totalRecords}, Imported: ${result.successfulImports}, Failed: ${result.failedImports}`);
}
run().catch(err => {
  console.error('Import error:', err);
  process.exit(1);
}).finally(() => process.exit(0));
