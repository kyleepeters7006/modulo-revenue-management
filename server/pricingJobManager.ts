import { randomUUID } from 'crypto';
import { storage } from './storage';
import { db, pool } from './db';
import { rentRollData, competitiveSurveyData, enquireData, roomTypeOccupancyHistory, locations } from '@shared/schema';
import { eq, sql, and, or, inArray } from 'drizzle-orm';
import { normalizeRoomType } from '@shared/roomTypes';
import { calculateAttributedPrice, ensureCacheInitialized } from './pricingOrchestrator';
import type { RentRollData, Guardrails, PricingWeights } from '@shared/schema';
import type { PricingInputs } from './moduloPricingAlgorithm';
import { getSentenceExplanation, generateOverallExplanation } from './sentenceExplanations';
import { matchAndAdjustCompetitor } from './services/competitorLookup';
import { invalidateRefDataCache } from './refDataCache';
import { purgeCommentaryCacheForClient } from './commentaryCache';

// Pre-computed pricing context to avoid per-unit async calls
interface PricingContext {
  // Weights caches
  weightsCache: Map<string, PricingWeights>;
  locationWeightsCache: Map<string, PricingWeights>;
  locationNameToIdMap: Map<string, string>;
  globalWeights: PricingWeights;
  
  // Competitor data caches
  competitorsByLocationService: Map<string, any[]>; // key: location|serviceLine
  trilogyCareLevel2Cache: Map<string, number>; // key: location|serviceLine
  trilogyMedMgmtCache: Map<string, number>; // key: location|serviceLine (usually 0)
  competitorMediansByService: Map<string, number>; // serviceLine -> median rate
  
  // Demand and inquiry data
  demandHistoryCache: Map<string, number[]>; // location -> demand history
  inquiryMetricsCache: Map<string, any>; // location -> inquiry metrics
  
  // Service line metrics
  serviceLineOccupancy: Map<string, number>;
  
  // T3M room type occupancy: key = locationId|serviceLine|normalizedRoomType -> weighted avg occ (0-1)
  t3mOccupancyMap: Map<string, number>;
  
  // Configuration data
  guardrailsData: Guardrails | undefined;
  stockMarketChange: number;
  activeRules: any[];
  targetMonth: string;
  clientId: string;
}

interface PricingJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: {
    current: number;
    total: number;
    percentage: number;
    currentBatch: number;
    totalBatches: number;
  };
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  result?: {
    totalUnits: number;
    totalUpdated: number;
    processingTimeMs: number;
  };
  params: {
    month?: string;
    serviceLine?: string;
    regions?: string[];
    divisions?: string[];
    locations?: string[];
    locationId?: string;
    calculationHistoryId?: string;
    clientId?: string;
  };
}

class PricingJobManager {
  private jobs: Map<string, PricingJob> = new Map();
  private processingJobs: Set<string> = new Set();
  private readonly BATCH_SIZE = 1000; // Process 1000 units at a time for even faster processing  
  private readonly MAX_PARALLEL_BATCHES = 20; // Process up to 20 batches in parallel for maximum speed
  private readonly BATCH_TIMEOUT_MS = 60000; // 60 second timeout per batch to prevent timeouts on larger batches
  
  createJob(params: any): string {
    const jobId = randomUUID();
    const job: PricingJob = {
      id: jobId,
      status: 'pending',
      progress: {
        current: 0,
        total: 0,
        percentage: 0,
        currentBatch: 0,
        totalBatches: 0
      },
      startedAt: new Date(),
      params
    };
    
    this.jobs.set(jobId, job);
    console.log(`[PricingJob ${jobId}] Created new pricing job for month: ${params.month}`);
    
    // Start processing asynchronously without blocking
    this.processJob(jobId).catch(error => {
      console.error(`[PricingJob ${jobId}] Failed to process job:`, error);
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.completedAt = new Date();
    });
    
    return jobId;
  }
  
  /**
   * True when a pricing run for this client is still in flight. Callers that
   * auto-trigger recalculation use this to avoid starting a second overlapping
   * run, which would double the DB load and race on the same rate columns.
   */
  hasActiveJobForClient(clientId: string): boolean {
    return this.getActiveJobForClient(clientId) !== undefined;
  }

  /**
   * The in-flight pricing run for this client, if any. The Rate Card polls this
   * so it can show that rates are being recalculated even for runs it did not
   * start itself — e.g. one auto-triggered by a rule change elsewhere in the app.
   */
  getActiveJobForClient(clientId: string): PricingJob | undefined {
    for (const jobId of Array.from(this.processingJobs)) {
      const job = this.jobs.get(jobId);
      if (job && (job.params?.clientId ?? 'demo') === clientId) return job;
    }
    return undefined;
  }

  getJob(jobId: string): PricingJob | undefined {
    return this.jobs.get(jobId);
  }
  
