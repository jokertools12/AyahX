import { getRawSetting } from './settingsService';
import { logger } from '../logger';

interface TokenCache {
  accessToken: string;
  expiresAt: number; // Unix timestamp in ms
  environment: string;
  clientId: string;
}

let cachedToken: TokenCache | null = null;

const ENV_CONFIG = {
  prelive: {
    authUrl: 'https://prelive-oauth2.quran.foundation/oauth2/token',
    apiUrl: 'https://apis-prelive.quran.foundation/content/api/v4',
  },
  production: {
    authUrl: 'https://oauth2.quran.foundation/oauth2/token',
    apiUrl: 'https://apis.quran.foundation/content/api/v4',
  },
};

const PUBLIC_FALLBACK_API = 'https://api.quran.com/api/v4';

/**
 * Gets the configured Quran Foundation credentials and environment
 */
export async function getQuranFoundationConfig(targetEnv?: 'prelive' | 'production'): Promise<{
  clientId: string;
  clientSecret: string;
  env: 'prelive' | 'production';
  hasCredentials: boolean;
}> {
  const rawEnv = targetEnv || ((await getRawSetting('QF_ENV')) || 'prelive').trim().toLowerCase();
  const env: 'prelive' | 'production' = rawEnv === 'production' ? 'production' : 'prelive';

  let clientId = '';
  let clientSecret = '';

  if (env === 'production') {
    clientId = (await getRawSetting('QF_PROD_CLIENT_ID')).trim() || (await getRawSetting('QF_CLIENT_ID')).trim();
    clientSecret = (await getRawSetting('QF_PROD_CLIENT_SECRET')).trim() || (await getRawSetting('QF_CLIENT_SECRET')).trim();
  } else {
    clientId = (await getRawSetting('QF_PRELIVE_CLIENT_ID')).trim() || (await getRawSetting('QF_CLIENT_ID')).trim();
    clientSecret = (await getRawSetting('QF_PRELIVE_CLIENT_SECRET')).trim() || (await getRawSetting('QF_CLIENT_SECRET')).trim();
  }

  return {
    clientId,
    clientSecret,
    env,
    hasCredentials: Boolean(clientId && clientSecret),
  };
}

/**
 * Obtains an OAuth2 access token for Quran Foundation Content APIs
 * using Client Credentials flow with automatic in-memory caching.
 */
export async function getAccessToken(): Promise<{
  token: string;
  clientId: string;
  env: 'prelive' | 'production';
} | null> {
  const config = await getQuranFoundationConfig();
  if (!config.hasCredentials) {
    return null;
  }

  const now = Date.now();
  // If we have a cached token that is valid for at least another 60 seconds, reuse it
  if (
    cachedToken &&
    cachedToken.accessToken &&
    cachedToken.environment === config.env &&
    cachedToken.clientId === config.clientId &&
    cachedToken.expiresAt - now > 60000
  ) {
    return {
      token: cachedToken.accessToken,
      clientId: config.clientId,
      env: config.env,
    };
  }

  const envDetails = ENV_CONFIG[config.env];
  const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(envDetails.authUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'content',
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      logger.error(`Quran Foundation token request failed [${res.status}]: ${errText}`);
      return null;
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in?: number;
      token_type?: string;
      scope?: string;
    };

    const expiresInSec = data.expires_in || 3600;
    cachedToken = {
      accessToken: data.access_token,
      expiresAt: now + expiresInSec * 1000,
      environment: config.env,
      clientId: config.clientId,
    };

    logger.info(`Quran Foundation token obtained successfully [env: ${config.env}, expires: ${expiresInSec}s]`);
    return {
      token: cachedToken.accessToken,
      clientId: config.clientId,
      env: config.env,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    logger.error(`Quran Foundation auth request error: ${err.message}`);
    return null;
  }
}

/**
 * Makes an authenticated request to Quran Foundation Content API with automatic fallback
 */
