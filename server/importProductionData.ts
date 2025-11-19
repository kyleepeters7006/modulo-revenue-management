import { db } from "./db";
import { rentRollData, locations, competitiveSurveyData, enquireData, locationMappings, unitPolygons } from "../shared/schema";
import { sql, eq, and } from "drizzle-orm";
import Papa from "papaparse";
import * as xlsx from "xlsx";
import { readFileSync } from "fs";
import path from "path";

/**
 * Import all production Trilogy data from attached_assets
 * This replaces the demo seed data with real CSV/Excel files
 */
export async function importProductionData() {
  try {
    console.log('Starting production data import...');
    
    // Clear existing data (delete in correct order due to foreign keys)
    console.log('Clearing existing data...');
    await db.delete(unitPolygons); // Delete first (has FK to rentRollData)
    await db.delete(locationMappings);
    await db.delete(enquireData);
    await db.delete(competitiveSurveyData);
    await db.delete(rentRollData);
    
    // Import rent roll data (11 monthly files)
    await importRentRolls();
    
    // Import competitive survey data
    await importCompetitiveSurvey();
    
    // Import enquire data
    await importEnquireData();
    
    console.log('Production data import complete!');
    
    return {
      success: true,
      message: 'All production data imported successfully'
    };
  } catch (error) {
    console.error('Error importing production data:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Import all 11 monthly rent roll CSV files
 */
async function importRentRolls() {
  const rentRollFiles = [
    'THS_Pricing_RentRoll 1.31.25_1763249338678.csv',
    'THS_Pricing_RentRoll 2.25.25_1763249338678.csv',
    'THS_Pricing_RentRoll 3.31.25_1763249338677.csv',
    'THS_Pricing_RentRoll 4.30.25_1763249338679.csv',
    'THS_Pricing_RentRoll 5.31.25_1763249338679.csv',
    'THS_Pricing_RentRoll 6.30.25_1763249338680.csv',
    'THS_Pricing_RentRoll 7.31.25_1763249338680.csv',
    'THS_Pricing_RentRoll 8.31.25_1763249338680.csv',
    'THS_Pricing_RentRoll 9.30.25_1763249338681.csv',
    'THS_Pricing_RentRoll 10.31.25_1763249338681.csv',
    'THS_Pricing_RentRoll 11.15.25_1763249338681.csv'
  ];
  
  const months = ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', 
                  '2025-07', '2025-08', '2025-09', '2025-10', '2025-11'];
  
  for (let i = 0; i < rentRollFiles.length; i++) {
    const filename = rentRollFiles[i];
    const uploadMonth = months[i];
    console.log(`Importing ${filename}...`);
    
    const filePath = path.join(process.cwd(), 'attached_assets', filename);
    const fileContent = readFileSync(filePath, 'utf-8');
    
    const parsed = Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true
    });
    
    let imported = 0;
    let skipped = 0;
    let duplicates = 0;
    const rows = parsed.data as any[];
    
    for (const row of rows) {
      try {
        // Skip if no location
        if (!row.location) {
          skipped++;
          continue;
        }
        
        // Map MatrixCare fields to our schema
        const isOccupied = Boolean(row.PatientID1 && row.PatientID1.trim());
        const serviceLine = mapServiceLine(row.Service1);
        const roomType = mapRoomType(row.BedTypeDesc);
        const payerType = row.DisplayPayer || row.PayerName || 'Unknown';
        const roomNumber = row.Room_Bed || 'Unknown';
        const locationName = row.location.trim();
        
        // **DUPLICATE CHECK**: Check if this unit already exists in this month
        const existing = await db.select().from(rentRollData).where(
          and(
            eq(rentRollData.uploadMonth, uploadMonth),
            eq(rentRollData.location, locationName),
            eq(rentRollData.serviceLine, serviceLine),
            eq(rentRollData.roomNumber, roomNumber)
          )
        ).limit(1);
        
        if (existing.length > 0) {
          duplicates++;
          continue; // Skip duplicate
        }
        
        // Parse rates
        const finalRate = parseFloat(row.FinalRate?.replace(/[$,]/g, '') || '0');
        const baseRate = parseFloat(row.BaseRate1?.replace(/[$,]/g, '') || '0');
        const locRate = parseFloat(row.LOC_Rate?.replace(/[$,]/g, '') || '0');
        
        // Determine if daily rate (HC/SNF) needs conversion to monthly
        const chargeBy = row.ChargeBy?.toLowerCase() || '';
        const monthlyBaseRate = chargeBy === 'daily' ? baseRate * 30 : baseRate;
        const monthlyFinalRate = chargeBy === 'daily' ? finalRate * 30 : finalRate;
        
        await db.insert(rentRollData).values({
          uploadMonth,
          date: extractDate(filename),
          location: locationName,
          roomNumber,
          roomType,
          serviceLine,
          occupiedYN: isOccupied,
          daysVacant: isOccupied ? 0 : 30, // Estimate
          preferredLocation: extractAttribute(row.BedTypeDesc, 'Loc'),
          size: mapSize(roomType),
          view: extractAttribute(row.BedTypeDesc, 'Vw'),
          renovated: false, // Not in source data
          otherPremiumFeature: null,
          locationRating: extractAttribute(row.BedTypeDesc, 'Loc'),
          sizeRating: extractAttribute(row.BedTypeDesc, 'Sz'),
          viewRating: extractAttribute(row.BedTypeDesc, 'Vw'),
          renovationRating: 'B',
          amenityRating: 'B',
          streetRate: monthlyBaseRate,
          inHouseRate: monthlyFinalRate,
          discountToStreetRate: monthlyBaseRate - monthlyFinalRate,
          careLevel: row.ActualLevel1 || null,
          careRate: locRate,
          rentAndCareRate: monthlyFinalRate + locRate,
          competitorRate: null, // Will be populated from competitive survey
          competitorAvgCareRate: null,
          competitorFinalRate: null,
          moduloSuggestedRate: null,
          moduloCalculationDetails: null,
          aiSuggestedRate: null,
          aiCalculationDetails: null,
          promotionAllowance: null,
          residentId: row.PatientID1 || null,
          residentName: null,
          moveInDate: row.MoveInDate || row.StayAdmitDate1 || null,
          moveOutDate: row.MoveOutDate || null,
          payorType: payerType,
          admissionStatus: null,
          levelOfCare: row.LevelOfCare1 || null,
          medicaidRate: null,
          medicareRate: null,
          assessmentDate: null,
          marketingSource: null,
          inquiryCount: 0,
          tourCount: 0
        });
        
        imported++;
      } catch (error) {
        console.warn(`Error processing row in ${filename}:`, error);
        skipped++;
      }
    }
    
    console.log(`✅ ${filename}: Imported ${imported} units | Skipped ${duplicates} duplicates | Errors ${skipped}`);
  }
}

