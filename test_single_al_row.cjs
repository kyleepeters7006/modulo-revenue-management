const XLSX = require('xlsx');

// Find first AL=True row
const wb = XLSX.readFile('./attached_assets/Competitive Survey Data - Updated_1763824864477.xlsx');
const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
const alRow = data.find(r => r.AL === 'True');

console.log('Testing import logic for first AL=True row...\n');

// Simulate the isFlagTrue function
const isFlagTrue = (flag) => {
  return flag === 'True' || flag === 'TRUE' || flag === true || flag === 1 || flag === '1';
};

console.log(`AL flag: "${alRow.AL}" -> isFlagTrue: ${isFlagTrue(alRow.AL)}`);
console.log(`\nRoom type data:`);
console.log(`  AL_StudioPrivateRoomRate: ${alRow.AL_StudioPrivateRoomRate} (${typeof alRow.AL_StudioPrivateRoomRate})`);
console.log(`  AL_1BRPrivateRoomRate: ${alRow.AL_1BRPrivateRoomRate}`);
console.log(`  AL_2BRPrivateRoomRate: ${alRow.AL_2BRPrivateRoomRate}`);

// Simulate room type mapping
const roomTypes = [
  { name: 'Studio', rate: alRow.AL_StudioRate || alRow.AL_StudioPrivateRoomRate },
  { name: 'One Bedroom', rate: alRow.AL_OneBedRate || alRow.AL_1BRPrivateRoomRate },
  { name: 'Two Bedroom', rate: alRow.AL_TwoBedRate || alRow.AL_2BRPrivateRoomRate },
  { name: 'Companion', rate: alRow.AL_CompanionRate || alRow.AL_2ndPersonFee },
];

console.log(`\nMapped rates:`);
roomTypes.forEach(rt => {
  const valid = rt.rate && parseFloat(rt.rate) > 0;
  console.log(`  ${rt.name}: ${rt.rate} -> ${valid ? 'WOULD INSERT' : 'skip'}`);
});

const wouldInsert = roomTypes.filter(rt => rt.rate && parseFloat(rt.rate) > 0).length;
console.log(`\nTotal records that would be inserted: ${wouldInsert}`);
