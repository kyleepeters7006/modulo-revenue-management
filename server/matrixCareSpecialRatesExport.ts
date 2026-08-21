import {
  safeExportDate,
  getSpecialRatesPayerName,
} from './matrixCareFuzzyMatch';
import {
  resolveMatrixCareFacility,
  loadFacilityLookup,
  billingFrequencyFor,
} from "./services/matrixCareFacility";
import { getEffectiveRateUnits } from "./services/exportRateService";
import { getDerivedRateFormulas } from "./services/derivedRateFormulasService";
import { applyDerivedFormula, resolveFormula } from "@shared/derivedRates";
import { pool } from "./db";
import { stringify } from 'csv-stringify';
import { promises as fs } from 'fs';

/**
 * Row shape of the MatrixCare SpecialRoomRateExport.
 *
 * Column set and values mirror the reference export produced by MatrixCare itself.
 * Notably it carries NO resident identifier columns — the file is keyed by facility
 * and payer, one row per resident-level special rate.
 */
interface SpecialRateRecord {
  facilityName: string;
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
  /** The reference file ends every line with a trailing empty field. */
  trailing: string;
}

/**
 * Special Room Rate export — locks in the current contracted rate for existing
 * residents (a rate freeze), so the amount is the in-house rate, not a proposed rate.
 *
 * Scoped to the client's newest upload month via the shared export rate service;
 * previously this read every month of rent roll history for every tenant at once.
 */
