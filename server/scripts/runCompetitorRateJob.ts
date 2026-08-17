/**
 * Drive the resumable competitor-rate batch job to completion.
 *
 * Prefer this over `server/runCompetitorMatching.ts` for full-month reprocessing:
 * this path loads the survey data into memory once and persists a cursor
 * (`competitor_rate_jobs.last_processed_id`), so an interrupted run resumes
 * where it stopped instead of starting over.
 *
 *   npx tsx server/scripts/runCompetitorRateJob.ts <upload-month> <client-id>
 *   npx tsx server/scripts/runCompetitorRateJob.ts 2026-07 trilogy
 *
 * Re-run the same command after an interruption — it picks up the existing
 * `running` job for that month/client rather than creating a duplicate.
 */
import { db, pool } from '../db';
import { competitorRateJobs } from '@shared/schema';
import { and, eq, desc } from 'drizzle-orm';
import { createCompetitorRateJob, processJob } from '../services/competitorRateJobService';

async function main() {
  const [uploadMonth, clientId] = process.argv.slice(2);

  if (!uploadMonth || !clientId) {
    console.error('Usage: npx tsx server/scripts/runCompetitorRateJob.ts <upload-month> <client-id>');
    process.exit(1);
  }

  // Resume an interrupted run for this exact month/client before creating a new
  // job — otherwise each retry starts from zero and leaves orphan `running` rows.
  const [existing] = await db.select()
    .from(competitorRateJobs)
    .where(and(
      eq(competitorRateJobs.uploadMonth, uploadMonth),
      eq(competitorRateJobs.clientId, clientId),
      eq(competitorRateJobs.status, 'running'),
    ))
    .orderBy(desc(competitorRateJobs.createdAt))
    .limit(1);

  let jobId: string;
  if (existing) {
    jobId = existing.id;
    console.log(`↻ Resuming job ${jobId} (processed ${existing.processedUnits}/${existing.totalUnits})`);
  } else {
    jobId = await createCompetitorRateJob(uploadMonth, clientId);
    console.log(`▶ Created job ${jobId} for ${uploadMonth} / ${clientId}`);
  }

  // processJob takes an advisory lock and returns immediately if another worker
  // (a second CLI run, or the server's resumeInterruptedJobs on boot) already
  // owns this job, so this is safe to run concurrently.
  await processJob(jobId);

  const [final] = await db.select()
    .from(competitorRateJobs)
    .where(eq(competitorRateJobs.id, jobId))
    .limit(1);

  console.log(`Status: ${final?.status} — processed ${final?.processedUnits}/${final?.totalUnits}, updated ${final?.updatedUnits}, errors ${final?.errorCount}`);

  if (final?.status !== 'completed') return 2;

  // The job records per-unit failures and still finishes; surface them so an
  // automated run cannot report success with units left unwritten.
  if ((final.errorCount ?? 0) > 0) {
    console.error(`❌ ${final.errorCount} unit(s) errored during the run — treating as failure.`);
    return 3;
  }
  return 0;
}

main()
  .then(async (code) => {
    process.exitCode = code;
    await pool.end();
  })
  .catch(async (err) => {
    console.error('❌ Fatal:', err);
    process.exitCode = 1;
    await pool.end().catch(() => {});
  });
