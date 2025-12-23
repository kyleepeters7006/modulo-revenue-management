import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { db } from './db';
import {
  rentRollHistory,
  enquireData,
  locationMappings,
  competitiveSurveyData,
  rentRollData,
  locations,
  type InsertRentRollHistory,
  type InsertEnquireData,
  type InsertLocationMapping,
  type InsertCompetitiveSurveyData,
} from '@shared/schema';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { normalizeRoomType } from '@shared/roomTypes';

export interface ImportStats {
  totalRecords: number;
  successfulImports: number;
  failedImports: number;
  mappedRecords: number;
  unmappedRecords: number;
  errors: string[];
}

export async function importRentRollCSV(
  fileBuffer: Buffer,
  uploadMonth: string,
  fileName: string
): Promise<ImportStats> {
  const stats: ImportStats = {
    totalRecords: 0,
    successfulImports: 0,
    failedImports: 0,
    mappedRecords: 0,
    unmappedRecords: 0,
    errors: [],
  };

  return new Promise((resolve) => {
    const fileContent = fileBuffer.toString('utf-8');

    Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
      complete: async (results: Papa.ParseResult<any>) => {
        stats.totalRecords = results.data.length;

        try {
          await db.transaction(async (tx) => {
            await tx.delete(rentRollHistory).where(eq(rentRollHistory.uploadMonth, uploadMonth));

            const allLocations = await tx.select().from(locations);
            const locationMap = new Map(allLocations.map(loc => [loc.name.toLowerCase(), loc.id]));

            for (const row of results.data as any[]) {
              try {
                const locationName = row['Location'] || row['location'] || '';
                const locationId = locationMap.get(locationName.toLowerCase());

                const record: InsertRentRollHistory = {
                  uploadMonth,
                  date: row['Date'] || row['date'] || uploadMonth,
                  location: locationName,
                  locationId: locationId || null,
                  roomNumber: row['Room Number'] || row['room_number'] || '',
                  roomType: normalizeRoomType(row['Room Type'] || row['room_type'] || ''),
                  serviceLine: row['Service Line'] || row['service_line'] || '',
                  occupiedYN: parseBoolean(row['Occupied Y/N'] || row['occupied_yn']),
                  daysVacant: parseInt(row['Days Vacant'] || row['days_vacant']) || 0,
                  preferredLocation: row['Preferred Location'] || row['preferred_location'] || null,
                  size: row['Size'] || row['size'] || '',
                  view: row['View'] || row['view'] || null,
                  renovated: parseBoolean(row['Renovated'] || row['renovated']),
                  otherPremiumFeature: row['Other Premium Feature'] || row['other_premium_feature'] || null,
                  locationRating: row['Location Rating'] || row['location_rating'] || null,
                  sizeRating: row['Size Rating'] || row['size_rating'] || null,
                  viewRating: row['View Rating'] || row['view_rating'] || null,
                  renovationRating: row['Renovation Rating'] || row['renovation_rating'] || null,
                  amenityRating: row['Amenity Rating'] || row['amenity_rating'] || null,
                  streetRate: parseFloat(row['Street Rate'] || row['street_rate']) || 0,
                  inHouseRate: parseFloat(row['In-House Rate'] || row['in_house_rate']) || 0,
                  discountToStreetRate: parseFloat(row['Discount to Street Rate'] || row['discount_to_street_rate']) || null,
                  careLevel: row['Care Level'] || row['care_level'] || null,
                  careRate: parseFloat(row['Care Rate'] || row['care_rate']) || null,
                  rentAndCareRate: parseFloat(row['Rent and Care Rate'] || row['rent_and_care_rate']) || null,
                  competitorRate: parseFloat(row['Competitor Rate'] || row['competitor_rate']) || null,
                  competitorAvgCareRate: parseFloat(row['Competitor Avg Care Rate'] || row['competitor_avg_care_rate']) || null,
                  competitorFinalRate: parseFloat(row['Competitor Final Rate'] || row['competitor_final_rate']) || null,
                  residentId: row['Resident ID'] || row['resident_id'] || null,
                  residentName: row['Resident Name'] || row['resident_name'] || null,
                  moveInDate: row['Move In Date'] || row['move_in_date'] || null,
                  moveOutDate: row['Move Out Date'] || row['move_out_date'] || null,
                  payorType: row['DisplayPayer'] || row['PayerName'] || row['Payor Type'] || row['payor_type'] || row['Payer'] || row['payer'] || row['Payor'] || row['payor'] || null,
                  admissionStatus: row['Admission Status'] || row['admission_status'] || null,
                  levelOfCare: row['Level of Care'] || row['level_of_care'] || null,
                  medicaidRate: parseFloat(row['Medicaid Rate'] || row['medicaid_rate']) || null,
                  medicareRate: parseFloat(row['Medicare Rate'] || row['medicare_rate']) || null,
                  assessmentDate: row['Assessment Date'] || row['assessment_date'] || null,
                  marketingSource: row['Marketing Source'] || row['marketing_source'] || null,
                };

                await tx.insert(rentRollHistory).values(record);
                stats.successfulImports++;
                if (locationId) {
                  stats.mappedRecords++;
                } else {
                  stats.unmappedRecords++;
                }
              } catch (error: any) {
                stats.failedImports++;
                stats.errors.push(`Row ${stats.successfulImports + stats.failedImports}: ${error.message}`);
              }
            }
          });
        } catch (txError: any) {
          stats.errors.push(`Transaction error: ${txError.message}`);
        }

        resolve(stats);
      },
      error: (error: Error) => {
        stats.errors.push(`CSV parsing error: ${error.message}`);
        resolve(stats);
      },
    });
  });
}

