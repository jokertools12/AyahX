import { closePool } from './db';
import { ensureRenderJobsTable } from './db/migrations/addRenderJobsTable';
import { renderJobQueue } from './services/renderJobQueue';
import { resolveRenderQueueEngine } from './services/renderQueueBroker';
import { logger } from './logger';

async function main() {
  const jobId = process.argv[2];
  const engine = resolveRenderQueueEngine(process.argv[3]);
  if (!jobId) throw new Error('Render child requires a job id');
  await ensureRenderJobsTable();
  await renderJobQueue.processExternalJob(jobId, engine);
}

main().then(async () => {
  await closePool().catch(() => {});
}).catch(async (error) => {
  logger.error('Render child failed:', error);
  await closePool().catch(() => {});
  process.exitCode = 1;
});

