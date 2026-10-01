import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { VIDEO_PRESETS, VideoPreset } from '@/data/videoPresets';
import { useSubscription } from '@/hooks/useSubscription';
import { Palette, Check, Lock, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

type Category = 'all' | 'gold' | 'calm' | 'wide';
const matches = (preset: VideoPreset, category: Category) => category === 'all' ||
  (category === 'wide' ? preset.recommendedAspectRatio === '16:9' :
   category === 'gold' ? /gold|dawn|lantern|ramadan|ornate|traditional/.test(preset.id) :
   !/gold|dawn|lantern|ramadan|ornate|traditional/.test(preset.id));

export function PresetSelector({ selectedPresetId, onSelectPreset }: { selectedPresetId?: string; onSelectPreset: (preset: VideoPreset) => void }) {
  const { canUseFeature } = useSubscription();
  const locked = !canUseFeature('premiumTemplates');
  const [category, setCategory] = useState<Category>('all');
  const [search, setSearch] = useState('');
  const filtered = VIDEO_PRESETS.filter(p => matches(p, category) && (p.name + ' ' + p.description).includes(search.trim()));
  return <Card className="overflow-hidden border-border/60">
    <CardHeader className="space-y-3 border-b bg-muted/20 p-4">
      <CardTitle className="flex items-center gap-2 text-base"><Palette className="h-5 w-5 text-primary" />مكتبة القوالب{locked && <Lock className="h-4 w-4 text-amber-500" />}</CardTitle>
      <p className="text-xs leading-relaxed text-muted-foreground">اختر اتجاهاً بصرياً ثم خصّصه في المعاينة. القالب يحدّث الخط والألوان والحركة والخلفية والمقاس؛ يحتفظ بهويتك وإعدادات جودة التصدير.</p>
      <div className="relative"><Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pr-9" aria-label="البحث في القوالب" placeholder="ابحث عن قالب أو لون..." value={search} onChange={e => setSearch(e.target.value)} /></div>
      <div className="flex flex-wrap gap-2" aria-label="تصنيفات القوالب">{([{ id: 'all', label: 'الكل' }, { id: 'gold', label: 'ذهبي وسينمائي' }, { id: 'calm', label: 'هادئ وبسيط' }, { id: 'wide', label: 'عرض أفقي' }] as const).map(c => <Button key={c.id} size="sm" variant={category === c.id ? 'default' : 'outline'} onClick={() => setCategory(c.id)}>{c.label}<span className="mr-2 text-[10px] opacity-70">{VIDEO_PRESETS.filter(p => matches(p, c.id)).length}</span></Button>)}</div>
      {locked && <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-xs">يمكنك استعراض القوالب؛ تطبيقها متاح للعضوية المميزة.</p>}
    </CardHeader>
    <CardContent className="p-3">
      <div className="grid max-h-[620px] grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2">
        {filtered.map(preset => <article key={preset.id} className={cn('overflow-hidden rounded-xl border transition-colors', selectedPresetId === preset.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border/60')}>
          <div className="relative flex h-36 items-center justify-center p-4" style={{ background: preset.previewGradient || '#102033' }}>
            <span className="absolute right-2 top-2 rounded bg-black/40 px-2 py-1 text-[10px] text-white">{preset.recommendedAspectRatio}</span>
            {selectedPresetId === preset.id && <Check className="absolute left-2 top-2 h-5 w-5 text-white" />}
            <div className="w-full rounded-lg p-3 text-center" style={{ border: preset.displaySettings.frameStyle === 'none' ? undefined : '1px solid #d4af3780' }}>
              {preset.displaySettings.showSurahName && <p className="mb-2 text-[10px] text-white/70">سورة الفاتحة</p>}
              <p style={{ color: preset.textSettings.textColor, fontFamily: preset.textSettings.fontFamily, textShadow: preset.displaySettings.textShadowStyle === 'none' ? undefined : '0 2px 8px #000' }} className="text-lg leading-loose">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</p>
              {preset.displaySettings.showAyahNumber && <span className="text-xs text-amber-200">﴿١﴾</span>}
            </div>
          </div>
          <div className="space-y-2 p-3">
            <h3 className="text-sm font-semibold">{preset.name}</h3><p className="min-h-10 text-xs leading-relaxed text-muted-foreground">{preset.description}</p>
            <p className="text-[10px] text-muted-foreground">معاينة توضيحية • قابل للتخصيص • إعدادات الجيل الثاني</p>
            <Button size="sm" className="w-full" variant={selectedPresetId === preset.id ? 'secondary' : 'outline'} disabled={locked} onClick={() => onSelectPreset(preset)}>{selectedPresetId === preset.id ? 'إعادة تطبيق القالب' : 'تطبيق القالب'}</Button>
          </div>
        </article>)}
      </div>
      {!filtered.length && <p className="p-8 text-center text-sm text-muted-foreground">لا توجد قوالب مطابقة. جرّب بحثاً آخر.</p>}
    </CardContent>
  </Card>;
}