export async function importEnquireCSV(
  fileBuffer: Buffer,
  dataSource: 'Senior Housing' | 'Post Acute'
): Promise<ImportStats> {
  const stats: ImportStats = {
    totalRecords: 0,
    successfulImports: 0,
    failedImports: 0,
    mappedRecords: 0,
    unmappedRecords: 0,
    errors: [],
  };

  return new Promise((resolve) => {
    // Try UTF-8 first, fallback to latin1 if needed
    let fileContent: string;
    try {
      fileContent = fileBuffer.toString('utf-8');
      // Test if it's valid by checking for replacement characters
      if (fileContent.includes('�')) {
        throw new Error('Invalid UTF-8');
      }
    } catch (e) {
      fileContent = fileBuffer.toString('latin1');
    }

    Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
      complete: async (results: Papa.ParseResult<any>) => {
        stats.totalRecords = results.data.length;
        console.log(`Parsing ${stats.totalRecords} records from Enquire CSV`);

        try {
          await db.transaction(async (tx) => {
            const existingMappings = await tx.select().from(locationMappings).where(eq(locationMappings.sourceSystem, 'enquire'));
            const mappingMap = new Map(existingMappings.map(m => [m.sourceLocation.toLowerCase(), m]));

            const existingInquiryIds = new Set(
              (await tx.selectDistinct({ id: enquireData.inquiryId }).from(enquireData).where(eq(enquireData.dataSource, dataSource)))
                .map(r => r.id)
                .filter((id): id is string => id !== null)
            );

            for (const row of results.data as any[]) {
              try {
                // Handle new CSV format from Enquire export
                const enquireLocation = row['Location'] || row['location'] || row['Facility'] || row['facility'] || '';
                const mapping = mappingMap.get(enquireLocation.toLowerCase());

                // Extract inquiry ID from Link URL if available
                let inquiryId = null;
                const linkUrl = row['Link'] || '';
                const idMatch = linkUrl.match(/details\/(\d+)/);
                if (idMatch) {
                  inquiryId = idMatch[1];
                }

                const record: InsertEnquireData = {
                  dataSource,
                  enquireLocation,
                  mappedLocationId: mapping?.targetLocationId || null,
                  mappedServiceLine: mapping?.defaultServiceLine || null,
                  inquiryId: inquiryId || row['Inquiry ID'] || row['inquiry_id'] || row['ID'] || row['id'] || null,
                  inquiryDate: row['Inquiry Date'] || row['inquiry_date'] || row['Date'] || row['date'] || null,
                  tourDate: row['Tour Date'] || row['tour_date'] || row['UserLocalActivityStartDate'] || null,
                  moveInDate: row['Move In Date'] || row['move_in_date'] || row['UserLocalActivityCompletedDate'] || null,
                  leadSource: row['Individual Market Source'] || row['Lead Source'] || row['lead_source'] || row['Source'] || row['source'] || null,
                  leadStatus: row['SaleStage'] || row['Lead Status'] || row['lead_status'] || row['Status'] || row['status'] || null,
                  prospectName: row['Prospect Name'] || row['prospect_name'] || row['Name'] || row['name'] || null,
                  careNeeds: row['Individual Care'] || row['Care Needs'] || row['care_needs'] || null,
                  budgetRange: row['Budget Range'] || row['budget_range'] || null,
                  desiredMoveInDate: row['Desired Move In Date'] || row['desired_move_in_date'] || null,
                  roomTypePreference: row['Room Type'] || row['room_type'] || null,
                  notes: row['Activity Name'] || row['Notes'] || row['notes'] || null,
                  rawData: row,
                };

                if (record.inquiryId && !existingInquiryIds.has(record.inquiryId)) {
                  await tx.insert(enquireData).values(record);
                  stats.successfulImports++;
                  if (mapping) {
                    stats.mappedRecords++;
                  } else {
                    stats.unmappedRecords++;
                  }
                } else if (!record.inquiryId) {
                  await tx.insert(enquireData).values(record);
                  stats.successfulImports++;
                  if (mapping) {
                    stats.mappedRecords++;
                  } else {
                    stats.unmappedRecords++;
                  }
                } else {
                  stats.errors.push(`Duplicate inquiry ID: ${record.inquiryId}`);
                }
              } catch (error: any) {
                stats.failedImports++;
                stats.errors.push(`Row ${stats.successfulImports + stats.failedImports}: ${error.message}`);
              }
            }
          });
        } catch (txError: any) {
          stats.errors.push(`Transaction error: ${txError.message}`);
        }

        resolve(stats);
      },
      error: (error: Error) => {
        stats.errors.push(`CSV parsing error: ${error.message}`);
        resolve(stats);
      },
    });
  });
}

