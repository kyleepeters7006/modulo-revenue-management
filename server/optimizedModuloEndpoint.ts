// Optimized Modulo pricing endpoint implementation
// Handles 17,216+ units efficiently with batch processing and parallelization

import { storage } from "./storage";
import { fetchSP500Data } from "./routes";
import { calculateAttributedPrice, ensureCacheInitialized } from "./pricingOrchestrator";
import { getSentenceExplanation, generateOverallExplanation } from "./sentenceExplanations";
import type { PricingInputs } from "./moduloPricingAlgorithm";
import { fetchAndApplyAdjustmentRules } from "./services/adjustmentRulesService";
import { calculateAdjustedCompetitorRate } from "./services/competitorAdjustments";

interface DemandData {
  currentDemand: number;
  demandHistory: number[];
}

interface CompetitorData {
  competitor: any | undefined;
  trilogyCareLevel2Rate: number | null;
}

interface PrecomputedSignals {
  stockMarketChange: number;
  serviceLineOccupancy: Map<string, number>;
  locationOccupancy: Map<string, number>;
  serviceLineMedians: Map<string, number>;
  monthIndex: number;
  demandCache: Map<string, DemandData>;
  defaultDemandHistory: number[];
  defaultDemandCurrent: number;
  competitorCache: Map<string, CompetitorData>;
}

interface ProcessingProgress {
  total: number;
  processed: number;
  percentage: number;
}

// Process units in parallel with concurrency limit
interface UnitRawResult {
  id: string;
  streetRate: number;
  locationId: string;
  serviceLine: string;
  roomType: string;
  rawTotalAdjustment: number;
  weightsDisabled: boolean;
  calculationDetailsTemplate: any;
  pricingInputs: PricingInputs | null;
  unitWeights: any;
}

