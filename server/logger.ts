import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, any>;
  requestId?: string;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export type ErrorMonitoringHook = (error: Error, context?: Record<string, any>) => void;

const LOG_LEVEL_PRIORITIES: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentMinLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const isProd = process.env.NODE_ENV === 'production';
const errorHooks: ErrorMonitoringHook[] = [];

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
  const errStr = entry.error?.stack ? `\n${entry.error.stack}` : '';

  return `${entry.timestamp} ${colorMap[entry.level]}${reqStr} ${entry.message}${contextStr}${errStr}`;
}

function writeLog(level: LogLevel, message: string, context?: Record<string, any>, error?: Error): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    context,
    requestId: context?.requestId,
  };

  if (error) {
    entry.error = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  const formatted = formatLogEntry(entry);

  if (level === 'error') {
    console.error(formatted);
    for (const hook of errorHooks) {
      try {
        hook(error || new Error(message), context);
      } catch (hookErr) {
        console.error('Error in monitoring hook:', hookErr);
      }
    }
  } else if (level === 'warn') {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, any>) => writeLog('debug', message, context),
  info: (message: string, context?: Record<string, any>) => writeLog('info', message, context),
  warn: (message: string, context?: Record<string, any>) => writeLog('warn', message, context),
  error: (message: string, error?: Error | any, context?: Record<string, any>) => {
    const err = error instanceof Error ? error : error ? new Error(String(error)) : undefined;
    writeLog('error', message, context, err);
  },
};

/**
 * Express middleware for request correlation IDs and HTTP request logging.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();

  // Attach requestId to request and response header
  (req as any).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  // Skip spamming logs with frequent liveness polling
  const isLivenessPoll = req.path === '/api/health/live';

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const statusCode = res.statusCode;
    const level: LogLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

    if (isLivenessPoll && level === 'info') {
      return; // Do not spam logs on healthy liveness probes
    }

    const logData = {
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      status: statusCode,
      durationMs,
      contentLength: res.getHeader('content-length') || 0,
      ip: req.ip || req.socket.remoteAddress,
      userId: (req as any).user?.userId,
    };

    logger[level](`${req.method} ${req.originalUrl || req.url} ${statusCode} - ${durationMs}ms`, logData);
  });

  next();
}
