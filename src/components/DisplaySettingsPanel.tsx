import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
  Eye,
  EyeOff,
  Sparkles,
  Frame,
  Hash,
  Wand2,
  Type,
  Save,
  Trash2,
  User,
  Settings2,
  Palette,
  LayoutGrid,
  Star,
  Image as ImageIcon,
  AtSign,
  Upload,
  Bot,
  Maximize2,
  CheckCircle2,
  Lock,
  AlertTriangle,
  Loader2,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { useState, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useSubscription } from '@/hooks/useSubscription';
import { api } from '@/lib/api';
import { BRAND_WATERMARKS, loadBrandWatermark } from '@/lib/brand';
import { PremiumBadge } from '@/components/PremiumBadge';
import { TextSettingsPanel, type TextSettings } from '@/components/TextSettingsPanel';
import { createSavedTemplate, loadSavedTemplates, TEMPLATES_KEY, type SavedTemplate, type VideoTemplateConfiguration } from '@/lib/savedVideoTemplates';
import type { AnimationProfile, VerseDisplayMode } from '@/lib/animationTimeline';
import {
  type AyahNumberColor,
  type AyahNumberStyle,
  type AyahTransition,
  type FrameStyle,
  type GlowStyle,
  type HighlightStyle,
  type LogoWatermarkPosition,
  type LogoWatermarkPreset,
  type LyricsDisplayStyle,
  type ReciterNameStyle,
  type ScreenBorderColor,
  type ScreenBorderStyle,
  type SlideshowTransition,
  type SocialPlatform,
  type SocialWatermarkPosition,
  type SurahNamePosition,
  type SurahNameStyle,
  type TextShadowStyle,
  type VisualDesign,
  type WatermarkPosition,
} from '@/data/displayValueUnions';
import {
  AYAH_NUMBER_COLOR_OPTIONS,
  AYAH_NUMBER_STYLE_OPTIONS,
  AYAH_TRANSITION_OPTIONS,
  ANIMATION_PROFILE_OPTIONS,
  FRAME_STYLE_OPTIONS,
  GLOW_STYLE_OPTIONS,
  HIGHLIGHT_STYLE_OPTIONS,
  LOGO_WATERMARK_POSITION_OPTIONS,
  LOGO_WATERMARK_PRESET_OPTIONS,
  RECITER_NAME_STYLE_OPTIONS,
  SCREEN_BORDER_COLOR_OPTIONS,
  SCREEN_BORDER_STYLE_OPTIONS,
  SOCIAL_PLATFORM_OPTIONS,
  SOCIAL_WATERMARK_POSITION_OPTIONS,
  SURA_NAME_POSITION_OPTIONS,
  SURA_NAME_STYLE_OPTIONS,
  TEXT_SHADOW_OPTIONS,
  VERSE_DISPLAY_MODE_OPTIONS,
  WATERMARK_POSITION_OPTIONS,
} from '@/data/displayOptions';
import {
  type LetterTimingTier,
  describeLetterTiming,
  describeVerseModeConflict,
  isGlowColorEnabled,
  isGlowSectionEnabled,
  isReducedMotionEnabled,
} from '@/lib/displayInterlocks';

/**
 * The display contract shared by the browser, the render harness, and every
 * server engine. Field types are imported from `displayValueUnions` so this
 * interface cannot drift from `server/models/renderManifest.ts` — that drift is
 * what previously hid `'pill'`, `'double'`, and `'center'` from the UI even
 * though the production renderers already supported them.
 */
export interface DisplaySettings {
  /** Overall visual direction for the reel canvas. */
  visualDesign?: VisualDesign;
  showSurahName: boolean;
  showReciterName: boolean;
  showAyahText: boolean;
  showAyahNumber: boolean;
  highlightStyle: HighlightStyle;
  frameStyle: FrameStyle;
  ayahNumberStyle: AyahNumberStyle;
  ayahNumberColor: AyahNumberColor;
  verseDisplayMode: VerseDisplayMode;
  /** Deterministic timing presentation profile shared by every renderer. */
  animationProfile?: AnimationProfile;
  animationReducedMotion?: boolean;
  surahNamePosition: SurahNamePosition;
  surahNameStyle: SurahNameStyle;
  reciterNameStyle: ReciterNameStyle;
  textShadowStyle: TextShadowStyle;
  ayahTransition: AyahTransition;

  // Legacy / Basic Watermark compatibility
  watermarkEnabled: boolean;
  watermarkText: string;
  watermarkPosition: WatermarkPosition;

  // Dual-mode Watermark: Logo & Channel Identity
  logoWatermarkEnabled?: boolean;
  logoWatermarkPreset?: LogoWatermarkPreset;
  logoBrandName?: string;
  logoSubtitle?: string;
  logoWatermarkUrl?: string;
  logoWatermarkPosition?: LogoWatermarkPosition;
  logoWatermarkSize?: number; // 20 - 300
  logoWatermarkOpacity?: number; // 0 - 1

  // Full-Screen Video Border
  screenBorderStyle?: ScreenBorderStyle;
  screenBorderColor?: ScreenBorderColor;

  // Dual-mode Watermark: Social Handle
  socialWatermarkEnabled?: boolean;
  socialPlatform?: SocialPlatform;
  socialHandle?: string;
  socialWatermarkPosition?: SocialWatermarkPosition;
  socialWatermarkSize?: number; // 8 - 100
  socialWatermarkOpacity?: number; // 0 - 1

  glowStyle?: GlowStyle;
  lyricsDisplayStyle: LyricsDisplayStyle;
  slideshowTransition: SlideshowTransition;
}

export interface DisplaySettingsPanelProps {
  templateConfiguration?: VideoTemplateConfiguration;
  onTemplateConfigurationChange?: (configuration: VideoTemplateConfiguration) => void;
  textSettings?: TextSettings;
  onTextSettingsChange?: (settings: TextSettings) => void;
  settings: DisplaySettings;
  onChange: (settings: DisplaySettings) => void;
  letterTimingStatus?: LetterTimingTier;
  /** True when the selected reciter publishes a verified letter tier. */
  letterTimingAvailable?: boolean;
}


/**
 * Option lists now resolve to `src/data/displayOptions.ts`. The previous local
 * copies are deleted on purpose: keeping them is what allowed the create page
 * and this panel to disagree on labels and to ship values the manifest rejects.
 * The only lists still declared here are the two that have no shared consumer
 * yet (AI logo styles, and the lyrics/slideshow pair used by ibtahalat mode).
 */
