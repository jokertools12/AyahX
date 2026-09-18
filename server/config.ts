import dotenv from 'dotenv';
import path from 'path';

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
    connectionLimit: 15,
  },
  ai: {
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
    workerConcurrency: Math.max(1, parseInt(process.env.RENDER_WORKER_CONCURRENCY || process.env.MAX_CONCURRENT_RENDERS || '2', 10)),
    workerId: process.env.RENDER_WORKER_ID || `${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  },
  storage: {
    driver: process.env.OBJECT_STORAGE_DRIVER === 's3' ? 's3' : 'local',
    bucket: process.env.OBJECT_STORAGE_BUCKET || undefined,
    region: process.env.OBJECT_STORAGE_REGION || 'auto',
    endpoint: process.env.OBJECT_STORAGE_ENDPOINT || undefined,
    forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE === 'true',
    accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID || undefined,
    secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY || undefined,
    publicBaseUrl: process.env.OBJECT_STORAGE_PUBLIC_BASE_URL || undefined,
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
      geminiConfigured: Boolean(config.ai.geminiApiKey),
      lovableConfigured: Boolean(config.ai.lovableApiKey),
      openaiConfigured: Boolean(config.ai.openaiApiKey),
    },
    pexels: {
      configured: Boolean(config.pexels.apiKey),
    },
  };
}
