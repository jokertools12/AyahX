import express from 'express';
import cors from 'cors';
import compression from 'compression';
import fs from 'fs';
import path from 'path';

import { config } from './config';
import { logger, requestLogger } from './logger';
import { authenticateToken } from './middleware/auth';
import { pingDatabase, closePool } from './db';

import authRouter from './routes/auth';
import videosRouter from './routes/videos';
import usersRouter from './routes/users';
import subscriptionsRouter from './routes/subscriptions';
import achievementsRouter from './routes/achievements';
import socialRouter from './routes/social';
import adminRouter from './routes/admin';
import servicesRouter from './routes/services';
import renderJobsRouter from './routes/renderJobs';
import quranRouter from './routes/quran';
import videoTranscodeRouter from './routes/videoTranscode';




import { ensureRenderJobsTable } from './db/migrations/addRenderJobsTable';
import { ensurePlanEntitlementSchema } from './db/migrations/ensurePlanEntitlementSchema';
import { ensureSettingsTable } from './services/settingsService';
import { renderJobQueue } from './services/renderJobQueue';
import { prometheusMetrics } from './services/renderObservability';

const app = express();
let isShuttingDown = false;

// Railway terminates TLS before the app. Trust exactly that proxy hop so
// req.ip is the real client address without trusting client-supplied headers
// on direct connections. Development remains unproxied by default.
const configuredProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS || '', 10);
app.set('trust proxy', config.isProd ? (Number.isFinite(configuredProxyHops) && configuredProxyHops >= 1 ? configuredProxyHops : 1) : false);

// 1. Disable X-Powered-By to prevent framework information disclosure
app.disable('x-powered-by');

// 2. HTTP response compression (gzip / deflate with media stream exclusion)
app.use(
  compression({
    threshold: 1024, // Only compress responses above 1KB
    filter: (req, res) => {
      if (req.path.includes('/video-proxy')) {
        return false;
      }
      return compression.filter(req, res);
    },
  })
);

// 3. Standard OWASP HTTP Security Headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (config.isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// 4. Controlled CORS configuration
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || !config.isProd || config.corsOrigin.includes(origin) || config.corsOrigin.includes('*')) {
        callback(null, true);
      } else {
        callback(new Error('Blocked by CORS policy'));
      }
    },
    credentials: true,
  })
);

// 5. Request correlation ID & Structured HTTP Access Logging
app.use(requestLogger);

// 6. Reject new requests during graceful shutdown
app.use((_req, res, next) => {
  if (isShuttingDown) {
    res.setHeader('Connection', 'close');
    return res.status(503).json({ error: 'الخادم في مرحلة إيقاف التشغيل المؤقت (Server is shutting down)' });
  }
  next();
});

app.use(express.raw({
  type: ['video/webm', 'video/mp4', 'application/octet-stream'],
  limit: '200mb',
}));
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));


// Global JWT authentication middleware
app.use(authenticateToken);

// ==============================================================================
// Health Checks & Operability Probes (Liveness, Readiness, Diagnostics)
// ==============================================================================

/**
 * Liveness Probe: Verifies the Node process is running and responding.
 */
app.get('/api/health/live', (_req, res) => {
  res.json({ status: 'alive', uptime: Math.floor(process.uptime()) });
});

/**
 * Readiness Probe: Verifies database connectivity before routing user traffic.
 */
app.get('/api/health/ready', async (_req, res) => {
  const dbPing = await pingDatabase();
  if (dbPing.ok) {
    return res.json({ status: 'ready', database: 'connected', latencyMs: dbPing.latencyMs });
  }
  return res.status(503).json({
    status: 'not_ready',
    database: 'disconnected',
    message: config.isProd ? 'Database connectivity unavailable' : dbPing.error,
  });
});

/**
 * Comprehensive System Health & Diagnostics Endpoint
 */
app.get('/api/health', async (_req, res) => {
  const dbPing = await pingDatabase();
  const memory = process.memoryUsage();

  const healthData = {
    status: dbPing.ok ? 'ok' : 'degraded',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
    version: '1.0.0',
    memory: {
      rssMb: Math.round(memory.rss / (1024 * 1024)),
      heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
      heapTotalMb: Math.round(memory.heapTotal / (1024 * 1024)),
    },
    checks: {
      database: {
        status: dbPing.ok ? 'connected' : 'disconnected',
        latencyMs: dbPing.latencyMs,
        ...(dbPing.ok ? {} : { message: config.isProd ? 'Database connection check failed' : dbPing.error }),
      },
    },
  };

  const statusCode = dbPing.ok ? 200 : 503;
  res.status(statusCode).json(healthData);
});

