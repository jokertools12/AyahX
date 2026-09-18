import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { VIDEO_PRESETS, VideoPreset } from '@/data/videoPresets';
import { PremiumBadge } from '@/components/PremiumBadge';
import { useSubscription } from '@/hooks/useSubscription';
import {
  Palette,
  Lock,
  Sparkles,
  Check,
  Smartphone,
  Tv,
  Flame,
  Crown,
  Layers,
  Wand2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface PresetSelectorProps {
  selectedPresetId?: string;
  onSelectPreset: (preset: VideoPreset) => void;
}

type PresetCategory = 'all' | 'viral' | 'golden' | 'calm' | 'wide';

export function PresetSelector({ selectedPresetId, onSelectPreset }: PresetSelectorProps) {
  const { canUseFeature } = useSubscription();
  const locked = !canUseFeature('premiumTemplates');
  const [activeCategory, setActiveCategory] = useState<PresetCategory>('all');

  const categories = [
    { id: 'all' as const, label: 'الكل', icon: Layers, count: VIDEO_PRESETS.length },
    { id: 'viral' as const, label: 'ريلز ترند', icon: Flame, count: 6 },
    { id: 'golden' as const, label: 'مذهب وملكي', icon: Crown, count: 6 },
    { id: 'calm' as const, label: 'طبيعة وهدوء', icon: Sparkles, count: 5 },
    { id: 'wide' as const, label: 'يوتيوب 16:9', icon: Tv, count: 3 },
  ];

  const filteredPresets = useMemo(() => {
    switch (activeCategory) {
      case 'viral':
        return VIDEO_PRESETS.filter((p) => p.id === 'quran-minute-gold' || p.id === 'classic-dark' || p.id === 'minimal-white' || p.id === 'ramadan-special' || p.id === 'velvet-gold-portal' || p.id === 'silver-moon-minaret');
      case 'golden':
        return VIDEO_PRESETS.filter((p) => p.id === 'quran-minute-gold' || p.id === 'golden-ornate' || p.id === 'mosque-traditional' || p.id === 'ramadan-special' || p.id === 'velvet-gold-portal' || p.id === 'desert-lantern');
      case 'calm':
        return VIDEO_PRESETS.filter((p) => p.id === 'nature-calm' || p.id === 'ocean-blue' || p.id === 'sunrise-hope' || p.id === 'ivory-quiet-page' || p.id === 'blue-hour-celestial');
      case 'wide':
        return VIDEO_PRESETS.filter((p) => p.recommendedAspectRatio === '16:9');
      default:
        return VIDEO_PRESETS;
    }
  }, [activeCategory]);

  const handleApply = (preset: VideoPreset) => {
    onSelectPreset(preset);
  };

  return (
    <Card className="border-border/60 shadow-lg bg-card/95 backdrop-blur-sm overflow-hidden">
      <CardHeader className="pb-3 border-b border-border/40 bg-muted/20">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-base sm:text-lg flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/15 text-primary">
                <Palette className="h-4 w-4" />
              </div>
              <span>مكتبة القوالب السينمائية الجاهزة</span>
              {locked && <Lock className="h-4 w-4 text-amber-500 mr-1" />}
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              قوالب تصاميم احترافية جاهزة بنقرة واحدة مستوحاة من أشهر صناع محتوى القرآن الكريم
            </CardDescription>
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            {categories.map((cat) => {
              const Icon = cat.icon;
              const isActive = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={cn(
                    'px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20 scale-[1.02]'
                      : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <Icon className="h-3 w-3" />
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-3 sm:p-4">
        {locked ? (
          <div className="text-center py-12 px-4 space-y-4 rounded-xl border border-dashed border-amber-500/30 bg-amber-500/5">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto ring-8 ring-amber-500/5">
              <Crown className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">قوالب الريلز الاحترافية مخصصة للأعضاء</h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                قم بالترقية للوصول الفوري لكافة قوالب الفيديوهات الحصرية بدون قيود وبجودة Ultra HD 4K
              </p>
            </div>
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary leading-relaxed">
              الاتجاهات البصرية الثلاثة — فجر ذهبي، مصحف تحريري، وأفق قمري — متاحة داخل القوالب الفاخرة ويمكن تطبيقها فوراً على المعاينة والتصدير.
            </div>
            <PremiumBadge showLock />
          </div>
        ) : (
          <ScrollArea className="h-[420px] pr-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 pb-2">
              {filteredPresets.map((preset, index) => {
                const isSelected = selectedPresetId === preset.id;
                const isSignature = preset.id === 'quran-minute-gold';

                return (
                  <div
                    key={preset.id}
                    onClick={() => handleApply(preset)}
                    className={cn(
                      'group relative cursor-pointer rounded-xl border transition-all duration-200 overflow-hidden flex flex-col',
                      'hover:shadow-md hover:scale-[1.01]',
                      isSelected
                        ? 'border-primary ring-2 ring-primary/30 bg-primary/5 shadow-md shadow-primary/10'
                        : isSignature
                        ? 'border-amber-500/50 bg-gradient-to-b from-amber-500/5 to-card hover:border-amber-500'
                        : 'border-border/60 bg-card hover:border-border hover:bg-muted/30'
                    )}
                  >
                    {/* Visual Card Banner / Preview Mockup */}
                    <div
                      className="relative h-24 w-full p-3 flex flex-col justify-between overflow-hidden"
                      style={{ background: preset.previewGradient || '#1a1a1a' }}
                    >
                      {/* Ambient highlight overlay */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 pointer-events-none" />

                      {/* Top Badges: Aspect ratio & Quality */}
                      <div className="relative z-10 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-black/60 text-white/90 backdrop-blur-md border border-white/10">
                            {preset.recommendedAspectRatio === '16:9' ? (
                              <>
                                <Tv className="h-2.5 w-2.5" />
                                16:9 يوتيوب
                              </>
                            ) : (
                              <>
                                <Smartphone className="h-2.5 w-2.5" />
                                9:16 ريلز
                              </>
                            )}
                          </span>

                          {isSignature && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500 text-black shadow-sm">
                              <Flame className="h-2.5 w-2.5 fill-current" />
                              الأكثر طلباً
                            </span>
                          )}
                        </div>

                        {isSelected && (
                          <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md">
                            <Check className="h-3 w-3 stroke-[3]" />
                          </span>
                        )}
                      </div>

                      {/* Mockup Quran text line in banner */}
                      <div className="relative z-10 text-center py-1">
                        <p className="text-white/90 font-serif text-sm tracking-wide drop-shadow-sm line-clamp-1">
                          {isSignature ? 'أُولَٰئِكَ هُمُ الْوَارِثُونَ ﴿١٠﴾' : 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ'}
                        </p>
                      </div>

                      {/* Feature mini chips */}
                      <div className="relative z-10 flex items-center gap-1 text-[9px] text-white/70">
                        {preset.displaySettings.textShadowStyle === 'none' && (
                          <span className="bg-white/15 px-1.5 py-0.2 rounded backdrop-blur-xs">بدون ظل</span>
                        )}
                        {preset.displaySettings.logoWatermarkEnabled && (
                          <span className="bg-amber-400/20 text-amber-200 px-1.5 py-0.2 rounded backdrop-blur-xs">ختم ذهبي</span>
                        )}
                        {preset.displaySettings.ayahNumberStyle === 'quran3d' && (
                          <span className="bg-amber-400/20 text-amber-200 px-1.5 py-0.2 rounded backdrop-blur-xs">قوس 3D</span>
                        )}
                      </div>
                    </div>

                    {/* Card Body */}
                    <div className="p-3 flex-1 flex flex-col justify-between space-y-2">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs sm:text-sm font-semibold text-foreground flex items-center gap-1.5">
                            {preset.name}
                            {isSignature && <Sparkles className="h-3.5 w-3.5 text-amber-500" />}
                          </h4>
                          <span className="text-[10px] text-muted-foreground uppercase font-mono">
                            {preset.exportQuality === 'ultra' ? '4K Ultra' : '1080p FHD'}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                          {preset.description}
                        </p>
                      </div>

                      {/* Apply button */}
                      <div className="pt-2 border-t border-border/40">
                        <Button
                          variant={isSelected ? 'default' : 'outline'}
                          size="sm"
                          className={cn(
                            'w-full h-7 text-xs font-medium gap-1.5 transition-all',
                            isSelected
                              ? 'bg-primary text-primary-foreground shadow-sm'
                              : 'hover:bg-primary/10 hover:text-primary hover:border-primary/40'
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleApply(preset);
                          }}
                        >
                          {isSelected ? (
                            <>
                              <Check className="h-3 w-3" />
                              تم تطبيق القالب
                            </>
                          ) : (
                            <>
                              <Wand2 className="h-3 w-3" />
                              تطبيق القالب
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
