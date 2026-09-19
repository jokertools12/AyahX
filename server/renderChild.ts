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
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGTERM', abort);
  process.once('SIGINT', abort);
  try {
    await renderJobQueue.processExternalJob(jobId, engine, controller.signal);
  } finally {
    process.removeListener('SIGTERM', abort);
    process.removeListener('SIGINT', abort);
  }
}

main().then(async () => {
  await closePool().catch(() => {});
}).catch(async (error) => {
  logger.error('Render child failed:', error);
  await closePool().catch(() => {});
  process.exitCode = 1;
});