async function processUnitBatch(
  units: any[],
  precomputedSignals: PrecomputedSignals,
  weightsCache: Map<string, any>,
  locationWeightsCache: Map<string, any>,
  globalWeights: any,
  guardrailsData: any,
  targetMonth: string
): Promise<UnitRawResult[]> {
  const results = await Promise.allSettled(
    units.map(async (unit) => {
      try {
        const baseRate = unit.streetRate;
        
        const unitWeights = getWeightsForUnit(
          unit, 
          weightsCache, 
          locationWeightsCache, 
          globalWeights
        );
        
        if (!unitWeights || unitWeights.enableWeights === false) {
          return {
            id: unit.id,
            streetRate: baseRate,
            locationId: unit.locationId || unit.location || '',
            serviceLine: unit.serviceLine || '',
            roomType: unit.roomType || '',
            rawTotalAdjustment: 0,
            weightsDisabled: true,
            calculationDetailsTemplate: {
              baseRate,
              adjustments: [],
              weights: {},
              totalAdjustment: 0,
              finalRate: baseRate,
              appliedRules: [],
              guardrailsApplied: [],
              weightsDisabled: true
            },
            pricingInputs: null,
            unitWeights
          };
        }
        
        const occupancy = precomputedSignals.locationOccupancy.get(
          `${unit.locationId}|${unit.serviceLine}`
        ) || precomputedSignals.serviceLineOccupancy.get(unit.serviceLine) || 0.87;
        
        const serviceLineMedian = precomputedSignals.serviceLineMedians.get(unit.serviceLine);
        
        let competitorPrices: number[];
        const competitorKey = `${unit.campus}|${unit.serviceLine}`;
        const cachedCompetitorData = precomputedSignals.competitorCache.get(competitorKey);
        
        if (cachedCompetitorData?.competitor && cachedCompetitorData.competitor.streetRate) {
          const adjustmentResult = calculateAdjustedCompetitorRate({
            competitorBaseRate: cachedCompetitorData.competitor.streetRate,
            competitorCareLevel2Rate: cachedCompetitorData.competitor.careLevel2Rate || 0,
            competitorMedicationManagementFee: cachedCompetitorData.competitor.medicationManagementFee || 0,
            trilogyCareLevel2Rate: cachedCompetitorData.trilogyCareLevel2Rate || 0
          });
          competitorPrices = [adjustmentResult.adjustedRate];
        } else if (serviceLineMedian && serviceLineMedian > 0) {
          competitorPrices = [serviceLineMedian];
        } else if (unit.competitorRate && unit.competitorRate > 0) {
          competitorPrices = [unit.competitorRate];
        } else {
          competitorPrices = [baseRate * 0.95, baseRate * 1.05];
        }
        
        const demandKey = `${unit.location}|${unit.serviceLine || ''}`;
        const cachedDemand = precomputedSignals.demandCache.get(demandKey);
        const demandCurrent = cachedDemand?.currentDemand || precomputedSignals.defaultDemandCurrent;
        const demandHistory = cachedDemand?.demandHistory.length > 0 
          ? cachedDemand.demandHistory 
          : precomputedSignals.defaultDemandHistory;
        
        const pricingInputs: PricingInputs = {
          occupancy,
          daysVacant: unit.daysVacant || 0,
          attrScore: 0.5,
          monthIndex: precomputedSignals.monthIndex,
          competitorPrices,
          marketReturn: precomputedSignals.stockMarketChange / 100,
          demandCurrent,
          demandHistory,
          serviceLine: unit.serviceLine
        };
        
        // Calculate without guardrails first to get the raw totalAdjustment
        const orchestratorResult = await calculateAttributedPrice(
          unit, 
          unitWeights, 
          pricingInputs,
          undefined
        );
        
        const rawTotalAdjustment = orchestratorResult.moduloDetails.totalAdjustment;
        
        const calculationDetailsTemplate = {
          baseRate: orchestratorResult.baseRate,
          baseRateSource: orchestratorResult.baseRateSource,
          attributedRate: orchestratorResult.attributedRate,
          attributeBreakdown: orchestratorResult.attributeBreakdown,
          adjustments: orchestratorResult.moduloDetails.adjustments?.map((adj: any) => ({
            ...adj,
            formula: adj.calculation,
            description: getSentenceExplanation(adj.factor.toLowerCase(), pricingInputs, adj)
          })) || [],
          weights: {
            occupancyPressure: unitWeights.occupancyPressure,
            daysVacantDecay: unitWeights.daysVacantDecay,
            seasonality: unitWeights.seasonality,
            competitorRates: unitWeights.competitorRates,
            stockMarket: unitWeights.stockMarket,
            inquiryTourVolume: unitWeights.inquiryTourVolume
          },
          signals: orchestratorResult.moduloDetails.signals,
          blendedSignal: orchestratorResult.moduloDetails.blendedSignal,
          explanation: generateOverallExplanation(orchestratorResult.moduloDetails, pricingInputs),
          appliedRules: []
        };
        
        return {
          id: unit.id,
          streetRate: baseRate,
          locationId: unit.locationId || unit.location || '',
          serviceLine: unit.serviceLine || '',
          roomType: unit.roomType || '',
          rawTotalAdjustment,
          weightsDisabled: false,
          calculationDetailsTemplate,
          pricingInputs,
          unitWeights
        };
      } catch (error) {
        console.error(`Error processing unit ${unit.id}:`, error);
        return {
          id: unit.id,
          streetRate: unit.streetRate,
          locationId: unit.locationId || unit.location || '',
          serviceLine: unit.serviceLine || '',
          roomType: unit.roomType || '',
          rawTotalAdjustment: 0,
          weightsDisabled: true,
          calculationDetailsTemplate: {
            baseRate: unit.streetRate,
            error: String(error),
            finalRate: unit.streetRate
          },
          pricingInputs: null,
          unitWeights: null
        };
      }
    })
  );
  
  const updates: UnitRawResult[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      updates.push(result.value);
    } else {
      console.error('Unit processing failed:', result.reason);
    }
  }
  
  return updates;
}