export async function generateSpecialRatesExport(
  clientId: string,
  selectedCampuses?: string[],
  exportDate?: string | null
): Promise<{ filepath: string; unmappedFacilities: string[] }> {
  // Always produce a valid begin date, never empty
  const beginDate = safeExportDate(exportDate);

  // The reference export uses annual periods: begin date through year-end.
  const beginYear = (() => {
    const parts = beginDate.split('/');
    const year = Number(parts[2]);
    return Number.isFinite(year) ? year : new Date().getFullYear();
  })();
  const endDate = `12/31/${beginYear}`;

  const [{ uploadMonth, units }, { byId: locById, byName: locByName }, formulas] = await Promise.all([
    getEffectiveRateUnits(clientId, { campusNames: selectedCampuses }),
    // Client-scoped: location names are only unique within a tenant, so an unscoped
    // name fallback could resolve to another tenant's facility mapping.
    loadFacilityLookup(clientId),
    getDerivedRateFormulas((sql, params) => pool.query(sql, params), clientId),
  ]);
  if (!uploadMonth) {
    throw new Error('No rent roll data available to export.');
  }

  const specialRateRecords: SpecialRateRecord[] = [];
  const unmappedFacilities = new Set<string>();
  let skippedNoRate = 0;

  for (const unit of units) {
    // A special rate locks in the rate for a resident currently in place. The MatrixCare
    // file carries no resident identifier columns, so occupancy alone determines the rows —
    // requiring a resident id would drop every unit for tenants that don't import one.
    if (!unit.occupied) continue;

    // A zero, missing or non-finite in-house rate is not a rate freeze, it's missing data.
    if (!Number.isFinite(unit.inHouseRate) || unit.inHouseRate <= 0) {
      skippedNoRate++;
      continue;
    }

    const location =
      (unit.locationId ? locById.get(unit.locationId) : undefined) ?? locByName.get(unit.location);
    if (!location) continue;

    const facility = resolveMatrixCareFacility(location, unit.serviceLine);
    if (!facility.mapped) unmappedFacilities.add(location.name);

    // Use fuzzy payer mapping so non-standard service-line strings still resolve
    const payerName = getSpecialRatesPayerName(unit.serviceLine || '');

    // Billing frequency drives Monthly and Proration: monthly senior housing bills
    // Proration 2 / Monthly 1; daily health campus bills Proration 1 / Monthly 0.
    const isMonthly = billingFrequencyFor(unit.serviceLine) === 'Monthly';
    const monthly = isMonthly ? 1 : 0;
    const proration = isMonthly ? 2 : 1;

    const amount = Math.round((unit.inHouseRate || 0) * 100) / 100;

    // Bed-hold amounts are derived from the resident's in-house rate using the saved
    // bed_hold formula — a disabled formula falls back to the base amount.
    const bedHoldFormula = resolveFormula(formulas, 'bed_hold', unit.serviceLine);
    const bedHoldAmount = applyDerivedFormula(amount, bedHoldFormula) ?? amount;

    // Private-pay rows carry bed-hold coverage; the percent columns stay at 0
    // because the hold is expressed as a flat amount.
    specialRateRecords.push({
      facilityName:      facility.name,
      beginDate:         beginDate,
      endDate:           endDate,
      payerName:         payerName,
      proration:         proration,
      spclRate:          1,
      amount:            amount,
      pct:               0,
      monthly:           monthly,
      hospHold:          1,
      hospHoldAmount:    bedHoldAmount,
      hospPct:           0,
      hospHoldMonthly:   monthly,
      therLv:            1,
      therLvHoldAmount:  bedHoldAmount,
      therLvPct:         0,
      therLvHoldMonthly: monthly,
      trailing:          '',
    });
  }

  if (skippedNoRate > 0) {
    console.warn(`[specialRatesExport] Skipped ${skippedNoRate} occupied unit(s) with no in-house rate.`);
  }
  if (unmappedFacilities.size > 0) {
    console.warn(
      `[specialRatesExport] ${unmappedFacilities.size} location(s) have no MatrixCare facility mapping; ` +
      `exported with derived names: ${Array.from(unmappedFacilities).slice(0, 10).join(', ')}` +
      (unmappedFacilities.size > 10 ? ', …' : '')
    );
  }

  const csvData = await new Promise<string>((resolve, reject) => {
    stringify(specialRateRecords, {
      header: true,
      columns: [
        { key: 'facilityName',      header: 'Facility Name' },
        { key: 'beginDate',         header: 'BeginDate' },
        { key: 'endDate',           header: 'EndDate' },
        { key: 'payerName',         header: 'PayerName' },
        { key: 'proration',         header: 'Proration' },
        { key: 'spclRate',          header: 'SpclRate' },
        { key: 'amount',            header: 'Amount' },
        { key: 'pct',               header: 'Pct' },
        { key: 'monthly',           header: 'Monthly' },
        { key: 'hospHold',          header: 'HospHold' },
        { key: 'hospHoldAmount',    header: 'HospHoldAmount' },
        { key: 'hospPct',           header: 'HospPct' },
        { key: 'hospHoldMonthly',   header: 'HospHoldMonthly' },
        { key: 'therLv',            header: 'TherLv' },
        { key: 'therLvHoldAmount',  header: 'TherLvHoldAmount' },
        { key: 'therLvPct',         header: 'TherLvPct' },
        { key: 'therLvHoldMonthly', header: 'TherLvHoldMonthly' },
        { key: 'trailing',          header: '' },
      ],
    }, (err, output) => { if (err) reject(err); else resolve(output); });
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `/tmp/SPECIALROOMRATESEXPORT_Trilogy_${timestamp}.CSV`;
  await fs.writeFile(filename, csvData, 'utf8');
  return { filepath: filename, unmappedFacilities: Array.from(unmappedFacilities).sort() };
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
    let totalRate = 0;
    let rateCount = 0;
    let recordCount = 0;

    const requiredHeaders = ['Facility Name', 'BeginDate', 'PayerName', 'Amount'];
    for (const h of requiredHeaders) {
      if (!headers.some(x => x.trim() === h)) errors.push(`Missing required column: ${h}`);
    }

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i] || lines[i].trim() === '') continue;
      const values = lines[i].split(',');
      if (values.length < 17) continue;
      recordCount++;

      const facilityName = values[0];
      const beginDate    = values[1];
      const amount       = parseFloat(values[6]);

      facilities.add(facilityName);
      if (!isNaN(amount)) { totalRate += amount; rateCount++; }

      if (!facilityName) errors.push(`Row ${i}: Missing facility name`);
      if (!beginDate || beginDate.trim() === '') errors.push(`Row ${i}: Missing BeginDate`);
      if (isNaN(amount) || amount <= 0) warnings.push(`Row ${i}: Invalid special rate amount: ${values[6]}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      summary: {
        totalRecords:      recordCount,
        facilities:        facilities.size,
        residentsAffected: recordCount,
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
