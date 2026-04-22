import { attributePricingService } from "./attributePricingService";
import { calculateModuloPrice, type PricingInputs, type PricingWeights as ModuloPricingWeights } from "./moduloPricingAlgorithm";
import type { RentRollData, Guardrails, PricingWeights } from "@shared/schema";

interface CalculationDetails {
  finalPrice: number;
  attributedRate: number;
  moduloRate: number;
  baseRate: number;
  baseRateSource: string;
  attributeBreakdown: {
    location: { rating: string | null; adjustmentPercent: number };
    size: { rating: string | null; adjustmentPercent: number };
    view: { rating: string | null; adjustmentPercent: number };
    renovation: { rating: string | null; adjustmentPercent: number };
    amenity: { rating: string | null; adjustmentPercent: number };
    totalMultiplier: number;
  };
  moduloDetails: {
    signals: Record<string, number>;
    weights: Record<string, number>;
    blendedSignal: number;
    totalAdjustment: number;
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
  };
  guardrailsApplied: {
    minAllowed: number;
    maxAllowed: number;
    wasAdjusted: boolean;
  };
}

export async function calculateAttributedPrice(
  unit: RentRollData,
  weights: PricingWeights,
  inputs: PricingInputs,
  guardrails?: Guardrails
): Promise<CalculationDetails> {
  // Base rate is the unit's own current street rate
  const baseRate = unit.streetRate || 0;
  const baseRateSource = 'street_rate';

  // Still compute attribute breakdown to derive the attrScore signal
  const attributeData = attributePricingService.getAttributeBreakdown(unit);
  const attributeMultiplier = attributeData.totalMultiplier;

  // Calculate normalized attribute score (0-1) from the totalMultiplier
  // A multiplier of 1.0 (neutral) maps to 0.5, with range from 0.7-1.3 mapping to 0-1
  // This ensures units with no attributes (multiplier = 1.0) get a neutral score
  const normalizeAttrScore = (multiplier: number): number => {
    const minMultiplier = 0.7;
    const maxMultiplier = 1.3;
    const clampedMultiplier = Math.max(minMultiplier, Math.min(maxMultiplier, multiplier));
    return (clampedMultiplier - minMultiplier) / (maxMultiplier - minMultiplier);
  };

  const attrScore = normalizeAttrScore(attributeMultiplier);
  const moduloInputs: PricingInputs = {
    ...inputs,
    attrScore
  };

  const moduloWeights: ModuloPricingWeights = {
    occupancy: weights.occupancyPressure,
    daysVacant: weights.daysVacantDecay,
    seasonality: weights.seasonality,
    competitors: weights.competitorRates,
    market: weights.stockMarket,
    demand: weights.inquiryTourVolume || 0
  };

  // Run the Modulo algorithm starting from the street rate
  const moduloResult = calculateModuloPrice(baseRate, moduloWeights, moduloInputs);
  const moduloRate = moduloResult.finalPrice;

  let finalPrice = moduloRate;
  let wasAdjusted = false;
  let minAllowed = 0;
  let maxAllowed = Infinity;

  if (guardrails) {
    const minRateDecrease = guardrails.minRateDecrease || 0.05;
    const maxRateIncrease = guardrails.maxRateIncrease || 0.15;

    // Guardrails applied relative to the street rate
    minAllowed = baseRate * (1 - minRateDecrease);
    maxAllowed = baseRate * (1 + maxRateIncrease);

    if (finalPrice < minAllowed) {
      finalPrice = minAllowed;
      wasAdjusted = true;
    } else if (finalPrice > maxAllowed) {
      finalPrice = maxAllowed;
      wasAdjusted = true;
    }

    if (finalPrice < 0) {
      finalPrice = minAllowed;
      wasAdjusted = true;
    }
  }

  return {
    finalPrice: Math.round(finalPrice),
    attributedRate: Math.round(baseRate),
    moduloRate: Math.round(moduloRate),
    baseRate: Math.round(baseRate),
    baseRateSource,
    attributeBreakdown: {
      location: {
        rating: unit.locationRating,
        adjustmentPercent: attributeData.multipliers.location
      },
      size: {
        rating: unit.sizeRating,
        adjustmentPercent: attributeData.multipliers.size
      },
      view: {
        rating: unit.viewRating,
        adjustmentPercent: attributeData.multipliers.view
      },
      renovation: {
        rating: unit.renovationRating,
        adjustmentPercent: attributeData.multipliers.renovation
      },
      amenity: {
        rating: unit.amenityRating,
        adjustmentPercent: attributeData.multipliers.amenity
      },
      totalMultiplier: attributeMultiplier
    },
    moduloDetails: {
      signals: moduloResult.signals,
      weights: moduloResult.weights,
      blendedSignal: moduloResult.blendedSignal,
      totalAdjustment: moduloResult.totalAdjustment,
      adjustments: moduloResult.adjustments
    },
    guardrailsApplied: {
      minAllowed: Math.round(minAllowed),
      maxAllowed: Math.round(maxAllowed),
      wasAdjusted
    }
  };
}

export async function invalidateCache(uploadMonth?: string): Promise<void> {
  await attributePricingService.refreshBaseRates(uploadMonth);
}

// Simple lock mechanism to prevent concurrent cache refreshes
let cacheInitializationPromise: Promise<void> | null = null;

export async function ensureCacheInitialized(uploadMonth?: string): Promise<void> {
  const cacheStatus = attributePricingService.getCacheStatus();
  const requestedMonth = uploadMonth || new Date().toISOString().slice(0, 7);

  const needsRefresh = cacheStatus.cached === 0 ||
                       !cacheStatus.timestamp ||
                       cacheStatus.month !== requestedMonth;

  if (needsRefresh) {
    if (cacheInitializationPromise) {
      console.log(`Cache refresh already in progress for month: ${requestedMonth}, waiting...`);
      await cacheInitializationPromise;

      const newCacheStatus = attributePricingService.getCacheStatus();
      if (newCacheStatus.month === requestedMonth && newCacheStatus.cached > 0) {
        console.log(`Cache already refreshed by another process for month: ${requestedMonth}`);
        return;
      }
    }

    console.log(`Initializing/refreshing attribute pricing cache for month: ${requestedMonth} (current cache: ${cacheStatus.month || 'none'})`);
    cacheInitializationPromise = attributePricingService.refreshBaseRates(requestedMonth)
      .finally(() => {
        cacheInitializationPromise = null;
      });

    await cacheInitializationPromise;
  }
}