// Note: guardrail logic mirrors pricingOrchestrator.ts calculateAttributedPrice.
// If guardrail parameters change in the orchestrator, update this function accordingly.
function applyGuardrails(
  rate: number,
  baseRate: number,
  guardrailsData: any
): { finalRate: number; minAllowed: number; maxAllowed: number; wasAdjusted: boolean } {
  let finalRate = rate;
  let wasAdjusted = false;
  let minAllowed = 0;
  let maxAllowed = Infinity;

  if (guardrailsData) {
    const minRateDecrease = guardrailsData.minRateDecrease || 0.05;
    const maxRateIncrease = guardrailsData.maxRateIncrease || 0.15;
    minAllowed = baseRate * (1 - minRateDecrease);
    maxAllowed = baseRate * (1 + maxRateIncrease);

    if (finalRate < minAllowed) {
      finalRate = minAllowed;
      wasAdjusted = true;
    } else if (finalRate > maxAllowed) {
      finalRate = maxAllowed;
      wasAdjusted = true;
    }

    if (finalRate < 0) {
      finalRate = minAllowed;
      wasAdjusted = true;
    }
  }

  return { finalRate, minAllowed, maxAllowed, wasAdjusted };
}

// Helper function to get weights for a unit with 3-tier fallback
function getWeightsForUnit(
  unit: any,
  weightsCache: Map<string, any>,
  locationWeightsCache: Map<string, any>,
  globalWeights: any
) {
  if (!unit.locationId) return globalWeights;
  
  // Try location+serviceLine specific first
  if (unit.serviceLine) {
    const specificKey = `${unit.locationId}|${unit.serviceLine}`;
    const specificWeights = weightsCache.get(specificKey);
    if (specificWeights) return specificWeights;
  }
  
  // Fallback to location-level weights
  const locationWeights = locationWeightsCache.get(unit.locationId);
  if (locationWeights) return locationWeights;
  
  // Final fallback to global
  return globalWeights;
}