export async function importCompetitiveSurveyCSV(fileBuffer: Buffer, surveyMonth: string): Promise<ImportStats> {
  const stats: ImportStats = {
    totalRecords: 0,
    successfulImports: 0,
    failedImports: 0,
    mappedRecords: 0,
    unmappedRecords: 0,
    errors: [],
  };

  return new Promise((resolve) => {
    // Try UTF-8 first, fallback to latin1 if needed
    let fileContent: string;
    try {
      fileContent = fileBuffer.toString('utf-8');
    } catch (e) {
      fileContent = fileBuffer.toString('latin1');
    }

    Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
      complete: async (results: Papa.ParseResult<any>) => {
        stats.totalRecords = results.data.length;
        console.log(`Parsed ${stats.totalRecords} rows from CSV`);

        const insertCounts = { AL: 0, HC: 0, SMC: 0, MC: 0, IL: 0, 'AL/MC': 0, 'HC/MC': 0 };
        const allRecords: InsertCompetitiveSurveyData[] = [];

        try {
          // First, collect all records (no database operations yet)
          for (const row of results.data) {
            try {
                const trilogyCampus = row['TrilogyCampusName'] || '';
                const competitorName = row['CompetitorFacilityName'] || '';
                const address = row['Address'] || null;
                const latitude = row['Latitude'] || null;
                const longitude = row['Longitude'] || null;

                // Parse driving time
                let distanceMiles: number | null = null;
                if (row['DrivingTime']) {
                  const timeMatch = String(row['DrivingTime']).match(/(\d+)/);
                  if (timeMatch) {
                    distanceMiles = parseInt(timeMatch[1]);
                  }
                }

                // Helper to check boolean flags
                const isFlagTrue = (value: any): boolean => {
                  if (value === true || value === 1) return true;
                  if (typeof value === 'string') {
                    const lower = value.toLowerCase().trim();
                    return lower === 'true' || lower === '1' || lower === 'yes';
                  }
                  return false;
                };

                // Helper to parse numeric values safely
                const parseNumeric = (value: any): number | null => {
                  if (!value) return null;
                  const cleaned = String(value).trim().replace(/[\$,\s]/g, '');
                  const parsed = parseFloat(cleaned);
                  return isNaN(parsed) ? null : parsed;
                };

                // Service line definitions
                const serviceLines = [
                  {
                    type: 'IL',
                    flag: row['IL flag'] || row['IL'],
                    careLevel1: parseNumeric(row['IL_Level1']),
                    careLevel2: parseNumeric(row['IL_Level2']),
                    careLevel3: parseNumeric(row['IL_Level3']),
                    careLevel4: parseNumeric(row['IL_Level4']),
                    medicationManagement: parseNumeric(row['IL_MedicationManagement']),
                    roomTypes: [
                      { name: 'Studio', rate: row['IL_StudioRate'] || row['IL_StudioPrivateRoomRate'], careLevel: row['IL_Comp_Care_Adj'], otherAdj: row['IL_Comp_Other_Adj'], weight: row['IL_Comp_Weight'] },
                      { name: 'One Bedroom', rate: row['IL_OneBedRate'] || row['IL_1BRPrivateRoomRate'], careLevel: row['IL_Comp_Care_Adj'], otherAdj: row['IL_Comp_Other_Adj'], weight: row['IL_Comp_Weight'] },
                      { name: 'Two Bedroom', rate: row['IL_TwoBedRate'] || row['IL_2BRPrivateRoomRate'], careLevel: row['IL_Comp_Care_Adj'], otherAdj: row['IL_Comp_Other_Adj'], weight: row['IL_Comp_Weight'] },
                    ],
                    occupancy: row['IL_Occupancy'],
                    totalUnits: row['IL_TotalUnits'],
                  },
                  {
                    type: 'AL',
                    flag: row['AL flag'] || row['AL'],
                    careLevel1: parseNumeric(row['AL_Level1']),
                    careLevel2: parseNumeric(row['AL_Level2']),
                    careLevel3: parseNumeric(row['AL_Level3']),
                    careLevel4: parseNumeric(row['AL_Level4']),
                    medicationManagement: parseNumeric(row['AL_MedicationManagement']),
                    roomTypes: [
                      { name: 'Studio', rate: row['AL_StudioRate'] || row['AL_StudioPrivateRoomRate'], careLevel: row['AL_Comp_Care_Adj'], otherAdj: row['AL_Comp_Other_Adj'], weight: row['AL_Comp_Weight'] },
                      { name: 'Studio Dlx', rate: row['AL_StudioDlxRate'] || row['AL_StudioDeluxeRoomRate'], careLevel: row['AL_Comp_Care_Adj'], otherAdj: row['AL_Comp_Other_Adj'], weight: row['AL_Comp_Weight'] },
                      { name: 'One Bedroom', rate: row['AL_OneBedRate'] || row['AL_1BRPrivateRoomRate'], careLevel: row['AL_Comp_Care_Adj'], otherAdj: row['AL_Comp_Other_Adj'], weight: row['AL_Comp_Weight'] },
                      { name: 'Two Bedroom', rate: row['AL_TwoBedRate'] || row['AL_2BRPrivateRoomRate'], careLevel: row['AL_Comp_Care_Adj'], otherAdj: row['AL_Comp_Other_Adj'], weight: row['AL_Comp_Weight'] },
                      { name: 'Companion', rate: row['AL_CompanionRate'] || row['AL_2ndPersonFee'], careLevel: row['AL_Comp_Care_Adj'], otherAdj: row['AL_Comp_Other_Adj'], weight: row['AL_Comp_Weight'] },
                    ],
                    occupancy: row['AL_Occupancy'],
                    totalUnits: row['AL_TotalUnits'],
                  },
                  {
                    type: 'HC',
                    flag: row['HC flag'] || row['HC'],
                    careLevel1: parseNumeric(row['HC_Level1']),
                    careLevel2: parseNumeric(row['HC_Level2']),
                    careLevel3: parseNumeric(row['HC_Level3']),
                    careLevel4: parseNumeric(row['HC_Level4']),
                    medicationManagement: parseNumeric(row['HC_MedicationManagement']),
                    roomTypes: [
                      { name: 'Studio', rate: row['HC_PrivateRoomRate'], careLevel: row['HC_Comp_Care_Adj'], otherAdj: row['HC_Comp_Other_Adj'], weight: row['HC_Comp_Weight'] },
                      { name: 'Studio Dlx', rate: row['HC_PrivateDeluxeRoomRate'] || row['HC_PrivateDlxRoomRate'], careLevel: row['HC_Comp_Care_Adj'], otherAdj: row['HC_Comp_Other_Adj'], weight: row['HC_Comp_Weight'] },
                      { name: 'Companion', rate: row['HC_CompanionSemiPrivateRoomRate'] || row['HC_2ndPersonFee'], careLevel: row['HC_Comp_Care_Adj'], otherAdj: row['HC_Comp_Other_Adj'], weight: row['HC_Comp_Weight'] },
                    ],
                    occupancy: row['HC_Occupancy'],
                    totalUnits: row['HC_TotalUnits'],
                  },
                  {
                    type: 'SMC',
                    flag: row['SMC flag'] || row['SMC'],
                    careLevel1: parseNumeric(row['SMC_Level1']),
                    careLevel2: parseNumeric(row['SMC_Level2']),
                    careLevel3: parseNumeric(row['SMC_Level3']),
                    careLevel4: parseNumeric(row['SMC_Level4']),
                    medicationManagement: parseNumeric(row['SMC_MedicationManagement']),
                    roomTypes: [
                      { name: 'Studio', rate: row['SMC_PrivateRoomRate'], careLevel: row['SMC_Comp_Care_Adj'], otherAdj: row['SMC_Comp_Other_Adj'], weight: row['SMC_Comp_Weight'] },
                      { name: 'Companion', rate: row['SMC_CompanionRoomRate'], careLevel: row['SMC_Comp_Care_Adj'], otherAdj: row['SMC_Comp_Other_Adj'], weight: row['SMC_Comp_Weight'] },
                    ],
                    occupancy: row['SMC_Occupancy'],
                    totalUnits: row['SMC_TotalUnits'],
                  },
                  {
                    type: 'MC',
                    flag: row['MC flag'] || row['MC'],
                    careLevel1: parseNumeric(row['MC_Level1']),
                    careLevel2: parseNumeric(row['MC_Level2']),
                    careLevel3: parseNumeric(row['MC_Level3']),
                    careLevel4: parseNumeric(row['MC_Level4']),
                    medicationManagement: parseNumeric(row['MC_MedicationManagement']),
                    roomTypes: [
                      { name: 'Studio', rate: row['MC_PrivateRate'], careLevel: row['MC_Comp_Care_Adj'], otherAdj: row['MC_Comp_Other_Adj'], weight: row['MC_Comp_Weight'] },
                      { name: 'Companion', rate: row['MC_CompanionRate'], careLevel: row['MC_Comp_Care_Adj'], otherAdj: row['MC_Comp_Other_Adj'], weight: row['MC_Comp_Weight'] },
                    ],
                    occupancy: null,
                    totalUnits: null,
                  },
                  {
                    type: 'AL/MC',
                    flag: (row['AL'] === 'True' || row['AL'] === true || row['AL'] === 1) && (row['MC'] === 'True' || row['MC'] === true || row['MC'] === 1) ? 'True' : 'False',
                    roomTypes: [
                      { name: 'Studio', rate: row['AL/MC_PrivateRate'], careLevel: row['AL/MC_Comp_Care_Adj'], otherAdj: row['AL/MC_Comp_Other_Adj'], weight: row['AL/MC_Comp_Weight'] },
                      { name: 'Companion', rate: row['AL/MC_CompanionRate'], careLevel: row['AL/MC_Comp_Care_Adj'], otherAdj: row['AL/MC_Comp_Other_Adj'], weight: row['AL/MC_Comp_Weight'] },
                    ],
                    occupancy: null,
                    totalUnits: null,
                  },
                  {
                    type: 'HC/MC',
                    flag: (row['HC'] === 'True' || row['HC'] === true || row['HC'] === 1) && (row['MC'] === 'True' || row['MC'] === true || row['MC'] === 1) ? 'True' : 'False',
                    roomTypes: [
                      { name: 'Studio', rate: row['HC/MC_PrivateRate'], careLevel: row['HC/MC_Comp_Care_Adj'], otherAdj: row['HC/MC_Comp_Other_Adj'], weight: row['HC/MC_Comp_Weight'] },
                      { name: 'Companion', rate: row['HC/MC_CompanionRate'], careLevel: row['HC/MC_Comp_Care_Adj'], otherAdj: row['HC/MC_Comp_Other_Adj'], weight: row['HC/MC_Comp_Weight'] },
                    ],
                    occupancy: null,
                    totalUnits: null,
                  },
                ];

                // Process each service line
                for (const serviceLine of serviceLines) {
                  if (!isFlagTrue(serviceLine.flag)) continue;

                  for (const roomType of serviceLine.roomTypes) {
                    if (!roomType.rate || parseFloat(roomType.rate) === 0) continue;

                    const record: InsertCompetitiveSurveyData = {
                      surveyMonth,
                      keyStatsLocation: trilogyCampus,
                      competitorName,
                      competitorAddress: address,
                      distanceMiles,
                      competitorType: serviceLine.type,
                      roomType: roomType.name,
                      squareFootage: null,
                      monthlyRateLow: null,
                      monthlyRateHigh: null,
                      monthlyRateAvg: parseFloat(roomType.rate) || null,
                      careFeesLow: null,
                      careFeesHigh: null,
                      careFeesAvg: parseFloat(roomType.careLevel) || null,
                      careLevel1Rate: serviceLine.careLevel1 || null,
                      careLevel2Rate: serviceLine.careLevel2 || null,
                      careLevel3Rate: serviceLine.careLevel3 || null,
                      careLevel4Rate: serviceLine.careLevel4 || null,
                      totalMonthlyLow: null,
                      totalMonthlyHigh: null,
                      totalMonthlyAvg: null,
                      communityFee: null,
                      petFee: null,
                      otherFees: parseFloat(roomType.otherAdj) || null,
                      incentives: null,
                      totalUnits: serviceLine.totalUnits ? parseInt(serviceLine.totalUnits) : null,
                      occupancyRate: serviceLine.occupancy ? parseFloat(serviceLine.occupancy) : null,
                      yearBuilt: row['Age'] ? parseInt(row['Age']) : null,
                      lastRenovation: null,
                      amenities: null,
                      medicationManagementFee: serviceLine.medicationManagement || null,
                      notes: JSON.stringify({
                        weight: roomType.weight || 0,
                        latitude,
                        longitude,
                        providerId: row['ID'],
                        providerNumber: row['Provider Number'],
                      }),
                    };

                    allRecords.push(record);
                    insertCounts[serviceLine.type as keyof typeof insertCounts] = (insertCounts[serviceLine.type as keyof typeof insertCounts] || 0) + 1;
                  }
                }
              } catch (error: any) {
                stats.failedImports++;
                stats.errors.push(`Row ${stats.successfulImports + stats.failedImports}: ${error.message}`);
              }
            }

          console.log(`\nPrepared ${allRecords.length} records for insertion`);
          console.log('Starting database transaction...');

          // Now do a single batch insert in a transaction
          await db.transaction(async (tx) => {
            await tx.delete(competitiveSurveyData).where(eq(competitiveSurveyData.surveyMonth, surveyMonth));
            console.log('Deleted old survey data');

            // Insert in batches of 1000 to avoid memory issues
            const batchSize = 1000;
            for (let i = 0; i < allRecords.length; i += batchSize) {
              const batch = allRecords.slice(i, i + batchSize);
              await tx.insert(competitiveSurveyData).values(batch);
              console.log(`Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allRecords.length / batchSize)}`);
            }
          });

          stats.successfulImports = allRecords.length;
          stats.mappedRecords = allRecords.length;

          // Log summary
          console.log('\n=== CSV Import Summary ===');
          console.log(`Records inserted by type:`);
          Object.entries(insertCounts).forEach(([type, count]) => {
            if (count > 0) console.log(`  ${type}: ${count}`);
          });
        } catch (txError: any) {
          stats.errors.push(`Transaction error: ${txError.message}`);
        }

        resolve(stats);
      },
      error: (error: Error) => {
        stats.errors.push(`CSV parsing error: ${error.message}`);
        resolve(stats);
      },
    });
  });
}

