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

function signalCompetitors(basePrice: number, competitorPrices: number[], cfg: ModuloPricingConfig, serviceLine?: string): number {
  if (!competitorPrices || competitorPrices.length === 0) {
    return 0.0;
  }
  
  const sorted = [...competitorPrices].sort((a, b) => a - b);
  const compMed = sorted[Math.floor(sorted.length / 2)];
  
  if (compMed <= 0) {
    return 0.0;
  }
  
  // Define target premium above competitors based on service line
  let targetPremium = 0.18;  // Default: 18% above competitors
  if (serviceLine === 'AL') {
    targetPremium = 0.25;  // AL units should be 25% above competitors
  } else if (serviceLine === 'IL') {
    targetPremium = 0.10;  // IL units should be 10% above competitors
  } else if (serviceLine === 'HC' || serviceLine === 'AL/MC') {
    targetPremium = 0.20;  // HC and AL/MC should be 20% above
  }
  
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

export interface PricingInputs {
  occupancy: number;           // 0-1 (e.g., 0.85 for 85%)
  daysVacant: number;          // integer days
  attrScore: number;           // 0-1 normalized score
  monthIndex: number;          // 1-12
  competitorPrices: number[];  // array of competitor rates
  marketReturn: number;        // e.g., 0.03 for +3%
  demandCurrent: number;       // current inquiries/tours
  demandHistory: number[];     // historical inquiries/tours
  serviceLine?: string;        // Service line (AL, HC, IL, AL/MC) for market positioning
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
    competitors: signalCompetitors(basePrice, inputs.competitorPrices, cfg, inputs.serviceLine),
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
      weightedAdjustment: factorAdjustment * 100,
      impact: basePrice * factorAdjustment,
      description: getFactorDescription(key, inputs, adjustmentPct, basePrice),
      calculation: getCalculationString(key, inputs, signal, adjustmentPct, basePrice),
      signal: signal,
      rawData: getRawData(key, inputs, basePrice, cfg),
      signalExplanation: getSignalExplanation(key, signal, adjustmentPct)
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

function getFactorDescription(factor: string, inputs: PricingInputs, adjustment: number, basePrice: number): string {
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
      const sortedComp = inputs.competitorPrices.sort((a, b) => a - b);
      const medianComp = sortedComp[Math.floor(sortedComp.length / 2)];
      let targetPremComp = 0.18;
      if (inputs.serviceLine === 'AL') targetPremComp = 0.25;
      else if (inputs.serviceLine === 'IL') targetPremComp = 0.10;
      else if (inputs.serviceLine === 'HC' || inputs.serviceLine === 'AL/MC') targetPremComp = 0.20;
      const currentPremComp = (basePrice - medianComp) / medianComp;
      const gapComp = targetPremComp - currentPremComp;
      return `Currently ${(currentPremComp * 100).toFixed(1)}% ${currentPremComp >= 0 ? 'above' : 'below'} market, target ${(targetPremComp * 100).toFixed(0)}% above (${gapComp > 0 ? '+' : ''}${(gapComp * 100).toFixed(1)}% gap)`;
    case 'market':
      return `Market return: ${(inputs.marketReturn * 100).toFixed(1)}%`;
    case 'demand':
      return `Current demand: ${inputs.demandCurrent} (historical avg: ${(inputs.demandHistory.reduce((a, b) => a + b, 0) / inputs.demandHistory.length).toFixed(1)})`;
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
    case 'attributes':
      return `Score ${(inputs.attrScore * 100).toFixed(0)}% vs midpoint 50% → ${(adjustment * 100).toFixed(2)}%`;
    case 'seasonality':
      return `Monthly factor → ${(adjustment * 100).toFixed(2)}%`;
    case 'competitors':
      const sortedCalc = inputs.competitorPrices.sort((a, b) => a - b);
      const medianCalc = sortedCalc[Math.floor(sortedCalc.length / 2)];
      let targetPremCalc = 0.18;
      if (inputs.serviceLine === 'AL') targetPremCalc = 0.25;
      else if (inputs.serviceLine === 'IL') targetPremCalc = 0.10;
      else if (inputs.serviceLine === 'HC' || inputs.serviceLine === 'AL/MC') targetPremCalc = 0.20;
      const currentPremCalc = (basePrice - medianCalc) / medianCalc;
      const gapCalc = targetPremCalc - currentPremCalc;
      return `Target ${(targetPremCalc * 100).toFixed(0)}% - Current ${(currentPremCalc * 100).toFixed(1)}% = ${(gapCalc * 100).toFixed(1)}% gap → ${(adjustment * 100).toFixed(2)}% adjustment`;
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
    case 'attributes':
      return {
        'Desirability Score': `${(inputs.attrScore * 100).toFixed(1)}%`,
        'Midpoint (Neutral)': '50%',
        'Variance from Midpoint': `${((inputs.attrScore - 0.5) * 100).toFixed(1)}%`,
        'Max Premium': '+10%'
      };
    case 'seasonality':
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return {
        'Current Month': months[inputs.monthIndex - 1],
        'Month Index': inputs.monthIndex,
        'Seasonal Pattern': 'Winter=Low, Spring/Fall=Moderate, Summer=Peak'
      };
    case 'competitors':
      const sorted = inputs.competitorPrices.sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      
      // Calculate target premium based on service line
      let targetPremium = 0.18;
      if (inputs.serviceLine === 'AL') targetPremium = 0.25;
      else if (inputs.serviceLine === 'IL') targetPremium = 0.10;
      else if (inputs.serviceLine === 'HC' || inputs.serviceLine === 'AL/MC') targetPremium = 0.20;
      
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
      const mean = inputs.demandHistory.reduce((a, b) => a + b, 0) / inputs.demandHistory.length;
      const variance = inputs.demandHistory.map(v => Math.pow(v - mean, 2)).reduce((a, b) => a + b, 0) / inputs.demandHistory.length;
      const stdDev = Math.sqrt(variance);
      const z = inputs.demandHistory.length > 1 ? (inputs.demandCurrent - mean) / stdDev : 0;
      return {
        'Current Demand': inputs.demandCurrent,
        'Historical Average': mean.toFixed(1),
        'Standard Deviation': stdDev.toFixed(1),
        'Z-Score': z.toFixed(2),
        'Interpretation': z > 1 ? 'High demand' : z < -1 ? 'Low demand' : 'Normal demand'
      };
    default:
      return {};
  }
}

function getSignalExplanation(factor: string, signal: number, adjustment: number): string {
  switch(factor) {
    case 'occupancy':
      return `The campus occupancy signal (${signal.toFixed(3)}) was normalized to -1 to +1 range based on proximity to the 90% target, then scaled to a ${(adjustment * 100).toFixed(1)}% price adjustment.`;
    case 'daysVacant':
      return `The vacancy duration signal (${signal.toFixed(3)}) represents the exponential decay after the 7-day grace period, scaled to a ${(adjustment * 100).toFixed(1)}% adjustment with a -15% maximum discount.`;
    case 'attributes':
      return `The room quality signal (${signal.toFixed(3)}) compares the desirability score to the 50% midpoint, allowing up to ±10% adjustment for premium or basic units.`;
    case 'seasonality':
      return `The seasonal signal (${signal.toFixed(3)}) reflects typical senior housing demand patterns, with peaks in summer months and valleys in winter.`;
    case 'competitors':
      return `The market positioning signal (${signal.toFixed(3)}) drives pricing toward your target premium above competitors (18% default, 25% AL, 10% IL, 20% HC/AL-MC), with adjustments capped at ${Math.abs(adjustment * 100).toFixed(1)}% per calculation cycle.`;
    case 'market':
      return `The economic indicator signal (${signal.toFixed(3)}) reflects broader market conditions with limited ${(Math.abs(adjustment) * 100).toFixed(1)}% influence on senior housing pricing.`;
    case 'demand':
      return `The demand signal (${signal.toFixed(3)}) uses statistical z-score analysis to detect unusual inquiry/tour volume relative to historical patterns, adjusting prices by up to ${(Math.abs(adjustment) * 100).toFixed(1)}%.`;
    default:
      return 'Signal normalized to -1 to +1 range and converted to percentage adjustment.';
  }
}

export const moduloPricingAlgorithm = {
  calculatePrice: calculateModuloPrice,
  defaultConfig
};