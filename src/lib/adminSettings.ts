/**
 * Treat a blank or masked OpenRouter key as "leave the stored key unchanged".
 * The admin API never returns the credential itself, so forms must not send
 * its display mask back as a replacement value when saving unrelated settings.
 */
export function omitUnchangedOpenRouterSecret(settings: Record<string, string>): Record<string, string> {
  const { OPENROUTER_API_KEY, ...rest } = settings;
  const key = OPENROUTER_API_KEY?.trim();

  if (!key || key.includes('****') || key === '******') {
    return rest;
  }

  return { ...rest, OPENROUTER_API_KEY: key };
}

const WRITE_ONLY_SECRET_KEYS = new Set([
  'OPENROUTER_API_KEY',
  'QF_CLIENT_SECRET',
  'QF_PRELIVE_CLIENT_SECRET',
  'QF_PROD_CLIENT_SECRET',
  'GEMINI_API_KEY',
  'PEXELS_API_KEY',
]);

function isMaskedOrEmptySecret(value: string | undefined): boolean {
  const cleanValue = value?.trim() || '';
  return !cleanValue || cleanValue.includes('****') || cleanValue === '******';
}

/**
 * Admin settings use write-only secret fields: blank or displayed-mask values
 * mean "keep the encrypted/server value". There is no implicit secret delete.
 */
export function omitUnchangedAdminSecrets(settings: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (WRITE_ONLY_SECRET_KEYS.has(key)) {
      if (isMaskedOrEmptySecret(value)) continue;
      result[key] = value.trim();
      continue;
    }
    result[key] = value;
  }
  return result;
}

export function buildQuranFoundationTestPayload(input: {
  env: string;
  clientId: string;
  clientSecret: string;
}): { env: 'prelive' | 'production'; clientId?: string; clientSecret?: string } {
  const env = input.env === 'production' ? 'production' : 'prelive';
  const clientId = input.clientId.trim();
  const clientSecret = input.clientSecret.trim();
  if (!clientId || isMaskedOrEmptySecret(clientSecret)) return { env };
  return { env, clientId, clientSecret };
}
