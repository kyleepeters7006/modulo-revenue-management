import { db } from '../db';
import { competitorRateJobs, rentRollData, competitiveSurveyData } from '@shared/schema';
import { eq, and, isNull, gt, desc, sql, or } from 'drizzle-orm';

const BATCH_SIZE = 500;
const JOB_CHECK_INTERVAL = 5000; // 5 seconds

interface JobProgress {
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
}

// Service line mapping for matching based on Competitive Survey Mapping document
// Maps Trilogy service lines to competitor survey types
// Survey data has: AL, HC, SMC, IL competitor types
const SERVICE_LINE_MAPPING: Record<string, string[]> = {
  'AL': ['AL'],           // AL → AL
  'AL/MC': ['AL'],        // AL/MC → AL (not SMC, per mapping doc)
  'HC': ['HC'],           // HC → HC
  'HC/MC': ['SMC'],       // HC/MC → SMC
  'SL': ['IL'],           // SL → IL (Independent Living)
  'VIL': ['IL']           // VIL → IL (Independent Living)
};

// Care Level 2 applies only to HC and AL service lines
const CARE_LEVEL_2_APPLIES: Record<string, boolean> = {
  'HC': true,
  'HC/MC': true,
  'AL': true,
  'AL/MC': true,
  'SL': false,
  'VIL': false
};

// Medication Management applies only to AL service lines (Trilogy charges $0)
const MED_MGMT_APPLIES: Record<string, boolean> = {
  'HC': false,
  'HC/MC': false,
  'AL': true,
  'AL/MC': true,
  'SL': false,
  'VIL': false
};

// Trilogy's default Care Level 2 rate ($55/day)
const TRILOGY_CARE_LEVEL_2_DAILY = 55;

// Room type normalization
function normalizeRoomType(roomType: string): string {
  const normalized = (roomType || '').toLowerCase().trim();
  if (normalized.includes('studio dlx') || normalized.includes('deluxe')) return 'Studio Dlx';
  if (normalized.includes('studio')) return 'Studio';
  if (normalized.includes('one') || normalized.includes('1 bed')) return 'One Bedroom';
  if (normalized.includes('two') || normalized.includes('2 bed')) return 'Two Bedroom';
  if (normalized.includes('companion') || normalized.includes('semi')) return 'Companion';
  return roomType;
}

// Check if service line uses daily rates
function isDailyRateServiceLine(serviceLine: string | null): boolean {
  if (!serviceLine) return false;
  const upper = serviceLine.toUpperCase();
  return upper === 'HC' || upper === 'HC/MC';
}

// Convert monthly rate to daily for HC service lines
const DAYS_PER_MONTH = 30.44;
function convertToStoredRate(monthlyRate: number, serviceLine: string | null): number {
  if (isDailyRateServiceLine(serviceLine)) {
    return Math.round((monthlyRate / DAYS_PER_MONTH) * 100) / 100; // Daily rate with 2 decimal places
  }
  return monthlyRate; // Keep as monthly for AL, SL, VIL
}

/**
 * Create a new competitor rate job
 */
export async function createCompetitorRateJob(uploadMonth: string): Promise<string> {
  // Check for existing running job for this month
  const existingJob = await db.select()
    .from(competitorRateJobs)
    .where(and(
      eq(competitorRateJobs.uploadMonth, uploadMonth),
      or(
        eq(competitorRateJobs.status, 'pending'),
        eq(competitorRateJobs.status, 'running')
      )
    ))
    .limit(1);

  if (existingJob.length > 0) {
    console.log(`[CompetitorJob] Existing job found for ${uploadMonth}, returning job ID: ${existingJob[0].id}`);
    return existingJob[0].id;
  }

  // Count total units for this month
  const unitCount = await db.select({ count: sql<number>`count(*)::int` })
    .from(rentRollData)
    .where(eq(rentRollData.uploadMonth, uploadMonth));

  const totalUnits = unitCount[0]?.count || 0;

  // Create new job
  const [newJob] = await db.insert(competitorRateJobs)
    .values({
      uploadMonth,
      status: 'pending',
      totalUnits,
      processedUnits: 0,
      updatedUnits: 0,
      skippedUnits: 0,
      errorCount: 0,
    })
    .returning();

  console.log(`[CompetitorJob] Created new job ${newJob.id} for ${uploadMonth} with ${totalUnits} units`);
  return newJob.id;
}

