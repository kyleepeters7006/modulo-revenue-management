const XLSX = require('xlsx');

const wb = XLSX.readFile('./attached_assets/Competitive Survey Data Table_1763249402347.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(ws);

console.log(`Total rows in Excel: ${data.length}\n`);

// Show first 3 rows with AL info
console.log('=== First 3 rows ===');
for (let i = 0; i < Math.min(3, data.length); i++) {
  const row = data[i];
  console.log(`\nRow ${i + 1}:`);
  console.log(`  Trilogy Campus: ${row.TrilogyCampusName}`);
  console.log(`  Competitor: ${row.CompetitorFacilityName}`);
  console.log(`  AL flag: "${row.AL}" (JS type: ${typeof row.AL}) (value === 'True': ${row.AL === 'True'}) (value === true: ${row.AL === true})`);
  console.log(`  HC flag: "${row.HC}" (JS type: ${typeof row.HC})`);
  console.log(`  AL_StudioRate: ${row.AL_StudioRate}`);
  console.log(`  HC_PrivateRoomRate: ${row.HC_PrivateRoomRate}`);
}

// Count different AL values
const alValues = {};
data.forEach(row => {
  const val = String(row.AL);
  alValues[val] = (alValues[val] || 0) + 1;
});

console.log('\n=== AL Flag Distribution ===');
Object.entries(alValues).sort((a,b) => b[1] - a[1]).forEach(([val, count]) => {
  console.log(`  "${val}": ${count} rows`);
});
