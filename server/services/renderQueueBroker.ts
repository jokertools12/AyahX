import { Queue, Worker, JobsOptions, Job } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';
import { logger } from '../logger';
import {
  capacityPollIntervalMs,
  getRenderCapacity,
  getRenderMemoryProfile,
  resolveConcurrencySetting,
  resolveRenderWorkerEngine,
  RenderWorkerEngine,
} from './renderCapacity';

export type RenderQueueEngine = RenderWorkerEngine;

export const RENDER_QUEUE_NAMES: Record<RenderQueueEngine, string> = {
  ffmpeg_ass: 'quran-render-ffmpeg-v1',
  skia_canvas: 'quran-render-skia-v1',
  browser_cloud: 'quran-render-browser-v1',
};

let connection: IORedis | null = null;
const queues: Partial<Record<RenderQueueEngine, Queue>> = {};

export function resolveRenderQueueEngine(value: unknown): RenderQueueEngine {
  return resolveRenderWorkerEngine(typeof value === 'string' ? value : undefined);
}

function getConnection(): IORedis {
  if (!config.queue.redisUrl) throw new Error('REDIS_URL is required when RENDER_QUEUE_DRIVER=bullmq');
  if (!connection) {
    connection = new IORedis(config.queue.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true });
    connection.on('error', (error) => logger.error('Render queue Redis error:', error));
  }
  return connection;
}

export function getRenderQueue(engine: RenderQueueEngine = 'ffmpeg_ass'): Queue {
  const existing = queues[engine];
  if (existing) return existing;

  const queue = new Queue(RENDER_QUEUE_NAMES[engine], {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 15_000 },
      removeOnComplete: { age: 86_400, count: 10_000 },
      removeOnFail: { age: 604_800, count: 10_000 },
    },
  });
  queues[engine] = queue;
  return queue;
}

export async function enqueueRenderJob(
  jobId: string,
  engine: RenderQueueEngine = 'ffmpeg_ass',
  priority = 0,
): Promise<Job> {
  const options: JobsOptions = { jobId, priority, attempts: 3 };
  return getRenderQueue(engine).add('render', { jobId, engine }, options);
}

function engineMaxConcurrency(engine: RenderQueueEngine): number {
  const prefix = engine === 'ffmpeg_ass' ? 'FFMPEG' : engine === 'skia_canvas' ? 'SKIA' : 'BROWSER';
  return resolveConcurrencySetting(
    process.env[`${prefix}_RENDER_MAX_CONCURRENCY`] || process.env.RENDER_MAX_CONCURRENCY,
    config.queue.workerConcurrency,
  );
}

export function startRenderWorker(
  processJob: (jobId: string, engine: RenderQueueEngine) => Promise<void>,
  requestedEngine?: RenderQueueEngine,
): Worker {
  const engine = resolveRenderQueueEngine(requestedEngine || process.env.RENDER_WORKER_ENGINE);
  const maxConcurrency = engineMaxConcurrency(engine);
  let activeJobs = 0;
  const initialCapacity = getRenderCapacity(0, maxConcurrency, engine);
  const initialConcurrency = initialCapacity.targetConcurrency;
  let lastReportedConcurrency = initialConcurrency;
  const profile = getRenderMemoryProfile(engine);

  const worker = new Worker(
    RENDER_QUEUE_NAMES[engine],
    async (job) => {
      const jobEngine = resolveRenderQueueEngine(job.data?.engine || engine);
      if (jobEngine !== engine) {
        throw new Error(`Render queue engine mismatch: worker=${engine}, job=${jobEngine}`);
      }
      await processJob(String(job.data.jobId), jobEngine);
    },
    {
      connection: getConnection(),
      concurrency: initialConcurrency,
      lockDuration: 30 * 60 * 1000,
      stalledInterval: 30 * 1000,
    },
  );

  const refreshConcurrency = () => {
    const capacity = getRenderCapacity(activeJobs, maxConcurrency, engine);
    const nextConcurrency = Math.max(activeJobs, capacity.targetConcurrency);
    if (worker.concurrency !== nextConcurrency) worker.concurrency = nextConcurrency;
    if (nextConcurrency !== lastReportedConcurrency) {
      lastReportedConcurrency = nextConcurrency;
      logger.info(
        `Render capacity adjusted: engine=${engine}, concurrency=${nextConcurrency}, active=${activeJobs}, ` +
        `cpu=${capacity.cpuCores}, memoryAvailableMb=${Math.round(capacity.availableBytes / (1024 * 1024))}, ` +
        `memoryPerJobMb=${Math.round(capacity.memoryPerJobBytes / (1024 * 1024))}, ` +
        `memoryReserveMb=${Math.round(capacity.memoryReserveBytes / (1024 * 1024))}`,
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
  worker.on('failed', (job, error) => logger.error(`BullMQ ${engine} render job failed [${job?.id}]`, error));
  worker.on('error', (error) => logger.error(`BullMQ ${engine} render worker error:`, error));
  logger.info(
    `BullMQ ${engine} render worker ${config.queue.workerId} started with dynamic concurrency ` +
    `${initialConcurrency} (max ${maxConcurrency}), ` +
    `memoryPerJobMb=${profile.memoryPerJobMb}, memoryReserveMb=${profile.memoryReserveMb}, ` +
    `queue=${RENDER_QUEUE_NAMES[engine]}`,
  );
  return worker;
}

export async function closeRenderQueue(): Promise<void> {
  await Promise.all(Object.values(queues).filter(Boolean).map((queue) => queue!.close()));
  await connection?.quit();
  for (const engine of Object.keys(queues) as RenderQueueEngine[]) delete queues[engine];
  connection = null;
}