/**
 * Get job status
 */
export async function getJobStatus(jobId: string) {
  const [job] = await db.select()
    .from(competitorRateJobs)
    .where(eq(competitorRateJobs.id, jobId))
    .limit(1);

  if (!job) return null;

  const totalUnits = job.totalUnits || 0;
  const processedUnits = job.processedUnits || 0;
  
  const progress = totalUnits > 0 
    ? Math.round((processedUnits / totalUnits) * 100) 
    : 0;

  return {
    ...job,
    progress,
    estimatedTimeRemaining: job.status === 'running' && processedUnits > 0
      ? Math.round(((totalUnits - processedUnits) / processedUnits) * 
          ((Date.now() - (job.startedAt?.getTime() || Date.now())) / 1000))
      : null
  };
}

/**
 * Get all jobs for a month
 */
export async function getJobsForMonth(uploadMonth: string) {
  return db.select()
    .from(competitorRateJobs)
    .where(eq(competitorRateJobs.uploadMonth, uploadMonth))
    .orderBy(desc(competitorRateJobs.createdAt));
}

/**
 * Process a single batch of units
 */
async function processBatch(
  job: typeof competitorRateJobs.$inferSelect,
  surveyData: Map<string, any>
): Promise<JobProgress> {
  const progress: JobProgress = { processed: 0, updated: 0, skipped: 0, errors: 0 };

  // Build query to get next batch of units
  let query = db.select()
    .from(rentRollData)
    .where(eq(rentRollData.uploadMonth, job.uploadMonth))
    .orderBy(rentRollData.id)
    .limit(BATCH_SIZE);

  // Resume from last processed ID if available
  if (job.lastProcessedId) {
    query = db.select()
      .from(rentRollData)
      .where(and(
        eq(rentRollData.uploadMonth, job.uploadMonth),
        gt(rentRollData.id, job.lastProcessedId)
      ))
      .orderBy(rentRollData.id)
      .limit(BATCH_SIZE);
  }

  const units = await query;

  if (units.length === 0) {
    return progress;
  }

  let lastProcessedId = job.lastProcessedId;

  for (const unit of units) {
    try {
      progress.processed++;
      lastProcessedId = unit.id;

      // Skip if unit already has competitor data
      if (unit.competitorName && unit.competitorFinalRate && unit.competitorFinalRate > 0) {
        progress.skipped++;
        continue;
      }

      // Find matching competitor data
      const location = unit.location || '';
      const serviceLine = unit.serviceLine || 'AL';
      const roomType = normalizeRoomType(unit.roomType || '');

      // Build survey key for lookup
      const surveyTypes = SERVICE_LINE_MAPPING[serviceLine] || [serviceLine];
      let matchedCompetitor = null;

      for (const surveyType of surveyTypes) {
        const key = `${location}|${surveyType}|${roomType}`;
        if (surveyData.has(key)) {
          matchedCompetitor = surveyData.get(key);
          break;
        }
      }

      if (!matchedCompetitor) {
        // Try broader match with just location and survey type
        for (const surveyType of surveyTypes) {
          surveyData.forEach((data, key) => {
            if (!matchedCompetitor && key.startsWith(`${location}|${surveyType}|`)) {
              matchedCompetitor = data;
            }
          });
          if (matchedCompetitor) break;
        }
      }

      if (matchedCompetitor) {
        // Get competitor type to determine if rates are daily or monthly in survey
        const competitorType = surveyTypes[0]; // First matching type
        const isHCOrSMC = competitorType === 'HC' || competitorType === 'SMC';
        
        // Survey data: HC/SMC rates are stored as DAILY, AL/IL rates are MONTHLY
        let baseRateMonthly = matchedCompetitor.monthlyRateAvg || 0;
        let competitorCareLevel2Monthly = matchedCompetitor.careLevel2Rate || 0;
        let competitorMedMgmtMonthly = matchedCompetitor.medicationManagementFee || 0;
        
        // Convert HC/SMC survey rates from daily to monthly for calculations
        if (isHCOrSMC && baseRateMonthly > 0 && baseRateMonthly < 1000) {
          baseRateMonthly = baseRateMonthly * DAYS_PER_MONTH;
          if (competitorCareLevel2Monthly > 0 && competitorCareLevel2Monthly < 500) {
            competitorCareLevel2Monthly = competitorCareLevel2Monthly * DAYS_PER_MONTH;
          }
          if (competitorMedMgmtMonthly > 0 && competitorMedMgmtMonthly < 100) {
            competitorMedMgmtMonthly = competitorMedMgmtMonthly * DAYS_PER_MONTH;
          }
        }
        
        // Calculate adjustments based on service line rules
        let careLevel2Adjustment = 0;
        let medMgmtAdjustment = 0;
        
        // Care Level 2 Adjustment (HC/AL only): Competitor - Trilogy ($55/day = $1674.20/month)
        if (CARE_LEVEL_2_APPLIES[serviceLine] && competitorCareLevel2Monthly > 0) {
          const trilogyCareLevel2Monthly = TRILOGY_CARE_LEVEL_2_DAILY * DAYS_PER_MONTH;
          careLevel2Adjustment = competitorCareLevel2Monthly - trilogyCareLevel2Monthly;
        }
        
        // Medication Management Adjustment (AL only): Competitor - Trilogy ($0)
        if (MED_MGMT_APPLIES[serviceLine] && competitorMedMgmtMonthly > 0) {
          medMgmtAdjustment = competitorMedMgmtMonthly; // Trilogy charges $0
        }
        
        // Final rate = Base + Care Level 2 Adjustment + Med Mgmt Adjustment
        const finalRateMonthly = baseRateMonthly + careLevel2Adjustment + medMgmtAdjustment;

        // Convert to stored rate format (daily for HC/HC-MC, monthly for others)
        const baseRate = convertToStoredRate(baseRateMonthly, serviceLine);
        const finalRate = convertToStoredRate(finalRateMonthly, serviceLine);
        const careAdjustmentStored = convertToStoredRate(careLevel2Adjustment, serviceLine);
        const medMgmtStored = convertToStoredRate(medMgmtAdjustment, serviceLine);

        await db.update(rentRollData)
          .set({
            competitorName: matchedCompetitor.competitorName,
            competitorBaseRate: baseRate,
            competitorFinalRate: finalRate,
            competitorCareLevel2Adjustment: careAdjustmentStored,
            competitorMedManagementAdjustment: medMgmtStored,
            competitorWeight: matchedCompetitor.weight || null,
          })
          .where(eq(rentRollData.id, unit.id));

        progress.updated++;
      }
    } catch (error) {
      progress.errors++;
      console.error(`[CompetitorJob] Error processing unit ${unit.id}:`, error);
    }
  }

  // Update job progress
  await db.update(competitorRateJobs)
    .set({
      processedUnits: sql`${competitorRateJobs.processedUnits} + ${progress.processed}`,
      updatedUnits: sql`${competitorRateJobs.updatedUnits} + ${progress.updated}`,
      skippedUnits: sql`${competitorRateJobs.skippedUnits} + ${progress.skipped}`,
      errorCount: sql`${competitorRateJobs.errorCount} + ${progress.errors}`,
      lastProcessedId,
      updatedAt: new Date(),
    })
    .where(eq(competitorRateJobs.id, job.id));

  return progress;
}

