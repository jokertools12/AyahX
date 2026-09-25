import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Image as ImageIcon, Sparkles, Upload, Video, Lock, Wand2, Loader2, RefreshCw } from 'lucide-react';
import { BackgroundItem, backgroundImages, slideshowBackgrounds } from '@/data/backgrounds';
import { CustomBackgroundUploader } from '@/components/CustomBackgroundUploader';
import { PexelsVideoSelector } from '@/components/PexelsVideoSelector';
import { PremiumBadge } from '@/components/PremiumBadge';
import { useSubscription } from '@/hooks/useSubscription';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { isBasicBackground } from '../../shared/planEntitlements';

const PROMPT_SUGGESTIONS = [
  'شروق شمس ذهبي هادئ بين جبال شاهقة وضباب رقيق',
  'مسجد تاريخي بقباب مذهبة وأنوار خافتة في الشفق',
  'أمواج بحر هادئة تحت ضوء القمر الفضي في ليلة صافية',
  'سماء ليلية مرصعة بالنجوم ومجرة لامعة فوق صحراء هادئة',
  'غابة خضراء ندية مع أشعة شمس تخترق أوراق الأشجار',
  'واحة نخيل ساحرة عند الغروب مع انعكاسات مائية هادئة',
];

interface BackgroundSelectorProps {
  selectedBackground: BackgroundItem | null;
  onSelect: (background: BackgroundItem) => void;
  customBackground?: string | null;
  onCustomBackgroundChange?: (url: string | null) => void;
  onCustomBackgroundTypeChange?: (type: 'image' | 'video') => void;
}

