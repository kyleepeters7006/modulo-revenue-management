import { db } from "./db";
import { locations, rentRollData, streetRates } from "@shared/schema";
import { eq, sql, and, inArray } from "drizzle-orm";
import { campusMapping, getMatrixCareNameFromKeyStats, getCustomerFacilityId } from "./campusMapping";
import { stringify } from 'csv-stringify';
import { promises as fs } from 'fs';

interface StreetRateRecord {
  facilityName: string;
  facilityCustomerId: string;
  bedTypeDescription: string;
  levelOfCare: string;
  roomChargeDescription: string;
  basePriceBeginDate: string;
  basePrice: number;
  basePriceChargeBy: string;
  payerBeginDate: string;
  payerName: string;
  payerChargeBy: string;
  proration: string;
  revenueCode: string;
  allowableCharge: number;
  allowablePercent: number;
  hospBedHoldRate: number;
  hospBedHoldPercent: number;
  therBedHoldRate: number;
  therBedHoldPercent: number;
  revenueAccount: string;
  contractualAccount: string;
  copayContractualAccount: string;
}

// Map service lines to MatrixCare level of care descriptions
const getLevelOfCareDescription = (serviceLine: string): string => {
  const mapping: { [key: string]: string } = {
    'AL': 'BASE RATE - AL',
    'AL/MC': 'BASE RATE - AL MEMORY CARE',
    'HC': 'BASE RATE - INTERMEDIATE',
    'HC/MC': 'BASE RATE - SKILLED',
    'SL': 'BASE RATE - SL',
    'VIL': 'BASE RATE - VIL'
  };
  return mapping[serviceLine] || 'BASE RATE - AL';
};

// Map room types to bed type descriptions
const getBedTypeDescription = (roomType: string): string => {
  const mapping: { [key: string]: string } = {
    'Private': 'Private',
    'Semi-Private': 'Semi-Private',
    'Studio': 'Private',
    'One Bedroom': 'Private',
    'Two Bedroom': 'Private',
    'Companion': 'Companion'
  };
  return mapping[roomType] || 'Private';
};

// Get payer configurations for different service lines
const getPayerConfigurations = (serviceLine: string) => {
  if (serviceLine === 'HC' || serviceLine === 'HC/MC') {
    return [
      { payerName: 'Private HCC', payerChargeBy: 'Daily', proration: 'None' },
      { payerName: 'Hospice Private', payerChargeBy: 'Daily', proration: 'None' },
      { payerName: 'Medicaid IN', payerChargeBy: 'Daily', proration: 'None' },
      { payerName: 'Medicare A', payerChargeBy: 'Daily', proration: 'None' },
      { payerName: 'Insurance FFS', payerChargeBy: 'Daily', proration: 'None' }
    ];
  } else if (serviceLine === 'AL' || serviceLine === 'AL/MC') {
    return [
      { payerName: 'Private AL', payerChargeBy: 'Monthly', proration: 'Annually' },
      { payerName: 'Hospice Private', payerChargeBy: 'Monthly', proration: 'Annually' },
      { payerName: 'Medicaid AL', payerChargeBy: 'Daily', proration: 'None' }
    ];
  } else if (serviceLine === 'SL') {
    return [
      { payerName: 'Private SL', payerChargeBy: 'Monthly', proration: 'Annually' }
    ];
  } else if (serviceLine === 'VIL') {
    return [
      { payerName: 'Private VIL', payerChargeBy: 'Monthly', proration: 'Annually' }
    ];
  }
  return [{ payerName: 'Private', payerChargeBy: 'Monthly', proration: 'Annually' }];
};

// Get revenue account codes based on service line and payer
const getRevenueAccount = (serviceLine: string, payerName: string): string => {
  // HC/SNF accounts
  if (serviceLine === 'HC' || serviceLine === 'HC/MC') {
    if (payerName.includes('Private')) return '~C01-41010';
    if (payerName.includes('Medicaid')) return '~C01-41020';
    if (payerName.includes('Medicare')) return '~C01-41030';
    if (payerName.includes('Insurance')) return '~C01-41050';
    if (payerName.includes('Hospice')) return '~C01-41070';
  }
  // AL accounts
  else if (serviceLine === 'AL' || serviceLine === 'AL/MC') {
    if (payerName.includes('Private')) return '~C03-41010';
    if (payerName.includes('Medicaid')) return '~C03-41020';
    if (payerName.includes('Hospice')) return '~C03-41010';
  }
  // SL accounts
  else if (serviceLine === 'SL') {
    return '~C04-41010';
  }
  // VIL accounts
  else if (serviceLine === 'VIL') {
    return '~C04-41010';
  }
  
  return '~C03-41010'; // Default to AL private
};

