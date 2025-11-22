import fs from 'fs';
import { importCompetitiveSurveyExcel } from './server/dataImport.js';

async function main() {
  const filePath = './attached_assets/Competitive Survey Data Table_1763249402347.xlsx';
  const fileBuffer = fs.readFileSync(filePath);
  
  console.log('Starting competitive survey import...');
  const stats = await importCompetitiveSurveyExcel(fileBuffer, '2025-11');
  console.log('\n=== Import Complete ===');
  console.log(`Total records: ${stats.totalRecords}`);
  console.log(`Successful: ${stats.successfulImports}`);
  console.log(`Failed: ${stats.failedImports}`);
  console.log(`Errors: ${stats.errors.slice(0, 5).join(', ')}`);
}

main().catch(console.error).finally(() => process.exit(0));
