import { useState, useEffect, useCallback } from 'react';
import { api, PaymentRequest } from '@/lib/api';
import { useAuth } from './useAuth';

export function useAdmin() {
  const { user, loading: authLoading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!user) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    setIsAdmin(user.role === 'admin');
    setLoading(false);
  }, [user, authLoading]);

  const fetchPaymentRequests = useCallback(async (status?: string) => {
    try {
      const data = await api.admin.getPaymentRequests(status);
      return { data, error: null };
    } catch (err: any) {
      return { data: [], error: err };
    }
  }, []);

  const approvePayment = useCallback(async (requestId: string, _userId?: string, _plan?: string) => {
    try {
      await api.admin.approvePayment(requestId);
      return { success: true };
    } catch (err: any) {
      console.error('Failed to approve payment:', err);
      return { success: false, error: err };
    }
  }, []);

  const rejectPayment = useCallback(async (requestId: string, note?: string) => {
    try {
      await api.admin.rejectPayment(requestId, note);
      return { success: true };
    } catch (err: any) {
      console.error('Failed to reject payment:', err);
      return { success: false, error: err };
    }
  }, []);

  const fetchAllUsers = useCallback(async () => {
    try {
      return await api.admin.getUsers();
    } catch {
      return [];
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      return await api.admin.getStats();
    } catch {
      return {
        totalUsers: 0,
        totalVideos: 0,
        premiumUsers: 0,
        pendingRequests: 0,
      };
    }
  }, []);

  const fetchDailyVideoStats = useCallback(async () => {
    try {
      return await api.admin.getDailyStats();
    } catch {
      return [];
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await api.admin.getSettings();
      return res.settings;
    } catch (err: any) {
      console.error('Failed to fetch settings:', err);
      throw err;
    }
  }, []);

  const saveSettings = useCallback(async (settings: Record<string, string>) => {
    try {
      const res = await api.admin.saveSettings(settings);
      return res;
    } catch (err: any) {
      console.error('Failed to save settings:', err);
      throw err;
    }
  }, []);

  const testQuranFoundation = useCallback(async (payload?: { clientId?: string; clientSecret?: string; env?: string }) => {
    return await api.admin.testQuranFoundation(payload);
  }, []);

  const testGemini = useCallback(async (apiKey?: string) => {
    return await api.admin.testGemini(apiKey);
  }, []);

  const testPexels = useCallback(async (apiKey?: string) => {
    return await api.admin.testPexels(apiKey);
  }, []);

  const fetchRenderStats = useCallback(async () => {
    try {
      return await api.admin.getRenderStats();
    } catch (err) {
      console.error('Failed to fetch render stats:', err);
      return null;
    }
  }, []);

  const cleanupRenderArtifacts = useCallback(async () => {
    return await api.admin.cleanupRenderArtifacts();
  }, []);

  return {
    isAdmin,
    loading,
    fetchPaymentRequests,
    approvePayment,
    rejectPayment,
    fetchAllUsers,
    fetchStats,
    fetchDailyVideoStats,
    fetchSettings,
    saveSettings,
    testQuranFoundation,
    testGemini,
    testPexels,
    fetchRenderStats,
    cleanupRenderArtifacts,
  };
}
