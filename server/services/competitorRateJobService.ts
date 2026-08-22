import { db, pool } from '../db';
import { competitorRateJobs, rentRollData, competitiveSurveyData, careLevelRates, locations } from '@shared/schema';
import { eq, and, isNull, gt, desc, sql, or } from 'drizzle-orm';
import { buildCompetitorRateUpdate } from './competitorRateSanitizer';
import { normalizeCompetitorCareRateMonthly, DAYS_PER_MONTH } from '@shared/careRates';
import { invalidateRefDataCache } from '../refDataCache';

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
  /** campusName → number of units that used the $55/day fallback care rate */
  fallbackCampuses: Map<string, number>;
}

// Service line mapping for matching based on Competitive Survey Mapping document
// Maps Trilogy service lines to competitor survey types
// Survey data has: AL, HC, SMC, IL_IL, IL_Villa competitor types
// Shared matching policy — MUST stay identical across all writers of the
// stored competitor columns. See competitorMatchPolicy.ts.
import { SURVEY_TYPE_CHAIN, roomTypeFallbackChain, isDailySurveyType, normalizeUnitRoomType, computeCompetitorAdjustments, formatAdjustmentExplanation } from './competitorMatchPolicy';
import { FALLBACK_CARE_LEVEL_2_DAILY } from './competitorMatchPolicy';
export { roomTypeFallbackChain, isDailySurveyType };

const SERVICE_LINE_MAPPING: Record<string, string[]> = SURVEY_TYPE_CHAIN;

// campusKey(clientId, locationName) -> Map<serviceLine, level2Rate (native basis:
// daily for HC lines, monthly for AL lines)>
type CareRateMap = Map<string, Map<string, number>>;
const campusCareKey = (clientId: string | null | undefined, location: string) =>
  `${clientId || 'demo'}||${location}`;

// Room type normalization
// Shared with all writers — see competitorMatchPolicy.normalizeUnitRoomType
// (includes Private → Studio and Semi-Private → Companion).
const normalizeRoomType = normalizeUnitRoomType;

// Check if service line uses daily rates
function isDailyRateServiceLine(serviceLine: string | null): boolean {
  if (!serviceLine) return false;
  const upper = serviceLine.toUpperCase();
  return upper === 'HC' || upper === 'HC/MC';
}

// Convert monthly rate to daily for HC service lines
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
      : null,
    // careRateFallbackCampuses: { [campusName]: unitCount } — campuses that used
    // the $55/day default because they have no care_level_rates entry. Null when
    // all campuses had real rates, or when the job is still running.
    careRateFallbackCampuses: (job.careRateFallbackCampuses as Record<string, number> | null) ?? null,
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
 * Process a single batch of units.
 *
 * @param accumulatedFallbacks  The fallback-campus map merged from all previous
 *   batches.  This batch's new fallbacks are merged in and then written to the DB
 *   in the same UPDATE that advances lastProcessedId, so the two are always
 *   atomically consistent — a mid-batch crash cannot advance the cursor while
 *   leaving the fallback counts behind.
 */
