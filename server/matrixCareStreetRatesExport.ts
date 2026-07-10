import { db } from "./db";
import { locations, rentRollData } from "@shared/schema";
import { inArray } from "drizzle-orm";
import {
  safeExportDate,
  fuzzyMapRoomType,
  fuzzyMapServiceLine,
  getPayerConfigurations,
  getRevenueAccount,
} from './matrixCareFuzzyMatch';
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

export async function generateStreetRatesExport(
  selectedCampuses?: string[],
  exportDate?: string | null
): Promise<string> {
  // Always produce a valid date, never empty
  const effectiveDate = safeExportDate(exportDate);

  const allLocations = await db.select().from(locations);
  const campusesToExport = selectedCampuses && selectedCampuses.length > 0
    ? allLocations.filter(loc => selectedCampuses.includes(loc.name))
    : allLocations;

  const rentRollRecords = await db.select()
    .from(rentRollData)
    .where(inArray(rentRollData.locationId, campusesToExport.map(loc => loc.id)));

  // Group by location + service line → collect rates
  const ratesByLocationAndService = new Map<string, Map<string, number[]>>();
  for (const record of rentRollRecords) {
    const location = campusesToExport.find(loc => loc.id === record.locationId);
    if (!location) continue;
    if (!ratesByLocationAndService.has(location.name))
      ratesByLocationAndService.set(location.name, new Map());
    const serviceMap = ratesByLocationAndService.get(location.name)!;
    if (!serviceMap.has(record.serviceLine)) serviceMap.set(record.serviceLine, []);
    const rate = record.moduloSuggestedRate || record.streetRate || 0;
    serviceMap.get(record.serviceLine)!.push(rate);
  }

  const streetRateRecords: StreetRateRecord[] = [];

  for (const location of campusesToExport) {
    const serviceRates = ratesByLocationAndService.get(location.name);
    if (!serviceRates) continue;

    for (const [serviceLine, rates] of Array.from(serviceRates.entries())) {
      const avgRate = rates.reduce((s, r) => s + r, 0) / rates.length;

      let matrixCareName: string | undefined;
      let customerId: string | undefined;
      const sl = serviceLine.toUpperCase();

      if (sl === 'HC' || sl === 'HC/MC' || sl === 'SNF') {
        matrixCareName = location.matrixCareNameHC || getMatrixCareNameFromKeyStats(location.name, 'HC');
        customerId    = location.customerFacilityIdHC || getCustomerFacilityId(location.name, 'HC');
      } else if (sl === 'AL' || sl === 'AL/MC' || sl === 'MC') {
        matrixCareName = location.matrixCareNameAL || getMatrixCareNameFromKeyStats(location.name, 'AL');
        customerId    = location.customerFacilityIdAL || getCustomerFacilityId(location.name, 'AL');
      } else if (sl === 'SL') {
        matrixCareName = location.matrixCareNameIL || getMatrixCareNameFromKeyStats(location.name, 'IL');
        customerId    = location.customerFacilityIdIL || getCustomerFacilityId(location.name, 'IL');
      } else if (sl === 'VIL') {
        matrixCareName = location.matrixCareNameAL || getMatrixCareNameFromKeyStats(location.name, 'AL');
        customerId    = location.customerFacilityIdAL || getCustomerFacilityId(location.name, 'AL');
      }

      if (!matrixCareName || !customerId) continue;

      const levelOfCare = fuzzyMapServiceLine(serviceLine);
      const payers = getPayerConfigurations(serviceLine);
      const bedTypes = ['Private', 'Semi-Private', 'Companion'];

      for (const bedType of bedTypes) {
        const mappedBedType = fuzzyMapRoomType(bedType);
        for (const payer of payers) {
          // Normalise rate to payer charge frequency
          let adjustedRate = avgRate;
          const isMonthly = sl === 'AL' || sl === 'AL/MC' || sl === 'MC' || sl === 'SL' || sl === 'VIL';
          if (payer.payerChargeBy === 'Daily' && isMonthly) {
            adjustedRate = avgRate / 30.5;
          } else if (payer.payerChargeBy === 'Monthly' && (sl === 'HC' || sl === 'HC/MC' || sl === 'SNF')) {
            adjustedRate = avgRate * 30.5;
          }

          const revenueAccount = getRevenueAccount(serviceLine, payer.payerName);

          streetRateRecords.push({
            facilityName:            matrixCareName,
            facilityCustomerId:      `~${customerId}`,
            bedTypeDescription:      mappedBedType,
            levelOfCare:             levelOfCare,
            roomChargeDescription:   'ROOM CHARGE',
            basePriceBeginDate:      effectiveDate,   // always populated
            basePrice:               Math.round(adjustedRate * 100) / 100,
            basePriceChargeBy:       payer.payerChargeBy,
            payerBeginDate:          effectiveDate,   // always populated
            payerName:               payer.payerName,
            payerChargeBy:           payer.payerChargeBy,
            proration:               payer.proration,
            revenueCode:             '',
            allowableCharge:         0,
            allowablePercent:        payer.payerName.toUpperCase().includes('MEDICAID') ? 0 : 100,
            hospBedHoldRate:         0,
            hospBedHoldPercent:      payer.payerName.toUpperCase().includes('MEDICAID') ? 0 : 100,
            therBedHoldRate:         0,
            therBedHoldPercent:      payer.payerName.toUpperCase().includes('MEDICAID') ? 0 : 100,
            revenueAccount:          revenueAccount,
            contractualAccount:      revenueAccount,
            copayContractualAccount: revenueAccount,
          });
        }
      }
    }
  }

  const csvData = await new Promise<string>((resolve, reject) => {
    stringify(streetRateRecords, {
      header: true,
      columns: [
        'FacilityName', 'FacilityCustomerID', 'BedTypeDescription', 'LevelofCare',
        'RoomChargeDescription', 'BasePriceBeginDate', 'BasePrice', 'BasePriceChargeBy',
        'PayerBeginDate', 'PayerName', 'PayerChargeBy', 'Proration', 'RevenueCode',
        'AllowableCharge', 'AllowablePercent', 'HospBedHoldRate', 'HospBedHoldPercent',
        'TherBedHoldRate', 'TherBedHoldPercent', 'RevenueAccount', 'ContractualAccount',
        'CopayContractualAccount',
      ],
    }, (err, output) => { if (err) reject(err); else resolve(output); });
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `/tmp/CORPORATEROOMCHARGESEXPORT_Trilogy_${timestamp}.CSV`;
  await fs.writeFile(filename, csvData, 'utf8');
  return filename;
}

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

    const requiredHeaders = ['FacilityName', 'BasePrice', 'PayerName', 'LevelofCare'];
    for (const h of requiredHeaders) {
      if (!headers.some(x => x.includes(h))) errors.push(`Missing required column: ${h}`);
    }

    for (let i = 1; i < lines.length - 1; i++) {
      const values = lines[i].split(',');
      if (values.length < headers.length) continue;

      const facilityName = values[0];
      const basePrice    = parseFloat(values[6]);
      const payerName    = values[9];
      const levelOfCare  = values[3];
      const baseDate     = values[5];
      const payerDate    = values[8];

      facilities.add(facilityName);
      payerTypes.add(payerName);

      const loc = levelOfCare.toUpperCase();
      if (loc.includes('AL'))          serviceLines.add('AL');
      else if (loc.includes('SKILLED') || loc.includes('INTERMEDIATE')) serviceLines.add('HC');
      else if (loc.includes('IL') || loc.includes('SL')) serviceLines.add('SL');
      else if (loc.includes('VIL'))    serviceLines.add('VIL');

      if (!isNaN(basePrice)) { totalRate += basePrice; rateCount++; }

      if (!facilityName) errors.push(`Row ${i}: Missing facility name`);
      if (isNaN(basePrice) || basePrice <= 0) warnings.push(`Row ${i}: Invalid base price: ${values[6]}`);
      if (basePrice > 20000) warnings.push(`Row ${i}: Unusually high base price: $${basePrice}`);
      if (!baseDate || baseDate.trim() === '') errors.push(`Row ${i}: Missing BasePriceBeginDate`);
      if (!payerDate || payerDate.trim() === '') errors.push(`Row ${i}: Missing PayerBeginDate`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      summary: {
        totalRecords: lines.length - 2,
        facilities:   facilities.size,
        serviceLines: Array.from(serviceLines),
        payerTypes:   Array.from(payerTypes),
        avgRate:      rateCount > 0 ? totalRate / rateCount : 0,
      },
    };
  } catch (error) {
    return {
      isValid: false,
      errors:   [`Failed to validate file: ${error instanceof Error ? error.message : String(error)}`],
      warnings: [],
      summary:  { totalRecords: 0, facilities: 0, serviceLines: [], payerTypes: [], avgRate: 0 },
    };
  }
}
