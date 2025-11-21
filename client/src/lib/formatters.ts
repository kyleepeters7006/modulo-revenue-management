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
 * @returns Formatted currency string (e.g., "$1,234.56") or "-" for null/undefined
 */
export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }
  
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
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