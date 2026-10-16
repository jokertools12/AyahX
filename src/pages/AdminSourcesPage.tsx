import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Database, Loader2, ShieldCheck, Server } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { api, type QuranSourceCandidate } from '@/lib/api';

const evidenceLabels: Array<keyof Pick<QuranSourceCandidate, 'endpoint' | 'license' | 'storage' | 'cors' | 'rateLimits' | 'identity'>> = [
  'endpoint', 'license', 'storage', 'cors', 'rateLimits', 'identity',
];

const activationGapLabels: Record<string, string> = {
  production_disabled: 'التفعيل الإنتاجي متوقف',
  revision_missing: 'لا توجد نسخة مثبتة',
  endpoint_unverified: 'نقطة الوصول غير موثقة',
  license_unverified: 'الترخيص غير موثق',
  storage_unverified: 'التخزين غير موثق',
  cors_unverified: 'CORS غير موثق',
  rateLimits_unverified: 'حدود المعدل غير موثقة',
  identity_unverified: 'الهوية غير موثقة',
};

export default function AdminSourcesPage() {
  const { user, loading: authLoading } = useAuth();
  const [sources, setSources] = useState<QuranSourceCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof api.admin.getOverview>> | null>(null);

  useEffect(() => {
    if (!user || user.role !== 'admin') return;
    Promise.all([api.quran.getSources(), api.admin.getOverview()]).then(([result, summary]) => {
      setSources(result.sources);
      setOverview(summary);
    }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'تعذر تحميل سجل المصادر');
    }).finally(() => setLoading(false));
  }, [user]);

  if (authLoading) return <Layout><div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" aria-label="جاري التحقق" /></div></Layout>;
  if (!user) return <Navigate to="/auth" replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;

  return (
    <Layout>
      <div className="container mx-auto max-w-7xl px-4 py-8" dir="rtl">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-primary"><ShieldCheck className="h-5 w-5" aria-hidden="true" /><span className="text-sm font-medium">مركز تحكم الأدمن</span></div>
            <h1 className="text-3xl font-bold">سجل مصادر القرآن والتزامن</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">جرد مراجعة للمرشحين. وجود المصدر هنا لا يفعّله ولا يمنح صلاحية استخدامه.</p>
          </div>
          <Badge variant="secondary" className="gap-2"><Database className="h-3.5 w-3.5" aria-hidden="true" /> مراجعة فقط</Badge>
        </header>

        {error && <div role="alert" className="mb-6 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{error}</div>}
        {loading ? <div className="flex min-h-[30vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin motion-reduce:animate-none text-primary" aria-label="جاري تحميل المصادر" /></div> : (
          <>
          {overview && <section aria-label="ملخص حالة النظام" className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card><CardContent className="flex items-center gap-3 p-4"><Server className="h-5 w-5 text-primary" aria-hidden="true" /><div><p className="text-xs text-muted-foreground">قاعدة البيانات</p><p className="font-semibold">{overview.database.status === 'connected' ? 'متصلة' : 'متدهورة'} · {overview.database.latencyMs}ms</p></div></CardContent></Card>
            <Card><CardContent className="flex items-center gap-3 p-4"><Database className="h-5 w-5 text-primary" aria-hidden="true" /><div><p className="text-xs text-muted-foreground">التخزين</p><p className="font-semibold">{overview.storage.ready ? overview.storage.driver : 'غير جاهز'}</p></div></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">المصادر</p><p className="font-semibold">{overview.sources.reviewPending} قيد المراجعة · {overview.sources.activationReady} جاهز</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">محرك الرندر الافتراضي</p><p className="font-semibold">{overview.renderPolicy.defaultEngine || 'غير متاح'}</p></CardContent></Card>
          </section>}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sources.map((source) => {
              const verified = evidenceLabels.filter((field) => source[field].status === 'verified').length;
              const activationGaps = source.activationGaps || [];
              return <Card key={source.id} className="border-border/60 bg-card/80">
                <CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><CardTitle className="text-lg">{source.id}</CardTitle><Badge variant={source.productionEnabled ? 'default' : 'outline'}>{source.productionEnabled ? 'مفعّل' : 'معطّل'}</Badge></div><p className="text-xs text-muted-foreground">{source.reference || 'مرجع يحتاج توثيقًا'}{source.revision ? ` · ${source.revision}` : ''}</p></CardHeader>
                <CardContent className="space-y-4"><div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">أدلة موثقة</span><span className="font-semibold">{verified}/{evidenceLabels.length}</span></div><div className="flex flex-wrap gap-2">{evidenceLabels.map((field) => <Badge key={field} variant={source[field].status === 'verified' || source[field].status === 'not_applicable' ? 'secondary' : 'outline'} className="gap-1 text-xs">{source[field].status === 'verified' ? <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> : null}{field}</Badge>)}</div><div className="flex flex-wrap gap-1">{source.kinds.map((kind) => <span key={kind} className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{kind}</span>)}</div>{activationGaps.length > 0 ? <div role="status" aria-label="أسباب منع التفعيل" className="border-t border-border/50 pt-3"><p className="mb-2 text-xs font-medium text-muted-foreground">ما يلزم قبل التفعيل</p><ul className="space-y-1 text-xs text-muted-foreground">{activationGaps.map((gap) => <li key={gap}>{activationGapLabels[gap] || gap}</li>)}</ul></div> : <div role="status" className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3 w-3" aria-hidden="true" />جاهز للمراجعة النهائية</div>}</CardContent>
              </Card>;
            })}
          </div>
          </>
        )}
      </div>
    </Layout>
  );
}
