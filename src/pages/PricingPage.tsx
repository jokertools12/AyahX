import { useState } from 'react';
import { motion } from 'framer-motion';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { api } from '@/lib/api';
import { Check, Crown, Sparkles, Smartphone, Loader2, Star, Video, Type, Image as ImageIcon, Music, Shield, Cpu, Zap, ShieldCheck, ReceiptText, Clock3, Headphones, CheckCircle2, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { SUBSCRIPTION_CATALOG, type CheckoutPlan, type WalletMethod } from '../../shared/subscriptionCatalog';

const phoneSchema = z.string().regex(/^01[0-9]{9}$/, 'رقم هاتف مصري غير صحيح');

const PLANS = Object.values(SUBSCRIPTION_CATALOG);

const WALLET_OPTIONS: { id: WalletMethod; name: string; color: string }[] = [
  { id: 'vodafone_cash', name: 'فودافون كاش', color: 'bg-red-500' },
  { id: 'etisalat_cash', name: 'اتصالات كاش', color: 'bg-green-600' },
  { id: 'orange_cash', name: 'أورانج كاش', color: 'bg-orange-500' },
  { id: 'we_pay', name: 'وي باي', color: 'bg-purple-600' },
];

const PREMIUM_FEATURES_LIST = [
  { icon: Cpu, text: '15 ريندر سحابي فائق الجودة يومياً (25 للسنوي)' },
  { icon: Zap, text: 'أولوية قصوى في طابور المعالجة السحابية' },
  { icon: Video, text: 'توليد غير محدود عبر محرك المتصفح الفوري' },
  { icon: Video, text: 'تصدير سينمائي 4K Ultra HD و 60 FPS' },
  { icon: Music, text: 'صوت استوديو ماستر 320 kbps نقي' },
  { icon: ImageIcon, text: 'فيديوهات Pexels وتوليد خلفيات بالذكاء الاصطناعي' },
  { icon: Sparkles, text: 'خلفيات متغيرة ومتحركة' },
  { icon: Type, text: 'جميع الخطوط العثمانية والعربية' },
  { icon: Crown, text: 'شعار وهوية مخصصة وتوليد لوجو AI' },
  { icon: Shield, text: 'فلاتر صوتية هندسية وحماية الحقوق' },
  { icon: Star, text: 'قوالب جاهزة ملكية وفخمة' },
  { icon: Star, text: 'دعم فني ذو أولوية خاصة' },
];

const FREE_FEATURES = [
  '5 عمليات إنشاء يومياً عبر محرك المتصفح الفوري (Browser Canvas)',
  'تجربة الريندر السحابي الفائق (1 فيديو يومياً مجاناً)',
  'خلفيات صور إسلامية وطبيعية أساسية',
  'خطوط عربية أساسية',
  'دقة تصدير 720p و 1080p بمعدل 30 إطار/ثانية',
];

export default function PricingPage() {
  const { user, isAuthenticated } = useAuth();
  const { isPremium, subscription } = useSubscription();
  const [selectedPlan, setSelectedPlan] = useState<CheckoutPlan>('monthly');
  const [selectedWallet, setSelectedWallet] = useState<WalletMethod>('vodafone_cash');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [transferReference, setTransferReference] = useState('');
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [submittedRequestId, setSubmittedRequestId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPayment, setShowPayment] = useState(false);

  const checkout = SUBSCRIPTION_CATALOG[selectedPlan];

  const handleSubmitPayment = async () => {
    if (!isAuthenticated || !user) {
      toast.error('يجب تسجيل الدخول أولاً');
      return;
    }

    const phoneResult = phoneSchema.safeParse(phoneNumber);
    if (!phoneResult.success) {
      toast.error(phoneResult.error.errors[0].message);
      return;
    }
    if (!paymentConfirmed) {
      toast.error('يرجى تأكيد إتمام التحويل بالمبلغ الظاهر قبل إرسال الطلب');
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.subscriptions.requestPayment({
        plan: selectedPlan,
        amount: checkout.walletAmountEgp,
        payment_method: selectedWallet,
        phone_number: phoneNumber,
        transfer_reference: transferReference.trim() || undefined,
      });
      setSubmittedRequestId(result.id);
      toast.success('تم تسجيل طلب الاشتراك بنجاح!');
      setPhoneNumber('');
      setTransferReference('');
      setPaymentConfirmed(false);
    } catch (err: any) {
      toast.error(err.message || 'حدث خطأ أثناء إرسال الطلب');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-6xl">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <Badge className="mb-4 px-4 py-1.5 text-sm border border-primary/20 bg-primary/5 text-primary" variant="secondary">
            <Crown className="h-4 w-4 ml-1" />
            خطط الاشتراك
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            اختر <span className="gradient-text">خطتك المناسبة</span>
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            خطط واضحة، حدود يومية شفافة، وتفعيل يدوي آمن للمحافظ الإلكترونية.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1.5"><ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />لا تُفعّل المزايا قبل مراجعة الدفع</span>
            <span className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1.5"><Clock3 className="h-3.5 w-3.5 text-primary" />تتجدد الحصص يومياً</span>
            <span className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1.5"><Headphones className="h-3.5 w-3.5 text-primary" />دعم أولوية للمميزين</span>
          </div>
        </motion.div>

        {/* Plans */}
        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto mb-12">
          {/* Free Plan */}
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}>
            <Card className="h-full relative border-border/70 bg-gradient-to-b from-card to-muted/20">
              <CardHeader className="text-center pb-2">
                <CardTitle className="text-2xl">مجاني</CardTitle>
                <CardDescription>للتجربة والاستخدام البسيط</CardDescription>
                <div className="text-4xl font-bold mt-4">$0</div>
                <p className="text-xs text-muted-foreground mt-2">لا يلزم بطاقة أو تحويل</p>
              </CardHeader>
              <CardContent className="space-y-4">
                {FREE_FEATURES.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-muted-foreground">
                    <Check className="h-4 w-4 text-primary" />
                    <span>{f}</span>
                  </div>
                ))}
                {!isAuthenticated ? (
                  <Button asChild className="w-full mt-4" variant="outline">
                    <Link to="/auth">سجل مجاناً</Link>
                  </Button>
                ) : !isPremium ? (
                  <Button disabled className="w-full mt-4" variant="outline">الخطة الحالية</Button>
                ) : null}
              </CardContent>
            </Card>
          </motion.div>

          {/* Premium Plan */}
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}>
            <Card className="h-full relative border-primary/50 shadow-xl shadow-primary/10 bg-gradient-to-b from-primary/[0.07] via-card to-card">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="gradient-primary text-primary-foreground px-4">
                  <Star className="h-3 w-3 ml-1" />
                  الأكثر شعبية
                </Badge>
              </div>
              <CardHeader className="text-center pb-2">
                <CardTitle className="text-2xl flex items-center justify-center gap-2">
                  <Crown className="h-6 w-6 text-primary" />
                  العضوية المميزة
                </CardTitle>
                <CardDescription>لصناع المحتوى الاحترافي</CardDescription>
                <div className="mt-4">
                  <div className="text-4xl font-bold">$10<span className="text-lg font-normal text-muted-foreground">/شهر</span></div>
                  <p className="text-sm text-muted-foreground mt-1">أو $96/سنة — وفر 20%</p>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {PREMIUM_FEATURES_LIST.map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <f.icon className="h-4 w-4 text-primary" />
                    <span className="font-medium">{f.text}</span>
                  </div>
                ))}
                {isPremium ? (
                  <Button disabled className="w-full mt-4">مشترك بالفعل ✓</Button>
                ) : (
                  <Button className="w-full mt-4 gradient-primary text-primary-foreground" onClick={() => {
                    if (!isAuthenticated) { toast.error('سجّل الدخول أولاً ثم أكمل طلب الترقية'); return; }
                    setShowPayment(true);
                  }}>
                    ابدأ طلب الاشتراك
                  </Button>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Payment Form */}
        {showPayment && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto">
            {submittedRequestId ? (
              <Card className="border-emerald-500/35 bg-gradient-to-b from-emerald-500/[0.07] to-card">
                <CardContent className="py-10 text-center space-y-4">
                  <div className="h-14 w-14 rounded-full bg-emerald-500/15 text-emerald-600 mx-auto flex items-center justify-center">
                    <CheckCircle2 className="h-8 w-8" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">تم تسجيل طلب الدفع</h2>
                    <p className="text-sm text-muted-foreground mt-2">رقم المتابعة: <span className="font-mono font-semibold text-foreground">{submittedRequestId}</span></p>
                  </div>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">سيراجع الفريق التحويل ثم يفعّل الخطة المختارة. ستظهر النتيجة في الإشعارات وسجل المدفوعات.</p>
                  <div className="flex justify-center gap-3 pt-2">
                    <Button asChild className="gap-2"><Link to="/payment-history"><ReceiptText className="h-4 w-4" />متابعة الطلب</Link></Button>
                    <Button variant="outline" onClick={() => { setShowPayment(false); setSubmittedRequestId(null); }}>العودة للأسعار</Button>
                  </div>
                </CardContent>
              </Card>
            ) : <Card className="border-primary/30 shadow-xl shadow-primary/5 overflow-hidden">
              <div className="h-1 bg-gradient-to-l from-primary via-amber-400 to-primary" />
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Smartphone className="h-5 w-5" />
                  طلب تفعيل العضوية المميزة
                </CardTitle>
                <CardDescription>
                  أكمل ثلاث خطوات قصيرة. المبلغ يُثبت من الخادم بحسب الخطة المختارة.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Plan Selection */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2"><span className="h-5 w-5 rounded-full bg-primary text-primary-foreground text-[11px] inline-flex items-center justify-center">1</span>اختر مدة العضوية</Label>
                  <RadioGroup value={selectedPlan} onValueChange={(value) => setSelectedPlan(value as CheckoutPlan)} className="grid grid-cols-2 gap-3">
                    {PLANS.map(plan => (
                      <div key={plan.id} className="relative">
                        <RadioGroupItem value={plan.id} id={`plan-${plan.id}`} className="peer sr-only" />
                        <Label htmlFor={`plan-${plan.id}`} className="flex flex-col items-center p-4 rounded-xl border-2 border-muted cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 transition-all">
                          {'savingsPercent' in plan && <Badge className="mb-2 text-xs" variant="secondary">وفر {plan.savingsPercent}%</Badge>}
                          <span className="font-bold text-lg">{plan.name}</span>
                          <span className="text-primary font-bold">{plan.walletAmountEgp.toLocaleString('ar-EG')} ج.م</span>
                          <span className="text-[11px] text-muted-foreground">${plan.usdPrice}/{plan.billingPeriod === 'month' ? 'شهر' : 'سنة'}</span>
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>

                {/* Wallet Selection */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2"><span className="h-5 w-5 rounded-full bg-primary text-primary-foreground text-[11px] inline-flex items-center justify-center">2</span>اختر المحفظة وأكّد التحويل</Label>
                  <RadioGroup value={selectedWallet} onValueChange={(value) => setSelectedWallet(value as WalletMethod)} className="grid grid-cols-2 gap-3">
                    {WALLET_OPTIONS.map(w => (
                      <div key={w.id} className="relative">
                        <RadioGroupItem value={w.id} id={`wallet-${w.id}`} className="peer sr-only" />
                        <Label htmlFor={`wallet-${w.id}`} className="flex items-center gap-2 p-3 rounded-xl border-2 border-muted cursor-pointer peer-data-[state=checked]:border-primary transition-all">
                          <div className={`h-3 w-3 rounded-full ${w.color}`} />
                          <span className="text-sm font-medium">{w.name}</span>
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>

                <div className="rounded-xl border border-primary/25 bg-primary/[0.045] p-4 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground">حوّل الآن إلى</span>
                    <span className="font-mono font-bold text-primary" dir="ltr">01098959911</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground">المبلغ المطلوب لخطة {checkout.name}</span>
                    <span className="text-xl font-bold">{checkout.walletAmountEgp.toLocaleString('ar-EG')} <small className="text-sm">ج.م</small></span>
                  </div>
                </div>

                {/* Phone Number */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>رقم الهاتف الذي حوّلت منه</Label>
                    <Input placeholder="01XXXXXXXXX" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value.replace(/\D/g, ''))} maxLength={11} className="text-left direction-ltr" inputMode="numeric" dir="ltr" />
                  </div>
                  <div className="space-y-2">
                    <Label>رقم العملية (اختياري)</Label>
                    <Input placeholder="مثال: 123456" value={transferReference} onChange={e => setTransferReference(e.target.value)} maxLength={100} className="text-left direction-ltr" dir="ltr" />
                  </div>
                </div>

                <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/30 transition-colors">
                  <input type="checkbox" checked={paymentConfirmed} onChange={(event) => setPaymentConfirmed(event.target.checked)} className="mt-1 h-4 w-4 accent-primary" />
                  <span className="text-sm text-muted-foreground">أؤكد أنني حوّلت مبلغ <strong className="text-foreground">{checkout.walletAmountEgp.toLocaleString('ar-EG')} ج.م</strong> من رقم الهاتف المدخل، وأفهم أن التفعيل يتم بعد المراجعة.</span>
                </label>

                <div className="rounded-lg bg-muted/50 border p-3 text-xs text-muted-foreground flex gap-2">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
                  <span>لا تحفظ المنصة بيانات المحفظة السرية أو رمز التأكيد. نطلب فقط رقم المرسل ورقم العملية لتسهيل المراجعة.</span>
                </div>

                <div className="flex gap-3">
                  <Button onClick={handleSubmitPayment} disabled={submitting || !paymentConfirmed} className="flex-1 gradient-primary text-primary-foreground gap-2">
                    {submitting && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
                    {submitting ? 'جاري إرسال الطلب...' : 'تأكيد وإرسال الطلب'}
                    {!submitting && <ArrowLeft className="h-4 w-4" />}
                  </Button>
                  <Button variant="outline" onClick={() => { setShowPayment(false); setPaymentConfirmed(false); }}>إلغاء</Button>
                </div>
              </CardContent>
            </Card>}
          </motion.div>
        )}
      </div>
    </Layout>
  );
}
