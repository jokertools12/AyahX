import { useState, useEffect, useCallback, useMemo } from 'react';
import { api, Subscription } from '@/lib/api';
import { useAuth } from './useAuth';
import {
  FREE_FONTS,
  getPlanEntitlements,
  isFreeFont as isFreePlanFont,
  isPremiumPlan,
  normalizePlan,
  type PlanEntitlements,
  type PremiumFeature,
  type SubscriptionPlan,
} from '../../shared/planEntitlements';

export type PlanType = SubscriptionPlan;
export { FREE_FONTS };

/** Browser and cloud counters are deliberately independent. */
export interface DailyUsage {
  browserRenderCount: number;
  browserRenderLimit: number | null;
  browserRenderRemaining: number | null;
  cloudRenderCount: number;
  cloudRenderLimit: number;
  cloudRenderRemaining: number;
  /** Compatibility aliases: both refer to Browser Canvas usage. */
  count: number;
  limit: number | null;
  serverRenderCount: number;
  serverRenderLimit: number;
  serverRenderRemaining: number;
  ffmpegAssRenderCount: number;
  ffmpegAssRenderLimit: number;
  ffmpegAssRenderRemaining: number;
  skiaCanvasRenderCount: number;
  skiaCanvasRenderLimit: number;
  skiaCanvasRenderRemaining: number;
  browserCloudRenderCount: number;
  browserCloudRenderLimit: number;
  browserCloudRenderRemaining: number;
  backgroundAsyncRenderCount: number;
  backgroundAsyncRenderLimit: number;
  backgroundAsyncRenderRemaining: number;
}

const FREE_USAGE: DailyUsage = {
  browserRenderCount: 0,
  browserRenderLimit: 5,
  browserRenderRemaining: 5,
  cloudRenderCount: 0,
  cloudRenderLimit: 1,
  cloudRenderRemaining: 1,
  count: 0,
  limit: 5,
  serverRenderCount: 0,
  serverRenderLimit: 1,
  serverRenderRemaining: 1,
  ffmpegAssRenderCount: 0,
  ffmpegAssRenderLimit: 1,
  ffmpegAssRenderRemaining: 1,
  skiaCanvasRenderCount: 0,
  skiaCanvasRenderLimit: 2,
  skiaCanvasRenderRemaining: 2,
  browserCloudRenderCount: 0,
  browserCloudRenderLimit: 0,
  browserCloudRenderRemaining: 0,
  backgroundAsyncRenderCount: 0,
  backgroundAsyncRenderLimit: 0,
  backgroundAsyncRenderRemaining: 0,
};