export async function importCompetitiveSurveyExcel(fileBuffer: Buffer, surveyMonth: string): Promise<ImportStats> {
  const stats: ImportStats = {
    totalRecords: 0,
    successfulImports: 0,
    failedImports: 0,
    mappedRecords: 0,
    unmappedRecords: 0,
    errors: [],
  };

  try {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const data: any[] = XLSX.utils.sheet_to_json(worksheet);

    stats.totalRecords = data.length;

    const insertCounts = { AL: 0, HC: 0, SMC: 0, MC: 0, IL: 0, 'AL/MC': 0, 'HC/MC': 0 };
    
    await db.transaction(async (tx) => {
      await tx.delete(competitiveSurveyData).where(eq(competitiveSurveyData.surveyMonth, surveyMonth));

      for (const row of data) {
        try {
          const trilogyCampus = row['TrilogyCampusName'] || '';
          const competitorName = row['CompetitorFacilityName'] || '';
          const address = row['Address'] || null;
          const latitude = row['Latitude'] || null;
          const longitude = row['Longitude'] || null;
          
          // Parse driving time to estimate distance (rough conversion: 1 min ≈ 1 mile at 60mph)
          let distanceMiles: number | null = null;
          if (row['DrivingTime']) {
            const timeMatch = String(row['DrivingTime']).match(/(\d+)/);
            if (timeMatch) {
              distanceMiles = parseInt(timeMatch[1]);
            }
          }

          // Service line definitions with their room type mappings
          const serviceLines = [
            {
              type: 'IL',
              flag: row['IL'],
              roomTypes: [
                // Support both old and new column name formats
                { name: 'Studio', rate: row['IL_StudioRate'] || row['IL_StudioPrivateRoomRate'], careLevel: row['IL_Comp_Care_Adj'], otherAdj: row['IL_Comp_Other_Adj'], weight: row['IL_Comp_Weight'] },
                { name: 'One Bedroom', rate: row['IL_OneBedRate'] || row['IL_1BRPrivateRoomRate'], careLevel: row['IL_Comp_Care_Adj'], otherAdj: row['IL_Comp_Other_Adj'], weight: row['IL_Comp_Weight'] },
                { name: 'Two Bedroom', rate: row['IL_TwoBedRate'] || row['IL_2BRPrivateRoomRate'], careLevel: row['IL_Comp_Care_Adj'], otherAdj: row['IL_Comp_Other_Adj'], weight: row['IL_Comp_Weight'] },
              ],
              occupancy: row['IL_Occupancy'],
              totalUnits: row['IL_TotalUnits'],
            },
            {
              type: 'AL',
              flag: row['AL'],
              roomTypes: [
                // Support both old and new column name formats
                { name: 'Studio', rate: row['AL_StudioRate'] || row['AL_StudioPrivateRoomRate'], careLevel: row['AL_Comp_Care_Adj'], otherAdj: row['AL_Comp_Other_Adj'], weight: row['AL_Comp_Weight'] },
                { name: 'Studio Dlx', rate: row['AL_StudioDlxRate'] || row['AL_StudioDeluxeRoomRate'], careLevel: row['AL_Comp_Care_Adj'], otherAdj: row['AL_Comp_Other_Adj'], weight: row['AL_Comp_Weight'] },
                { name: 'One Bedroom', rate: row['AL_OneBedRate'] || row['AL_1BRPrivateRoomRate'], careLevel: row['AL_Comp_Care_Adj'], otherAdj: row['AL_Comp_Other_Adj'], weight: row['AL_Comp_Weight'] },
                { name: 'Two Bedroom', rate: row['AL_TwoBedRate'] || row['AL_2BRPrivateRoomRate'], careLevel: row['AL_Comp_Care_Adj'], otherAdj: row['AL_Comp_Other_Adj'], weight: row['AL_Comp_Weight'] },
                { name: 'Companion', rate: row['AL_CompanionRate'] || row['AL_2ndPersonFee'], careLevel: row['AL_Comp_Care_Adj'], otherAdj: row['AL_Comp_Other_Adj'], weight: row['AL_Comp_Weight'] },
              ],
              occupancy: row['AL_Occupancy'],
              totalUnits: row['AL_TotalUnits'],
            },
            {
              type: 'HC',
              flag: row['HC'],
              roomTypes: [
                // Support both old and new column name formats
                { name: 'Studio', rate: row['HC_PrivateRoomRate'], careLevel: row['HC_Comp_Care_Adj'], otherAdj: row['HC_Comp_Other_Adj'], weight: row['HC_Comp_Weight'] },
                { name: 'Studio Dlx', rate: row['HC_PrivateDeluxeRoomRate'] || row['HC_PrivateDlxRoomRate'], careLevel: row['HC_Comp_Care_Adj'], otherAdj: row['HC_Comp_Other_Adj'], weight: row['HC_Comp_Weight'] },
                { name: 'Companion', rate: row['HC_CompanionSemiPrivateRoomRate'] || row['HC_2ndPersonFee'], careLevel: row['HC_Comp_Care_Adj'], otherAdj: row['HC_Comp_Other_Adj'], weight: row['HC_Comp_Weight'] },
              ],
              occupancy: row['HC_Occupancy'],
              totalUnits: row['HC_TotalUnits'],
            },
            {
              type: 'SMC',
              flag: row['SMC'],
              roomTypes: [
                { name: 'Studio', rate: row['SMC_PrivateRoomRate'], careLevel: row['SMC_Comp_Care_Adj'], otherAdj: row['SMC_Comp_Other_Adj'], weight: row['SMC_Comp_Weight'] },
                { name: 'Companion', rate: row['SMC_CompanionRoomRate'], careLevel: row['SMC_Comp_Care_Adj'], otherAdj: row['SMC_Comp_Other_Adj'], weight: row['SMC_Comp_Weight'] },
              ],
              occupancy: row['SMC_Occupancy'],
              totalUnits: row['SMC_TotalUnits'],
            },
            {
              type: 'MC',
              flag: row['MC'],
              roomTypes: [
                { name: 'Studio', rate: row['MC_StudioRate'], careLevel: row['MC_Comp_Care_Adj'], otherAdj: row['MC_Comp_Other_Adj'], weight: row['MC_Comp_Weight'] },
                { name: 'Companion', rate: row['MC_CompanionRate'], careLevel: row['MC_Comp_Care_Adj'], otherAdj: row['MC_Comp_Other_Adj'], weight: row['MC_Comp_Weight'] },
              ],
              occupancy: row['MC_Occupancy'],
              totalUnits: row['MC_TotalUnits'],
            },
            {
              type: 'AL/MC',
              flag: (row['AL'] === 'True' || row['AL'] === true || row['AL'] === 1) && 
                    (row['MC'] === 'True' || row['MC'] === true || row['MC'] === 1) ? 'True' : 'False',
              roomTypes: [
                { name: 'Studio', rate: row['AL/MC_StudioRate'], careLevel: row['AL/MC_Comp_Care_Adj'], otherAdj: row['AL/MC_Comp_Other_Adj'], weight: row['AL/MC_Comp_Weight'] },
                { name: 'Companion', rate: row['AL/MC_CompanionRate'], careLevel: row['AL/MC_Comp_Care_Adj'], otherAdj: row['AL/MC_Comp_Other_Adj'], weight: row['AL/MC_Comp_Weight'] },
              ],
              occupancy: null,
              totalUnits: null,
            },
            {
              type: 'HC/MC',
              flag: (row['HC'] === 'True' || row['HC'] === true || row['HC'] === 1) && 
                    (row['MC'] === 'True' || row['MC'] === true || row['MC'] === 1) ? 'True' : 'False',
              roomTypes: [
                { name: 'Studio', rate: row['HC/MC_PrivateRate'], careLevel: row['HC/MC_Comp_Care_Adj'], otherAdj: row['HC/MC_Comp_Other_Adj'], weight: row['HC/MC_Comp_Weight'] },
                { name: 'Companion', rate: row['HC/MC_CompanionRate'], careLevel: row['HC/MC_Comp_Care_Adj'], otherAdj: row['HC/MC_Comp_Other_Adj'], weight: row['HC/MC_Comp_Weight'] },
              ],
              occupancy: null,
              totalUnits: null,
            },
          ];

          // Helper function to check if a flag is "true" (handles string, boolean, number formats)
          const isFlagTrue = (flag: any): boolean => {
            if (flag === 'True' || flag === 'TRUE' || flag === true || flag === 1 || flag === '1') {
              return true;
            }
            return false;
          };

          // For each service line, create rows for each room type with a rate
          for (const serviceLine of serviceLines) {
            if (!isFlagTrue(serviceLine.flag)) {
              continue;
            }

            for (const roomType of serviceLine.roomTypes) {
              // Only create a row if there's a rate
              if (!roomType.rate || parseFloat(roomType.rate) === 0) {
                continue;
              }

              const record: InsertCompetitiveSurveyData = {
                surveyMonth,
                keyStatsLocation: trilogyCampus,
                competitorName,
                competitorAddress: address,
                distanceMiles,
                competitorType: serviceLine.type,
                roomType: roomType.name,
                squareFootage: null,
                monthlyRateLow: null,
                monthlyRateHigh: null,
                monthlyRateAvg: parseFloat(roomType.rate) || null,
                careFeesLow: null,
                careFeesHigh: null,
                careFeesAvg: parseFloat(roomType.careLevel) || null,
                totalMonthlyLow: null,
                totalMonthlyHigh: null,
                totalMonthlyAvg: null,
                communityFee: null,
                petFee: null,
                otherFees: parseFloat(roomType.otherAdj) || null,
                incentives: null,
                totalUnits: serviceLine.totalUnits ? parseInt(serviceLine.totalUnits) : null,
                occupancyRate: serviceLine.occupancy ? parseFloat(serviceLine.occupancy) : null,
                yearBuilt: row['Age'] ? parseInt(row['Age']) : null,
                lastRenovation: null,
                amenities: null,
                notes: JSON.stringify({
                  weight: roomType.weight || 0,
                  latitude,
                  longitude,
                  providerId: row['ID'],
                  providerNumber: row['Provider Number'],
                }),
              };

              await tx.insert(competitiveSurveyData).values(record);
              stats.successfulImports++;
              stats.mappedRecords++;
              insertCounts[serviceLine.type as keyof typeof insertCounts] = (insertCounts[serviceLine.type as keyof typeof insertCounts] || 0) + 1;
            }
          }
        } catch (error: any) {
          stats.failedImports++;
          stats.errors.push(`Row ${stats.successfulImports + stats.failedImports}: ${error.message}`);
        }
      }
    });
    
    // Log summary of what was inserted
    console.log('\n=== Import Summary ===');
    console.log(`Total rows processed: ${data.length}`);
    console.log(`Records inserted by type:`);
    Object.entries(insertCounts).forEach(([type, count]) => {
      if (count > 0) console.log(`  ${type}: ${count}`);
    });
    
  } catch (error: any) {
    stats.errors.push(`Excel parsing error: ${error.message}`);
  }

  return stats;
}

