import * as fs from 'fs';
import { importCompetitiveSurveyExcel } from './server/dataImport';

async function run() {
  const buffer = fs.readFileSync('./attached_assets/Competitive Survey Data Table_1763249402347.xlsx');
  console.log('Starting import with fixed flag checking...\n');
  const result = await importCompetitiveSurveyExcel(buffer, '2025-11');
  console.log('\n=== Import Results ===');
  console.log(JSON.stringify(result, null, 2));
}

run().catch(console.error);
