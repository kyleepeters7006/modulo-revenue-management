import { SelectRentRollData } from '@shared/schema';
import * as XLSX from 'xlsx';
import {
  safeExportDate,
  fuzzyMapRoomType,
  fuzzyMapServiceLineToLevels,
  getRevenueAccount,
  getPayerConfigurations,
} from './matrixCareFuzzyMatch';
import { callClaude } from './aiRouter';

interface MatrixCareRow {
  FacilityName: string;
  FacilityCustomerID: string;
  BedTypeDescription: string;
  LevelofCare: string;
  RoomChargeDescription: string;
  BasePriceBeginDate: string;
  BasePrice: number;
  BasePriceChargeBy: string;
  PayerBeginDate: string;
  PayerName: string;
  PayerChargeBy: string;
  Proration: string;
  RevenueCode: string;
  AllowableCharge: number;
  AllowablePercent: number;
  HospBedHoldRate: number;
  HospBedHoldPercent: number;
  TherBedHoldRate: number;
  TherBedHoldPercent: number;
  RevenueAccount: string;
  ContractualAccount: string;
  CopayContractualAccount: string;
}

// Build a bed-type string that appends any A/B/C attribute ratings
function buildBedTypeDescription(row: SelectRentRollData): string {
  const base = fuzzyMapRoomType(row.roomType || '');
  const ratings: string[] = [];
  if (row.viewRating)     ratings.push(`${row.viewRating} Vw`);
  if (row.locationRating) ratings.push(`${row.locationRating} Loc`);
  if (row.sizeRating)     ratings.push(`${row.sizeRating} Sz`);
  return ratings.length ? `${base};${ratings.join(';')}` : base;
}

// Generate a stable facility customer-ID
function getFacilityCustomerId(location: string, serviceLine: string): string {
  const locCode = location.replace(/[^A-Z0-9]/gi, '').substring(0, 6).toUpperCase();
  const n = serviceLine.toUpperCase();
  const svcCode = (n === 'HC' || n === 'SNF' || n === 'HC/MC') ? 'HC'
                : (n === 'AL' || n === 'AL/MC' || n === 'MC')  ? 'AL'
                : (n === 'VIL')                                 ? 'VIL'
                : 'SL';
  return `~14-${locCode}-${svcCode}`;
}

export function transformToMatrixCareFormat(
  rentRollData: SelectRentRollData[],
  exportDate?: string | null
): MatrixCareRow[] {
  // Always produce a valid date string, never an empty/null value
  const effectiveDate = safeExportDate(exportDate);
  const matrixCareRows: MatrixCareRow[] = [];

  // Group by facility
  const facilitiesMap = new Map<string, SelectRentRollData[]>();
  for (const row of rentRollData) {
    const key = row.location;
    if (!facilitiesMap.has(key)) facilitiesMap.set(key, []);
    facilitiesMap.get(key)!.push(row);
  }

  facilitiesMap.forEach((facilityData, facilityName) => {
    // Collect unique (bedType, serviceLine) combinations; keep the first street rate encountered
    const uniqueCombinations = new Map<string, { bedType: string; serviceLine: string; basePrice: number }>();

    for (const row of facilityData) {
      const bedType = buildBedTypeDescription(row);
      const key = `${bedType}||${row.serviceLine}`;
      if (!uniqueCombinations.has(key)) {
        // Daily rate: monthly AL/SL/VIL ÷ 30.5; HC is already daily
        const monthly = row.streetRate || 0;
        const sl = (row.serviceLine || '').toUpperCase();
        const isDaily = sl === 'HC' || sl === 'HC/MC' || sl === 'SNF';
        const basePrice = Math.round(isDaily ? monthly : monthly / 30.5);
        uniqueCombinations.set(key, { bedType, serviceLine: row.serviceLine, basePrice });
      }
    }

    uniqueCombinations.forEach(({ bedType, serviceLine, basePrice }) => {
      const facilityCustomerId = getFacilityCustomerId(facilityName, serviceLine);
      const levels = fuzzyMapServiceLineToLevels(serviceLine);
      const payers = getPayerConfigurations(serviceLine);

      for (const loc of levels) {
        for (const payer of payers) {
          const revAcct = getRevenueAccount(serviceLine, payer.payerName);
          matrixCareRows.push({
            FacilityName:           `${facilityName} ${serviceLine}`,
            FacilityCustomerID:     facilityCustomerId,
            BedTypeDescription:     bedType,
            LevelofCare:            loc,
            RoomChargeDescription:  'ROOM CHARGE',
            BasePriceBeginDate:     effectiveDate,   // always populated
            BasePrice:              basePrice,
            BasePriceChargeBy:      payer.payerChargeBy,
            PayerBeginDate:         effectiveDate,   // always populated
            PayerName:              payer.payerName,
            PayerChargeBy:          payer.payerChargeBy,
            Proration:              payer.proration,
            RevenueCode:            '',
            AllowableCharge:        0,
            AllowablePercent:       payer.payerName.toUpperCase().includes('MEDICAID') ? 0 : 100,
            HospBedHoldRate:        0,
            HospBedHoldPercent:     payer.payerName.toUpperCase().includes('MEDICAID') ? 0 : 100,
            TherBedHoldRate:        0,
            TherBedHoldPercent:     payer.payerName.toUpperCase().includes('MEDICAID') ? 0 : 100,
            RevenueAccount:         revAcct,
            ContractualAccount:     revAcct,
            CopayContractualAccount: revAcct,
          });
        }
      }
    });
  });

  return matrixCareRows;
}

