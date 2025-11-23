/**
 * Number formatting utilities for consistent display throughout the application
 */

/**
 * Format a number with commas for thousands separators
 * @param value - The number to format (or null/undefined)
 * @returns Formatted string with commas (e.g., "1,234,567") or "-" for null/undefined
 */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }
  
  // Handle negative numbers
  const isNegative = value < 0;
  const absValue = Math.abs(value);
  
  // Format with commas
  const formatted = absValue.toLocaleString('en-US', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0
  });
  
  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Format a number as currency with dollar sign and commas
 * @param value - The number to format as currency (or null/undefined)
 * @returns Formatted currency string (e.g., "$1,234") or "-" for null/undefined
 */
export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }
  
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
}

/**
 * Format a decimal number as a percentage
 * @param value - The decimal value to format (e.g., 0.745 for 74.5%)
 * @param decimals - Number of decimal places to show (default: 1)
 * @returns Formatted percentage string (e.g., "74.5%") or "-" for null/undefined
 */
export function formatPercentage(value: number | null | undefined, decimals: number = 1): string {
  if (value === null || value === undefined) {
    return "-";
  }
  
  const percentage = value * 100;
  return `${percentage.toFixed(decimals)}%`;
}

/**
 * Format a large number in compact notation (e.g., 1.2M, 3.5K)
 * @param value - The number to format compactly
 * @returns Formatted compact string or "-" for null/undefined
 */
export function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }
  
  return value.toLocaleString('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1
  });
}

// Constants for rate conversion
export const DAYS_IN_MONTH = 30.44; // Average days per month (365.25 / 12)

// Service lines that use daily rates
export const DAILY_RATE_SERVICE_LINES = ['HC', 'HC/MC'];

/**
 * Check if a service line uses daily rates
 */
export function isDailyRateServiceLine(serviceLine: string | null | undefined): boolean {
  if (!serviceLine) return false;
  return DAILY_RATE_SERVICE_LINES.includes(serviceLine);
}

/**
 * Convert monthly rate to daily rate for HC service lines
 * @param monthlyRate - The monthly rate value
 * @param serviceLine - The service line (HC, HC/MC, AL, etc.)
 * @returns The appropriate rate (daily for HC/HC-MC, monthly for others)
 */
export function convertToDisplayRate(monthlyRate: number | null | undefined, serviceLine: string | null | undefined): number | null {
  if (monthlyRate === null || monthlyRate === undefined) {
    return null;
  }
  
  if (isDailyRateServiceLine(serviceLine)) {
    // Convert monthly to daily for HC and HC/MC
    return monthlyRate / DAYS_IN_MONTH;
  }
  
  // Return as-is for other service lines (AL, AL/MC, SL, VIL)
  return monthlyRate;
}

/**
 * Format a rate as currency with appropriate suffix for service line
 * @param monthlyRate - The monthly rate value (as stored in database)
 * @param serviceLine - The service line (HC, HC/MC, AL, etc.)
 * @param includePerDay - Whether to include "/day" suffix for daily rates
 * @returns Formatted currency string with appropriate suffix
 */
export function formatRateByServiceLine(
  monthlyRate: number | null | undefined, 
  serviceLine: string | null | undefined,
  includePerDay: boolean = true
): string {
  if (monthlyRate === null || monthlyRate === undefined) {
    return "-";
  }
  
  const displayRate = convertToDisplayRate(monthlyRate, serviceLine);
  if (displayRate === null) {
    return "-";
  }
  
  const formatted = displayRate.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
  
  // Add "/day" suffix for daily rate service lines
  if (includePerDay && isDailyRateServiceLine(serviceLine)) {
    return `${formatted}/day`;
  }
  
  return formatted;
}