export async function generateStreetRatesExport(selectedCampuses?: string[]): Promise<string> {
  try {
    // Fetch all locations
    const allLocations = await db.select().from(locations);
    
    // Filter to selected campuses or use all
    const campusesToExport = selectedCampuses && selectedCampuses.length > 0
      ? allLocations.filter(loc => selectedCampuses.includes(loc.name))
      : allLocations;

    // Fetch rent roll data for selected locations
    const rentRollRecords = await db.select()
      .from(rentRollData)
      .where(
        inArray(
          rentRollData.locationId,
          campusesToExport.map(loc => loc.id)
        )
      );

    const streetRateRecords: StreetRateRecord[] = [];
    const today = new Date();
    const effectiveDate = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`;

    // Group rent roll data by location and service line to calculate average rates
    const ratesByLocationAndService = new Map<string, Map<string, number[]>>();
    
    for (const record of rentRollRecords) {
      const location = campusesToExport.find(loc => loc.id === record.locationId);
      if (!location) continue;

      const key = `${location.name}_${record.serviceLine}`;
      if (!ratesByLocationAndService.has(location.name)) {
        ratesByLocationAndService.set(location.name, new Map());
      }
      const serviceMap = ratesByLocationAndService.get(location.name)!;
      if (!serviceMap.has(record.serviceLine)) {
        serviceMap.set(record.serviceLine, []);
      }
      
      // Use Modulo suggested rate if available, otherwise street rate
      const rate = record.moduloSuggestedRate || record.streetRate;
      serviceMap.get(record.serviceLine)!.push(rate);
    }

    // Generate street rates for each location and service line
    for (const location of campusesToExport) {
      const serviceRates = ratesByLocationAndService.get(location.name);
      if (!serviceRates) continue;

      for (const [serviceLine, rates] of Array.from(serviceRates.entries())) {
        // Calculate average rate for this service line
        const avgRate = rates.reduce((sum: number, rate: number) => sum + rate, 0) / rates.length;
        
        // Get MatrixCare facility name based on service line
        let matrixCareName: string | undefined;
        let customerId: string | undefined;
        
        if (serviceLine === 'HC' || serviceLine === 'HC/MC') {
          matrixCareName = location.matrixCareNameHC || getMatrixCareNameFromKeyStats(location.name, 'HC');
          customerId = location.customerFacilityIdHC || getCustomerFacilityId(location.name, 'HC');
        } else if (serviceLine === 'AL' || serviceLine === 'AL/MC') {
          matrixCareName = location.matrixCareNameAL || getMatrixCareNameFromKeyStats(location.name, 'AL');
          customerId = location.customerFacilityIdAL || getCustomerFacilityId(location.name, 'AL');
        } else if (serviceLine === 'SL') {
          matrixCareName = location.matrixCareNameIL || getMatrixCareNameFromKeyStats(location.name, 'IL');
          customerId = location.customerFacilityIdIL || getCustomerFacilityId(location.name, 'IL');
        } else if (serviceLine === 'VIL') {
          // Village units use the AL facility name or a generic name
          matrixCareName = location.matrixCareNameAL || getMatrixCareNameFromKeyStats(location.name, 'AL');
          customerId = location.customerFacilityIdAL || getCustomerFacilityId(location.name, 'AL');
        }

        if (!matrixCareName || !customerId) continue;

        // Get bed types for this service line
        const bedTypes = ['Private', 'Semi-Private', 'Companion'];
        
        for (const bedType of bedTypes) {
          const payers = getPayerConfigurations(serviceLine);
          
          for (const payer of payers) {
            // Adjust rate based on charge frequency
            let adjustedRate = avgRate;
            if (payer.payerChargeBy === 'Daily' && (serviceLine === 'AL' || serviceLine === 'AL/MC' || serviceLine === 'SL' || serviceLine === 'VIL')) {
              adjustedRate = avgRate / 30.5; // Convert monthly to daily
            } else if (payer.payerChargeBy === 'Monthly' && (serviceLine === 'HC' || serviceLine === 'HC/MC')) {
              adjustedRate = avgRate * 30.5; // Convert daily to monthly
            }

            const revenueAccount = getRevenueAccount(serviceLine, payer.payerName);
            
            streetRateRecords.push({
              facilityName: matrixCareName,
              facilityCustomerId: `~${customerId}`,
              bedTypeDescription: getBedTypeDescription(bedType),
              levelOfCare: getLevelOfCareDescription(serviceLine),
              roomChargeDescription: 'ROOM CHARGE',
              basePriceBeginDate: effectiveDate,
              basePrice: Math.round(adjustedRate * 100) / 100,
              basePriceChargeBy: payer.payerChargeBy,
              payerBeginDate: effectiveDate,
              payerName: payer.payerName,
              payerChargeBy: payer.payerChargeBy,
              proration: payer.proration,
              revenueCode: '',
              allowableCharge: 0,
              allowablePercent: payer.payerName.includes('Medicaid') ? 0 : 100,
              hospBedHoldRate: 0,
              hospBedHoldPercent: payer.payerName.includes('Medicaid') ? 0 : 100,
              therBedHoldRate: 0,
              therBedHoldPercent: payer.payerName.includes('Medicaid') ? 0 : 100,
              revenueAccount: revenueAccount,
              contractualAccount: revenueAccount,
              copayContractualAccount: revenueAccount
            });
          }
        }
      }
    }

    // Convert to CSV
    const csvData = await new Promise<string>((resolve, reject) => {
      stringify(streetRateRecords, {
        header: true,
        columns: [
          'FacilityName',
          'FacilityCustomerID',
          'BedTypeDescription',
          'LevelofCare',
          'RoomChargeDescription',
          'BasePriceBeginDate',
          'BasePrice',
          'BasePriceChargeBy',
          'PayerBeginDate',
          'PayerName',
          'PayerChargeBy',
          'Proration',
          'RevenueCode',
          'AllowableCharge',
          'AllowablePercent',
          'HospBedHoldRate',
          'HospBedHoldPercent',
          'TherBedHoldRate',
          'TherBedHoldPercent',
          'RevenueAccount',
          'ContractualAccount',
          'CopayContractualAccount'
        ]
      }, (err, output) => {
        if (err) reject(err);
        else resolve(output);
      });
    });

    // Save to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `/tmp/CORPORATEROOMCHARGESEXPORT_Trilogy_${timestamp}.CSV`;
    await fs.writeFile(filename, csvData, 'utf8');
    
    return filename;
  } catch (error) {
    console.error('Error generating street rates export:', error);
    throw error;
  }
}

// Helper function to validate export data
export async function validateStreetRatesExport(filepath: string): Promise<{
  isValid: boolean;
  errors: string[];
  warnings: string[];
  summary: {
    totalRecords: number;
    facilities: number;
    serviceLines: string[];
    payerTypes: string[];
    avgRate: number;
  };
}> {
  try {
    const csvContent = await fs.readFile(filepath, 'utf8');
    const lines = csvContent.split('\n');
    const headers = lines[0].split(',');
    
    const errors: string[] = [];
    const warnings: string[] = [];
    const facilities = new Set<string>();
    const serviceLines = new Set<string>();
    const payerTypes = new Set<string>();
    let totalRate = 0;
    let rateCount = 0;
    
    // Validate headers
    const requiredHeaders = ['FacilityName', 'BasePrice', 'PayerName', 'LevelofCare'];
    for (const header of requiredHeaders) {
      if (!headers.some(h => h.includes(header))) {
        errors.push(`Missing required column: ${header}`);
      }
    }
    
    // Process data rows
    for (let i = 1; i < lines.length - 1; i++) { // Skip header and empty last line
      const values = lines[i].split(',');
      if (values.length < headers.length) continue;
      
      const facilityName = values[0];
      const basePrice = parseFloat(values[6]);
      const payerName = values[9];
      const levelOfCare = values[3];
      
      facilities.add(facilityName);
      payerTypes.add(payerName);
      
      if (levelOfCare.includes('AL')) serviceLines.add('AL');
      else if (levelOfCare.includes('SKILLED') || levelOfCare.includes('INTERMEDIATE')) serviceLines.add('HC');
      else if (levelOfCare.includes('IL')) serviceLines.add('SL');
      else if (levelOfCare.includes('SL')) serviceLines.add('SL');
      else if (levelOfCare.includes('VIL')) serviceLines.add('VIL');
      
      if (!isNaN(basePrice)) {
        totalRate += basePrice;
        rateCount++;
      }
      
      // Validation checks
      if (!facilityName || facilityName === '') {
        errors.push(`Row ${i}: Missing facility name`);
      }
      if (isNaN(basePrice) || basePrice <= 0) {
        warnings.push(`Row ${i}: Invalid base price: ${values[6]}`);
      }
      if (basePrice > 20000) {
        warnings.push(`Row ${i}: Unusually high base price: $${basePrice}`);
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      summary: {
        totalRecords: lines.length - 2, // Exclude header and empty last line
        facilities: facilities.size,
        serviceLines: Array.from(serviceLines),
        payerTypes: Array.from(payerTypes),
        avgRate: rateCount > 0 ? totalRate / rateCount : 0
      }
    };
  } catch (error) {
    return {
      isValid: false,
      errors: [`Failed to validate file: ${error instanceof Error ? error.message : String(error)}`],
      warnings: [],
      summary: {
        totalRecords: 0,
        facilities: 0,
        serviceLines: [],
        payerTypes: [],
        avgRate: 0
      }
    };
  }
}