export function BackgroundSelector({ 
  selectedBackground, 
  onSelect, 
  customBackground, 
  onCustomBackgroundChange,
  onCustomBackgroundTypeChange,
}: BackgroundSelectorProps) {
  const [activeTab, setActiveTab] = useState<'custom' | 'image' | 'slideshow' | 'pexels' | 'ai'>('image');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiAspectRatio, setAiAspectRatio] = useState<'9:16' | '16:9'>('9:16');
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [generatedAiImages, setGeneratedAiImages] = useState<Array<{ url: string; prompt: string }>>([]);
  const { canUseFeature, isPremium } = useSubscription();

  const renderBackgroundCard = (bg: BackgroundItem) => {
    const isSelected = selectedBackground?.id === bg.id && !customBackground;

    return (
      <motion.div
        key={bg.id}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => {
          onCustomBackgroundChange?.(null); // Clear custom when selecting preset
          onSelect(bg);
        }}
        className={`relative cursor-pointer rounded-xl overflow-hidden border-2 transition-all ${
          isSelected
            ? 'border-primary ring-2 ring-primary/30'
            : 'border-transparent hover:border-primary/50'
        }`}
      >
        <div className="aspect-video relative">
          <img
            src={bg.thumbnail}
            alt={bg.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          
          {/* Type indicator */}
           <div className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 text-white">
             {bg.type === 'animated' ? (
               <Sparkles className="h-3 w-3" />
             ) : (
               <ImageIcon className="h-3 w-3" />
             )}
           </div>

          {/* Slideshow indicator */}
          {bg.slideImages && bg.slideImages.length > 1 && (
            <div className="absolute bottom-8 left-2 px-2 py-0.5 rounded-full bg-primary/80 text-primary-foreground text-xs">
              {bg.slideImages.length} صور
            </div>
          )}

          {/* Selected indicator */}
          {isSelected && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute top-2 left-2 p-1 rounded-full bg-primary text-primary-foreground"
            >
              <Check className="h-4 w-4" />
            </motion.div>
          )}

          {/* Name */}
          <div className="absolute bottom-2 right-2 left-2">
            <p className="text-white text-sm font-medium text-right truncate">
              {bg.name}
            </p>
          </div>
        </div>
      </motion.div>
    );
  };

  const handlePexelsVideoSelect = (videoUrl: string, thumbnailUrl: string) => {
    if (!canUseFeature('pexelsVideos')) {
      toast.error('فيديوهات Pexels متاحة للعضوية المميزة فقط');
      return;
    }
    // Create a custom background item for the Pexels video
    const pexelsBackground: BackgroundItem = {
      id: `pexels-${Date.now()}`,
      name: 'فيديو Pexels',
      url: videoUrl,
      thumbnail: thumbnailUrl,
      type: 'video',
      category: 'nature',
    };
    onCustomBackgroundChange?.(null);
    onSelect(pexelsBackground);
  };

  const handleGenerateAiBackground = async (promptOverride?: string) => {
    if (!canUseFeature('aiBackgrounds')) {
      toast.error('توليد الخلفيات بالذكاء الاصطناعي متاح للعضوية المميزة فقط');
      return;
    }
    const p = (promptOverride || aiPrompt).trim();
    if (!p) {
      toast.error('يرجى كتابة وصف أو اختيار فكرة لتوليد الخلفية');
      return;
    }

    setIsGeneratingAi(true);
    try {
      const res = await api.services.generateAiImage(p, aiAspectRatio, 'cinematic');
      if (res && res.dataUrl) {
        const aiBg: BackgroundItem = {
          id: `ai-${Date.now()}`,
          name: `خلفية بالذكاء الاصطناعي (${p.slice(0, 20)}...)`,
          url: res.dataUrl,
          thumbnail: res.dataUrl,
          type: 'image',
          category: 'nature',
        };
        setGeneratedAiImages(prev => [{ url: res.dataUrl, prompt: p }, ...prev]);
        onCustomBackgroundChange?.(res.dataUrl);
        onCustomBackgroundTypeChange?.('image');
        onSelect(aiBg);
        toast.success('تم توليد وتطبيق الخلفية بالذكاء الاصطناعي بنجاح! ✨');
      }
    } catch (err: any) {
      toast.error(err.message || 'فشل توليد الصورة بالذكاء الاصطناعي');
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const tabDescriptions: Record<string, string> = {
    custom: 'ارفع صورة أو فيديو من جهازك',
    image: isPremium
      ? 'صور إسلامية وطبيعية عالية الجودة مع تأثير Ken Burns للحركة'
      : 'صور إسلامية وطبيعية أساسية ثابتة متاحة ضمن الخطة المجانية',
    slideshow: 'صور متغيرة ومتنوعة تتحرك وتتبدل تلقائياً',
    pexels: 'فيديوهات احترافية من Pexels',
    ai: 'توليد خلفيات فنية سينمائية فريدة بنماذج Gemini Generative Media (Nano Banana)',
  };

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList className="w-full grid grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))] h-auto gap-1">
          <TabsTrigger value="custom" className="gap-1 text-xs sm:text-sm">
            <Upload className="h-4 w-4" />
            <span>رفع</span>
            {!canUseFeature('customBackgrounds') && <Lock className="h-3 w-3 opacity-60" />}
          </TabsTrigger>
          <TabsTrigger value="image" className="gap-1 text-xs sm:text-sm">
            <ImageIcon className="h-4 w-4" />
            <span>صور</span>
          </TabsTrigger>
          <TabsTrigger value="slideshow" className="gap-1 text-xs sm:text-sm">
            <Sparkles className="h-4 w-4" />
            <span>متغيرة</span>
            {!canUseFeature('animatedBackgrounds') && <Lock className="h-3 w-3 opacity-60" />}
          </TabsTrigger>
          <TabsTrigger value="pexels" className="gap-1 text-xs sm:text-sm">
            <Video className="h-4 w-4" />
            <span>فيديو</span>
            {!canUseFeature('pexelsVideos') && <Lock className="h-3 w-3 opacity-60" />}
          </TabsTrigger>
          <TabsTrigger value="ai" className="gap-1 text-xs sm:text-sm data-[state=active]:text-purple-400">
            <Wand2 className="h-4 w-4 text-purple-400" />
            <span>توليد AI</span>
            {!canUseFeature('aiBackgrounds') && <Lock className="h-3 w-3 opacity-60" />}
          </TabsTrigger>
        </TabsList>


        <TabsContent value="custom" className="mt-4">
          {!canUseFeature('customBackgrounds') ? (
            <div className="text-center py-8 space-y-3">
              <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-muted-foreground">رفع الخلفيات المخصصة متاح للعضوية المميزة فقط</p>
              <PremiumBadge showLock />
            </div>
          ) : (
            <CustomBackgroundUploader 
              onUpload={(url, type) => {
                onCustomBackgroundChange?.(url || null);
                if (url && type) onCustomBackgroundTypeChange?.(type);
              }}
              currentBackground={customBackground}
            />
          )}
        </TabsContent>

        <TabsContent value="image" className="mt-4">
          <ScrollArea className="h-[300px] pr-4">
            <div className="grid grid-cols-2 gap-3">
              {(isPremium
                ? backgroundImages
                : backgroundImages.filter((background) => isBasicBackground(background.category, background.type))
              ).map(renderBackgroundCard)}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="slideshow" className="mt-4">
          {!canUseFeature('animatedBackgrounds') ? (
            <div className="text-center py-8 space-y-3">
              <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-muted-foreground">الخلفيات المتغيرة متاحة للأعضاء المميزين فقط</p>
              <PremiumBadge showLock />
            </div>
          ) : (
            <ScrollArea className="h-[300px] pr-4">
              <div className="grid grid-cols-2 gap-3">
                {slideshowBackgrounds.map(renderBackgroundCard)}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="pexels" className="mt-4">
          {!canUseFeature('pexelsVideos') ? (
            <div className="text-center py-8 space-y-3">
              <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-muted-foreground">فيديوهات Pexels متاحة للأعضاء المميزين فقط</p>
              <PremiumBadge showLock />
            </div>
          ) : (
            <PexelsVideoSelector onSelect={handlePexelsVideoSelect} />
          )}
        </TabsContent>

        <TabsContent value="ai" className="mt-4 space-y-4">
          {!canUseFeature('aiBackgrounds') ? (
            <div className="text-center py-8 space-y-3">
              <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-muted-foreground">توليد الخلفيات بالذكاء الاصطناعي متاح للعضوية المميزة فقط</p>
              <PremiumBadge showLock />
            </div>
          ) : <>
          <div className="p-4 rounded-xl border border-purple-500/30 bg-purple-500/5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-purple-500/20 text-purple-300">
                  <Wand2 className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-foreground">توليد خلفيات بصرية بنماذج Gemini (Nano Banana)</h4>
                  <p className="text-xs text-muted-foreground">صمم مشاهد إسلامية وطبيعية حصرية تناسب آياتك ومقاطعك</p>
                </div>
              </div>
              <Badge variant="outline" className="text-xs border-purple-500/30 text-purple-300 bg-purple-500/10">
                Gemini 3 Visual
              </Badge>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium">أبعاد الخلفية المستهدفة:</label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={aiAspectRatio === '9:16' ? 'default' : 'outline'}
                  onClick={() => setAiAspectRatio('9:16')}
                  className="text-xs gap-1.5 h-8"
                >
                  <span>9:16 (ريلز وتيك توك)</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={aiAspectRatio === '16:9' ? 'default' : 'outline'}
                  onClick={() => setAiAspectRatio('16:9')}
                  className="text-xs gap-1.5 h-8"
                >
                  <span>16:9 (يوتيوب عريض)</span>
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium">اكتب وصف المشهد الذي تريده:</label>
              <div className="flex gap-2">
                <Input
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="مثال: شروق شمس ذهبي هادئ بين جبال شاهقة وضباب رقيق..."
                  className="text-xs bg-background/80"
                  disabled={isGeneratingAi}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isGeneratingAi) {
                      handleGenerateAiBackground();
                    }
                  }}
                />
                <Button
                  type="button"
                  onClick={() => handleGenerateAiBackground()}
                  disabled={isGeneratingAi}
                  className="gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shrink-0 text-xs px-4"
                >
                  {isGeneratingAi ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>جاري التوليد...</span>
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-4 w-4" />
                      <span>توليد الآن</span>
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Quick Inspiration Chips */}
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">أفكار مقترحة سريعة:</p>
              <div className="flex flex-wrap gap-1.5">
                {PROMPT_SUGGESTIONS.map((sug, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setAiPrompt(sug);
                      handleGenerateAiBackground(sug);
                    }}
                    disabled={isGeneratingAi}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-muted/60 hover:bg-purple-500/20 hover:text-purple-300 border border-border/50 transition-colors text-right"
                  >
                    + {sug}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Previous Generations in this session */}
          {generatedAiImages.length > 0 && (
            <div className="space-y-2">
              <h5 className="text-xs font-semibold text-muted-foreground">الصور المولدة في هذه الجلسة:</h5>
              <div className="grid grid-cols-3 gap-2">
                {generatedAiImages.map((img, i) => (
                  <div
                    key={i}
                    onClick={() => {
                      const aiBg: BackgroundItem = {
                        id: `ai-history-${i}`,
                        name: `خلفية AI: ${img.prompt.slice(0, 18)}...`,
                        url: img.url,
                        thumbnail: img.url,
                        type: 'image',
                        category: 'nature',
                      };
                      onCustomBackgroundChange?.(img.url);
                      onCustomBackgroundTypeChange?.('image');
                      onSelect(aiBg);
                    }}
                    className={`relative aspect-video rounded-lg overflow-hidden border-2 cursor-pointer transition-all hover:scale-105 ${
                      customBackground === img.url ? 'border-purple-500 ring-2 ring-purple-500/30' : 'border-border/60'
                    }`}
                  >
                    <img src={img.url} alt={img.prompt} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/40 hover:bg-transparent transition-colors" />
                    <span className="absolute bottom-1 right-1 text-[10px] text-white bg-black/60 px-1 rounded truncate max-w-[90%]">
                      {img.prompt}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          </>}
        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground text-center">{tabDescriptions[activeTab]}</p>
    </div>
  );
}