// AI Validation for MatrixCare mapping
async function validateMatrixCareMapping(
  originalData: SelectRentRollData[],
  matrixCareData: MatrixCareRow[]
): Promise<{ isValid: boolean; issues: string[]; suggestions: string[] }> {
  const issues: string[] = [];
  const suggestions: string[] = [];

  if (matrixCareData.length === 0) {
    issues.push('No data generated for MatrixCare export');
  }

  // Field-level checks
  matrixCareData.forEach((row, index) => {
    if (!row.FacilityName)                           issues.push(`Row ${index + 1}: Missing FacilityName`);
    if (!row.FacilityCustomerID)                     issues.push(`Row ${index + 1}: Missing FacilityCustomerID`);
    if (!row.LevelofCare)                            issues.push(`Row ${index + 1}: Missing LevelofCare`);
    if (!row.BasePriceBeginDate)                     issues.push(`Row ${index + 1}: Missing BasePriceBeginDate`);
    if (!row.PayerBeginDate)                         issues.push(`Row ${index + 1}: Missing PayerBeginDate`);
    if (row.BasePrice === undefined || row.BasePrice < 0) issues.push(`Row ${index + 1}: Invalid BasePrice (${row.BasePrice})`);
    if (row.BasePrice > 1000) suggestions.push(`Row ${index + 1}: Daily rate ${row.BasePrice} seems high — verify conversion`);
  });

  // Check LevelofCare values contain known tokens
  const invalidLoc = matrixCareData.filter(r => {
    const v = r.LevelofCare.toUpperCase();
    return !v.includes('SKILLED') && !v.includes('INTERMED') && !v.includes('INDEPENDENT');
  });
  if (invalidLoc.length) issues.push(`${invalidLoc.length} rows have unrecognised LevelofCare values`);

  // Duplicate detection
  const seen = new Set<string>();
  matrixCareData.forEach(row => {
    const key = `${row.FacilityName}-${row.BedTypeDescription}-${row.LevelofCare}-${row.PayerName}`;
    if (seen.has(key)) suggestions.push(`Potential duplicate: ${key}`);
    seen.add(key);
  });

  // AI deep-validation (sample)
  if (matrixCareData.length > 0) {
    try {
      const sampleRows = matrixCareData.slice(0, 5);
      const prompt = `As a healthcare data expert familiar with MatrixCare EHR, validate this mapping:

Sample:
${JSON.stringify(sampleRows, null, 2)}

Source summary:
- Units: ${originalData.length}
- Service lines: ${[...new Set(originalData.map(d => d.serviceLine))].join(', ')}
- Room types: ${[...new Set(originalData.map(d => d.roomType))].join(', ')}

Validate: LevelofCare accuracy, daily rate reasonableness, revenue account format, payer type correctness, missing/malformed fields.

Respond JSON: { "isValid": bool, "criticalIssues": [], "suggestions": [], "mappingAccuracy": "high"|"medium"|"low" }`;

      const rawText = await callClaude(
        'You are a healthcare data expert. Always respond with valid JSON.',
        prompt,
        { maxTokens: 1000, label: 'matrixcare-validation' }
      );
      const result = JSON.parse(rawText || '{}');
      if (result.criticalIssues) issues.push(...result.criticalIssues);
      if (result.suggestions)    suggestions.push(...result.suggestions);
      if (result.mappingAccuracy === 'low')    issues.push('AI validation indicates low mapping accuracy');
      if (result.mappingAccuracy === 'medium') suggestions.push('AI validation: medium accuracy — review recommended');
    } catch {
      suggestions.push('AI validation unavailable — manual review recommended');
    }
  }

  return { isValid: issues.length === 0, issues, suggestions };
}

