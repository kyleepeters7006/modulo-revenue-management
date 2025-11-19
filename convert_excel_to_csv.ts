import xlsx from 'xlsx';
import { writeFileSync } from 'fs';

console.log('Converting Excel to CSV...');
const workbook = xlsx.readFile('attached_assets/Competitive Survey Data Table_1763249402347.xlsx');
const sheetName = workbook.SheetNames[0];
console.log('Sheet name:', sheetName);

const csv = xlsx.utils.sheet_to_csv(workbook.Sheets[sheetName]);
writeFileSync('attached_assets/competitive_survey.csv', csv);

const lines = csv.split('\n');
console.log(`CSV conversion complete! ${lines.length} rows written`);
console.log('\nFirst row (headers):');
console.log(lines[0]);
