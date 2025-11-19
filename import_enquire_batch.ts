import { db } from './server/db';
import { enquireData } from './shared/schema';
import xlsx from 'xlsx';
import path from 'path';

async function importEnquireBatch() {
  const enquireFiles = [
    { file: 'Enquire Detail 112024 - 12312025_1763247498011.xlsx', source: 'Senior Housing' },
    { file: 'Enquire Detail - Post Acute_1763247498010.xlsx', source: 'Post Acute' }
  ];
  
  for (const { file, source } of enquireFiles) {
    console.log(`\n📊 Importing ${source}...`);
    
    try {
      const filePath = path.join(process.cwd(), 'attached_assets', file);
      const workbook = xlsx.readFile(filePath, {
        cellDates: true,
        sheetRows: 20000 // Limit to prevent memory issues
      });
      
      const sheetName = workbook.SheetNames[0];
      const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
      console.log(`✓ Loaded ${data.length} rows`);
      
      // Prepare all records
      const records = (data as any[]).map(row => ({
        dataSource: source,
        enquireLocation: row['Location'] || row['Community'] || row['Campus'] || 'Unknown',
        mappedLocationId: null,
        mappedServiceLine: row['Service Line'] || row['ServiceLine'] || null,
        inquiryId: row['Inquiry ID'] || row['Lead ID'] || row['ID'] || null,
        inquiryDate: row['Inquiry Date'] || row['Date'] || null,
        tourDate: row['Tour Date'] || null,
        moveInDate: row['Move In Date'] || null,
        leadSource: row['Lead Source'] || row['Source'] || null,
        leadStatus: row['Status'] || row['Lead Status'] || null,
        prospectName: row['Prospect Name'] || row['Name'] || null,
        careNeeds: row['Care Needs'] || null,
        budgetRange: row['Budget'] || null,
        desiredMoveInDate: row['Desired Move In'] || null,
        roomTypePreference: row['Room Type'] || null,
        notes: row['Notes'] || null,
        rawData: row as any
      }));
      
      // Batch insert (500 at a time)
      const BATCH_SIZE = 500;
      let imported = 0;
      
      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        await db.insert(enquireData).values(batch);
        imported += batch.length;
        console.log(`  Progress: ${imported}/${records.length} (${Math.round(imported/records.length*100)}%)`);
      }
      
      console.log(`✅ ${source}: ${imported} records imported`);
      
    } catch (error) {
      console.error(`❌ ${source}:`, error instanceof Error ? error.message : error);
    }
  }
}

importEnquireBatch().then(() => process.exit(0)).catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
