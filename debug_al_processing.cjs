const XLSX = require('xlsx');
const wb = XLSX.readFile('./attached_assets/Competitive Survey Data - Updated_1763824864477.xlsx');
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

// Find first AL=True row
const alTrue = data.find(r => r.AL === 'True' || r.AL === true || r.AL === 1);

if (!alTrue) {
  console.log('NO AL=True rows found!');
  process.exit(1);
}

console.log('First AL=True row:');
console.log(`  TrilogyCampusName: ${alTrue.TrilogyCampusName}`);
console.log(`  AL flag: "${alTrue.AL}" (type: ${typeof alTrue.AL})`);
console.log(`\nAL Rate columns:`);
console.log(`  AL_StudioPrivateRoomRate: ${alTrue.AL_StudioPrivateRoomRate}`);
console.log(`  AL_1BRPrivateRoomRate: ${alTrue.AL_1BRPrivateRoomRate}`);
console.log(`  AL_2BRPrivateRoomRate: ${alTrue.AL_2BRPrivateRoomRate}`);
console.log(`  AL_2ndPersonFee: ${alTrue.AL_2ndPersonFee}`);

console.log(`\nWeight/Adjustment columns:`);
console.log(`  AL_Comp_Weight: ${alTrue.AL_Comp_Weight}`);
console.log(`  AL_Comp_Care_Adj: ${alTrue.AL_Comp_Care_Adj}`);
console.log(`  AL_Comp_Other_Adj: ${alTrue.AL_Comp_Other_Adj}`);

// Check if this would be imported
const hasRates = !!(alTrue.AL_StudioPrivateRoomRate || alTrue.AL_1BRPrivateRoomRate || alTrue.AL_2BRPrivateRoomRate);
console.log(`\nWould import? ${hasRates ? 'YES' : 'NO - no rates found'}`);
