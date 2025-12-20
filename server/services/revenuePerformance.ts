/**
 * Revenue Performance Service
 * 
 * Calculates actual revenue performance from rent roll data,
 * including MOM (month-over-month) and YOY (year-over-year) growth rates.
 * Used to compare against target revenue growth percentages.
 */

import { normalizeUnitRates, calculateUnitAnnualRevenue } from './rateNormalization';

export interface RevenuePerformance {
  currentMonthRevenue: number;
  previousMonthRevenue: number;
  sameMonthLastYearRevenue: number;
  momGrowth: number;  // % change from last month
  yoyGrowth: number;  // % change from same month last year
}

export interface RevenuePerformanceByScope {
  location: string;
  serviceLine: string;
  performance: RevenuePerformance;
}

export interface GapAnalysis {
  targetGrowth: number;
  actualYOYGrowth: number;
  yoyGap: number;  // positive = exceeding target, negative = behind target
  onTrack: boolean;
  gapSeverity: 'on_target' | 'slightly_behind' | 'significantly_behind' | 'exceeding';
}

/**
 * Calculate monthly revenue for a set of rent roll units
 * Properly handles daily vs monthly rates based on service line
 */
export function calculateMonthlyRevenue(units: any[]): number {
  let totalMonthlyRevenue = 0;
  
  for (const unit of units) {
    if (!unit.occupiedYN) continue;
    
    const { baseRateMonthly, careRateMonthly } = normalizeUnitRates(unit);
    totalMonthlyRevenue += baseRateMonthly + careRateMonthly;
  }
  
  return totalMonthlyRevenue;
}

/**
 * Calculate revenue by location and service line for a specific month
 */
export function calculateRevenueByScope(
  units: any[]
): Map<string, number> {
  const revenueByScope = new Map<string, number>();
  
  for (const unit of units) {
    if (!unit.occupiedYN) continue;
    
    const location = unit.location || 'Unknown';
    const serviceLine = unit.serviceLine || 'Unknown';
    const key = `${location}|${serviceLine}`;
    
    const { baseRateMonthly, careRateMonthly } = normalizeUnitRates(unit);
    const unitRevenue = baseRateMonthly + careRateMonthly;
    
    revenueByScope.set(key, (revenueByScope.get(key) || 0) + unitRevenue);
  }
  
  return revenueByScope;
}

/**
 * Get the month string for the same month last year
 * @param currentMonth Format: YYYY-MM
 */
export function getSameMonthLastYear(currentMonth: string): string {
  const [year, month] = currentMonth.split('-').map(Number);
  return `${year - 1}-${month.toString().padStart(2, '0')}`;
}

/**
 * Get the previous month string
 * @param currentMonth Format: YYYY-MM
 */
export function getPreviousMonth(currentMonth: string): string {
  const [year, month] = currentMonth.split('-').map(Number);
  if (month === 1) {
    return `${year - 1}-12`;
  }
  return `${year}-${(month - 1).toString().padStart(2, '0')}`;
}

/**
 * Calculate growth percentage between two values
 */
export function calculateGrowthPercent(current: number, previous: number): number {
  if (previous === 0 || !previous) return 0;
  return ((current - previous) / previous) * 100;
}

/**
 * Calculate revenue performance for a specific scope
 */
export function calculateRevenuePerformance(
  currentMonthUnits: any[],
  previousMonthUnits: any[],
  sameMonthLastYearUnits: any[]
): RevenuePerformance {
  const currentMonthRevenue = calculateMonthlyRevenue(currentMonthUnits);
  const previousMonthRevenue = calculateMonthlyRevenue(previousMonthUnits);
  const sameMonthLastYearRevenue = calculateMonthlyRevenue(sameMonthLastYearUnits);
  
  const momGrowth = calculateGrowthPercent(currentMonthRevenue, previousMonthRevenue);
  const yoyGrowth = calculateGrowthPercent(currentMonthRevenue, sameMonthLastYearRevenue);
  
  return {
    currentMonthRevenue,
    previousMonthRevenue,
    sameMonthLastYearRevenue,
    momGrowth: Math.round(momGrowth * 100) / 100,
    yoyGrowth: Math.round(yoyGrowth * 100) / 100
  };
}

