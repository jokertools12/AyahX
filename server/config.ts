import dotenv from 'dotenv';
import path from 'path';
import { resolveConcurrencySetting } from './services/renderCapacity';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export interface AppConfig {
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
  isProd: boolean;
  corsOrigin: string[];
  jwtSecret: string;
  db: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    connectionLimit: number;
  };
  ai: {
    provider?: 'openrouter' | 'gemini' | 'lovable' | 'openai';
    openRouterApiKey?: string;
    openRouterTextModel?: string;
    openRouterTextFallbackModels?: string[];
    openRouterFreeOnly: boolean;
    geminiApiKey?: string;
    lovableApiKey?: string;
    openaiApiKey?: string;
  };
  pexels: {
    apiKey?: string;
  };
  queue: {
    driver: 'database' | 'bullmq';
    redisUrl?: string;
    workerConcurrency: number;
    workerId: string;
  };
  storage: {
    driver: 'local' | 's3';
    bucket?: string;
    region?: string;
    endpoint?: string;
    /**
     * S3-compatible providers differ in URL style. Railway Buckets use the
     * virtual-hosted style by default, so this must remain false there.
     */
    forcePathStyle: boolean;
    accessKeyId?: string;
    secretAccessKey?: string;
    publicBaseUrl?: string;
  };
}

type StorageEnvironment = Record<string, string | undefined>;

/**
 * Resolve the application's S3-compatible storage contract from environment
 * variables. OBJECT_STORAGE_* is the canonical contract; the R2_* aliases
 * keep the deployment guide's vocabulary usable without moving secrets into
 * tracked configuration. The caller still has to opt into `s3` explicitly.
 */
export function resolveStorageConfig(env: StorageEnvironment = process.env): AppConfig['storage'] {
  const value = (...names: string[]): string | undefined => {
    for (const name of names) {
      const candidate = env[name]?.trim();
      if (candidate) return candidate;
    }
    return undefined;
  };

  return {
    driver: env.OBJECT_STORAGE_DRIVER === 's3' ? 's3' : 'local',
    bucket: value('OBJECT_STORAGE_BUCKET', 'R2_BUCKET_NAME'),
    region: value('OBJECT_STORAGE_REGION', 'R2_REGION') || 'auto',
    endpoint: value('OBJECT_STORAGE_ENDPOINT', 'R2_ENDPOINT'),
    forcePathStyle: (value('OBJECT_STORAGE_FORCE_PATH_STYLE', 'R2_FORCE_PATH_STYLE') || 'false') === 'true',
    accessKeyId: value('OBJECT_STORAGE_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID'),
    secretAccessKey: value('OBJECT_STORAGE_SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY'),
    publicBaseUrl: value('OBJECT_STORAGE_PUBLIC_BASE_URL', 'R2_PUBLIC_DOMAIN'),
  };
}

export type StorageReadiness =
  | { ready: true; driver: 'local' | 's3' }
  | { ready: false; driver: 's3'; missing: Array<'bucket' | 'endpoint' | 'accessKeyId' | 'secretAccessKey'> };

/**
 * Readiness is deliberately structural: it never makes a network request or
 * exposes a credential. A cloud-backed deployment must fail closed before it
 * accepts a render that cannot be uploaded or downloaded by another replica.
 */
export function getStorageReadiness(storage: AppConfig['storage']): StorageReadiness {
  if (storage.driver === 'local') return { ready: true, driver: 'local' };
  const missing: Array<'bucket' | 'endpoint' | 'accessKeyId' | 'secretAccessKey'> = [];
  if (!storage.bucket) missing.push('bucket');
  // AWS S3 resolves its regional endpoint when one is not supplied. R2 and
  // other endpoint-based providers use path-style mode in this contract, so
  // keep the fail-closed check for those deployments.
  if (storage.forcePathStyle && !storage.endpoint) missing.push('endpoint');
  if (!storage.accessKeyId) missing.push('accessKeyId');
  if (!storage.secretAccessKey) missing.push('secretAccessKey');
  return missing.length ? { ready: false, driver: 's3', missing } : { ready: true, driver: 's3' };
}

