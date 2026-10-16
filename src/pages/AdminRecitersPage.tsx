import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { BookOpen, Search, ShieldCheck } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { reciters } from '@/data/reciters';

export default function AdminRecitersPage() {
  const { user, loading } = useAuth();
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return reciters;
    return reciters.filter((reciter) => `${reciter.name} ${reciter.englishName} ${reciter.riwayah || ''}`.toLocaleLowerCase().includes(needle));
  }, [query]);

  if (loading) return <Layout><div className="min-h-[50vh]" /></Layout>;
  if (!user) return <Navigate to="/auth" replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;

  return <Layout>
    <div className="container mx-auto max-w-7xl px-4 py-8" dir="rtl">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div><div className="mb-2 flex items-center gap-2 text-primary"><ShieldCheck className="h-5 w-5" aria-hidden="true" /><span className="text-sm font-medium">مركز تحكم الأدمن</span></div><h1 className="text-3xl font-bold">سجل القرّاء والروايات</h1><p className="mt-2 max-w-2xl text-muted-foreground">جرد قراءة فقط للهوية والرواية ومصدر المعاينة. لا يغيّر السجل بيانات القرّاء ولا يفعّل مصدرًا.</p></div>
        <Badge variant="secondary" className="gap-2"><BookOpen className="h-3.5 w-3.5" aria-hidden="true" /> {reciters.length} قارئًا</Badge>
      </header>
      <div className="mb-6 max-w-md"><label htmlFor="admin-reciter-search" className="sr-only">البحث عن قارئ أو رواية</label><div className="relative"><Search className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" /><Input id="admin-reciter-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث عن قارئ أو رواية" className="pr-9" /></div></div>
      <p className="mb-4 text-sm text-muted-foreground">عرض {filtered.length} من {reciters.length}</p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map((reciter) => <Card key={reciter.id} className="border-border/60 bg-card/80"><CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><CardTitle className="text-lg">{reciter.name}</CardTitle><Badge variant="outline">{reciter.style}</Badge></div><p className="text-xs text-muted-foreground">{reciter.englishName}</p></CardHeader><CardContent className="space-y-2 text-sm"><div className="flex justify-between gap-2"><span className="text-muted-foreground">الرواية</span><span>{reciter.riwayah || 'غير محددة'}</span></div><div className="flex justify-between gap-2"><span className="text-muted-foreground">المعرّف</span><code className="text-xs">{reciter.id}</code></div><div className="flex justify-between gap-2"><span className="text-muted-foreground">مصدر المعاينة</span><span>{reciter.server ? 'موثق في الكتالوج' : 'غير محدد'}</span></div>{reciter.quranUniversalSlug && <div className="flex justify-between gap-2"><span className="text-muted-foreground">QUA slug</span><code className="max-w-[60%] truncate text-xs">{reciter.quranUniversalSlug}</code></div>}</CardContent></Card>)}</div>
    </div>
  </Layout>;
}
