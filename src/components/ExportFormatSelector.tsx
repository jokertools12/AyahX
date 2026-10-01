import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SettingsSection } from '@/components/SettingsSection';
import { Download, FileVideo, Settings2, Cpu, Film, Sparkles, Zap, ShieldCheck, Lock } from 'lucide-react';
import { ExportQuality, QUALITY_PRESETS } from '@/hooks/useVideoRecorder';
import { useSubscription } from '@/hooks/useSubscription';
import { toast } from 'sonner';

export type ExportFormat = 'mp4' | 'webm' | 'gif';
export type RecordingMethod = 'auto' | 'smooth' | 'compatibility' | 'quality';
export type RenderEngine = 'browser' | 'ffmpeg_ass' | 'skia_canvas' | 'browser_cloud';

export interface ExportSettings {
  format: ExportFormat;
  quality: ExportQuality;
  motionSpeed: number;
  recordingMethod: RecordingMethod;
  fps?: 30 | 60;
  audioBitrate?: '128k' | '192k' | '320k';
  renderEngine?: RenderEngine;
}

interface ExportFormatSelectorProps {
  settings: ExportSettings;
  onChange: (settings: ExportSettings) => void;
  onExport: (format: ExportFormat) => void;
  videoBlob: Blob | null;
  mp4Blob: Blob | null;
  isConverting: boolean;
  isRecording: boolean;
}

const FORMAT_OPTIONS: { id: ExportFormat; label: string; description: string; icon: typeof FileVideo }[] = [
  { id: 'mp4', label: 'MP4 (موصى به)', description: 'ترميز H.264 عالي التوافق لإنستجرام وتيك توك وفيسبوك والواتساب', icon: Film },
  { id: 'webm', label: 'WebM', description: 'الصيغة الفورية - جودة ممتازة وحجم مضغوط خفيف', icon: FileVideo },
];

const RECORDING_METHOD_OPTIONS: { id: RecordingMethod; label: string; description: string }[] = [
  { id: 'auto', label: '🤖 تلقائي ذكي', description: 'يوازن تلقائياً بين الدقة وسلاسة المعالجة' },
  { id: 'quality', label: '🎬 جودة قصوى', description: 'أعلى معدل بت للحصول على تفاصيل فائقة النقاء' },
  { id: 'smooth', label: '⚡ سلس وسريع', description: 'موصى به للأجهزة المحمولة والمعالجة السريعة' },
  { id: 'compatibility', label: '🛟 خفيف واقتصادي', description: 'أقل استهلاك لذاكرة الجهاز والمعالج' },
];

