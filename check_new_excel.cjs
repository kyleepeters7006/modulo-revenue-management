const XLSX = require('xlsx');
const wb = XLSX.readFile('./attached_assets/Competitive Survey Data - Updated_1763824864477.xlsx');
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

console.log(`Total rows: ${data.length}`);

// Find rows with AL = True
const alTrue = data.filter(r => 
  r.AL === 'True' || r.AL === 'TRUE' || r.AL === true || r.AL === 1 || r.AL === '1'
);

console.log(`\nRows with AL=True: ${alTrue.length}`);

if (alTrue.length > 0) {
  console.log('\nFirst AL=True row:');
  console.log(`  Trilogy: ${alTrue[0].TrilogyCampusName}`);
  console.log(`  Competitor: ${alTrue[0].CompetitorFacilityName}`);
  console.log(`  AL flag: "${alTrue[0].AL}"`);
  console.log(`  AL_StudioRate: ${alTrue[0].AL_StudioRate}`);
  console.log(`  AL_OneBedRate: ${alTrue[0].AL_OneBedRate}`);
}

// Check Anderson specifically
const anderson = data.filter(r => 
  r.TrilogyCampusName && r.TrilogyCampusName.toLowerCase().includes('anderson')
);
console.log(`\nAnderson rows: ${anderson.length}`);
const andersonAL = anderson.filter(r => 
  r.AL === 'True' || r.AL === 'TRUE' || r.AL === true || r.AL === 1
);
console.log(`Anderson AL=True rows: ${andersonAL.length}`);
