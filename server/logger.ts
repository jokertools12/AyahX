import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { monitoringError, redactLogText, redactLogValue, serializeLogError, type SerializedLogError } from './logRedaction';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  requestId?: string;
  error?: SerializedLogError;
}

export type ErrorMonitoringHook = (error: Error, context?: Record<string, unknown>) => void;

const LOG_LEVEL_PRIORITIES: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentMinLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const isProd = process.env.NODE_ENV === 'production';
const errorHooks: ErrorMonitoringHook[] = [];
const responseErrors = new WeakMap<Response, unknown>();

/** Preserve a route's caught error for the finish log; never alters its response. */
export function attachResponseError(res: Response, error: unknown): void {
  responseErrors.set(res, error);
}

/**
 * Register an APM or error reporting hook (e.g. Sentry, Datadog, PostHog).
 */
export function registerErrorHook(hook: ErrorMonitoringHook): void {
  errorHooks.push(hook);
}

/**
 * Clear registered error hooks (useful for testing).
 */
export function clearErrorHooks(): void {
  errorHooks.length = 0;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITIES[level] >= LOG_LEVEL_PRIORITIES[currentMinLevel];
}

function formatLogEntry(entry: LogEntry): string {
  if (isProd) {
    return JSON.stringify(entry);
  }

  const colorMap: Record<LogLevel, string> = {
    debug: '\x1b[36m[DEBUG]\x1b[0m',
    info: '\x1b[32m[INFO]\x1b[0m',
    warn: '\x1b[33m[WARN]\x1b[0m',
    error: '\x1b[31m[ERROR]\x1b[0m',
  };

  const reqStr = entry.requestId ? ` (${entry.requestId.slice(0, 8)})` : '';
  const contextStr = entry.context && Object.keys(entry.context).length > 0 ? ` ${JSON.stringify(entry.context)}` : '';
  const errStr = entry.error ? ` ${JSON.stringify(entry.error)}` : '';

  return `${entry.timestamp} ${colorMap[entry.level]}${reqStr} ${entry.message}${contextStr}${errStr}`;
}

function writeLog(level: LogLevel, message: string, context?: Record<string, unknown>, error?: unknown): void {
  if (!shouldLog(level)) return;

  const safeContext = context ? redactLogValue(context) as Record<string, unknown> : undefined;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message: redactLogText(message),
    context: safeContext,
    requestId: typeof safeContext?.requestId === 'string' ? safeContext.requestId : undefined,
  };

  if (error !== undefined) entry.error = serializeLogError(error);

  const formatted = formatLogEntry(entry);

  if (level === 'error') {
    console.error(formatted);
    for (const hook of errorHooks) {
      try {
        hook(monitoringError(entry.error || { name: 'Error', message: entry.message }), safeContext);
      } catch (hookErr) {
        console.error(formatLogEntry({ timestamp: new Date().toISOString(), level: 'error', message: 'Error in monitoring hook', error: serializeLogError(hookErr) }));
      }
    }
  } else if (level === 'warn') {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => writeLog('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => writeLog('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => writeLog('warn', message, context),
  error: (message: string, error?: unknown, context?: Record<string, unknown>) => writeLog('error', message, context, error),
};

/**
 * Express middleware for request correlation IDs and HTTP request logging.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const suppliedId = req.headers['x-request-id'];
  const requestId = typeof suppliedId === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(suppliedId) ? suppliedId : crypto.randomUUID();
  const correlatedReq = req as Request & { requestId?: string; user?: { userId?: string } };

  // Attach requestId to request and response header
  correlatedReq.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  let responseError: SerializedLogError | undefined;
  if (typeof res.json === 'function') {
    const originalJson = res.json;
    res.json = function (body: unknown): Response {
      if (this.statusCode >= 400 && body && typeof body === 'object') {
        const payload = body as Record<string, unknown>;
        const nested = payload.error && typeof payload.error === 'object' ? payload.error as Record<string, unknown> : {};
        responseError = serializeLogError({ code: payload.code ?? nested.code,
          message: payload.message ?? nested.message ?? (typeof payload.error === 'string' ? payload.error : 'HTTP error response') });
      }
      return originalJson.call(this, body);
    };
  }

  // Skip spamming logs with frequent liveness polling
  const isLivenessPoll = req.path === '/api/health/live';

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const statusCode = res.statusCode;
    const level: LogLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    const logPath = (req.originalUrl || req.url).split(/[?#]/u)[0];

    if (isLivenessPoll && level === 'info') {
      return; // Do not spam logs on healthy liveness probes
    }

    const logData = {
      requestId,
      method: req.method,
      path: logPath,
      status: statusCode,
      durationMs,
      contentLength: res.getHeader('content-length') || 0,
      ip: req.ip || req.socket.remoteAddress,
      userId: correlatedReq.user?.userId,
    };

    const message = `${req.method} ${logPath} ${statusCode} - ${durationMs}ms`;
    if (level === 'error') {
      const caught = responseErrors.get(res);
      const original = caught !== undefined ? serializeLogError(caught) : undefined;
      const detail = original ? { ...original, ...(original.code === undefined && responseError?.code !== undefined ? { code: responseError.code } : {}) } : responseError;
      logger.error(message, detail, logData);
    } else {
      logger[level](message, responseError ? { ...logData, error: responseError } : logData);
    }
    responseErrors.delete(res);
  });

  next();
}