/**
 * Import competitive survey Excel data
 */
async function importCompetitiveSurvey() {
  const filename = 'Competitive Survey Data Table_1763249402347.xlsx';
  console.log(`Importing ${filename}...`);
  
  const filePath = path.join(process.cwd(), 'attached_assets', filename);
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(sheet);
  
  let imported = 0;
  
  for (const row of data as any[]) {
    try {
      await db.insert(competitiveSurveyData).values({
        surveyMonth: '2025-11', // Default month
        keyStatsLocation: row['KeyStats Location'] || row['Location'] || 'Unknown',
        competitorName: row['Competitor Name'] || row['Name'] || 'Unknown',
        competitorAddress: row['Address'] || null,
        distanceMiles: row['Distance (miles)'] ? parseFloat(row['Distance (miles)']) : null,
        competitorType: row['Type'] || row['Service Line'] || null,
        roomType: row['Room Type'] || null,
        squareFootage: row['Square Footage'] ? parseInt(row['Square Footage']) : null,
        monthlyRateLow: row['Monthly Rate Low'] ? parseFloat(row['Monthly Rate Low']) : null,
        monthlyRateHigh: row['Monthly Rate High'] ? parseFloat(row['Monthly Rate High']) : null,
        monthlyRateAvg: row['Monthly Rate Avg'] || row['Average Rate'] ? parseFloat(row['Monthly Rate Avg'] || row['Average Rate']) : null,
        careFeesLow: row['Care Fees Low'] ? parseFloat(row['Care Fees Low']) : null,
        careFeesHigh: row['Care Fees High'] ? parseFloat(row['Care Fees High']) : null,
        careFeesAvg: row['Care Fees Avg'] || row['Average Care Fee'] ? parseFloat(row['Care Fees Avg'] || row['Average Care Fee']) : null,
        totalMonthlyLow: row['Total Monthly Low'] ? parseFloat(row['Total Monthly Low']) : null,
        totalMonthlyHigh: row['Total Monthly High'] ? parseFloat(row['Total Monthly High']) : null,
        totalMonthlyAvg: row['Total Monthly Avg'] ? parseFloat(row['Total Monthly Avg']) : null,
        communityFee: row['Community Fee'] ? parseFloat(row['Community Fee']) : null,
        petFee: row['Pet Fee'] ? parseFloat(row['Pet Fee']) : null,
        otherFees: row['Other Fees'] ? parseFloat(row['Other Fees']) : null,
        incentives: row['Incentives'] || null,
        totalUnits: row['Total Units'] ? parseInt(row['Total Units']) : null,
        occupancyRate: row['Occupancy Rate'] ? parseFloat(row['Occupancy Rate']) : null,
        yearBuilt: row['Year Built'] ? parseInt(row['Year Built']) : null,
        lastRenovation: row['Last Renovation'] ? parseInt(row['Last Renovation']) : null,
        amenities: row['Amenities'] || null,
        notes: row['Notes'] || null
      });
      
      imported++;
    } catch (error) {
      console.warn('Skipping competitive survey row:', error);
    }
  }
  
  console.log(`Imported ${imported} competitive survey records`);
}

