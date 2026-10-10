export interface SerializedLogError {
  name: string;
  code?: string | number;
  message: string;
  stack?: string;
}

const sensitiveKey = /password|passwd|secret|token|authorization|cookie|api[_-]?key|connection[_-]?(?:string|url)|(?:database|redis|mysql)[_-]?url|signature|credential/iu;

/** Scrub before formatting and before invoking any external monitoring hook. */
export function redactLogText(value: string): string {
  let text = value;
  for (const [key, secret] of Object.entries(process.env)) {
    if (sensitiveKey.test(key) && secret && secret.length >= 4) text = text.split(secret).join('[REDACTED]');
  }
  text = text.replace(/(?:mysql|mysql2|redis|rediss|postgres|postgresql):\/\/[^\s<>"']+/giu, '[REDACTED]');
  text = text.replace(/https?:\/\/[^\s<>"']+/giu, (url) => {
    // Query/fragment can hold signed credentials, tokens or private identifiers.
    if (/[?#]/u.test(url) || /^https?:\/\/[^/]*@/iu.test(url)) return '[REDACTED]';
    return url;
  });
  text = text.replace(/\bBearer\s+[^\s,"'}]+/giu, 'Bearer [REDACTED]');
  text = text.replace(/\bBasic\s+[A-Za-z0-9+/=]+/giu, 'Basic [REDACTED]');
  text = text.replace(/(["'](?:password|passwd|token|secret|api[_-]?key|signature|credential)["']\s*:\s*)(["'])[^"']*\2/giu, '$1"[REDACTED]"');
  text = text.replace(/\b(password|passwd|token|secret|api[_-]?key|signature|credential)\s*[:=]\s*([^\s,;"'}]+)/giu, '$1=[REDACTED]');
  return text;
}

export function serializeLogError(value: unknown): SerializedLogError {
  const object = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const code = typeof object.code === 'string' ? redactLogText(object.code)
    : typeof object.code === 'number' ? object.code : undefined;
  return {
    name: typeof object.name === 'string' ? redactLogText(object.name) : 'Error',
    ...(code !== undefined ? { code } : {}),
    message: redactLogText(typeof object.message === 'string' ? object.message
      : typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : 'Structured error without message'),
    ...(typeof object.stack === 'string' ? { stack: redactLogText(object.stack) } : {}),
  };
}

export function redactLogValue(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (typeof value === 'string') return redactLogText(value);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  if (depth >= 8) return '[Depth limit]';
  if (value instanceof Error) return serializeLogError(value);
  seen.add(value);
  const result = Array.isArray(value) ? value.map((item) => redactLogValue(item, seen, depth + 1))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitiveKey.test(key) ? '[REDACTED]' : redactLogValue(item, seen, depth + 1)]));
  seen.delete(value);
  return result;
}

export function monitoringError(error: SerializedLogError): Error {
  const safe = new Error(error.message);
  if (safe.name !== error.name) safe.name = error.name;
  // No invented original stack for JSON-only errors.
  safe.stack = error.stack;
  if (error.code !== undefined) Object.assign(safe, { code: error.code });
  return safe;
}
