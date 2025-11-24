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
 * Get display rate from stored rate (no conversion needed - rates stored in display format)
 * HC/HC-MC rates are stored as daily, AL/SL/VIL/AL-MC rates are stored as monthly
 * @param storedRate - The rate value as stored in database
 * @param serviceLine - The service line (HC, HC/MC, AL, etc.)
 * @returns The rate for display (already in correct format)
 */
export function convertToDisplayRate(storedRate: number | null | undefined, serviceLine: string | null | undefined): number | null {
  if (storedRate === null || storedRate === undefined) {
    return null;
  }
  
  // HC/HC-MC are stored as daily, others as monthly - return as-is
  return storedRate;
}

/**
 * Format a rate as currency with appropriate suffix for service line
 * @param storedRate - The rate value (as stored in database - daily for HC, monthly for others)
 * @param serviceLine - The service line (HC, HC/MC, AL, etc.)
 * @param includePerDay - Whether to include "/day" suffix for daily rates
 * @returns Formatted currency string with appropriate suffix
 */
export function formatRateByServiceLine(
  storedRate: number | null | undefined, 
  serviceLine: string | null | undefined,
  includePerDay: boolean = true
): string {
  if (storedRate === null || storedRate === undefined) {
    return "-";
  }
  
  const displayRate = convertToDisplayRate(storedRate, serviceLine);
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