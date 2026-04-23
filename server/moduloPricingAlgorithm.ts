/**
 * ============================================================================
 * MODULO PRICING ALGORITHM FOR SENIOR HOUSING
 * ============================================================================
 * 
 * A sophisticated multi-factor pricing algorithm that calculates optimal rates
 * by blending 7 pricing signals with configurable weights.
 * 
 * ALGORITHM OVERVIEW:
 * 1. Each factor generates a "signal" normalized to [-1, +1] range
 * 2. Signals are weighted and blended based on operator preferences
 * 3. The blended signal is converted to a percentage adjustment (±25% max)
 * 4. Final price = Base Price × (1 + Total Adjustment)
 * 
 * PRICING FACTORS:
 * ┌─────────────────────┬─────────────┬──────────────────────────────────────┐
 * │ Factor              │ Max Impact  │ Description                          │
 * ├─────────────────────┼─────────────┼──────────────────────────────────────┤
 * │ Occupancy           │ -12% to +6% │ Campus-level occupancy pressure      │
 * │ Days Vacant         │ -15% to 0%  │ Unit-level vacancy decay (7-day grace│
 * │ Room Attributes     │ ±10%        │ Location, size, view, renovations    │
 * │ Seasonality         │ ±5%         │ Monthly demand patterns              │
 * │ Competitors         │ ±8%         │ Market positioning vs median         │
 * │ Market              │ ±3%         │ Economic indicators (S&P 500)        │
 * │ Demand              │ ±15%        │ Inquiry/tour volume z-score          │
 * └─────────────────────┴─────────────┴──────────────────────────────────────┘
 * 
 * SERVICE LINE PREMIUM TARGETS (above competitor median):
 * - AL (Assisted Living): 25% - Premium positioning for higher care
 * - HC (Health Care): 20% - Skilled nursing clinical value
 * - AL/MC, HC/MC: 20% - Memory care premium
 * - SL (Supportive Living): 10% - Moderate positioning
 * - VIL (Village/Independent): 10% - Lifestyle competitive positioning
 * - Default: 18% - Balanced positioning
 * 
 * SIGNAL CALCULATION:
 * Each signal function maps its input to [-1, +1]:
 * - Negative signals → Price reduction recommended
 * - Zero signal → No adjustment needed
 * - Positive signals → Price increase recommended
 * 
 * WEIGHT BLENDING:
 * Weights are normalized to sum to 1.0, then multiplied by signals.
 * Example: If occupancy has weight 25 (of 100 total), and signal is +0.5,
 * its contribution to the blended signal is 0.25 × 0.5 = 0.125
 * 
 * EXPLAINABILITY:
 * The algorithm provides detailed breakdowns including:
 * - Raw signal values for each factor
 * - Factor descriptions in plain language
 * - Calculation formulas and intermediate values
 * - Dollar impact per factor
 * 
 * ============================================================================
 */

interface ModuloPricingConfig {
  // Global caps on the final blended adjustment
  minTotalAdj: number;      // -25% max discount
  maxTotalAdj: number;      // +25% max premium

  // Occupancy
  occTarget: number;        // target campus occupancy (90%)
  occHardFloor: number;     // if below this, trigger stronger reduction (85%)
  occMaxCut: number;        // strongest cut from occupancy alone (-12%)
  occMaxPremium: number;    // strongest premium from occupancy alone (+6%)

  // Days Vacant (per-unit)
  dvGraceDays: number;      // no discount until after this many days
  dvMaxCut: number;         // max discount from days-vacant alone (-15%)
  dvDecaySpeed: number;     // higher → reaches max faster after grace

  // Seasonality
  seasonalitySpan: number;  // ±5% max
  seasonalityProfile: number[]; // 12 months

  // Competitor Rates
  compCap: number;          // cap the effect to ±8%
  compSensitivity: number;  // how aggressively to follow comps

