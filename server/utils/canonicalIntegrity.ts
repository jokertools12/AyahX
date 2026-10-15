import { createHash } from 'node:crypto';

export function hashBytes(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Preserve exact strings and array order; sort object keys by UTF-16 code unit. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw new Error('CANONICAL_JSON_REQUIRES_DENSE_ARRAY');
    return '[' + Array.from(value, canonicalJson).join(',') + ']';
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  throw new Error('CANONICAL_JSON_REQUIRES_JSON_VALUES');
}
