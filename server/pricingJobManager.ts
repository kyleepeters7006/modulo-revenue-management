import { randomUUID } from 'crypto';
import { storage } from './storage';
import { db } from './db';
import { rentRollData, competitiveSurveyData, enquireData } from '@shared/schema';
import { eq, sql, and, or, inArray } from 'drizzle-orm';
import { calculateAttributedPrice, ensureCacheInitialized } from './pricingOrchestrator';
import type { RentRollData, Guardrails, PricingWeights } from '@shared/schema';
import type { PricingInputs } from './moduloPricingAlgorithm';
import { getSentenceExplanation, generateOverallExplanation } from './sentenceExplanations';

// Pre-computed pricing context to avoid per-unit async calls
interface PricingContext {
  // Weights caches
  weightsCache: Map<string, PricingWeights>;
  locationWeightsCache: Map<string, PricingWeights>;
  globalWeights: PricingWeights;
  
  // Competitor data caches
  competitorsByLocationService: Map<string, any[]>; // key: location|serviceLine
  trilogyCareLevel2Cache: Map<string, number>; // key: location|serviceLine
  competitorMediansByService: Map<string, number>; // serviceLine -> median rate
  
  // Demand and inquiry data
  demandHistoryCache: Map<string, number[]>; // location -> demand history
  inquiryMetricsCache: Map<string, any>; // location -> inquiry metrics
  
  // Service line metrics
  serviceLineOccupancy: Map<string, number>;
  
  // Configuration data
  guardrailsData: Guardrails | undefined;
  stockMarketChange: number;
  activeRules: any[];
  targetMonth: string;
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
    month: string;
    serviceLine?: string;
    regions?: string[];
    divisions?: string[];
    locations?: string[];
  };
}

class PricingJobManager {
  private jobs: Map<string, PricingJob> = new Map();
  private processingJobs: Set<string> = new Set();
  private readonly BATCH_SIZE = 500; // Process 500 units at a time for faster processing
  private readonly MAX_PARALLEL_BATCHES = 10; // Process up to 10 batches in parallel for faster completion
  private readonly BATCH_TIMEOUT_MS = 30000; // 30 second timeout per batch
  
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
    if (!unit.locationId) return context.globalWeights;
    
    const key = unit.serviceLine ? `${unit.locationId}|${unit.serviceLine}` : null;
    
    if (key && context.weightsCache.has(key)) {
      return context.weightsCache.get(key)!;
    }
    
    if (context.locationWeightsCache.has(unit.locationId)) {
      return context.locationWeightsCache.get(unit.locationId)!;
    }
    
