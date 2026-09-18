import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Layout } from '@/components/Layout';
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
import { User, Crown, Video, Calendar, Mail, Edit2, Loader2, Check, History, Camera, Image, Lock, Eye, EyeOff, KeyRound, AlertCircle, Trash2, AlertTriangle, Cpu, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Link, Navigate, useNavigate } from 'react-router-dom';

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
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-bold mb-8 flex items-center gap-3">
            <User className="h-8 w-8 text-primary" />
            الإعدادات
          </h1>

          <div className="space-y-6">
            {/* Profile Card with Avatar */}
            <Card>
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
            </Card>

            {/* Change Password Card */}
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
            <Card className={isPremium ? 'border-primary/50 shadow-lg shadow-primary/10' : ''}>
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
            </Card>

            {/* Usage Card */}
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
                    <span className="flex items-center gap-1.5"><Zap className="h-4 w-4 text-emerald-500" />محرك المتصفح الفوري (Browser Canvas)</span>
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
                      : `تبقى ${dailyUsage.browserRenderRemaining ?? 0} من 5 عمليات Browser Canvas اليوم.`}
                  </p>
                </div>

                {/* Engine 1: FFmpeg ASS */}
                <div className="space-y-1.5 pt-2 border-t border-border/40">
                  <div className="flex justify-between text-sm">
                    <span className="flex items-center gap-1.5"><Zap className="h-4 w-4 text-amber-500" />محرك FFmpeg ASS الصاروخي (2-5 ثوانٍ)</span>
                    <Badge variant="outline" className="text-[11px] bg-amber-500/10 text-amber-500 border-amber-500/20">
                      {entitlements.ffmpegAssDailyLimit} فيديو / يوم
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    تلوين ذهبي دقيق بالمللي ثانية ومحرك C++ بدون انتظار.
                  </p>
                </div>

                {/* Engine 2: Skia Rust */}
                <div className="space-y-1.5 pt-2 border-t border-border/40">
                  <div className="flex justify-between text-sm">
                    <span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-blue-500" />محرك Skia Rust الفاخر (الميداليات الفيكتورية)</span>
                    <Badge variant="outline" className="text-[11px] bg-blue-500/10 text-blue-500 border-blue-500/20">
                      {entitlements.skiaCanvasDailyLimit} فيديو / يوم
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    رسم فيكتوري فائق النعومة وبادجات ثلاثية الأبعاد وزجاجية.
                  </p>
                </div>

                {/* Engine 3: Background Cloud Render */}
                <div className="space-y-1.5 pt-2 border-t border-border/40">
                  <div className="flex justify-between text-sm">
                    <span className="flex items-center gap-1.5"><Cpu className="h-4 w-4 text-primary" />الريندر السحابي في الخلفية (Queue & Save)</span>
                    <Badge variant="outline" className="text-[11px] bg-primary/10 text-primary border-primary/20">
                      {entitlements.backgroundAsyncDailyLimit} فيديو / يوم
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    أطلق الريندر وغادر فوراً، وسيقوم السيرفر بحفظ الفيديو بمكتبتك مع إشعار تلقائي.
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
            <Card>
              <CardContent className="p-4">
                <Button asChild variant="outline" className="w-full gap-2">
                  <Link to="/payment-history">
                    <History className="h-4 w-4" />
                    سجل المدفوعات
                  </Link>
                </Button>
              </CardContent>
            </Card>

            {/* Danger Zone: Account Deletion */}
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
          </div>
        </motion.div>
      </div>
    </Layout>
  );
}
