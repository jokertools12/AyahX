import { closePool } from './db';
import { ensureRenderJobsTable } from './db/migrations/addRenderJobsTable';
import { renderJobQueue, startDedicatedRenderWorker } from './services/renderJobQueue';
import { logger } from './logger';
import { activeRenderChildCount, stopAllRenderChildren, waitForRenderChildren } from './services/renderChildRunner';
import { config } from './config';
import type { Worker } from 'bullmq';

let dedicatedWorker: Worker | null = null;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let shuttingDown = false;

async function main() {
  await ensureRenderJobsTable();
  await renderJobQueue.recoverStaleJobs();
  dedicatedWorker = startDedicatedRenderWorker();
  await renderJobQueue.reconcileQueuedJobs();
  reconcileTimer = setInterval(() => {
    renderJobQueue.reconcileQueuedJobs().catch((error) => logger.warn('Render queue reconciliation failed:', error));
  }, 15_000);
  reconcileTimer.unref?.();
}

main().catch((error) => {
  logger.error('Render worker failed to start:', error);
  process.exitCode = 1;
});

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Render worker received ${signal}; shutting down gracefully.`);
  if (reconcileTimer) clearInterval(reconcileTimer);
  // Pause first so this replica never claims more jobs while it drains.
  await dedicatedWorker?.pause(true).catch((error) => logger.warn('Could not pause BullMQ worker during drain:', error));
  const configuredDrainSeconds = Number(process.env.RAILWAY_DEPLOYMENT_DRAINING_SECONDS || 300);
  const graceMs = Math.max(10_000, (Number.isFinite(configuredDrainSeconds) ? configuredDrainSeconds : 300) * 1000 - 10_000);
  const drained = await waitForRenderChildren(graceMs);
  if (!drained) {
    logger.warn(`Drain window expired with ${activeRenderChildCount()} render child(ren); requeueing their durable jobs.`);
    stopAllRenderChildren();
    await waitForRenderChildren(10_000);
    await renderJobQueue.releaseDrainingWorkerJobs(config.queue.workerId).catch((error) => logger.warn('Could not release draining worker jobs:', error));
  }
  renderJobQueue.shutdown();
  await dedicatedWorker?.close(!drained).catch((error) => logger.warn('Could not close BullMQ worker:', error));
  await closePool().catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