  private updateProgress(jobId: string, current: number, total: number, currentBatch: number, totalBatches: number) {
    const job = this.jobs.get(jobId);
    if (job) {
      // Calculate percentage with decimal precision, ensure it's never exactly 0 if there's any progress
      let percentage = 0;
      if (total > 0) {
        percentage = (current / total) * 100;
        // If there's any progress but it would round to 0, show at least 1%
        if (current > 0 && percentage < 1) {
          percentage = 1;
        }
        // Keep one decimal place for better granularity
        percentage = Math.round(percentage * 10) / 10;
      }
      
      job.progress = {
        current,
        total,
        percentage,
        currentBatch,
        totalBatches
      };
      
      // Log progress more frequently - every 5% or every batch completion
      const prevPercentage = Math.floor((current - 1) / total * 100 / 5) * 5;
      const currPercentage = Math.floor(percentage / 5) * 5;
      if (currPercentage !== prevPercentage || current === total || currentBatch !== job.progress.currentBatch) {
        console.log(`[PricingJob ${jobId}] Progress: ${percentage.toFixed(1)}% (${current}/${total} units, Batch ${currentBatch}/${totalBatches})`);
      }
    }
  }
  
  // Helper to get weights from cache with O(1) lookup
  private getWeightsFromCache(unit: RentRollData, context: PricingContext): PricingWeights {
    let resolvedLocationId: string | null | undefined = unit.locationId;

    if (!resolvedLocationId) {
      // Attempt name-based lookup when locationId is null
      if (unit.location && context.locationNameToIdMap) {
        resolvedLocationId = context.locationNameToIdMap.get(unit.location.toLowerCase());
      }
      if (!resolvedLocationId) {
        console.warn(`[PricingJob] Unit ${unit.id} (${unit.location || 'no location'}) has no locationId and no name match — using global weights`);
        return context.globalWeights;
      }
    }

    const key = unit.serviceLine ? `${resolvedLocationId}|${unit.serviceLine}` : null;

    if (key && context.weightsCache.has(key)) {
      return context.weightsCache.get(key)!;
    }

    if (context.locationWeightsCache.has(resolvedLocationId)) {
      return context.locationWeightsCache.get(resolvedLocationId)!;
    }

    console.warn(`[PricingJob] No specific or location-level weights for locationId ${resolvedLocationId} — using global weights`);
    return context.globalWeights;
  }
  