export async function generateMatrixCareExcel(
  rentRollData: SelectRentRollData[],
  exportDate?: string | null
): Promise<{ buffer: Buffer; validation: any }> {
  const matrixCareData = transformToMatrixCareFormat(rentRollData, exportDate);
  const validation = await validateMatrixCareMapping(rentRollData, matrixCareData);

  if (!validation.isValid)        console.warn('MatrixCare export validation issues:', validation.issues);
  if (validation.suggestions.length) console.info('MatrixCare export suggestions:', validation.suggestions);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(matrixCareData);

  ws['!cols'] = [
    { wch: 30 }, { wch: 20 }, { wch: 25 }, { wch: 30 }, { wch: 20 },
    { wch: 15 }, { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 20 },
    { wch: 15 }, { wch: 10 }, { wch: 12 }, { wch: 15 }, { wch: 15 },
    { wch: 15 }, { wch: 18 }, { wch: 15 }, { wch: 18 }, { wch: 15 },
    { wch: 20 }, { wch: 25 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'MatrixCare Upload');

  if (!validation.isValid || validation.suggestions.length > 0) {
    const vData = [
      { Type: 'Status', Detail: validation.isValid ? 'VALID — export completed with warnings' : 'INVALID — review before uploading' },
      ...validation.issues.map((d: string) => ({ Type: 'Issue', Detail: d })),
      ...validation.suggestions.map((d: string) => ({ Type: 'Suggestion', Detail: d })),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vData), 'Validation Report');
  }

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return { buffer, validation };
}

export async function generateMatrixCareCSV(
  rentRollData: SelectRentRollData[],
  exportDate?: string | null
): Promise<{ csv: string; validation: any }> {
  const matrixCareData = transformToMatrixCareFormat(rentRollData, exportDate);
  const validation = await validateMatrixCareMapping(rentRollData, matrixCareData);

  if (!validation.isValid)        console.warn('MatrixCare CSV validation issues:', validation.issues);
  if (validation.suggestions.length) console.info('MatrixCare CSV suggestions:', validation.suggestions);

  const headers: Array<keyof MatrixCareRow> = [
    'FacilityName', 'FacilityCustomerID', 'BedTypeDescription', 'LevelofCare',
    'RoomChargeDescription', 'BasePriceBeginDate', 'BasePrice', 'BasePriceChargeBy',
    'PayerBeginDate', 'PayerName', 'PayerChargeBy', 'Proration', 'RevenueCode',
    'AllowableCharge', 'AllowablePercent', 'HospBedHoldRate', 'HospBedHoldPercent',
    'TherBedHoldRate', 'TherBedHoldPercent', 'RevenueAccount', 'ContractualAccount',
    'CopayContractualAccount',
  ];

  let csv = headers.join(',') + '\n';
  for (const row of matrixCareData) {
    const vals = headers.map(h => {
      const v = row[h];
      if (typeof v === 'string' && (v.includes(',') || v.includes('"'))) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return v;
    });
    csv += vals.join(',') + '\n';
  }

  if (!validation.isValid || validation.suggestions.length > 0) {
    csv += '\n# VALIDATION REPORT\n';
    csv += `# Status: ${validation.isValid ? 'VALID with warnings' : 'INVALID — review before uploading'}\n`;
    if (validation.issues.length) {
      csv += '# Issues:\n';
      validation.issues.forEach((i: string) => { csv += `# - ${i}\n`; });
    }
    if (validation.suggestions.length) {
      csv += '# Suggestions:\n';
      validation.suggestions.forEach((s: string) => { csv += `# - ${s}\n`; });
    }
  }

  return { csv, validation };
}