  // Stock Market
  mktSpan: number;          // ±3% max effect
  mktMaxAbsReturn: number;  // normalize any |return| ≥ 10% to full span

  // Inquiry & Tour Volume
  demandSpan: number;       // ±15% max from demand
  demandMaxZ: number;       // clamp |z| to avoid outliers dominating
  
  // Revenue Growth Target (strategic override - not part of normalized weights)
  revenueGrowthSpan: number; // ±5% max effect from revenue gap
}

const defaultConfig: ModuloPricingConfig = {
  minTotalAdj: -0.25,
  maxTotalAdj: 0.25,
  
  occTarget: 0.90,
  occHardFloor: 0.85,
  occMaxCut: -0.12,
  occMaxPremium: 0.06,
  
  dvGraceDays: 7,
  dvMaxCut: -0.15,
  dvDecaySpeed: 0.20,
  
  seasonalitySpan: 0.05,
  seasonalityProfile: [
    0.00,  // Jan
    0.01,  // Feb
    0.02,  // Mar
    0.03,  // Apr
    0.05,  // May
    0.05,  // Jun
    0.04,  // Jul
    0.02,  // Aug
    0.01,  // Sep
    -0.02, // Oct
    -0.03, // Nov
    -0.02  // Dec
  ],
  
  compCap: 0.08,
  compSensitivity: 0.75,
  
  mktSpan: 0.03,
  mktMaxAbsReturn: 0.10,
  
  demandSpan: 0.15,
  demandMaxZ: 2.0,
  
  revenueGrowthSpan: 0.05  // ±5% max effect from revenue gap
};

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function normalizeWeights(weightsDict: Record<string, number>): Record<string, number> {
  const total = Object.values(weightsDict).reduce((sum, v) => sum + v, 0);
  if (total <= 0) {
    const n = Object.keys(weightsDict).length;
    const equalWeight = 1.0 / n;
    return Object.keys(weightsDict).reduce((acc, k) => {
      acc[k] = equalWeight;
      return acc;
    }, {} as Record<string, number>);
  }
  return Object.keys(weightsDict).reduce((acc, k) => {
    acc[k] = weightsDict[k] / total;
    return acc;
  }, {} as Record<string, number>);
}

function signalOccupancy(occupancy: number, cfg: ModuloPricingConfig): number {
  const o = clamp(occupancy, 0.0, 1.0);
  let sig: number;
  
  if (o < cfg.occHardFloor) {
    // Stronger downward pressure below hard floor
    const frac = o / cfg.occHardFloor;
    sig = -1.0 + 0.7 * frac;
  } else if (o <= cfg.occTarget) {
    // Map [occHardFloor, occTarget] → [-0.3, 0]
    const span = cfg.occTarget - cfg.occHardFloor;
    const frac = span === 0 ? 0 : (o - cfg.occHardFloor) / span;
    sig = -0.3 + 0.3 * frac;
  } else {
    // Map (occTarget, 1.0] → (0, +1]
    const span = 1.0 - cfg.occTarget;
    const frac = span === 0 ? 1.0 : (o - cfg.occTarget) / span;
    sig = 0.0 + 1.0 * frac;
  }
  
  // Convert to bounded price effect
  const neg = Math.abs(cfg.occMaxCut);
  const pos = cfg.occMaxPremium;
  let effect: number;
  let norm: number;
  
  if (sig >= 0) {
    effect = sig * pos;
    norm = pos > 0 ? pos : 1e-9;
  } else {
    effect = sig * neg;
    norm = neg > 0 ? neg : 1e-9;
  }
  
  return clamp(effect / norm, -1.0, 1.0);
}

function signalDaysVacant(daysVacant: number, cfg: ModuloPricingConfig): number {
  if (daysVacant <= cfg.dvGraceDays) {
    return 0.0;
  }
  const d = daysVacant - cfg.dvGraceDays;
  // Smooth exponential approach
  const frac = 1.0 - Math.exp(-cfg.dvDecaySpeed * d);
  const effect = cfg.dvMaxCut * frac;
  return clamp(effect / Math.abs(cfg.dvMaxCut), -1.0, 0.0);
}

