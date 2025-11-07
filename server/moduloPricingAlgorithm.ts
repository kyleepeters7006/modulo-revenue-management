// Advanced Modulo Pricing Algorithm for Senior Housing
// Based on the provided Python implementation with multi-signal blending

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

  // Room Attributes (per-unit desirability score in [0,1])
  attrMidpoint: number;
  attrMaxSpan: number;      // ±10% swing at extremes from attributes

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
  
  attrMidpoint: 0.50,
  attrMaxSpan: 0.10,
  
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
  demandMaxZ: 2.0
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

function signalRoomAttributes(attrScore: number, cfg: ModuloPricingConfig): number {
  const s = clamp(attrScore, 0.0, 1.0);
  let sig: number;
  
  if (s === cfg.attrMidpoint) {
    sig = 0.0;
  } else if (s > cfg.attrMidpoint) {
    sig = (s - cfg.attrMidpoint) / (1.0 - cfg.attrMidpoint);
  } else {
    sig = -(cfg.attrMidpoint - s) / cfg.attrMidpoint;
  }
  
  const effect = sig * cfg.attrMaxSpan;
  return clamp(effect / cfg.attrMaxSpan, -1.0, 1.0);
}

function signalSeasonality(monthIndex: number, cfg: ModuloPricingConfig): number {
  const m = clamp(monthIndex, 1, 12);
  const base = cfg.seasonalityProfile[m - 1];
  return clamp(base / cfg.seasonalitySpan, -1.0, 1.0);
}

function signalCompetitors(basePrice: number, competitorPrices: number[], cfg: ModuloPricingConfig): number {
  if (!competitorPrices || competitorPrices.length === 0) {
    return 0.0;
  }
  
  const sorted = [...competitorPrices].sort((a, b) => a - b);
  const compMed = sorted[Math.floor(sorted.length / 2)];
  
  if (compMed <= 0) {
    return 0.0;
  }
  
  const pctDiff = (basePrice - compMed) / compMed;
  const rawEffect = clamp(-pctDiff * cfg.compSensitivity, -cfg.compCap, cfg.compCap);
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

export interface PricingInputs {
  occupancy: number;           // 0-1 (e.g., 0.85 for 85%)
  daysVacant: number;          // integer days
  attrScore: number;           // 0-1 normalized score
  monthIndex: number;          // 1-12
  competitorPrices: number[];  // array of competitor rates
  marketReturn: number;        // e.g., 0.03 for +3%
  demandCurrent: number;       // current inquiries/tours
  demandHistory: number[];     // historical inquiries/tours
}

export interface PricingWeights {
  occupancy: number;
  daysVacant: number;
  attributes: number;
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
  finalPrice: number;
  adjustments?: Array<{
    factor: string;
    adjustment: number;
    weight: number;
    weightedAdjustment: number;
    impact: number;
    description: string;
    calculation: string;
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
    attributes: weights0To100.attributes,
    seasonality: weights0To100.seasonality,
    competitors: weights0To100.competitors,
    market: weights0To100.market,
    demand: weights0To100.demand
  });
  
  // Calculate signals for each factor
  const sigs: Record<string, number> = {
    occupancy: signalOccupancy(inputs.occupancy, cfg),
    daysVacant: signalDaysVacant(inputs.daysVacant, cfg),
    attributes: signalRoomAttributes(inputs.attrScore, cfg),
    seasonality: signalSeasonality(inputs.monthIndex, cfg),
    competitors: signalCompetitors(basePrice, inputs.competitorPrices, cfg),
    market: signalMarket(inputs.marketReturn, cfg),
    demand: signalDemand(inputs.demandCurrent, inputs.demandHistory, cfg)
  };
  
  // Calculate blended signal
  const blendedSignal = Object.keys(w).reduce((sum, k) => sum + w[k] * sigs[k], 0);
  
  // Convert to percentage adjustment
  let totalAdj: number;
  if (blendedSignal >= 0) {
    totalAdj = blendedSignal * cfg.maxTotalAdj;
  } else {
    totalAdj = blendedSignal * Math.abs(cfg.minTotalAdj);
  }
  
  totalAdj = clamp(totalAdj, cfg.minTotalAdj, cfg.maxTotalAdj);
  const finalPrice = basePrice * (1.0 + totalAdj);
  
  // Create detailed adjustments array for UI
  const adjustments = Object.keys(w).map(key => {
    const signal = sigs[key];
    const weight = w[key];
    const weightedSignal = signal * weight;
    
    // Convert back to percentage for display
    let adjustmentPct: number;
    if (key === 'occupancy') {
      adjustmentPct = signal * (signal >= 0 ? cfg.occMaxPremium : Math.abs(cfg.occMaxCut));
    } else if (key === 'daysVacant') {
      adjustmentPct = signal * Math.abs(cfg.dvMaxCut);
    } else if (key === 'attributes') {
      adjustmentPct = signal * cfg.attrMaxSpan;
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
      adjustment: adjustmentPct * 100,
      weight: weights0To100[key as keyof PricingWeights],
      weightedAdjustment: weightedSignal * totalAdj * 100,
      impact: basePrice * weightedSignal * totalAdj,
      description: getFactorDescription(key, inputs, adjustmentPct),
      calculation: getCalculationString(key, inputs, signal, adjustmentPct)
    };
  });
  
  return {
    signals: sigs,
    weights: w,
    blendedSignal,
    totalAdjustment: totalAdj,
    finalPrice: Math.round(finalPrice * 100) / 100,
    adjustments
  };
}

