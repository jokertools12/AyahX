import type { ResolutionRequest } from '../../shared/sourceResolution';

type SourcePolicyEntry = ResolutionRequest['policy']['sources'][number];

export interface SourceResolutionCacheEntry<T> {
  value: T;
  sourceId: string;
  sourceRevision: string;
  lockHash: string;
  expiresAtEpochMs: number;
}

export interface SourceResolutionCache<T> {
  get(request: ResolutionRequest, source: SourcePolicyEntry): T | undefined;
  set(request: ResolutionRequest, source: SourcePolicyEntry, value: T, ttlMs: number): void;
  clear(): void;
}

const cacheKey = (request: ResolutionRequest, source: SourcePolicyEntry): string => (
  `${source.sourceId}@${source.sourceRevision}:${request.lockHash}`
);

/**
 * Process-local cache for already validated source candidates. The key pins
 * the source revision and the complete resolution lock; a hit can never cross
 * riwayah, mushaf, range, text, or audio identity. Persistence belongs to the
 * durable resolution ledger, not this best-effort acceleration layer.
 */
export function createSourceResolutionCache<T>(now: () => number = Date.now): SourceResolutionCache<T> {
  const entries = new Map<string, SourceResolutionCacheEntry<T>>();
  const prune = () => {
    const current = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAtEpochMs <= current) entries.delete(key);
    }
  };

  return {
    get(request, source) {
      prune();
      const entry = entries.get(cacheKey(request, source));
      return entry?.value;
    },
    set(request, source, value, ttlMs) {
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) return;
      entries.set(cacheKey(request, source), {
        value,
        sourceId: source.sourceId,
        sourceRevision: source.sourceRevision,
        lockHash: request.lockHash,
        expiresAtEpochMs: now() + Math.floor(ttlMs),
      });
    },
    clear() {
      entries.clear();
    },
  };
}