function signalSeasonality(monthIndex: number, cfg: ModuloPricingConfig): number {
  const m = clamp(monthIndex, 1, 12);
  const base = cfg.seasonalityProfile[m - 1];
  return clamp(base / cfg.seasonalitySpan, -1.0, 1.0);
}

/**
 * Service Line Premium Targets (above competitor median):
 * - AL (Assisted Living): 25% premium - Higher care, premium positioning
 * - HC (Health Care): 20% premium - Skilled nursing, clinical services
 * - AL/MC (Memory Care): 20% premium - Specialized dementia care
 * - HC/MC: 20% premium - Combined skilled nursing and memory care
 * - SL (Supportive Living): 10% premium - Light assistance, moderate positioning
 * - VIL (Village/Independent): 10% premium - Lifestyle focus, competitive positioning
 * - Default: 18% premium - Balanced positioning for unspecified service lines
 */
export function getTargetPremium(serviceLine?: string): number {
  if (serviceLine === 'AL') return 0.25;
  if (serviceLine === 'SL') return 0.10;
  if (serviceLine === 'VIL') return 0.10;
  if (serviceLine === 'HC' || serviceLine === 'AL/MC' || serviceLine === 'HC/MC') return 0.20;
  return 0.18; // Default
}

function signalCompetitors(basePrice: number, competitorPrices: number[], cfg: ModuloPricingConfig, serviceLine?: string): number {
  if (!competitorPrices || competitorPrices.length === 0) {
    return 0.0;
  }
  
  const sorted = [...competitorPrices].sort((a, b) => a - b);
  const compMed = sorted[Math.floor(sorted.length / 2)];
  
  if (compMed <= 0) {
    return 0.0;
  }
  
  // Get target premium based on service line (see getTargetPremium for documentation)
  const targetPremium = getTargetPremium(serviceLine);
  
  // Calculate how far we are from the target premium
  const currentPremium = (basePrice - compMed) / compMed;
  const premiumGap = targetPremium - currentPremium;
  
  // Positive gap means we need to raise prices to reach target
  // Negative gap means we're above target and should lower prices
  const rawEffect = clamp(premiumGap * cfg.compSensitivity, -cfg.compCap, cfg.compCap);
  return clamp(rawEffect / cfg.compCap, -1.0, 1.0);
}

function signalMarket(mktReturn: number, cfg: ModuloPricingConfig): number {
  const r = clamp(mktReturn, -cfg.mktMaxAbsReturn, cfg.mktMaxAbsReturn);
  const effect = (r / cfg.mktMaxAbsReturn) * cfg.mktSpan;
  return clamp(effect / cfg.mktSpan, -1.0, 1.0);
}

function signalDemand(current: number, history: number[], cfg: ModuloPricingConfig): number {
  if (!history || history.length === 0) {
    return 0.0;
  }
  
  const mean = history.reduce((sum, v) => sum + v, 0) / history.length;
  let sigma = 0;
  
  if (history.length > 1) {
    const squaredDiffs = history.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / history.length;
    sigma = Math.sqrt(variance);
  }
  
  let z = 0.0;
  if (sigma > 0) {
    z = (current - mean) / sigma;
  }
  
  z = clamp(z, -cfg.demandMaxZ, cfg.demandMaxZ);
  const effect = (z / cfg.demandMaxZ) * cfg.demandSpan;
  return clamp(effect / cfg.demandSpan, -1.0, 1.0);
}