const highlightOptions = HIGHLIGHT_STYLE_OPTIONS;
const frameOptions = FRAME_STYLE_OPTIONS;
const ayahNumberOptions = AYAH_NUMBER_STYLE_OPTIONS;
const surahPositionOptions = SURA_NAME_POSITION_OPTIONS;
const textShadowOptions = TEXT_SHADOW_OPTIONS;
const transitionOptions = AYAH_TRANSITION_OPTIONS;
const surahNameStyleOptions = SURA_NAME_STYLE_OPTIONS;
const reciterNameStyleOptions = RECITER_NAME_STYLE_OPTIONS;
const ayahNumberColorOptions = AYAH_NUMBER_COLOR_OPTIONS;
const verseDisplayModeOptions = VERSE_DISPLAY_MODE_OPTIONS;
const animationProfileOptions = ANIMATION_PROFILE_OPTIONS;
const glowStyleOptions = GLOW_STYLE_OPTIONS;
const logoPresentationOptions = LOGO_WATERMARK_PRESET_OPTIONS;
const logoPositionOptions = LOGO_WATERMARK_POSITION_OPTIONS;
const socialPositionOptions = SOCIAL_WATERMARK_POSITION_OPTIONS;
const screenBorderStyleOptions = SCREEN_BORDER_STYLE_OPTIONS;
const screenBorderColorOptions = SCREEN_BORDER_COLOR_OPTIONS;

const logoAiStyleOptions = [
  { value: 'goldMedallion', label: 'ختم ملكي مذهب', desc: 'نجمة إسلامية ثمانية مع حواف لؤلؤية وتدرج ذهبي' },
  { value: 'ottomanCrest', label: 'وسام عثماني فاخر', desc: 'هلال مذهب وزخارف تاجية ملكية' },
  { value: 'modernGeometric', label: 'شعار هندسي حديث', desc: 'درع هندسي ثلاثي الأبعاد مع إضاءة نيون' },
  { value: 'classicCalligraphy', label: 'خط عربي كلاسيكي', desc: 'حلقة أرابيسك نباتية وخط ثلث فاخر' },
];

const lyricsDisplayOptions = [
  { value: 'scroll', label: 'تمرير متتابع', description: 'عرض عدة أسطر مع إبراز الحالي' },
  { value: 'single', label: 'سطر واحد كبير', description: 'عرض السطر النشط فقط في المركز' },
  { value: 'karaoke', label: 'كاريوكي ثلاثي', description: '3 أسطر مع تمييز السطر المنشد' },
  { value: 'fade', label: 'تلاشي سينمائي', description: 'سطر واحد مع ظهور واختفاء ناعم' },
];

const slideshowTransitionOptions = [
  { value: 'crossfade', label: 'تلاشي ناعم', description: 'انتقال سلس وهادئ جداً' },
  { value: 'slideLeft', label: 'انزلاق أفقي', description: 'دخول سلس من اليمين' },
  { value: 'slideRight', label: 'انزلاق معاكس', description: 'دخول من اليسار' },
  { value: 'slideUp', label: 'صعود للأعلى', description: 'دخول عمودي سينمائي' },
  { value: 'zoomThrough', label: 'تقريب عابر', description: 'تكبير درامي ثلاثي الأبعاد' },
  { value: 'wipe', label: 'مسح أفقي', description: 'كشف تدريجي أنيق' },
  { value: 'mixed', label: '🎲 متنوع تلقائي', description: 'انتقال مختلف لكل صورة' },
];

const socialPlatformOptions = SOCIAL_PLATFORM_OPTIONS;


const BUILTIN_DISPLAY_TEMPLATES: SavedTemplate[] = [
  {
    id: 'preset-quran1minute-gold',
    name: '✨ الريلز الذهبي الملكي الفاخر (Royal Gold Reel)',
    createdAt: 1,
    badge: 'الأكثر طلباً',
    settings: {
      showSurahName: false,
      showReciterName: false,
      showAyahText: true,
      showAyahNumber: true,
      ayahNumberStyle: 'quran3d',
      ayahNumberColor: 'gold',
      highlightStyle: 'glow',
      glowStyle: 'golden',
      textShadowStyle: 'none',
      frameStyle: 'none',
      screenBorderStyle: 'goldenTrim',
      screenBorderColor: 'gold',
      verseDisplayMode: 'full',
      surahNamePosition: 'top',
      surahNameStyle: 'classic',
      reciterNameStyle: 'simple',
      ayahTransition: 'fade',
      watermarkEnabled: false,
      watermarkText: '',
      watermarkPosition: 'bottomCenter',
      logoWatermarkEnabled: true,
      logoWatermarkPreset: 'goldCalligraphy',
      logoBrandName: 'آيات قرآنية',
      logoSubtitle: 'تلاوات خاشعة',
      logoWatermarkPosition: 'topRight',
      logoWatermarkSize: 85,
      logoWatermarkOpacity: 0.95,
      socialWatermarkEnabled: false,
      socialPlatform: 'facebook',
      socialHandle: '',
      socialWatermarkPosition: 'bottomCenter',
      socialWatermarkSize: 18,
      socialWatermarkOpacity: 0.85,
      lyricsDisplayStyle: 'scroll',
      slideshowTransition: 'crossfade',
    },
  },
  {
    id: 'preset-prophetic-mushaf',
    name: '🕌 المصحف النبوي الشريف',
    createdAt: 2,
    badge: 'كلاسيكي ملكي',
    settings: {
      showSurahName: false,
      showReciterName: false,
      showAyahText: true,
      showAyahNumber: true,
      ayahNumberStyle: 'quran3d',
      ayahNumberColor: 'metallicGold3D',
      highlightStyle: 'glow',
      glowStyle: 'golden',
      textShadowStyle: 'none',
      frameStyle: 'golden',
      verseDisplayMode: 'full',
      surahNamePosition: 'top',
      surahNameStyle: 'goldenBadge',
      reciterNameStyle: 'elegant',
      ayahTransition: 'rise',
      watermarkEnabled: false,
      watermarkText: '',
      watermarkPosition: 'bottomRight',
      logoWatermarkEnabled: false,
      socialWatermarkEnabled: false,
      lyricsDisplayStyle: 'scroll',
      slideshowTransition: 'crossfade',
    },
  },
  {
    id: 'preset-cinematic-minimal',
    name: '🎬 سينمائي داكن نقي',
    createdAt: 3,
    badge: '4K سينما',
    settings: {
      showSurahName: false,
      showReciterName: false,
      showAyahText: true,
      showAyahNumber: false,
      ayahNumberStyle: 'circle',
      ayahNumberColor: 'white',
      highlightStyle: 'glow',
      glowStyle: 'soft',
      textShadowStyle: 'none',
      frameStyle: 'none',
      verseDisplayMode: 'full',
      surahNamePosition: 'top',
      surahNameStyle: 'calligraphy',
      reciterNameStyle: 'simple',
      ayahTransition: 'cinematic',
      watermarkEnabled: false,
      watermarkText: '',
      watermarkPosition: 'bottomCenter',
      logoWatermarkEnabled: false,
      socialWatermarkEnabled: false,
      lyricsDisplayStyle: 'single',
      slideshowTransition: 'zoomThrough',
    },
  },
  {
    id: 'preset-viral-tiktok',
    name: '⚡ تيك توك وريلز ترند',
    createdAt: 4,
    badge: 'ديناميكي سريع',
    settings: {
      showSurahName: false,
      showReciterName: false,
      showAyahText: true,
      showAyahNumber: true,
      ayahNumberStyle: 'quran3d',
      ayahNumberColor: 'gold',
      highlightStyle: 'glow',
      glowStyle: 'neon',
      textShadowStyle: 'none',
      frameStyle: 'none',
      verseDisplayMode: 'twoWords',
      surahNamePosition: 'top',
      surahNameStyle: 'classic',
      reciterNameStyle: 'simple',
      ayahTransition: 'slide',
      watermarkEnabled: true,
      watermarkText: '@AyahClip',
      watermarkPosition: 'bottomCenter',
      logoWatermarkEnabled: false,
      socialWatermarkEnabled: true,
      socialPlatform: 'tiktok',
      socialHandle: '@QuranReels',
      socialWatermarkPosition: 'bottomCenter',
      socialWatermarkSize: 18,
      socialWatermarkOpacity: 0.9,
      lyricsDisplayStyle: 'karaoke',
      slideshowTransition: 'slideUp',
    },
  },
];