async function processBatch(
  job: typeof competitorRateJobs.$inferSelect,
  surveyData: Map<string, any>,
  careRateMap: CareRateMap,
  accumulatedFallbacks: Map<string, number>
): Promise<JobProgress> {
  const progress: JobProgress = { processed: 0, updated: 0, skipped: 0, errors: 0, fallbackCampuses: new Map() };

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

      // Build survey key for lookup. Room-type-specific first (exact room type
      // for the primary survey type), then the deterministic room-type fallback
      // chain, per survey type in priority order. There is deliberately NO
      // "any room type" fallback — a rate from an unrelated room type is a
      // spurious competitor benchmark (see roomTypeFallbackChain).
      const surveyTypes = SERVICE_LINE_MAPPING[serviceLine] || [serviceLine];
      const rtChain = roomTypeFallbackChain(roomType, serviceLine);
      let matchedCompetitor = null;

      // Room-type specificity outranks survey-type preference: a legacy-type
      // row for the RIGHT room type beats a dedicated-type row for a substitute.
      outer:
      for (const rt of rtChain) {
        for (const surveyType of surveyTypes) {
          // Survey map is keyed by TENANT first — an unscoped ("all clients")
          // job must never apply one tenant's survey row to another tenant's
          // units, even when campus names collide across tenants.
          const key = `${unit.clientId || 'demo'}|${location}|${surveyType}|${rt}`;
          if (surveyData.has(key)) {
            matchedCompetitor = surveyData.get(key);
            break outer;
          }
        }
      }

      if (matchedCompetitor) {
        // Get competitor type to determine if rates are daily or monthly in survey.
        // Use the ACTUALLY MATCHED record's type, not the first candidate type —
        // an HC/MC unit can fall back to a legacy SMC row, whose rates are daily.
        const competitorType = matchedCompetitor.competitorType;
        const isHCOrSMC = isDailySurveyType(competitorType);
        
        // Survey data: HC/SMC rates are stored as DAILY, AL/IL rates are MONTHLY
        let baseRateMonthly = matchedCompetitor.monthlyRateAvg || 0;
        // Use ?? null (not || 0) so that a surveyed $0 (all-inclusive competitor)
        // and a null (unsurveyed) remain distinguishable all the way to
        // computeCompetitorAdjustments. A || 0 would collapse both to 0, and
        // the > 0 gate would then drop all-inclusive competitors silently.
        let competitorCareLevel2Monthly: number | null = matchedCompetitor.careLevel2Rate ?? null;
        let competitorMedMgmtMonthly = matchedCompetitor.medicationManagementFee || 0;
        
        // Care basis is resolved independently of the street-rate basis, via the
        // same shared helper the recalculation writer and /api/competitors use.
        // The HC care column mixes bases row by row, so the old
        // `< 500 -> scale up` test (and gating it on the base rate) turned a
        // genuinely monthly $200 into $6,088/mo here — the principal stored-rate
        // writer — while other surfaces read the same row differently. Values
        // that are not credible on either basis come back null and yield no care
        // adjustment instead of an inflated one.
        // normalizeCompetitorCareRateMonthly(null, ...) → null (preserves "no data")
        // normalizeCompetitorCareRateMonthly(0, ...) → 0 (preserves "all-inclusive")
        if (isHCOrSMC) {
          competitorCareLevel2Monthly =
            normalizeCompetitorCareRateMonthly(competitorCareLevel2Monthly, 'HC');
        }

        // Convert HC/SMC survey rates from daily to monthly for calculations
        if (isHCOrSMC && baseRateMonthly > 0 && baseRateMonthly < 1000) {
          baseRateMonthly = baseRateMonthly * DAYS_PER_MONTH;
          if (competitorMedMgmtMonthly > 0 && competitorMedMgmtMonthly < 100) {
            competitorMedMgmtMonthly = competitorMedMgmtMonthly * DAYS_PER_MONTH;
          }
        }
        
        // Adjustments via the SHARED policy math (care resolution incl.
        // memory-care inheritance, native-basis conversion, $55/day fallback,
        // med mgmt) — identical to the recalculation path.
        const adjResult = computeCompetitorAdjustments(
            serviceLine,
            competitorCareLevel2Monthly,
            competitorMedMgmtMonthly,
            careRateMap.get(campusCareKey(unit.clientId, location))
          );
        const { careLevel2Adjustment, medMgmtAdjustment, usedCareFallback } = adjResult;
        if (usedCareFallback) {
          progress.fallbackCampuses.set(
            location,
            (progress.fallbackCampuses.get(location) ?? 0) + 1
          );
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

        // Always write (valid fields or NULLs) so stale corrupt values are
        // cleared — including the legacy competitorRate column and the shared
        // adjustment explanation, mirroring the recalculation path exactly.
        await db.update(rentRollData)
          .set({
            ...sanitized.update,
            competitorRate: sanitized.update.competitorFinalRate,
            competitorAdjustmentExplanation: sanitized.plausible
              ? formatAdjustmentExplanation(baseRateMonthly, adjResult)
              : null,
          })
          .where(eq(rentRollData.id, unit.id));

        if (sanitized.plausible) progress.updated++;
        else progress.skipped++;
      } else {
        // No survey match — explicitly CLEAR any stale competitor fields so a
        // unit whose survey coverage disappeared does not keep serving an old
        // rate. Mirrors the recalculation path (processAllUnitsForCompetitorRates),
        // which always writes NULLs on no match.
        await db.update(rentRollData)
          .set({
            competitorName: null,
            competitorBaseRate: null,
            competitorFinalRate: null,
            competitorWeight: null,
            competitorCareLevel2Adjustment: null,
            competitorMedManagementAdjustment: null,
            competitorRate: null,
            competitorAdjustmentExplanation: null,
          })
          .where(eq(rentRollData.id, unit.id));
        progress.skipped++;
      }
    } catch (error) {
      progress.errors++;
      console.error(`[CompetitorJob] Error processing unit ${unit.id}:`, error);
    }
  }

  // Merge this batch's fallback campuses into the running accumulator
  Array.from(progress.fallbackCampuses.entries()).forEach(([campus, count]) => {
    accumulatedFallbacks.set(campus, (accumulatedFallbacks.get(campus) ?? 0) + count);
  });

  // Update job progress AND careRateFallbackCampuses in a SINGLE atomic write.
  // Both lastProcessedId (cursor) and the fallback JSON are committed together so
  // a crash between them cannot advance the cursor while leaving fallback data
  // behind (which would cause an under-count on resume).
  const mergedFallbacksForDb = accumulatedFallbacks.size > 0
    ? Object.fromEntries(accumulatedFallbacks)
    : null;
  await db.update(competitorRateJobs)
    .set({
      processedUnits: sql`${competitorRateJobs.processedUnits} + ${progress.processed}`,
      updatedUnits: sql`${competitorRateJobs.updatedUnits} + ${progress.updated}`,
      skippedUnits: sql`${competitorRateJobs.skippedUnits} + ${progress.skipped}`,
      errorCount: sql`${competitorRateJobs.errorCount} + ${progress.errors}`,
      lastProcessedId,
      careRateFallbackCampuses: mergedFallbacksForDb,
      updatedAt: new Date(),
    })
    .where(eq(competitorRateJobs.id, job.id));

  return progress;
}