/**
 * Revenue Growth Target Signal
 * 
 * This is a STRATEGIC OVERRIDE - not part of the normalized weighted signals.
 * It applies pressure based on how the service line is tracking against its revenue growth target.
 * 
 * Gap = actualYOY - targetGrowth (positive = ahead, negative = behind)
 * 
 * Logic:
 * - If ahead of target (gap >= 0): slight positive signal (can maintain/slight premium)
 * - If behind target (gap < 0): positive signal (upward pricing pressure to grow revenue)
 * 
 * The signal is normalized to [-1, +1] range and capped at revenueGrowthSpan (±5%)
 */
function signalRevenueGrowthTarget(gap: number | undefined, cfg: ModuloPricingConfig): number {
  if (gap === undefined || gap === null) {
    return 0.0;
  }
  
  if (gap >= 0) {
    // Ahead of target - return 0 to slight positive (maintain pricing, allow slight premium)
    // Max out at 0.2 when significantly ahead
    return Math.min(0.2, gap / 10);
  } else {
    // Behind target - return positive signal (upward pricing pressure)
    // The more behind, the stronger the pressure to increase prices
    // Max out at signal = 1.0 when 10+ points behind target
    return Math.min(1.0, Math.abs(gap) / 10);
  }
}

export interface PricingInputs {
  occupancy: number;           // 0-1 (e.g., 0.85 for 85%)
  daysVacant: number;          // integer days
  monthIndex: number;          // 1-12
  competitorPrices: number[];  // array of competitor rates
  marketReturn: number;        // e.g., 0.03 for +3%
  demandCurrent: number;       // current inquiries/tours
  demandHistory: number[];     // historical inquiries/tours
  serviceLine?: string;        // Service line (AL, HC, SL, VIL, AL/MC, HC/MC) for market positioning
  revenueGrowthGap?: number;   // Gap between target and actual YOY growth (positive = ahead, negative = behind)
  targetRevenueGrowth?: number; // The target growth percentage for this service line
}

export interface PricingWeights {
  occupancy: number;
  daysVacant: number;
  seasonality: number;
  competitors: number;
  market: number;
  demand: number;
}

export interface PricingResult {
  signals: Record<string, number>;
  weights: Record<string, number>;
  blendedSignal: number;
  totalAdjustment: number;
  preOverrideTotalAdj?: number;
  finalPrice: number;
  adjustments?: Array<{
    factor: string;
    adjustment: number;
    weight: number;
    weightedAdjustment: number;
    impact: number;
    description: string;
    calculation: string;
    signal?: number;
    rawData?: Record<string, any>;
    signalExplanation?: string;
  }>;
}

