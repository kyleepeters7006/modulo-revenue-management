// Optimized Modulo pricing endpoint implementation
// Handles 17,216+ units efficiently with batch processing and parallelization

import { storage } from "./storage";
import { fetchSP500Data } from "./routes";
import { calculateAttributedPrice, ensureCacheInitialized } from "./pricingOrchestrator";
import { getSentenceExplanation, generateOverallExplanation } from "./sentenceExplanations";
import type { PricingInputs, CompetitorInfo } from "./moduloPricingAlgorithm";
import { fetchAndApplyAdjustmentRules } from "./services/adjustmentRulesService";
import { clampRateWithGuardrails } from "./guardrailsUtil";
import { matchAndAdjustCompetitor } from "./services/competitorLookup";
import { db } from './db';
import { roomTypeOccupancyHistory } from '@shared/schema';
import { eq, and, or, sql } from 'drizzle-orm';
import { normalizeRoomType } from '@shared/roomTypes';

interface DemandData {
  currentDemand: number;
  demandHistory: number[];
}

interface SurveyCompetitorRow {
  competitorName: string;
  roomType: string;
  monthlyRateAvg: number;
  careLevel2Rate: number | null;
  medicationManagementFee: number | null;
  weight: number;
  distanceMiles: number | null;
}

interface CompetitorData {
  surveyRows: SurveyCompetitorRow[];
  trilogyCareLevel2Rate: number | null;
  trilogyMedMgmtFee: number;
}