// Prometheus-compatible metrics. Protect this route at the reverse proxy in
// production (internal network or monitoring-token policy).
app.get('/internal/metrics', async (_req, res) => {
  const metricsToken = process.env.METRICS_TOKEN;
  if (config.isProd && (!metricsToken || _req.header('authorization') !== `Bearer ${metricsToken}`)) {
    return res.status(401).send('Unauthorized');
  }
  res.setHeader('Content-Type', 'text/plain; version=0.0.4');
  res.send(await prometheusMetrics());
});

// ==============================================================================
// Mount Application Routers
// ==============================================================================
app.use('/api/auth', authRouter);
app.use('/api/videos', videoTranscodeRouter);
app.use('/api/videos', videosRouter);

app.use('/api/users', usersRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/achievements', achievementsRouter);
app.use('/api/social', socialRouter);
app.use('/api/admin', adminRouter);
app.use('/api/services', servicesRouter);
app.use('/api/render-jobs', renderJobsRouter);
app.use('/api/quran', quranRouter);

// 404 Catch-all for undefined API endpoints
app.use('/api', (_req, res) => {
  return res.status(404).json({ error: 'المسار المطلوب غير موجود (Endpoint not found)' });
});

// In production Railway runs one public web service. Serve the compiled Vite
// application from that same origin so browser requests to /api remain
// same-origin and no second frontend service or CORS proxy is required.
// The existence check keeps local API-only/test runs working when dist is not
// present yet.
const staticDir = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(path.join(staticDir, 'index.html'))) {
  app.use(express.static(staticDir, { index: false, maxAge: config.isProd ? '1h' : 0 }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/internal')) return next();
    return res.sendFile(path.join(staticDir, 'index.html'));
  });
}

// Centralized Express Error Handling Middleware (safe JSON error output with correlation ID)
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const requestId = (req as any).requestId;
  logger.error('Unhandled server error caught by middleware', err, {
    requestId,
    path: req.originalUrl || req.url,
    method: req.method,
  });

  if (res.headersSent) return;

  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({
      error: 'صيغة البيانات المرسلة غير صالحة (Malformed JSON payload)',
      requestId,
    });
  }

  const statusCode = typeof err.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
  return res.status(statusCode).json({
    error: config.isProd ? 'حدث خطأ داخلي في الخادم' : (err.message || 'حدث خطأ داخلي في الخادم'),
    requestId,
  });
});

// Process-level unhandled exception guards
process.on('unhandledRejection', (reason) => {
  logger.error('CRITICAL: Unhandled Promise Rejection at process level', reason as Error);
});

process.on('uncaughtException', (err) => {
  logger.error('CRITICAL: Uncaught Exception at process level', err);
});

// ==============================================================================
// HTTP Server Start & Graceful Shutdown Orchestration
// ==============================================================================
export const server = app.listen(config.port, () => {
  logger.info(`🚀 Quran Reels MySQL Backend Server running on port ${config.port}`, {
    port: config.port,
    environment: config.nodeEnv,
  });

  // Ensure render_jobs and system_settings tables are initialized
  Promise.all([
    ensureRenderJobsTable().then(() => renderJobQueue.recoverStaleJobs()),
    ensurePlanEntitlementSchema(),
    ensureSettingsTable(),
  ]).catch((err) => {
    logger.warn('Startup database initialization deferred (database may still be starting):', err.message);
  });
});

export async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.warn(`Received ${signal}. Initiating graceful shutdown...`);

  // Abort any active rendering jobs to free Chromium and FFmpeg processes immediately
  try {
    renderJobQueue.shutdown();
  } catch (e) {
    logger.warn('Error shutting down renderJobQueue:', e);
  }

  server.close(async (err) => {
    if (err) {
      logger.error('Error closing HTTP server:', err);
      process.exit(1);
    }
    logger.info('HTTP server closed. Draining database connection pool...');
    try {
      await closePool();
      logger.info('Database connection pool drained cleanly. Shutdown complete.');
      process.exit(0);
    } catch (dbErr) {
      logger.error('Error draining database connection pool:', dbErr as Error);
      process.exit(1);
    }
  });

  // Force shutdown if in-flight connections do not drain within 10 seconds
  setTimeout(() => {
    logger.error('Graceful shutdown timed out after 10s. Forcing process exit.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