export async function autoMapLocations(): Promise<{ created: number; suggested: Array<{ source: string; targets: string[] }> }> {
  const enquireLocations = await db
    .selectDistinct({ location: enquireData.enquireLocation })
    .from(enquireData)
    .where(sql`${enquireData.mappedLocationId} IS NULL`);

  const allLocations = await db.select().from(locations);
  const created = 0;
  const suggested: Array<{ source: string; targets: string[] }> = [];

  for (const { location: enquireLoc } of enquireLocations) {
    const matches = fuzzyMatchLocation(enquireLoc, allLocations.map(l => l.name));
    
    if (matches.length > 0) {
      suggested.push({
        source: enquireLoc,
        targets: matches.slice(0, 3),
      });
    }
  }

  return { created, suggested };
}

function fuzzyMatchLocation(source: string, targets: string[]): string[] {
  const sourceLower = source.toLowerCase().trim();
  const scores: Array<{ target: string; score: number }> = [];

  for (const target of targets) {
    const targetLower = target.toLowerCase().trim();
    let score = 0;

    if (sourceLower === targetLower) {
      score = 100;
    } else if (sourceLower.includes(targetLower) || targetLower.includes(sourceLower)) {
      score = 80;
    } else {
      const sourceWords = sourceLower.split(/[\s-]+/);
      const targetWords = targetLower.split(/[\s-]+/);
      const matchingWords = sourceWords.filter(sw => targetWords.some(tw => tw.includes(sw) || sw.includes(tw)));
      score = (matchingWords.length / Math.max(sourceWords.length, targetWords.length)) * 70;
    }

    if (score > 30) {
      scores.push({ target, score });
    }
  }

  return scores.sort((a, b) => b.score - a.score).map(s => s.target);
}