  // Build pricing context with all pre-fetched data to avoid per-unit DB queries
  private async buildPricingContext(
    units: RentRollData[], 
    targetMonth: string,
    jobId: string,
    clientId: string = 'demo'
  ): Promise<PricingContext> {
    const startTime = Date.now();
    console.log(`[PricingJob ${jobId}] Building pricing context with pre-fetched data...`);
    
    // 1. Fetch configuration data
    console.log(`[PricingJob ${jobId}] Fetching configuration...`);
    const defaultWeights = {
      occupancyPressure: 25,
      daysVacantDecay: 20,
      seasonality: 10,
      competitorRates: 10,
      stockMarket: 10,
      enableWeights: true,
      inquiryTourVolume: 0
    };
    const globalWeights = await storage.getCurrentWeights() || defaultWeights;
    const guardrailsData = await storage.getCurrentGuardrails();
    const activeRules = await storage.getAdjustmentRules ? 
      (await storage.getAdjustmentRules()).filter((r: any) => r.isActive) : [];
    
    // 2. Fetch stock market data
    console.log(`[PricingJob ${jobId}] Fetching market data...`);
    const { fetchSP500Data } = await import('./routes');
    const stockMarketChange = await fetchSP500Data();
    
    // 3. Pre-fetch all weights
    console.log(`[PricingJob ${jobId}] Pre-fetching all weights...`);
    const weightsCache = new Map<string, PricingWeights>();
    const locationWeightsCache = new Map<string, PricingWeights>();
    const locationNameToIdMap = new Map<string, string>();
    const uniqueLocations = new Set<string>();
    const uniqueCombinations = new Set<string>();

    // Build name→locationId map: seed from authoritative locations table first,
    // then supplement/override with units that already have locationId
    const allDbLocations = await storage.getLocations();
    allDbLocations.forEach(loc => {
      locationNameToIdMap.set(loc.name.toLowerCase(), loc.id);
    });
    units.forEach(unit => {
      if (unit.locationId && unit.location) {
        locationNameToIdMap.set((unit.location as string).toLowerCase(), unit.locationId);
      }
    });

    units.forEach(unit => {
      let resolvedId: string | null | undefined = unit.locationId;
      if (!resolvedId && unit.location) {
        resolvedId = locationNameToIdMap.get((unit.location as string).toLowerCase());
      }
      if (resolvedId) {
        uniqueLocations.add(resolvedId);
        if (unit.serviceLine) {
          const key = `${resolvedId}|${unit.serviceLine}`;
          uniqueCombinations.add(key);
        }
      }
    });
    
    // Batch fetch location weights
    const locationWeightsPromises = Array.from(uniqueLocations).map(async locationId => {
      const locationWeights = await storage.getWeightsByFilter(locationId, null);
      if (locationWeights) {
        locationWeightsCache.set(locationId, locationWeights);
      }
    });
    await Promise.all(locationWeightsPromises);
    
    // Batch fetch location+serviceLine weights
    const comboWeightsPromises = Array.from(uniqueCombinations).map(async combo => {
      const [locationId, serviceLine] = combo.split('|');
      if (locationId && serviceLine) {
        const specificWeights = await storage.getWeightsByFilter(locationId, serviceLine);
        if (specificWeights) {
          weightsCache.set(combo, specificWeights);
        }
      }
    });
    await Promise.all(comboWeightsPromises);
    
    // 4. Pre-fetch all competitor data
    // Survey rows are keyed by campus|serviceLine|roomType so the distance fallback is
    // room-type-aware at pre-fetch time.  Care/med rates are keyed by campus|serviceLine
    // (same value regardless of room type — cheaper to fetch once per pair).
    console.log(`[PricingJob ${jobId}] Pre-fetching survey competitor data...`);
    const competitorsByLocationService = new Map<string, any[]>(); // key: campus|serviceLine|roomType
    const trilogyCareLevel2Cache = new Map<string, number>(); // key: campus|serviceLine
    const trilogyMedMgmtCache = new Map<string, number>(); // key: campus|serviceLine
    const uniqueLocationServices = new Set<string>(); // campus|serviceLine pairs
    const uniqueLocationServiceRooms = new Set<string>(); // campus|serviceLine|roomType triples

    units.forEach(unit => {
      if (unit.location && unit.serviceLine) {
        const slKey = `${unit.location}|${unit.serviceLine}`;
        uniqueLocationServices.add(slKey);
        uniqueLocationServiceRooms.add(`${slKey}|${unit.roomType || ''}`);
      }
    });

    // First pass: care/med rates per campus|serviceLine
    const careMedPromises = Array.from(uniqueLocationServices).map(async key => {
      const [location, serviceLine] = key.split('|');
      try {
        const [careLevel2Rate, medMgmtFee] = await Promise.all([
          storage.getTrilogyCareLevel2Rate(location, serviceLine, clientId),
          storage.getTrilogyMedicationManagementFee(location, serviceLine)
        ]);
        if (careLevel2Rate) trilogyCareLevel2Cache.set(key, careLevel2Rate);
        trilogyMedMgmtCache.set(key, medMgmtFee);
      } catch (err) {
        // Continue without care/med data
      }
    });
    await Promise.all(careMedPromises);

    // Second pass: survey rows per campus|serviceLine|roomType (enables room-type-aware distance fallback)
    const competitorPromises = Array.from(uniqueLocationServiceRooms).map(async key => {
      const parts = key.split('|');
      const location = parts[0];
      const serviceLine = parts[1];
      const roomType = parts[2] || '';
      try {
        const surveyRows = await storage.getTopSurveyCompetitorForLocation(location, serviceLine, roomType || undefined, clientId);
        if (surveyRows && surveyRows.length > 0) {
          competitorsByLocationService.set(key, surveyRows);
        }
      } catch (err) {
        // Continue without competitor data
      }
    });
    await Promise.all(competitorPromises);
    
    // Portfolio-wide medians are no longer used as the primary competitor signal.
    // We now use location+service line+room-type specific rates from competitive_survey_data.
    const competitorMediansByService = new Map<string, number>(); // kept for interface compatibility
    
    // 6. Pre-fetch inquiry metrics and demand history
    console.log(`[PricingJob ${jobId}] Pre-fetching demand history...`);
    const demandHistoryCache = new Map<string, number[]>();
    const inquiryMetricsCache = new Map<string, any>();
    
    // Get inquiry metrics for the month
    const inquiryMetrics = await storage.getInquiryMetricsByMonth(targetMonth);
    inquiryMetrics.forEach((metric: any) => {
      if (metric.location) {
        inquiryMetricsCache.set(metric.location, metric);
        // Mock demand history for now (could be fetched from historical data)
        demandHistoryCache.set(metric.location, [45, 42, 48, 50, 43, 46]);
      }
    });
    
    // Default demand history for locations without specific data
    const defaultDemandHistory = [45, 42, 48, 50, 43, 46];
    units.forEach(unit => {
      if (unit.location && !demandHistoryCache.has(unit.location)) {
        demandHistoryCache.set(unit.location, defaultDemandHistory);
      }
    });
    
    // 7. Calculate service line occupancy
    // IMPORTANT: For senior housing (AL, SL, VIL, IL, AL/MC), exclude B-beds from occupancy calculation
    // Only HC counts all beds
    console.log(`[PricingJob ${jobId}] Calculating occupancy metrics...`);
    const serviceLineOccupancy = new Map<string, number>();
    const seniorHousingServiceLines = ['AL', 'SL', 'VIL', 'IL', 'AL/MC'];
    
    // Calculate occupancy for senior housing (excluding B-beds)
    const seniorHousingStats = await db.select({
      serviceLine: rentRollData.serviceLine,
      occupied: sql`SUM(CASE WHEN occupied_yn = true AND room_number NOT LIKE '%/B' THEN 1 ELSE 0 END)`.as('occupied'),
      total: sql`COUNT(CASE WHEN room_number NOT LIKE '%/B' THEN 1 END)`.as('total')
    })
    .from(rentRollData)
    .where(and(
      eq(rentRollData.uploadMonth, targetMonth),
      inArray(rentRollData.serviceLine, seniorHousingServiceLines)
    ))
    .groupBy(rentRollData.serviceLine);
    
    for (const stats of seniorHousingStats) {
      const serviceLine = stats.serviceLine || 'Unknown';
      const { occupied, total } = stats as { occupied: number; total: number };
      const occupancyRate = total > 0 ? occupied / total : 0;
      serviceLineOccupancy.set(serviceLine, occupancyRate);
      console.log(`[PricingJob ${jobId}] Senior Housing ${serviceLine}: ${occupied}/${total} units = ${(occupancyRate * 100).toFixed(1)}% occupancy (excluding B-beds)`);
    }
    
    // Calculate occupancy for HC (including all beds)
    const hcStats = await db.select({
      serviceLine: rentRollData.serviceLine,
      occupied: sql`SUM(CASE WHEN occupied_yn = true THEN 1 ELSE 0 END)`.as('occupied'),
      total: sql`COUNT(*)`.as('total')
    })
    .from(rentRollData)
    .where(and(
      eq(rentRollData.uploadMonth, targetMonth),
      or(
        eq(rentRollData.serviceLine, 'HC'),
        eq(rentRollData.serviceLine, 'HC/MC')
      )
    ))
    .groupBy(rentRollData.serviceLine);
    
    for (const stats of hcStats) {
      const serviceLine = stats.serviceLine || 'Unknown';
      const { occupied, total } = stats as { occupied: number; total: number };
      serviceLineOccupancy.set(serviceLine, total > 0 ? occupied / total : 0);
    }

    // 8. Build T3M room type occupancy map (weighted avg per locationName|serviceLine|normalizedRoomType)
    // Keyed by locationName (always present) since locationId is nullable on room_type_occupancy_history.
    // Use the 3 most recent distinct uploaded months from room_type_occupancy_history (not calendar months)
    console.log(`[PricingJob ${jobId}] Building T3M room type occupancy map...`);
    const t3mOccupancyMap = new Map<string, number>();
    try {
      // Discover the 3 most recent distinct (year, month) pairs that have been uploaded for this client
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
        // Accumulate occ_units and available_units for weighted average
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
        console.log(`[PricingJob ${jobId}] T3M occupancy map built: ${t3mOccupancyMap.size} room type segments (from months: ${distinctMonths.map(m => `${m.year}-${m.month}`).join(', ')})`);
      } else {
        console.log(`[PricingJob ${jobId}] No room type occupancy history found for clientId=${clientId}, occupancy will use spot fallback`);
      }
    } catch (err) {
      console.warn(`[PricingJob ${jobId}] Failed to build T3M occupancy map, proceeding without it:`, err);
    }
    
