/**
 * Directly reruns the competitor rate job for 2026-07 (trilogy client)
 * using the existing job service. Bypasses HTTP auth.
 *
 * Usage: npx tsx scripts/rerun_comp_job.ts
 */
import { startCompetitorRateJob, getJobStatus } from '../server/services/competitorRateJobService.js';

const UPLOAD_MONTH = '2026-07';
const CLIENT_ID = 'trilogy';

async function main() {
  console.log(`[rerun_comp_job] Starting competitor rate job: ${UPLOAD_MONTH} / ${CLIENT_ID}`);

  // startCompetitorRateJob launches processJob via setImmediate (background),
  // so we need to wait for it to finish. We poll job status.
  const result = await startCompetitorRateJob(UPLOAD_MONTH, CLIENT_ID);
  console.log(`[rerun_comp_job] Job created: ${result.jobId} (${result.status})`);

  // Poll until done
  const start = Date.now();
  const TIMEOUT_MS = 10 * 60 * 1000; // 10 min
  let lastPct = -1;

  while (true) {
    await new Promise(r => setTimeout(r, 3000));
    const status = await getJobStatus(result.jobId);
    if (!status) { console.error('Job not found'); process.exit(1); }

    const pct = status.progress ?? 0;
    if (pct !== lastPct) {
      console.log(
        `[rerun_comp_job] ${status.status} — ${status.processedUnits}/${status.totalUnits} units (${pct}%)` +
        ` updated=${status.updatedUnits} skipped=${status.skippedUnits} errors=${status.errorCount}`
      );
      lastPct = pct;
    }

    if (status.status === 'completed') {
      console.log(`[rerun_comp_job] ✓ Completed in ${Math.round((Date.now() - start) / 1000)}s`);
      break;
    }
    if (status.status === 'failed') {
      console.error(`[rerun_comp_job] ✗ Failed: ${(status as any).errorDetails}`);
      process.exit(1);
    }
    if (Date.now() - start > TIMEOUT_MS) {
      console.error('[rerun_comp_job] Timed out after 10 minutes');
      process.exit(1);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
