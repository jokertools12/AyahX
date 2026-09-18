import { useState, useEffect, useCallback } from 'react';
import { api, Achievement } from '@/lib/api';
import { useAuth } from './useAuth';
import { triggerAchievementNotification } from '@/components/AchievementUnlockNotification';

interface UserAchievement {
  achievement_id: string;
  unlocked_at: string;
}

export function useAchievements() {
  const { user } = useAuth();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [unlocked, setUnlocked] = useState<UserAchievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const totalPoints = unlocked.reduce((sum, ua) => {
    const a = achievements.find((x) => x.id === ua.achievement_id);
    return sum + (a?.points || 0);
  }, 0);

  const fetchAll = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [allAch, myAch] = await Promise.all([
        api.achievements.getAll(),
        api.achievements.getMy(),
      ]);
      setAchievements(allAch);
      setUnlocked(
        myAch.map((a: any) => ({
          achievement_id: a.achievement_id || a.id,
          unlocked_at: a.unlocked_at || new Date().toISOString(),
        }))
      );
    } catch (err) {
      console.error('Fetch achievements error:', err);
      setError('تعذر تحميل بيانات الإنجازات. يرجى التحقق من اتصالك والمحاولة مرة أخرى.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  const checkAndUnlock = useCallback(async () => {
    if (!user) return;
    try {
      // Fetch user videos and favorites to check thresholds
      const [videos, favorites] = await Promise.all([
        api.videos.getMy(),
        api.users.getFavorites(),
      ]);

      const effectiveVideoCount = videos.length;
      const favCount = (favorites.surahs?.length || 0) + (favorites.reciters?.length || 0) + (favorites.performers?.length || 0);
      const uniqueReciters = new Set(videos.map((v) => v.reciter_name)).size;
      const uniqueSurahs = new Set(videos.map((v) => v.surah_name)).size;

      const statsMap: Record<string, number> = {
        first_video: effectiveVideoCount,
        five_videos: effectiveVideoCount,
        twenty_videos: effectiveVideoCount,
        fifty_videos: effectiveVideoCount,
        hundred_videos: effectiveVideoCount,
        first_favorite: favCount,
        five_favorites: favCount,
        five_reciters: uniqueReciters,
        ten_surahs: uniqueSurahs,
      };

      for (const ach of achievements) {
        const alreadyUnlocked = unlocked.some((u) => u.achievement_id === ach.id);
        if (alreadyUnlocked) continue;

        const currentValue = statsMap[ach.key] ?? 0;
        if (currentValue >= ach.threshold) {
          const res = await api.achievements.unlock(ach.key);
          if (res.success && !res.alreadyUnlocked) {
            triggerAchievementNotification({
              id: ach.id,
              title: ach.title,
              description: ach.description,
              points: ach.points,
            });
            setUnlocked((prev) => [
              ...prev,
              { achievement_id: ach.id, unlocked_at: new Date().toISOString() },
            ]);
          }
        }
      }
    } catch (err) {
      console.error('Check achievements error:', err);
    }
  }, [user, achievements, unlocked]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return { achievements, unlocked, totalPoints, loading, error, checkAndUnlock, refetch: fetchAll };
}
