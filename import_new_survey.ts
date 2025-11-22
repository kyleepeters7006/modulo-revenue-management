import * as fs from 'fs';
import { importCompetitiveSurveyExcel } from './server/dataImport';

async function run() {
  const filePath = './attached_assets/Competitive Survey Data - Updated_1763824864477.xlsx';
  const buffer = fs.readFileSync(filePath);
  
  console.log('Importing updated competitive survey with AL data...\n');
  const result = await importCompetitiveSurveyExcel(buffer, '2025-11');
  
  console.log('\n=== Import Complete ===');
  console.log(`Total Excel rows: ${result.totalRecords}`);
  console.log(`Successfully imported: ${result.successfulImports} records`);
  console.log(`Failed: ${result.failedImports}`);
  
  if (result.errors.length > 0) {
    console.log(`\nErrors (first 5):`);
    result.errors.slice(0, 5).forEach(e => console.log(`  - ${e}`));
  }
}

run().catch(console.error).finally(() => process.exit(0));