export function calculateModuloPrice(
  basePrice: number,
  weights0To100: PricingWeights,
  inputs: PricingInputs,
  cfg: ModuloPricingConfig = defaultConfig
): PricingResult {
  // Convert weights to normalized form
  const w = normalizeWeights({
    occupancy: weights0To100.occupancy,
    daysVacant: weights0To100.daysVacant,
    seasonality: weights0To100.seasonality,
    competitors: weights0To100.competitors,
    market: weights0To100.market,
    demand: weights0To100.demand
  });
  
  // Calculate signals for each factor
  const sigs: Record<string, number> = {
    occupancy: signalOccupancy(inputs.occupancy, cfg),
    daysVacant: signalDaysVacant(inputs.daysVacant, cfg),
    seasonality: signalSeasonality(inputs.monthIndex, cfg),
    competitors: signalCompetitors(basePrice, inputs.competitorPrices, cfg, inputs.serviceLine),
    market: signalMarket(inputs.marketReturn, cfg),
    demand: signalDemand(inputs.demandCurrent, inputs.demandHistory, cfg)
  };
  
  // Calculate blended signal from weighted factors
  const blendedSignal = Object.keys(w).reduce((sum, k) => sum + w[k] * sigs[k], 0);
  
  // Convert to percentage adjustment
  let totalAdj: number;
  if (blendedSignal >= 0) {
    totalAdj = blendedSignal * cfg.maxTotalAdj;
  } else {
    totalAdj = blendedSignal * Math.abs(cfg.minTotalAdj);
  }
  
  totalAdj = clamp(totalAdj, cfg.minTotalAdj, cfg.maxTotalAdj);
  
  // Revenue Growth Target - Strategic Override (NOT part of normalized weights)
  // This applies additional pricing pressure based on revenue target gap
  const revenueGrowthSignal = signalRevenueGrowthTarget(inputs.revenueGrowthGap, cfg);
  const revenueGrowthAdjustment = revenueGrowthSignal * cfg.revenueGrowthSpan;
  
  // Add revenue growth adjustment on top of the blended adjustment
  const totalAdjWithRevenue = totalAdj + revenueGrowthAdjustment;
  const finalTotalAdj = clamp(totalAdjWithRevenue, cfg.minTotalAdj, cfg.maxTotalAdj);
  
  const finalPrice = basePrice * (1.0 + finalTotalAdj);
  
  // Create detailed adjustments array for UI
  const adjustments = Object.keys(w).map(key => {
    const signal = sigs[key];
    const weight = w[key];
    const weightedSignal = signal * weight;
    
    // Calculate this factor's proportional contribution to the total adjustment
    // Each factor gets (its weighted signal / total blended signal) × total adjustment
    const factorAdjustment = blendedSignal !== 0 
      ? (weightedSignal / blendedSignal) * totalAdj 
      : 0;
    
    // Convert back to percentage for display
    let adjustmentPct: number;
    if (key === 'occupancy') {
      adjustmentPct = signal * (signal >= 0 ? cfg.occMaxPremium : Math.abs(cfg.occMaxCut));
    } else if (key === 'daysVacant') {
      adjustmentPct = signal * Math.abs(cfg.dvMaxCut);
    } else if (key === 'seasonality') {
      adjustmentPct = signal * cfg.seasonalitySpan;
    } else if (key === 'competitors') {
      adjustmentPct = signal * cfg.compCap;
    } else if (key === 'market') {
      adjustmentPct = signal * cfg.mktSpan;
    } else if (key === 'demand') {
      adjustmentPct = signal * cfg.demandSpan;
    } else {
      adjustmentPct = 0;
    }
    
    return {
      factor: key.charAt(0).toUpperCase() + key.slice(1),
      adjustment: adjustmentPct,  // Keep as decimal (0.0364 = 3.64%)
      weight: weights0To100[key as keyof PricingWeights],
      weightedAdjustment: factorAdjustment,  // Keep as decimal (0.0276 = 2.76%)
      impact: basePrice * factorAdjustment,
      description: getFactorDescription(key, inputs, adjustmentPct, basePrice),
      calculation: getCalculationString(key, inputs, signal, adjustmentPct, basePrice),
      signal: signal,
      rawData: getRawData(key, inputs, basePrice, cfg),
      signalExplanation: getSignalExplanation(key, signal, adjustmentPct)
    };
  });
  
  // Add revenue growth target adjustment if applicable (strategic override, not weighted)
  if (inputs.revenueGrowthGap !== undefined && inputs.revenueGrowthGap !== null) {
    const gap = inputs.revenueGrowthGap;
    const targetGrowth = inputs.targetRevenueGrowth || 0;
    const actualYOY = targetGrowth + gap;
    
    adjustments.push({
      factor: 'RevenueTarget',
      adjustment: revenueGrowthAdjustment,
      weight: 0, // Not part of weighted system
      weightedAdjustment: revenueGrowthAdjustment,
      impact: basePrice * revenueGrowthAdjustment,
      description: gap >= 0 
        ? `Revenue target: ${actualYOY.toFixed(1)}% YOY vs ${targetGrowth.toFixed(1)}% target (${gap.toFixed(1)}% ahead)`
        : `Revenue target: ${actualYOY.toFixed(1)}% YOY vs ${targetGrowth.toFixed(1)}% target (${Math.abs(gap).toFixed(1)}% behind)`,
      calculation: gap >= 0
        ? `Ahead of target by ${gap.toFixed(1)}% → +${(revenueGrowthAdjustment * 100).toFixed(2)}% adjustment`
        : `Behind target by ${Math.abs(gap).toFixed(1)}% → +${(revenueGrowthAdjustment * 100).toFixed(2)}% adjustment`,
      signal: revenueGrowthSignal,
      rawData: {
        'Target Growth': `${targetGrowth.toFixed(1)}%`,
        'Actual YOY': `${actualYOY.toFixed(1)}%`,
        'Gap': `${gap.toFixed(1)}%`,
        'Status': gap >= 0 ? 'On Track / Exceeding' : 'Behind Target',
        'Max Effect': '±5%',
        'Note': 'Strategic override - not part of weighted signals'
      },
      signalExplanation: `Revenue growth target adjustment applies strategic pricing pressure. When behind target (gap=${gap.toFixed(1)}%), upward pricing pressure is applied to help achieve revenue goals. Signal of ${revenueGrowthSignal.toFixed(3)} translates to ${(revenueGrowthAdjustment * 100).toFixed(2)}% adjustment (max ±5%).`
    });
  }
  
  // Include revenue growth signal in signals object for visibility
  const allSignals = {
    ...sigs,
    revenueTarget: revenueGrowthSignal
  };
  
  return {
    signals: allSignals,
    weights: w,
    blendedSignal,
    totalAdjustment: finalTotalAdj,
    preOverrideTotalAdj: totalAdj,
    finalPrice: Math.round(finalPrice * 100) / 100,
    adjustments
  };
}