    const buildTime = Date.now() - startTime;
    console.log(`[PricingJob ${jobId}] Pricing context built in ${buildTime}ms with:
      - ${weightsCache.size} location+service weights
      - ${locationWeightsCache.size} location weights  
      - ${competitorsByLocationService.size} competitor groups
      - ${trilogyCareLevel2Cache.size} care level 2 rates
      - ${competitorMediansByService.size} competitor medians
      - ${demandHistoryCache.size} demand histories
      - ${serviceLineOccupancy.size} occupancy rates
      - ${t3mOccupancyMap.size} T3M room type occupancy entries`);
    
    return {
      weightsCache,
      locationWeightsCache,
      locationNameToIdMap,
      globalWeights,
      competitorsByLocationService,
      trilogyCareLevel2Cache,
      trilogyMedMgmtCache,
      competitorMediansByService,
      demandHistoryCache,
      inquiryMetricsCache,
      serviceLineOccupancy,
      t3mOccupancyMap,
      guardrailsData,
      stockMarketChange,
      activeRules,
      targetMonth,
      clientId
    };
  }
  
  private async processJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      console.error(`[PricingJob ${jobId}] Job not found in map`);
      return;
    }
    
    // Create calculation history entry
    let calculationHistoryId: string | undefined;
    
    try {
      console.log(`[PricingJob ${jobId}] Starting processing...`);
      job.status = 'processing';
      this.processingJobs.add(jobId);
      
      const startTime = Date.now();
      const {
        month,
        locationId,
        locations: locationFilter,
        serviceLine: serviceLineFilter,
        regions: regionFilter,
        divisions: divisionFilter,
        clientId: jobClientId,
      } = job.params;
      const jobClientId_ = jobClientId || 'demo';
      // Resolve the newest uploaded month for this client rather than assuming a hardcoded
      // one. A stale default silently prices a month that no longer holds current data.
      const targetMonth = month || await this.resolveLatestUploadMonth(jobClientId_);
      
      // Reuse the history entry created by the caller (e.g. triggerPostImportActions) when
      // one is provided.  If not, create a fresh entry so manual/cron runs are still tracked.
      if (job.params.calculationHistoryId) {
        calculationHistoryId = job.params.calculationHistoryId;
        console.log(`[PricingJob ${jobId}] Reusing existing calculation history entry ${calculationHistoryId}`);
      } else {
        const historyEntry = await storage.createCalculationHistory({
          calculationType: 'manual',
          status: 'started',
          startedAt: new Date(),
          completedAt: null,
          locationId: locationFilter?.[0] || locationId || null,
          uploadMonth: targetMonth,
          totalUnits: null,
          unitsCalculated: null,
          averageModuloRate: null,
          averageAIRate: null,
          errorMessage: null,
          metadata: null
        });
        calculationHistoryId = historyEntry.id;
      }
      
      // Initialize cache once for all batches
      console.log(`[PricingJob ${jobId}] Initializing attribute pricing cache for month: ${targetMonth}`);
      await ensureCacheInitialized(targetMonth);
      
      // Get all units for the month, then filter by location if specified
      console.log(`[PricingJob ${jobId}] Fetching units for month: ${targetMonth}`);
      const allMonthUnits = await storage.getRentRollDataByMonth(targetMonth, jobClientId_);

      // Apply EVERY scope the caller asked for. The Rate Card sends serviceLine, regions,
      // divisions and locations together; a filter that is accepted but silently ignored
      // would reprice the whole portfolio while still reporting success.
      const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
      let units = allMonthUnits;
      const appliedScopes: string[] = [];

      if (serviceLineFilter) {
        units = units.filter(u => u.serviceLine === serviceLineFilter);
        appliedScopes.push(`serviceLine=${serviceLineFilter}`);
      }

      const wantsRegionOrDivision = !!(regionFilter?.length || divisionFilter?.length);
      const wantsLocations = !!locationFilter?.length;

      if (wantsRegionOrDivision || wantsLocations) {
        // Client-scoped: location names are only unique within a tenant.
        const clientLocations = await db
          .select()
          .from(locations)
          .where(eq(locations.clientId, jobClientId_));

        // Region and division are properties of a location, so resolve them to the set of
        // locations they cover before filtering units.
        if (wantsRegionOrDivision) {
          const inScope = new Set(
            clientLocations
              .filter(l =>
                (!regionFilter?.length   || (l.region   && regionFilter.includes(l.region))) &&
                (!divisionFilter?.length || (l.division && divisionFilter.includes(l.division))))
              .map(l => norm(l.name))
          );
          units = units.filter(u => inScope.has(norm(u.location)));
          if (regionFilter?.length)   appliedScopes.push(`regions=${regionFilter.join('|')}`);
          if (divisionFilter?.length) appliedScopes.push(`divisions=${divisionFilter.join('|')}`);
        }

        // The filter UI holds location NAMES and the synchronous endpoint matches on name,
        // but this path previously matched locationId only — so a name filter selected zero
        // units and the job still reported success. Classify each token against the known
        // ids and names rather than matching both fields against one pooled set, so a name
        // can never collide with an unrelated location's id.
        if (wantsLocations) {
          const knownIds   = new Set(clientLocations.map(l => norm(l.id)));
          const wantedIds   = new Set<string>();
          const wantedNames = new Set<string>();
          for (const token of locationFilter!) {
            const key = norm(token);
            if (!key) continue;
            (knownIds.has(key) ? wantedIds : wantedNames).add(key);
          }
          units = units.filter(u =>
            (wantedIds.size   > 0 && wantedIds.has(norm(u.locationId))) ||
            (wantedNames.size > 0 && wantedNames.has(norm(u.location))));
          appliedScopes.push(`locations=${locationFilter!.join('|')}`);
        }
      }

      if (appliedScopes.length > 0) {
        console.log(`[PricingJob ${jobId}] Scoped to ${units.length}/${allMonthUnits.length} units (${appliedScopes.join(', ')})`);
        // A requested scope that matches nothing is a filter bug, not an empty portfolio.
        // Failing loudly beats a green "completed" that priced nothing.
        if (units.length === 0) {
          throw new Error(
            `No units matched the requested scope for ${targetMonth} (${appliedScopes.join(', ')}). ` +
            `Nothing was priced — check the filters.`
          );
        }
      }
      const totalUnits = units.length;
      
      console.log(`[PricingJob ${jobId}] Total units to process: ${totalUnits}`);
      
      // Calculate total batches
      const totalBatches = Math.ceil(totalUnits / this.BATCH_SIZE);
      
      // Update job progress with actual counts
      this.updateProgress(jobId, 0, totalUnits, 0, totalBatches);
      
      // Build pricing context with all pre-fetched data (MAJOR OPTIMIZATION)
      const pricingContext = await this.buildPricingContext(units, targetMonth, jobId, jobClientId_);
      
      // Process units in batches
      console.log(`[PricingJob ${jobId}] Starting batch processing (${totalBatches} batches of ${this.BATCH_SIZE} units)...`);
      const allUpdates: Array<{ id: string; moduloSuggestedRate: number; moduloCalculationDetails: string }> = [];
      
      // Track completed batches properly
      const completedBatches = new Map<number, number>();
      let totalProcessed = 0;
      
      for (let batchGroupIndex = 0; batchGroupIndex < totalBatches; batchGroupIndex += this.MAX_PARALLEL_BATCHES) {
        // Process up to MAX_PARALLEL_BATCHES in parallel
        const batchPromises: Array<Promise<{ batchIndex: number; updates: Array<{ id: string; moduloSuggestedRate: number; moduloCalculationDetails: string }> }>> = [];
        const endBatchIndex = Math.min(batchGroupIndex + this.MAX_PARALLEL_BATCHES, totalBatches);
        
        for (let i = batchGroupIndex; i < endBatchIndex; i++) {
          const startIdx = i * this.BATCH_SIZE;
          const endIdx = Math.min(startIdx + this.BATCH_SIZE, totalUnits);
          const batchUnits = units.slice(startIdx, endIdx);
          const currentBatchIndex = i;
          
          console.log(`[PricingJob ${jobId}] Processing batch ${currentBatchIndex + 1}/${totalBatches} (units ${startIdx + 1}-${endIdx})...`);
          
          // Wrap batch processing with timeout to prevent stuck operations
          const batchPromise = Promise.race([
            this.processBatch(
              batchUnits,
              pricingContext,
              // Intra-batch progress callback for large batches
              (processedInBatch) => {
                // Calculate approximate progress including partial batch
                const baseProcessed = totalProcessed;
                const approxProcessed = baseProcessed + processedInBatch;
                this.updateProgress(jobId, approxProcessed, totalUnits, currentBatchIndex + 1, totalBatches);
              }
            ),
            new Promise<Array<{ id: string; moduloSuggestedRate: number; moduloCalculationDetails: string }>>((_, reject) => 
              setTimeout(() => reject(new Error(`Batch ${currentBatchIndex + 1} timed out after ${this.BATCH_TIMEOUT_MS}ms`)), this.BATCH_TIMEOUT_MS)
            )
          ]).then(updates => {
            // Store the number of units processed in this batch
            completedBatches.set(currentBatchIndex, updates.length);
            
            // Calculate total processed based on all completed batches so far
            let newTotalProcessed = 0;
            for (const count of completedBatches.values()) {
              newTotalProcessed += count;
            }
            
            // Update progress with accurate count
            this.updateProgress(jobId, newTotalProcessed, totalUnits, completedBatches.size, totalBatches);
            console.log(`[PricingJob ${jobId}] Batch ${currentBatchIndex + 1} completed: ${updates.length} units processed`);
            
            return { batchIndex: currentBatchIndex, updates };
          }).catch(error => {
            console.error(`[PricingJob ${jobId}] Batch ${currentBatchIndex + 1} failed:`, error);
            // Return empty updates for failed batch but continue processing
            completedBatches.set(currentBatchIndex, 0);
            return { batchIndex: currentBatchIndex, updates: [] };
          });
          
          batchPromises.push(batchPromise);
        }
        
        // Wait for all parallel batches to complete
        const batchResults = await Promise.all(batchPromises);
        
        // Collect all updates and update total
        for (const result of batchResults) {
          allUpdates.push(...result.updates);
        }
        
        // Update totalProcessed for next batch group
        totalProcessed = allUpdates.length;
        
        // Log batch group completion  
        console.log(`[PricingJob ${jobId}] Completed batch group ${batchGroupIndex + 1}-${endBatchIndex} (${totalProcessed}/${totalUnits} units processed)`);
      }
      
      // Apply adjustment rules so the persisted rule_adjusted_rate reflects what the
      // rules engine would actually serve. This job previously wrote Modulo rates only,
      // which meant every unit it processed had its rule rate cleared.
      let finalUpdates: Array<{
        id: string;
        moduloSuggestedRate: number;
        moduloCalculationDetails: string;
        ruleAdjustedRate?: number | null;
        appliedRuleName?: string | null;
      }> = allUpdates;

      if (allUpdates.length > 0) {
        try {
          const { fetchAndApplyAdjustmentRules } = await import('./services/adjustmentRulesService');

          // Index units by id rather than relying on positional alignment: a failed
          // batch returns an empty array, which would shift every subsequent index.
          const unitById = new Map(units.map(u => [u.id, u]));
          const unitsWithModuloRates = allUpdates.map(update => ({
            id: update.id,
            unit: unitById.get(update.id),
            moduloSuggestedRate: update.moduloSuggestedRate,
          }));

          const adjustmentResults = await fetchAndApplyAdjustmentRules(unitsWithModuloRates);
          const resultById = new Map(adjustmentResults.map(r => [r.id, r]));

          finalUpdates = allUpdates.map(update => {
            const adj = resultById.get(update.id);
            return {
              ...update,
              ruleAdjustedRate: adj ? adj.ruleAdjustedRate : null,
              appliedRuleName: adj ? adj.appliedRuleName : null,
            };
          });

          const rulesAppliedCount = adjustmentResults.filter(r => r.ruleAdjustedRate !== null).length;
          console.log(`[PricingJob ${jobId}] Applied adjustment rules to ${rulesAppliedCount}/${allUpdates.length} units`);
        } catch (err) {
          // Fall back to the Modulo-only payload. Because the bulk writer now preserves
          // rule columns when they are undefined, existing rule rates survive instead of
          // being wiped by a failed rules pass.
          console.error(`[PricingJob ${jobId}] Adjustment rule application failed; preserving existing rule rates`, err);
          finalUpdates = allUpdates;
        }
      }

      // Bulk update database with all results
      console.log(`[PricingJob ${jobId}] Updating database with ${finalUpdates.length} pricing calculations...`);
      if (finalUpdates.length > 0) {
        await storage.bulkUpdateModuloRates(finalUpdates);
      }
      
      // Regenerate rate card
      console.log(`[PricingJob ${jobId}] Regenerating rate card for month: ${targetMonth}`);
      await storage.generateRateCard(targetMonth);
      
      // Run ML training pipeline after pricing calculation completes
      // This detects AI rate adoptions, updates sale tracking, and trains the model
      try {
        console.log(`[PricingJob ${jobId}] Running ML training pipeline...`);
        const { detectAiRateAdoptions, updateSaleTracking, trainAndUpdateWeights } = await import('./services/mlTrainingService');
        
        // 1. Detect AI rate adoptions (when AI rate became street rate)
        const adoptionsDetected = await detectAiRateAdoptions(targetMonth);
        console.log(`[PricingJob ${jobId}] ML: Detected ${adoptionsDetected} AI rate adoptions`);
        
        // 2. Update sale tracking (check if adopted units sold within 30 days)
        const salesTracked = await updateSaleTracking();
        console.log(`[PricingJob ${jobId}] ML: Tracked ${salesTracked} sales within 30 days`);
        
        // 3. Train and update weights if we have enough samples
        const trainingResult = await trainAndUpdateWeights('scheduled');
        console.log(`[PricingJob ${jobId}] ML: ${trainingResult.message}`);

        // 4. Refine price elasticity (online learning blend with prior estimate)
        const { computeAndStoreElasticity } = await import('./services/elasticityService');
        const elasticityResult = await computeAndStoreElasticity(jobClientId_);
        console.log(`[PricingJob ${jobId}] ML: Refined elasticity for ${elasticityResult.updated} segments`);

      } catch (mlError) {
        // ML training errors should not fail the pricing job
        console.error(`[PricingJob ${jobId}] ML training error (non-fatal):`, mlError);
      }
      
      // Calculate average Modulo rate
      const avgModuloRate = allUpdates.length > 0
        ? allUpdates.reduce((sum, u) => sum + u.moduloSuggestedRate, 0) / allUpdates.length
        : 0;
      
      // Mark job as completed - ensure progress is 100%
      const processingTime = Date.now() - startTime;
      
      // Set final progress to 100% before marking complete
      this.updateProgress(jobId, totalUnits, totalUnits, totalBatches, totalBatches);
      
      // Rates were rewritten — drop cached reference-data and commentary so
      // Strategy Overview regenerates fresh content on the next request.
      // Both purges must complete BEFORE job.status flips to 'completed' so
      // an immediate GET /api/pricing-controls/commentary cannot race and serve
      // the old narrative.
      invalidateRefDataCache();
      // purgeCommentaryCacheForClient propagates DB errors (not caught inside)
      // so a failure here marks the job 'failed' via the outer catch, preventing
      // the job from being reported as completed while stale commentary remains serveable.
      await purgeCommentaryCacheForClient(jobClientId_, pool);

      job.status = 'completed';
      job.completedAt = new Date();
      job.result = {
        totalUnits,
        totalUpdated: allUpdates.length,
        processingTimeMs: processingTime
      };
      
      // Update calculation history to completed.
      // Merge SFTP-origin fields back into metadata so the triggeredBy filter remains valid
      // for SFTP-triggered jobs even after the history row transitions to "completed".
      if (calculationHistoryId) {
        await storage.updateCalculationHistory(calculationHistoryId, {
          status: 'completed',
          completedAt: new Date(),
          totalUnits,
          unitsCalculated: allUpdates.length,
          averageModuloRate: avgModuloRate,
          averageAIRate: null, // AI rates are calculated separately
          metadata: {
            // Preserve SFTP origin markers when this job was triggered by an import
            ...(job.params.calculationHistoryId
              ? { triggeredBy: 'sftp_import', clientId: jobClientId_ }
              : {}),
            processingTimeMs: processingTime,
            batchesProcessed: totalBatches,
          }
        });
      }
      
      console.log(`[PricingJob ${jobId}] Completed! Processed ${totalUnits} units in ${processingTime}ms (${(processingTime / 1000).toFixed(2)}s)`);
      
    } catch (error) {
      console.error(`[PricingJob ${jobId}] Error:`, error);
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.completedAt = new Date();
      
      // Update calculation history to failed.
      // Re-include SFTP origin markers so the triggeredBy filter still works.
      if (calculationHistoryId) {
        await storage.updateCalculationHistory(calculationHistoryId, {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          ...(job.params.calculationHistoryId
            ? { metadata: { triggeredBy: 'sftp_import', clientId: job.params.clientId || 'demo' } }
            : {}),
        });
      }
    } finally {
      this.processingJobs.delete(jobId);
      
      // Clean up old jobs after 1 hour
      setTimeout(() => {
        this.jobs.delete(jobId);
        console.log(`[PricingJob ${jobId}] Cleaned up job from memory`);
      }, 60 * 60 * 1000);
    }
  }
  
  /**
   * Newest upload month for a client, falling back to the newest month across all
   * clients. Throws rather than guessing a month when there is no rent roll at all,
   * so a misconfigured job fails loudly instead of pricing the wrong period.
   */
  private async resolveLatestUploadMonth(clientId: string): Promise<string> {
    const scoped = await db
      .select({ m: sql<string | null>`MAX(${rentRollData.uploadMonth})` })
      .from(rentRollData)
      .where(eq(rentRollData.clientId, clientId));
    if (scoped[0]?.m) return scoped[0].m;

    const anyClient = await db
      .select({ m: sql<string | null>`MAX(${rentRollData.uploadMonth})` })
      .from(rentRollData);
    if (anyClient[0]?.m) return anyClient[0].m;

    throw new Error('No rent roll data available; cannot determine a month to price.');
  }

  private async processBatch(
    units: RentRollData[], 
    context: PricingContext,
    progressCallback?: (processedInBatch: number) => void
  ): Promise<Array<{ id: string; moduloSuggestedRate: number; moduloCalculationDetails: string }>> {
    const updates = [];
    const batchStartTime = Date.now();
    
    console.log(`[Batch] Processing batch with ${units.length} units using cached context...`);
    let processedInBatch = 0;
    let skippedCount = 0;
    
    for (const unit of units) {
      try {
        // Get weights from cache (O(1) lookup)
        const unitWeights = this.getWeightsFromCache(unit, context);
        if (!unitWeights || unitWeights.enableWeights === false) {
          skippedCount++;
          continue; // Skip units with disabled weights
        }
        
        // Get cached occupancy (O(1) lookup)
        const serviceLineOcc = context.serviceLineOccupancy.get(unit.serviceLine) || 0.87;

        // Look up T3M room type occupancy — use weighted avg if available, else fall back to spot
        // Keys are stored lowercase+trimmed (location, service line, and room type), so normalize all three
        const normalizedRT = normalizeRoomType(unit.roomType || '').trim().toLowerCase();
        const t3mKey = `${(unit.location || '').trim().toLowerCase()}|${(unit.serviceLine || '').trim().toLowerCase()}|${normalizedRT}`;
        const t3mOcc = context.t3mOccupancyMap.get(t3mKey);
        const occupancy = t3mOcc !== undefined ? t3mOcc : serviceLineOcc;
        const occupancySource: 't3m' | 'spot' = t3mOcc !== undefined ? 't3m' : 'spot';

        // Log the actual occupancy being used for debugging
        if (processedInBatch === 0 || unit.serviceLine !== units[0]?.serviceLine) {
          console.log(`[Batch] Using ${unit.serviceLine} occupancy: ${(occupancy * 100).toFixed(1)}% (${occupancySource}) for unit ${unit.roomNumber}`);
        }
        const daysVacant = unit.daysVacant || 0;
        const monthIndex = new Date(context.targetMonth).getMonth() + 1;
        
        // Get competitor prices from survey data cache (O(1) lookups, NO async DB calls)
        let competitorPrices: number[] = [];
        let competitorInfo: import('./moduloPricingAlgorithm').CompetitorInfo | undefined;

        if (unit.location && unit.serviceLine) {
          const slKey = `${unit.location}|${unit.serviceLine}`;
          const surveyKey = `${slKey}|${unit.roomType || ''}`;
          const surveyRows: any[] = context.competitorsByLocationService.get(surveyKey) || [];
          const ourCareLevel2 = context.trilogyCareLevel2Cache.get(slKey) || 0;
          const ourMedMgmt = context.trilogyMedMgmtCache?.get(slKey) ?? 0;
          ({ competitorPrices, competitorInfo } = matchAndAdjustCompetitor(
            surveyRows, unit.roomType || '', ourCareLevel2, ourMedMgmt, unit.serviceLine || undefined
          ));
        }
        
        // Get demand data from cache (O(1) lookup)
        const demandHistory = context.demandHistoryCache.get(unit.location) || [45, 42, 48, 50, 43, 46];
        const inquiryMetric = context.inquiryMetricsCache.get(unit.location);
        const demandCurrent = inquiryMetric ? 
          (inquiryMetric.inquiries || 0) + (inquiryMetric.tours || 0) : 
          (unit.inquiryCount || 0) + (unit.tourCount || 0);
        
        const pricingInputs: PricingInputs = {
          occupancy,
          occupancySource,
          daysVacant,
          monthIndex,
          competitorPrices,
          marketReturn: context.stockMarketChange / 100,
          demandCurrent,
          demandHistory,
          serviceLine: unit.serviceLine,
          competitorInfo
        };
        
        // Calculate pricing (should be much faster now with cached data)
        const orchestratorResult = await calculateAttributedPrice(unit, unitWeights, pricingInputs, context.guardrailsData);
        
        // Build calculation details
        const calculationDetails = {
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
          totalAdjustment: orchestratorResult.moduloDetails.totalAdjustment,
          preOverrideTotalAdj: orchestratorResult.moduloDetails.preOverrideTotalAdj,
          finalRate: orchestratorResult.finalPrice,
          moduloRate: orchestratorResult.moduloRate,
          appliedRules: [],
          signals: orchestratorResult.moduloDetails.signals,
          blendedSignal: orchestratorResult.moduloDetails.blendedSignal,
          explanation: generateOverallExplanation(orchestratorResult.moduloDetails, pricingInputs),
          guardrailsApplied: orchestratorResult.guardrailsApplied,
          occupancySource,
          occupancyUsed: occupancy
        };
        
        updates.push({
          id: unit.id,
          moduloSuggestedRate: orchestratorResult.finalPrice,
          moduloCalculationDetails: JSON.stringify(calculationDetails)
        });
        
        // Report progress within batch every 50 units for large batches
        processedInBatch++;
        if (progressCallback && processedInBatch % 50 === 0) {
          progressCallback(processedInBatch);
        }
        
      } catch (error) {
        console.error(`Error processing unit ${unit.id}:`, error);
        // Continue with next unit
      }
    }
    
    const batchTime = Date.now() - batchStartTime;
    const avgTimePerUnit = updates.length > 0 ? Math.round(batchTime / updates.length) : 0;
    console.log(`[Batch] Batch completed: ${updates.length} units processed, ${skippedCount} skipped in ${batchTime}ms (avg ${avgTimePerUnit}ms per unit)`);
    return updates;
  }
  
  // Get all jobs for monitoring
  getAllJobs(): PricingJob[] {
    return Array.from(this.jobs.values());
  }
  
  // Check if any jobs are currently processing
  hasActiveJobs(): boolean {
    return this.processingJobs.size > 0;
  }
}

// Export singleton instance
export const pricingJobManager = new PricingJobManager();