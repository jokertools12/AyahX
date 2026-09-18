import { useSyncExternalStore, useCallback } from 'react';
import { api, User, onAuthStateChanged, getAuthToken } from '@/lib/api';

interface AuthState {
  user: User | null;
  loading: boolean;
}

let authState: AuthState = {
  user: null,
  loading: !!getAuthToken(),
};

const storeListeners = new Set<() => void>();

function notifyStoreListeners() {
  storeListeners.forEach((l) => l());
}

let isInitialized = false;

function initAuthStore() {
  if (isInitialized) return;
  isInitialized = true;

  onAuthStateChanged((newUser) => {
    authState = { user: newUser, loading: false };
    notifyStoreListeners();
  });

  const token = getAuthToken();
  if (token) {
    api.auth.getMe().then(({ user }) => {
      authState = { user, loading: false };
      notifyStoreListeners();
    }).catch(() => {
      authState = { user: null, loading: false };
      notifyStoreListeners();
    });
  } else {
    authState = { user: null, loading: false };
    notifyStoreListeners();
  }
}

export function useAuth() {
  initAuthStore();

  const state = useSyncExternalStore(
    (onStoreChange) => {
      storeListeners.add(onStoreChange);
      return () => {
        storeListeners.delete(onStoreChange);
      };
    },
    () => authState,
    () => authState
  );

  const signUp = useCallback(async (email: string, password: string, displayName?: string) => {
    try {
      const res = await api.auth.register(email, password, displayName);
      return { data: { user: res.user, session: { access_token: res.token } }, error: null };
    } catch (err: any) {
      return { data: null, error: err };
    }
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const res = await api.auth.login(email, password);
      return { data: { user: res.user, session: { access_token: res.token } }, error: null };
    } catch (err: any) {
      return { data: null, error: err };
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.auth.logout();
      return { error: null };
    } catch (err: any) {
      return { error: err };
    }
  }, []);

  return {
    user: state.user,
    session: state.user ? { user: state.user, access_token: 'valid' } : null,
    loading: state.loading,
    signUp,
    signIn,
    signOut,
    isAuthenticated: !!state.user,
  };
}
