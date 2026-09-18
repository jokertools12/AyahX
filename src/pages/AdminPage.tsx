import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Layout } from '@/components/Layout';
import { useAdmin } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import {
  Shield, Users, CreditCard, BarChart3, Check, X, Clock,
  Loader2, Search, Crown, Video, TrendingUp, UserCheck, AlertCircle,
  Settings, Key, Globe, Eye, EyeOff, Sparkles, RefreshCw, CheckCircle2, XCircle, ExternalLink, Cpu, Sliders, Volume2,
  HardDrive, Trash2, Zap
} from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Navigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { ErrorState } from '@/components/ErrorState';

interface PaymentRequest {
  id: string;
  user_id: string;
  plan: string;
  amount: number;
  payment_method: string;
  phone_number: string;
  status: string;
  admin_note: string | null;
  created_at: string;
}

interface Stats {
  totalUsers: number;
  totalVideos: number;
  premiumUsers: number;
  pendingRequests: number;
}

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const {
    isAdmin, loading: adminLoading, fetchPaymentRequests, approvePayment, rejectPayment,
    fetchAllUsers, fetchStats, fetchDailyVideoStats, fetchSettings, saveSettings,
    testQuranFoundation, testGemini, testPexels, fetchRenderStats, cleanupRenderArtifacts
  } = useAdmin();

  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [stats, setStats] = useState<Stats>({ totalUsers: 0, totalVideos: 0, premiumUsers: 0, pendingRequests: 0 });
  const [dailyVideoData, setDailyVideoData] = useState<any[]>([]);
  const [filter, setFilter] = useState('pending');
  const [userSearch, setUserSearch] = useState('');
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Settings State
  const [settings, setSettings] = useState<Record<string, { value: string; isSecret: boolean; category: string }>>({});
  const [editedSettings, setEditedSettings] = useState<Record<string, string>>({
    QF_CLIENT_ID: '',
    QF_CLIENT_SECRET: '',
    QF_PRELIVE_CLIENT_ID: '',
    QF_PRELIVE_CLIENT_SECRET: '',
    QF_PROD_CLIENT_ID: '',
    QF_PROD_CLIENT_SECRET: '',
    QF_ENV: 'prelive',
    GEMINI_API_KEY: '',
    PEXELS_API_KEY: '',
    REELS_DEFAULT_QUALITY: '1080p',
    REELS_DEFAULT_FPS: '30',
    REELS_DEFAULT_GLOW: 'golden',
    REELS_AUDIO_BITRATE: '192k',
  });
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [savingSettings, setSavingSettings] = useState(false);
  const [qfTestStatus, setQfTestStatus] = useState<any>(null);
  const [testingQf, setTestingQf] = useState(false);
  const [testingGemini, setTestingGemini] = useState(false);
  const [geminiTestStatus, setGeminiTestStatus] = useState<any>(null);
  const [testingPexels, setTestingPexels] = useState(false);
  const [pexelsTestStatus, setPexelsTestStatus] = useState<any>(null);

  // Render & Disk Management State
  const [renderStats, setRenderStats] = useState<{
    queued: number;
    running: number;
    succeededToday: number;
    failedToday: number;
    maxConcurrency: number;
    retentionHours: number;
    diskUsageMb: number;
    storageDir: string;
  } | null>(null);
  const [cleaningRenders, setCleaningRenders] = useState(false);

  useEffect(() => {
    if (isAdmin) loadAll();
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) loadRequests();
  }, [filter, isAdmin]);

  const loadRenderStats = async () => {
    const data = await fetchRenderStats();
    if (data) setRenderStats(data);
  };

  const handleCleanupRenders = async () => {
    setCleaningRenders(true);
    try {
      const res = await cleanupRenderArtifacts();
      if (res?.success) {
        toast.success(res.message);
        await loadRenderStats();
      } else {
        toast.error(res?.message || 'فشل تنظيف ملفات الريندر');
      }
    } catch (err: any) {
      toast.error(err.message || 'حدث خطأ أثناء تنظيف الملفات');
    } finally {
      setCleaningRenders(false);
    }
  };

  const loadAll = async () => {
    setLoadingData(true);
    setError(null);
    try {
      await Promise.all([
        loadRequests(),
        loadUsers(),
        loadStats(),
        loadDailyVideoStats(),
        loadSettings(),
        loadRenderStats(),
      ]);
    } catch (err) {
      console.error('Failed to load admin data:', err);
      setError('تعذر تحميل بيانات لوحة التحكم. يرجى التحقق من اتصالك والمحاولة مرة أخرى.');
    } finally {
      setLoadingData(false);
    }
  };

  const loadSettings = async () => {
    try {
      const data = await fetchSettings();
      setSettings(data);
      const currentEnv = data.QF_ENV?.value || 'prelive';
      const initValues: Record<string, string> = {
        QF_CLIENT_ID: data.QF_CLIENT_ID?.value || '',
        QF_CLIENT_SECRET: data.QF_CLIENT_SECRET?.value || '',
        QF_PRELIVE_CLIENT_ID: data.QF_PRELIVE_CLIENT_ID?.value || data.QF_CLIENT_ID?.value || '',
        QF_PRELIVE_CLIENT_SECRET: data.QF_PRELIVE_CLIENT_SECRET?.value || (currentEnv === 'prelive' ? data.QF_CLIENT_SECRET?.value : '') || '',
        QF_PROD_CLIENT_ID: data.QF_PROD_CLIENT_ID?.value || (currentEnv === 'production' ? data.QF_CLIENT_ID?.value : '') || '',
        QF_PROD_CLIENT_SECRET: data.QF_PROD_CLIENT_SECRET?.value || (currentEnv === 'production' ? data.QF_CLIENT_SECRET?.value : '') || '',
        QF_ENV: currentEnv,
        GEMINI_API_KEY: data.GEMINI_API_KEY?.value || '',
        PEXELS_API_KEY: data.PEXELS_API_KEY?.value || '',
        REELS_DEFAULT_QUALITY: data.REELS_DEFAULT_QUALITY?.value || '1080p',
        REELS_DEFAULT_FPS: data.REELS_DEFAULT_FPS?.value || '30',
        REELS_DEFAULT_GLOW: data.REELS_DEFAULT_GLOW?.value || 'golden',
        REELS_AUDIO_BITRATE: data.REELS_AUDIO_BITRATE?.value || '192k',
      };
      setEditedSettings(initValues);
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  };

  const loadDailyVideoStats = async () => {
    const data = await fetchDailyVideoStats();
    setDailyVideoData(data);
  };

  const loadRequests = async () => {
    const { data } = await fetchPaymentRequests(filter);
    setRequests(data as PaymentRequest[]);
  };

  const loadUsers = async () => {
    const data = await fetchAllUsers();
    setUsers(data);
  };

  const loadStats = async () => {
    const data = await fetchStats();
    setStats(data);
  };

  const handleApprove = async (req: PaymentRequest) => {
    setProcessingId(req.id);
    await approvePayment(req.id, req.user_id, req.plan);
    toast.success('تم تفعيل الاشتراك بنجاح');
    await loadAll();
    setProcessingId(null);
  };

  const handleReject = async (req: PaymentRequest) => {
    setProcessingId(req.id);
    await rejectPayment(req.id, 'تم الرفض بواسطة الأدمن');
    toast.success('تم رفض الطلب');
    await loadRequests();
    setProcessingId(null);
  };

  const handleSettingChange = (key: string, val: string) => {
    setEditedSettings(prev => ({ ...prev, [key]: val }));
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      const activeEnv = editedSettings.QF_ENV || 'prelive';
      const activeClientId = activeEnv === 'production'
        ? (editedSettings.QF_PROD_CLIENT_ID || editedSettings.QF_CLIENT_ID)
        : (editedSettings.QF_PRELIVE_CLIENT_ID || editedSettings.QF_CLIENT_ID);
      const activeClientSecret = activeEnv === 'production'
        ? (editedSettings.QF_PROD_CLIENT_SECRET || editedSettings.QF_CLIENT_SECRET)
        : (editedSettings.QF_PRELIVE_CLIENT_SECRET || editedSettings.QF_CLIENT_SECRET);

      const payload = {
        ...editedSettings,
        QF_CLIENT_ID: activeClientId,
        QF_CLIENT_SECRET: activeClientSecret,
      };

      await saveSettings(payload);
      toast.success('تم حفظ الإعدادات والمفاتيح لكل بيئة بنجاح! 🎉');
      await loadSettings();
    } catch (err: any) {
      toast.error(err.message || 'فشل حفظ الإعدادات');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTestQf = async () => {
    setTestingQf(true);
    setQfTestStatus(null);
    try {
      const activeEnv = editedSettings.QF_ENV || 'prelive';
      const clientId = activeEnv === 'production'
        ? (editedSettings.QF_PROD_CLIENT_ID || editedSettings.QF_CLIENT_ID)
        : (editedSettings.QF_PRELIVE_CLIENT_ID || editedSettings.QF_CLIENT_ID);
      const clientSecret = activeEnv === 'production'
        ? (editedSettings.QF_PROD_CLIENT_SECRET || editedSettings.QF_CLIENT_SECRET)
        : (editedSettings.QF_PRELIVE_CLIENT_SECRET || editedSettings.QF_CLIENT_SECRET);

      const res = await testQuranFoundation({
        clientId,
        clientSecret,
        env: activeEnv,
      });
      setQfTestStatus(res);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    } catch (err: any) {
      setQfTestStatus({ success: false, message: err.message || 'فشل الاتصال' });
      toast.error('فشل فحص اتصال Quran Foundation');
    } finally {
      setTestingQf(false);
    }
  };

  const handleTestGemini = async () => {
    setTestingGemini(true);
    setGeminiTestStatus(null);
    try {
      const res = await testGemini(editedSettings.GEMINI_API_KEY);
      setGeminiTestStatus(res);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    } catch (err: any) {
      setGeminiTestStatus({ success: false, message: err.message });
      toast.error('فشل اختبار مفتاح Gemini');
    } finally {
      setTestingGemini(false);
    }
  };

  const handleTestPexels = async () => {
    setTestingPexels(true);
    setPexelsTestStatus(null);
    try {
      const res = await testPexels(editedSettings.PEXELS_API_KEY);
      setPexelsTestStatus(res);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    } catch (err: any) {
      setPexelsTestStatus({ success: false, message: err.message });
      toast.error('فشل اختبار مفتاح Pexels');
    } finally {
      setTestingPexels(false);
    }
  };

  if (authLoading || adminLoading || loadingData) {
    return <Layout><div className="flex justify-center items-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></Layout>;
  }

  if (!user || !isAdmin) {
    return <Navigate to="/" replace />;
  }

  if (error) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-16">
          <ErrorState message={error} onRetry={loadAll} />
        </div>
      </Layout>
    );
  }

  const walletName = (method: string) => {
    const map: Record<string, string> = { vodafone_cash: 'فودافون كاش', etisalat_cash: 'اتصالات كاش', orange_cash: 'أورانج كاش', we_pay: 'وي باي' };
    return map[method] || method;
  };

  const planName = (plan: string) => plan === 'yearly' ? 'سنوي' : 'شهري';

  const statusBadge = (status: string) => {
    if (status === 'pending') return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />قيد المراجعة</Badge>;
    if (status === 'approved') return <Badge className="gap-1 bg-green-600"><Check className="h-3 w-3" />تم القبول</Badge>;
    return <Badge variant="destructive" className="gap-1"><X className="h-3 w-3" />مرفوض</Badge>;
  };

  const filteredUsers = users.filter(u =>
    !userSearch || (u.display_name || '').includes(userSearch) || u.user_id?.includes(userSearch)
  );

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Shield className="h-8 w-8 text-primary" />
            لوحة تحكم الأدمن
          </h1>
          <p className="text-muted-foreground mt-1">إدارة الاشتراكات والأعضاء والإحصائيات</p>
        </motion.div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'إجمالي الأعضاء', value: stats.totalUsers, icon: Users, color: 'text-blue-500' },
            { label: 'أعضاء مميزون', value: stats.premiumUsers, icon: Crown, color: 'text-amber-500' },
            { label: 'إجمالي الفيديوهات', value: stats.totalVideos, icon: Video, color: 'text-green-500' },
            { label: 'طلبات معلقة', value: stats.pendingRequests, icon: CreditCard, color: 'text-red-500' },
          ].map((stat, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <stat.icon className={`h-8 w-8 ${stat.color}`} />
                  <div>
                    <p className="text-2xl font-bold">{stat.value}</p>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="requests">
          <TabsList className="w-full grid grid-cols-2 md:grid-cols-5 mb-6">
            <TabsTrigger value="requests" className="gap-1">
              <CreditCard className="h-4 w-4" />
              <span className="hidden sm:inline">طلبات الدفع</span>
              <span className="sm:hidden">طلبات</span>
              {stats.pendingRequests > 0 && <Badge variant="destructive" className="mr-1 h-5 w-5 p-0 flex items-center justify-center text-xs">{stats.pendingRequests}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="members" className="gap-1">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">الأعضاء</span>
              <span className="sm:hidden">أعضاء</span>
            </TabsTrigger>
            <TabsTrigger value="stats" className="gap-1">
              <BarChart3 className="h-4 w-4" />
              <span className="hidden sm:inline">الإحصائيات</span>
              <span className="sm:hidden">إحصائيات</span>
            </TabsTrigger>
            <TabsTrigger value="render" className="gap-1">
              <Cpu className="h-4 w-4" />
              <span className="hidden sm:inline">الريندر والتخزين</span>
              <span className="sm:hidden">الريندر</span>
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1">
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">إعدادات Quran Foundation</span>
              <span className="sm:hidden">الإعدادات</span>
            </TabsTrigger>
          </TabsList>

          {/* Payment Requests */}
          <TabsContent value="requests">
            <div className="flex gap-2 mb-4 flex-wrap">
              {['pending', 'approved', 'rejected', 'all'].map(s => (
                <Button key={s} size="sm" variant={filter === s ? 'default' : 'outline'} onClick={() => setFilter(s)}>
                  {s === 'pending' ? 'معلقة' : s === 'approved' ? 'مقبولة' : s === 'rejected' ? 'مرفوضة' : 'الكل'}
                </Button>
              ))}
            </div>

            <div className="space-y-4">
              {requests.length === 0 ? (
                <Card><CardContent className="p-8 text-center text-muted-foreground">لا توجد طلبات</CardContent></Card>
              ) : requests.map(req => (
                <motion.div key={req.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {statusBadge(req.status)}
                            <Badge variant="outline">{planName(req.plan)}</Badge>
                            <Badge variant="outline">{walletName(req.payment_method)}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            الرقم: <span className="font-mono font-bold">{req.phone_number}</span>
                          </p>
                          <p className="text-sm text-muted-foreground">
                            المبلغ: <span className="font-bold">{req.amount} ج.م</span>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(req.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        {req.status === 'pending' && (
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => handleApprove(req)} disabled={processingId === req.id} className="gap-1">
                              {processingId === req.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                              قبول
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => handleReject(req)} disabled={processingId === req.id} className="gap-1">
                              <X className="h-4 w-4" />
                              رفض
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          </TabsContent>

          {/* Members */}
          <TabsContent value="members">
            <div className="mb-4">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input placeholder="ابحث عن عضو..." aria-label="ابحث عن عضو" value={userSearch} onChange={e => setUserSearch(e.target.value)} className="pr-10" />
              </div>
            </div>
            <div className="space-y-3">
              {filteredUsers.map(u => (
                <Card key={u.id}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{u.display_name || 'بدون اسم'}</p>
                      <p className="text-xs text-muted-foreground">{u.user_id}</p>
                      <p className="text-xs text-muted-foreground">
                        انضم: {new Date(u.created_at).toLocaleDateString('ar-EG')}
                      </p>
                    </div>
                    <UserCheck className="h-5 w-5 text-muted-foreground" />
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Stats */}
          <TabsContent value="stats">
            <div className="grid md:grid-cols-2 gap-6 mb-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Video className="h-5 w-5" /> الفيديوهات المنشأة (آخر 7 أيام)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64" dir="ltr">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dailyVideoData}>
                        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                        <XAxis dataKey="date" className="text-xs" />
                        <YAxis allowDecimals={false} className="text-xs" />
                        <Tooltip 
                          contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--foreground))' }}
                          labelStyle={{ color: 'hsl(var(--foreground))' }}
                        />
                        <Bar dataKey="videos" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="فيديوهات" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> توزيع الأعضاء</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64" dir="ltr">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'مجاني', value: Math.max(stats.totalUsers - stats.premiumUsers, 0) },
                            { name: 'مميز', value: stats.premiumUsers },
                          ]}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          dataKey="value"
                          label={({ name, value }) => `${name}: ${value}`}
                        >
                          <Cell fill="hsl(var(--muted-foreground))" />
                          <Cell fill="hsl(var(--primary))" />
                        </Pie>
                        <Tooltip 
                          contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--foreground))' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" /> ملخص</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                    <span>الأعضاء المسجلين</span>
                    <span className="font-bold text-lg">{stats.totalUsers}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                    <span>الأعضاء المميزون</span>
                    <span className="font-bold text-lg text-primary">{stats.premiumUsers}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                    <span>الفيديوهات المنشأة</span>
                    <span className="font-bold text-lg">{stats.totalVideos}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                    <span>نسبة التحويل</span>
                    <span className="font-bold text-lg">
                      {stats.totalUsers > 0 ? Math.round((stats.premiumUsers / stats.totalUsers) * 100) : 0}%
                    </span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" /> الإيرادات المتوقعة</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between items-center p-3 rounded-lg bg-primary/5 border border-primary/20">
                    <span>الإيراد الشهري المتوقع</span>
                    <span className="font-bold text-lg text-primary">${stats.premiumUsers * 10}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                    <span>الإيراد السنوي المتوقع</span>
                    <span className="font-bold text-lg">${stats.premiumUsers * 10 * 12}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Cloud Render & Disk Storage Tab */}
          <TabsContent value="render" className="space-y-6">
            {/* Header / Intro Card */}
            <Card className="border-primary/30 shadow-md relative overflow-hidden">
              <div className="absolute top-0 right-0 left-0 h-1 bg-gradient-to-r from-blue-500 via-primary to-amber-500" />
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-lg bg-primary/10 text-primary">
                        <Cpu className="h-5 w-5" />
                      </div>
                      <CardTitle className="text-xl">محرك الريندر السحابي وإدارة مساحة التخزين</CardTitle>
                      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs">
                        ⚡ FFmpeg ASS + 🎨 Skia Rust Canvas (Zero Chromium)
                      </Badge>
                    </div>
                    <CardDescription>
                      مراقبة طابور المهام الحسابية، استهلاك مساحة القرص، وتنظيف الملفات المؤقتة لتفادي امتلاء الاستضافة المشتركة.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={loadRenderStats}
                      className="gap-1.5 text-xs"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      تحديث الحالة
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={cleaningRenders}
                      onClick={handleCleanupRenders}
                      className="gap-1.5 text-xs font-semibold shadow-sm"
                    >
                      {cleaningRenders ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          جاري التنظيف...
                        </>
                      ) : (
                        <>
                          <Trash2 className="h-3.5 w-3.5" />
                          تنظيف الملفات المؤقتة الآن
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>

            {/* Metrics Overview Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-amber-500/10 text-amber-500">
                    <HardDrive className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{renderStats?.diskUsageMb ?? 0} <span className="text-xs font-normal text-muted-foreground">MB</span></p>
                    <p className="text-xs text-muted-foreground">مساحة ملفات الريندر</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-blue-500/10 text-blue-500">
                    <Clock className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{renderStats?.queued ?? 0}</p>
                    <p className="text-xs text-muted-foreground">في قائمة الانتظار</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-purple-500/10 text-purple-500">
                    <Cpu className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{renderStats?.running ?? 0}</p>
                    <p className="text-xs text-muted-foreground">قيد المعالجة الآن</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-500">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{renderStats?.succeededToday ?? 0}</p>
                    <p className="text-xs text-muted-foreground">تم إنجازه اليوم</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Architecture & Quota Policies */}
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="border-border/60">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="h-5 w-5 text-primary" />
                    سياسات حماية موارد الاستضافة المشتركة
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-start gap-2.5 p-3 rounded-lg bg-muted/40 border border-border/40">
                    <Clock className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold block">حفظ ملفات الفيديو لمدة 48 ساعة (48 Hours Retention)</span>
                      <span className="text-xs text-muted-foreground leading-relaxed">
                        يتم الاحتفاظ بملفات MP4 في مكتبة المستخدم لمدة 48 ساعة للتحميل، ثم تُفرغ مساحة القرص تلقائياً لحماية الاستضافة من الامتلاء.
                      </span>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5 p-3 rounded-lg bg-muted/40 border border-border/40">
                    <Zap className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold block">معالجة متزامنة آمنة (1 Concurrent Worker)</span>
                      <span className="text-xs text-muted-foreground leading-relaxed">
                        محدد بـ 1 عملية في وقت واحد لضمان عدم تجاوز سقف الذاكرة العشوائية RAM (2GB) ومنع بطء الخادم المشترك.
                      </span>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5 p-3 rounded-lg bg-muted/40 border border-border/40">
                    <Trash2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold block">منظف نفايات آلي (Garbage Collector)</span>
                      <span className="text-xs text-muted-foreground leading-relaxed">
                        يعمل في الخلفية كل 30 دقيقة ويمسح أي بقايا أو مجلدات فارغة أو مهام منتهية تلقائياً.
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Crown className="h-5 w-5 text-amber-500" />
                    سياسة الحصص والخصم الفعلي للريندر
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="p-3 rounded-lg bg-muted/40 border border-border/40 space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold">المستخدم المجاني (Free)</span>
                      <Badge variant="secondary">1 ريندر سحابي / يوم</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      5 عمليات يومياً عبر محرك المتصفح الفوري (Browser Canvas) + تجربة واحدة يومياً عبر الريندر السحابي.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-muted/40 border border-border/40 space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold">المشترك الشهري (Monthly)</span>
                      <Badge className="gradient-primary text-primary-foreground">15 ريندر سحابي / يوم</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      أولوية قصوى في طابور المعالجة + دقة 4K و 60 FPS + صوت ماستر 320 kbps + توليد غير محدود بالمتصفح.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-muted/40 border border-border/40 space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold">المشترك السنوي (Yearly)</span>
                      <Badge className="bg-amber-500 text-white">25 ريندر سحابي / يوم</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      أعلى سقف يومي + أولوية قصوى فورية + كافة المزايا الملكية والذكاء الاصطناعي.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-6">
            {/* Quran Foundation App Server Config */}
            <Card className="border-primary/30 shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 left-0 h-1 bg-gradient-to-r from-amber-500 via-primary to-emerald-500" />
              <CardHeader className="pb-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-lg bg-primary/10 text-primary">
                        <Globe className="h-5 w-5" />
                      </div>
                      <CardTitle className="text-xl">منظومة Quran Foundation (App Server: ayahx2)</CardTitle>
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-xs">
                        Official OAuth2
                      </Badge>
                    </div>
                    <CardDescription>
                      ربط النظام بحساب المطورين في Quran Foundation لجلب السور، الآيات، التلاوات الصوتية بأعلى دقة، وتوقيت الكلمات لحظياً.
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 self-start sm:self-auto border-primary/30 hover:bg-primary/10"
                    asChild
                  >
                    <a
                      href="https://dev-console.quran.foundation/projects/eecf8558-2521-43ab-a6d0-9ab6d949b4c9"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-4 w-4" />
                      لوحة المطورين (ayahx2)
                    </a>
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="space-y-6">
                {/* Environment Selector Tabs */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl bg-muted/40 border border-border/60">
                  <div className="space-y-0.5">
                    <div className="text-sm font-semibold flex items-center gap-2">
                      <Sliders className="h-4 w-4 text-primary" />
                      إعدادات المفاتيح لكل بيئة (Environment Credentials)
                    </div>
                    <p className="text-xs text-muted-foreground">
                      احفظ مفاتيح التطوير (Prelive) ومفاتيح الإنتاج (Production) بشكل مستقل للتبديل بينهما بسلاسة.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={editedSettings.QF_ENV === 'prelive' ? 'default' : 'outline'}
                      onClick={() => setEditedSettings(prev => ({ ...prev, QF_ENV: 'prelive' }))}
                      className="text-xs gap-1.5"
                    >
                      <span>بيئة التطوير (Prelive)</span>
                      {editedSettings.QF_ENV === 'prelive' && <Check className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={editedSettings.QF_ENV === 'production' ? 'default' : 'outline'}
                      onClick={() => setEditedSettings(prev => ({ ...prev, QF_ENV: 'production' }))}
                      className="text-xs gap-1.5"
                    >
                      <span>بيئة الإنتاج (Production)</span>
                      {editedSettings.QF_ENV === 'production' && <Check className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>

                {/* Active Environment Inputs */}
                {editedSettings.QF_ENV === 'prelive' ? (
                  <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">
                          بيئة الاختبار الحالية (Prelive)
                        </Badge>
                        <span className="text-xs text-muted-foreground">https://apis-prelive.quran.foundation</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div className="space-y-2">
                        <Label htmlFor="qf-prelive-client-id" className="text-sm font-medium flex items-center gap-1.5">
                          <Key className="h-3.5 w-3.5 text-primary" />
                          معرف العميل للـ Prelive (Client ID)
                        </Label>
                        <Input
                          id="qf-prelive-client-id"
                          value={editedSettings.QF_PRELIVE_CLIENT_ID}
                          onChange={(e) => setEditedSettings(prev => ({ ...prev, QF_PRELIVE_CLIENT_ID: e.target.value }))}
                          placeholder="معرف العميل لبيئة Prelive..."
                          className="font-mono text-xs bg-background"
                          dir="ltr"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="qf-prelive-client-secret" className="text-sm font-medium flex items-center gap-1.5">
                          <Key className="h-3.5 w-3.5 text-amber-500" />
                          المفتاح السري للـ Prelive (Client Secret)
                        </Label>
                        <div className="relative">
                          <Input
                            id="qf-prelive-client-secret"
                            type={showSecrets['QF_PRELIVE_CLIENT_SECRET'] ? 'text' : 'password'}
                            value={editedSettings.QF_PRELIVE_CLIENT_SECRET}
                            onChange={(e) => setEditedSettings(prev => ({ ...prev, QF_PRELIVE_CLIENT_SECRET: e.target.value }))}
                            placeholder={settings.QF_PRELIVE_CLIENT_SECRET?.value || settings.QF_CLIENT_SECRET?.value ? '****** (محفوظ ومؤمن)' : 'الصق المفتاح السري للـ Prelive'}
                            className="font-mono text-xs pr-10 bg-background"
                            dir="ltr"
                          />
                          <button
                            type="button"
                            onClick={() => setShowSecrets(prev => ({ ...prev, QF_PRELIVE_CLIENT_SECRET: !prev.QF_PRELIVE_CLIENT_SECRET }))}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            {showSecrets['QF_PRELIVE_CLIENT_SECRET'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
                          بيئة الإنتاج المباشرة (Production)
                        </Badge>
                        <span className="text-xs text-muted-foreground">https://apis.quran.foundation</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div className="space-y-2">
                        <Label htmlFor="qf-prod-client-id" className="text-sm font-medium flex items-center gap-1.5">
                          <Key className="h-3.5 w-3.5 text-emerald-400" />
                          معرف العميل للإنتاج (Production Client ID)
                        </Label>
                        <Input
                          id="qf-prod-client-id"
                          value={editedSettings.QF_PROD_CLIENT_ID}
                          onChange={(e) => setEditedSettings(prev => ({ ...prev, QF_PROD_CLIENT_ID: e.target.value }))}
                          placeholder="معرف العميل لبيئة الإنتاج..."
                          className="font-mono text-xs bg-background"
                          dir="ltr"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="qf-prod-client-secret" className="text-sm font-medium flex items-center gap-1.5">
                          <Key className="h-3.5 w-3.5 text-amber-500" />
                          المفتاح السري للإنتاج (Production Client Secret)
                        </Label>
                        <div className="relative">
                          <Input
                            id="qf-prod-client-secret"
                            type={showSecrets['QF_PROD_CLIENT_SECRET'] ? 'text' : 'password'}
                            value={editedSettings.QF_PROD_CLIENT_SECRET}
                            onChange={(e) => setEditedSettings(prev => ({ ...prev, QF_PROD_CLIENT_SECRET: e.target.value }))}
                            placeholder={settings.QF_PROD_CLIENT_SECRET?.value ? '****** (محفوظ ومؤمن)' : 'الصق المفتاح السري للإنتاج'}
                            className="font-mono text-xs pr-10 bg-background"
                            dir="ltr"
                          />
                          <button
                            type="button"
                            onClick={() => setShowSecrets(prev => ({ ...prev, QF_PROD_CLIENT_SECRET: !prev.QF_PROD_CLIENT_SECRET }))}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            {showSecrets['QF_PROD_CLIENT_SECRET'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-1">
                  <div className="text-xs text-muted-foreground">
                    البيئة المحددة حالياً للعمل: <span className="font-semibold text-foreground uppercase">{editedSettings.QF_ENV}</span>
                  </div>
                  <Button
                    onClick={handleTestQf}
                    disabled={testingQf}
                    variant="outline"
                    className="gap-2 border-primary/40 hover:bg-primary/10 h-10 w-full sm:w-auto"
                  >
                    {testingQf ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        جاري فحص اتصال {editedSettings.QF_ENV}...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 text-primary" />
                        فحص اتصال وتوثيق ({editedSettings.QF_ENV})
                      </>
                    )}
                  </Button>
                </div>

                {/* Test Result Display */}
                {qfTestStatus && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`p-4 rounded-xl border flex flex-col gap-2 ${
                      qfTestStatus.success
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : 'bg-destructive/10 border-destructive/30 text-destructive'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      {qfTestStatus.success ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                      ) : (
                        <XCircle className="h-5 w-5 text-destructive shrink-0" />
                      )}
                      <span>{qfTestStatus.message}</span>
                    </div>
                    {qfTestStatus.details && (
                      <div className="text-xs opacity-90 font-mono space-y-1 bg-background/50 p-2.5 rounded-lg border border-border/40 mt-1">
                        <div>البيئة المستهدفة: {qfTestStatus.details.environment}</div>
                        <div>الوضع: {qfTestStatus.details.mode === 'authenticated' ? 'توثيق ناجح عبر OAuth2 (حساب App Server)' : 'استخدام الحساب المتاح'}</div>
                        {qfTestStatus.details.chaptersCount && (
                          <div>عدد السور المتاحة للاسترجاع: {qfTestStatus.details.chaptersCount} سورة</div>
                        )}
                        {qfTestStatus.details.latencyMs && (
                          <div>زمن الاستجابة: {qfTestStatus.details.latencyMs} مللي ثانية</div>
                        )}
                      </div>
                    )}
                  </motion.div>
                )}
              </CardContent>
            </Card>

            {/* AI & Media APIs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Google Gemini Card */}
              <Card className="border-border/60 shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
                        <Sparkles className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-base">Google Gemini AI</CardTitle>
                        <CardDescription className="text-xs">
                          توليد خواطر تدبرية، وسياق الآيات، واقتراحات المشاهد
                        </CardDescription>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="gemini-key" className="text-xs font-medium">مفتاح API Key</Label>
                    <div className="relative">
                      <Input
                        id="gemini-key"
                        type={showSecrets['GEMINI_API_KEY'] ? 'text' : 'password'}
                        value={editedSettings.GEMINI_API_KEY}
                        onChange={(e) => setEditedSettings(prev => ({ ...prev, GEMINI_API_KEY: e.target.value }))}
                        placeholder={settings.GEMINI_API_KEY?.value ? '****** (محفوظ ومؤمن)' : 'AIzaSy...'}
                        className="font-mono text-xs pr-10 bg-muted/40"
                        dir="ltr"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSecrets(prev => ({ ...prev, GEMINI_API_KEY: !prev.GEMINI_API_KEY }))}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showSecrets['GEMINI_API_KEY'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <Button
                    onClick={handleTestGemini}
                    disabled={testingGemini}
                    size="sm"
                    variant="outline"
                    className="w-full gap-2 text-xs"
                  >
                    {testingGemini ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cpu className="h-3.5 w-3.5" />}
                    اختبار استجابة Gemini
                  </Button>
                  {geminiTestStatus && (
                    <div className={`text-xs p-2 rounded border flex items-center gap-2 ${
                      geminiTestStatus.success ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-destructive/10 border-destructive/30 text-destructive'
                    }`}>
                      {geminiTestStatus.success ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
                      <span>{geminiTestStatus.message}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Pexels Video Library Card */}
              <Card className="border-border/60 shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
                        <Video className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-base">Pexels Video Engine</CardTitle>
                        <CardDescription className="text-xs">
                          خلفيات فيديو سينمائية متحركة بدقة 4K تناسب الريلز
                        </CardDescription>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="pexels-key" className="text-xs font-medium">مفتاح Pexels API</Label>
                    <div className="relative">
                      <Input
                        id="pexels-key"
                        type={showSecrets['PEXELS_API_KEY'] ? 'text' : 'password'}
                        value={editedSettings.PEXELS_API_KEY}
                        onChange={(e) => setEditedSettings(prev => ({ ...prev, PEXELS_API_KEY: e.target.value }))}
                        placeholder={settings.PEXELS_API_KEY?.value ? '****** (محفوظ ومؤمن)' : 'الصق مفتاح Pexels'}
                        className="font-mono text-xs pr-10 bg-muted/40"
                        dir="ltr"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSecrets(prev => ({ ...prev, PEXELS_API_KEY: !prev.PEXELS_API_KEY }))}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showSecrets['PEXELS_API_KEY'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <Button
                    onClick={handleTestPexels}
                    disabled={testingPexels}
                    size="sm"
                    variant="outline"
                    className="w-full gap-2 text-xs"
                  >
                    {testingPexels ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Video className="h-3.5 w-3.5" />}
                    اختبار اتصال Pexels
                  </Button>
                  {pexelsTestStatus && (
                    <div className={`text-xs p-2 rounded border flex items-center gap-2 ${
                      pexelsTestStatus.success ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-destructive/10 border-destructive/30 text-destructive'
                    }`}>
                      {pexelsTestStatus.success ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
                      <span>{pexelsTestStatus.message}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>



            {/* Global Save Action Bar */}
            <div className="sticky bottom-4 z-20 p-4 rounded-xl backdrop-blur-md bg-card/90 border border-primary/30 shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary shrink-0" />
                <span className="text-sm font-medium">يتم حفظ المفاتيح مشفرة ومحمية في قاعدة البيانات وتفعيلها فوراً لجميع المستخدمين.</span>
              </div>
              <Button
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="gap-2 bg-gradient-to-r from-amber-500 to-primary hover:from-amber-600 hover:to-primary/90 text-primary-foreground font-semibold px-6 shadow-md w-full sm:w-auto"
              >
                {savingSettings ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جاري الحفظ...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    حفظ كافة الإعدادات والمفاتيح
                  </>
                )}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
