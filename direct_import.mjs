import { importCompetitiveSurveyExcel } from './server/dataImport.js';
import fs from 'fs';

console.log('Loading file...');
const fileBuffer = fs.readFileSync('./attached_assets/Competitive Survey Data Table_1763249402347.xlsx');
console.log(`File loaded: ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB`);

console.log('\nStarting import (this will take a few minutes for 78MB file)...');
const startTime = Date.now();

try {
  const result = await importCompetitiveSurveyExcel(fileBuffer, '2025-11');
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log('\n=== IMPORT COMPLETE ===');
  console.log(`Duration: ${duration}s`);
  console.log(`Total records in file: ${result.totalRecords}`);
  console.log(`Successfully imported: ${result.successfulImports}`);
  console.log(`Failed: ${result.failedImports}`);
  
  if (result.errors.length > 0) {
    console.log(`\nErrors (showing first 5 of ${result.errors.length}):`);
    result.errors.slice(0, 5).forEach(err => console.log(`  - ${err}`));
  }
} catch (error) {
  console.error('\nImport failed:', error.message);
}
