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
