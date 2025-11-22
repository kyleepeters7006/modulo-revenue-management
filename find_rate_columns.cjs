const XLSX = require('xlsx');
const wb = XLSX.readFile('./attached_assets/Competitive Survey Data - Updated_1763824864477.xlsx');
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

// Find an AL=True row
const alRow = data.find(r => r.AL === 'True');

console.log('All columns in first AL=True row:');
Object.keys(alRow).forEach(col => {
  const val = alRow[col];
  if (val !== null && val !== undefined && val !== '' && val !== 0) {
    console.log(`  ${col}: ${val}`);
  }
});

console.log('\n\nColumns with "Rate" or "rate" in name:');
Object.keys(alRow).filter(k => k.toLowerCase().includes('rate')).forEach(col => {
  console.log(`  ${col}: ${alRow[col]}`);
});

console.log('\n\nColumns with numbers (potential rates):');
Object.keys(alRow).forEach(col => {
  const val = alRow[col];
  if (typeof val === 'number' && val > 100 && val < 10000) {
    console.log(`  ${col}: ${val}`);
  }
});
