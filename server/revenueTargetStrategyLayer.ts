/**
 * ============================================================================
 * REVENUE TARGET STRATEGY LAYER
 * ============================================================================
 *
 * Runs AFTER the existing AI Rate and BEFORE final guardrails.
 * Classifies each vacant unit as Volume Driver, Premium Driver, or Neutral,
 * then selects the candidate rate that maximises expected revenue by year-end.
 *
 * Architecture:
 *   Street Rate
 *   → Modulo Rate
 *   → Existing AI Rate          (calculateAttributedPrice — unchanged)
 *   → THIS MODULE               (applyRevenueTargetStrategyLayer)
 *   → Target-Aware AI Rate
 *   → Guardrails                (applied here and by caller)
 *   → Stored aiSuggestedRate
 *
 * The existing Modulo Rate and existing AI Rate are never modified.
 * ============================================================================
 */

// ─── Configuration ────────────────────────────────────────────────────────────

export interface StrategyLayerConfig {
  /** Master switch. When false, returns existingAiRate unchanged. */
  enableRevenueTargetStrategyLayer: boolean;

  // Urgency
  /** Divisor that moderates urgency growth. Higher = less urgency per unit of gap/month. Default 2.0 */
  urgencyDivisor: number;

  // Candidate rate ranges (fractions; e.g. 0.05 = 5%)
  volumeDiscountMin: number;   // minimum discount for Volume Driver candidates (0.03)
  volumeDiscountMax: number;   // maximum discount for Volume Driver candidates (0.08)
  premiumIncreaseMin: number;  // minimum premium for Premium Driver candidates (0.02)
  premiumIncreaseMax: number;  // maximum premium for Premium Driver candidates (0.10)
  neutralAdjustmentLimit: number; // max adjustment for Neutral candidates (0.01)

  // Segment classification weights (must sum ≈ 1.0)
  urgencyWeight: number;
  salesVelocityWeight: number;
  competitorGapWeight: number;
  vacancyWeight: number;
  premiumAttributeWeight: number;

  // Sale probability model
  /** Price elasticity: probability multiplier = 1 - elasticityFactor × priceChangeFraction */
  elasticityFactor: number;
  /** Max fractional reduction in sale probability allowed for a premium increase (0.15 = 15%) */
  maxSaleProbReductionForPremium: number;
  /** Minimum fractional improvement in expected revenue required to override existing AI rate */
  minimumExpectedRevenueLift: number;

  // Scoring
  /** Weight given to exit-rate revenue (probability × rate) in candidate scoring */
  exitRateWeight: number;

  /** Conservative default base weekly sale probability when no history is available */
  defaultBaseSaleWeeklyProb: number;

  /** Average weeks from move-in commitment to actual move-in date (lag) */
  avgMoveInLagWeeks: number;
}

