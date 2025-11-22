import * as fs from 'fs';
import { importCompetitiveSurveyExcel } from './server/dataImport';

async function run() {
  const filePath = './attached_assets/Competitive Survey Data - Updated_1763824864477.xlsx';
  const buffer = fs.readFileSync(filePath);
  
  console.log('Re-importing with FIXED column mappings...\n');
  const result = await importCompetitiveSurveyExcel(buffer, '2025-11');
  
  console.log('\n=== Import Complete ===');
  console.log(`Total Excel rows: ${result.totalRecords}`);
  console.log(`Successfully imported: ${result.successfulImports} records`);
  console.log(`Failed: ${result.failedImports}`);
}

run().catch(console.error).finally(() => process.exit(0));