/**
 * Process a job to completion
 */
export async function processJob(jobId: string): Promise<void> {
  console.log(`[CompetitorJob] Starting job ${jobId}`);

  // Mark job as running
  await db.update(competitorRateJobs)
    .set({ 
      status: 'running',
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(competitorRateJobs.id, jobId));

  // Load competitive survey data into memory for fast lookup
  // For each location+type+roomType, keep the best competitor (by weight, then distance)
  console.log('[CompetitorJob] Loading competitive survey data...');
  const surveyRecords = await db.select().from(competitiveSurveyData);
  
  const surveyData = new Map<string, any>();
  for (const record of surveyRecords) {
    const key = `${record.keyStatsLocation}|${record.competitorType}|${record.roomType}`;
    
    // Extract weight from notes JSON if available
    let weight: number | null = null;
    if (record.notes) {
      try {
        const parsed = JSON.parse(record.notes);
        weight = parseFloat(parsed.weight);
        if (isNaN(weight)) weight = null;
      } catch { /* ignore */ }
    }
    
    const existingRecord = surveyData.get(key);
    if (!existingRecord) {
      surveyData.set(key, { ...record, weight });
    } else {
      // Keep the better competitor: higher weight wins, else closer distance
      const existingWeight = existingRecord.weight || 0;
      const newWeight = weight || 0;
      
      if (newWeight > existingWeight) {
        surveyData.set(key, { ...record, weight });
      } else if (newWeight === existingWeight) {
        // Same weight (or both null) - use closer distance
        const existingDist = existingRecord.distanceMiles || 999;
        const newDist = record.distanceMiles || 999;
        if (newDist < existingDist) {
          surveyData.set(key, { ...record, weight });
        }
      }
    }
  }
  console.log(`[CompetitorJob] Loaded ${surveyRecords.length} survey records, ${surveyData.size} unique location/type/room combinations`);

  try {
    let hasMoreUnits = true;
    let batchCount = 0;

    while (hasMoreUnits) {
      // Reload job to get current state (in case of resume)
      const [currentJob] = await db.select()
        .from(competitorRateJobs)
        .where(eq(competitorRateJobs.id, jobId))
        .limit(1);

      if (!currentJob || currentJob.status !== 'running') {
        console.log(`[CompetitorJob] Job ${jobId} is no longer running, stopping`);
        return;
      }

      const batchProgress = await processBatch(currentJob, surveyData);
      batchCount++;

      console.log(`[CompetitorJob] Batch ${batchCount}: processed=${batchProgress.processed}, updated=${batchProgress.updated}, skipped=${batchProgress.skipped}`);

      if (batchProgress.processed < BATCH_SIZE) {
        hasMoreUnits = false;
      }

      // Small delay between batches to prevent overload
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Mark job as completed
    await db.update(competitorRateJobs)
      .set({ 
        status: 'completed',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(competitorRateJobs.id, jobId));

    console.log(`[CompetitorJob] Job ${jobId} completed successfully`);
  } catch (error) {
    console.error(`[CompetitorJob] Job ${jobId} failed:`, error);
    
    await db.update(competitorRateJobs)
      .set({ 
        status: 'failed',
        errorDetails: error instanceof Error ? error.message : 'Unknown error',
        updatedAt: new Date(),
      })
      .where(eq(competitorRateJobs.id, jobId));
  }
}

/**
 * Resume any interrupted jobs
 */
export async function resumeInterruptedJobs(): Promise<void> {
  const interruptedJobs = await db.select()
    .from(competitorRateJobs)
    .where(eq(competitorRateJobs.status, 'running'));

  for (const job of interruptedJobs) {
    console.log(`[CompetitorJob] Resuming interrupted job ${job.id} for ${job.uploadMonth}`);
    // Process in background
    processJob(job.id).catch(err => {
      console.error(`[CompetitorJob] Error resuming job ${job.id}:`, err);
    });
  }
}

/**
 * Start a new job and process it in the background
 */
export async function startCompetitorRateJob(uploadMonth: string): Promise<{ jobId: string; status: string }> {
  const jobId = await createCompetitorRateJob(uploadMonth);
  
  // Start processing in background
  setImmediate(() => {
    processJob(jobId).catch(err => {
      console.error(`[CompetitorJob] Error processing job ${jobId}:`, err);
    });
  });

  return { jobId, status: 'started' };
}