function loadTemplates(): SavedTemplate[] {
  return loadSavedTemplates(localStorage);
}

function saveTemplates(templates: SavedTemplate[]) {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
}

// Reusable radio grid component
function RadioOptionGrid({
  options,
  value,
  onChange,
  idPrefix,
  columns = 2,
  disabledValues,
}: {
  options: ReadonlyArray<{ value: string; label: string; description?: string; color?: string; badge?: string }>;
  value: string;
  onChange: (val: string) => void;
  idPrefix: string;
  columns?: number;
  /** Interlock: option values that must not accept input in this state. */
  disabledValues?: readonly string[];
}) {
  const gridCols = columns === 3 ? 'grid-cols-3' : columns === 4 ? 'grid-cols-4' : 'grid-cols-2';
  // `disabledValues` implements the interlock rules: an option that cannot
  // affect the render is visibly inert instead of silently accepting a click.
  const isOptionDisabled = (value: string) => disabledValues?.includes(value) === true;
  return (
    <RadioGroup value={value} onValueChange={onChange} className={`grid ${gridCols} gap-2`}>
      {options.map((option) => {
        const disabled = isOptionDisabled(option.value);
        return (
        <div key={option.value} className="relative">
          <RadioGroupItem
            value={option.value}
            id={`${idPrefix}-${option.value}`}
            className="peer sr-only"
            disabled={disabled}
          />
          <Label
            htmlFor={`${idPrefix}-${option.value}`}
            aria-disabled={disabled}
            title={disabled ? 'هذا الخيار غير متاح ضمن إعداداتك الحالية' : option.description}
            className={cn(
              'relative flex flex-col items-center rounded-lg border-2 p-2.5 transition-all text-center h-full justify-center',
              disabled
                ? 'border-muted/40 bg-muted/20 opacity-45 cursor-not-allowed'
                : 'border-muted hover:bg-muted/50 peer-data-[state=checked]:border-primary cursor-pointer',
            )}
          >
            {option.color && (
              <span
                aria-hidden="true"
                className="h-5 w-5 rounded-full border border-border/50"
                style={{ backgroundColor: option.color }}
              />
            )}
            <span className="font-medium text-xs sm:text-sm leading-tight">{option.label}</span>
            {option.description && (
              <span className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2 text-center">
                {option.description}
              </span>
            )}
            {option.badge && (
              <span className="absolute -top-2 -left-2 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground shadow-sm">
                {option.badge}
              </span>
            )}
          </Label>
        </div>
        );
      })}
    </RadioGroup>
  );
}

