import * as fs from 'fs';
import { importCompetitiveSurveyCSV } from './server/dataImport';

async function run() {
  console.log('=== CSV IMPORT TEST ===\n');
  const buffer = fs.readFileSync('./attached_assets/Competitive Survey Data - Updated_1763827532769.csv');
  console.log(`File size: ${buffer.length} bytes`);
  
  const result = await importCompetitiveSurveyCSV(buffer, '2025-11');
  
  console.log('\n=== RESULTS ===');
  console.log(`Total: ${result.totalRecords}`);
  console.log(`Success: ${result.successfulImports}`);
  console.log(`Failed: ${result.failedImports}`);
  
  if (result.errors.length > 0) {
    console.log(`\nErrors (${result.errors.length}):`);
    result.errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
  }
}

run().catch(console.error).finally(() => process.exit(0));
