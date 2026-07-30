import { db } from '../db';
import { competitorRateJobs, rentRollData, competitiveSurveyData } from '@shared/schema';
import { eq, and, isNull, gt, desc, sql, or } from 'drizzle-orm';
import { buildCompetitorRateUpdate } from './competitorRateSanitizer';

const BATCH_SIZE = 500;
const JOB_CHECK_INTERVAL = 5000; // 5 seconds

// Plausibility guard: monthly rates above this threshold are treated as corrupt
// and skipped rather than written to the DB.  The highest legitimate survey rate
// observed is ~$33k/month for a VIL Two-Bedroom; $50k gives a comfortable margin
// while still catching runaway values like the historic $375M Romeo - 2512 bug.

interface JobProgress {
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
}

// Service line mapping for matching based on Competitive Survey Mapping document
// Maps Trilogy service lines to competitor survey types
// Survey data has: AL, HC, SMC, IL_IL, IL_Villa competitor types
const SERVICE_LINE_MAPPING: Record<string, string[]> = {
  'AL': ['AL'],           // AL → AL
  'AL/MC': ['AL'],        // AL/MC → AL (not SMC, per mapping doc)
  'HC': ['HC'],           // HC → HC
  'HC/MC': ['SMC'],       // HC/MC → SMC
  'SL': ['IL_IL'],        // SL → IL_IL (Independent Living apartments)
  'VIL': ['IL_Villa']     // VIL → IL_Villa (Independent Living villas)
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
 * @param uploadMonth - The month to process (e.g. '2025-11')
 * @param clientId - Optional: when provided, only that client's data is processed
 */
export async function createCompetitorRateJob(uploadMonth: string, clientId?: string): Promise<string> {
  // Check for existing running job for this month (and same clientId scope)
  const existingJob = await db.select()
    .from(competitorRateJobs)
    .where(and(
      eq(competitorRateJobs.uploadMonth, uploadMonth),
      clientId
        ? eq(competitorRateJobs.clientId, clientId)
        : isNull(competitorRateJobs.clientId),
      or(
        eq(competitorRateJobs.status, 'pending'),
        eq(competitorRateJobs.status, 'running')
      )
    ))
    .limit(1);

  if (existingJob.length > 0) {
    console.log(`[CompetitorJob] Existing job found for ${uploadMonth}${clientId ? ` (client: ${clientId})` : ''}, returning job ID: ${existingJob[0].id}`);
    return existingJob[0].id;
  }

  // Count total units for this month (scoped to clientId when provided)
  const unitCountConditions = clientId
    ? and(eq(rentRollData.uploadMonth, uploadMonth), eq(rentRollData.clientId, clientId))
    : eq(rentRollData.uploadMonth, uploadMonth);

  const unitCount = await db.select({ count: sql<number>`count(*)::int` })
    .from(rentRollData)
    .where(unitCountConditions);

  const totalUnits = unitCount[0]?.count || 0;

  // Create new job
  const [newJob] = await db.insert(competitorRateJobs)
    .values({
      uploadMonth,
      clientId: clientId || null,
      status: 'pending',
      totalUnits,
      processedUnits: 0,
      updatedUnits: 0,
      skippedUnits: 0,
      errorCount: 0,
    })
    .returning();

  console.log(`[CompetitorJob] Created new job ${newJob.id} for ${uploadMonth}${clientId ? ` (client: ${clientId})` : ' (all clients)'} with ${totalUnits} units`);
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

  // Build base conditions - always filter by uploadMonth, optionally by clientId
  const baseConditions = job.clientId
    ? and(eq(rentRollData.uploadMonth, job.uploadMonth), eq(rentRollData.clientId, job.clientId))
    : eq(rentRollData.uploadMonth, job.uploadMonth);

  // Build query to get next batch of units
  let query = db.select()
    .from(rentRollData)
    .where(baseConditions)
    .orderBy(rentRollData.id)
    .limit(BATCH_SIZE);

  // Resume from last processed ID if available
  if (job.lastProcessedId) {
    const resumeConditions = job.clientId
      ? and(
          eq(rentRollData.uploadMonth, job.uploadMonth),
          eq(rentRollData.clientId, job.clientId),
          gt(rentRollData.id, job.lastProcessedId)
        )
      : and(
          eq(rentRollData.uploadMonth, job.uploadMonth),
          gt(rentRollData.id, job.lastProcessedId)
        );

    query = db.select()
      .from(rentRollData)
      .where(resumeConditions)
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

        // Plausibility guard via shared sanitizer.  Pass the MONTHLY rate so the
        // limit (50 000 $/month) is applied consistently regardless of service line.
        // When implausible the sanitizer returns NULLs — this clears any corrupt
        // value already stored (e.g. the historic $375M Romeo - 2512 row) rather
        // than leaving it.
        const sanitized = buildCompetitorRateUpdate(finalRateMonthly, {
          competitorName: matchedCompetitor.competitorName,
          competitorBaseRate: baseRate,
          competitorFinalRate: finalRate,
          competitorCareLevel2Adjustment: careAdjustmentStored,
          competitorMedManagementAdjustment: medMgmtStored,
          competitorWeight: matchedCompetitor.weight || null,
        });

        if (!sanitized.plausible) {
          console.warn(
            `[CompetitorJob] Implausible rate for unit ${unit.id} ` +
            `(${unit.location} / ${serviceLine} / ${unit.roomType}): ` +
            `${sanitized.reason} — clearing competitor fields`
          );
        }

        // Always write (valid fields or NULLs) so stale corrupt values are cleared.
        await db.update(rentRollData)
          .set(sanitized.update)
          .where(eq(rentRollData.id, unit.id));

        if (sanitized.plausible) progress.updated++;
        else progress.skipped++;
      } else {
        progress.skipped++;
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

  // Mark job as running and fetch the job row to read clientId and other fields
  const [currentJobRow] = await db.update(competitorRateJobs)
    .set({ 
      status: 'running',
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(competitorRateJobs.id, jobId))
    .returning();

  if (!currentJobRow) {
    console.error(`[CompetitorJob] Job ${jobId} not found, cannot process`);
    return;
  }

  // Load competitive survey data into memory for fast lookup
  // For each location+type+roomType, keep the best competitor (by weight, then distance)
  const jobClientId = currentJobRow.clientId;
  console.log(`[CompetitorJob] Loading competitive survey data${jobClientId ? ` (scoped to client: ${jobClientId})` : ' (all clients)'}...`);

  // When the job is scoped to a client, only fetch that client's survey data
  const allSurveyRecords = jobClientId
    ? await db.select().from(competitiveSurveyData).where(eq(competitiveSurveyData.clientId, jobClientId))
    : await db.select().from(competitiveSurveyData);

  // Determine the most recent surveyMonth per clientId so stale months cannot
  // override a fresh upload from the same client.
  const latestMonthPerClient = new Map<string, string>();
  for (const record of allSurveyRecords) {
    const cid = record.clientId || 'demo';
    const existing = latestMonthPerClient.get(cid);
    if (!existing || record.surveyMonth > existing) {
      latestMonthPerClient.set(cid, record.surveyMonth);
    }
  }

  const surveyRecords = allSurveyRecords.filter(record => {
    const cid = record.clientId || 'demo';
    return record.surveyMonth === latestMonthPerClient.get(cid);
  });

  console.log(`[CompetitorJob] Most recent survey months per client: ${JSON.stringify(Object.fromEntries(latestMonthPerClient))}`);
  console.log(`[CompetitorJob] Filtered to ${surveyRecords.length} records from ${allSurveyRecords.length} total (latest month only)`);

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
 * @param uploadMonth - The month to process (e.g. '2025-11')
 * @param clientId - Optional: when provided, only that client's data is processed
 */
export async function startCompetitorRateJob(uploadMonth: string, clientId?: string): Promise<{ jobId: string; status: string }> {
  const jobId = await createCompetitorRateJob(uploadMonth, clientId);
  
  // Start processing in background
  setImmediate(() => {
    processJob(jobId).catch(err => {
      console.error(`[CompetitorJob] Error processing job ${jobId}:`, err);
    });
  });

  return { jobId, status: 'started' };
}