// Optimized Modulo pricing endpoint handler
export async function generateModuloOptimized(req: any, res: any) {
  try {
    const startTime = Date.now();
    const { month, serviceLine, regions, divisions, locations } = req.body;
    const targetMonth = month || '2025-11';
    
    await ensureCacheInitialized(targetMonth);
    
    console.log('=== Starting OPTIMIZED Modulo Generation ===');
    console.log('Target month:', targetMonth);
    console.log('Filters:', { serviceLine, regions, divisions, locations });
    
    // Step 1: Get all necessary data upfront
    const defaultWeights = {
      occupancyPressure: 25,
      daysVacantDecay: 20,
      seasonality: 10,
      competitorRates: 10,
      stockMarket: 10,
      inquiryTourVolume: 10,
      enableWeights: true
    };
    
    const [globalWeights, guardrailsData, stockMarketChange] = await Promise.all([
      storage.getCurrentWeights().then(w => w || defaultWeights),
      storage.getCurrentGuardrails(),
      fetchSP500Data()
    ]);
    
    // Step 2: Fetch and filter units early
    let allUnits = await storage.getRentRollDataByMonth(targetMonth);
    console.log(`Total units in month: ${allUnits.length}`);
    
    // Apply filters EARLY to reduce processing
    let units = allUnits;
    if (serviceLine) {
      units = units.filter(u => u.serviceLine === serviceLine);
      console.log(`After service line filter: ${units.length} units`);
    }
    if (locations && locations.length > 0) {
      const locationSet = new Set(locations);
      units = units.filter(u => u.location && locationSet.has(u.location));
      console.log(`After location filter: ${units.length} units`);
    }
    
    if (units.length === 0) {
      console.log('No units to process after filtering');
      return res.json({ success: true, unitsProcessed: 0 });
    }
    
    // Step 3: Precompute all shared signals
    console.log('Precomputing shared signals...');
    
    // Filter B beds for occupancy calculations
    // IMPORTANT: For senior housing (AL, SL, VIL, IL, AL/MC), exclude B-beds from occupancy calculation
    const seniorHousingServiceLines = new Set(['AL', 'AL/MC', 'SL', 'VIL', 'IL']);
    const unitsForOccupancy = units.filter(unit => {
      if (seniorHousingServiceLines.has(unit.serviceLine || '')) {
        const roomNumber = unit.roomNumber || '';
        if (roomNumber.endsWith('/B') || roomNumber.endsWith('B')) {
          return false;
        }
      }
      return true;
    });
    
    // Precompute occupancy by location+serviceLine and by serviceLine
    const locationOccupancy = new Map<string, number>();
    const serviceLineOccupancy = new Map<string, number>();
    const occupancyStats = new Map<string, { occupied: number; total: number }>();
    
    for (const unit of unitsForOccupancy) {
      const locServiceKey = `${unit.locationId}|${unit.serviceLine}`;
      const serviceKey = unit.serviceLine || 'Unknown';
      
      // Location + Service Line stats
      if (!occupancyStats.has(locServiceKey)) {
        occupancyStats.set(locServiceKey, { occupied: 0, total: 0 });
      }
      const locStats = occupancyStats.get(locServiceKey)!;
      locStats.total++;
      if (unit.occupiedYN) locStats.occupied++;
      
      // Service Line only stats
      if (!occupancyStats.has(serviceKey)) {
        occupancyStats.set(serviceKey, { occupied: 0, total: 0 });
      }
      const slStats = occupancyStats.get(serviceKey)!;
      slStats.total++;
      if (unit.occupiedYN) slStats.occupied++;
    }
    
    // Calculate occupancy percentages
    for (const [key, stats] of Array.from(occupancyStats)) {
      const occ = stats.total > 0 ? stats.occupied / stats.total : 0;
      if (key.includes('|')) {
        locationOccupancy.set(key, occ);
      } else {
        serviceLineOccupancy.set(key, occ);
        // Log service line occupancies to verify B-bed exclusion
        console.log(`Service Line ${key}: ${stats.occupied}/${stats.total} units = ${(occ * 100).toFixed(1)}% occupancy (B-beds excluded for senior housing)`);
      }
    }
    
    // Precompute service line medians
    const serviceLineMedians = new Map<string, number>();
    const serviceLineRates = new Map<string, number[]>();
    
    for (const unit of units) {
      const sl = unit.serviceLine || 'Unknown';
      if (!serviceLineRates.has(sl)) {
        serviceLineRates.set(sl, []);
      }
      if (unit.streetRate && unit.streetRate > 0) {
        serviceLineRates.get(sl)!.push(unit.streetRate);
      }
    }
    
    for (const [sl, rates] of Array.from(serviceLineRates)) {
      if (rates.length > 0) {
        const sorted = [...rates].sort((a, b) => a - b);
        serviceLineMedians.set(sl, sorted[Math.floor(sorted.length / 2)]);
      }
    }
    
    // Precompute weights cache
    const uniqueCombinations = new Set<string>();
    const uniqueLocations = new Set<string>();
    
    units.forEach(unit => {
      if (unit.locationId) {
        uniqueLocations.add(unit.locationId);
        if (unit.serviceLine) {
          uniqueCombinations.add(`${unit.locationId}|${unit.serviceLine}`);
        }
      }
    });
    
    const weightsCache = new Map<string, any>();
    const locationWeightsCache = new Map<string, any>();
    
    // Fetch all weights in parallel
    const locationWeightPromises = Array.from(uniqueLocations).map(async (locationId) => {
      const weights = await storage.getWeightsByFilter(locationId, null);
      if (weights) {
        locationWeightsCache.set(locationId, weights);
      }
    });
    
    const comboWeightPromises = Array.from(uniqueCombinations).map(async (combo) => {
      const [locationId, serviceLine] = combo.split('|');
      if (locationId && serviceLine) {
        const weights = await storage.getWeightsByFilter(locationId, serviceLine);
        if (weights) {
          weightsCache.set(combo, weights);
        }
      }
    });
    
    await Promise.all([...locationWeightPromises, ...comboWeightPromises]);
    
    console.log(`Precomputed: ${locationOccupancy.size} location occupancies, ${serviceLineOccupancy.size} service line occupancies`);
    console.log(`Weights cache: ${weightsCache.size} specific, ${locationWeightsCache.size} location-level`);
    
    // Precompute demand data for all unique location+serviceLine combinations
    const demandCache = new Map<string, DemandData>();
    const uniqueLocationServiceLines = new Set<string>();
    
    units.forEach(unit => {
      const key = `${unit.location}|${unit.serviceLine || ''}`;
      uniqueLocationServiceLines.add(key);
    });
    
    // Fetch demand data for all unique combinations in parallel
    const demandPromises = Array.from(uniqueLocationServiceLines).map(async (key) => {
      const [location, serviceLine] = key.split('|');
      try {
        const demandData = await storage.getDemandDataByLocationServiceLine(
          location,
          serviceLine,
          targetMonth
        );
        if (demandData.demandHistory.length > 0 || demandData.currentDemand > 0) {
          demandCache.set(key, demandData);
        }
      } catch (error) {
        // Silently fail - will use defaults
      }
    });
    
    await Promise.all(demandPromises);
    console.log(`Demand data cache: ${demandCache.size} location+service combinations with real data`);
    
    // Precompute competitor data for all unique campus+serviceLine combinations (fixes N+1 query issue)
    const competitorCache = new Map<string, CompetitorData>();
    const uniqueCampusServiceLines = new Set<string>();
    
    units.forEach(unit => {
      if (unit.campus && unit.serviceLine) {
        const key = `${unit.campus}|${unit.serviceLine}`;
        uniqueCampusServiceLines.add(key);
      }
    });
    
    // Fetch competitor data for all unique combinations in parallel
    const competitorPromises = Array.from(uniqueCampusServiceLines).map(async (key) => {
      const [campus, serviceLine] = key.split('|');
      try {
        const [topCompetitor, trilogyCareLevel2Rate] = await Promise.all([
          storage.getTopCompetitorByWeight(campus, serviceLine),
          storage.getTrilogyCareLevel2Rate(campus, serviceLine)
        ]);
        competitorCache.set(key, {
          competitor: topCompetitor,
          trilogyCareLevel2Rate: trilogyCareLevel2Rate
        });
      } catch (error) {
        // Cache empty data on error
        competitorCache.set(key, {
          competitor: undefined,
          trilogyCareLevel2Rate: null
        });
      }
    });
    
    await Promise.all(competitorPromises);
    console.log(`Competitor data cache: ${competitorCache.size} campus+service combinations pre-fetched`);
    
    // Build precomputed signals object
    const precomputedSignals: PrecomputedSignals = {
      stockMarketChange,
      serviceLineOccupancy,
      locationOccupancy,
      serviceLineMedians,
      monthIndex: new Date(targetMonth).getMonth() + 1,
      demandCache,
      defaultDemandHistory: [10, 12, 15, 13, 14, 11],
      defaultDemandCurrent: 12,
      competitorCache
    };
    
    // Step 4: Process units in batches with parallelization
    const BATCH_SIZE = 500;
    const MAX_CONCURRENT_BATCHES = 8;
    const totalBatches = Math.ceil(units.length / BATCH_SIZE);
    
    console.log(`Processing ${units.length} units in ${totalBatches} batches of up to ${BATCH_SIZE} units`);
    
    const allRawResults: UnitRawResult[] = [];
    const progress: ProcessingProgress = {
      total: units.length,
      processed: 0,
      percentage: 0
    };
    
    // Process batches with controlled concurrency
    for (let i = 0; i < units.length; i += BATCH_SIZE * MAX_CONCURRENT_BATCHES) {
      const batchPromises = [];
      
      for (let j = 0; j < MAX_CONCURRENT_BATCHES && (i + j * BATCH_SIZE) < units.length; j++) {
        const start = i + j * BATCH_SIZE;
        const end = Math.min(start + BATCH_SIZE, units.length);
        const batch = units.slice(start, end);
        
        if (batch.length > 0) {
          batchPromises.push(
            processUnitBatch(
              batch,
              precomputedSignals,
              weightsCache,
              locationWeightsCache,
              globalWeights,
              guardrailsData,
              targetMonth
            )
          );
        }
      }
      
      const batchResults = await Promise.all(batchPromises);
      for (const rawResults of batchResults) {
        allRawResults.push(...rawResults);
      }
      
      progress.processed = Math.min(i + BATCH_SIZE * MAX_CONCURRENT_BATCHES, units.length);
      progress.percentage = Math.round((progress.processed / progress.total) * 100);
      
      console.log(`Calculation progress: ${progress.processed}/${progress.total} units (${progress.percentage}%)`);
    }
    
    // Step 4b: Average rawTotalAdjustment by Location + Service Line + Room Type segment
    // Units sharing the same segment get the same % adjustment applied to their street rate
    console.log('Computing group-average adjustments by Room Type segment...');
    
    const groupSums = new Map<string, { sum: number; count: number }>();
    for (const raw of allRawResults) {
      if (raw.weightsDisabled) continue;
      const key = `${raw.locationId}|${raw.serviceLine}|${raw.roomType}`;
      const existing = groupSums.get(key);
      if (existing) {
        existing.sum += raw.rawTotalAdjustment;
        existing.count += 1;
      } else {
        groupSums.set(key, { sum: raw.rawTotalAdjustment, count: 1 });
      }
    }
    
    const groupAverages = new Map<string, number>();
    for (const [key, { sum, count }] of Array.from(groupSums)) {
      groupAverages.set(key, count > 0 ? sum / count : 0);
    }
    
    console.log(`Computed ${groupAverages.size} room type group adjustments`);
    
    // Step 4c: Build final updates by applying the group-averaged % to each unit's street rate,
    // then applying guardrails per-unit
    const allUpdates: any[] = [];
    
    for (const raw of allRawResults) {
      if (raw.weightsDisabled) {
        allUpdates.push({
          id: raw.id,
          moduloSuggestedRate: Math.round(raw.streetRate),
          moduloCalculationDetails: JSON.stringify({
            ...raw.calculationDetailsTemplate,
            totalAdjustment: 0,
            groupAdjustment: 0,
            finalRate: raw.streetRate,
            moduloRate: raw.streetRate,
            guardrailsApplied: { minAllowed: 0, maxAllowed: Infinity, wasAdjusted: false }
          })
        });
        continue;
      }
      
      const segmentKey = `${raw.locationId}|${raw.serviceLine}|${raw.roomType}`;
      const groupAdj = groupAverages.get(segmentKey) ?? raw.rawTotalAdjustment;
      
      const preGuardrailRate = raw.streetRate * (1 + groupAdj);
      const guardrailResult = applyGuardrails(preGuardrailRate, raw.streetRate, guardrailsData);
      const finalRate = Math.round(guardrailResult.finalRate);
      
      const calculationDetails = {
        ...raw.calculationDetailsTemplate,
        totalAdjustment: groupAdj,
        groupAdjustment: groupAdj,
        groupSegmentKey: segmentKey,
        finalRate,
        moduloRate: Math.round(preGuardrailRate),
        guardrailsApplied: {
          minAllowed: Math.round(guardrailResult.minAllowed),
          maxAllowed: Math.round(guardrailResult.maxAllowed),
          wasAdjusted: guardrailResult.wasAdjusted
        }
      };
      
      allUpdates.push({
        id: raw.id,
        moduloSuggestedRate: finalRate,
        moduloCalculationDetails: JSON.stringify(calculationDetails)
      });
    }
    
    console.log(`Applied group adjustments and guardrails to ${allUpdates.length} units, applying adjustment rules...`);
    
    // Step 5: Apply adjustment rules to Modulo rates
    const unitsWithModuloRates = allUpdates.map((update, index) => ({
      id: update.id,
      unit: units[index], // Get the corresponding unit data
      moduloSuggestedRate: update.moduloSuggestedRate
    }));
    
    const adjustmentResults = await fetchAndApplyAdjustmentRules(unitsWithModuloRates);
    
    // Merge adjustment results with Modulo updates
    const finalUpdates = allUpdates.map((update, index) => {
      const adjustment = adjustmentResults[index];
      return {
        ...update,
        ruleAdjustedRate: adjustment.ruleAdjustedRate,
        appliedRuleName: adjustment.appliedRuleName
      };
    });
    
    // Count how many units had rules applied
    const rulesAppliedCount = adjustmentResults.filter(r => r.ruleAdjustedRate !== null).length;
    if (rulesAppliedCount > 0) {
      console.log(`Applied adjustment rules to ${rulesAppliedCount} units`);
    }
    
    // Step 6: Perform optimized bulk database update with adjustment rules
    console.log(`Starting bulk database update with Modulo rates and adjustment rules...`);
    await storage.bulkUpdateModuloRates(finalUpdates);
    
    console.log('Regenerating rate card...');
    await storage.generateRateCard(targetMonth);
    
    // Record AI rate outcomes for ML learning
    try {
      const { recordAiRateOutcomes } = await import('./services/mlTrainingService');
      
      // Prepare outcome data with weights snapshot
      const outcomeUnits = allUpdates.map((update, index) => {
        const unit = units[index];
        // Parse calculation details to extract weights
        let weightsSnapshot = null;
        if (update.moduloCalculationDetails) {
          try {
            const details = JSON.parse(update.moduloCalculationDetails);
            weightsSnapshot = details.weightsUsed || {
              occupancyPressure: 44,
              daysVacantDecay: 10,
              seasonality: 10,
              competitorRates: 12,
              stockMarket: 10,
              inquiryTourVolume: 14
            };
          } catch (e) {
            // Use defaults if parsing fails
            weightsSnapshot = {
              occupancyPressure: 44,
              daysVacantDecay: 10,
              seasonality: 10,
              competitorRates: 12,
              stockMarket: 10,
              inquiryTourVolume: 14
            };
          }
        }
        
        return {
          id: update.id,
          location: unit.location,
          locationId: unit.locationId,
          serviceLine: unit.serviceLine || '',
          roomNumber: unit.roomNumber,
          roomType: unit.roomType,
          uploadMonth: targetMonth,
          aiSuggestedRate: update.moduloSuggestedRate,
          streetRate: unit.streetRate,
          weightsSnapshot
        };
      });
      
      const recorded = await recordAiRateOutcomes(null, outcomeUnits);
      console.log(`Recorded ${recorded} AI rate outcomes for ML learning`);
    } catch (mlError) {
      // Don't fail the calculation if ML recording fails
      console.error('ML outcome recording error (non-fatal):', mlError);
    }
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    console.log(`=== Modulo Generation Complete ===`);
    console.log(`Processed ${allUpdates.length} units in ${duration.toFixed(2)} seconds`);
    console.log(`Average: ${(duration / allUpdates.length * 1000).toFixed(2)}ms per unit`);
    
    res.json({ 
      success: true, 
      unitsProcessed: allUpdates.length,
      duration: duration.toFixed(2),
      progress: 100
    });
  } catch (error) {
    console.error('Modulo generation error:', error);
    res.status(500).json({ error: 'Failed to generate Modulo suggestions' });
  }
}