/**
 * Namespace for the per-job Postgres advisory lock. Arbitrary but stable, so
 * these locks cannot collide with an advisory lock taken anywhere else.
 */
const JOB_LOCK_NAMESPACE = 0x636f6d70; // 'comp'

/**
 * Take an exclusive, session-scoped advisory lock for a job.
 *
 * Two workers can legitimately reach the same job at once: the CLI runner
 * (`server/scripts/runCompetitorRateJob.ts`) resumes any job left in `running`,
 * and the server calls `resumeInterruptedJobs()` on boot. Without a lock both
 * read the same cursor, write the same units twice and double-increment the
 * progress counters. The lock lives on a dedicated pooled connection, so if the
 * process dies the lock is released automatically — no stale-lease bookkeeping.
 */
async function acquireJobLock(jobId: string): Promise<{ release: () => Promise<void> } | null> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      'SELECT pg_try_advisory_lock($1::int, hashtext($2)::int) AS locked',
      [JOB_LOCK_NAMESPACE, jobId],
    );
    if (!res.rows[0]?.locked) {
      client.release();
      return null;
    }
    return {
      release: async () => {
        try {
          await client.query(
            'SELECT pg_advisory_unlock($1::int, hashtext($2)::int)',
            [JOB_LOCK_NAMESPACE, jobId],
          );
        } catch (err) {
          console.error(`[CompetitorJob] Failed to release advisory lock for ${jobId}:`, err);
        } finally {
          client.release();
        }
      },
    };
  } catch (err) {
    client.release();
    throw err;
  }
}

/**
 * Process a job to completion.
 *
 * Guarded so that a concurrent worker already processing this job is a no-op
 * rather than a duplicate run.
 */
export async function processJob(jobId: string): Promise<void> {
  const lock = await acquireJobLock(jobId);
  if (!lock) {
    console.warn(`[CompetitorJob] Job ${jobId} is already being processed by another worker — skipping duplicate run`);
    return;
  }
  try {
    await processJobLocked(jobId);
  } finally {
    await lock.release();
  }
}

