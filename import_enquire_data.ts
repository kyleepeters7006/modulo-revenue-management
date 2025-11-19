import { db } from './server/db';
import { enquireData } from './shared/schema';
import xlsx from 'xlsx';
import path from 'path';

async function importEnquireData() {
  const enquireFiles = [
    { file: 'Enquire Detail 112024 - 12312025_1763247498011.xlsx', source: 'Senior Housing', size: '7.9M' },
    { file: 'Enquire Detail - Post Acute_1763247498010.xlsx', source: 'Post Acute', size: '56M' }
  ];
  
  let totalImported = 0;
  
  for (const { file, source, size } of enquireFiles) {
    console.log(`\n📊 Importing ${source} (${size})...`);
    console.log(`File: ${file}`);
    
    try {
      const filePath = path.join(process.cwd(), 'attached_assets', file);
      console.log(`Reading Excel file...`);
      
      const workbook = xlsx.readFile(filePath, {
        cellDates: true,
        sheetRows: 10000 // Limit to first 10k rows to avoid memory issues
      });
      
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(sheet);
      
      console.log(`✓ Loaded ${data.length} rows from sheet "${sheetName}"`);
      
      let imported = 0;
      let errors = 0;
      
      for (const row of data as any[]) {
        try {
          await db.insert(enquireData).values({
            dataSource: source,
            enquireLocation: row['Location'] || row['Community'] || row['Campus'] || 'Unknown',
            mappedLocationId: null,
            mappedServiceLine: row['Service Line'] || row['ServiceLine'] || null,
            inquiryId: row['Inquiry ID'] || row['Lead ID'] || row['ID'] || null,
            inquiryDate: row['Inquiry Date'] || row['Date'] || row['InquiryDate'] || null,
            tourDate: row['Tour Date'] || row['TourDate'] || null,
            moveInDate: row['Move In Date'] || row['MoveInDate'] || null,
            leadSource: row['Lead Source'] || row['Source'] || null,
            leadStatus: row['Status'] || row['Lead Status'] || null,
            prospectName: row['Prospect Name'] || row['Name'] || row['ProspectName'] || null,
            careNeeds: row['Care Needs'] || row['CareNeeds'] || null,
            budgetRange: row['Budget'] || row['Budget Range'] || null,
            desiredMoveInDate: row['Desired Move In'] || row['DesiredMoveIn'] || null,
            roomTypePreference: row['Room Type'] || row['RoomType'] || null,
            notes: row['Notes'] || null,
            rawData: row as any
          });
          
          imported++;
          
          if (imported % 100 === 0) {
            process.stdout.write(`\r  Progress: ${imported} records imported...`);
          }
        } catch (error) {
          errors++;
          if (errors <= 3) {
            console.error(`\n  Row error:`, error instanceof Error ? error.message : error);
          }
        }
      }
      
      console.log(`\n✅ ${source}: ${imported} records imported | ${errors} errors`);
      totalImported += imported;
      
    } catch (error) {
      console.error(`❌ Failed to import ${source}:`, error instanceof Error ? error.message : error);
    }
  }
  
  console.log(`\n🎉 Total imported: ${totalImported} enquire records`);
}

importEnquireData().then(() => process.exit(0)).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
