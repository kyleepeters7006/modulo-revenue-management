const XLSX = require('xlsx');
const fs = require('fs');

const filePath = './attached_assets/Competitive Survey Data Table_1763249402347.xlsx';
const workbook = XLSX.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

console.log(`Total rows: ${data.length}`);
console.log('\n=== Checking AL flags ===');
const alTrue = data.filter(row => row.AL === 'True' || row.AL === true);
const alFalse = data.filter(row => row.AL === 'False' || row.AL === false);
console.log(`Rows with AL=True: ${alTrue.length}`);
console.log(`Rows with AL=False: ${alFalse.length}`);

console.log('\n=== Sample AL=True rows ===');
alTrue.slice(0, 3).forEach((row, i) => {
  console.log(`\nRow ${i + 1}:`);
  console.log(`  Trilogy Campus: ${row.TrilogyCampusName}`);
  console.log(`  Competitor: ${row.CompetitorFacilityName}`);
  console.log(`  AL flag: ${row.AL}`);
  console.log(`  AL_StudioRate: ${row.AL_StudioRate}`);
  console.log(`  AL_OneBedRate: ${row.AL_OneBedRate}`);
  console.log(`  AL_CompanionRate: ${row.AL_CompanionRate}`);
});

console.log('\n=== Checking service line columns ===');
const firstRow = data[0];
const serviceLineColumns = Object.keys(firstRow).filter(k => k.startsWith('AL_') || k.startsWith('HC_') || k.startsWith('SMC_'));
console.log('AL columns:', serviceLineColumns.filter(c => c.startsWith('AL_')).join(', '));
