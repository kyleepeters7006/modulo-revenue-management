import { randomUUID } from 'crypto';
import { storage } from './storage';
import { db } from './db';
import { rentRollData } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import { calculateAttributedPrice, ensureCacheInitialized } from './pricingOrchestrator';
import type { RentRollData, Guardrails, PricingWeights } from '@shared/schema';
import type { PricingInputs } from './moduloPricingAlgorithm';
import { getSentenceExplanation, generateOverallExplanation } from './sentenceExplanations';

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
    
    // Start processing immediately but don't await
    setImmediate(() => this.processJob(jobId));
    
    return jobId;
  }
  
  getJob(jobId: string): PricingJob | undefined {
    return this.jobs.get(jobId);
  }
  
  private updateProgress(jobId: string, current: number, total: number, currentBatch: number, totalBatches: number) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.progress = {
        current,
        total,
        percentage: Math.round((current / total) * 100),
        currentBatch,
        totalBatches
      };
      
      // Log progress every 10% or every batch completion
      if (job.progress.percentage % 10 === 0 || current === total) {
        console.log(`[PricingJob ${jobId}] Progress: ${job.progress.percentage}% (${current}/${total} units, Batch ${currentBatch}/${totalBatches})`);
      }
    }
  }
  
  private async processJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;
    
    try {
      console.log(`[PricingJob ${jobId}] Starting processing...`);
      job.status = 'processing';
      this.processingJobs.add(jobId);
      
      const startTime = Date.now();
      const { month } = job.params;
      const targetMonth = month || '2025-10';
      
      // Initialize cache once for all batches
      console.log(`[PricingJob ${jobId}] Initializing cache for month: ${targetMonth}`);
      await ensureCacheInitialized(targetMonth);
      
      // Get all necessary data upfront (similar to original implementation)
      console.log(`[PricingJob ${jobId}] Fetching pricing configuration...`);
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
      
      // Fetch S&P 500 data
      console.log(`[PricingJob ${jobId}] Fetching market data...`);
      const { fetchSP500Data } = await import('./routes');
      const stockMarketChange = await fetchSP500Data();
      
      // Get all units for the month
      console.log(`[PricingJob ${jobId}] Fetching units for month: ${targetMonth}`);
      const units = await storage.getRentRollDataByMonth(targetMonth);
      const totalUnits = units.length;
      
      console.log(`[PricingJob ${jobId}] Total units to process: ${totalUnits}`);
      job.progress.total = totalUnits;
      
      // Calculate total batches
      const totalBatches = Math.ceil(totalUnits / this.BATCH_SIZE);
      job.progress.totalBatches = totalBatches;
      
      // Pre-compute shared data (similar to original)
      const seniorHousingServiceLines = ['AL', 'AL/MC', 'SL', 'VIL'];
      const allUnitsForOccupancy = units.filter(unit => {
        if (seniorHousingServiceLines.includes(unit.serviceLine || '')) {
          const roomNumber = unit.roomNumber || '';
          if (roomNumber.endsWith('/B') || roomNumber.endsWith('B')) {
            return false;
          }
        }
        return true;
      });
      
      // Pre-fetch all weights (optimization from original)
      console.log(`[PricingJob ${jobId}] Pre-fetching weights for all locations...`);
      const weightsCache = new Map<string, any>();
      const locationWeightsCache = new Map<string, any>();
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
      
      // Cache location-level weights
      for (const locationId of uniqueLocations) {
        const locationWeights = await storage.getWeightsByFilter(locationId, null);
        if (locationWeights) {
          locationWeightsCache.set(locationId, locationWeights);
        }
      }
      
      // Cache location+serviceLine-specific weights
      for (const combo of uniqueCombinations) {
        const [locationId, serviceLine] = combo.split('|');
        if (locationId && serviceLine) {
          const specificWeights = await storage.getWeightsByFilter(locationId, serviceLine);
          if (specificWeights) {
            weightsCache.set(combo, specificWeights);
          }
        }
      }
      
      // Helper function to get weights for a unit (from original)
      const getWeightsForUnit = (unit: RentRollData) => {
        if (!unit.locationId) return globalWeights;
        
        const key = unit.serviceLine ? `${unit.locationId}|${unit.serviceLine}` : null;
        
        if (key && weightsCache.has(key)) {
          return weightsCache.get(key);
        }
        
        if (locationWeightsCache.has(unit.locationId)) {
          return locationWeightsCache.get(unit.locationId);
        }
        
        return globalWeights;
      };
      
      // Calculate service line occupancy (from original)
      console.log(`[PricingJob ${jobId}] Calculating occupancy metrics...`);
      const serviceLineOccupancy: Record<string, number> = {};
      const serviceLineStats = await db.select({
        serviceLine: rentRollData.serviceLine,
        occupied: sql`SUM(CASE WHEN occupied_yn = true THEN 1 ELSE 0 END)`.as('occupied'),
        total: sql`COUNT(*)`.as('total')
      })
      .from(rentRollData)
      .where(eq(rentRollData.uploadMonth, targetMonth))
      .groupBy(rentRollData.serviceLine);
      
      for (const stats of serviceLineStats) {
        const serviceLine = stats.serviceLine || 'Unknown';
        const { occupied, total } = stats as { occupied: number; total: number };
        serviceLineOccupancy[serviceLine] = total > 0 ? occupied / total : 0;
      }
      
      // Calculate service line competitor medians (from original)
      console.log(`[PricingJob ${jobId}] Calculating competitor medians...`);
      const serviceLineMedians: Record<string, number> = {};
      const competitors = await storage.getCompetitors();
      
      for (const serviceLine of Object.keys(serviceLineOccupancy)) {
        const serviceLineCompetitors = competitors.filter(c => c.serviceLine === serviceLine);
        const rates = serviceLineCompetitors
          .map(c => c.streetRate)
          .filter(r => r > 0)
          .sort((a, b) => a - b);
        
        if (rates.length > 0) {
          const midIndex = Math.floor(rates.length / 2);
          serviceLineMedians[serviceLine] = rates.length % 2 === 0
            ? (rates[midIndex - 1] + rates[midIndex]) / 2
            : rates[midIndex];
        } else {
          serviceLineMedians[serviceLine] = 3500;
        }
      }
      
      // Process units in batches
      console.log(`[PricingJob ${jobId}] Starting batch processing (${totalBatches} batches of ${this.BATCH_SIZE} units)...`);
      const allUpdates: Array<{ id: string; moduloSuggestedRate: number; moduloCalculationDetails: string }> = [];
      
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += this.MAX_PARALLEL_BATCHES) {
        // Process up to MAX_PARALLEL_BATCHES in parallel
        const batchPromises = [];
        const endBatchIndex = Math.min(batchIndex + this.MAX_PARALLEL_BATCHES, totalBatches);
        
        for (let i = batchIndex; i < endBatchIndex; i++) {
          const startIdx = i * this.BATCH_SIZE;
          const endIdx = Math.min(startIdx + this.BATCH_SIZE, totalUnits);
          const batchUnits = units.slice(startIdx, endIdx);
          
          console.log(`[PricingJob ${jobId}] Processing batch ${i + 1}/${totalBatches} (units ${startIdx + 1}-${endIdx})...`);
          
          batchPromises.push(
            this.processBatch(
              batchUnits,
              {
                getWeightsForUnit,
                serviceLineOccupancy,
                serviceLineMedians,
                stockMarketChange,
                guardrailsData,
                activeRules,
                targetMonth
              }
            )
          );
        }
        
        // Wait for all parallel batches to complete
        const batchResults = await Promise.all(batchPromises);
        
        // Collect all updates
        for (const updates of batchResults) {
          allUpdates.push(...updates);
        }
        
        // Update progress
        const processedCount = Math.min(endBatchIndex * this.BATCH_SIZE, totalUnits);
        this.updateProgress(jobId, processedCount, totalUnits, endBatchIndex, totalBatches);
      }
      
      // Bulk update database with all results
      console.log(`[PricingJob ${jobId}] Updating database with ${allUpdates.length} pricing calculations...`);
      if (allUpdates.length > 0) {
        await storage.bulkUpdateModuloRates(allUpdates);
      }
      
      // Regenerate rate card
      console.log(`[PricingJob ${jobId}] Regenerating rate card for month: ${targetMonth}`);
      await storage.generateRateCard(targetMonth);
      
      // Mark job as completed
      const processingTime = Date.now() - startTime;
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
    context: any
  ): Promise<Array<{ id: string; moduloSuggestedRate: number; moduloCalculationDetails: string }>> {
    const updates = [];
    const { getWeightsForUnit, serviceLineOccupancy, serviceLineMedians, stockMarketChange, guardrailsData, targetMonth } = context;
    
    for (const unit of units) {
      try {
        const unitWeights = getWeightsForUnit(unit);
        if (!unitWeights || unitWeights.enableWeights === false) {
          continue; // Skip units with disabled weights
        }
        
        // Prepare pricing inputs (from original implementation)
        const serviceLineOcc = serviceLineOccupancy[unit.serviceLine] || 0.87;
        const daysVacant = unit.daysVacant || 0;
        const monthIndex = new Date(targetMonth).getMonth() + 1;
        
        // Get competitor prices
        let competitorPrices: number[] = [];
        const serviceLineMedian = serviceLineMedians[unit.serviceLine];
        if (serviceLineMedian) {
          competitorPrices.push(serviceLineMedian);
          
          // Try to get adjusted competitor rate
          try {
            const topCompetitor = await storage.getTopCompetitorByWeight(unit.campus, unit.serviceLine);
            const trilogyCareLevel2Rate = await storage.getTrilogyCareLevel2Rate(unit.campus, unit.serviceLine);
            
            if (topCompetitor && topCompetitor.streetRate > 0) {
              const adjustedRate = await (await import('./services/competitorAdjustments')).calculateAdjustedCompetitorRate(
                topCompetitor,
                trilogyCareLevel2Rate || 0
              );
              if (adjustedRate > 0) {
                competitorPrices.push(adjustedRate);
              }
            }
          } catch (err) {
            // Fallback to median
          }
        }
        
        if (competitorPrices.length === 0) {
          competitorPrices = [3500]; // Default fallback
        }
        
        // Get demand data
        const demandCurrent = (unit.inquiryCount || 0) + (unit.tourCount || 0);
        const demandHistory = [45, 42, 48, 50, 43, 46]; // Mock history
        
        const pricingInputs: PricingInputs = {
          occupancy: serviceLineOcc,
          daysVacant,
          monthIndex,
          competitorPrices,
          marketReturn: stockMarketChange / 100,
          demandCurrent,
          demandHistory,
          serviceLine: unit.serviceLine
        };
        
        // Calculate pricing
        const orchestratorResult = await calculateAttributedPrice(unit, unitWeights, pricingInputs, guardrailsData || undefined);
        
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
        
      } catch (error) {
        console.error(`Error processing unit ${unit.id}:`, error);
        // Continue with next unit
      }
    }
    
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