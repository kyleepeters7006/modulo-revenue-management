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
                  roomType: row['Room Type'] || row['room_type'] || '',
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
                  payorType: row['Payor Type'] || row['payor_type'] || null,
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
    const fileContent = fileBuffer.toString('utf-8');

    Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
      complete: async (results: Papa.ParseResult<any>) => {
        stats.totalRecords = results.data.length;

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
                const enquireLocation = row['Location'] || row['location'] || row['Facility'] || row['facility'] || '';
                const mapping = mappingMap.get(enquireLocation.toLowerCase());

                const record: InsertEnquireData = {
                  dataSource,
                  enquireLocation,
                  mappedLocationId: mapping?.targetLocationId || null,
                  mappedServiceLine: mapping?.defaultServiceLine || null,
                  inquiryId: row['Inquiry ID'] || row['inquiry_id'] || row['ID'] || row['id'] || null,
                  inquiryDate: row['Inquiry Date'] || row['inquiry_date'] || row['Date'] || row['date'] || null,
                  tourDate: row['Tour Date'] || row['tour_date'] || null,
                  moveInDate: row['Move In Date'] || row['move_in_date'] || null,
                  leadSource: row['Lead Source'] || row['lead_source'] || row['Source'] || row['source'] || null,
                  leadStatus: row['Lead Status'] || row['lead_status'] || row['Status'] || row['status'] || null,
                  prospectName: row['Prospect Name'] || row['prospect_name'] || row['Name'] || row['name'] || null,
                  careNeeds: row['Care Needs'] || row['care_needs'] || null,
                  budgetRange: row['Budget Range'] || row['budget_range'] || null,
                  desiredMoveInDate: row['Desired Move In Date'] || row['desired_move_in_date'] || null,
                  roomTypePreference: row['Room Type'] || row['room_type'] || null,
                  notes: row['Notes'] || row['notes'] || null,
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

    await db.transaction(async (tx) => {
      await tx.delete(competitiveSurveyData).where(eq(competitiveSurveyData.surveyMonth, surveyMonth));

      for (const row of data) {
      try {
        const record: InsertCompetitiveSurveyData = {
          surveyMonth,
          keyStatsLocation: row['KeyStats Location'] || row['keystats_location'] || row['Location'] || '',
          competitorName: row['Competitor Name'] || row['competitor_name'] || row['Name'] || '',
          competitorAddress: row['Competitor Address'] || row['competitor_address'] || row['Address'] || null,
          distanceMiles: parseFloat(row['Distance (Miles)'] || row['distance_miles']) || null,
          competitorType: row['Competitor Type'] || row['competitor_type'] || row['Type'] || null,
          roomType: row['Room Type'] || row['room_type'] || null,
          squareFootage: parseInt(row['Square Footage'] || row['square_footage'] || row['sqft']) || null,
          monthlyRateLow: parseFloat(row['Monthly Rate Low'] || row['monthly_rate_low']) || null,
          monthlyRateHigh: parseFloat(row['Monthly Rate High'] || row['monthly_rate_high']) || null,
          monthlyRateAvg: parseFloat(row['Monthly Rate Avg'] || row['monthly_rate_avg']) || null,
          careFeesLow: parseFloat(row['Care Fees Low'] || row['care_fees_low']) || null,
          careFeesHigh: parseFloat(row['Care Fees High'] || row['care_fees_high']) || null,
          careFeesAvg: parseFloat(row['Care Fees Avg'] || row['care_fees_avg']) || null,
          totalMonthlyLow: parseFloat(row['Total Monthly Low'] || row['total_monthly_low']) || null,
          totalMonthlyHigh: parseFloat(row['Total Monthly High'] || row['total_monthly_high']) || null,
          totalMonthlyAvg: parseFloat(row['Total Monthly Avg'] || row['total_monthly_avg']) || null,
          communityFee: parseFloat(row['Community Fee'] || row['community_fee']) || null,
          petFee: parseFloat(row['Pet Fee'] || row['pet_fee']) || null,
          otherFees: parseFloat(row['Other Fees'] || row['other_fees']) || null,
          incentives: row['Incentives'] || row['incentives'] || null,
          totalUnits: parseInt(row['Total Units'] || row['total_units']) || null,
          occupancyRate: parseFloat(row['Occupancy Rate'] || row['occupancy_rate']) || null,
          yearBuilt: parseInt(row['Year Built'] || row['year_built']) || null,
          lastRenovation: parseInt(row['Last Renovation'] || row['last_renovation']) || null,
          amenities: row['Amenities'] || row['amenities'] || null,
          notes: row['Notes'] || row['notes'] || null,
        };

          await tx.insert(competitiveSurveyData).values(record);
          stats.successfulImports++;
          stats.mappedRecords++;
        } catch (error: any) {
          stats.failedImports++;
          stats.errors.push(`Row ${stats.successfulImports + stats.failedImports}: ${error.message}`);
        }
      }
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

    return { size, view, viewRating, locationRating, sizeRating };
  };

  // Helper function to clean currency strings (e.g., "$329 " -> 329)
  const parseCurrency = (value: any): number => {
    if (!value) return 0;
    const cleaned = String(value).replace(/[\$,\s]/g, '');
    return parseFloat(cleaned) || 0;
  };

  // Helper function to map Service1 to service line
  const mapServiceLine = (service1: string): string => {
    const svc = (service1 || '').toUpperCase();
    if (svc.includes('HC')) return 'HC';
    if (svc.includes('AL')) return 'AL';
    if (svc.includes('IL')) return 'IL';
    if (svc.includes('MC')) return 'AL/MC';
    if (svc.includes('SL')) return 'SL';
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
                
                // Check for duplicates
                const unitKey = `${locationId || locationName}|${serviceLine}|${roomNumber}`;
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

                // Parse rates
                const roomRate = parseCurrency(row['Room_Rate']);
                const locRate = parseCurrency(row['LOC_Rate']);
                const finalRate = parseCurrency(row['FinalRate']);
                const billedRate = parseCurrency(row['BilledRate']);

                const record: InsertRentRollHistory = {
                  uploadMonth,
                  date: uploadMonth,
                  location: locationName,
                  locationId: locationId || null,
                  roomNumber,
                  roomType: size || 'Studio',
                  serviceLine,
                  occupiedYN: isOccupied,
                  daysVacant: isOccupied ? 0 : 30, // Default to 30 days if vacant
                  preferredLocation: locationRating === 'A' ? 'Yes' : null,
                  size: size || 'Studio',
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
