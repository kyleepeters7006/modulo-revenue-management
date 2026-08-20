/**
 * Rate Normalization Service
 * 
 * Handles conversion between daily and monthly rates based on service line.
 * HC (Health Center) and HC/MC rates are stored as DAILY rates.
 * AL, AL/MC, SL, VIL rates are stored as MONTHLY rates.
 */

// Single source of truth (365 / 12). Do NOT redefine locally — divergent copies
// made daily↔monthly round-trips lossy across services.
import { DAYS_PER_MONTH as DAYS_IN_MONTH } from "@shared/careRates";
// Single source of truth for payer scope. Do NOT inline a payer test here.
import { isPrivatePayer } from "@shared/payerScope";

// Service lines that use daily rates
const DAILY_RATE_SERVICE_LINES = ['HC', 'HC/MC'];

/**
 * Check if a service line uses daily rates
 */
export function isDailyRateServiceLine(serviceLine: string): boolean {
  return DAILY_RATE_SERVICE_LINES.includes(serviceLine);
}

/**
 * Convert a rate to monthly based on service line
 * @param rate The rate value
 * @param serviceLine The service line (HC, AL, etc.)
 * @returns Monthly rate
 */
export function normalizeToMonthlyRate(rate: number, serviceLine: string): number {
  if (!rate || rate === 0) return 0;
  
  if (isDailyRateServiceLine(serviceLine)) {
    // Convert daily rate to monthly
    return rate * DAYS_IN_MONTH;
  }
  
  // Already monthly
  return rate;
}

/**
 * Convert a monthly rate to the stored unit for a given service line.
 * HC / HC-MC rates are stored as DAILY (÷ DAYS_IN_MONTH, rounded to 2 dp).
 * All other service lines are stored as MONTHLY (unchanged).
 *
 * This is the canonical conversion used by every competitor-rate write path.
 * The plausibility guard (MAX_PLAUSIBLE_MONTHLY_RATE) must be applied to the
 * monthly value BEFORE calling this function so the limit is unit-consistent.
 */
export function convertToStoredRate(
  monthlyRate: number,
  serviceLine: string | null
): number {
  if (!serviceLine || !isDailyRateServiceLine(serviceLine)) {
    return monthlyRate; // already in monthly storage units
  }
  return Math.round((monthlyRate / DAYS_IN_MONTH) * 100) / 100;
}

/**
 * Convert a rate to daily based on service line
 * @param rate The rate value
 * @param serviceLine The service line (HC, AL, etc.)
 * @returns Daily rate
 */
export function normalizeToDailyRate(rate: number, serviceLine: string): number {
  if (!rate || rate === 0) return 0;
  
  if (isDailyRateServiceLine(serviceLine)) {
    // Already daily
    return rate;
  }
  
  // Convert monthly rate to daily
  return rate / DAYS_IN_MONTH;
}

/**
 * Normalize unit rates to monthly for revenue calculation
 * @param unit The rent roll unit
 * @returns Object with normalized monthly rates
 */
export function normalizeUnitRates(unit: any): {
  baseRateMonthly: number;
  careRateMonthly: number;
  streetRateMonthly: number;
} {
  const serviceLine = unit.serviceLine || '';
  
  // Determine base rate (use inHouseRate if > 0, otherwise streetRate)
  const baseRate = unit.inHouseRate > 0 ? unit.inHouseRate : (unit.streetRate || 0);
  const careRate = unit.careFee || unit.careRate || 0;
  const streetRate = unit.streetRate || 0;
  
  return {
    baseRateMonthly: normalizeToMonthlyRate(baseRate, serviceLine),
    careRateMonthly: normalizeToMonthlyRate(careRate, serviceLine),
    streetRateMonthly: normalizeToMonthlyRate(streetRate, serviceLine),
  };
}

/**
 * Check if a unit is private pay (eligible for revenue calculations).
 *
 * Thin adapter over the canonical definition in @shared/payerScope — this
 * takes a whole unit and reads the camelCase `payorType` field, which is the
 * shape most callers here already hold. Do not reimplement the rule; see that
 * file for why it is exclusion-based.
 */
export function isPrivatePay(unit: any): boolean {
  return isPrivatePayer(unit?.payorType);
}

/**
 * Calculate annual revenue for a unit, properly handling daily vs monthly rates
 * @param unit The rent roll unit
 * @param occupied Whether to calculate for occupied status (true) or potential (false)
 * @param privatePayOnly Whether to filter for private pay only (default: true per project docs)
 * @returns Annual revenue
 */
export function calculateUnitAnnualRevenue(unit: any, occupied: boolean = true, privatePayOnly: boolean = true): number {
  const { baseRateMonthly, careRateMonthly, streetRateMonthly } = normalizeUnitRates(unit);
  const isHC = ['HC', 'HC/MC'].includes(unit.serviceLine || '');
  
  if (occupied) {
    // Current revenue: only count occupied private pay units
    if (!unit.occupiedYN) {
      return 0; // Vacant units contribute 0 to current revenue
    }
    if (privatePayOnly && !isPrivatePay(unit)) {
      return 0; // Non-private pay residents excluded from revenue calculations
    }
    return (baseRateMonthly + careRateMonthly) * 12;
  } else {
    // Potential revenue: private pay occupied + vacant at street rate
    // Apply private pay proportion based on actual payor mix data:
    // HC: 21% private pay, HC/MC: 31% private pay
    //
    // This haircut only belongs on the PRIVATE-PAY basis. A vacant HC bed will
    // in reality be filled by the usual payer mix, so on a TOTAL-revenue basis
    // the full street rate is the right expectation and discounting it to 21%
    // would understate total potential by nearly 5x.
    const serviceLine = unit.serviceLine || '';
    let privatePayFactor = 1.0;
    if (privatePayOnly) {
      if (serviceLine === 'HC') {
        privatePayFactor = 0.21;
      } else if (serviceLine === 'HC/MC') {
        privatePayFactor = 0.31;
      }
    }
    
    if (unit.occupiedYN) {
      // For occupied units in potential revenue calculation:
      // Only count private pay units (non-private pay contribute 0)
      if (privatePayOnly && !isPrivatePay(unit)) {
        return 0; // Non-private pay residents excluded
      }
      return (baseRateMonthly + careRateMonthly) * 12;
    } else {
      // For vacant units: use street rate * private pay factor
      return (streetRateMonthly + careRateMonthly) * 12 * privatePayFactor;
    }
  }
}