function parseBoolean(value: any): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    return lower === 'true' || lower === 'yes' || lower === 'y' || lower === '1';
  }
  return false;
}

export async function importMatrixCareRentRollCSV(
  fileBuffer: Buffer,
  uploadMonth: string,
  fileName: string
): Promise<ImportStats> {
  const stats: ImportStats = {
    totalRecords: 0,
    successfulImports: 0,
    failedImports: 0,
    mappedRecords: 0,
    unmappedRecords: 0,
    errors: [],
  };

  // Helper function to normalize room types to standardized list
  const normalizeRoomType = (roomTypeInput: string): string => {
    const rt = (roomTypeInput || '').toLowerCase();
    
    // Check for Companion
    if (rt.includes('companion')) return 'Companion';
    
    // Check for Studio variations
    if (rt.includes('studio dlx') || rt.includes('studio deluxe')) return 'Studio Dlx';
    if (rt.includes('studio')) return 'Studio';
    
    // Check for bedroom variations
    if (rt.includes('two bedroom') || rt.includes('2 bedroom') || rt.includes('2br')) return 'Two Bedroom';
    if (rt.includes('one bedroom') || rt.includes('1 bedroom') || rt.includes('1br')) return 'One Bedroom';
    
    // Villa defaults to Two Bedroom if not specified otherwise
    if (rt.includes('villa') || rt.includes('patio')) return 'Two Bedroom';
    
    // Default fallback
    return 'Studio';
  };

  // Helper function to parse BedTypeDesc (e.g., "Studio;A Vw;A Loc;B Sz")
  const parseBedTypeDesc = (bedTypeDesc: string) => {
    const parts = (bedTypeDesc || '').split(';').map(p => p.trim());
    let size = '';
    let viewRating = null;
    let locationRating = null;
    let sizeRating = null;
    let view = null;

    for (const part of parts) {
      if (part.includes('Studio') || part.includes('Bedroom')) {
        size = part;
      } else if (part.includes(' Vw')) {
        viewRating = part.charAt(0); // Extract A, B, or C
        if (part.includes('A Vw')) view = 'Garden View';
        else if (part.includes('B Vw')) view = 'Courtyard View';
        else if (part.includes('C Vw')) view = 'Street View';
      } else if (part.includes(' Loc')) {
        locationRating = part.charAt(0); // Extract A, B, or C
      } else if (part.includes(' Sz')) {
        sizeRating = part.charAt(0); // Extract A, B, or C
      }
    }

    return { size: normalizeRoomType(size), view, viewRating, locationRating, sizeRating };
  };

  // Helper function to clean currency strings (e.g., "$329 " -> 329)
  const parseCurrency = (value: any): number => {
    if (!value) return 0;
    const cleaned = String(value).replace(/[\$,\s]/g, '');
    return parseFloat(cleaned) || 0;
  };

  // Helper function to map Service1 to service line (IL maps to SL per requirement)
  const mapServiceLine = (service1: string): string => {
    const svc = (service1 || '').toUpperCase();
    if (svc.includes('HC')) return 'HC';
    if (svc.includes('AL/MC') || (svc.includes('AL') && svc.includes('MC'))) return 'AL/MC';
    if (svc.includes('AL')) return 'AL';
    if (svc.includes('IL')) return 'SL'; // IL maps to SL per requirement
    if (svc.includes('MC')) return 'AL/MC';
    if (svc.includes('SL')) return 'SL';
    if (svc.includes('VIL') || svc.includes('VILLA') || svc.includes('VILLAGE')) return 'VIL'; // Village units
    if (svc.includes('PATIO')) return 'Patio Homes';
    return svc || 'AL'; // Default to AL if unknown
  };

  return new Promise((resolve) => {
    const fileContent = fileBuffer.toString('utf-8');

    Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
      complete: async (results: Papa.ParseResult<any>) => {
        stats.totalRecords = results.data.length;

        try {
          await db.transaction(async (tx) => {
            // Clear existing data for this month
            await tx.delete(rentRollHistory).where(eq(rentRollHistory.uploadMonth, uploadMonth));

            // Get all locations for mapping
            const allLocations = await tx.select().from(locations);
            const locationMap = new Map(allLocations.map(loc => [loc.name.toLowerCase(), loc.id]));

            // Track duplicates using location + serviceLine + roomNumber
            const seenUnits = new Set<string>();

            for (const row of results.data as any[]) {
              try {
                // Extract core fields
                const locationName = (row['location'] || '').trim();
                const locationId = locationMap.get(locationName.toLowerCase());
                const serviceLine = mapServiceLine(row['Service1']);
                const roomBed = row['Room_Bed'] || '';
                const roomNumber = roomBed.split('/')[0] || roomBed; // "101/A" -> "101"
                
                // Check for duplicates - use locationName as fallback to prevent cross-campus collisions
                const locationKey = locationId || locationName || 'unknown';
                const unitKey = `${locationKey}|${serviceLine}|${roomNumber}`;
                if (seenUnits.has(unitKey)) {
                  console.log(`Skipping duplicate: ${unitKey}`);
                  continue; // Skip duplicate
                }
                seenUnits.add(unitKey);

                // Determine occupancy
                const patientId = row['PatientID1'] || '';
                const bedSpecialization = row['BedSpecialization1'] || '';
                const isOccupied = patientId && patientId.trim() !== '' && bedSpecialization !== 'Available';

                // Parse BedTypeDesc
                const { size, view, viewRating, locationRating, sizeRating } = parseBedTypeDesc(row['BedTypeDesc']);

                // Parse rates - HC/HC-MC are daily, others are monthly
                // Store as-is without conversion (mixed storage model)
                const roomRate = parseCurrency(row['Room_Rate']);
                const locRate = parseCurrency(row['LOC_Rate']);
                const finalRate = parseCurrency(row['FinalRate']);
                const billedRate = parseCurrency(row['BilledRate']);

                const normalizedRoomType = normalizeRoomType(size);

                const record: InsertRentRollHistory = {
                  uploadMonth,
                  date: uploadMonth,
                  location: locationName,
                  locationId: locationId || null,
                  roomNumber,
                  roomType: normalizedRoomType,
                  serviceLine,
                  occupiedYN: isOccupied,
                  daysVacant: isOccupied ? 0 : 30, // Default to 30 days if vacant
                  preferredLocation: locationRating === 'A' ? 'Yes' : null,
                  size: normalizedRoomType,
                  view,
                  renovated: false, // Not available in MatrixCare export
                  otherPremiumFeature: row['BedSpecialization1'] || null,
                  locationRating,
                  sizeRating,
                  viewRating,
                  renovationRating: null,
                  amenityRating: null,
                  streetRate: roomRate,
                  inHouseRate: billedRate || roomRate,
                  discountToStreetRate: null,
                  careLevel: row['LevelOfCare1'] || row['ActualLevel1'] || null,
                  careRate: locRate,
                  rentAndCareRate: finalRate || (roomRate + locRate),
                  competitorRate: null,
                  competitorAvgCareRate: null,
                  competitorFinalRate: null,
                  residentId: patientId || null,
                  residentName: null, // Not available in this export
                  moveInDate: row['MoveInDate'] || null,
                  moveOutDate: row['MoveOutDate'] || null,
                  payorType: row['PayerName'] || row['DisplayPayer'] || null,
                  admissionStatus: null,
                  levelOfCare: row['LevelOfCare1'] || null,
                  medicaidRate: null,
                  medicareRate: null,
                  assessmentDate: null,
                  marketingSource: null,
                };

                await tx.insert(rentRollHistory).values(record);
                stats.successfulImports++;
                if (locationId) {
                  stats.mappedRecords++;
                } else {
                  stats.unmappedRecords++;
                }
              } catch (error: any) {
                stats.failedImports++;
                stats.errors.push(`Row ${stats.successfulImports + stats.failedImports}: ${error.message}`);
              }
            }
          });
        } catch (txError: any) {
          stats.errors.push(`Transaction error: ${txError.message}`);
        }

        resolve(stats);
      },
      error: (error: Error) => {
        stats.errors.push(`CSV parsing error: ${error.message}`);
        resolve(stats);
      },
    });
  });
}