const nodeEnv = (process.env.NODE_ENV || 'development') as 'development' | 'production' | 'test';
const isProd = nodeEnv === 'production';

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv,
  isProd,
  corsOrigin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
    : ['http://localhost:8080', 'http://localhost:5173', 'http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:8080', 'http://127.0.0.1:5173'],
  jwtSecret: process.env.JWT_SECRET || 'quran_reels_jwt_secret_key_2026_default',
  db: {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'quran_reels',
    connectionLimit: Math.max(2, parseInt(process.env.MYSQL_POOL_SIZE || '15', 10)),
  },
  ai: {
    provider: ['openrouter', 'gemini', 'lovable', 'openai'].includes((process.env.AI_PROVIDER || '').toLowerCase())
      ? process.env.AI_PROVIDER?.toLowerCase() as 'openrouter' | 'gemini' | 'lovable' | 'openai'
      : undefined,
    openRouterApiKey: process.env.OPENROUTER_API_KEY || undefined,
    openRouterTextModel: process.env.OPENROUTER_TEXT_MODEL || undefined,
    openRouterTextFallbackModels: process.env.OPENROUTER_TEXT_FALLBACK_MODELS
      ? process.env.OPENROUTER_TEXT_FALLBACK_MODELS.split(',').map((value) => value.trim()).filter(Boolean)
      : undefined,
    openRouterFreeOnly: process.env.OPENROUTER_FREE_ONLY !== 'false',
    geminiApiKey: process.env.GEMINI_API_KEY || undefined,
    lovableApiKey: process.env.LOVABLE_API_KEY || undefined,
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
  },
  pexels: {
    apiKey: process.env.PEXELS_API_KEY || process.env.VITE_PEXELS_API_KEY || undefined,
  },
  queue: {
    driver: process.env.RENDER_QUEUE_DRIVER === 'bullmq' ? 'bullmq' : 'database',
    redisUrl: process.env.REDIS_URL || undefined,
    // BullMQ workers use the per-engine cgroup governor in renderQueueBroker.
    // Keep this only as a local database-driver fallback; do not read the
    // retired global concurrency knobs in production.
    workerConcurrency: resolveConcurrencySetting(undefined),
    workerId: process.env.RENDER_WORKER_ID || `${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  },
  storage: {
    ...resolveStorageConfig(),
  },
};

/**
 * Returns a sanitized configuration object with secrets and passwords masked,
 * suitable for telemetry, diagnostics, and debugging.
 */
export function getSanitizedConfig(): Record<string, any> {
  return {
    port: config.port,
    nodeEnv: config.nodeEnv,
    isProd: config.isProd,
    corsOrigin: config.corsOrigin,
    jwtConfigured: Boolean(process.env.JWT_SECRET),
    db: {
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      passwordConfigured: Boolean(config.db.password),
      database: config.db.database,
      connectionLimit: config.db.connectionLimit,
    },
    ai: {
      provider: config.ai.provider || null,
      openRouterConfigured: Boolean(config.ai.openRouterApiKey),
      openRouterTextModel: config.ai.openRouterTextModel || null,
      openRouterFallbackCount: config.ai.openRouterTextFallbackModels?.length || 0,
      openRouterFreeOnly: config.ai.openRouterFreeOnly,
      geminiConfigured: Boolean(config.ai.geminiApiKey),
      lovableConfigured: Boolean(config.ai.lovableApiKey),
      openaiConfigured: Boolean(config.ai.openaiApiKey),
    },
    pexels: {
      configured: Boolean(config.pexels.apiKey),
    },
    storage: {
      driver: config.storage.driver,
      bucket: config.storage.bucket || null,
      endpointConfigured: Boolean(config.storage.endpoint),
      credentialsConfigured: Boolean(config.storage.accessKeyId && config.storage.secretAccessKey),
      publicBaseConfigured: Boolean(config.storage.publicBaseUrl),
    },
  };
}
