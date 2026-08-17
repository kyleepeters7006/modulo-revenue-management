import { pricingJobManager } from '/home/runner/workspace/server/pricingJobManager';

async function runFor(clientId: string) {
  const jobId = pricingJobManager.createJob({ clientId });
  console.log(`Started job ${jobId} for ${clientId}`);
  while (true) {
    await new Promise(r => setTimeout(r, 5000));
    const job = pricingJobManager.getJob(jobId)!;
    console.log(`[${clientId}] ${job.status} ${job.progress.percentage}% (${job.progress.current}/${job.progress.total})`);
    if (job.status === 'completed' || job.status === 'failed') {
      if (job.status === 'failed') throw new Error(`Job failed: ${job.error}`);
      return;
    }
  }
}

(async () => {
  await runFor('trilogy');
  await runFor('demo');
  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