async function processJobLocked(jobId: string): Promise<void> {
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
    // Tenant-scoped key: identical campus/room-type names across clients must
    // never overwrite each other (cross-tenant isolation for unscoped jobs).
    const key = `${record.clientId || 'demo'}|${record.keyStatsLocation}|${record.competitorType}|${record.roomType}`;
    
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

  // Load our actual per-campus Care Level 2 rates (joined to locations for the
  // campus name, which is how rent-roll rows reference their campus).
  const careConditions = jobClientId ? eq(careLevelRates.clientId, jobClientId) : undefined;
  const careRows = await db.select({
    clientId: careLevelRates.clientId,
    locationName: locations.name,
    serviceLine: careLevelRates.serviceLine,
    level2Rate: careLevelRates.level2Rate,
  })
    .from(careLevelRates)
    .innerJoin(locations, eq(careLevelRates.locationId, locations.id))
    .where(careConditions);

  const careRateMap: CareRateMap = new Map();
  for (const row of careRows) {
    if (row.level2Rate == null || !Number.isFinite(Number(row.level2Rate))) continue;
    const key = campusCareKey(row.clientId, row.locationName);
    if (!careRateMap.has(key)) careRateMap.set(key, new Map());
    careRateMap.get(key)!.set(row.serviceLine, Number(row.level2Rate));
  }
  console.log(`[CompetitorJob] Loaded care level 2 rates for ${careRateMap.size} campuses`);

  // Accumulate fallback campuses across all batches: campusName → unit count.
  // Seed from any value already persisted (handles resume after server restart —
  // batches processed before the restart are already in the DB).
  const fallbackCampusAccumulator = new Map<string, number>();
  const existingFallbacks = currentJobRow.careRateFallbackCampuses as Record<string, number> | null;
  if (existingFallbacks) {
    Object.entries(existingFallbacks).forEach(([campus, count]) => {
      fallbackCampusAccumulator.set(campus, count);
    });
    console.log(`[CompetitorJob] Resumed with ${fallbackCampusAccumulator.size} previously-recorded fallback campus(es)`);
  }

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

      // processBatch merges fallbacks into fallbackCampusAccumulator and writes
      // both the cursor (lastProcessedId) and the merged fallback JSON in a single
      // atomic DB UPDATE — see processBatch for the atomicity guarantee.
      const batchProgress = await processBatch(currentJob, surveyData, careRateMap, fallbackCampusAccumulator);
      batchCount++;

      console.log(`[CompetitorJob] Batch ${batchCount}: processed=${batchProgress.processed}, updated=${batchProgress.updated}, skipped=${batchProgress.skipped}`);

      if (batchProgress.processed < BATCH_SIZE) {
        hasMoreUnits = false;
      }

      // Small delay between batches to prevent overload
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Log fallback campus summary
    if (fallbackCampusAccumulator.size > 0) {
      const sortedFallbacks = Array.from(fallbackCampusAccumulator.entries())
        .sort((a, b) => b[1] - a[1]);
      console.log(
        `[CompetitorJob] ${fallbackCampusAccumulator.size} campus(es) used the $${FALLBACK_CARE_LEVEL_2_DAILY}/day care rate fallback ` +
        `(no care_level_rates entry). These campuses need a care_level_rates row:\n` +
        sortedFallbacks.map(([campus, count]) => `  • ${campus}: ${count} unit(s)`).join('\n')
      );
    } else {
      console.log(`[CompetitorJob] All campuses have care_level_rates entries — no fallback rate was used.`);
    }

    // careRateFallbackCampuses was already written after the final batch; just
    // update status/timestamps to mark completion without overwriting it.
    // Mark job as completed
    await db.update(competitorRateJobs)
      .set({ 
        status: 'completed',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(competitorRateJobs.id, jobId));

    // Invalidate the reference-data cache so rate card and comp-variance views
    // immediately reflect the updated competitor_final_rate values written above.
    // Without this, cached aggregations from before the job ran would continue
    // serving stale rates for up to the cache TTL.
    invalidateRefDataCache();
    console.log(`[CompetitorJob] Job ${jobId} completed successfully — ref-data cache invalidated`);
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
