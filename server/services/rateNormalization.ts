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
 * Check if a unit is private pay (eligible for revenue calculations)
 * Per project docs: Revenue calculations filter for private pay residents only
 * (PRIVATE PAY, LEGACY - PVT PAY, BEDHOLDS), excluding Medicare/Medicaid
 */
export function isPrivatePay(unit: any): boolean {
  const payorType = (unit.payorType || '').toUpperCase();
  
  // Empty/null payor type is treated as private pay
  if (!payorType || payorType === '') return true;
  
  // Check for private pay variants
  if (payorType.includes('PRIVATE')) return true;
  if (payorType.includes('PVT')) return true;
  if (payorType.includes('BEDHOLD')) return true;
  
  return false;
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
    // Apply private pay proportion estimate (65% for HC based on historical data)
    const privatePayFactor = isHC ? 0.65 : 1.0;
    
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