function getFactorDescription(factor: string, inputs: PricingInputs, adjustment: number): string {
  switch(factor) {
    case 'occupancy':
      return `Campus at ${Math.round(inputs.occupancy * 100)}% occupancy (target: 90%)`;
    case 'daysVacant':
      return `Unit vacant for ${inputs.daysVacant} days`;
    case 'attributes':
      return `Room desirability score: ${(inputs.attrScore * 100).toFixed(0)}%`;
    case 'seasonality':
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${months[inputs.monthIndex - 1]} seasonal adjustment`;
    case 'competitors':
      return `Competitor median: $${Math.round(inputs.competitorPrices.sort((a, b) => a - b)[Math.floor(inputs.competitorPrices.length / 2)])}`;
    case 'market':
      return `Market return: ${(inputs.marketReturn * 100).toFixed(1)}%`;
    case 'demand':
      return `Current demand: ${inputs.demandCurrent} (historical avg: ${(inputs.demandHistory.reduce((a, b) => a + b, 0) / inputs.demandHistory.length).toFixed(1)})`;
    default:
      return '';
  }
}

function getCalculationString(factor: string, inputs: PricingInputs, signal: number, adjustment: number): string {
  switch(factor) {
    case 'occupancy':
      return `Signal: ${signal.toFixed(3)} → Adjustment: ${(adjustment * 100).toFixed(2)}%`;
    case 'daysVacant':
      const graceDays = 7;
      if (inputs.daysVacant <= graceDays) {
        return `Within ${graceDays}-day grace period → 0% adjustment`;
      }
      return `Days past grace: ${inputs.daysVacant - graceDays} → ${(adjustment * 100).toFixed(2)}%`;
    case 'attributes':
      return `Score ${(inputs.attrScore * 100).toFixed(0)}% vs midpoint 50% → ${(adjustment * 100).toFixed(2)}%`;
    case 'seasonality':
      return `Monthly factor → ${(adjustment * 100).toFixed(2)}%`;
    case 'competitors':
      return `Price variance from median → ${(adjustment * 100).toFixed(2)}%`;
    case 'market':
      return `Market sentiment adjustment → ${(adjustment * 100).toFixed(2)}%`;
    case 'demand':
      const mean = inputs.demandHistory.reduce((a, b) => a + b, 0) / inputs.demandHistory.length;
      const z = inputs.demandHistory.length > 1 ? 
        (inputs.demandCurrent - mean) / Math.sqrt(inputs.demandHistory.map(v => Math.pow(v - mean, 2)).reduce((a, b) => a + b, 0) / inputs.demandHistory.length) : 0;
      return `Z-score: ${z.toFixed(2)} → ${(adjustment * 100).toFixed(2)}%`;
    default:
      return '';
  }
}

export const moduloPricingAlgorithm = {
  calculatePrice: calculateModuloPrice,
  defaultConfig
};