export function DisplaySettingsPanel({ settings, onChange, textSettings, onTextSettingsChange, templateConfiguration, onTemplateConfigurationChange, letterTimingStatus = 'idle' }: DisplaySettingsPanelProps) {
  const { canUseFeature } = useSubscription();
  const [userTemplates, setUserTemplates] = useState<SavedTemplate[]>(loadTemplates);
  const [templateName, setTemplateName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isGeneratingLogo, setIsGeneratingLogo] = useState(false);
  const [isLoadingBrandLogo, setIsLoadingBrandLogo] = useState(false);
  const currentSettingsRef = useRef(settings);
  currentSettingsRef.current = settings;
  const [logoAiStyle, setLogoAiStyle] = useState<'goldMedallion' | 'ottomanCrest' | 'modernGeometric' | 'classicCalligraphy'>('goldMedallion');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const updateSetting = <K extends keyof DisplaySettings>(key: K, value: DisplaySettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  // ── Interlock state ──────────────────────────────────────────────────────────
  // Every dependent control reads these, so a combination that cannot change
  // the render is visibly inert rather than silently accepting input.
  const glowSectionEnabled = isGlowSectionEnabled(settings);
  const glowColorEnabled = isGlowColorEnabled(settings);
  const reducedMotionEnabled = isReducedMotionEnabled(settings);
  const verseModeConflict = describeVerseModeConflict(settings);
  const letterNotice = describeLetterTiming(letterTimingStatus);
  const letterToneClass =
    letterNotice.tone === 'ready'
      ? 'text-emerald-500'
      : letterNotice.tone === 'warning'
        ? 'text-amber-500'
        : 'text-muted-foreground';

  // `static` cannot pulse, so reduced motion has nothing left to switch off.
  // Clear it rather than persisting a switch that appears to do something.
  const effectiveReducedMotion = reducedMotionEnabled ? settings.animationReducedMotion : false;

  const handleGenerateAiLogo = async () => {
    if (!canUseFeature('aiLogo')) {
      toast.error('توليد الشعار بالذكاء الاصطناعي متاح للعضوية المميزة فقط');
      return;
    }
    try {
      setIsGeneratingLogo(true);
      const brand = settings.logoBrandName || 'آيات قرآنية';
      const sub = settings.logoSubtitle || 'تلاوات خاشعة';
      const data = await api.services.generateLogo({ brandName: brand, subtitle: sub, style: logoAiStyle });
      if (data.dataUrl) {
        onChange({
          ...settings,
          logoWatermarkEnabled: true,
          logoWatermarkPreset: 'custom',
          logoWatermarkUrl: data.dataUrl,
        });
        toast.success('تم تصميم الشعار بالذكاء الاصطناعي وتطبيقه بنجاح! ✨');
      }
    } catch (err: any) {
      toast.error(err.message || 'حدث خطأ أثناء توليد الشعار بالذكاء الاصطناعي');
    } finally {
      setIsGeneratingLogo(false);
    }
  };

  const handleLogoFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canUseFeature('customBranding')) {
      toast.error('رفع الشعار والهوية المخصصة متاح للعضوية المميزة فقط');
      e.target.value = '';
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('يرجى اختيار ملف صورة صالح (PNG, JPG, SVG, WebP)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      onChange({
        ...settings,
        logoWatermarkEnabled: true,
        logoWatermarkPreset: 'custom',
        logoWatermarkUrl: dataUrl,
      });
      toast.success('تم رفع وتطبيق الشعار بنجاح! 🖼️');
    };
    reader.readAsDataURL(file);
  };

  const handleBrandLogo = async (id: typeof BRAND_WATERMARKS[number]['id']) => {
    if (!canUseFeature('customBranding')) {
      toast.error('الشعار والهوية المخصصة متاحان للعضوية المميزة');
      return;
    }
    setIsLoadingBrandLogo(true);
    try {
      const dataUrl = await loadBrandWatermark(id);
      if (!currentSettingsRef.current.logoWatermarkEnabled) return;
      onChange({ ...currentSettingsRef.current, logoWatermarkPreset: 'custom', logoWatermarkUrl: dataUrl, logoBrandName: 'AyahX' });
      toast.success('تم اختيار شعار AyahX');
    } catch {
      toast.error('تعذر تحميل شعار AyahX. حاول مرة أخرى.');
    } finally {
      setIsLoadingBrandLogo(false);
    }
  };

  const handleSaveTemplate = async () => {
    if (!canUseFeature('premiumTemplates')) {
      toast.error('حفظ القوالب الملكية متاح للعضوية المميزة فقط');
      return;
    }
    if (!templateName.trim() || isSavingTemplate) return;
    setIsSavingTemplate(true);
    try {
      const newTemplate = await createSavedTemplate(templateName, settings, { ...templateConfiguration, textSettings });
      const updated = [...userTemplates, newTemplate];
      saveTemplates(updated);
      setUserTemplates(updated);
      setTemplateName('');
      setShowSaveInput(false);
      toast.success(`تم حفظ القالب "${newTemplate.name}"`);
    } catch {
      toast.error('تعذر حفظ القالب. تحقق من مساحة التخزين وحجم الملفات المرفقة.');
    } finally { setIsSavingTemplate(false); }
  };

  const handleLoadTemplate = (tpl: SavedTemplate) => {
    if (!canUseFeature('premiumTemplates')) {
      toast.error('القوالب الجاهزة الفاخرة متاحة للعضوية المميزة فقط');
      return;
    }
    onChange({ ...settings, ...tpl.settings });
    if (tpl.textSettings && onTextSettingsChange) onTextSettingsChange({ ...textSettings, ...tpl.textSettings });
    onTemplateConfigurationChange?.(tpl);
    toast.success(`تم تطبيق قالب "${tpl.name}" ✨`);
  };

  const handleDeleteTemplate = (id: string) => {
    const updated = userTemplates.filter((t) => t.id !== id);
    try {
      saveTemplates(updated);
      setUserTemplates(updated);
      toast.success('تم حذف القالب');
    } catch { toast.error('تعذر حذف القالب من التخزين'); }
  };

  return (
    <Card className="border-border/60 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-primary" />
            إعدادات العرض والمظهر الاحترافي
          </span>
          <span className="text-xs text-muted-foreground font-normal">
            اضغط على أي قسم لفتحه وتخصيصه
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {/* Accordion: All collapsed by default (defaultValue={[]}) as requested */}
        <Accordion type="multiple" defaultValue={[]} className="w-full">
          {/* ═══ Section 0: Visibility Elements ═══ */}
          <AccordionItem value="display-elements" className="border-b px-4">
            <AccordionTrigger className="text-sm font-semibold gap-2 py-3.5 hover:no-underline">
              <span className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-primary" />
                عناصر العرض المرئية
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pb-4">
              <p className="text-xs text-muted-foreground mb-3">
                تحكم في ظهور أو إخفاء عناصر الفيديو. الوضع الافتراضي النظيف (إخفاء أسماء السورة والقارئ ورقم الآية) يعطي مظهر ريلز احترافي.
              </p>
              {[
                { key: 'showSurahName' as const, label: 'إظهار اسم السورة', hint: 'شريط أو شارة اسم السورة' },
                { key: 'showReciterName' as const, label: 'إظهار اسم القارئ', hint: 'شارة اسم القارئ والتلاوة' },
                { key: 'showAyahText' as const, label: 'إظهار نص الآية الكريمة', hint: 'النص العثماني للآية' },
                { key: 'showAyahNumber' as const, label: 'إظهار رقم الآية', hint: 'قوس أو شارة رقم الآية' },
              ].map(({ key, label, hint }) => (
                <div key={key} className="flex items-center justify-between p-2.5 rounded-lg border border-border/40 hover:bg-muted/30 transition-colors">
                  <div>
                    <Label htmlFor={key} className="flex items-center gap-2 cursor-pointer font-medium text-sm">
                      {settings[key] ? <Eye className="h-4 w-4 text-primary" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                      {label}
                    </Label>
                    <p className="text-[11px] text-muted-foreground mr-6">{hint}</p>
                  </div>
                  <Switch
                    id={key}
                    checked={settings[key]}
                    onCheckedChange={(checked) => updateSetting(key, checked)}
                  />
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>

          {/* ═══ Section 2: Text Styling & Shadow ═══ */}
          <AccordionItem value="advanced-motion" className="border-b px-4">
            <AccordionTrigger className="text-sm font-semibold gap-2 py-3.5 hover:no-underline">
              <span className="flex items-center gap-2">
                <Palette className="h-4 w-4 text-primary" />
                أنماط الحركة وتأثيرات العرض القرآني المتقدمة
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-5 pb-4">
              {/* Text Shadow Style - Default None */}
              {textSettings && onTextSettingsChange && <TextSettingsPanel settings={textSettings} onChange={onTextSettingsChange} />}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">نمط ظل النص القرآني</Label>
                  <span className="text-[11px] text-primary font-medium">موصى به: بدون ظل</span>
                </div>
                <RadioOptionGrid
                  options={textShadowOptions}
                  value={settings.textShadowStyle || 'none'}
                  onChange={(v) => updateSetting('textShadowStyle', v as DisplaySettings['textShadowStyle'])}
                  idPrefix="shadow"
                  columns={2}
                />
              </div>

              {/* Word Highlighting Style */}
              <div className="space-y-3 pt-2 border-t border-border/40">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  نمط تمييز الكلمات مع التلاوة
                </Label>
                <RadioOptionGrid
                  options={highlightOptions}
                  value={settings.highlightStyle || 'glow'}
                  onChange={(v) => updateSetting('highlightStyle', v as DisplaySettings['highlightStyle'])}
                  idPrefix="highlight"
                  columns={2}
                />
              </div>

              {/* Glow Aura Style. Interlock: this section only changes the
                  render while a highlight style is active AND the glow
                  palette is not set to 'none'. Otherwise it is inert, so we
                  dim it and explain why instead of accepting dead clicks. */}
              {settings.highlightStyle !== 'none' && (
                <div
                  className={cn(
                    'space-y-3 p-3.5 rounded-xl border transition-opacity',
                    glowColorEnabled
                      ? 'bg-gradient-to-r from-primary/5 via-muted/40 to-primary/5 border-primary/20'
                      : 'bg-muted/20 border-border/40',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs sm:text-sm flex items-center gap-1.5 font-semibold text-primary">
                      <Sparkles className="h-4 w-4" />
                      نوع ولون هالة التوهج (Glow Aura Style)
                    </Label>
                    <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                      {glowColorEnabled ? 'مظهر سينمائي' : 'معطّل'}
                    </span>
                  </div>
                    <RadioOptionGrid
                      options={glowStyleOptions}
                      value={settings.glowStyle || 'golden'}
                      onChange={(v) => updateSetting('glowStyle', v as DisplaySettings['glowStyle'])}
                      idPrefix="glowstyle"
                      columns={3}
                    />

                </div>
              )}

              {/* Surah Name Style (if enabled) */}
              {settings.showSurahName && (
                <div className="space-y-4 pt-2 border-t border-border/40">
                  <div className="space-y-2">
                    <Label className="text-sm flex items-center gap-2">
                      <Wand2 className="h-4 w-4 text-primary" />
                      شكل وتصميم اسم السورة
                    </Label>
                    <RadioOptionGrid
                      options={surahNameStyleOptions}
                      value={settings.surahNameStyle || 'classic'}
                      onChange={(v) => updateSetting('surahNameStyle', v as DisplaySettings['surahNameStyle'])}
                      idPrefix="sname"
                      columns={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">موضع اسم السورة على الشاشة</Label>
                    <RadioOptionGrid
                      options={surahPositionOptions}
                      value={settings.surahNamePosition || 'top'}
                      onChange={(v) => updateSetting('surahNamePosition', v as DisplaySettings['surahNamePosition'])}
                      idPrefix="spos"
                    />
                  </div>
                </div>
              )}

              {/* Reciter Name Style (if enabled) */}
              {settings.showReciterName && (
                <div className="space-y-3 pt-2 border-t border-border/40">
                  <Label className="text-sm flex items-center gap-2">
                    <User className="h-4 w-4 text-primary" />
                    شكل وتصميم اسم القارئ
                  </Label>
                  <RadioOptionGrid
                    options={reciterNameStyleOptions}
                    value={settings.reciterNameStyle || 'simple'}
                    onChange={(v) => updateSetting('reciterNameStyle', v as DisplaySettings['reciterNameStyle'])}
                    idPrefix="reciter"
                    columns={3}
                  />
                </div>
              )}
              <div className="border-t border-border/40 pt-4 text-sm font-semibold text-primary">الحركة وتقسيم الآيات وأرقامها</div>
              {/* ── Verse display mode ── */}
              <div className="space-y-3">
                <Label className="text-xs font-medium text-muted-foreground">
                  طريقة تقسيم الآية
                </Label>
                <RadioOptionGrid
                  options={verseDisplayModeOptions}
                  value={settings.verseDisplayMode || 'full'}
                  onChange={(v) => updateSetting('verseDisplayMode', v as DisplaySettings['verseDisplayMode'])}
                  idPrefix="vdm"
                />
                {settings.verseDisplayMode === 'letterByLetter' && (
                  <p
                    role="status"
                    aria-live="polite"
                    className={cn(
                      'flex items-start gap-1.5 rounded-lg border border-border/40 bg-muted/30 p-2.5 text-[11px] leading-relaxed',
                      letterToneClass,
                    )}
                  >
                    {letterNotice.tone === 'ready' && <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />}
                    {letterNotice.tone === 'loading' && <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" />}
                    {letterNotice.tone === 'warning' && <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />}
                    {letterNotice.tone === 'info' && <Info className="mt-0.5 h-3 w-3 shrink-0" />}
                    <span>{letterNotice.message}</span>
                  </p>
                )}
                {verseModeConflict && (
                  <p
                    role="status"
                    className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400"
                  >
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{verseModeConflict}</span>
                  </p>
                )}
              </div>

              {/* ── Deterministic animation profile ──
                  Consumes trusted TimingMap events only; it never estimates audio timing. ── */}
              <div className="space-y-3 border-t border-border/40 pt-4">
                <Label className="text-xs font-medium text-muted-foreground">نمط الحركة داخل الآية</Label>
                <RadioOptionGrid
                  options={animationProfileOptions}
                  value={settings.animationProfile || 'karaoke'}
                  onChange={(v) => updateSetting('animationProfile', v as DisplaySettings['animationProfile'])}
                  idPrefix="animation-profile"
                  columns={2}
                />
                <div
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-lg border p-3 transition-opacity',
                    reducedMotionEnabled ? 'border-border/40' : 'border-border/20 opacity-50',
                  )}
                >
                  <div>
                    <Label
                      htmlFor="animation-reduced-motion"
                      className={cn('text-sm', reducedMotionEnabled && 'cursor-pointer')}
                    >
                      تقليل الحركة
                    </Label>
                    <p className="text-[11px] text-muted-foreground">
                      {reducedMotionEnabled
                        ? 'يحافظ على التوقيت ويوقف النبض والتكبير فقط'
                        : 'النمط «ثابت وقور» لا يحوي نبضاً، فالمفتاح بلا أثر هنا'}
                    </p>
                  </div>
                  <Switch
                    id="animation-reduced-motion"
                    disabled={!reducedMotionEnabled}
                    checked={effectiveReducedMotion === true}
                    onCheckedChange={(checked) => updateSetting('animationReducedMotion', checked)}
                  />
                </div>
              </div>

              {/* Ayah Number Style & Color */}
              <div className="space-y-4 pt-2 border-t border-border/40">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <Hash className="h-4 w-4 text-primary" />
                    شكل قوس وزخرفة رقم الآية (3D Brackets)
                  </Label>
                  {!settings.showAyahNumber && (
                    <span className="text-[11px] text-amber-500">
                      (قم بتفعيل إظهار رقم الآية من عناصر العرض أولاً)
                    </span>
                  )}
                </div>

                <RadioOptionGrid
                  options={ayahNumberOptions}
                  value={settings.ayahNumberStyle || 'quran3d'}
                  onChange={(v) => updateSetting('ayahNumberStyle', v as DisplaySettings['ayahNumberStyle'])}
                  idPrefix="ayahNum"
                  columns={2}
                />

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">لون وتدرج رقم الآية</Label>
                  <RadioOptionGrid
                    options={ayahNumberColorOptions}
                    value={settings.ayahNumberColor || 'gold'}
                    onChange={(v) => updateSetting('ayahNumberColor', v as DisplaySettings['ayahNumberColor'])}
                    idPrefix="ayahColor"
                    columns={3}
                  />
                </div>
              </div>

              {/* Ayah Transition */}
              <div className="space-y-3 pt-2 border-t border-border/40">
                <Label className="text-sm flex items-center gap-2 font-medium">
                  <Wand2 className="h-4 w-4 text-primary" />
                  تأثير الانتقال بين الآيات
                </Label>
                <RadioOptionGrid
                  options={transitionOptions}
                  value={settings.ayahTransition || 'fade'}
                  onChange={(v) => updateSetting('ayahTransition', v as DisplaySettings['ayahTransition'])}
                  idPrefix="trans"
                  columns={3}
                />
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* ═══ Section 4: Frame & Screen Border ═══ */}
          <AccordionItem value="frame-background" className="border-b px-4">
            <AccordionTrigger className="text-sm font-semibold gap-2 py-3.5 hover:no-underline">
              <span className="flex items-center gap-2">
                <Frame className="h-4 w-4 text-primary" />
                الإطارات الإسلامية (إطار النص وإطار الشاشة الكاملة)
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-6 pb-4">
              {/* 1. Text Frame */}
              <div className="space-y-3 p-3.5 rounded-xl bg-card/50 border border-border/50">
                <div className="flex items-center justify-between">
                  <Label className="text-sm flex items-center gap-2 font-medium">
                    <Frame className="h-4 w-4 text-amber-500" />
                    إطار النص القرآني المحيط بالآيات
                  </Label>
                  <span className="text-[11px] text-muted-foreground">محيط بالآيات فقط</span>
                </div>
                <RadioOptionGrid
                  options={frameOptions}
                  value={settings.frameStyle || 'none'}
                  onChange={(v) => updateSetting('frameStyle', v as DisplaySettings['frameStyle'])}
                  idPrefix="frame"
                />
              </div>

              {/* 2. Full-Screen Video Border */}
              <div className="space-y-4 p-3.5 rounded-xl bg-card/50 border border-border/50">
                <div className="flex items-center justify-between">
                  <Label className="text-sm flex items-center gap-2 font-medium">
                    <Maximize2 className="h-4 w-4 text-primary" />
                    إطار الشاشة والفيديو الكامل (Full-Screen Border)
                  </Label>
                  <span className="text-[11px] text-emerald-500 font-semibold">برواز لكامل الشاشة</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  برواز زخرفي سينمائي يحيط بكامل أبعاد شاشة الفيديو (9:16) ليعطي طابع القنوات التلفزيونية والإنتاج الفاخر.
                </p>

                <RadioOptionGrid
                  options={screenBorderStyleOptions}
                  value={settings.screenBorderStyle || 'none'}
                  onChange={(v) => updateSetting('screenBorderStyle', v as DisplaySettings['screenBorderStyle'])}
                  idPrefix="screenBorder"
                  columns={2}
                />

                {settings.screenBorderStyle && settings.screenBorderStyle !== 'none' && (
                  <div className="space-y-2 pt-2 border-t border-border/30">
                    <Label className="text-xs text-muted-foreground">لون وتدرج إطار الشاشة</Label>
                    <RadioOptionGrid
                      options={screenBorderColorOptions}
                      value={settings.screenBorderColor || 'gold'}
                      onChange={(v) => updateSetting('screenBorderColor', v as DisplaySettings['screenBorderColor'])}
                      idPrefix="screenBorderColor"
                      columns={4}
                    />
                  </div>
                )}
              </div>

              {/* Slideshow Transition */}
              <div className="space-y-3 pt-2 border-t border-border/40">
                <Label className="text-sm font-medium">نمط الانتقال بين صور السلايدشو</Label>
                <RadioOptionGrid
                  options={slideshowTransitionOptions}
                  value={settings.slideshowTransition || 'crossfade'}
                  onChange={(v) => updateSetting('slideshowTransition', v as DisplaySettings['slideshowTransition'])}
                  idPrefix="slt"
                />
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* ═══ Section 5: Watermark & Branding (Custom Identity & AI Logo) ═══ */}
          <AccordionItem value="watermark-branding" className="border-b px-4">
            <AccordionTrigger className="text-sm font-semibold gap-2 py-3.5 hover:no-underline">
              <span className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-primary" />
                العلامة المائية والهوية البصرية (اللوجو والذكاء الاصطناعي)
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-5 pb-4">
              {!canUseFeature('customBranding') ? (
                <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 py-10 text-center space-y-3">
                  <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">الشعار والهوية البصرية المخصصة متاحان للعضوية المميزة فقط</p>
                  <PremiumBadge showLock />
                </div>
              ) : <>
              <p className="text-xs text-muted-foreground">
                خصص هوية قناتك بالكامل: اختر اسمك وعلامتك المميزة، أو قم بتوليد شعار إسلامي ملكي فاخر بالذكاء الاصطناعي.
              </p>

              {/* Sub-Card A: Logo & Channel Identity with AI Generator */}
              <div className="p-4 rounded-xl border border-border/70 bg-card/60 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500 text-xs font-bold">
                      LOGO
                    </div>
                    <div>
                      <Label htmlFor="logoWatermarkEnabled" className="font-semibold text-sm cursor-pointer block">
                        الشعار وهوية القناة
                      </Label>
                      <span className="text-[11px] text-muted-foreground">
                        ختم وهوية خاصة بك مصممة باسمك أو بالذكاء الاصطناعي
                      </span>
                    </div>
                  </div>
                  <Switch
                    id="logoWatermarkEnabled"
                    checked={settings.logoWatermarkEnabled ?? false}
                    onCheckedChange={(checked) => updateSetting('logoWatermarkEnabled', checked)}
                  />
                </div>

                {(settings.logoWatermarkEnabled ?? false) && (
                  <div className="space-y-4 pt-2 border-t border-border/40">
                    <fieldset className="rounded-xl border border-border/60 bg-muted/20 p-3" disabled={isLoadingBrandLogo || isGeneratingLogo}>
                      <legend className="px-1 text-sm font-semibold">هوية <bdi>AyahX</bdi></legend>
                      <p className="mb-3 text-xs text-muted-foreground">اختر شعارًا للفيديو. يمكنك تغييره أو إلغاء العلامة المائية في أي وقت.</p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {BRAND_WATERMARKS.map(asset => (
                          <Button key={asset.id} type="button" variant="outline" className="h-auto min-h-20 flex-col gap-2 p-3"
                            disabled={!canUseFeature('customBranding') || isLoadingBrandLogo || isGeneratingLogo}
                            onClick={() => void handleBrandLogo(asset.id)}>
                            <span className={cn('flex h-9 w-full items-center justify-center rounded-md px-2', asset.id === 'white' ? 'bg-[#0D2C46]' : 'bg-white')}>
                              <img src={asset.url} alt="" width={asset.id === 'symbol' ? 36 : 112} height={36} className="h-9 max-w-full object-contain" loading="lazy" />
                            </span>
                            <span className="text-xs">{asset.label}</span>
                          </Button>
                        ))}
                      </div>
                      {!canUseFeature('customBranding') && <p className="mt-2 text-xs text-muted-foreground">متاح مع ميزة الهوية المخصصة في العضوية المميزة.</p>}
                      <p role="status" className="sr-only">{isLoadingBrandLogo ? 'جاري تحميل الشعار' : ''}</p>
                    </fieldset>
                    {/* Channel Name & Subtitle inputs */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-muted/30 border border-border/40">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">اسم القناة / الماركة الخاصة بك</Label>
                        <Input
                          placeholder="مثال: نور القرآن، تلاوات خاشعة"
                          value={settings.logoBrandName || ''}
                          onChange={(e) => updateSetting('logoBrandName', e.target.value)}
                          className="text-xs h-8"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">النص الفرعي / الوصف المختصر</Label>
                        <Input
                          placeholder="مثال: تلاوة مباركة، صدقة جارية"
                          value={settings.logoSubtitle || ''}
                          onChange={(e) => updateSetting('logoSubtitle', e.target.value)}
                          className="text-xs h-8"
                        />
                      </div>
                    </div>

                    {/* AI Logo Generator Box */}
                    <div className="p-3.5 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 via-amber-500/5 to-transparent space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Bot className="h-4 w-4 text-primary" />
                          <span className="text-xs font-bold text-foreground">مولد الشعارات بالذكاء الاصطناعي</span>
                        </div>
                        <span className="text-[10px] bg-primary/15 text-primary font-bold px-2 py-0.5 rounded-full">
                          تصميم فوري 3D
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {logoAiStyleOptions.map((st) => (
                          <Button
                            key={st.value}
                            type="button"
                            variant={logoAiStyle === st.value ? 'default' : 'outline'}
                            size="sm"
                            className={`h-auto py-2 text-xs flex-col items-start text-right ${
                              logoAiStyle === st.value ? 'gradient-primary' : ''
                            }`}
                            onClick={() => setLogoAiStyle(st.value as any)}
                          >
                            <span className="font-semibold text-[11px]">{st.label}</span>
                            <span className="text-[10px] opacity-70 line-clamp-1">{st.desc}</span>
                          </Button>
                        ))}
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          type="button"
                          onClick={handleGenerateAiLogo}
                          disabled={isGeneratingLogo}
                          className="flex-1 gap-2 text-xs gradient-primary text-primary-foreground font-semibold shadow-sm h-9"
                        >
                          {isGeneratingLogo ? (
                            <>
                              <Bot className="h-4 w-4 animate-spin" />
                              <span>جاري هندسة الشعار الفاخر...</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-4 w-4" />
                              <span>توليد الشعار بالذكاء الاصطناعي ✨</span>
                            </>
                          )}
                        </Button>

                        <input
                          type="file"
                          ref={fileInputRef}
                          onChange={handleLogoFileUpload}
                          accept="image/*"
                          className="hidden"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          className="gap-1 text-xs shrink-0 h-9"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          <span>رفع صورة</span>
                        </Button>
                      </div>

                      {settings.logoWatermarkUrl && (
                        <div className="flex items-center gap-3 p-2 rounded-lg bg-background/80 border border-border/50">
                          <img
                            src={settings.logoWatermarkUrl}
                            alt="Logo preview"
                            className="w-10 h-10 rounded-full object-contain bg-black/40 border border-amber-500/40 p-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <span className="text-[11px] font-semibold text-emerald-500 flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              الشعار مفعّل وجاهز على الفيديو
                            </span>
                            <span className="text-[10px] text-muted-foreground truncate block">
                              {settings.logoBrandName || 'شعار مخصص'}
                            </span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => updateSetting('logoWatermarkUrl', '')}
                            className="h-7 text-[10px] text-destructive hover:bg-destructive/10"
                          >
                            إلغاء
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">طابع الشعار</Label>
                      <RadioOptionGrid
                        options={logoPresentationOptions}
                        value={settings.logoWatermarkPreset || 'goldCalligraphy'}
                        onChange={(val) => updateSetting('logoWatermarkPreset', val as DisplaySettings['logoWatermarkPreset'])}
                        idPrefix="logostyle"
                        columns={2}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">موضع الشعار على الفيديو</Label>
                      <RadioOptionGrid
                        options={logoPositionOptions}
                        value={settings.logoWatermarkPosition || 'topRight'}
                        onChange={(val) => updateSetting('logoWatermarkPosition', val as DisplaySettings['logoWatermarkPosition'])}
                        idPrefix="logopos"
                        columns={2}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span>حجم الشعار</span>
                          <span className="font-mono text-primary">{settings.logoWatermarkSize || 85}px</span>
                        </div>
                        <Slider
                          value={[settings.logoWatermarkSize || 85]}
                          min={40}
                          max={160}
                          step={5}
                          onValueChange={([val]) => updateSetting('logoWatermarkSize', val)}
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span>الشفافية</span>
                          <span className="font-mono text-primary">{Math.round((settings.logoWatermarkOpacity ?? 0.95) * 100)}%</span>
                        </div>
                        <Slider
                          value={[Math.round((settings.logoWatermarkOpacity ?? 0.95) * 100)]}
                          min={20}
                          max={100}
                          step={5}
                          onValueChange={([val]) => updateSetting('logoWatermarkOpacity', val / 100)}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Sub-Card B: Social Media Handle Watermark */}
              <div className="p-4 rounded-xl border border-border/70 bg-card/60 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-500 text-xs font-bold">
                      <AtSign className="h-4 w-4" />
                    </div>
                    <div>
                      <Label htmlFor="socialWatermarkEnabled" className="font-semibold text-sm cursor-pointer block">
                        معرف التواصل الاجتماعي
                      </Label>
                      <span className="text-[11px] text-muted-foreground">
                        نص المعرف مع أيقونة المنصة مثل ⓕ Quran1minute
                      </span>
                    </div>
                  </div>
                  <Switch
                    id="socialWatermarkEnabled"
                    checked={settings.socialWatermarkEnabled ?? false}
                    onCheckedChange={(checked) => updateSetting('socialWatermarkEnabled', checked)}
                  />
                </div>

                {(settings.socialWatermarkEnabled ?? false) && (
                  <div className="space-y-3.5 pt-2 border-t border-border/40">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">المنصة والأيقونة</Label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {socialPlatformOptions.map((plat) => {
                          const isSelected = (settings.socialPlatform || 'facebook') === plat.value;
                          return (
                            <Button
                              key={plat.value}
                              type="button"
                              variant={isSelected ? 'default' : 'outline'}
                              size="sm"
                              className={`h-8 text-xs gap-1 justify-center ${isSelected ? 'gradient-primary' : ''}`}
                              onClick={() => updateSetting('socialPlatform', plat.value as DisplaySettings['socialPlatform'])}
                            >
                              <span>{plat.icon}</span>
                              <span className="truncate">{plat.label}</span>
                            </Button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs font-medium">اسم الحساب / المعرف</Label>
                      <Input
                        value={settings.socialHandle ?? ''}
                        onChange={(e) => {
                          updateSetting('socialHandle', e.target.value);

                        }}
                        placeholder="@QuranReels أو @username"
                        className="text-sm font-mono h-9"
                        dir="ltr"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">موضع المعرف على الفيديو</Label>
                      <RadioGroup
                        value={settings.socialWatermarkPosition || 'bottomCenter'}
                        onValueChange={(val) => {
                          updateSetting('socialWatermarkPosition', val as DisplaySettings['socialWatermarkPosition']);

                        }}
                        className="grid grid-cols-3 gap-2"
                      >
                        {socialPositionOptions.map((option) => (
                          <div key={option.value} className="relative">
                            <RadioGroupItem value={option.value} id={`socpos-${option.value}`} className="peer sr-only" />
                            <Label
                              htmlFor={`socpos-${option.value}`}
                              className="flex items-center justify-center rounded-lg border-2 border-muted p-2 hover:bg-muted/50 peer-data-[state=checked]:border-primary cursor-pointer text-center text-xs"
                            >
                              {option.label}
                            </Label>
                          </div>
                        ))}
                      </RadioGroup>

                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs"><span>حجم المعرف</span><span className="font-mono text-primary">{settings.socialWatermarkSize || 18}px</span></div>
                          <Slider value={[settings.socialWatermarkSize || 18]} min={12} max={28} step={1} onValueChange={([val]) => updateSetting('socialWatermarkSize', val)} />
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs"><span>وضوح المعرف</span><span className="font-mono text-primary">{Math.round((settings.socialWatermarkOpacity ?? 0.85) * 100)}%</span></div>
                          <Slider value={[Math.round((settings.socialWatermarkOpacity ?? 0.85) * 100)]} min={30} max={100} step={5} onValueChange={([val]) => updateSetting('socialWatermarkOpacity', val / 100)} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              </>}
            </AccordionContent>
          </AccordionItem>

          {/* ═══ Section 6: Luxury Visual Templates ═══ */}
          <AccordionItem value="templates-showcase" className="px-4">
            <AccordionTrigger className="text-sm font-semibold gap-2 py-3.5 hover:no-underline">
              <span className="flex items-center gap-2">
                <Star className="h-4 w-4 text-primary" />
                تنسيقاتي المحفوظة
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-5 pb-4">
              {!canUseFeature('premiumTemplates') ? (
                <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 py-10 text-center space-y-3">
                  <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">القوالب الملكية وحفظ النمط متاحان للعضوية المميزة فقط</p>
                  <PremiumBadge showLock />
                </div>
              ) : <>
              <p className="text-xs text-muted-foreground">
                احفظ التنسيق الحالي لإعادة استخدامه. استعرض القوالب الجاهزة في تبويب «قوالب».
              </p>

              {/* User Saved Templates */}
              <div className="space-y-3 pt-3 border-t border-border/40">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Save className="h-4 w-4 text-primary" />
                  قوالبك المحفوظة الخاصة
                </Label>

                {userTemplates.length > 0 ? (
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {userTemplates.map((tpl) => (
                      <div
                        key={tpl.id}
                        className="flex items-center justify-between p-2.5 rounded-lg border border-border/50 bg-muted/30 hover:bg-muted/60 transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => handleLoadTemplate(tpl)}
                          className="font-medium text-xs sm:text-sm text-right flex-1 truncate hover:text-primary"
                        >
                          {tpl.name}
                        </button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          disabled={isSavingTemplate}
                          aria-label={`حذف قالب ${tpl.name}`}
                          onClick={() => handleDeleteTemplate(tpl.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">لم تقم بحفظ أي قوالب مخصصة بعد.</p>
                )}

                {showSaveInput ? (
                  <div className="flex gap-2">
                    <Input
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      placeholder="اسم القالب (مثال: ريلز الجمعة الفاخر)..."
                      className="text-xs h-9"
                      dir="auto"
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveTemplate()}
                    />
                    <Button size="sm" onClick={handleSaveTemplate} disabled={!templateName.trim() || isSavingTemplate} className="gap-1.5 gradient-primary">
                      <Save className="h-3.5 w-3.5" />
                      حفظ
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-2 border-dashed border-primary/40 hover:bg-primary/5"
                    onClick={() => setShowSaveInput(true)}
                  >
                    <Save className="h-4 w-4 text-primary" />
                    حفظ التنسيق الحالي كقالب خاص
                  </Button>
                )}
              </div>
              </>}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}