function getFactorDescription(factor: string, inputs: PricingInputs, adjustment: number, basePrice: number): string {
  switch(factor) {
    case 'occupancy':
      return `Unit type occupancy: ${Math.round(inputs.occupancy * 100)}% (target: 90%)`;
    case 'daysVacant':
      return `Unit vacant for ${inputs.daysVacant} days`;
    case 'seasonality':
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${months[inputs.monthIndex - 1]} seasonal adjustment`;
    case 'competitors':
      if (!inputs.competitorPrices || inputs.competitorPrices.length === 0) {
        return 'No competitor data available';
      }
      const sortedComp = [...inputs.competitorPrices].sort((a, b) => a - b);
      const medianComp = sortedComp[Math.floor(sortedComp.length / 2)];
      if (medianComp <= 0) {
        return 'Invalid competitor rates';
      }
      const targetPremComp = getTargetPremium(inputs.serviceLine);
      const currentPremComp = (basePrice - medianComp) / medianComp;
      const gapComp = targetPremComp - currentPremComp;
      return `Currently ${(currentPremComp * 100).toFixed(1)}% ${currentPremComp >= 0 ? 'above' : 'below'} market, target ${(targetPremComp * 100).toFixed(0)}% above (${gapComp > 0 ? '+' : ''}${(gapComp * 100).toFixed(1)}% gap)`;
    case 'market':
      return `Market return: ${(inputs.marketReturn * 100).toFixed(1)}%`;
    case 'demand':
      if (!inputs.demandHistory || inputs.demandHistory.length === 0) {
        return `Current demand: ${inputs.demandCurrent} (no historical data)`;
      }
      const avgDemand = inputs.demandHistory.reduce((a, b) => a + b, 0) / inputs.demandHistory.length;
      return `Current demand: ${inputs.demandCurrent} (historical avg: ${avgDemand.toFixed(1)})`;
    default:
      return '';
  }
}

function getCalculationString(factor: string, inputs: PricingInputs, signal: number, adjustment: number, basePrice: number): string {
  switch(factor) {
    case 'occupancy':
      return `Signal: ${signal.toFixed(3)} → Adjustment: ${(adjustment * 100).toFixed(2)}%`;
    case 'daysVacant':
      const graceDays = 7;
      if (inputs.daysVacant <= graceDays) {
        return `Within ${graceDays}-day grace period → 0% adjustment`;
      }
      return `Days past grace: ${inputs.daysVacant - graceDays} → ${(adjustment * 100).toFixed(2)}%`;
    case 'seasonality':
      return `Monthly factor → ${(adjustment * 100).toFixed(2)}%`;
    case 'competitors':
      if (!inputs.competitorPrices || inputs.competitorPrices.length === 0) {
        return 'No competitor data → 0% adjustment';
      }
      const sortedCalc = [...inputs.competitorPrices].sort((a, b) => a - b);
      const medianCalc = sortedCalc[Math.floor(sortedCalc.length / 2)];
      if (medianCalc <= 0) {
        return 'Invalid competitor rates → 0% adjustment';
      }
      const targetPremCalc = getTargetPremium(inputs.serviceLine);
      const currentPremCalc = (basePrice - medianCalc) / medianCalc;
      const gapCalc = targetPremCalc - currentPremCalc;
      return `Target ${(targetPremCalc * 100).toFixed(0)}% - Current ${(currentPremCalc * 100).toFixed(1)}% = ${(gapCalc * 100).toFixed(1)}% gap → ${(adjustment * 100).toFixed(2)}% adjustment`;
    case 'market':
      return `Market sentiment adjustment → ${(adjustment * 100).toFixed(2)}%`;
    case 'demand':
      if (!inputs.demandHistory || inputs.demandHistory.length === 0) {
        return 'No historical data → 0% adjustment';
      }
      const mean = inputs.demandHistory.reduce((a, b) => a + b, 0) / inputs.demandHistory.length;
      const variance = inputs.demandHistory.map(v => Math.pow(v - mean, 2)).reduce((a, b) => a + b, 0) / inputs.demandHistory.length;
      const stdDev = Math.sqrt(variance);
      const z = stdDev > 0 ? (inputs.demandCurrent - mean) / stdDev : 0;
      return `Z-score: ${z.toFixed(2)} → ${(adjustment * 100).toFixed(2)}%`;
    default:
      return '';
  }
}

function getRawData(factor: string, inputs: PricingInputs, basePrice: number, cfg: ModuloPricingConfig): Record<string, any> {
  switch(factor) {
    case 'occupancy':
      return {
        'Current Occupancy': `${(inputs.occupancy * 100).toFixed(1)}%`,
        'Target Occupancy': '90%',
        'Floor (Strong Cuts)': '85%',
        'Occupancy Pressure': inputs.occupancy < 0.85 ? 'High pressure to cut' : inputs.occupancy > 0.90 ? 'Premium territory' : 'Moderate zone'
      };
    case 'daysVacant':
      return {
        'Days Vacant': inputs.daysVacant,
        'Grace Period': '7 days',
        'Days Beyond Grace': Math.max(0, inputs.daysVacant - 7),
        'Max Decay': '-15%'
      };
    case 'seasonality':
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return {
        'Current Month': months[inputs.monthIndex - 1],
        'Month Index': inputs.monthIndex,
        'Seasonal Pattern': 'Winter=Low, Spring/Fall=Moderate, Summer=Peak'
      };
    case 'competitors':
      if (!inputs.competitorPrices || inputs.competitorPrices.length === 0) {
        return {
          'Base Price': `$${basePrice.toFixed(0)}`,
          'Competitor Data': 'No competitor rates available',
          'Service Line': inputs.serviceLine || 'Default'
        };
      }
      const sorted = [...inputs.competitorPrices].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      
      if (median <= 0) {
        return {
          'Base Price': `$${basePrice.toFixed(0)}`,
          'Competitor Data': 'Invalid competitor rates',
          'Service Line': inputs.serviceLine || 'Default'
        };
      }
      
      // Use the centralized target premium function
      const targetPremium = getTargetPremium(inputs.serviceLine);
      
      const currentPremium = (basePrice - median) / median;
      const premiumGap = targetPremium - currentPremium;
      
      return {
        'Base Price': `$${basePrice.toFixed(0)}`,
        'Competitor Median': `$${median.toFixed(0)}`,
        'Target Premium': `${(targetPremium * 100).toFixed(0)}% above market`,
        'Current Position': `${(currentPremium * 100).toFixed(1)}% ${currentPremium >= 0 ? 'above' : 'below'} market`,
        'Premium Gap': `${(premiumGap * 100).toFixed(1)}% ${premiumGap > 0 ? 'increase needed' : 'above target'}`,
        'Service Line': inputs.serviceLine || 'Default'
      };
    case 'market':
      return {
        'Market Return': `${(inputs.marketReturn * 100).toFixed(2)}%`,
        'Sentiment': inputs.marketReturn > 0 ? 'Positive' : inputs.marketReturn < 0 ? 'Negative' : 'Neutral',
        'Max Influence': '±5%'
      };
    case 'demand':
      if (!inputs.demandHistory || inputs.demandHistory.length === 0) {
        return {
          'Current Demand': inputs.demandCurrent,
          'Historical Data': 'No historical data available',
          'Interpretation': 'Cannot calculate z-score without history'
        };
      }
      const demandMean = inputs.demandHistory.reduce((a, b) => a + b, 0) / inputs.demandHistory.length;
      const demandVariance = inputs.demandHistory.map(v => Math.pow(v - demandMean, 2)).reduce((a, b) => a + b, 0) / inputs.demandHistory.length;
      const demandStdDev = Math.sqrt(demandVariance);
      const demandZ = demandStdDev > 0 ? (inputs.demandCurrent - demandMean) / demandStdDev : 0;
      return {
        'Current Demand': inputs.demandCurrent,
        'Historical Average': demandMean.toFixed(1),
        'Standard Deviation': demandStdDev.toFixed(1),
        'Z-Score': demandZ.toFixed(2),
        'Interpretation': demandZ > 1 ? 'High demand' : demandZ < -1 ? 'Low demand' : 'Normal demand'
      };
    default:
      return {};
  }
}

function getSignalExplanation(factor: string, signal: number, adjustment: number): string {
  switch(factor) {
    case 'occupancy':
      return `The campus occupancy signal (${signal.toFixed(3)}) was normalized to -1 to +1 range based on proximity to the 90% target, then scaled to a ${(adjustment * 100).toFixed(1)}% price adjustment. Above 90% triggers premium pricing; below 85% triggers aggressive discounting.`;
    case 'daysVacant':
      return `The vacancy duration signal (${signal.toFixed(3)}) represents the exponential decay after the 7-day grace period, scaled to a ${(adjustment * 100).toFixed(1)}% adjustment with a -15% maximum discount to accelerate leasing for long-vacant units.`;
    case 'seasonality':
      return `The seasonal signal (${signal.toFixed(3)}) reflects typical senior housing demand patterns: spring/summer (Mar-Aug) peaks at +2-5%, while late fall/winter (Oct-Dec) sees -2-3% adjustments.`;
    case 'competitors':
      return `The market positioning signal (${signal.toFixed(3)}) drives pricing toward your target premium above competitors. Target premiums by service line: AL=25%, HC/AL-MC/HC-MC=20%, SL/VIL=10%, Default=18%. Adjustments capped at ±8% per cycle.`;
    case 'market':
      return `The economic indicator signal (${signal.toFixed(3)}) reflects broader market conditions based on S&P 500 returns, with limited ±3% influence on senior housing pricing to maintain stability.`;
    case 'demand':
      return `The demand signal (${signal.toFixed(3)}) uses statistical z-score analysis to detect unusual inquiry/tour volume relative to historical patterns, adjusting prices by up to ±15% for significant demand shifts.`;
    default:
      return 'Signal normalized to -1 to +1 range and converted to percentage adjustment.';
  }
}

export const moduloPricingAlgorithm = {
  calculatePrice: calculateModuloPrice,
  defaultConfig,
  getTargetPremium
};