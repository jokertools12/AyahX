import IORedis from 'ioredis';
import { createHash } from 'node:crypto';
import { AdminError } from './adminContracts';
import { logger } from '../logger';
export interface AdminRateGate { check(identity: string, kind: 'login' | 'read' | 'write'): Promise<void>; close?(): Promise<void> }
/** Shared Redis protection is fail-closed. No silent process-local fallback. */
export class RedisAdminRateGate implements AdminRateGate {
  private redis?: IORedis;
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}
  async check(identity: string, kind: 'login' | 'read' | 'write'): Promise<void> {
    if (!this.env.REDIS_URL) throw new AdminError('ADMIN_RATE_STORE_UNAVAILABLE', 503);
    if (!this.redis) {
      this.redis = new IORedis(this.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: null, connectTimeout: 5000 });
      this.redis.on('error', () => logger.warn('Admin shared rate store unavailable', { code: 'ADMIN_RATE_STORE_UNAVAILABLE' }));
    }
    const windowMs = kind === 'login' ? 900000 : 60000, limit = kind === 'login' ? 10 : kind === 'write' ? 30 : 60;
    const bucket = Math.floor(Date.now() / windowMs), key = `ayahx:admin-rate:${kind}:${bucket}:${createHash('sha256').update(identity).digest('hex')}`;
    let count: number;
    try { count = Number(await this.redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); end; return n", 1, key, windowMs)); }
    catch { throw new AdminError('ADMIN_RATE_STORE_UNAVAILABLE', 503); }
    if (!Number.isSafeInteger(count) || count < 1) throw new AdminError('ADMIN_RATE_STORE_UNAVAILABLE', 503);
    if (count > limit) throw new AdminError('ADMIN_RATE_LIMITED', 429, { retryAfterMs: (bucket + 1) * windowMs - Date.now() });
  }
  async close(): Promise<void> { if (this.redis) { this.redis.disconnect(); this.redis = undefined; } }
}
