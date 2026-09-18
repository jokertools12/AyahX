import { Queue, Worker, JobsOptions, Job } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';
import { logger } from '../logger';
import { capacityPollIntervalMs, getRenderCapacity, resolveConcurrencySetting } from './renderCapacity';

export const RENDER_QUEUE_NAME = 'quran-render-v1';

let connection: IORedis | null = null;
let queue: Queue | null = null;

function getConnection(): IORedis {
  if (!config.queue.redisUrl) throw new Error('REDIS_URL is required when RENDER_QUEUE_DRIVER=bullmq');
  if (!connection) {
    connection = new IORedis(config.queue.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true });
    connection.on('error', (error) => logger.error('Render queue Redis error:', error));
  }
  return connection;
}

export function getRenderQueue(): Queue {
  if (!queue) queue = new Queue(RENDER_QUEUE_NAME, { connection: getConnection(), defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: { age: 86_400, count: 10_000 },
    removeOnFail: { age: 604_800, count: 10_000 },
  } });
  return queue;
}

export async function enqueueRenderJob(jobId: string, priority = 0): Promise<Job> {
  const options: JobsOptions = { jobId, priority, attempts: 3 };
  return getRenderQueue().add('render', { jobId }, options);
}

export function startRenderWorker(processJob: (jobId: string) => Promise<void>): Worker {
  const maxConcurrency = resolveConcurrencySetting(process.env.RENDER_MAX_CONCURRENCY, config.queue.workerConcurrency);
  let activeJobs = 0;
  let lastReportedConcurrency = config.queue.workerConcurrency;
  const worker = new Worker(RENDER_QUEUE_NAME, async (job) => {
    await processJob(String(job.data.jobId));
  }, { connection: getConnection(), concurrency: config.queue.workerConcurrency, lockDuration: 15 * 60 * 1000 });
  const refreshConcurrency = () => {
    const capacity = getRenderCapacity(activeJobs, maxConcurrency);
    const nextConcurrency = Math.max(activeJobs, capacity.targetConcurrency);
    if (worker.concurrency !== nextConcurrency) worker.concurrency = nextConcurrency;
    if (nextConcurrency !== lastReportedConcurrency) {
      lastReportedConcurrency = nextConcurrency;
      logger.info(
        `Render capacity adjusted: concurrency=${nextConcurrency}, active=${activeJobs}, ` +
        `cpu=${capacity.cpuCores}, memoryAvailableMb=${Math.round(capacity.availableBytes / (1024 * 1024))}`,
      );
    }
  };
  const capacityTimer = setInterval(refreshConcurrency, capacityPollIntervalMs());
  capacityTimer.unref?.();
  worker.on('active', () => {
    activeJobs += 1;
    refreshConcurrency();
  });
  const onJobFinished = () => {
    activeJobs = Math.max(0, activeJobs - 1);
    refreshConcurrency();
  };
  worker.on('completed', onJobFinished);
  worker.on('failed', onJobFinished);
  worker.on('closing', () => clearInterval(capacityTimer));
  worker.on('failed', (job, error) => logger.error(`BullMQ render job failed [${job?.id}]`, error));
  worker.on('error', (error) => logger.error('BullMQ render worker error:', error));
  logger.info(
    `BullMQ render worker ${config.queue.workerId} started with dynamic concurrency ` +
    `${config.queue.workerConcurrency} (max ${maxConcurrency})`,
  );
  return worker;
}

export async function closeRenderQueue(): Promise<void> {
  await queue?.close();
  await connection?.quit();
  queue = null;
  connection = null;
}