export function ExportFormatSelector({
  settings,
  onChange,
  onExport,
  videoBlob,
  mp4Blob,
  isConverting,
  isRecording,
}: ExportFormatSelectorProps) {
  const { isPremium, entitlements, dailyUsage, cloudPolicy } = useSubscription();
  const engineAvailable = (engine: 'ffmpeg_ass' | 'skia_canvas' | 'browser_cloud') =>
    cloudPolicy === undefined || cloudPolicy?.enabledEngines.includes(engine) === true;
  const isCloud = settings.renderEngine !== undefined && settings.renderEngine !== 'browser';
  const cloudQualityAllowed = (quality: ExportQuality) => !isCloud || quality === 'medium' || isPremium && quality === 'high';

  const browserLimit = dailyUsage.browserRenderLimit;
  const browserRemaining = dailyUsage.browserRenderRemaining;
  const ffmpegAssLimit = entitlements.ffmpegAssDailyLimit;
  const skiaCanvasLimit = entitlements.skiaCanvasDailyLimit;
  const cloudRemaining = dailyUsage.cloudRenderRemaining ?? entitlements.cloudDailyLimit ?? 1;
  const ffmpegAssRemaining = Math.min(cloudRemaining, dailyUsage.ffmpegAssRenderRemaining ?? ffmpegAssLimit);
  const skiaCanvasRemaining = Math.min(cloudRemaining, dailyUsage.skiaCanvasRenderRemaining ?? skiaCanvasLimit);
  const browserCloudLimit = dailyUsage.browserCloudRenderLimit ?? (isPremium ? 20 : 0);
  const browserCloudRemaining = dailyUsage.browserCloudRenderRemaining ?? browserCloudLimit;

  const updateSetting = <K extends keyof ExportSettings>(key: K, value: ExportSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  const canExport = (format: ExportFormat) => {
    if (isRecording || isConverting) return false;
    if (format === 'webm') return !!videoBlob;
    if (format === 'mp4') return !!mp4Blob || !!videoBlob;
    return false;
  };

  const effectiveEngine = settings.renderEngine || 'browser';

  return (
    <Card className="border-border/60 shadow-md">
      <CardHeader className="p-3 sm:p-4 pb-3">
        <CardTitle className="text-lg flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-primary" />
            إعدادات التصدير وجودة الريلز
          </span>
          <span className="text-xs text-muted-foreground font-normal">
            تخصيص كامل لصيغة ودقة الإنتاج
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 p-3 pt-0 sm:p-4 sm:pt-0">
        {/* 1. Format Selection */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">صيغة ملف الفيديو</Label>
            <span className="text-xs text-primary font-medium">MP4 هو الأنسب للريلز</span>
          </div>
          <RadioGroup
            value={settings.format}
            onValueChange={(value) => updateSetting('format', value as ExportFormat)}
            className="space-y-2"
          >
            {FORMAT_OPTIONS.map((option) => (
              <div key={option.id} className="relative">
                <RadioGroupItem value={option.id} id={`format-${option.id}`} className="peer sr-only" />
                <Label
                  htmlFor={`format-${option.id}`}
                  className="flex items-center gap-3 rounded-xl border-2 border-muted p-3 hover:bg-muted/50 peer-data-[state=checked]:border-primary cursor-pointer transition-all"
                >
                  <option.icon className="h-5 w-5 text-primary shrink-0" />
                  <div className="flex-1">
                    <span className="font-semibold text-sm">{option.label}</span>
                    <p className="text-xs text-muted-foreground">{option.description}</p>
                  </div>
                  {canExport(option.id) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onExport(option.id);
                      }}
                      className="gap-1 text-xs shrink-0 gradient-primary text-primary-foreground border-0 shadow-sm"
                    >
                      <Download className="h-3.5 w-3.5" />
                      تحميل {option.id.toUpperCase()}
                    </Button>
                  )}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        {/* 2. Video Quality Preset */}
        <div className="space-y-3 pt-2 border-t border-border/40">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">دقة وجودة الفيديو</Label>
            {isCloud ? <span className="text-[11px] text-muted-foreground">السحابي: حتى {isPremium ? '1080p' : '720p'}</span>
              : !isPremium && <span className="text-[11px] text-muted-foreground">المتاح: 720p و1080p فقط</span>}
          </div>
          <RadioGroup
            value={settings.quality}
            onValueChange={(value) => {
              if (!cloudQualityAllowed(value as ExportQuality)) {
                toast.error(`الإنتاج السحابي يدعم حتى ${isPremium ? '1080p' : '720p'}.`);
                return;
              }
              if (!entitlements.allowedQualities.includes(value as ExportQuality)) {
                toast.error('دقة 4K Ultra HD متاحة للعضوية المميزة فقط');
                return;
              }
              updateSetting('quality', value as ExportQuality);
            }}
            className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-2"
          >
            {(Object.entries(QUALITY_PRESETS) as [ExportQuality, typeof QUALITY_PRESETS[ExportQuality]][]).map(
              ([key, preset]) => {
                const isLocked = !entitlements.allowedQualities.includes(key) || !cloudQualityAllowed(key);
                return (
                  <div key={key} className="relative">
                    <RadioGroupItem value={key} id={`quality-${key}`} disabled={isLocked} className="peer sr-only" />
                    <Label
                      htmlFor={`quality-${key}`}
                      className={`flex flex-col items-center rounded-xl border-2 border-muted p-3 hover:bg-muted/50 peer-data-[state=checked]:border-primary cursor-pointer transition-all text-center ${
                        isLocked ? 'opacity-60 cursor-not-allowed' : ''
                      }`}
                    >
                      <div className="flex items-center gap-1">
                        <span className="font-semibold text-sm">{preset.label}</span>
                        {isLocked && <Lock className="h-3 w-3 text-amber-500" />}
                      </div>
                      <span className="text-xs text-muted-foreground mt-0.5">{preset.resolution}</span>
                    </Label>
                  </div>
                );
              }
            )}
          </RadioGroup>
        </div>

        {/* 3. Frame Rate (FPS) */}
        <SettingsSection title="خيارات الصوت والحركة" description="معدل الإطارات وجودة الصوت">
        <div className="space-y-5">
        <div className="space-y-3 pt-2 border-t border-border/40">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">معدل الإطارات (Frame Rate - FPS)</Label>
            <span className="text-xs text-muted-foreground">سلاسة الحركة والتحريك</span>
          </div>
          <RadioGroup
            value={(settings.fps || 30).toString()}
            onValueChange={(val) => {
              const fpsVal = parseInt(val) as 30 | 60;
              if (isCloud && fpsVal > 30) {
                toast.error('الإنتاج السحابي يدعم 30 إطارًا في الثانية.');
                return;
              }
              if (!entitlements.allowedFps.includes(fpsVal)) {
                toast.error('معدل 60fps السينمائي يتطلب الترقية للباقة المميزة');
                return;
              }
              updateSetting('fps', fpsVal);
            }}
            className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-2"
          >
            <div className="relative">
              <RadioGroupItem value="30" id="fps-30" className="peer sr-only" />
              <Label
                htmlFor="fps-30"
                className="flex h-full min-w-0 flex-col items-center gap-1.5 rounded-xl border-2 border-muted p-2.5 hover:bg-muted/50 peer-data-[state=checked]:border-primary cursor-pointer text-center leading-relaxed"
              >
                <span className="font-semibold text-sm">30 FPS (قياسي سلس)</span>
                <span className="text-[11px] leading-5 text-muted-foreground">الأسرع والأخف حجماً</span>
              </Label>
            </div>
            <div className="relative">
              <RadioGroupItem value="60" id="fps-60" disabled={isCloud || !entitlements.allowedFps.includes(60)} className="peer sr-only" />
              <Label
                htmlFor="fps-60"
                className={`flex h-full min-w-0 flex-col items-center gap-1.5 rounded-xl border-2 border-muted p-2.5 hover:bg-muted/50 peer-data-[state=checked]:border-primary cursor-pointer text-center leading-relaxed ${
                  isCloud || !entitlements.allowedFps.includes(60) ? 'opacity-60 cursor-not-allowed' : ''
                }`}
              >
                <div className="flex items-center gap-1">
                  <span className="font-semibold text-sm">60 FPS (سينمائي فائق)</span>
                  {(isCloud || !entitlements.allowedFps.includes(60)) && <Lock className="h-3 w-3 text-amber-500" />}
                </div>
                <span className="text-[11px] leading-5 text-muted-foreground">نعومة مطلقة لحركة الكلمات</span>
              </Label>
            </div>
          </RadioGroup>
        </div>

        {/* 4. Audio Quality Bitrate */}
        <div className="space-y-3 pt-2 border-t border-border/40">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">نقاء الصوت القرآني (Audio Bitrate)</Label>
            {!isPremium && <span className="text-[11px] text-muted-foreground">إعداد قياسي تلقائي</span>}
          </div>
          {!isPremium ? (
            <div className="rounded-xl border border-dashed bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
              يعمل الصوت بالإعداد القياسي تلقائياً. التحكم في 320 kbps الاستوديوي متاح للعضوية المميزة فقط.
            </div>
          ) : (
            <RadioGroup
              value={settings.audioBitrate || '192k'}
              onValueChange={(val) => updateSetting('audioBitrate', val as '128k' | '192k' | '320k')}
              className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,6rem),1fr))] gap-2"
            >
              {[
                { id: '128k' as const, label: '128 kbps', desc: 'قياسي متوازن' },
                { id: '192k' as const, label: '192 kbps', desc: 'نقي وموصى به' },
                { id: '320k' as const, label: '320 kbps', desc: 'استوديو ماستر' },
              ].map((bitrate) => (
                <div key={bitrate.id} className="relative">
                  <RadioGroupItem value={bitrate.id} id={`bitrate-${bitrate.id}`} className="peer sr-only" />
                  <Label
                    htmlFor={`bitrate-${bitrate.id}`}
                    className="flex h-full min-w-0 flex-col items-center gap-1.5 rounded-xl border-2 border-muted p-2 hover:bg-muted/50 peer-data-[state=checked]:border-primary cursor-pointer text-center text-xs leading-5 transition-all"
                  >
                    <span className="font-semibold">{bitrate.label}</span>
                    <span className="text-[10px] leading-5 text-muted-foreground">{bitrate.desc}</span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          )}
        </div>

        {/* 5. Production Engine Choice */}
        </div>
        </SettingsSection>
        <SettingsSection title="طريقة إنتاج الفيديو" description="التسجيل على جهازك أو الإنتاج السحابي">
        <div className="space-y-3 pt-2 border-t border-border/40">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              طريقة إنتاج الفيديو
            </Label>
            <span className="text-xs text-muted-foreground">خيارات ذكية حسب نوع الإنتاج</span>
          </div>

          <RadioGroup
            value={effectiveEngine}
            onValueChange={(val) => {
              const cloud = val !== 'browser';
              const safeQuality = cloud && (settings.quality === 'ultra' || !isPremium && settings.quality === 'high')
                ? (isPremium ? 'high' : 'medium') : settings.quality;
              if (cloud && (safeQuality !== settings.quality || settings.fps === 60)) {
                toast.info('تم ضبط الدقة ومعدل الإطارات ضمن حدود الإنتاج السحابي.');
              }
              onChange({ ...settings, renderEngine: val as RenderEngine, quality: safeQuality, fps: cloud ? 30 : settings.fps });
            }}
            className="space-y-2.5"
          >
            {/* Option 1: Browser Hybrid Engine */}
            <div className="relative">
              <RadioGroupItem value="browser" id="engine-browser" className="peer sr-only" />
              <Label
                htmlFor="engine-browser"
                className="flex items-start gap-3 rounded-xl border-2 border-muted p-3 hover:bg-muted/50 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 cursor-pointer transition-all"
              >
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0 mt-0.5">
                  <Cpu className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-sm">التسجيل على جهازك</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/15 text-primary">
                      {browserLimit === null ? 'غير محدود' : `${browserRemaining ?? 0}/${browserLimit} اليوم`}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    يسجل الفيديو على جهازك ثم يجهز الملف للتحميل. أبقِ الصفحة مفتوحة أثناء التسجيل.
                  </p>
                </div>
              </Label>
            </div>

            {/* Option 2: Native FFmpeg ASS Superfast Engine (Idea 1) */}
            {engineAvailable('ffmpeg_ass') && <div className="relative">
              <RadioGroupItem value="ffmpeg_ass" id="engine-ffmpeg-ass" disabled={ffmpegAssRemaining <= 0} className="peer sr-only" />
              <Label
                htmlFor="engine-ffmpeg-ass"
                className="flex items-start gap-3 rounded-xl border-2 border-muted p-3 hover:bg-muted/50 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 cursor-pointer transition-all"
              >
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0 mt-0.5">
                  <Zap className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-sm">الإنتاج السحابي — FFmpeg</span>
                      {isPremium ? (
                        <span className="text-[10px] bg-amber-500/15 text-amber-600 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                          <Sparkles className="h-3 w-3" /> مميز
                        </span>
                      ) : (
                        <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                          تجربة يومية
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600">
                      {ffmpegAssRemaining}/{ffmpegAssLimit} متبقي اليوم
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    ينتج الفيديو على الخادم باستخدام FFmpeg مع إعدادات المشهد التي اخترتها.
                  </p>
                </div>
              </Label>
            </div>

            }
            {/* Option 3: Skia/Rust Canvas Engine (Idea 2) */}
            {engineAvailable('skia_canvas') && <div className="relative">
              <RadioGroupItem value="skia_canvas" id="engine-skia-canvas" disabled={skiaCanvasRemaining <= 0} className="peer sr-only" />
              <Label
                htmlFor="engine-skia-canvas"
                className="flex items-start gap-3 rounded-xl border-2 border-muted p-3 hover:bg-muted/50 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 cursor-pointer transition-all"
              >
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500 shrink-0 mt-0.5">
                  <Film className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-sm">الإنتاج السحابي</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600">
                      {skiaCanvasRemaining}/{skiaCanvasLimit} متبقي اليوم
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    ينتج الفيديو ويحفظه في مكتبتك. تظهر حالة الطلب وترتيبه أثناء الانتظار.
                  </p>
                </div>
              </Label>
            </div>

            }
            {/* Option 4: Independent full-fidelity cloud browser engine (Idea 3) */}
            {engineAvailable('browser_cloud') && <div className="relative">
              <RadioGroupItem
                value="browser_cloud"
                id="engine-browser-cloud"
                disabled={!isPremium || browserCloudRemaining <= 0}
                className="peer sr-only"
              />
              <Label
                htmlFor="engine-browser-cloud"
                className={`flex items-start gap-3 rounded-xl border-2 border-primary/30 bg-primary/5 p-3 hover:bg-primary/10 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 cursor-pointer transition-all ${
                  !isPremium || browserCloudRemaining <= 0 ? 'opacity-60 cursor-not-allowed' : ''
                }`}
              >
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0 mt-0.5">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-sm">الإنتاج السحابي — المتصفح</span>
                      {!isPremium && <Lock className="h-3 w-3 text-amber-500" />}
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/15 text-primary">
                      {isPremium ? `${browserCloudRemaining}/${browserCloudLimit} متبقي اليوم` : 'ميزة مميزة'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    ينتج الفيديو في متصفح على الخادم ويحفظه في المكتبة بعد اكتماله.
                  </p>
                </div>
              </Label>
            </div>
            }
          </RadioGroup>
          {isCloud && !engineAvailable(settings.renderEngine as 'ffmpeg_ass' | 'skia_canvas' | 'browser_cloud') && (
            <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              طريقة الإنتاج المحفوظة غير متاحة حاليًا. اختر طريقة متاحة قبل بدء الإنتاج.
            </p>
          )}
          <p className="text-xs leading-6 text-muted-foreground">
            الإنتاج السحابي: حتى {isPremium ? '5 دقائق و1080p' : 'دقيقتين و720p'}، بمعدل 30 إطارًا/ثانية.
            يتم تنفيذ الطلبات تباعًا. حصتك {entitlements.cloudDailyLimit} فيديو يوميًا.
          </p>
        </div>

        {/* Client Recording Strategy (When Browser engine is used) */}
        {effectiveEngine === 'browser' && (
          <div className="space-y-3 p-3 rounded-xl bg-muted/30 border border-border/50">
            <Label className="text-xs font-medium text-muted-foreground">إعداد التسجيل على جهازك</Label>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-2">
              {RECORDING_METHOD_OPTIONS.map((method) => (
                <Button
                  key={method.id}
                  type="button"
                  variant={settings.recordingMethod === method.id ? 'default' : 'outline'}
                  size="sm"
                  className={`h-auto min-h-20 min-w-0 w-full whitespace-normal break-words px-3 py-3 text-xs flex-col items-stretch justify-start gap-1.5 text-start ${
                    settings.recordingMethod === method.id ? 'gradient-primary' : ''
                  }`}
                  onClick={() => updateSetting('recordingMethod', method.id)}
                >
                  <span className="block min-w-0 font-semibold leading-5">{method.label}</span>
                  <span className="block min-w-0 text-[11px] font-normal leading-5 opacity-80">{method.description}</span>
                </Button>
              ))}
            </div>
          </div>
        )}
        </SettingsSection>
      </CardContent>
    </Card>
  );
}
