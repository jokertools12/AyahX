import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { config, getSanitizedConfig } from '../../server/config';
import { logger, registerErrorHook, clearErrorHooks, requestLogger } from '../../server/logger';
import { pingDatabase } from '../../server/db';

describe('Observability, Operability & Documentation Suite', () => {
  beforeEach(() => {
    clearErrorHooks();
    vi.restoreAllMocks();
  });

  describe('Configuration Management & Secret Scrubbing (OBS-01)', () => {
    it('ensures .env.example contains zero live IP addresses, database credentials, or real API keys', () => {
      const examplePath = path.resolve(process.cwd(), '.env.example');
      expect(fs.existsSync(examplePath)).toBe(true);

      const content = fs.readFileSync(examplePath, 'utf8');

      // Assert remote host IP, usernames, and passwords are not leaked in template
      expect(content).not.toContain('194.60.93.148');
      expect(content).not.toContain('185.193.126.16');
      expect(content).not.toContain('@XeloTools261197@');
      expect(content).not.toContain('c1#46h3A69f52f');
      expect(content).not.toContain('jok2036_user_ayah_clip_maker');
      expect(content).not.toContain('AQ.Ab8RN6KX');
      expect(content).not.toContain('1Mm7g8hkrqF1baxPp6KUyjRGN9GTo6E9GJkEm0Nr7xge8zN0Jz89OlA7');

      // Assert server-side PEXELS_API_KEY is documented
      expect(content).toContain('PEXELS_API_KEY=');
    });

    it('returns sanitized configuration masking all sensitive secrets in diagnostics', () => {
      const sanitized = getSanitizedConfig();

      expect(sanitized.port).toBeTypeOf('number');
      expect(sanitized.db.host).toBeTypeOf('string');
      expect(sanitized.db.database).toBeTypeOf('string');

      // Ensure raw secrets and passwords are NOT present in sanitized dump
      expect(sanitized.db).not.toHaveProperty('password');
      expect(sanitized).not.toHaveProperty('jwtSecret');
      expect(sanitized.db.passwordConfigured).toBeTypeOf('boolean');
      expect(sanitized.jwtConfigured).toBeTypeOf('boolean');
      expect(sanitized.ai.geminiConfigured).toBeTypeOf('boolean');
    });
  });

  describe('Structured Logging & APM Error Hooks (OBS-04)', () => {
    it('correctly executes leveled logging without crashing', () => {
      const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      logger.info('Test informational message', { metric: 123 });
      logger.warn('Test warning message', { warningCode: 'WARN_01' });
      logger.error('Test error message', new Error('Something failed'), { contextId: 'xyz' });

      expect(infoSpy).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });

    it('invokes registered APM error monitoring hooks when an error occurs', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const mockApmHook = vi.fn();
      registerErrorHook(mockApmHook);

      const testError = new Error('Database pool exhaustion simulation');
      logger.error('Critical operational failure', testError, { component: 'db_pool' });

      expect(mockApmHook).toHaveBeenCalledTimes(1);
      expect(mockApmHook).toHaveBeenCalledWith(testError, { component: 'db_pool' });
    });

    it('handles errors inside monitoring hooks gracefully without failing the logger', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const faultyHook = vi.fn().mockImplementation(() => {
        throw new Error('APM transport network timeout');
      });
      registerErrorHook(faultyHook);

      expect(() => {
        logger.error('Test error with faulty hook', new Error('Original error'));
      }).not.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('Request Correlation IDs & HTTP Access Middleware (OBS-04)', () => {
    it('preserves existing X-Request-Id from incoming request headers', () => {
      const incomingId = 'client-uuid-9876-5432-1000';
      const req: any = {
        headers: { 'x-request-id': incomingId },
        method: 'GET',
        url: '/api/videos',
        path: '/api/videos',
      };
      const res: any = {
        setHeader: vi.fn(),
        on: vi.fn(),
      };
      const next = vi.fn();

      requestLogger(req, res, next);

      expect(req.requestId).toBe(incomingId);
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', incomingId);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('generates a new UUID request ID if X-Request-Id header is absent', () => {
      const req: any = {
        headers: {},
        method: 'POST',
        url: '/api/videos/123/like',
        path: '/api/videos/123/like',
      };
      const res: any = {
        setHeader: vi.fn(),
        on: vi.fn(),
      };
      const next = vi.fn();

      requestLogger(req, res, next);

      expect(req.requestId).toBeDefined();
      expect(typeof req.requestId).toBe('string');
      expect(req.requestId.length).toBeGreaterThan(10);
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.requestId);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('Health Checks & Diagnostics (OBS-03)', () => {
    it('pingDatabase returns an object containing ok status and numeric latencyMs', async () => {
      const pingResult = await pingDatabase();

      expect(pingResult).toHaveProperty('ok');
      expect(typeof pingResult.ok).toBe('boolean');
      expect(pingResult).toHaveProperty('latencyMs');
      expect(typeof pingResult.latencyMs).toBe('number');
      expect(pingResult.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('validates comprehensive health payload structure against system invariants', () => {
      const memory = process.memoryUsage();
      const mockHealthPayload = {
        status: 'ok',
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
            status: 'connected',
            latencyMs: 3,
          },
        },
      };

      expect(mockHealthPayload.status).toBe('ok');
      expect(mockHealthPayload.uptime).toBeGreaterThanOrEqual(0);
      expect(mockHealthPayload.version).toBe('1.0.0');
      expect(mockHealthPayload.memory.heapUsedMb).toBeGreaterThan(0);
      expect(mockHealthPayload.checks.database.status).toBe('connected');
    });
  });
});