/**
 * Calculate revenue performance by location and service line
 */
export function calculateRevenuePerformanceByScope(
  allUnits: any[],
  currentMonth: string,
  previousMonth: string,
  sameMonthLastYear: string
): RevenuePerformanceByScope[] {
  const results: RevenuePerformanceByScope[] = [];
  
  const currentMonthUnits = allUnits.filter(u => u.uploadMonth === currentMonth);
  const previousMonthUnits = allUnits.filter(u => u.uploadMonth === previousMonth);
  const lastYearUnits = allUnits.filter(u => u.uploadMonth === sameMonthLastYear);
  
  const scopeMap = new Map<string, { location: string; serviceLine: string }>();
  
  for (const unit of currentMonthUnits) {
    const location = unit.location || 'Unknown';
    const serviceLine = unit.serviceLine || 'Unknown';
    const key = `${location}|${serviceLine}`;
    if (!scopeMap.has(key)) {
      scopeMap.set(key, { location, serviceLine });
    }
  }
  
  Array.from(scopeMap.entries()).forEach(([key, scope]) => {
    const currentUnits = currentMonthUnits.filter(
      u => u.location === scope.location && u.serviceLine === scope.serviceLine
    );
    const prevUnits = previousMonthUnits.filter(
      u => u.location === scope.location && u.serviceLine === scope.serviceLine
    );
    const lastYearScopeUnits = lastYearUnits.filter(
      u => u.location === scope.location && u.serviceLine === scope.serviceLine
    );
    
    const performance = calculateRevenuePerformance(currentUnits, prevUnits, lastYearScopeUnits);
    
    results.push({
      location: scope.location,
      serviceLine: scope.serviceLine,
      performance
    });
  });
  
  return results;
}

/**
 * Calculate gap analysis between target and actual growth
 */
export function calculateGapAnalysis(
  targetGrowthPercent: number,
  actualYOYGrowth: number
): GapAnalysis {
  const yoyGap = actualYOYGrowth - targetGrowthPercent;
  const onTrack = yoyGap >= 0;
  
  let gapSeverity: GapAnalysis['gapSeverity'];
  if (yoyGap >= 0) {
    gapSeverity = 'exceeding';
  } else if (yoyGap >= -2) {
    gapSeverity = 'on_target';
  } else if (yoyGap >= -5) {
    gapSeverity = 'slightly_behind';
  } else {
    gapSeverity = 'significantly_behind';
  }
  
  return {
    targetGrowth: targetGrowthPercent,
    actualYOYGrowth,
    yoyGap: Math.round(yoyGap * 100) / 100,
    onTrack,
    gapSeverity
  };
}

/**
 * Get revenue performance for a specific location and service line
 */
export function getRevenuePerformanceForScope(
  allUnits: any[],
  locationName: string,
  serviceLine: string,
  currentMonth: string
): { performance: RevenuePerformance; hasHistoricalData: boolean } {
  const previousMonth = getPreviousMonth(currentMonth);
  const sameMonthLastYear = getSameMonthLastYear(currentMonth);
  
  const currentUnits = allUnits.filter(
    u => u.uploadMonth === currentMonth && 
         u.location === locationName && 
         u.serviceLine === serviceLine
  );
  const prevUnits = allUnits.filter(
    u => u.uploadMonth === previousMonth && 
         u.location === locationName && 
         u.serviceLine === serviceLine
  );
  const lastYearUnits = allUnits.filter(
    u => u.uploadMonth === sameMonthLastYear && 
         u.location === locationName && 
         u.serviceLine === serviceLine
  );
  
  const performance = calculateRevenuePerformance(currentUnits, prevUnits, lastYearUnits);
  const hasHistoricalData = prevUnits.length > 0 || lastYearUnits.length > 0;
  
  return { performance, hasHistoricalData };
}
