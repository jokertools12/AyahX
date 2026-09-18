import { useState } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { Loader2, BookOpen, Mail, Lock, AlertCircle, Eye, EyeOff, User, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

const emailSchema = z.string().email('الرجاء إدخال بريد إلكتروني صحيح');
const passwordSchema = z.string().min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل').max(72, 'كلمة المرور يجب أن لا تزيد عن 72 حرفاً');

export default function AuthPage() {
  const navigate = useNavigate();
  const { signIn, signUp, isAuthenticated } = useAuth();

  const [activeTab, setActiveTab] = useState<'login' | 'register' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  // Password visibility toggles
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showRegisterConfirm, setShowRegisterConfirm] = useState(false);

  // Caps Lock and keyboard detection
  const [isCapsLockOn, setIsCapsLockOn] = useState(false);
  const handleKeyCheck = (e: React.KeyboardEvent) => {
    if (typeof e.getModifierState === 'function') {
      setIsCapsLockOn(e.getModifierState('CapsLock'));
    }
  };
  const hasArabic = (text: string) => /[\u0600-\u06FF]/.test(text);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect if already authenticated
  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const validateForm = (isSignUp: boolean): boolean => {
    setError(null);

    const cleanEmail = email.trim().toLowerCase();
    const emailResult = emailSchema.safeParse(cleanEmail);
    if (!emailResult.success) {
      setError(emailResult.error.errors[0].message);
      return false;
    }

    const passwordResult = passwordSchema.safeParse(password);
    if (!passwordResult.success) {
      setError(passwordResult.error.errors[0].message);
      return false;
    }

    if (isSignUp && password !== confirmPassword) {
      setError('كلمتا المرور غير متطابقتين');
      return false;
    }

    if (isSignUp && !acceptedTerms) {
      setError('يرجى الموافقة على شروط الاستخدام وسياسة الخصوصية لإكمال إنشاء الحساب');
      return false;
    }

    return true;
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm(false)) return;

    setLoading(true);
    setError(null);

    const cleanEmail = email.trim().toLowerCase();
    const { error } = await signIn(cleanEmail, password);

    if (error) {
      setError(error.message || 'البريد الإلكتروني أو كلمة المرور غير صحيحة');
    } else {
      toast.success('تم تسجيل الدخول بنجاح!');
      navigate('/');
    }

    setLoading(false);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm(true)) return;

    setLoading(true);
    setError(null);

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = displayName.trim() || undefined;
    const { error } = await signUp(cleanEmail, password, cleanName);

    if (error) {
      setError(error.message || 'حدث خطأ أثناء إنشاء الحساب');
    } else {
      toast.success('تم إنشاء الحساب وتسجيل الدخول بنجاح!');
      navigate('/');
    }

    setLoading(false);
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md mx-auto"
        >
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl gradient-primary mb-4 shadow-lg shadow-primary/20">
              <BookOpen className="h-8 w-8 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold font-quran">مرحباً بك في قرآن ريلز</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              سجل دخولك لحفظ مقاطعك ومشاركتها مع الجمهور
            </p>
          </div>

          <Card className="border-border/60 shadow-xl">
            <Tabs value={activeTab} onValueChange={(val: any) => { setActiveTab(val); setError(null); }}>
              <CardHeader className="pb-4">
                <TabsList className="w-full">
                  <TabsTrigger value="login" className="flex-1">
                    تسجيل الدخول
                  </TabsTrigger>
                  <TabsTrigger value="register" className="flex-1">
                    حساب جديد
                  </TabsTrigger>
                  <TabsTrigger value="reset" className="flex-1">
                    استعادة كلمة المرور
                  </TabsTrigger>
                </TabsList>
              </CardHeader>

              <CardContent>
                {/* Error Message Alert */}
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive mb-4 border border-destructive/20"
                    role="alert"
                    aria-live="assertive"
                  >
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span className="text-sm">{error}</span>
                  </motion.div>
                )}

                {/* Login Form */}
                <TabsContent value="login">
                  <form onSubmit={handleSignIn} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="login-email">البريد الإلكتروني</Label>
                      <div className="relative">
                        <Mail className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                          id="login-email"
                          type="email"
                          placeholder="example@email.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="pr-10"
                          required
                          autoComplete="username email"
                          dir="ltr"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="login-password">كلمة المرور</Label>
                        <button
                          type="button"
                          onClick={() => { setActiveTab('reset'); setError(null); }}
                          className="text-xs text-primary hover:underline"
                        >
                          نسيت كلمة المرور؟
                        </button>
                      </div>
                      <div className="relative">
                        <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                          id="login-password"
                          type={showLoginPassword ? "text" : "password"}
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          onKeyDown={handleKeyCheck}
                          onKeyUp={handleKeyCheck}
                          className="pr-10 pl-11 font-sans text-left tracking-wider"
                          required
                          autoComplete="current-password"
                          dir="ltr"
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => setShowLoginPassword(!showLoginPassword)}
                          className="absolute left-1.5 top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors focus:outline-none z-10"
                          aria-label={showLoginPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                        >
                          {showLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      {isCapsLockOn && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-1">
                          <span>⚠️ زر الحروف الكبيرة (Caps Lock) مفعّل</span>
                        </p>
                      )}
                      {hasArabic(password) && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-1">
                          <span>⚠️ انتبه: أنت تكتب حروفاً عربية، تأكد من لغة لوحة المفاتيح إذا كانت كلمة مرورك بالإنجليزية</span>
                        </p>
                      )}
                    </div>

                    <Button type="submit" className="w-full font-semibold" disabled={loading}>
                      {loading && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
                      تسجيل الدخول
                    </Button>
                  </form>
                </TabsContent>

                {/* Register Form */}
                <TabsContent value="register">
                  <form onSubmit={handleSignUp} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="register-name">الاسم / اللقب (اختياري)</Label>
                      <div className="relative">
                        <User className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                          id="register-name"
                          type="text"
                          placeholder="اسمك أو لقبك"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          className="pr-10"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="register-email">البريد الإلكتروني</Label>
                      <div className="relative">
                        <Mail className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                          id="register-email"
                          type="email"
                          placeholder="example@email.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="pr-10"
                          required
                          autoComplete="username email"
                          dir="ltr"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="register-password">كلمة المرور</Label>
                      <div className="relative">
                        <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                          id="register-password"
                          type={showRegisterPassword ? "text" : "password"}
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          onKeyDown={handleKeyCheck}
                          onKeyUp={handleKeyCheck}
                          className="pr-10 pl-11 font-sans text-left tracking-wider"
                          required
                          autoComplete="new-password"
                          dir="ltr"
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                          className="absolute left-1.5 top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors focus:outline-none z-10"
                          aria-label={showRegisterPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                        >
                          {showRegisterPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground">6 أحرف على الأقل</p>
                      {isCapsLockOn && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-1">
                          <span>⚠️ زر الحروف الكبيرة (Caps Lock) مفعّل</span>
                        </p>
                      )}
                      {hasArabic(password) && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-1">
                          <span>⚠️ انتبه: أنت تكتب حروفاً عربية، تأكد من لغة لوحة المفاتيح</span>
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="confirm-password">تأكيد كلمة المرور</Label>
                      <div className="relative">
                        <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                          id="confirm-password"
                          type={showRegisterConfirm ? "text" : "password"}
                          placeholder="••••••••"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          onKeyDown={handleKeyCheck}
                          onKeyUp={handleKeyCheck}
                          className="pr-10 pl-11 font-sans text-left tracking-wider"
                          required
                          autoComplete="new-password"
                          dir="ltr"
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => setShowRegisterConfirm(!showRegisterConfirm)}
                          className="absolute left-1.5 top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors focus:outline-none z-10"
                          aria-label={showRegisterConfirm ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                        >
                          {showRegisterConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5 rounded-lg border border-border/70 bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={acceptedTerms}
                        onChange={(event) => setAcceptedTerms(event.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                      />
                      <span>
                        أوافق على <Link to="/terms" className="font-medium text-primary hover:underline">شروط الاستخدام</Link> و<Link to="/privacy" className="font-medium text-primary hover:underline">سياسة الخصوصية</Link>.
                      </span>
                    </div>

                    <Button type="submit" className="w-full font-semibold" disabled={loading}>
                      {loading && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
                      إنشاء حساب جديد
                    </Button>
                  </form>
                </TabsContent>

                {/* Password recovery must verify ownership; an email address alone is not proof. */}
                <TabsContent value="reset">
                  <div className="space-y-5 py-2 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <KeyRound className="h-6 w-6" />
                    </div>
                    <div className="space-y-2">
                      <h2 className="font-semibold">استعادة آمنة للحساب</h2>
                      <p className="text-sm leading-6 text-muted-foreground">
                        حفاظاً على حسابك، لا يمكن تغيير كلمة المرور بمجرد إدخال البريد الإلكتروني. تواصل مع الدعم للتحقق من ملكية الحساب بأمان.
                      </p>
                    </div>
                    <Button asChild className="w-full font-semibold">
                      <Link to="/contact">التواصل مع الدعم</Link>
                    </Button>
                    <button
                      type="button"
                      onClick={() => { setActiveTab('login'); setError(null); }}
                      className="text-xs text-muted-foreground hover:text-foreground underline"
                    >
                      العودة إلى تسجيل الدخول
                    </button>
                  </div>
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>

          {/* Info */}
          <p className="text-center text-xs text-muted-foreground mt-6">
            بإنشائك حساباً، ستتمكن من حفظ الفيديوهات والمفضلة في مكتبتك الشخصية بأمان
          </p>
        </motion.div>
      </div>
    </Layout>
  );
}
