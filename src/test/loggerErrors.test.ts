import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response } from 'express';
import type { Server } from 'node:http';

let log: typeof import('../../server/logger');
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('LOG_LEVEL', 'debug');
  log = await import('../../server/logger');
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function lastEntry() {
  return JSON.parse(String(errorSpy.mock.calls.at(-1)?.[0])) as {
    message: string; context?: Record<string, unknown>;
    error?: { code?: string; message: string; stack?: string };
  };
}

describe('T0 error diagnostics without secret disclosure', () => {
  it('retains code/message/stack from Error and structured errors', () => {
    const error = Object.assign(new Error('Provider unavailable'), { code: 'PROVIDER_UNAVAILABLE' });
    log.logger.error('Request failed', error, { requestId: 'unit-request' });
    expect(lastEntry().error).toMatchObject({ code: error.code, message: error.message, stack: error.stack });
    log.logger.error('Structured failure', { code: 'KNOWN_ALIGNMENT_FAILED', message: 'Alignment failed', stack: 'original-stack' });
    expect(lastEntry().error).toEqual({ name: 'Error', code: 'KNOWN_ALIGNMENT_FAILED', message: 'Alignment failed', stack: 'original-stack' });
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('[object Object]');
  });

  it('captures response codes and preserves the original caught stack without changing HTTP output', async () => {
    const app = express();
    app.use(log.requestLogger);
    const failure = Object.assign(new Error('KNOWN_ALIGNMENT_SOURCE_UNAVAILABLE'), { code: 'KNOWN_ALIGNMENT_SOURCE_UNAVAILABLE' });
    const payload = { code: failure.code, error: 'مصدر التلاوة غير متاح', privateDetail: 'not-logged' };
    app.get('/unit-failure', (_req, res) => {
      log.attachResponseError(res, failure);
      res.status(503).json(payload);
    });
    const server = await new Promise<Server>((resolve) => {
      const running = app.listen(0, '127.0.0.1', () => resolve(running));
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('TEST_ADDRESS_REQUIRED');
      const response = await fetch(`http://127.0.0.1:${address.port}/unit-failure?token=unit-query-only&opaque=unit-opaque-only`);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual(payload);
      expect(lastEntry().error).toMatchObject({ code: failure.code, message: failure.message, stack: failure.stack });
      expect(lastEntry().context).toMatchObject({ method: 'GET', status: 503 });
      const rendered = errorSpy.mock.calls.flat().join(' ');
      expect(rendered).not.toContain('unit-query-only');
      expect(rendered).not.toContain('unit-opaque-only');
      expect(rendered).not.toContain('not-logged');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('captures JSON error code/message without inventing an original stack', () => {
    let finish: (() => void) | undefined;
    const req = { headers: {}, method: 'POST', path: '/api/unit', originalUrl: '/api/unit', socket: {} } as Request;
    const res = {
      statusCode: 503, setHeader: vi.fn(), getHeader: vi.fn(),
      json: vi.fn(function (this: Response) { return this; }),
      on: vi.fn((_event: string, callback: () => void) => { finish = callback; }),
    } as unknown as Response;
    log.requestLogger(req, res, vi.fn());
    res.json({ code: 'TIMING_PACKAGE_UNAVAILABLE', error: 'لا تتوفر التوقيتات', audio: 'private-not-for-logs' });
    if (!finish) throw new Error('FINISH_CALLBACK_REQUIRED');
    finish();
    expect(lastEntry().error).toMatchObject({ code: 'TIMING_PACKAGE_UNAVAILABLE', message: 'لا تتوفر التوقيتات' });
    expect(lastEntry().error?.stack).toBeUndefined();
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('private-not-for-logs');
  });

  it('redacts secrets in all fields, signed URLs, connection URLs and cyclic context', () => {
    vi.stubEnv('UNIT_API_KEY', 'unit-environment-secret-only');
    const connection = `${'mysql'}://unit-user:unit-password@example.invalid/database`;
    const signed = 'https://audio.example.invalid/file?X-Amz-Signature=unit-signature-only';
    const context: Record<string, unknown> = {
      password: 'unit-password-field', nested: { authorization: 'Bearer unit-bearer-only' },
      note: `token=unit-inline-only ${connection} ${signed} unit-environment-secret-only "secret":"unit-quoted-only" Basic dW5pdDpvbmx5`,
    };
    context.cycle = context;
    const error = Object.assign(new Error(`Failed: ${signed} password=unit-message-only`), { code: 'UPSTREAM_FAILED' });
    error.stack = `original-stack ${connection} unit-environment-secret-only`;
    log.logger.error(`Operation ${signed}`, error, context);
    const rendered = String(errorSpy.mock.calls.at(-1)?.[0]);
    expect(lastEntry().error?.code).toBe('UPSTREAM_FAILED');
    for (const secret of ['unit-signature-only', 'unit-user', 'unit-password', 'unit-password-field', 'unit-bearer-only', 'unit-inline-only', 'unit-message-only', 'unit-environment-secret-only', 'unit-quoted-only', 'dW5pdDpvbmx5']) {
      expect(rendered).not.toContain(secret);
    }
    expect(rendered).toContain('[REDACTED]');
    expect(rendered).toContain('[Circular]');
  });

  it('redacts values passed to monitoring hooks, including failures inside a hook', () => {
    const hook = vi.fn(() => { throw new Error('Hook token=unit-hook-only'); });
    log.registerErrorHook(hook);
    log.logger.error('Operation failed', Object.assign(new Error('password=unit-hook-password'), { code: 'UNIT_ERROR' }), { apiKey: 'unit-hook-key' });
    const [error, context] = hook.mock.calls[0] as unknown as [Error, Record<string, unknown>];
    expect(error.message).not.toContain('unit-hook-password');
    expect(context.apiKey).toBe('[REDACTED]');
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('unit-hook-only');
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });
});
