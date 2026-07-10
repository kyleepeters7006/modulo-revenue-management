import { db } from "./db";
import { locations, rentRollData } from "@shared/schema";
import { and, inArray, isNotNull, eq } from "drizzle-orm";
import {
  safeExportDate,
  getSpecialRatesPayerName,
} from './matrixCareFuzzyMatch';
import { campusMapping, getMatrixCareNameFromKeyStats, getCustomerFacilityId } from "./campusMapping";
import { stringify } from 'csv-stringify';
import { promises as fs } from 'fs';

interface SpecialRateRecord {
  facilityName: string;
  residentId: string;
  residentName: string;
  beginDate: string;
  endDate: string;
  payerName: string;
  proration: number;
  spclRate: number;
  amount: number;
  pct: number;
  monthly: number;
  hospHold: number;
  hospHoldAmount: number;
  hospPct: number;
  hospHoldMonthly: number;
  therLv: number;
  therLvHoldAmount: number;
  therLvPct: number;
  therLvHoldMonthly: number;
}

export async function generateSpecialRatesExport(
  selectedCampuses?: string[],
  exportDate?: string | null
): Promise<string> {
  // Always produce a valid begin date, never empty
  const beginDate = safeExportDate(exportDate);
  const endDate   = '12/31/2099'; // far-future sentinel for ongoing special rates

  const allLocations = await db.select().from(locations);
  const campusesToExport = selectedCampuses && selectedCampuses.length > 0
    ? allLocations.filter(loc => selectedCampuses.includes(loc.name))
    : allLocations;

  const occupiedUnits = await db.select()
    .from(rentRollData)
    .where(
      and(
        inArray(rentRollData.locationId, campusesToExport.map(loc => loc.id)),
        eq(rentRollData.occupiedYN, true),
        isNotNull(rentRollData.residentId),
      )
    );

  const specialRateRecords: SpecialRateRecord[] = [];

  for (const unit of occupiedUnits) {
    const location = campusesToExport.find(loc => loc.id === unit.locationId);
    if (!location) continue;

    let matrixCareName: string | undefined;
    const sl = (unit.serviceLine || '').toUpperCase();

    if (sl === 'HC' || sl === 'HC/MC' || sl === 'SNF') {
      matrixCareName = location.matrixCareNameHC || getMatrixCareNameFromKeyStats(location.name, 'HC');
    } else if (sl === 'AL' || sl === 'AL/MC' || sl === 'MC') {
      matrixCareName = location.matrixCareNameAL || getMatrixCareNameFromKeyStats(location.name, 'AL');
    } else if (sl === 'SL') {
      matrixCareName = location.matrixCareNameIL || getMatrixCareNameFromKeyStats(location.name, 'IL');
    } else if (sl === 'VIL') {
      matrixCareName = location.matrixCareNameAL
        || getMatrixCareNameFromKeyStats(location.name, 'AL')
        || `${location.name} VIL`;
    }

    if (!matrixCareName) continue;

    // Use fuzzy payer mapping so non-standard service-line strings still resolve
    const payerName = getSpecialRatesPayerName(unit.serviceLine || '');

    const isMonthly = ['AL', 'AL/MC', 'MC', 'SL', 'VIL'].includes(sl);
    const monthly   = isMonthly ? 1 : 0;
    const proration = isMonthly ? 1 : 0;

    specialRateRecords.push({
      facilityName:     matrixCareName,
      residentId:       unit.residentId || `RES-${unit.roomNumber}`,
      residentName:     unit.residentName || `Resident - Room ${unit.roomNumber}`,
      beginDate:        beginDate,   // always populated
      endDate:          endDate,
      payerName:        payerName,
      proration:        proration,
      spclRate:         1,
      amount:           Math.round((unit.inHouseRate || 0) * 100) / 100,
      pct:              0,
      monthly:          monthly,
      hospHold:         0,
      hospHoldAmount:   0,
      hospPct:          100,
      hospHoldMonthly:  0,
      therLv:           0,
      therLvHoldAmount: 0,
      therLvPct:        100,
      therLvHoldMonthly: 0,
    });
  }

  const csvData = await new Promise<string>((resolve, reject) => {
    stringify(specialRateRecords, {
      header: true,
      columns: [
        { key: 'facilityName',     header: 'Facility Name' },
        { key: 'residentId',       header: 'Resident ID' },
        { key: 'residentName',     header: 'Resident Name' },
        { key: 'beginDate',        header: 'BeginDate' },
        { key: 'endDate',          header: 'EndDate' },
        { key: 'payerName',        header: 'PayerName' },
        { key: 'proration',        header: 'Proration' },
        { key: 'spclRate',         header: 'SpclRate' },
        { key: 'amount',           header: 'Amount' },
        { key: 'pct',              header: 'Pct' },
        { key: 'monthly',          header: 'Monthly' },
        { key: 'hospHold',         header: 'HospHold' },
        { key: 'hospHoldAmount',   header: 'HospHoldAmount' },
        { key: 'hospPct',          header: 'HospPct' },
        { key: 'hospHoldMonthly',  header: 'HospHoldMonthly' },
        { key: 'therLv',           header: 'TherLv' },
        { key: 'therLvHoldAmount', header: 'TherLvHoldAmount' },
        { key: 'therLvPct',        header: 'TherLvPct' },
        { key: 'therLvHoldMonthly',header: 'TherLvHoldMonthly' },
      ],
    }, (err, output) => { if (err) reject(err); else resolve(output); });
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `/tmp/SPECIALROOMRATESEXPORT_Trilogy_${timestamp}.CSV`;
  await fs.writeFile(filename, csvData, 'utf8');
  return filename;
}

export async function validateSpecialRatesExport(filepath: string): Promise<{
  isValid: boolean;
  errors: string[];
  warnings: string[];
  summary: {
    totalRecords: number;
    facilities: number;
    residentsAffected: number;
    avgSpecialRate: number;
  };
}> {
  try {
    const csvContent = await fs.readFile(filepath, 'utf8');
    const lines   = csvContent.split('\n');
    const headers = lines[0].split(',');

    const errors: string[] = [];
    const warnings: string[] = [];
    const facilities = new Set<string>();
    const residents  = new Set<string>();
    let totalRate = 0, rateCount = 0;

    const requiredHeaders = ['Facility Name', 'Resident ID', 'Amount', 'BeginDate', 'EndDate'];
    for (const h of requiredHeaders) {
      if (!headers.some(x => x.includes(h))) errors.push(`Missing required column: ${h}`);
    }

    for (let i = 1; i < lines.length - 1; i++) {
      const values = lines[i].split(',');
      if (values.length < headers.length) continue;

      const facilityName = values[0];
      const residentId   = values[1];
      const amount       = parseFloat(values[8]);
      const beginDate    = values[3];
      const endDate      = values[4];

      facilities.add(facilityName);
      residents.add(residentId);
      if (!isNaN(amount)) { totalRate += amount; rateCount++; }

      if (!facilityName) errors.push(`Row ${i}: Missing facility name`);
      if (!residentId)   errors.push(`Row ${i}: Missing resident ID`);
      if (isNaN(amount) || amount <= 0) warnings.push(`Row ${i}: Invalid amount: ${values[8]}`);
      if (amount > 20000) warnings.push(`Row ${i}: Unusually high special rate: $${amount}`);
      if (!beginDate || beginDate.trim() === '') errors.push(`Row ${i}: Missing BeginDate`);
      if (!endDate   || endDate.trim()   === '') errors.push(`Row ${i}: Missing EndDate`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      summary: {
        totalRecords:      lines.length - 2,
        facilities:        facilities.size,
        residentsAffected: residents.size,
        avgSpecialRate:    rateCount > 0 ? totalRate / rateCount : 0,
      },
    };
  } catch (error) {
    return {
      isValid: false,
      errors:   [`Failed to validate file: ${error instanceof Error ? error.message : String(error)}`],
      warnings: [],
      summary:  { totalRecords: 0, facilities: 0, residentsAffected: 0, avgSpecialRate: 0 },
    };
  }
}
