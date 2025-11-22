const XLSX = require('xlsx');
const wb = XLSX.readFile('./attached_assets/Competitive Survey Data - Updated_1763824864477.xlsx');
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

const firstRow = data[0];
const alColumns = Object.keys(firstRow).filter(k => k.includes('AL'));

console.log('AL-related columns:');
alColumns.forEach(col => console.log(`  - ${col}`));

// Find an AL=True row and show its AL columns
const alTrueRow = data.find(r => r.AL === 'True');
if (alTrueRow) {
  console.log('\nAL=True row AL columns and values:');
  alColumns.forEach(col => {
    if (alTrueRow[col] !== undefined && alTrueRow[col] !== null && alTrueRow[col] !== '') {
      console.log(`  ${col}: ${alTrueRow[col]}`);
    }
  });
}
