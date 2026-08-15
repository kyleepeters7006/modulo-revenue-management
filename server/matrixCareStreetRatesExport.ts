import { locations } from "@shared/schema";
import { isBBedRow } from "@shared/bBed";
import {
  safeExportDate,
  fuzzyMapRoomType,
  fuzzyMapServiceLine,
  getPayerConfigurations,
  getRevenueAccount,
} from './matrixCareFuzzyMatch';
import {
  resolveMatrixCareFacility,
  loadFacilityLookup,
  billingFrequencyFor,
  DAYS_PER_MONTH,
} from "./services/matrixCareFacility";
import { getEffectiveRateUnits } from "./services/exportRateService";
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

/**
 * Corporate Room Charges export — street rates for new admissions.
 *
 * Rates come from the shared export rate service, so they are scoped to the
 * client's newest upload month and follow the same precedence the rest of the
 * product displays (manual override -> rule-adjusted -> Modulo -> street).
 */
export async function generateStreetRatesExport(
  clientId: string,
  selectedCampuses?: string[],
  exportDate?: string | null
): Promise<{ filepath: string; unmappedFacilities: string[] }> {
  // Always produce a valid date, never empty
  const effectiveDate = safeExportDate(exportDate);

  const { uploadMonth, units } = await getEffectiveRateUnits(clientId, {
    campusNames: selectedCampuses,
  });
  if (!uploadMonth) {
    throw new Error('No rent roll data available to export.');
  }

  // Client-scoped: location names are only unique within a tenant, so an unscoped
  // name fallback could resolve to another tenant's facility mapping.
  const { byId: locById, byName: locByName } = await loadFacilityLookup(clientId);

  // Group by location + service line + MatrixCare bed type.
  //
  // The template carries a distinct BasePrice per BedTypeDescription, so pricing must
  // not collapse to a single service-line average. Several rent-roll room types can map
  // onto the same bed type (Studio, One Bedroom and Two Bedroom are all "Private"), so
  // those are averaged together — but Companion keeps its own materially different rate.
  type LocationRow = typeof locations.$inferSelect;
  interface Group {
    location: LocationRow;
    serviceLine: string;
    bedType: string;
    rates: number[];
  }
  const groups = new Map<string, Group>();

  for (const u of units) {
    // No usable rate anywhere in the precedence chain — exporting 0 would be a fake price.
    if (!u.hasRate) continue;
    // One rate per physical room: companion B-bed rows would double-count senior housing.
    if (isBBedRow(u.serviceLine, u.roomNumber)) continue;

    const location =
      (u.locationId ? locById.get(u.locationId) : undefined) ?? locByName.get(u.location);
    if (!location) continue;

    const bedType = fuzzyMapRoomType(u.roomType || '');
    const key = `${location.id}|${u.serviceLine}|${bedType}`;

    let group = groups.get(key);
    if (!group) {
      group = { location, serviceLine: u.serviceLine, bedType, rates: [] };
      groups.set(key, group);
    }
    group.rates.push(u.effectiveRate);
  }

  const streetRateRecords: StreetRateRecord[] = [];
  const unmappedFacilities = new Set<string>();

  for (const { location, serviceLine, bedType, rates } of Array.from(groups.values())) {
    if (rates.length === 0) continue;
    const avgRate = rates.reduce((s, r) => s + r, 0) / rates.length;

    const facility = resolveMatrixCareFacility(location, serviceLine);
    if (!facility.mapped) unmappedFacilities.add(location.name);

    const levelOfCare = fuzzyMapServiceLine(serviceLine);
    const payers = getPayerConfigurations(serviceLine);
    // How the stored rate is denominated, classified centrally so an unrecognised
    // service line can never be converted here but left raw in another export.
    const sourceFrequency = billingFrequencyFor(serviceLine);

    for (const payer of payers) {
      // Normalise rate to payer charge frequency
      let adjustedRate = avgRate;
      if (payer.payerChargeBy === 'Daily' && sourceFrequency === 'Monthly') {
        adjustedRate = avgRate / DAYS_PER_MONTH;
      } else if (payer.payerChargeBy === 'Monthly' && sourceFrequency === 'Daily') {
        adjustedRate = avgRate * DAYS_PER_MONTH;
      }

      const revenueAccount = getRevenueAccount(serviceLine, payer.payerName);
      const isMedicaid = payer.payerName.toUpperCase().includes('MEDICAID');

      streetRateRecords.push({
        facilityName:            facility.name,
        facilityCustomerId:      `~${facility.customerId}`,
        bedTypeDescription:      bedType,
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
        allowablePercent:        isMedicaid ? 0 : 100,
        hospBedHoldRate:         0,
        hospBedHoldPercent:      isMedicaid ? 0 : 100,
        therBedHoldRate:         0,
        therBedHoldPercent:      isMedicaid ? 0 : 100,
        revenueAccount:          revenueAccount,
        contractualAccount:      revenueAccount,
        copayContractualAccount: revenueAccount,
      });
    }
  }

  if (unmappedFacilities.size > 0) {
    console.warn(
      `[streetRatesExport] ${unmappedFacilities.size} location(s) have no MatrixCare facility mapping; ` +
      `exported with derived names/ids: ${Array.from(unmappedFacilities).slice(0, 10).join(', ')}` +
      (unmappedFacilities.size > 10 ? ', …' : '')
    );
  }

  const csvData = await new Promise<string>((resolve, reject) => {
    stringify(streetRateRecords, {
      header: true,
      columns: [
        { key: 'facilityName',            header: 'FacilityName' },
        { key: 'facilityCustomerId',      header: 'FacilityCustomerID' },
        { key: 'bedTypeDescription',      header: 'BedTypeDescription' },
        { key: 'levelOfCare',             header: 'LevelofCare' },
        { key: 'roomChargeDescription',   header: 'RoomChargeDescription' },
        { key: 'basePriceBeginDate',      header: 'BasePriceBeginDate' },
        { key: 'basePrice',               header: 'BasePrice' },
        { key: 'basePriceChargeBy',       header: 'BasePriceChargeBy' },
        { key: 'payerBeginDate',          header: 'PayerBeginDate' },
        { key: 'payerName',               header: 'PayerName' },
        { key: 'payerChargeBy',           header: 'PayerChargeBy' },
        { key: 'proration',               header: 'Proration' },
        { key: 'revenueCode',             header: 'RevenueCode' },
        { key: 'allowableCharge',         header: 'AllowableCharge' },
        { key: 'allowablePercent',        header: 'AllowablePercent' },
        { key: 'hospBedHoldRate',         header: 'HospBedHoldRate' },
        { key: 'hospBedHoldPercent',      header: 'HospBedHoldPercent' },
        { key: 'therBedHoldRate',         header: 'TherBedHoldRate' },
        { key: 'therBedHoldPercent',      header: 'TherBedHoldPercent' },
        { key: 'revenueAccount',          header: 'RevenueAccount' },
        { key: 'contractualAccount',      header: 'ContractualAccount' },
        { key: 'copayContractualAccount', header: 'CopayContractualAccount' },
      ],
    }, (err, output) => { if (err) reject(err); else resolve(output); });
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `/tmp/CORPORATEROOMCHARGESEXPORT_Trilogy_${timestamp}.CSV`;
  await fs.writeFile(filename, csvData, 'utf8');
  return { filepath: filename, unmappedFacilities: Array.from(unmappedFacilities).sort() };
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