export async function syncHistoryToCurrentRentRoll(uploadMonth: string): Promise<{ synced: number }> {
  return await db.transaction(async (tx) => {
    const historyRecords = await tx
      .select()
      .from(rentRollHistory)
      .where(eq(rentRollHistory.uploadMonth, uploadMonth));

    await tx.delete(rentRollData).where(eq(rentRollData.uploadMonth, uploadMonth));

    let synced = 0;
    for (const record of historyRecords) {
      await tx.insert(rentRollData).values({
        uploadMonth: record.uploadMonth,
        date: record.date,
        location: record.location,
        locationId: record.locationId,
        roomNumber: record.roomNumber,
        roomType: record.roomType,
        serviceLine: record.serviceLine,
        occupiedYN: record.occupiedYN,
        daysVacant: record.daysVacant,
        preferredLocation: record.preferredLocation,
        size: record.size,
        view: record.view,
        renovated: record.renovated,
        otherPremiumFeature: record.otherPremiumFeature,
        locationRating: record.locationRating,
        sizeRating: record.sizeRating,
        viewRating: record.viewRating,
        renovationRating: record.renovationRating,
        amenityRating: record.amenityRating,
        streetRate: record.streetRate,
        inHouseRate: record.inHouseRate,
        discountToStreetRate: record.discountToStreetRate,
        careLevel: record.careLevel,
        careRate: record.careRate,
        rentAndCareRate: record.rentAndCareRate,
        competitorRate: record.competitorRate,
        competitorAvgCareRate: record.competitorAvgCareRate,
        competitorFinalRate: record.competitorFinalRate,
        moduloSuggestedRate: null,
        moduloCalculationDetails: null,
        aiSuggestedRate: null,
        aiCalculationDetails: null,
        promotionAllowance: null,
        residentId: record.residentId,
        residentName: record.residentName,
        moveInDate: record.moveInDate,
        moveOutDate: record.moveOutDate,
        payorType: record.payorType,
        admissionStatus: record.admissionStatus,
        levelOfCare: record.levelOfCare,
        medicaidRate: record.medicaidRate,
        medicareRate: record.medicareRate,
        assessmentDate: record.assessmentDate,
        marketingSource: record.marketingSource,
        inquiryCount: 0,
        tourCount: 0,
      });
      synced++;
    }

    return { synced };
  });
}