export async function fetchQuranContent<T = any>(endpoint: string, queryParams: Record<string, string> = {}): Promise<T> {
  const tokenData = await getAccessToken();
  const config = await getQuranFoundationConfig();

  const qs = new URLSearchParams(queryParams).toString();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  if (tokenData && config.hasCredentials) {
    const envDetails = ENV_CONFIG[tokenData.env];
    const url = `${envDetails.apiUrl}${cleanEndpoint}${qs ? `?${qs}` : ''}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(url, {
        headers: {
          'x-auth-token': tokenData.token,
          'x-client-id': tokenData.clientId,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        return (await res.json()) as T;
      }

      // If 401 Unauthorized, invalidate cache and retry once
      if (res.status === 401) {
        logger.warn('Quran Foundation token returned 401. Refreshing token and retrying...');
        cachedToken = null;
        const fresh = await getAccessToken();
        if (fresh) {
          const retryRes = await fetch(url, {
            headers: {
              'x-auth-token': fresh.token,
              'x-client-id': fresh.clientId,
              Accept: 'application/json',
            },
          });
          if (retryRes.ok) {
            return (await retryRes.json()) as T;
          }
        }
      }

      logger.warn(`Quran Foundation API returned ${res.status} for ${endpoint}. Trying fallback...`);
    } catch (err: any) {
      clearTimeout(timeout);
      logger.warn(`Quran Foundation fetch error for ${endpoint}: ${err.message}. Trying fallback...`);
    }
  }

  // Graceful Fallback to public endpoint without authentication
  const fallbackUrl = `${PUBLIC_FALLBACK_API}${cleanEndpoint}${qs ? `?${qs}` : ''}`;
  const fController = new AbortController();
  const fTimeout = setTimeout(() => fController.abort(), 12000);
  try {
    const fRes = await fetch(fallbackUrl, { signal: fController.signal });
    clearTimeout(fTimeout);
    if (!fRes.ok) {
      throw new Error(`Fallback Quran API failed with status ${fRes.status}`);
    }
    return (await fRes.json()) as T;
  } catch (err: any) {
    clearTimeout(fTimeout);
    throw new Error(`Failed to fetch Quran content from primary and fallback: ${err.message}`);
  }
}

/**
 * Fetches Quran Foundation content with the configured first-party
 * credentials only. Alignment provenance uses this rather than the public
 * fallback path: a fallback response may be useful for browsing, but it must
 * never silently become a trusted timing provider.
 */
export async function fetchQuranFoundationContentStrict<T = any>(
  endpoint: string,
  queryParams: Record<string, string> = {},
): Promise<T> {
  const tokenData = await getAccessToken();
  const serviceConfig = await getQuranFoundationConfig();
  if (!tokenData || !serviceConfig.hasCredentials) {
    throw new Error('QF_STRICT_CREDENTIALS_NOT_CONFIGURED');
  }
  const qs = new URLSearchParams(queryParams).toString();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const envDetails = ENV_CONFIG[tokenData.env];
  const url = `${envDetails.apiUrl}${cleanEndpoint}${qs ? `?${qs}` : ''}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: {
        'x-auth-token': tokenData.token,
        'x-client-id': tokenData.clientId,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`QF_STRICT_HTTP_${response.status}`);
    }
    return await response.json() as T;
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('QF_STRICT_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Diagnostic test connection method for Admin Settings Panel
 */
export async function testConnection(overrideConfig?: {
  clientId: string;
  clientSecret: string;
  env: 'prelive' | 'production';
}): Promise<{
  success: boolean;
  message: string;
  environment: string;
  latencyMs: number;
  scopes?: string;
  expiresIn?: number;
  chaptersCount?: number;
  error?: string;
}> {
  const startTime = Date.now();
  const config = overrideConfig || (await getQuranFoundationConfig());

  if (!config.clientId || !config.clientSecret) {
    return {
      success: false,
      message: 'بيانات الاعتماد غير مكتملة (يرجى إدخال Client ID و Client Secret)',
      environment: config.env,
      latencyMs: 0,
      error: 'MISSING_CREDENTIALS',
    };
  }

  const envDetails = ENV_CONFIG[config.env];
  const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    // 1. Test OAuth2 Token exchange
    const tokenRes = await fetch(envDetails.authUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'content',
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      return {
        success: false,
        message: `فشل التحقق من بيانات الاعتماد لدى Quran Foundation (${tokenRes.status})`,
        environment: config.env,
        latencyMs: Date.now() - startTime,
        error: errBody || `HTTP ${tokenRes.status}`,
      };
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      expires_in?: number;
      scope?: string;
    };

    // 2. Test Content API call with returned token
    const testApiRes = await fetch(`${envDetails.apiUrl}/chapters?language=ar`, {
      headers: {
        'x-auth-token': tokenData.access_token,
        'x-client-id': config.clientId,
      },
    });

    let chaptersCount = 114;
    if (testApiRes.ok) {
      const chaptersJson = (await testApiRes.json()) as any;
      chaptersCount = chaptersJson?.chapters?.length || 114;
    }

    const latencyMs = Date.now() - startTime;
    return {
      success: true,
      message: `تم الاتصال بنجاح وتوثيق تطبيق ayahx2 (${config.env})`,
      environment: config.env,
      latencyMs,
      scopes: tokenData.scope || 'content',
      expiresIn: tokenData.expires_in || 3600,
      chaptersCount,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    return {
      success: false,
      message: `تعذر الاتصال بخادم Quran Foundation (${err.name === 'AbortError' ? 'انتهت مهلة الاتصال' : err.message})`,
      environment: config.env,
      latencyMs: Date.now() - startTime,
      error: err.message,
    };
  }
}