/**
 * Import Enquire data Excel files
 */
async function importEnquireData() {
  const enquireFiles = [
    { file: 'Enquire Detail 112024 - 12312025_1763247498011.xlsx', source: 'Senior Housing' },
    { file: 'Enquire Detail - Post Acute_1763247498010.xlsx', source: 'Post Acute' }
  ];
  
  for (const { file, source } of enquireFiles) {
    console.log(`Importing ${file}...`);
    
    const filePath = path.join(process.cwd(), 'attached_assets', file);
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);
    
    let imported = 0;
    
    for (const row of data as any[]) {
      try {
        await db.insert(enquireData).values({
          dataSource: source,
          enquireLocation: row['Location'] || row['Community'] || 'Unknown',
          mappedLocationId: null, // Will be mapped later
          mappedServiceLine: row['Service Line'] || null,
          inquiryId: row['Inquiry ID'] || row['Lead ID'] || null,
          inquiryDate: row['Inquiry Date'] || row['Date'] || null,
          tourDate: row['Tour Date'] || null,
          moveInDate: row['Move In Date'] || null,
          leadSource: row['Lead Source'] || row['Source'] || null,
          leadStatus: row['Status'] || null,
          prospectName: row['Prospect Name'] || row['Name'] || null,
          careNeeds: row['Care Needs'] || null,
          budgetRange: row['Budget'] || null,
          desiredMoveInDate: row['Desired Move In'] || null,
          roomTypePreference: row['Room Type'] || null,
          notes: row['Notes'] || null,
          rawData: row as any
        });
        
        imported++;
      } catch (error) {
        console.warn('Skipping enquire row:', error);
      }
    }
    
    console.log(`Imported ${imported} enquire records from ${file}`);
  }
}

// Helper functions

function mapServiceLine(service1: string): string {
  if (!service1) return 'Unknown';
  const s = service1.toUpperCase();
  if (s.includes('HC')) return 'HC';
  if (s.includes('AL')) return 'AL';
  if (s.includes('IL')) return 'IL';
  if (s.includes('MC')) return 'MC';
  if (s.includes('SNF')) return 'SNF';
  return service1;
}

function mapRoomType(bedTypeDesc: string): string {
  if (!bedTypeDesc) return 'Unknown';
  if (bedTypeDesc.includes('Studio')) return 'Studio';
  if (bedTypeDesc.includes('One Bedroom') || bedTypeDesc.includes('1BR')) return 'One Bedroom';
  if (bedTypeDesc.includes('Two Bedroom') || bedTypeDesc.includes('2BR')) return 'Two Bedroom';
  if (bedTypeDesc.includes('Private')) return 'Private';
  if (bedTypeDesc.includes('Semi-Private')) return 'Semi-Private';
  if (bedTypeDesc.includes('Companion')) return 'Companion';
  return 'Unknown';
}

function mapSize(roomType: string): string {
  if (roomType === 'Studio') return 'Studio';
  if (roomType === 'One Bedroom') return 'One Bedroom';
  if (roomType === 'Two Bedroom') return 'Two Bedroom';
  return 'Medium';
}

function extractAttribute(bedTypeDesc: string, attr: string): string {
  if (!bedTypeDesc) return 'B';
  const match = bedTypeDesc.match(new RegExp(`${attr};([A-C])`));
  return match ? match[1] : 'B';
}

function extractDate(filename: string): string {
  // Extract date from filename like "THS_Pricing_RentRoll 11.15.25_..."
  const match = filename.match(/(\d+)\.(\d+)\.(\d+)/);
  if (match) {
    const [_, month, day, year] = match;
    return `${month}/${day}/20${year}`;
  }
  return new Date().toLocaleDateString();
}