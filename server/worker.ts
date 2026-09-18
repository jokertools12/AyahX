import { closePool } from './db';
import { ensureRenderJobsTable } from './db/migrations/addRenderJobsTable';
import { renderJobQueue, startDedicatedRenderWorker } from './services/renderJobQueue';
import { logger } from './logger';

async function main() {
  await ensureRenderJobsTable();
  await renderJobQueue.recoverStaleJobs();
  startDedicatedRenderWorker();
}

main().catch((error) => {
  logger.error('Render worker failed to start:', error);
  process.exitCode = 1;
});

async function shutdown(signal: string) {
  logger.info(`Render worker received ${signal}; shutting down gracefully.`);
  renderJobQueue.shutdown();
  await closePool().catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