interface PrecomputedSignals {
  stockMarketChange: number;
  serviceLineOccupancy: Map<string, number>;
  locationOccupancy: Map<string, number>;
  locationRoomTypeOccupancy: Map<string, number>;
  t3mOccupancyMap: Map<string, number>;
  monthIndex: number;
  demandCache: Map<string, DemandData>;
  defaultDemandHistory: number[];
  defaultDemandCurrent: number;
  competitorCache: Map<string, CompetitorData>;
  groupAvgDaysVacant: Map<string, number>;
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
  targetMonth: string,
  locationNameToIdMap?: Map<string, string>
): Promise<UnitRawResult[]> {
  const results = await Promise.allSettled(
    units.map(async (unit) => {
      try {
        const baseRate = unit.streetRate;
        
        const unitWeights = getWeightsForUnit(
          unit, 
          weightsCache, 
          locationWeightsCache, 
          globalWeights,
          locationNameToIdMap
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
        
        const locServiceRoomOccKey = `${unit.location}|${unit.serviceLine}|${unit.roomType}`;
        const locServiceOccKey = `${unit.location}|${unit.serviceLine}`;

        // T3M room-type occupancy takes priority when history data is available
        // Keys are stored lowercase+trimmed (both location and service line), so normalize
        // the lookup key the same way to avoid silent misses from whitespace or casing.
        const normalizedRT = normalizeRoomType(unit.roomType || '').trim().toLowerCase();
        const t3mKey = `${(unit.location || '').trim().toLowerCase()}|${(unit.serviceLine || '').trim().toLowerCase()}|${normalizedRT}`;
        const t3mOcc = precomputedSignals.t3mOccupancyMap.get(t3mKey);

        const occupancySource: 't3m' | 'spot' = t3mOcc !== undefined ? 't3m' : 'spot';
        const occupancy = t3mOcc !== undefined
          ? t3mOcc
          : precomputedSignals.locationRoomTypeOccupancy.has(locServiceRoomOccKey)
            ? precomputedSignals.locationRoomTypeOccupancy.get(locServiceRoomOccKey)!
            : precomputedSignals.locationOccupancy.has(locServiceOccKey)
              ? precomputedSignals.locationOccupancy.get(locServiceOccKey)!
              : precomputedSignals.serviceLineOccupancy.has(unit.serviceLine)
                ? precomputedSignals.serviceLineOccupancy.get(unit.serviceLine)!
                : 0.87;
        
        let competitorPrices: number[] = [];
        let competitorInfo: CompetitorInfo | undefined;
        {
          const competitorKey = `${unit.location}|${unit.serviceLine}|${unit.roomType || ''}`;
          const cachedCompetitorData = precomputedSignals.competitorCache.get(competitorKey);
          const ourCareLevel2 = cachedCompetitorData?.trilogyCareLevel2Rate || 0;
          const ourMedMgmt = cachedCompetitorData?.trilogyMedMgmtFee ?? 0;
          ({ competitorPrices, competitorInfo } = matchAndAdjustCompetitor(
            cachedCompetitorData?.surveyRows || [], unit.roomType || '', ourCareLevel2, ourMedMgmt, unit.serviceLine || undefined
          ));
        }
        
        const demandKey = `${unit.location}|${unit.serviceLine || ''}`;
        const cachedDemand = precomputedSignals.demandCache.get(demandKey);
        const demandCurrent = cachedDemand?.currentDemand || precomputedSignals.defaultDemandCurrent;
        const demandHistory = cachedDemand?.demandHistory.length > 0 
          ? cachedDemand.demandHistory 
          : precomputedSignals.defaultDemandHistory;
        
        const pricingInputs: PricingInputs = {
          occupancy,
          occupancySource,
          daysVacant: precomputedSignals.groupAvgDaysVacant.get(
            `${unit.locationId ?? unit.location ?? 'unknown'}|${unit.serviceLine}|${unit.roomType}`
          ) ?? 0,
          monthIndex: precomputedSignals.monthIndex,
          competitorPrices,
          marketReturn: precomputedSignals.stockMarketChange / 100,
          demandCurrent,
          demandHistory,
          serviceLine: unit.serviceLine,
          competitorInfo
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
          preOverrideTotalAdj: orchestratorResult.moduloDetails.preOverrideTotalAdj,
          explanation: generateOverallExplanation(orchestratorResult.moduloDetails, pricingInputs),
          occupancySource,
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
    const result = clampRateWithGuardrails(rate, baseRate, guardrailsData);
    finalRate = result.finalRate;
    minAllowed = result.minAllowed;
    maxAllowed = result.maxAllowed;
    wasAdjusted = result.wasAdjusted;
  }

  return { finalRate, minAllowed, maxAllowed, wasAdjusted };
}

// Helper function to get weights for a unit with 3-tier fallback
function getWeightsForUnit(
  unit: any,
  weightsCache: Map<string, any>,
  locationWeightsCache: Map<string, any>,
  globalWeights: any,
  locationNameToIdMap?: Map<string, string>
) {
  let resolvedLocationId = unit.locationId;

  if (!resolvedLocationId) {
    // Attempt name-based lookup when locationId is null
    if (unit.location && locationNameToIdMap) {
      resolvedLocationId = locationNameToIdMap.get(unit.location.toLowerCase());
    }
    if (!resolvedLocationId) {
      console.warn(`[Weights] Unit ${unit.unitId || 'unknown'} (${unit.location || 'no location'}) has no locationId and no name match — using global weights`);
      return globalWeights;
    }
  }

  // Try location+serviceLine specific first
  if (unit.serviceLine) {
    const specificKey = `${resolvedLocationId}|${unit.serviceLine}`;
    const specificWeights = weightsCache.get(specificKey);
    if (specificWeights) return specificWeights;
  }

  // Fallback to location-level weights
  const locationWeights = locationWeightsCache.get(resolvedLocationId);
  if (locationWeights) return locationWeights;

  // Final fallback to global
  console.warn(`[Weights] No specific or location-level weights for locationId ${resolvedLocationId} — using global weights`);
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
    
    // Precompute occupancy by location+serviceLine+roomType, location+serviceLine, and serviceLine
    const locationRoomTypeOccupancy = new Map<string, number>();
    const locationOccupancy = new Map<string, number>();
    const serviceLineOccupancy = new Map<string, number>();
    const occupancyStats = new Map<string, { occupied: number; total: number }>();
    
    for (const unit of unitsForOccupancy) {
      const locServiceRoomKey = `${unit.location}|${unit.serviceLine}|${unit.roomType}`;
      const locServiceKey = `${unit.location}|${unit.serviceLine}`;
      const serviceKey = unit.serviceLine || 'Unknown';
      
      // Location + Service Line + Room Type stats (most granular)
      if (!occupancyStats.has(locServiceRoomKey)) {
        occupancyStats.set(locServiceRoomKey, { occupied: 0, total: 0 });
      }
      const roomStats = occupancyStats.get(locServiceRoomKey)!;
      roomStats.total++;
      if (unit.occupiedYN) roomStats.occupied++;

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
    
    // Calculate occupancy percentages — key format determines bucket:
    //   two pipes  = locationName|serviceLine|roomType → locationRoomTypeOccupancy
    //   one pipe   = locationName|serviceLine          → locationOccupancy
    //   no pipe    = serviceLine                       → serviceLineOccupancy
    for (const [key, stats] of Array.from(occupancyStats)) {
      const occ = stats.total > 0 ? stats.occupied / stats.total : 0;
      const pipeCount = (key.match(/\|/g) || []).length;
      if (pipeCount === 2) {
        locationRoomTypeOccupancy.set(key, occ);
      } else if (pipeCount === 1) {
        locationOccupancy.set(key, occ);
      } else {
        serviceLineOccupancy.set(key, occ);
        // Log service line occupancies to verify B-bed exclusion
        console.log(`Service Line ${key}: ${stats.occupied}/${stats.total} units = ${(occ * 100).toFixed(1)}% occupancy (B-beds excluded for senior housing)`);
      }
    }
    
    // Precompute weights cache
    const uniqueCombinations = new Set<string>();
    const uniqueLocations = new Set<string>();

    // Build a name→locationId map: first seed from the authoritative locations table,
    // then fill in from units that already have locationId (overrides if names match)
    const locationNameToIdMap = new Map<string, string>();
    const clientId = req.clientId || 'demo';
    const allLocations = await storage.getLocations(clientId);
    allLocations.forEach(loc => {
      locationNameToIdMap.set(loc.name.toLowerCase(), loc.id);
    });
    units.forEach(unit => {
      if (unit.locationId && unit.location) {
        locationNameToIdMap.set(unit.location.toLowerCase(), unit.locationId);
      }
    });

    units.forEach(unit => {
      let resolvedId = unit.locationId;
      if (!resolvedId && unit.location) {
        resolvedId = locationNameToIdMap.get(unit.location.toLowerCase());
      }
      if (resolvedId) {
        uniqueLocations.add(resolvedId);
        if (unit.serviceLine) {
          uniqueCombinations.add(`${resolvedId}|${unit.serviceLine}`);
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
    
    console.log(`Precomputed: ${locationRoomTypeOccupancy.size} room-type occupancies, ${locationOccupancy.size} location occupancies, ${serviceLineOccupancy.size} service line occupancies`);
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
    
    // Precompute competitor data keyed by campus|serviceLine|roomType so the distance
    // fallback is room-type-aware at pre-fetch time.  Care/med rates are keyed by
    // campus|serviceLine (same value for all room types — cheaper to fetch once per pair).
    const competitorCache = new Map<string, CompetitorData>(); // key: campus|serviceLine|roomType
    const careRateCache = new Map<string, { trilogyCareLevel2Rate: number | null; trilogyMedMgmtFee: number }>(); // key: campus|serviceLine
    const uniqueCampusServiceLines = new Set<string>(); // campus|serviceLine pairs
    const uniqueCampusServiceLineRooms = new Set<string>(); // campus|serviceLine|roomType triples

    units.forEach(unit => {
      if (unit.location && unit.serviceLine) {
        const slKey = `${unit.location}|${unit.serviceLine}`;
        uniqueCampusServiceLines.add(slKey);
        uniqueCampusServiceLineRooms.add(`${slKey}|${unit.roomType || ''}`);
      }
    });

    // First pass: care/med rates per campus|serviceLine
    const careRatePromises = Array.from(uniqueCampusServiceLines).map(async (key) => {
      const [campus, serviceLine] = key.split('|');
      try {
        const [trilogyCareLevel2Rate, trilogyMedMgmtFee] = await Promise.all([
          storage.getTrilogyCareLevel2Rate(campus, serviceLine, req.clientId || 'demo'),
          storage.getTrilogyMedicationManagementFee(campus, serviceLine)
        ]);
        careRateCache.set(key, { trilogyCareLevel2Rate, trilogyMedMgmtFee });
      } catch {
        careRateCache.set(key, { trilogyCareLevel2Rate: null, trilogyMedMgmtFee: 0 });
      }
    });
    await Promise.all(careRatePromises);

    // Second pass: survey rows per campus|serviceLine|roomType (enables room-type-aware distance fallback)
    const competitorPromises = Array.from(uniqueCampusServiceLineRooms).map(async (key) => {
      const parts = key.split('|');
      const campus = parts[0];
      const serviceLine = parts[1];
      const roomType = parts[2] || '';
      const slKey = `${campus}|${serviceLine}`;
      const careRates = careRateCache.get(slKey) || { trilogyCareLevel2Rate: null, trilogyMedMgmtFee: 0 };
      try {
        const surveyRows = await storage.getTopSurveyCompetitorForLocation(campus, serviceLine, roomType || undefined, clientId);
        competitorCache.set(key, {
          surveyRows: surveyRows || [],
          trilogyCareLevel2Rate: careRates.trilogyCareLevel2Rate,
          trilogyMedMgmtFee: careRates.trilogyMedMgmtFee
        });
      } catch {
        competitorCache.set(key, {
          surveyRows: [],
          trilogyCareLevel2Rate: careRates.trilogyCareLevel2Rate,
          trilogyMedMgmtFee: careRates.trilogyMedMgmtFee
        });
      }
    });

    await Promise.all(competitorPromises);
    console.log(`Competitor data cache: ${competitorCache.size} campus+service+roomType combinations pre-fetched (survey-data based)`);

    // Build T3M room type occupancy map (weighted avg per locationName|serviceLine|normalizedRoomType)
    // Keyed by locationName (always present) since locationId is nullable on room_type_occupancy_history.
    // Mirrors the logic in pricingJobManager.ts buildPricingContext step 8
    const t3mOccupancyMap = new Map<string, number>();
    try {
      const distinctMonths = await db
        .selectDistinct({ year: roomTypeOccupancyHistory.year, month: roomTypeOccupancyHistory.month })
        .from(roomTypeOccupancyHistory)
        .where(eq(roomTypeOccupancyHistory.clientId, clientId))
        .orderBy(sql`year DESC, month DESC`)
        .limit(3);

      if (distinctMonths.length > 0) {
        const t3MonthConditions = distinctMonths.map(({ year, month }) =>
          and(eq(roomTypeOccupancyHistory.year, year!), eq(roomTypeOccupancyHistory.month, month!))
        );
        const rtOccRows = await db.select().from(roomTypeOccupancyHistory)
          .where(and(eq(roomTypeOccupancyHistory.clientId, clientId), or(...t3MonthConditions)));

        const rtAccumulator = new Map<string, { occUnits: number; availableUnits: number }>();
        for (const row of rtOccRows) {
          const locName = (row.locationName || '').trim().toLowerCase();
          const normalizedRoomTypeKey = (row.normalizedRoomType || '').trim().toLowerCase();
          // Split composite service lines (e.g. "AL, MC") into individual tokens so
          // each token gets its own map entry and lookup by single service line succeeds.
          const serviceLineTokens = (row.serviceLine || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
          for (const slToken of serviceLineTokens) {
            const key = `${locName}|${slToken}|${normalizedRoomTypeKey}`;
            if (!rtAccumulator.has(key)) rtAccumulator.set(key, { occUnits: 0, availableUnits: 0 });
            const entry = rtAccumulator.get(key)!;
            entry.occUnits += row.occUnits ?? 0;
            entry.availableUnits += row.availableUnits ?? 0;
          }
        }
        for (const [key, { occUnits, availableUnits }] of rtAccumulator) {
          if (availableUnits > 0) {
            t3mOccupancyMap.set(key, occUnits / availableUnits);
          }
        }
        console.log(`T3M occupancy map built: ${t3mOccupancyMap.size} room type segments (from months: ${distinctMonths.map(m => `${m.year}-${m.month}`).join(', ')})`);
      } else {
        console.log(`No room type occupancy history found for clientId=${clientId}, occupancy will use spot fallback`);
      }
    } catch (err) {
      console.warn(`Failed to build T3M occupancy map, proceeding without it:`, err);
    }
    
    // Compute average days vacant per locationId+serviceLine+roomType group
    // Only vacant units contribute (occupied units have daysVacant=0 which would skew downward)
    const groupVacantAccum = new Map<string, number[]>();
    for (const unit of units) {
      if (!unit.occupiedYN) {
        const locKey = unit.locationId ?? unit.location ?? 'unknown';
        const key = `${locKey}|${unit.serviceLine}|${unit.roomType}`;
        if (!groupVacantAccum.has(key)) groupVacantAccum.set(key, []);
        groupVacantAccum.get(key)!.push(unit.daysVacant || 0);
      }
    }
    const groupAvgDaysVacant = new Map<string, number>();
    for (const [key, vals] of Array.from(groupVacantAccum)) {
      groupAvgDaysVacant.set(key, Math.round(vals.reduce((a, b) => a + b, 0) / vals.length));
    }

    // Build precomputed signals object
    const precomputedSignals: PrecomputedSignals = {
      stockMarketChange,
      serviceLineOccupancy,
      locationOccupancy,
      locationRoomTypeOccupancy,
      t3mOccupancyMap,
      monthIndex: new Date(targetMonth).getMonth() + 1,
      demandCache,
      defaultDemandHistory: [10, 12, 15, 13, 14, 11],
      defaultDemandCurrent: 12,
      competitorCache,
      groupAvgDaysVacant
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
              targetMonth,
              locationNameToIdMap
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
        rawUnitTotalAdjustment: raw.rawTotalAdjustment,
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