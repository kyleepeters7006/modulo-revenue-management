import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { importMatrixCareRentRollCSV, syncHistoryToCurrentRentRoll } from './dataImport';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Map filenames to upload months
const fileMonthMapping: Record<string, string> = {
  'THS_Pricing_RentRoll 1.31.25_1763249338678.csv': '2025-01',
  'THS_Pricing_RentRoll 2.25.25_1763249338678.csv': '2025-02',
  'THS_Pricing_RentRoll 3.31.25_1763249338677.csv': '2025-03',
  'THS_Pricing_RentRoll 4.30.25_1763249338679.csv': '2025-04',
  'THS_Pricing_RentRoll 5.31.25_1763249338679.csv': '2025-05',
  'THS_Pricing_RentRoll 6.30.25_1763249338680.csv': '2025-06',
  'THS_Pricing_RentRoll 7.31.25_1763249338680.csv': '2025-07',
  'THS_Pricing_RentRoll 8.31.25_1763249338680.csv': '2025-08',
  'THS_Pricing_RentRoll 9.30.25_1763249338681.csv': '2025-09',
  'THS_Pricing_RentRoll 10.31.25_1763249338681.csv': '2025-10',
  'THS_Pricing_RentRoll 11.15.25_1763249338681.csv': '2025-11',
};

async function importAllRentRolls() {
  const assetsDir = path.join(__dirname, '..', 'attached_assets');
  
  console.log('\n========================================');
  console.log('Starting Batch Import of All Rent Rolls');
  console.log('========================================\n');
  
  let totalImported = 0;
  let totalFailed = 0;
  const results: any[] = [];
  
  for (const [filename, uploadMonth] of Object.entries(fileMonthMapping)) {
    const filePath = path.join(assetsDir, filename);
    
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  File not found: ${filename}`);
      continue;
    }
    
    console.log(`\n📁 Processing: ${filename}`);
    console.log(`   Month: ${uploadMonth}`);
    
    try {
      const fileBuffer = fs.readFileSync(filePath);
      const stats = await importMatrixCareRentRollCSV(fileBuffer, uploadMonth, filename);
      
      console.log(`   ✅ Imported: ${stats.successfulImports} records`);
      console.log(`   ✅ Mapped: ${stats.mappedRecords} locations`);
      if (stats.unmappedRecords > 0) {
        console.log(`   ⚠️  Unmapped: ${stats.unmappedRecords} records`);
      }
      if (stats.failedImports > 0) {
        console.log(`   ❌ Failed: ${stats.failedImports} records`);
      }
      if (stats.errors.length > 0) {
        console.log(`   📋 Errors: ${stats.errors.slice(0, 3).join(', ')}${stats.errors.length > 3 ? '...' : ''}`);
      }
      
      // Sync to current rent roll if this is the latest month
      const currentMonth = new Date().toISOString().slice(0, 7);
      if (uploadMonth === currentMonth) {
        console.log(`   🔄 Syncing ${uploadMonth} to current rent roll...`);
        const syncResult = await syncHistoryToCurrentRentRoll(uploadMonth);
        console.log(`   ✅ Synced ${syncResult.synced} records to current rent roll`);
      }
      
      totalImported += stats.successfulImports;
      totalFailed += stats.failedImports;
      
      results.push({
        month: uploadMonth,
        filename,
        ...stats
      });
      
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
      totalFailed++;
      results.push({
        month: uploadMonth,
        filename,
        error: error.message
      });
    }
  }
  
  console.log('\n========================================');
  console.log('Batch Import Complete');
  console.log('========================================');
  console.log(`\n📊 Summary:`);
  console.log(`   Total Records Imported: ${totalImported}`);
  console.log(`   Total Failed: ${totalFailed}`);
  console.log(`   Months Processed: ${results.length}`);
  
  // Detailed results
  console.log('\n📋 Detailed Results by Month:');
  results.forEach(r => {
    if (r.error) {
      console.log(`   ${r.month}: ❌ ${r.error}`);
    } else {
      console.log(`   ${r.month}: ✅ ${r.successfulImports} records (${r.mappedRecords} mapped, ${r.unmappedRecords} unmapped)`);
    }
  });
  
  console.log('\n✅ Batch import finished!\n');
  
  process.exit(0);
}

export { importAllRentRolls };

// Run if called directly
import.meta.url && importAllRentRolls().catch(error => {
  console.error('Fatal error during batch import:', error);
  process.exit(1);
});
