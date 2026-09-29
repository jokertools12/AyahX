import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Layout } from '@/components/Layout';
import { SettingsSection } from '@/components/SettingsSection';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { User, Crown, Video, Calendar, Mail, Edit2, Loader2, Check, History, Camera, Image, Lock, Eye, EyeOff, KeyRound, AlertCircle, Trash2, AlertTriangle, Cpu, Zap, Sparkles, Clock3, ShieldCheck, CircleDollarSign, ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Link, Navigate, useNavigate } from 'react-router-dom';

const SETTINGS_NAV_ITEMS = [
  { id: 'settings-profile', label: 'الملف الشخصي', icon: User },
  { id: 'settings-security', label: 'الأمان', icon: ShieldCheck },
  { id: 'settings-plan', label: 'العضوية', icon: Crown },
  { id: 'settings-usage', label: 'الاستخدام', icon: Video },
  { id: 'settings-history', label: 'المدفوعات', icon: History },
  { id: 'settings-danger', label: 'حذف الحساب', icon: Trash2 },
] as const;

export default function UserSettingsPage() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { subscription, isPremium, dailyUsage, entitlements } = useSubscription();
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const navigate = useNavigate();
  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name || '');
      setAvatarUrl(user.avatar_url || null);
      setBio(user.bio || '');
      setProfileLoaded(true);
    }
  }, [user]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error('الحد الأقصى لحجم الصورة 2 ميجابايت');
      return;
    }

    setUploadingAvatar(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        setAvatarUrl(base64);
        await api.auth.updateProfile({ avatar_url: base64 });
        toast.success('تم تحديث الصورة');
      } catch {
        toast.error('فشل تحديث الصورة');
      } finally {
        setUploadingAvatar(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await api.auth.updateProfile({ display_name: displayName, bio });
      toast.success('تم حفظ الإعدادات');
    } catch {
      toast.error('حدث خطأ أثناء الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);

    if (!currentPassword) {
      setPasswordError('يرجى إدخال كلمة المرور الحالية');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('كلمة المرور الجديدة يجب أن لا تقل عن 6 أحرف');
      return;
    }

    if (newPassword.length > 72) {
      setPasswordError('كلمة المرور الجديدة يجب أن لا تزيد عن 72 حرفاً');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setPasswordError('كلمتا المرور غير متطابقتين');
      return;
    }

    setChangingPassword(true);
    try {
      const res = await api.auth.changePassword(currentPassword, newPassword);
      toast.success(res.message || 'تم تحديث كلمة المرور بنجاح');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setPasswordError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل تغيير كلمة المرور';
      setPasswordError(msg);
      toast.error(msg);
    } finally {
      setChangingPassword(false);
    }
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleteError(null);
    if (!deletePassword) {
      setDeleteError('يرجى إدخال كلمة المرور لتأكيد حذف الحساب');
      return;
    }

    setDeletingAccount(true);
    try {
      const res = await api.auth.deleteAccount(deletePassword);
      toast.success(res.message || 'تم حذف الحساب بنجاح');
      navigate('/');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل حذف الحساب';
      setDeleteError(msg);
      toast.error(msg);
    } finally {
      setDeletingAccount(false);
    }
  };

  if (authLoading) return <Layout><div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></Layout>;
  if (!isAuthenticated) return <Navigate to="/auth" replace />;

  const browserUsagePercent = dailyUsage.browserRenderLimit === null
    ? 0
    : (dailyUsage.browserRenderCount / dailyUsage.browserRenderLimit) * 100;

  return (
    <Layout>
      <div className="container mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <header className="relative isolate mb-6 overflow-hidden rounded-[1.75rem] border border-primary/20 bg-[radial-gradient(ellipse_at_top_right,hsl(var(--primary)/0.24),transparent_54%),linear-gradient(135deg,hsl(var(--card)),hsl(var(--card)),hsl(var(--primary)/0.08))] px-5 py-6 shadow-[0_24px_70px_-42px_hsl(var(--primary)/0.65)] sm:px-8 sm:py-8">
            <div aria-hidden="true" className="pointer-events-none absolute -left-10 -top-20 h-56 w-56 rounded-full border border-primary/10" />
            <div aria-hidden="true" className="pointer-events-none absolute -left-2 -top-12 h-40 w-40 rounded-full border border-primary/10" />
            <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-2xl">
                <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-background/55 px-3 py-1 text-xs font-semibold text-primary backdrop-blur">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  مساحة حسابك
                </p>
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">إعدادات AyahX</h1>
                <p className="mt-2 max-w-xl text-sm leading-7 text-muted-foreground sm:text-base">
                  ملفك الشخصي، أمان حسابك، وخيارات العضوية والإنتاج — في مكان واحد واضح.
                </p>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-background/65 px-4 py-3 backdrop-blur-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <CircleDollarSign className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground">حالة العضوية</p>
                  <p className="font-semibold">{isPremium ? 'مميز ✨' : 'الخطة المجانية'}</p>
                </div>
                <ChevronLeft className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </div>
            </div>
          </header>

          <div className="grid items-start gap-5 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
            <aside className="min-w-0 lg:sticky lg:top-24">
              <p className="mb-2 hidden px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground lg:block">التنقل السريع</p>
              <nav aria-label="أقسام الإعدادات" className="-mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0 lg:flex-col lg:gap-1.5 lg:overflow-visible lg:pb-0">
                {SETTINGS_NAV_ITEMS.map(({ id, label, icon: Icon }) => (
                  <a
                    key={id}
                    href={`#${id}`}
                    className="group flex shrink-0 items-center gap-2.5 rounded-full border border-border/70 bg-card px-3.5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/25 hover:bg-primary/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-full lg:rounded-xl lg:border-transparent lg:bg-transparent lg:px-3"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-primary/80" aria-hidden="true" />
                    <span>{label}</span>
                    <ChevronLeft className="mr-auto hidden h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-70 lg:block" aria-hidden="true" />
                  </a>
                ))}
              </nav>
            </aside>

          <div className="min-w-0 space-y-5">
            {/* Profile Card with Avatar */}
            <section id="settings-profile" className="scroll-mt-24"><Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Edit2 className="h-5 w-5" />
                  الملف الشخصي
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Avatar */}
                <div className="flex flex-col items-center gap-3">
                  <div className="relative group">
                    <div className="h-24 w-24 rounded-full bg-muted flex items-center justify-center overflow-hidden border-4 border-background shadow-lg">
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
                      ) : (
                        <User className="h-10 w-10 text-muted-foreground" />
                      )}
                    </div>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingAvatar}
                      aria-label="تغيير الصورة الشخصية"
                      className="absolute bottom-0 right-0 h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:bg-primary/90 transition-colors"
                    >
                      {uploadingAvatar ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Camera className="h-4 w-4" aria-hidden="true" />}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      aria-label="تحميل صورة شخصية"
                      onChange={handleAvatarUpload}
                      className="hidden"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">اضغط على الكاميرا لتغيير الصورة (حد 2MB)</p>
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-1"><Mail className="h-4 w-4" />البريد الإلكتروني</Label>
                  <Input value={user?.email || ''} disabled aria-label="البريد الإلكتروني" className="bg-muted/50" />
                </div>
                <div className="space-y-2">
                  <Label>الاسم</Label>
                  <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="أدخل اسمك" aria-label="الاسم" />
                </div>
                <div className="space-y-2">
                  <Label>نبذة عنك</Label>
                  <Textarea
                    value={bio}
                    onChange={e => setBio(e.target.value)}
                    placeholder="اكتب نبذة قصيرة عن نفسك..."
                    aria-label="نبذة عنك"
                    className="resize-none h-20"
                    maxLength={200}
                  />
                  <p className="text-xs text-muted-foreground text-left">{bio.length}/200</p>
                </div>
                <Button onClick={handleSave} disabled={saving} className="w-full">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Check className="h-4 w-4 ml-2" />}
                  حفظ
                </Button>
              </CardContent>
            </Card></section>

            {/* Change Password Card */}
            <section id="settings-security" className="scroll-mt-24"><SettingsSection title="تغيير كلمة المرور">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <KeyRound className="h-5 w-5 text-primary" />
                  تغيير كلمة المرور
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleChangePassword} className="space-y-4">
                  {passwordError && (
                    <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>{passwordError}</span>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="current-password">كلمة المرور الحالية</Label>
                    <div className="relative">
                      <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                      <Input
                        id="current-password"
                        type={showCurrentPassword ? "text" : "password"}
                        placeholder="••••••••"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="pr-10 pl-11 font-sans text-left tracking-wider"
                        required
                        autoComplete="current-password"
                        dir="ltr"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                        className="absolute left-1.5 top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors focus:outline-none z-10"
                        aria-label={showCurrentPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                      >
                        {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="new-password">كلمة المرور الجديدة</Label>
                    <div className="relative">
                      <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                      <Input
                        id="new-password"
                        type={showNewPassword ? "text" : "password"}
                        placeholder="••••••••"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="pr-10 pl-11 font-sans text-left tracking-wider"
                        required
                        autoComplete="new-password"
                        dir="ltr"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className="absolute left-1.5 top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors focus:outline-none z-10"
                        aria-label={showNewPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                      >
                        {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">6 أحرف على الأقل</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirm-new-password">تأكيد كلمة المرور الجديدة</Label>
                    <div className="relative">
                      <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                      <Input
                        id="confirm-new-password"
                        type={showConfirmNewPassword ? "text" : "password"}
                        placeholder="••••••••"
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        className="pr-10 pl-11 font-sans text-left tracking-wider"
                        required
                        autoComplete="new-password"
                        dir="ltr"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setShowConfirmNewPassword(!showConfirmNewPassword)}
                        className="absolute left-1.5 top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors focus:outline-none z-10"
                        aria-label={showConfirmNewPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                      >
                        {showConfirmNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <Button type="submit" disabled={changingPassword} className="w-full">
                    {changingPassword ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Check className="h-4 w-4 ml-2" />}
                    تحديث كلمة المرور
                  </Button>
                </form>
              </CardContent>
            </Card>

            {/* Subscription Card */}
            </SettingsSection></section>
            <section id="settings-plan" className="scroll-mt-24"><Card className={isPremium ? 'border-primary/50 shadow-lg shadow-primary/10' : ''}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Crown className={`h-5 w-5 ${isPremium ? 'text-primary' : 'text-muted-foreground'}`} />
                  العضوية
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span>الخطة الحالية</span>
                  <Badge variant={isPremium ? 'default' : 'secondary'} className={isPremium ? 'gradient-primary text-primary-foreground' : ''}>
                    {isPremium ? 'مميز ✨' : 'مجاني'}
                  </Badge>
                </div>
                {subscription?.expires_at && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1"><Calendar className="h-4 w-4" />تنتهي في</span>
                    <span>{new Date(subscription.expires_at).toLocaleDateString('ar-EG')}</span>
                  </div>
                )}
                {!isPremium && (
                  <Button asChild className="w-full gradient-primary text-primary-foreground">
                    <Link to="/pricing"><Crown className="h-4 w-4 ml-2" />ترقية للعضوية المميزة</Link>
                  </Button>
                )}
              </CardContent>
            </Card></section>

            {/* Usage Card */}
            <section id="settings-usage" className="scroll-mt-24"><SettingsSection title="تفاصيل الاستخدام" description="الحصص اليومية وصلاحية الفيديوهات">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Video className="h-5 w-5" />
                  استخدام اليوم وحصص المحركات
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Browser Engine */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="flex items-center gap-1.5"><Zap className="h-4 w-4 text-emerald-500" />التسجيل على جهازك</span>
                    <span className="font-bold text-emerald-500">
                      {dailyUsage.browserRenderLimit === null
                        ? 'غير محدود في عضويتك'
                        : `${dailyUsage.browserRenderCount} / ${dailyUsage.browserRenderLimit} اليوم`}
                    </span>
                  </div>
                  {dailyUsage.browserRenderLimit !== null && (
                    <Progress value={Math.min(100, browserUsagePercent)} className="h-2" />
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    {dailyUsage.browserRenderLimit === null
                      ? 'توليد فوري ومباشر على جهازك دون حد يومي.'
                      : `تبقى ${dailyUsage.browserRenderRemaining ?? 0} من 5 عمليات تسجيل على جهازك اليوم.`}
                  </p>
                </div>

                {/* Engine 1: FFmpeg ASS */}
                <div className="space-y-1.5 pt-2 border-t border-border/40">
                  <div className="flex justify-between text-sm">
                    <span className="flex items-center gap-1.5"><Zap className="h-4 w-4 text-amber-500" />الإنتاج السحابي — FFmpeg</span>
                    <Badge variant="outline" className="text-[11px] bg-amber-500/10 text-amber-500 border-amber-500/20">
                      {entitlements.ffmpegAssDailyLimit} فيديو / يوم
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    إنتاج الفيديو على الخادم باستخدام إعدادات المشهد المختارة.
                  </p>
                </div>

                {/* Engine 2: Skia Rust */}
                <div className="space-y-1.5 pt-2 border-t border-border/40">
                  <div className="flex justify-between text-sm">
                    <span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-blue-500" />الإنتاج السحابي — Skia</span>
                    <Badge variant="outline" className="text-[11px] bg-blue-500/10 text-blue-500 border-blue-500/20">
                      {entitlements.skiaCanvasDailyLimit} فيديو / يوم
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    إنتاج الفيديو على الخادم مع النصوص والإطارات المختارة.
                  </p>
                </div>

                {/* Engine 3: Full-Fidelity Browser Cloud Render */}
                <div className="space-y-1.5 pt-2 border-t border-border/40">
                  <div className="flex justify-between text-sm">
                    <span className="flex items-center gap-1.5"><Cpu className="h-4 w-4 text-primary" />الإنتاج السحابي — المتصفح</span>
                    <Badge variant="outline" className="text-[11px] bg-primary/10 text-primary border-primary/20">
                      {entitlements.backgroundAsyncDailyLimit} فيديو / يوم
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    يطابق معاينة المتصفح بكل الخلفيات والنصوص والإعدادات، ثم يحفظ الفيديو بمكتبتك مع إشعار تلقائي.
                  </p>
                </div>

                {/* 48-Hour Retention Banner */}
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/15 flex items-start gap-2.5 text-xs text-muted-foreground">
                  <Clock3 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-foreground block">صلاحية حفظ الفيديوهات: 48 ساعة</span>
                    <span>تظل فيديوهات السيرفر متاحة للتحميل المباشر بصيغة MP4 لمدة 48 ساعة في مكتبتك لحماية سعة القرص.</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Payment History Link */}
            </SettingsSection></section>
            <section id="settings-history" className="scroll-mt-24"><Card>
              <CardContent className="p-4">
                <Button asChild variant="outline" className="w-full gap-2">
                  <Link to="/payment-history">
                    <History className="h-4 w-4" />
                    سجل المدفوعات
                  </Link>
                </Button>
              </CardContent>
            </Card></section>

            {/* Danger Zone: Account Deletion */}
            <section id="settings-danger" className="scroll-mt-24"><SettingsSection title="حذف الحساب" description="إدارة حذف حسابك وبياناتك" className="border-destructive/30">
            <Card className="border-destructive/30 bg-destructive/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                  منطقة الخطر (حذف الحساب)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  حذف الحساب هو إجراء نهائي لا يمكن التراجع عنه. سيؤدي إلى مسح ملفك الشخصي بالكامل، وجميع مقاطعك المحفوظة، وتفضيلاتك، وسجل المشاهدات والإنجازات.
                </p>
                {!showDeleteConfirm ? (
                  <Button
                    variant="destructive"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="w-full gap-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    حذف الحساب وجميع البيانات نهائياً
                  </Button>
                ) : (
                  <form onSubmit={handleDeleteAccount} className="space-y-3 p-4 rounded-lg border border-destructive/20 bg-background">
                    {deleteError && (
                      <div className="p-2.5 rounded bg-destructive/10 text-destructive text-sm flex items-center gap-2" role="alert">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        <span>{deleteError}</span>
                      </div>
                    )}
                    <Label htmlFor="delete-account-password" className="text-destructive font-semibold">
                      أدخل كلمة المرور لتأكيد الحذف النهائي:
                    </Label>
                    <Input
                      id="delete-account-password"
                      type="password"
                      placeholder="كلمة المرور الحالية"
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                      required
                      dir="ltr"
                      className="font-sans text-left"
                    />
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        variant="destructive"
                        disabled={deletingAccount}
                        className="flex-1 gap-2"
                      >
                        {deletingAccount ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Trash2 className="h-4 w-4 ml-2" />}
                        تأكيد الحذف النهائي
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => { setShowDeleteConfirm(false); setDeletePassword(''); setDeleteError(null); }}
                      >
                        إلغاء
                      </Button>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>
            </SettingsSection></section>
          </div>
          </div>
        </motion.div>
      </div>
    </Layout>
  );
}