    return context.globalWeights;
  }
  
  // Build pricing context with all pre-fetched data to avoid per-unit DB queries
  private async buildPricingContext(
    units: RentRollData[], 
    targetMonth: string,
    jobId: string
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
    const uniqueLocations = new Set<string>();
    const uniqueCombinations = new Set<string>();
    
    units.forEach(unit => {
      if (unit.locationId) {
        uniqueLocations.add(unit.locationId);
        if (unit.serviceLine) {
          const key = `${unit.locationId}|${unit.serviceLine}`;
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
    console.log(`[PricingJob ${jobId}] Pre-fetching competitor data...`);
    const competitorsByLocationService = new Map<string, any[]>();
    const trilogyCareLevel2Cache = new Map<string, number>();
    const uniqueLocationServices = new Set<string>();
    
    units.forEach(unit => {
      if (unit.campus && unit.serviceLine) {
        uniqueLocationServices.add(`${unit.campus}|${unit.serviceLine}`);
      }
    });
    
    // Batch fetch all competitor data
    const competitorPromises = Array.from(uniqueLocationServices).map(async key => {
      const [location, serviceLine] = key.split('|');
      
      // Get competitors for this location/service
      const competitors = await storage.getCompetitorsByLocationAndServiceLine(location, serviceLine);
      competitorsByLocationService.set(key, competitors);
      
      // Get Trilogy care level 2 rate
      try {
        const careLevel2Rate = await storage.getTrilogyCareLevel2Rate(location, serviceLine);
        if (careLevel2Rate) {
          trilogyCareLevel2Cache.set(key, careLevel2Rate);
        }
      } catch (err) {
        // Continue without care level 2 rate
      }
    });
    await Promise.all(competitorPromises);
    
    // 5. Calculate competitor medians by service line
    console.log(`[PricingJob ${jobId}] Calculating competitor medians...`);
    const competitorMediansByService = new Map<string, number>();
    const allCompetitors = await storage.getCompetitors();
    
    const serviceLines = [...new Set(units.map(u => u.serviceLine).filter(Boolean))];
    for (const serviceLine of serviceLines) {
      const serviceLineCompetitors = allCompetitors.filter((c: any) => c.serviceLine === serviceLine);
      const rates = serviceLineCompetitors
        .map((c: any) => c.streetRate)
        .filter((r: number) => r > 0)
        .sort((a: number, b: number) => a - b);
      
      if (rates.length > 0) {
        const midIndex = Math.floor(rates.length / 2);
        const median = rates.length % 2 === 0
          ? (rates[midIndex - 1] + rates[midIndex]) / 2
          : rates[midIndex];
        competitorMediansByService.set(serviceLine, median);
      } else {
        competitorMediansByService.set(serviceLine, 3500); // Default
      }
    }
    
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
      if (unit.campus && !demandHistoryCache.has(unit.campus)) {
        demandHistoryCache.set(unit.campus, defaultDemandHistory);
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
      serviceLineOccupancy.set(serviceLine, total > 0 ? occupied / total : 0);
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
    
    const buildTime = Date.now() - startTime;
    console.log(`[PricingJob ${jobId}] Pricing context built in ${buildTime}ms with:
      - ${weightsCache.size} location+service weights
      - ${locationWeightsCache.size} location weights  
      - ${competitorsByLocationService.size} competitor groups
      - ${trilogyCareLevel2Cache.size} care level 2 rates
      - ${competitorMediansByService.size} competitor medians
      - ${demandHistoryCache.size} demand histories
      - ${serviceLineOccupancy.size} occupancy rates`);
    
    return {
      weightsCache,
      locationWeightsCache,
      globalWeights,
      competitorsByLocationService,
      trilogyCareLevel2Cache,
      competitorMediansByService,
      demandHistoryCache,
      inquiryMetricsCache,
      serviceLineOccupancy,
      guardrailsData,
      stockMarketChange,
      activeRules,
      targetMonth
    };
  }
  
  private async processJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      console.error(`[PricingJob ${jobId}] Job not found in map`);
      return;
    }
    
    try {
      console.log(`[PricingJob ${jobId}] Starting processing...`);
      job.status = 'processing';
      this.processingJobs.add(jobId);
      
      const startTime = Date.now();
      const { month } = job.params;
      const targetMonth = month || '2025-10';
      
      // Initialize cache once for all batches
      console.log(`[PricingJob ${jobId}] Initializing attribute pricing cache for month: ${targetMonth}`);
      await ensureCacheInitialized(targetMonth);
      
      // Get all units for the month
      console.log(`[PricingJob ${jobId}] Fetching units for month: ${targetMonth}`);
      const units = await storage.getRentRollDataByMonth(targetMonth);
      const totalUnits = units.length;
      
      console.log(`[PricingJob ${jobId}] Total units to process: ${totalUnits}`);
      
      // Calculate total batches
      const totalBatches = Math.ceil(totalUnits / this.BATCH_SIZE);
      
      // Update job progress with actual counts
      this.updateProgress(jobId, 0, totalUnits, 0, totalBatches);
      
      // Build pricing context with all pre-fetched data (MAJOR OPTIMIZATION)
      const pricingContext = await this.buildPricingContext(units, targetMonth, jobId);
      
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
      
      // Bulk update database with all results
      console.log(`[PricingJob ${jobId}] Updating database with ${allUpdates.length} pricing calculations...`);
      if (allUpdates.length > 0) {
        await storage.bulkUpdateModuloRates(allUpdates);
      }
      
      // Regenerate rate card
      console.log(`[PricingJob ${jobId}] Regenerating rate card for month: ${targetMonth}`);
      await storage.generateRateCard(targetMonth);
      
      // Mark job as completed - ensure progress is 100%
      const processingTime = Date.now() - startTime;
      
      // Set final progress to 100% before marking complete
      this.updateProgress(jobId, totalUnits, totalUnits, totalBatches, totalBatches);
      
      job.status = 'completed';
      job.completedAt = new Date();
      job.result = {
        totalUnits,
        totalUpdated: allUpdates.length,
        processingTimeMs: processingTime
      };
      
      console.log(`[PricingJob ${jobId}] Completed! Processed ${totalUnits} units in ${processingTime}ms (${(processingTime / 1000).toFixed(2)}s)`);
      
    } catch (error) {
      console.error(`[PricingJob ${jobId}] Error:`, error);
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.completedAt = new Date();
    } finally {
      this.processingJobs.delete(jobId);
      
      // Clean up old jobs after 1 hour
      setTimeout(() => {
        this.jobs.delete(jobId);
        console.log(`[PricingJob ${jobId}] Cleaned up job from memory`);
      }, 60 * 60 * 1000);
    }
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
    
    // Import competitor adjustments module once
    const { calculateAdjustedCompetitorRate } = await import('./services/competitorAdjustments');
    
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
        const daysVacant = unit.daysVacant || 0;
        const monthIndex = new Date(context.targetMonth).getMonth() + 1;
        
        // Get competitor prices from cache (O(1) lookups, NO async DB calls)
        let competitorPrices: number[] = [];
        
        // Use cached median
        const serviceLineMedian = context.competitorMediansByService.get(unit.serviceLine);
        if (serviceLineMedian) {
          competitorPrices.push(serviceLineMedian);
        }
        
        // Get cached competitor and care level data (NO async DB calls)
        if (unit.campus && unit.serviceLine) {
          const cacheKey = `${unit.campus}|${unit.serviceLine}`;
          const cachedCompetitors = context.competitorsByLocationService.get(cacheKey);
          const cachedCareLevel2 = context.trilogyCareLevel2Cache.get(cacheKey);
          
          if (cachedCompetitors && cachedCompetitors.length > 0) {
            // Get top competitor from cached data
            const topCompetitor = cachedCompetitors
              .filter((c: any) => c.streetRate > 0)
              .sort((a: any, b: any) => (b.weight || 0) - (a.weight || 0))[0];
            
            if (topCompetitor && topCompetitor.streetRate > 0) {
              // Calculate adjusted rate using cached data (synchronous now!)
              const adjustmentResult = calculateAdjustedCompetitorRate({
                competitorBaseRate: topCompetitor.streetRate,
                competitorCareLevel2Rate: topCompetitor.careLevel2Rate,
                competitorMedicationManagementFee: topCompetitor.medicationManagementFee,
                trilogyCareLevel2Rate: cachedCareLevel2
              });
              
              if (adjustmentResult.adjustedRate > 0) {
                competitorPrices.push(adjustmentResult.adjustedRate);
              }
            }
          }
        }
        
        if (competitorPrices.length === 0) {
          competitorPrices = [3500]; // Default fallback
        }
        
        // Get demand data from cache (O(1) lookup)
        const demandHistory = context.demandHistoryCache.get(unit.campus) || [45, 42, 48, 50, 43, 46];
        const inquiryMetric = context.inquiryMetricsCache.get(unit.campus);
        const demandCurrent = inquiryMetric ? 
          (inquiryMetric.inquiries || 0) + (inquiryMetric.tours || 0) : 
          (unit.inquiryCount || 0) + (unit.tourCount || 0);
        
        const pricingInputs: PricingInputs = {
          occupancy: serviceLineOcc,
          daysVacant,
          monthIndex,
          competitorPrices,
          marketReturn: context.stockMarketChange / 100,
          demandCurrent,
          demandHistory,
          serviceLine: unit.serviceLine
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
          finalRate: orchestratorResult.finalPrice,
          moduloRate: orchestratorResult.moduloRate,
          appliedRules: [],
          signals: orchestratorResult.moduloDetails.signals,
          blendedSignal: orchestratorResult.moduloDetails.blendedSignal,
          explanation: generateOverallExplanation(orchestratorResult.moduloDetails, pricingInputs),
          guardrailsApplied: orchestratorResult.guardrailsApplied
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