function usageFromApi(data: {
  browserRenderCount?: number;
  browserRenderLimit?: number | null;
  browserRenderRemaining?: number | null;
  cloudRenderCount?: number;
  cloudRenderLimit?: number;
  cloudRenderRemaining?: number;
  count?: number;
  limit?: number | null;
  serverRenderCount?: number;
  serverRenderLimit?: number;
  serverRenderRemaining?: number;
  ffmpegAssRenderCount?: number;
  ffmpegAssRenderLimit?: number;
  ffmpegAssRenderRemaining?: number;
  skiaCanvasRenderCount?: number;
  skiaCanvasRenderLimit?: number;
  skiaCanvasRenderRemaining?: number;
  browserCloudRenderCount?: number;
  browserCloudRenderLimit?: number;
  browserCloudRenderRemaining?: number;
  backgroundAsyncRenderCount?: number;
  backgroundAsyncRenderLimit?: number;
  backgroundAsyncRenderRemaining?: number;
}, entitlements: PlanEntitlements): DailyUsage {
  const browserRenderCount = Number(data.browserRenderCount ?? data.count ?? 0);
  const browserRenderLimit = data.browserRenderLimit ?? data.limit ?? entitlements.browserDailyLimit;
  const browserRenderRemaining = data.browserRenderRemaining
    ?? (browserRenderLimit === null ? null : Math.max(browserRenderLimit - browserRenderCount, 0));
  const cloudRenderCount = Number(data.cloudRenderCount ?? data.serverRenderCount ?? 0);
  const cloudRenderLimit = Number(data.cloudRenderLimit ?? data.serverRenderLimit ?? entitlements.cloudDailyLimit);
  const cloudRenderRemaining = Number(data.cloudRenderRemaining ?? data.serverRenderRemaining ?? Math.max(cloudRenderLimit - cloudRenderCount, 0));
  const ffmpegAssRenderCount = Number(data.ffmpegAssRenderCount ?? 0);
  const ffmpegAssRenderLimit = Number(data.ffmpegAssRenderLimit ?? entitlements.ffmpegAssDailyLimit);
  const skiaCanvasRenderCount = Number(data.skiaCanvasRenderCount ?? 0);
  const skiaCanvasRenderLimit = Number(data.skiaCanvasRenderLimit ?? entitlements.skiaCanvasDailyLimit);
  const browserCloudRenderCount = Number(data.browserCloudRenderCount ?? 0);
  const browserCloudRenderLimit = Number(data.browserCloudRenderLimit ?? entitlements.backgroundAsyncDailyLimit);
  const backgroundAsyncRenderCount = Number(data.backgroundAsyncRenderCount ?? 0);
  const backgroundAsyncRenderLimit = Number(data.backgroundAsyncRenderLimit ?? entitlements.backgroundAsyncDailyLimit);

  return {
    browserRenderCount,
    browserRenderLimit,
    browserRenderRemaining,
    cloudRenderCount,
    cloudRenderLimit,
    cloudRenderRemaining,
    count: browserRenderCount,
    limit: browserRenderLimit,
    serverRenderCount: cloudRenderCount,
    serverRenderLimit: cloudRenderLimit,
    serverRenderRemaining: cloudRenderRemaining,
    ffmpegAssRenderCount,
    ffmpegAssRenderLimit,
    ffmpegAssRenderRemaining: Number(data.ffmpegAssRenderRemaining ?? Math.max(ffmpegAssRenderLimit - ffmpegAssRenderCount, 0)),
    skiaCanvasRenderCount,
    skiaCanvasRenderLimit,
    skiaCanvasRenderRemaining: Number(data.skiaCanvasRenderRemaining ?? Math.max(skiaCanvasRenderLimit - skiaCanvasRenderCount, 0)),
    browserCloudRenderCount,
    browserCloudRenderLimit,
    browserCloudRenderRemaining: Number(data.browserCloudRenderRemaining ?? Math.max(browserCloudRenderLimit - browserCloudRenderCount, 0)),
    backgroundAsyncRenderCount,
    backgroundAsyncRenderLimit,
    backgroundAsyncRenderRemaining: Number(data.backgroundAsyncRenderRemaining ?? Math.max(backgroundAsyncRenderLimit - backgroundAsyncRenderCount, 0)),
  };
}

export function useSubscription() {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [dailyUsage, setDailyUsage] = useState<DailyUsage>(FREE_USAGE);

  const plan = normalizePlan(subscription?.plan);
  const entitlements = useMemo(() => getPlanEntitlements(plan), [plan]);
  const isPremium = isPremiumPlan(plan);

  const fetchSubscription = useCallback(async () => {
    if (!user) {
      setSubscription(null);
      setLoading(false);
      return;
    }
    try {
      setSubscription(await api.subscriptions.getCurrent());
    } catch (e) {
      console.error('Fetch subscription error:', e);
      setSubscription(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const fetchDailyUsage = useCallback(async () => {
    if (!user) {
      setDailyUsage(FREE_USAGE);
      return;
    }
    try {
      const data = await api.subscriptions.getUsage();
      setDailyUsage(usageFromApi(data, getPlanEntitlements(normalizePlan(data.plan ?? subscription?.plan))));
    } catch (e) {
      console.error('Fetch usage error:', e);
    }
  }, [user, subscription?.plan]);

  const incrementUsage = useCallback(async () => {
    if (!user) return false;
    try {
      const res = await api.subscriptions.incrementUsage();
      setDailyUsage((previous) => usageFromApi({
        ...previous,
        browserRenderCount: res.browserRenderCount ?? res.count,
        browserRenderLimit: res.browserRenderLimit ?? res.limit,
        browserRenderRemaining: res.browserRenderRemaining,
      }, entitlements));
      return true;
    } catch (e) {
      console.error('Increment usage error:', e);
      return false;
    }
  }, [user, entitlements]);

  const canUseFeature = useCallback((feature: PremiumFeature): boolean => {
    return entitlements.features[feature];
  }, [entitlements]);

  const isFreeFont = useCallback((fontFamily: string): boolean => isFreePlanFont(fontFamily), []);

  useEffect(() => { fetchSubscription(); }, [fetchSubscription]);
  useEffect(() => { fetchDailyUsage(); }, [fetchDailyUsage]);

  return {
    subscription,
    loading,
    plan,
    entitlements,
    isPremium,
    dailyUsage,
    videoLimit: entitlements.browserDailyLimit,
    incrementUsage,
    canUseFeature,
    isFreeFont,
    refetch: fetchSubscription,
    refetchUsage: fetchDailyUsage,
  };
}