export const defaultStrategyConfig: StrategyLayerConfig = {
  enableRevenueTargetStrategyLayer: true,
  urgencyDivisor: 2.0,
  volumeDiscountMin: 0.03,
  volumeDiscountMax: 0.08,
  premiumIncreaseMin: 0.02,
  premiumIncreaseMax: 0.10,
  neutralAdjustmentLimit: 0.01,
  urgencyWeight: 0.20,
  salesVelocityWeight: 0.20,
  competitorGapWeight: 0.20,
  vacancyWeight: 0.15,
  premiumAttributeWeight: 0.25,
  elasticityFactor: 0.8,
  maxSaleProbReductionForPremium: 0.15,
  minimumExpectedRevenueLift: 0.005,
  exitRateWeight: 0.30,
  defaultBaseSaleWeeklyProb: 0.10,
  avgMoveInLagWeeks: 2,
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type UnitStrategySegment = 'volume_driver' | 'premium_driver' | 'neutral';

export interface SalesVelocityData {
  /** Estimated leases per month at this scope */
  leasesPerMonth: number;
  /** Average days from vacancy to lease */
  avgDaysToLease: number;
  /** Median days to lease */
  medianDaysToLease: number;
  /** Base weekly probability of a lease occurring for a single unit */
  baseSaleWeeklyProb: number;
  /** Average days vacant for currently vacant units at this scope */
  avgDaysVacantForUnitType: number;
  /** Number of data points used (0 = default applied) */
  sampleSize: number;
  /** Fallback level used: 'unit_type' | 'service_line' | 'campus' | 'default' */
  fallbackLevel: string;
}

export interface UnitStrategyContext {
  // Unit identifiers
  location: string;
  serviceLine: string;
  roomType: string;
  roomNumber: string;
  daysVacant: number;

  // Rates (all in monthly equivalent)
  existingAiRateMonthly: number;
  streetRateMonthly: number;
  competitorAverageRateMonthly: number | undefined;

  // Occupancy
  serviceLineOccupancy: number; // 0-1

  // Revenue target context
  growthGapPct: number | undefined;    // actualYOY - target (positive = ahead)
  targetGrowthPct: number | undefined;
  actualYtdGrowthPct: number | undefined;
  revenueGapDollars: number | undefined;
  urgencyScore: number;
  monthsRemaining: number;
  weeksRemaining: number;

  // Unit attributes
  isPremiumUnit: boolean;   // renovated, premium view, A-rated attributes
  attributeScore: number;   // -1 (poor) to +1 (excellent)

  // Sales velocity
  velocity: SalesVelocityData;

  // Guardrail bounds (monthly equivalent)
  guardrailFloorMonthly: number | undefined;
  guardrailCeilingMonthly: number | undefined;
  guardrailMaxIncreaseFraction: number; // e.g. 0.15
  guardrailMaxDecreaseFraction: number; // e.g. 0.05
}

export interface CandidateRateResult {
  candidateRateMonthly: number;
  priceChangeFraction: number;           // relative to existingAiRate
  adjustedWeeklySaleProb: number;
  expectedSaleProbByYearEnd: number;
  expectedWeeksToLease: number;
  expectedRevenueByYearEnd: number;      // saleProb × rate × revenueMonthsRemaining
  exitRateRevenue: number;               // saleProb × rate (single-month value)
  candidateScore: number;
  reasonCodes: string[];
}

export interface StrategyLayerResult {
  existingAiRateMonthly: number;
  targetAwareRateMonthly: number;
  finalGuardrailedRateMonthly: number;
  segment: UnitStrategySegment;
  segmentConfidence: number;            // 0-1
  segmentReason: string;
  urgencyScore: number;
  baseSaleWeeklyProb: number;
  expectedSaleProbExistingAi: number;
  expectedSaleProbTargetAware: number;
  expectedRevenueExistingAi: number;
  expectedRevenueTargetAware: number;
  incrementalExpectedRevenue: number;
  competitorAverageRate: number | undefined;
  competitorGapPct: number | undefined;
  avgDaysVacantForUnitType: number;
  guardrailApplied: boolean;
  guardrailReason: string;
  reasonCodes: string[];
  /** True when strategy layer kept the existing AI rate (no meaningful improvement found) */
  noImprovementFound: boolean;
}

export interface PortfolioProjection {
  projectedRevenueExistingAi: number;
  projectedRevenueTargetAware: number;
  incrementalRevenue: number;
  revenueGapDollars: number;
  gapClosureDollars: number;
  gapClosurePct: number;
  remainingGapAfterStrategy: number;
  volumeDriverCount: number;
  premiumDriverCount: number;
  neutralCount: number;
  occupiedSkippedCount: number;
  noTargetCount: number;
  summaryMessage: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Months remaining in the current calendar year from today */
export function getMonthsRemainingInYear(today: Date = new Date()): number {
  const decEnd = new Date(today.getFullYear(), 11, 31);
  const msPerMonth = 1000 * 60 * 60 * 24 * (365.25 / 12);
  return Math.max(0, (decEnd.getTime() - today.getTime()) / msPerMonth);
}

/** Weeks remaining in the current calendar year from today */
export function getWeeksRemainingInYear(today: Date = new Date()): number {
  const decEnd = new Date(today.getFullYear(), 11, 31);
  const msPerWeek = 1000 * 60 * 60 * 24 * 7;
  return Math.max(0, (decEnd.getTime() - today.getTime()) / msPerWeek);
}

/**
 * Urgency score: 0 (no urgency) to 1 (maximum urgency).
 * Increases when the growth gap is large and months remaining are few.
 */
export function calculateUrgencyScore(
  growthGapPct: number | undefined,
  monthsRemaining: number,
  urgencyDivisor: number
): number {
  if (growthGapPct === undefined || growthGapPct >= 0) return 0; // ahead of target → no urgency
  const gap = Math.abs(growthGapPct);
  return clamp((gap / Math.max(monthsRemaining, 1)) / urgencyDivisor, 0, 1);
}

/**
 * Converts a service-line rate to monthly terms.
 * HC and HC/MC are stored as $/day; all others are already $/month.
 */
export function toMonthlyRate(rate: number, serviceLine: string): number {
  const dailyLines = new Set(['HC', 'HC/MC']);
  return dailyLines.has(serviceLine) ? rate * 30.44 : rate;
}

export function fromMonthlyRate(monthlyRate: number, serviceLine: string): number {
  const dailyLines = new Set(['HC', 'HC/MC']);
  return dailyLines.has(serviceLine) ? monthlyRate / 30.44 : monthlyRate;
}

// ─── Step 2: Sales Velocity ────────────────────────────────────────────────────

interface VelocityRecord {
  location: string;
  serviceLine: string;
  roomType: string;
  daysVacant: number;
  occupiedYN: boolean;
  moveInDate: string | null;
}

type VelocityCache = Map<string, SalesVelocityData>;

/**
 * Pre-computes sales velocity data from the current month's rent roll.
 * Call once before the unit loop; pass the resulting cache to buildUnitContext().
 *
 * Falls back: roomType → serviceLine → campus → global default.
 */
export function buildSalesVelocityCache(
  units: VelocityRecord[],
  cfg: StrategyLayerConfig = defaultStrategyConfig
): VelocityCache {
  const cache: VelocityCache = new Map();
  const ninetDaysAgo = new Date();
  ninetDaysAgo.setDate(ninetDaysAgo.getDate() - 90);

  type Bucket = {
    totalUnits: number;
    vacantUnits: VelocityRecord[];
    recentLeases: number; // occupied w/ moveInDate in last 90 days
    daysVacantList: number[]; // for currently vacant units
  };

  const buckets = new Map<string, Bucket>();

  const getOrCreate = (key: string): Bucket => {
    if (!buckets.has(key)) {
      buckets.set(key, { totalUnits: 0, vacantUnits: [], recentLeases: 0, daysVacantList: [] });
    }
    return buckets.get(key)!;
  };

  for (const u of units) {
    // Keys at three granularity levels
    const keys = [
      `${u.location}|${u.serviceLine}|${u.roomType}`,
      `${u.location}|${u.serviceLine}|*`,
      `${u.location}|*|*`,
    ];

    for (const key of keys) {
      const b = getOrCreate(key);
      b.totalUnits++;
      if (!u.occupiedYN) {
        b.vacantUnits.push(u);
        if (u.daysVacant != null) b.daysVacantList.push(u.daysVacant);
      } else if (u.moveInDate) {
        const moveIn = new Date(u.moveInDate);
        if (!isNaN(moveIn.getTime()) && moveIn >= ninetDaysAgo) {
          b.recentLeases++;
        }
      }
    }
  }

  for (const [key, b] of Array.from(buckets.entries())) {
    const availableUnitWeeks = b.totalUnits * (90 / 7);
    let baseSaleWeeklyProb: number;
    let avgDaysToLease: number;
    let medianDaysToLease: number;
    let leasesPerMonth: number;
    let sampleSize = b.recentLeases;
    let fallbackLevel: string;

    const parts = key.split('|');
    if (parts[1] === '*') fallbackLevel = 'campus';
    else if (parts[2] === '*') fallbackLevel = 'service_line';
    else fallbackLevel = 'unit_type';

    if (b.recentLeases >= 1 && availableUnitWeeks > 0) {
      baseSaleWeeklyProb = clamp(b.recentLeases / availableUnitWeeks, 0.01, 0.99);
      leasesPerMonth = b.recentLeases / 3; // 90 days ≈ 3 months
      avgDaysToLease = 7 / baseSaleWeeklyProb;
      medianDaysToLease = avgDaysToLease * 0.85;
    } else {
      baseSaleWeeklyProb = cfg.defaultBaseSaleWeeklyProb;
      leasesPerMonth = 0;
      avgDaysToLease = 7 / baseSaleWeeklyProb;
      medianDaysToLease = avgDaysToLease * 0.85;
      sampleSize = 0;
      fallbackLevel = 'default';
    }

    const daysVacantList = b.daysVacantList;
    const avgDaysVacantForUnitType =
      daysVacantList.length > 0
        ? daysVacantList.reduce((s: number, v: number) => s + v, 0) / daysVacantList.length
        : 30;

    cache.set(key, {
      leasesPerMonth,
      avgDaysToLease,
      medianDaysToLease,
      baseSaleWeeklyProb,
      avgDaysVacantForUnitType,
      sampleSize,
      fallbackLevel,
    });
  }

  return cache;
}

/** Look up velocity for a unit, using fallback chain. */
function getVelocity(
  cache: VelocityCache,
  location: string,
  serviceLine: string,
  roomType: string,
  cfg: StrategyLayerConfig
): SalesVelocityData {
  const keys = [
    `${location}|${serviceLine}|${roomType}`,
    `${location}|${serviceLine}|*`,
    `${location}|*|*`,
  ];
  for (const key of keys) {
    const v = cache.get(key);
    if (v) return v;
  }
  return {
    leasesPerMonth: 0,
    avgDaysToLease: 7 / cfg.defaultBaseSaleWeeklyProb,
    medianDaysToLease: (7 / cfg.defaultBaseSaleWeeklyProb) * 0.85,
    baseSaleWeeklyProb: cfg.defaultBaseSaleWeeklyProb,
    avgDaysVacantForUnitType: 30,
    sampleSize: 0,
    fallbackLevel: 'default',
  };
}

// ─── Step 3: Unit Segmentation ─────────────────────────────────────────────────

interface SegmentationResult {
  segment: UnitStrategySegment;
  confidence: number;
  reason: string;
  volumeScore: number;
  premiumScore: number;
}

function segmentUnit(ctx: UnitStrategyContext, cfg: StrategyLayerConfig): SegmentationResult {
  let volumeScore = 0;
  let premiumScore = 0;
  const reasons: string[] = [];

  // 1. Revenue target urgency
  const urgency = ctx.urgencyScore;
  if (urgency > 0.6) {
    volumeScore += cfg.urgencyWeight * 1.0;
    reasons.push(`High urgency (${(urgency * 100).toFixed(0)}%) from revenue gap`);
  } else if (urgency > 0.3) {
    volumeScore += cfg.urgencyWeight * 0.5;
  }
  if (ctx.growthGapPct !== undefined && ctx.growthGapPct > 5) {
    premiumScore += cfg.urgencyWeight * 0.5;
    reasons.push(`Ahead of revenue target by ${ctx.growthGapPct.toFixed(1)}%`);
  }

  // 2. Sales velocity vs pace needed
  const weeksNeeded = ctx.velocity.avgDaysToLease / 7;
  const currentWeeklySaleProb = ctx.velocity.baseSaleWeeklyProb;
  const expectedSalesByYearEnd = currentWeeklySaleProb * ctx.weeksRemaining;
  if (expectedSalesByYearEnd < 0.5) {
    // Unlikely to sell before year-end at current pace
    volumeScore += cfg.salesVelocityWeight * 0.8;
    reasons.push(`Low expected sales pace (${expectedSalesByYearEnd.toFixed(2)} expected this year)`);
  } else if (expectedSalesByYearEnd > 2.0) {
    premiumScore += cfg.salesVelocityWeight * 0.8;
    reasons.push(`Strong sales velocity (${expectedSalesByYearEnd.toFixed(1)} expected this year)`);
  }

  // 3. Days vacant vs unit-type average
  const avgDaysVacant = ctx.velocity.avgDaysVacantForUnitType;
  const excessVacancy = ctx.daysVacant - avgDaysVacant;
  if (excessVacancy > 30) {
    volumeScore += cfg.vacancyWeight * 1.0;
    reasons.push(`Unit vacant ${ctx.daysVacant}d vs avg ${avgDaysVacant.toFixed(0)}d (+${excessVacancy.toFixed(0)}d)`);
  } else if (excessVacancy > 10) {
    volumeScore += cfg.vacancyWeight * 0.5;
  } else if (excessVacancy < -10) {
    premiumScore += cfg.vacancyWeight * 0.5;
    reasons.push(`Unit vacant only ${ctx.daysVacant}d (below avg of ${avgDaysVacant.toFixed(0)}d)`);
  }

  // 4. Competitor position
  if (ctx.competitorAverageRateMonthly !== undefined) {
    const compGapFraction = (ctx.existingAiRateMonthly - ctx.competitorAverageRateMonthly) / Math.max(ctx.competitorAverageRateMonthly, 1);
    if (compGapFraction > 0.10) {
      volumeScore += cfg.competitorGapWeight * 0.8;
      reasons.push(`AI Rate ${(compGapFraction * 100).toFixed(1)}% above competitor avg`);
    } else if (compGapFraction > 0.05) {
      volumeScore += cfg.competitorGapWeight * 0.3;
    } else if (compGapFraction < -0.05) {
      premiumScore += cfg.competitorGapWeight * 0.8;
      reasons.push(`AI Rate ${(Math.abs(compGapFraction) * 100).toFixed(1)}% below competitor avg — room for premium`);
    }
  }

  // 5. Occupancy pressure
  const occ = ctx.serviceLineOccupancy;
  if (occ < 0.82) {
    volumeScore += 0.10;
    reasons.push(`Low occupancy (${(occ * 100).toFixed(1)}%)`);
  } else if (occ > 0.92) {
    premiumScore += 0.10;
    reasons.push(`High occupancy (${(occ * 100).toFixed(1)}%)`);
  }

  // 6. Unit attribute quality
  if (ctx.isPremiumUnit) {
    premiumScore += cfg.premiumAttributeWeight * 0.8;
    reasons.push('Premium unit attributes support higher rate');
  } else if (ctx.attributeScore < -0.3) {
    volumeScore += cfg.premiumAttributeWeight * 0.4;
    reasons.push('Below-average unit attributes reduce premium potential');
  }

  // Normalise and classify
  const total = volumeScore + premiumScore;
  const confidence = clamp(Math.abs(volumeScore - premiumScore) / Math.max(total, 0.01), 0, 1);

  let segment: UnitStrategySegment;
  let reason: string;

  const MIN_SCORE = 0.12;
  if (volumeScore > premiumScore && volumeScore >= MIN_SCORE) {
    segment = 'volume_driver';
    reason = `Volume Driver: ${reasons.slice(0, 3).join('; ')}`;
  } else if (premiumScore > volumeScore && premiumScore >= MIN_SCORE) {
    segment = 'premium_driver';
    reason = `Premium Driver: ${reasons.slice(0, 3).join('; ')}`;
  } else {
    segment = 'neutral';
    reason = 'Neutral: current AI Rate is close to optimal or confidence is low';
  }

  return { segment, confidence, reason, volumeScore, premiumScore };
}

// ─── Steps 4 & 5: Candidate Rates + Sale Probability ──────────────────────────

function generateCandidateAdjustments(segment: UnitStrategySegment, cfg: StrategyLayerConfig): number[] {
  const step = 0.01;
  const candidates: number[] = [0]; // always include 0 (existing rate)

  if (segment === 'volume_driver') {
    for (let d = cfg.volumeDiscountMin; d <= cfg.volumeDiscountMax + 0.001; d += step) {
      candidates.push(-Math.round(d * 100) / 100);
    }
  } else if (segment === 'premium_driver') {
    for (let p = cfg.premiumIncreaseMin; p <= cfg.premiumIncreaseMax + 0.001; p += step) {
      candidates.push(Math.round(p * 100) / 100);
    }
  } else {
    candidates.push(-cfg.neutralAdjustmentLimit, cfg.neutralAdjustmentLimit);
  }

  return Array.from(new Set(candidates)).sort((a, b) => a - b);
}

function evaluateCandidateRate(
  adjustment: number,
  ctx: UnitStrategyContext,
  cfg: StrategyLayerConfig
): CandidateRateResult {
  const candidateMonthly = ctx.existingAiRateMonthly * (1 + adjustment);
  const baseSaleWeeklyProb = ctx.velocity.baseSaleWeeklyProb;
  const reasonCodes: string[] = [];

  // Sales velocity multiplier (price elasticity)
  const salesVelocityMult = clamp(1 - cfg.elasticityFactor * adjustment, 0.50, 1.50);

  // Days vacant factor: stale vacant units benefit more from discounts, less from premiums
  const excessVacancyRatio = Math.max(0, ctx.daysVacant - ctx.velocity.avgDaysVacantForUnitType) / 30;
  let daysVacantFactor: number;
  if (adjustment < 0) {
    daysVacantFactor = 1.0 + clamp(excessVacancyRatio * 0.20, 0, 0.40); // stale units respond more to discounts
  } else {
    daysVacantFactor = 1.0 - clamp(excessVacancyRatio * 0.15, 0, 0.30); // stale units get less benefit from premiums
  }

  // Occupancy factor
  const occ = ctx.serviceLineOccupancy;
  let occupancyFactor: number;
  if (occ < 0.85) {
    occupancyFactor = adjustment < 0 ? 1.10 : 0.90;
  } else if (occ > 0.92) {
    occupancyFactor = adjustment > 0 ? 1.10 : 0.95;
  } else {
    occupancyFactor = 1.0;
  }

  // Competitor position factor
  let competitorPositionFactor = 1.0;
  if (ctx.competitorAverageRateMonthly !== undefined) {
    const compGap = (candidateMonthly - ctx.competitorAverageRateMonthly) / Math.max(ctx.competitorAverageRateMonthly, 1);
    if (compGap > 0.15) {
      competitorPositionFactor = 0.85;
      reasonCodes.push(`Candidate ${(compGap * 100).toFixed(1)}% above comp avg — reduced prob`);
    } else if (compGap > 0.05) {
      competitorPositionFactor = 0.95;
    } else if (compGap < 0) {
      competitorPositionFactor = 1.10;
    }
  }

  // Unit attribute factor
  const unitAttributeFactor = ctx.isPremiumUnit
    ? (adjustment > 0 ? 1.10 : 1.0)
    : (adjustment > 0 ? 0.93 : 1.05);

  // Assemble adjusted weekly sale probability
  let adjustedWeeklyProb = baseSaleWeeklyProb
    * salesVelocityMult
    * daysVacantFactor
    * occupancyFactor
    * competitorPositionFactor
    * unitAttributeFactor;
  adjustedWeeklyProb = clamp(adjustedWeeklyProb, 0.01, 0.99);

  const weeksRemaining = ctx.weeksRemaining;
  const expectedSaleProbByYearEnd = 1 - Math.exp(-adjustedWeeklyProb * weeksRemaining);
  const expectedWeeksToLease = 1 / adjustedWeeklyProb;
  const expectedMoveInWeeks = expectedWeeksToLease + cfg.avgMoveInLagWeeks;
  const revenueMonthsRemaining = Math.max(0, ctx.monthsRemaining - expectedMoveInWeeks / 4.33);

  const expectedRevenue = expectedSaleProbByYearEnd * candidateMonthly * revenueMonthsRemaining;
  const exitRateRevenue = expectedSaleProbByYearEnd * candidateMonthly;

  // Candidate score
  const candidateScore = expectedRevenue + cfg.exitRateWeight * exitRateRevenue;

  return {
    candidateRateMonthly: candidateMonthly,
    priceChangeFraction: adjustment,
    adjustedWeeklySaleProb: adjustedWeeklyProb,
    expectedSaleProbByYearEnd,
    expectedWeeksToLease,
    expectedRevenueByYearEnd: expectedRevenue,
    exitRateRevenue,
    candidateScore,
    reasonCodes,
  };
}

// ─── Step 6: Select Best Candidate ────────────────────────────────────────────

function applyGuardrails(
  rateMonthly: number,
  existingAiRateMonthly: number,
  ctx: UnitStrategyContext
): { rate: number; applied: boolean; reason: string } {
  let rate = rateMonthly;
  const reasons: string[] = [];

  // Max increase / decrease from existing AI rate
  const maxIncrease = existingAiRateMonthly * (1 + ctx.guardrailMaxIncreaseFraction);
  const maxDecrease = existingAiRateMonthly * (1 - ctx.guardrailMaxDecreaseFraction);
  if (rate > maxIncrease) {
    rate = maxIncrease;
    reasons.push(`capped at +${(ctx.guardrailMaxIncreaseFraction * 100).toFixed(0)}% max increase guardrail`);
  }
  if (rate < maxDecrease) {
    rate = maxDecrease;
    reasons.push(`floored at -${(ctx.guardrailMaxDecreaseFraction * 100).toFixed(0)}% max decrease guardrail`);
  }

  // Absolute floor / ceiling
  if (ctx.guardrailFloorMonthly !== undefined && rate < ctx.guardrailFloorMonthly) {
    rate = ctx.guardrailFloorMonthly;
    reasons.push(`floored at absolute floor $${ctx.guardrailFloorMonthly.toFixed(0)}`);
  }
  if (ctx.guardrailCeilingMonthly !== undefined && rate > ctx.guardrailCeilingMonthly) {
    rate = ctx.guardrailCeilingMonthly;
    reasons.push(`capped at absolute ceiling $${ctx.guardrailCeilingMonthly.toFixed(0)}`);
  }

  return {
    rate,
    applied: reasons.length > 0,
    reason: reasons.join('; '),
  };
}

// ─── Main Per-Unit Function ────────────────────────────────────────────────────

/**
 * Apply the Revenue Target Strategy Layer to a single vacant unit.
 *
 * @param ctx          Pre-built context for this unit
 * @param cfg          Strategy layer configuration
 * @returns            Full result including target-aware rate and all diagnostics
 */
export function applyRevenueTargetStrategyLayer(
  ctx: UnitStrategyContext,
  cfg: StrategyLayerConfig = defaultStrategyConfig
): StrategyLayerResult {
  const existing = ctx.existingAiRateMonthly;
  const reasonCodes: string[] = [];

  // Feature flag check
  if (!cfg.enableRevenueTargetStrategyLayer) {
    return buildPassthroughResult(ctx, 'Strategy layer disabled via feature flag');
  }

  // Skip if no revenue target data
  if (ctx.growthGapPct === undefined) {
    reasonCodes.push('No revenue growth target set for this location/service line — existing AI Rate preserved');
    return buildPassthroughResult(ctx, reasonCodes[0]);
  }

  // Evaluate existing AI rate as the zero-adjustment baseline
  const baselineCandidate = evaluateCandidateRate(0, ctx, cfg);

  // Step 3: Classify unit
  const segResult = segmentUnit(ctx, cfg);

  // Step 4 & 5: Generate and evaluate candidates
  const adjustments = generateCandidateAdjustments(segResult.segment, cfg);
  const candidates = adjustments.map(adj => evaluateCandidateRate(adj, ctx, cfg));

  // Step 6: Select best candidate
  const bestCandidate = candidates.reduce((best, c) =>
    c.candidateScore > best.candidateScore ? c : best
  , candidates[0]);

  const minLift = cfg.minimumExpectedRevenueLift;
  const improvementFraction = baselineCandidate.expectedRevenueByYearEnd > 0
    ? (bestCandidate.expectedRevenueByYearEnd - baselineCandidate.expectedRevenueByYearEnd) / baselineCandidate.expectedRevenueByYearEnd
    : 0;

  let selectedRateMonthly: number;
  let noImprovementFound = false;

  // Rules: Volume Driver — only apply if expected revenue improves
  // Premium Driver — only apply if expected revenue improves OR exit-rate revenue improves without
  //                  materially reducing sale probability
  let rulesPassed = false;
  if (segResult.segment === 'volume_driver') {
    rulesPassed = improvementFraction >= minLift ||
      (ctx.serviceLineOccupancy < 0.85 && bestCandidate.priceChangeFraction < 0);
    if (rulesPassed) {
      reasonCodes.push(`Discount selected: faster expected lease-up improves projected year-end revenue by ${(improvementFraction * 100).toFixed(1)}%`);
    }
  } else if (segResult.segment === 'premium_driver') {
    const saleProbReduction = baselineCandidate.expectedSaleProbByYearEnd - bestCandidate.expectedSaleProbByYearEnd;
    rulesPassed = improvementFraction >= minLift ||
      (bestCandidate.exitRateRevenue > baselineCandidate.exitRateRevenue &&
        saleProbReduction <= cfg.maxSaleProbReductionForPremium);
    if (rulesPassed) {
      reasonCodes.push(`Premium increase selected: expected revenue improves while sale probability remains acceptable`);
    }
  } else {
    // Neutral: only apply if meaningful improvement
    rulesPassed = Math.abs(improvementFraction) >= minLift;
  }

  if (rulesPassed && bestCandidate.priceChangeFraction !== 0) {
    selectedRateMonthly = bestCandidate.candidateRateMonthly;
  } else {
    selectedRateMonthly = existing;
    noImprovementFound = true;
    reasonCodes.push('Existing AI Rate preserved: target-aware adjustment did not improve expected revenue');
  }

  // Step 7: Apply guardrails to the target-aware rate
  const guardrailResult = applyGuardrails(selectedRateMonthly, existing, ctx);
  const finalGuardrailedRateMonthly = guardrailResult.rate;

  const compGapPct = ctx.competitorAverageRateMonthly !== undefined
    ? ((existing - ctx.competitorAverageRateMonthly) / Math.max(ctx.competitorAverageRateMonthly, 1)) * 100
    : undefined;

  if (ctx.urgencyScore > 0.5) {
    reasonCodes.push(`Campus is ${Math.abs(ctx.growthGapPct ?? 0).toFixed(1)} percentage points behind revenue growth target with ${ctx.monthsRemaining.toFixed(0)} months remaining`);
    reasonCodes.push(`Urgency score is ${(ctx.urgencyScore * 100).toFixed(0)}% due to revenue gap and limited time remaining`);
  }
  if (ctx.daysVacant > ctx.velocity.avgDaysVacantForUnitType + 20) {
    reasonCodes.push(`Unit has been vacant ${ctx.daysVacant} days versus unit-type average of ${ctx.velocity.avgDaysVacantForUnitType.toFixed(0)} days`);
  }

  const bestEval = noImprovementFound ? baselineCandidate : bestCandidate;

  return {
    existingAiRateMonthly: existing,
    targetAwareRateMonthly: selectedRateMonthly,
    finalGuardrailedRateMonthly,
    segment: segResult.segment,
    segmentConfidence: segResult.confidence,
    segmentReason: segResult.reason,
    urgencyScore: ctx.urgencyScore,
    baseSaleWeeklyProb: ctx.velocity.baseSaleWeeklyProb,
    expectedSaleProbExistingAi: baselineCandidate.expectedSaleProbByYearEnd,
    expectedSaleProbTargetAware: bestEval.expectedSaleProbByYearEnd,
    expectedRevenueExistingAi: baselineCandidate.expectedRevenueByYearEnd,
    expectedRevenueTargetAware: bestEval.expectedRevenueByYearEnd,
    incrementalExpectedRevenue: bestEval.expectedRevenueByYearEnd - baselineCandidate.expectedRevenueByYearEnd,
    competitorAverageRate: ctx.competitorAverageRateMonthly,
    competitorGapPct: compGapPct,
    avgDaysVacantForUnitType: ctx.velocity.avgDaysVacantForUnitType,
    guardrailApplied: guardrailResult.applied,
    guardrailReason: guardrailResult.reason,
    reasonCodes: [...reasonCodes, ...(bestEval.reasonCodes || [])],
    noImprovementFound,
  };
}

function buildPassthroughResult(ctx: UnitStrategyContext, reason: string): StrategyLayerResult {
  return {
    existingAiRateMonthly: ctx.existingAiRateMonthly,
    targetAwareRateMonthly: ctx.existingAiRateMonthly,
    finalGuardrailedRateMonthly: ctx.existingAiRateMonthly,
    segment: 'neutral',
    segmentConfidence: 0,
    segmentReason: reason,
    urgencyScore: ctx.urgencyScore,
    baseSaleWeeklyProb: ctx.velocity.baseSaleWeeklyProb,
    expectedSaleProbExistingAi: 0,
    expectedSaleProbTargetAware: 0,
    expectedRevenueExistingAi: 0,
    expectedRevenueTargetAware: 0,
    incrementalExpectedRevenue: 0,
    competitorAverageRate: ctx.competitorAverageRateMonthly,
    competitorGapPct: undefined,
    avgDaysVacantForUnitType: ctx.velocity.avgDaysVacantForUnitType,
    guardrailApplied: false,
    guardrailReason: '',
    reasonCodes: [reason],
    noImprovementFound: true,
  };
}

// ─── Step 8: Portfolio Projection ─────────────────────────────────────────────

export interface UnitProjectionInput {
  isVacant: boolean;
  hasTarget: boolean;
  existingAiRateMonthly: number;
  targetAwareRateMonthly: number;
  expectedRevenueExistingAi: number;
  expectedRevenueTargetAware: number;
  segment: UnitStrategySegment | 'occupied' | 'no_target';
  revenueGapDollarsContribution: number;
}

/**
 * Aggregate per-unit results into a portfolio-level projection.
 */
export function calculatePortfolioProjection(
  unitProjections: UnitProjectionInput[]
): PortfolioProjection {
  let projectedRevenueExistingAi = 0;
  let projectedRevenueTargetAware = 0;
  let totalRevenueGapDollars = 0;
  let volumeDriverCount = 0;
  let premiumDriverCount = 0;
  let neutralCount = 0;
  let occupiedSkippedCount = 0;
  let noTargetCount = 0;

  for (const u of unitProjections) {
    if (!u.isVacant) { occupiedSkippedCount++; continue; }
    if (!u.hasTarget) { noTargetCount++; continue; }

    projectedRevenueExistingAi += u.expectedRevenueExistingAi;
    projectedRevenueTargetAware += u.expectedRevenueTargetAware;
    totalRevenueGapDollars += Math.max(0, u.revenueGapDollarsContribution);

    if (u.segment === 'volume_driver') volumeDriverCount++;
    else if (u.segment === 'premium_driver') premiumDriverCount++;
    else neutralCount++;
  }

  const incrementalRevenue = projectedRevenueTargetAware - projectedRevenueExistingAi;
  const gapClosureDollars = Math.max(0, incrementalRevenue);
  const gapClosurePct = totalRevenueGapDollars > 0
    ? clamp(gapClosureDollars / totalRevenueGapDollars, 0, 1)
    : 0;
  const remainingGapAfterStrategy = Math.max(0, totalRevenueGapDollars - gapClosureDollars);
  const totalVacant = volumeDriverCount + premiumDriverCount + neutralCount;

  let summaryMessage: string;
  if (totalVacant === 0) {
    summaryMessage = 'No vacant units with revenue targets to analyse.';
  } else if (gapClosurePct >= 0.05) {
    summaryMessage =
      `Target-aware AI pricing is projected to close ${(gapClosurePct * 100).toFixed(0)}% of the remaining revenue gap. ` +
      `Strategy includes ${volumeDriverCount} Volume Driver${volumeDriverCount !== 1 ? 's' : ''}, ` +
      `${premiumDriverCount} Premium Driver${premiumDriverCount !== 1 ? 's' : ''}, ` +
      `and ${neutralCount} Neutral unit${neutralCount !== 1 ? 's' : ''}.`;
  } else {
    summaryMessage =
      `Pricing alone is unlikely to close the remaining revenue gap. ` +
      `Additional actions may be needed, including sales incentives, referral conversion focus, ` +
      `marketing, care rate review, or manual leadership override.`;
  }

  return {
    projectedRevenueExistingAi,
    projectedRevenueTargetAware,
    incrementalRevenue,
    revenueGapDollars: totalRevenueGapDollars,
    gapClosureDollars,
    gapClosurePct,
    remainingGapAfterStrategy,
    volumeDriverCount,
    premiumDriverCount,
    neutralCount,
    occupiedSkippedCount,
    noTargetCount,
    summaryMessage,
  };
}
