/**
 * Rate Normalization Service
 * 
 * Handles conversion between daily and monthly rates based on service line.
 * HC (Health Center) and HC/MC rates are stored as DAILY rates.
 * AL, AL/MC, SL, VIL rates are stored as MONTHLY rates.
 */

const DAYS_IN_MONTH = 30.44; // Average days per month (365.25 / 12)

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
 * Calculate annual revenue for a unit, properly handling daily vs monthly rates
 * @param unit The rent roll unit
 * @param occupied Whether to calculate for occupied status (true) or potential (false)
 * @returns Annual revenue
 */
export function calculateUnitAnnualRevenue(unit: any, occupied: boolean = true): number {
  if (occupied && !unit.occupiedYN) {
    return 0; // Vacant units contribute 0 to current revenue
  }
  
  const { baseRateMonthly, careRateMonthly, streetRateMonthly } = normalizeUnitRates(unit);
  
  if (occupied) {
    // For occupied units, use actual rates
    return (baseRateMonthly + careRateMonthly) * 12;
  } else {
    // For potential revenue, use street rate
    return (streetRateMonthly + careRateMonthly) * 12;
  }
}