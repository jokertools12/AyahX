import { acquireMysqlAdvisoryLock, closePool, releaseMysqlAdvisoryLock } from './db';
import { ensureRenderJobsTable } from './db/migrations/addRenderJobsTable';
import { logger } from './logger';
import { renderJobQueue } from './services/renderJobQueue';
import { renderAutoscalerIntervalMs, runRenderAutoscalerTick } from './services/renderAutoscaler';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitForLeader(lockName: string) {
  while (true) {
    const connection = await acquireMysqlAdvisoryLock(lockName);
    if (connection) return connection;
    logger.warn('Render control leader is still draining elsewhere; retrying the advisory lock in 5 seconds.');
    await delay(5_000);
  }
}

/**
 * Durable control-plane process. It does not render media; it only repairs
 * the MySQL -> BullMQ handoff and reclaims leases after worker loss.
 */
async function main(): Promise<void> {
  const lockName = process.env.RENDER_CONTROL_LEADER_LOCK || 'ayahx-render-control-leader-v1';
  const leaderConnection = await waitForLeader(lockName);
  await ensureRenderJobsTable();
  await renderJobQueue.recoverStaleJobs(true);
  await renderJobQueue.reconcileQueuedJobs();
  await runRenderAutoscalerTick().catch((error) => logger.warn('Render autoscaler initial check failed:', error));

  const reconcileTimer = setInterval(() => {
    renderJobQueue.reconcileQueuedJobs().catch((error) => {
      logger.warn('Render control reconciliation failed:', error);
    });
  }, 15_000);
  const recoveryTimer = setInterval(() => {
    renderJobQueue.recoverStaleJobs(true).catch((error) => {
      logger.warn('Render control recovery failed:', error);
    });
  }, 30_000);
  const cleanupTimer = setInterval(() => {
    renderJobQueue.cleanupExpiredRenders().catch((error) => {
      logger.warn('Render control cleanup failed:', error);
    });
  }, 30 * 60_000);
  const autoscalerTimer = setInterval(() => {
    runRenderAutoscalerTick().catch((error) => logger.warn('Render autoscaler check failed:', error));
  }, renderAutoscalerIntervalMs());
  autoscalerTimer.unref?.();

  const shutdown = async (signal: string) => {
    logger.info('Render control received ' + signal + '; shutting down.');
    clearInterval(reconcileTimer);
    clearInterval(recoveryTimer);
    clearInterval(cleanupTimer);
    clearInterval(autoscalerTimer);
    renderJobQueue.shutdown();
    await releaseMysqlAdvisoryLock(leaderConnection, lockName).catch(() => {});
    await closePool().catch(() => {});
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

main().catch(async (error) => {
  logger.error('Render control failed to start:', error);
  await closePool().catch(() => {});
  process.exitCode = 1;
});
