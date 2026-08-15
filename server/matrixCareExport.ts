import type { RentRollData as SelectRentRollData } from '@shared/schema';
import { isBBedRow } from '@shared/bBed';
import {
  billingFrequencyFor,
  DAYS_PER_MONTH,
  resolveMatrixCareFacility,
  loadFacilityLookup,
  type FacilityLocation,
} from './services/matrixCareFacility';
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

/** Rent roll row optionally carrying the resolved effective rate from the export rate service. */
export type ExportableRentRollRow = SelectRentRollData & { effectiveRate?: number | null };

export function transformToMatrixCareFormat(
  rentRollData: ExportableRentRollRow[],
  facilityLookup: { byId: Map<string, FacilityLocation & { id: string; name: string }>; byName: Map<string, FacilityLocation & { id: string; name: string }> },
  exportDate?: string | null
): { rows: MatrixCareRow[]; unmappedFacilities: string[] } {
  // Always produce a valid date string, never an empty/null value
  const effectiveDate = safeExportDate(exportDate);
  const matrixCareRows: MatrixCareRow[] = [];
  const unmappedFacilities = new Set<string>();

  // Group by location name — we resolve the location object once per group using the
  // lookup so every row in a group shares the same MatrixCare facility identity.
  const facilitiesMap = new Map<string, ExportableRentRollRow[]>();
  for (const row of rentRollData) {
    const key = row.location;
    if (!facilitiesMap.has(key)) facilitiesMap.set(key, []);
    facilitiesMap.get(key)!.push(row);
  }

  facilitiesMap.forEach((facilityData, locationName) => {
    // Resolve the location object from the lookup (id-first, name fallback), matching
    // the same strategy used by the street-rates and special-rates exports.
    const firstRow = facilityData[0];
    const locationObj =
      (firstRow?.locationId ? facilityLookup.byId.get(firstRow.locationId) : undefined)
      ?? facilityLookup.byName.get(locationName);

    // Accumulate every unit's effective rate per (bedType, serviceLine), then average.
    // Previously only the first row encountered was kept, so the exported price was an
    // arbitrary pick rather than a representative rate for that bed type.
    const combos = new Map<string, { bedType: string; serviceLine: string; rates: number[] }>();

    for (const row of facilityData) {
      // One rate per physical room: companion B-bed rows would double-count senior housing.
      if (isBBedRow(row.serviceLine, row.roomNumber)) continue;

      const bedType = buildBedTypeDescription(row);
      const key = `${bedType}||${row.serviceLine}`;
      // Effective rate follows override -> rule-adjusted -> Modulo -> street precedence.
      const rate = row.effectiveRate ?? row.streetRate ?? 0;
      if (!Number.isFinite(rate) || rate <= 0) continue;

      let combo = combos.get(key);
      if (!combo) {
        combo = { bedType, serviceLine: row.serviceLine, rates: [] };
        combos.set(key, combo);
      }
      combo.rates.push(rate);
    }

    const uniqueCombinations = new Map<string, { bedType: string; serviceLine: string; basePrice: number }>();
    for (const [key, combo] of Array.from(combos.entries())) {
      const avg = combo.rates.reduce((s, r) => s + r, 0) / combo.rates.length;
      // MatrixCare expects a daily BasePrice: monthly senior housing is converted, HC is
      // already per diem. Classified centrally so unrecognised service lines behave the
      // same way here as in the street-rates export.
      const isDaily = billingFrequencyFor(combo.serviceLine) === 'Daily';
      const basePrice = Math.round(isDaily ? avg : avg / DAYS_PER_MONTH);
      uniqueCombinations.set(key, { bedType: combo.bedType, serviceLine: combo.serviceLine, basePrice });
    }

    uniqueCombinations.forEach(({ bedType, serviceLine, basePrice }) => {
      // Resolve facility identity through the shared resolver — same logic as the
      // street-rates and special-rates exports so all three files agree on names/ids.
      const facilitySource: FacilityLocation = locationObj ?? {
        name: locationName,
        matrixCareNameHC: null, matrixCareNameAL: null, matrixCareNameIL: null,
        customerFacilityIdHC: null, customerFacilityIdAL: null, customerFacilityIdIL: null,
      };
      const facility = resolveMatrixCareFacility(facilitySource, serviceLine);
      if (!facility.mapped) unmappedFacilities.add(locationName);

      const levels = fuzzyMapServiceLineToLevels(serviceLine);
      const payers = getPayerConfigurations(serviceLine);

      for (const loc of levels) {
        for (const payer of payers) {
          const revAcct = getRevenueAccount(serviceLine, payer.payerName);
          matrixCareRows.push({
            FacilityName:           facility.name,
            FacilityCustomerID:     `~${facility.customerId}`,
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

  if (unmappedFacilities.size > 0) {
    console.warn(
      `[matrixCareExport] ${unmappedFacilities.size} location(s) have no MatrixCare facility mapping; ` +
      `exported with derived names/ids: ${Array.from(unmappedFacilities).slice(0, 10).join(', ')}` +
      (unmappedFacilities.size > 10 ? ', …' : '')
    );
  }

  return { rows: matrixCareRows, unmappedFacilities: Array.from(unmappedFacilities).sort() };
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
- Service lines: ${Array.from(new Set(originalData.map(d => d.serviceLine))).join(', ')}
- Room types: ${Array.from(new Set(originalData.map(d => d.roomType))).join(', ')}

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
  rentRollData: ExportableRentRollRow[],
  clientId: string,
  exportDate?: string | null
): Promise<{ buffer: Buffer; validation: any; unmappedFacilities: string[] }> {
  const facilityLookup = await loadFacilityLookup(clientId);
  const { rows: matrixCareData, unmappedFacilities } = transformToMatrixCareFormat(rentRollData, facilityLookup, exportDate);
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
  return { buffer, validation, unmappedFacilities };
}

export async function generateMatrixCareCSV(
  rentRollData: ExportableRentRollRow[],
  clientId: string,
  exportDate?: string | null
): Promise<{ csv: string; validation: any; unmappedFacilities: string[] }> {
  const facilityLookup = await loadFacilityLookup(clientId);
  const { rows: matrixCareData, unmappedFacilities } = transformToMatrixCareFormat(rentRollData, facilityLookup, exportDate);
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

  return { csv, validation, unmappedFacilities };
}
