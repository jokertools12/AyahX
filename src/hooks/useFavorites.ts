import { useSyncExternalStore, useCallback } from 'react';
import { api } from '@/lib/api';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

export interface UserFavorites {
  surahs: number[];
  reciters: string[];
  performers: string[];
}

let favoritesState: UserFavorites = {
  surahs: [],
  reciters: [],
  performers: [],
};
let favoritesLoading = false;
let favoritesFetchedForUser: string | null = null;
const favoritesListeners = new Set<() => void>();

function notifyFavoritesListeners() {
  favoritesListeners.forEach((l) => l());
}

export function useFavorites() {
  const { user, isAuthenticated } = useAuth();
  const currentUserId = user?.id || null;

  // Single-fetch on user login/change, avoids N-per-card query storms
  if (currentUserId !== favoritesFetchedForUser) {
    favoritesFetchedForUser = currentUserId;
    if (currentUserId) {
      favoritesLoading = true;
      api.users.getFavorites()
        .then((favs) => {
          favoritesState = {
            surahs: Array.isArray(favs?.surahs) ? favs.surahs : [],
            reciters: Array.isArray(favs?.reciters) ? favs.reciters : [],
            performers: Array.isArray(favs?.performers) ? favs.performers : [],
          };
          favoritesLoading = false;
          notifyFavoritesListeners();
        })
        .catch(() => {
          favoritesLoading = false;
          notifyFavoritesListeners();
        });
    } else {
      favoritesState = { surahs: [], reciters: [], performers: [] };
      favoritesLoading = false;
      notifyFavoritesListeners();
    }
  }

  const favorites = useSyncExternalStore(
    (onStoreChange) => {
      favoritesListeners.add(onStoreChange);
      return () => {
        favoritesListeners.delete(onStoreChange);
      };
    },
    () => favoritesState,
    () => favoritesState
  );

  const isFavoriteSurah = useCallback((surahNumber: number) => {
    return favorites.surahs.includes(surahNumber);
  }, [favorites.surahs]);

  const isFavoriteReciter = useCallback((reciterId: string) => {
    return favorites.reciters.includes(reciterId);
  }, [favorites.reciters]);

  const isFavoritePerformer = useCallback((performerId: string) => {
    return favorites.performers.includes(performerId);
  }, [favorites.performers]);

  const toggleFavoriteSurah = useCallback(async (surahNumber: number) => {
    if (!isAuthenticated || !user) {
      toast.error('سجل دخول أولاً');
      return false;
    }

    const wasFav = favoritesState.surahs.includes(surahNumber);
    // Optimistic update
    favoritesState = {
      ...favoritesState,
      surahs: wasFav
        ? favoritesState.surahs.filter((n) => n !== surahNumber)
        : [...favoritesState.surahs, surahNumber],
    };
    notifyFavoritesListeners();

    try {
      const res = await api.users.toggleFavoriteSurah(surahNumber);
      toast.success(res.isFavorite ? 'تم الإضافة للمفضلة' : 'تم الإزالة من المفضلة');
      return res.isFavorite;
    } catch {
      // Revert on failure
      favoritesState = {
        ...favoritesState,
        surahs: wasFav
          ? [...favoritesState.surahs, surahNumber]
          : favoritesState.surahs.filter((n) => n !== surahNumber),
      };
      notifyFavoritesListeners();
      toast.error('فشل تحديث المفضلة');
      return wasFav;
    }
  }, [isAuthenticated, user]);

  const toggleFavoriteReciter = useCallback(async (reciterId: string) => {
    if (!isAuthenticated || !user) {
      toast.error('سجل دخول أولاً');
      return false;
    }

    const wasFav = favoritesState.reciters.includes(reciterId);
    // Optimistic update
    favoritesState = {
      ...favoritesState,
      reciters: wasFav
        ? favoritesState.reciters.filter((id) => id !== reciterId)
        : [...favoritesState.reciters, reciterId],
    };
    notifyFavoritesListeners();

    try {
      const res = await api.users.toggleFavoriteReciter(reciterId);
      toast.success(res.isFavorite ? 'تم الإضافة للمفضلة' : 'تم الإزالة من المفضلة');
      return res.isFavorite;
    } catch {
      // Revert on failure
      favoritesState = {
        ...favoritesState,
        reciters: wasFav
          ? [...favoritesState.reciters, reciterId]
          : favoritesState.reciters.filter((id) => id !== reciterId),
      };
      notifyFavoritesListeners();
      toast.error('فشل تحديث المفضلة');
      return wasFav;
    }
  }, [isAuthenticated, user]);

  const toggleFavoritePerformer = useCallback(async (performerId: string) => {
    if (!isAuthenticated || !user) {
      toast.error('سجل دخول أولاً');
      return false;
    }

    const wasFav = favoritesState.performers.includes(performerId);
    // Optimistic update
    favoritesState = {
      ...favoritesState,
      performers: wasFav
        ? favoritesState.performers.filter((id) => id !== performerId)
        : [...favoritesState.performers, performerId],
    };
    notifyFavoritesListeners();

    try {
      const res = await api.users.toggleFavoritePerformer(performerId);
      toast.success(res.isFavorite ? 'تم الإضافة للمفضلة' : 'تم الإزالة من المفضلة');
      return res.isFavorite;
    } catch {
      // Revert on failure
      favoritesState = {
        ...favoritesState,
        performers: wasFav
          ? [...favoritesState.performers, performerId]
          : favoritesState.performers.filter((id) => id !== performerId),
      };
      notifyFavoritesListeners();
      toast.error('فشل تحديث المفضلة');
      return wasFav;
    }
  }, [isAuthenticated, user]);

  return {
    favorites,
    loading: favoritesLoading,
    isFavoriteSurah,
    isFavoriteReciter,
    isFavoritePerformer,
    toggleFavoriteSurah,
    toggleFavoriteReciter,
    toggleFavoritePerformer,
  };
}
