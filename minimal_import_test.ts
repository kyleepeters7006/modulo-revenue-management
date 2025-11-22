import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { db } from './server/db';
import { competitiveSurveyData } from './shared/schema';
import { eq } from 'drizzle-orm';

async function run() {
  console.log('Reading Excel file...');
  const buffer = fs.readFileSync('./attached_assets/Competitive Survey Data - Updated_1763824864477.xlsx');
  const workbook = XLSX.read(buffer);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const data: any[] = XLSX.utils.sheet_to_json(worksheet);
  
  console.log(`Total rows: ${data.length}`);
  
  // Find first AL=True row
  const alRow = data.find(row => row['AL'] === 'True' || row['AL'] === true);
  if (!alRow) {
    console.log('No AL=True row found');
    return;
  }
  
  console.log('\n=== Found AL=True Row ===');
  console.log(`Trilogy: ${alRow['TrilogyCampusName']}`);
  console.log(`Competitor: ${alRow['CompetitorFacilityName']}`);
  console.log(`AL: ${alRow['AL']}`);
  console.log(`AL_StudioPrivateRoomRate: ${alRow['AL_StudioPrivateRoomRate']}`);
  
  console.log('\n=== Attempting Insert ===');
  try {
    await db.transaction(async (tx) => {
      const record = {
        surveyMonth: '2025-11',
        keyStatsLocation: alRow['TrilogyCampusName'],
        competitorName: alRow['CompetitorFacilityName'],
        competitorAddress: null,
        distanceMiles: null,
        competitorType: 'AL',
        roomType: 'Studio',
        squareFootage: null,
        monthlyRateLow: null,
        monthlyRateHigh: null,
        monthlyRateAvg: parseFloat(alRow['AL_StudioPrivateRoomRate']),
        careFeesLow: null,
        careFeesHigh: null,
        careFeesAvg: null,
        totalMonthlyLow: null,
        totalMonthlyHigh: null,
        totalMonthlyAvg: null,
        communityFee: null,
        petFee: null,
        otherFees: null,
        incentives: null,
        totalUnits: null,
        occupancyRate: null,
        yearBuilt: null,
        lastRenovation: null,
        amenities: null,
        notes: null,
      };
      
      console.log('Record to insert:', JSON.stringify(record, null, 2));
      const result = await tx.insert(competitiveSurveyData).values(record).returning();
      console.log('✓ Insert successful!', result[0]);
    });
    console.log('\n✓ Transaction committed!');
  } catch (error: any) {
    console.error('\n✗ ERROR:', error.message);
    console.error('Stack:', error.stack);
  }
  
  // Check database
  const count = await db.select().from(competitiveSurveyData).where(eq(competitiveSurveyData.competitorType, 'AL'));
  console.log(`\nAL records in database: ${count.length}`);
}

run().catch(console.error).finally(() => process.exit(0));
