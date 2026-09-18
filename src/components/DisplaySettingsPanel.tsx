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
} from 'lucide-react';
import { toast } from 'sonner';
import { useState, useRef } from 'react';
import { useSubscription } from '@/hooks/useSubscription';
import { api } from '@/lib/api';
import { PremiumBadge } from '@/components/PremiumBadge';

export interface DisplaySettings {
  /** Overall visual direction for the reel canvas. */
  visualDesign?: 'dawn' | 'editorial' | 'moonlit';
  showSurahName: boolean;
  showReciterName: boolean;
  showAyahText: boolean;
  showAyahNumber: boolean;
  highlightStyle: 'none' | 'solid' | 'glow' | 'underline' | 'shadow';
  frameStyle: 'none' | 'simple' | 'ornate' | 'golden' | 'geometric' | 'modern' | 'minimal';
  ayahNumberStyle: 'quran3d' | 'circle' | 'star' | 'diamond' | 'octagon' | 'flower' | 'square' | 'hexagon';
  ayahNumberColor: 'gold' | 'metallicGold3D' | 'white' | 'silver' | 'emerald' | 'royal';
  verseDisplayMode: 'full' | 'twoWords' | 'threeTwo' | 'wordByWord';
  surahNamePosition: 'top' | 'bottom' | 'topLeft' | 'topRight';
  surahNameStyle: 'classic' | 'goldenBadge' | 'banner' | 'calligraphy' | 'circle' | 'diamond' | 'ribbon';
  reciterNameStyle: 'simple' | 'elegant' | 'audioPill' | 'badge' | 'tag' | 'glow';
  textShadowStyle: 'none' | 'soft' | 'strong' | '3d' | 'glow' | 'outline';
  ayahTransition: 'none' | 'fade' | 'slide' | 'zoom' | 'blur' | 'rise' | 'rotate' | 'cinematic' | 'elastic' | 'random';

  // Legacy / Basic Watermark compatibility
  watermarkEnabled: boolean;
  watermarkText: string;
  watermarkPosition: 'bottomLeft' | 'bottomRight' | 'topLeft' | 'topRight' | 'bottomCenter';

  // Dual-mode Watermark: Logo & Channel Identity
  logoWatermarkEnabled?: boolean;
  logoWatermarkPreset?: 'goldCalligraphy' | 'circularMedallion' | 'geometricEmblem' | 'glassMonogram' | 'custom';
  logoBrandName?: string;
  logoSubtitle?: string;
  logoWatermarkUrl?: string;
  logoWatermarkPosition?: 'topRight' | 'topLeft' | 'bottomRight' | 'bottomLeft';
  logoWatermarkSize?: number; // 40 - 150
  logoWatermarkOpacity?: number; // 0.2 - 1.0

  // Full-Screen Video Border
  screenBorderStyle?: 'none' | 'goldenTrim' | 'islamicCorners' | 'doubleCinema' | 'royalCrest' | 'subtleVignette';
  screenBorderColor?: 'gold' | 'emerald' | 'white' | 'silver';

  // Dual-mode Watermark: Social Handle
  socialWatermarkEnabled?: boolean;
  socialPlatform?: 'facebook' | 'instagram' | 'tiktok' | 'youtube' | 'x' | 'custom';
  socialHandle?: string;
  socialWatermarkPosition?: 'bottomCenter' | 'bottomRight' | 'bottomLeft' | 'topCenter';
  socialWatermarkSize?: number; // 12 - 28
  socialWatermarkOpacity?: number; // 0.3 - 1.0

  glowStyle?: 'none' | 'golden' | 'soft' | 'neon' | 'pulse' | 'emerald' | 'royal';
  lyricsDisplayStyle: 'scroll' | 'single' | 'karaoke' | 'fade';
  slideshowTransition: 'crossfade' | 'slideLeft' | 'slideRight' | 'slideUp' | 'zoomThrough' | 'wipe' | 'mixed';
}

interface DisplaySettingsPanelProps {
  settings: DisplaySettings;
  onChange: (settings: DisplaySettings) => void;
}

const highlightOptions = [
  { value: 'none', label: 'بدون تمييز', description: 'لا يتم تمييز الكلمات' },
  { value: 'glow', label: 'توهج الكلمة', description: 'إضاءة محيطية حول الكلمة المقروءة' },
  { value: 'solid', label: 'تظليل مملوء', description: 'كبسولة خلفية ملونة' },
  { value: 'underline', label: 'خط سفلي', description: 'خط ذهبي أنيق تحت الكلمة' },
  { value: 'shadow', label: 'ظل ناعم', description: 'ظل عميق محيط' },
];

const frameOptions = [
  { value: 'none', label: 'بدون إطار', description: 'نص حر بدون حواف' },
  { value: 'simple', label: 'إطار أنيق', description: 'حدود رفيعة ناعمة' },
  { value: 'ornate', label: 'إطار مزخرف', description: 'زخرفة إسلامية كلاسيكية' },
  { value: 'golden', label: 'إطار ذهبي', description: 'توهج وحواف ذهبية 3D' },
  { value: 'geometric', label: 'إطار هندسي', description: 'أنماط هندسية دقيقة' },
  { value: 'modern', label: 'إطار عصري', description: 'خطوط ناعمة منحنية' },
  { value: 'minimal', label: 'إطار بسيط', description: 'حد واحد شفاف' },
];

const ayahNumberOptions = [
  { value: 'quran3d', label: 'قوس قرآني 3D ﴿...﴾', description: 'قوس ذهبي مذهب مثل الريلز الفيروسي' },
  { value: 'circle', label: 'دائرة ذهبية', description: '◯' },
  { value: 'star', label: 'نجمة إسلامية', description: '✦' },
  { value: 'diamond', label: 'معين ملكي', description: '◇' },
  { value: 'octagon', label: 'مثمن هندسي', description: '⬡' },
  { value: 'flower', label: 'زهرة قرآنية', description: '✿' },
  { value: 'square', label: 'مربع عصري', description: '◻' },
  { value: 'hexagon', label: 'سداسي', description: '⬢' },
];

const surahPositionOptions = [
  { value: 'top', label: 'أعلى المنتصف', description: 'مركز الأعلى' },
  { value: 'bottom', label: 'أسفل', description: 'مركز الأسفل' },
  { value: 'topLeft', label: 'أعلى يسار', description: 'الزاوية العليا' },
  { value: 'topRight', label: 'أعلى يمين', description: 'الزاوية اليمنى' },
];

// Default to 'none' as requested
const textShadowOptions = [
  { value: 'none', label: 'بدون ظل (افتراضي)', description: 'نص نقي مسطح مثل الريلز الاحترافية' },
  { value: 'soft', label: 'ظل سينمائي ناعم', description: 'تدرج خفيف يعطي بعداً' },
  { value: 'strong', label: 'ظل داكن بارز', description: 'ظل عميق ذو تباين عالٍ' },
  { value: '3d', label: 'تجسيم 3D عميق', description: 'بروز واقعي ثلاثي الأبعاد' },
  { value: 'glow', label: 'توهج نوراني', description: 'هالة ضوئية مشعة' },
  { value: 'outline', label: 'تحديد كونتور Outline', description: 'حدود محيطية دقيقة' },
];

const transitionOptions = [
  { value: 'none', label: 'بدون انتقال', description: 'ظهور مباشر' },
  { value: 'fade', label: 'تلاشي ناعم', description: 'ظهور تدريجي سينمائي' },
  { value: 'slide', label: 'انزلاق', description: 'دخول انسيابي من الأسفل' },
  { value: 'zoom', label: 'تكبير ناعم', description: 'تقريب للداخل' },
  { value: 'blur', label: 'كشف ضبابي', description: 'إزالة الضبابية' },
  { value: 'rise', label: 'صعود ناعم', description: 'ارتفاع سينمائي' },
  { value: 'rotate', label: 'دوران خفيف', description: 'ميل احترافي' },
  { value: 'cinematic', label: 'سينمائي درامي', description: 'دخول درامي ناعم' },
  { value: 'elastic', label: 'مرن وأنيق', description: 'ارتداد هادئ' },
  { value: 'random', label: '🎲 عشوائي', description: 'تأثير مختلف لكل آية' },
];

const surahNameStyleOptions = [
  { value: 'classic', label: 'كلاسيكي', description: 'شارة مستطيلة مزخرفة' },
  { value: 'goldenBadge', label: 'شارة ذهبية ملكية', description: 'إطار ذهبي محفور' },
  { value: 'banner', label: 'لافتة', description: 'شريط عريض متدرج' },
  { value: 'calligraphy', label: 'خطي حر', description: 'نص مزخرف بدون خلفية' },
  { value: 'circle', label: 'دائرة', description: 'داخل دائرة ذهبية' },
  { value: 'diamond', label: 'معين', description: 'شكل ماسي أنيق' },
  { value: 'ribbon', label: 'شريط', description: 'شريط ملفوف متدرج' },
];

const reciterNameStyleOptions = [
  { value: 'simple', label: 'بسيط نقي', description: 'نص أنيق شفاف' },
  { value: 'audioPill', label: 'كبسولة صوتية', description: 'شارة بيضاوية مع أيقونة ميكروفون' },
  { value: 'elegant', label: 'أنيق بظل', description: 'خط مزخرف بظل ناعم' },
  { value: 'badge', label: 'شارة', description: 'داخل شارة مستطيلة' },
  { value: 'tag', label: 'علامة حديثة', description: 'تصميم وسم عصري' },
  { value: 'glow', label: 'متوهج', description: 'توهج ذهبي حول النص' },
];

const ayahNumberColorOptions = [
  { value: 'gold', label: 'ذهبي أصيل', description: '✨', color: '#D4AF37' },
  { value: 'metallicGold3D', label: 'ذهبي معدني 3D', description: '👑', color: '#FFD700' },
  { value: 'white', label: 'أبيض ناصع', description: '⬜', color: '#FFFFFF' },
  { value: 'silver', label: 'فضي لامع', description: '🩶', color: '#C0C0C0' },
  { value: 'emerald', label: 'زمردي إسلامي', description: '💚', color: '#10B981' },
  { value: 'royal', label: 'بنفسجي ملكي', description: '💜', color: '#8B5CF6' },
];

const verseDisplayModeOptions = [
  { value: 'full', label: 'الآية كاملة', description: 'عرض الآية كاملة مع التمرير والالتفاف' },
  { value: 'twoWords', label: 'كلمتان', description: 'عرض كلمتين كلمتين بالتناوب' },
  { value: 'threeTwo', label: 'ثلاث ثم اثنتان', description: 'تقسيم إيقاعي ديناميكي' },
  { value: 'wordByWord', label: 'كلمة كلمة', description: 'عرض كلمة تلو الأخرى (تيك توك ترند)' },
];

const glowStyleOptions = [
  { value: 'golden', label: 'ذهبي أصيل', description: 'توهج ملكي دافئ (#D4AF37)' },
  { value: 'soft', label: 'إشراقة بيضاء', description: 'إضاءة نورانية هادئة ونقية' },
  { value: 'neon', label: 'نيون سماوي', description: 'توهج أزرق سماوي ساطع' },
  { value: 'emerald', label: 'أخضر زمردي', description: 'توهج إسلامي فاخر' },
  { value: 'pulse', label: 'نبض عنبري', description: 'توهج متموج ومتحرك' },
  { value: 'royal', label: 'بنفسجي ملكي', description: 'توهج مهيب فاخر' },
  { value: 'none', label: 'بدون توهج', description: 'لون نص ثابت' },
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

const watermarkPositionOptions = [
  { value: 'bottomRight', label: 'أسفل يمين', description: 'الزاوية السفلى اليمنى' },
  { value: 'bottomCenter', label: 'أسفل وسط (موصى به)', description: 'منتصف أسفل الفيديو' },
  { value: 'bottomLeft', label: 'أسفل يسار', description: 'الزاوية السفلى اليسرى' },
  { value: 'topRight', label: 'أعلى يمين', description: 'الزاوية العليا اليمنى' },
  { value: 'topLeft', label: 'أعلى يسار', description: 'الزاوية العليا اليسرى' },
];

const socialPositionOptions = [
  ...watermarkPositionOptions.slice(0, 3),
  { value: 'topCenter', label: 'أعلى وسط', description: 'شريط هوية علوي واضح' },
];

const logoPositionOptions = [
  { value: 'topRight', label: 'أعلى يمين (موصى به)', description: 'الزاوية العليا اليمنى' },
  { value: 'topLeft', label: 'أعلى يسار', description: 'الزاوية العليا اليسرى' },
  { value: 'bottomRight', label: 'أسفل يمين', description: 'الزاوية السفلى اليمنى' },
  { value: 'bottomLeft', label: 'أسفل يسار', description: 'الزاوية السفلى اليسرى' },
];

const logoPresentationOptions = [
  { value: 'goldCalligraphy', label: 'ختم ذهبي 2D', description: 'هوية عربية هادئة' },
  { value: 'circularMedallion', label: 'ميدالية ملكية 3D', description: 'عمق وحواف مذهبّة' },
  { value: 'geometricEmblem', label: 'شعار هندسي 2D', description: 'دقة عصرية واضحة' },
  { value: 'glassMonogram', label: 'زجاجي فاخر 3D', description: 'طبقات شفافة راقية' },
  { value: 'custom', label: 'صورة مخصصة', description: 'شعار القناة الحقيقي' },
];

const socialPlatformOptions = [
  { value: 'facebook', label: 'فيسبوك (ⓕ)', icon: 'ⓕ' },
  { value: 'instagram', label: 'إنستجرام', icon: '📸' },
  { value: 'tiktok', label: 'تيك توك', icon: '🎵' },
  { value: 'youtube', label: 'يوتيوب', icon: '▶' },
  { value: 'x', label: 'منصة X', icon: '𝕏' },
  { value: 'custom', label: 'نص مخصص', icon: '✏️' },
];

const screenBorderStyleOptions = [
  { value: 'none', label: 'بدون إطار شاشة', description: 'شاشة سينمائية حرة' },
  { value: 'goldenTrim', label: 'إطار ذهبي رفيع مزدوج', description: 'برواز ذهبي سينمائي ناعم ومضيء' },
  { value: 'islamicCorners', label: 'زخارف إسلامية ملكية', description: 'زخارف إسلامية فاخرة في زوايا الشاشة' },
  { value: 'doubleCinema', label: 'إطار سينمائي منحني', description: 'حواف سينمائية مزدوجة 3D' },
  { value: 'royalCrest', label: 'برواز عثماني منقوش', description: 'نقش ملكي محفور يحيط بالفيديو' },
  { value: 'subtleVignette', label: 'تظليل سينمائي محيطي', description: 'تدرج أسود ناعم يعزز تركيز النص' },
];

const screenBorderColorOptions = [
  { value: 'gold', label: 'ذهبي ملكي', description: '✨', color: '#D4AF37' },
  { value: 'emerald', label: 'أخضر زمردي', description: '💚', color: '#10B981' },
  { value: 'white', label: 'أبيض ناصع', description: '⬜', color: '#FFFFFF' },
  { value: 'silver', label: 'فضي كلاسيكي', description: '🩶', color: '#CBD5E1' },
];

const logoAiStyleOptions = [
  { value: 'goldMedallion', label: 'ختم ملكي مذهب', desc: 'نجمة إسلامية ثمانية مع حواف لؤلؤية وتدرج ذهبي' },
  { value: 'ottomanCrest', label: 'وسام عثماني فاخر', desc: 'هلال مذهب وزخارف تاجية ملكية' },
  { value: 'modernGeometric', label: 'شعار هندسي حديث', desc: 'درع هندسي ثلاثي الأبعاد مع إضاءة نيون' },
  { value: 'classicCalligraphy', label: 'خط عربي كلاسيكي', desc: 'حلقة أرابيسك نباتية وخط ثلث فاخر' },
];

const TEMPLATES_KEY = 'ayah-clip-display-templates';

interface SavedTemplate {
  id: string;
  name: string;
  settings: DisplaySettings;
  createdAt: number;
  badge?: string;
}

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
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
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
}: {
  options: { value: string; label: string; description?: string; color?: string }[];
  value: string;
  onChange: (val: string) => void;
  idPrefix: string;
  columns?: number;
}) {
  const gridCols = columns === 3 ? 'grid-cols-3' : columns === 4 ? 'grid-cols-4' : 'grid-cols-2';
  return (
    <RadioGroup value={value} onValueChange={onChange} className={`grid ${gridCols} gap-2`}>
      {options.map((option) => (
        <div key={option.value} className="relative">
          <RadioGroupItem value={option.value} id={`${idPrefix}-${option.value}`} className="peer sr-only" />
          <Label
            htmlFor={`${idPrefix}-${option.value}`}
            className="flex flex-col items-center rounded-lg border-2 border-muted p-2.5 hover:bg-muted/50 peer-data-[state=checked]:border-primary cursor-pointer transition-all text-center h-full justify-center"
          >
            {option.color ? (
              <span className="text-lg" style={{ color: option.color }}>
                {option.description}
              </span>
            ) : (
              <span className="font-medium text-xs sm:text-sm">{option.label}</span>
            )}
            {option.color ? (
              <span className="text-xs font-medium">{option.label}</span>
            ) : (
              option.description && (
                <span className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{option.description}</span>
              )
            )}
          </Label>
        </div>
      ))}
    </RadioGroup>
  );
}

export function DisplaySettingsPanel({ settings, onChange }: DisplaySettingsPanelProps) {
  const { canUseFeature } = useSubscription();
  const [userTemplates, setUserTemplates] = useState<SavedTemplate[]>(loadTemplates);
  const [templateName, setTemplateName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [isGeneratingLogo, setIsGeneratingLogo] = useState(false);
  const [logoAiStyle, setLogoAiStyle] = useState<'goldMedallion' | 'ottomanCrest' | 'modernGeometric' | 'classicCalligraphy'>('goldMedallion');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const updateSetting = <K extends keyof DisplaySettings>(key: K, value: DisplaySettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

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
      toast.error('حدث خطأ أثناء توليد الشعار بالذكاء الاصطناعي');
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

  const handleSaveTemplate = () => {
    if (!canUseFeature('premiumTemplates')) {
      toast.error('حفظ القوالب الملكية متاح للعضوية المميزة فقط');
      return;
    }
    if (!templateName.trim()) return;
    const newTemplate: SavedTemplate = {
      id: `tpl-${Date.now()}`,
      name: templateName.trim(),
      settings: { ...settings },
      createdAt: Date.now(),
    };
    const updated = [...userTemplates, newTemplate];
    setUserTemplates(updated);
    saveTemplates(updated);
    setTemplateName('');
    setShowSaveInput(false);
    toast.success(`تم حفظ القالب "${newTemplate.name}"`);
  };

  const handleLoadTemplate = (tpl: SavedTemplate) => {
    if (!canUseFeature('premiumTemplates')) {
      toast.error('القوالب الجاهزة الفاخرة متاحة للعضوية المميزة فقط');
      return;
    }
    onChange({ ...tpl.settings });
    toast.success(`تم تطبيق قالب "${tpl.name}" ✨`);
  };

  const handleDeleteTemplate = (id: string) => {
    const updated = userTemplates.filter((t) => t.id !== id);
    setUserTemplates(updated);
    saveTemplates(updated);
    toast.success('تم حذف القالب');
  };

  return (
    <Card className="border-border/60 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center justify-between">
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
          <AccordionItem value="text-styling" className="border-b px-4">
            <AccordionTrigger className="text-sm font-semibold gap-2 py-3.5 hover:no-underline">
              <span className="flex items-center gap-2">
                <Palette className="h-4 w-4 text-primary" />
                نمط النصوص والظل والتوهج
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-5 pb-4">
              {/* Text Shadow Style - Default None */}
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

              {/* Glow Aura Style (Active for glow / highlighting) */}
              {settings.highlightStyle !== 'none' && (
                <div className="space-y-3 p-3.5 rounded-xl bg-gradient-to-r from-primary/5 via-muted/40 to-primary/5 border border-primary/20">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs sm:text-sm flex items-center gap-1.5 font-semibold text-primary">
                      <Sparkles className="h-4 w-4" />
                      نوع ولون هالة التوهج (Glow Aura Style)
                    </Label>
                    <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                      مظهر سينمائي
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
            </AccordionContent>
          </AccordionItem>

          {/* ═══ Section 3: Verse Display & 3D Ayah Number ═══ */}
          <AccordionItem value="verse-display" className="border-b px-4">
            <AccordionTrigger className="text-sm font-semibold gap-2 py-3.5 hover:no-underline">
              <span className="flex items-center gap-2">
                <LayoutGrid className="h-4 w-4 text-primary" />
                طريقة عرض الآيات ورقم الآية 3D
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-5 pb-4">
              {/* Verse Display Mode */}
              <div className="space-y-3">
                <Label className="text-sm flex items-center gap-2 font-medium">
                  <Type className="h-4 w-4 text-primary" />
                  طريقة تقسيم وععرض الآيات
                </Label>
                <RadioOptionGrid
                  options={verseDisplayModeOptions}
                  value={settings.verseDisplayMode || 'full'}
                  onChange={(v) => updateSetting('verseDisplayMode', v as DisplaySettings['verseDisplayMode'])}
                  idPrefix="vdm"
                />
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
                خصص هوية قناتك بالكامل: اختر اسمك وعلامتك المميزة، أو قم بتوليد شعار إسلامي ملكي فاخر بالذكاء الاصطناعي (Gemini AI).
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
                        الشعار وهوية القناة (Channel Logo & Seal)
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
                          <span className="text-xs font-bold text-foreground">مولد الشعارات بالذكاء الاصطناعي (Gemini AI)</span>
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
                          <span className="font-mono text-primary">{Math.round((settings.logoWatermarkOpacity || 0.95) * 100)}%</span>
                        </div>
                        <Slider
                          value={[Math.round((settings.logoWatermarkOpacity || 0.95) * 100)]}
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
                        معرف التواصل الاجتماعي (Social Handle)
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
                        value={settings.socialHandle || '@QuranReels'}
                        onChange={(e) => {
                          updateSetting('socialHandle', e.target.value);
                          updateSetting('watermarkText', e.target.value);
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
                          updateSetting('watermarkPosition', val as DisplaySettings['watermarkPosition']);
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
                قوالب المظهر الجاهزة وحفظ النمط
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
                اختر قالباً بضغطة زر لتطبيق أفضل إعدادات التنسيق والهوية البصرية فوراً.
              </p>

              {/* Built-in Luxury Templates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {BUILTIN_DISPLAY_TEMPLATES.map((tpl) => (
                  <div
                    key={tpl.id}
                    onClick={() => handleLoadTemplate(tpl)}
                    className="p-3.5 rounded-xl border-2 border-border/60 hover:border-primary/80 bg-gradient-to-br from-card to-muted/40 cursor-pointer transition-all hover:shadow-md space-y-2 group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs sm:text-sm group-hover:text-primary transition-colors">
                        {tpl.name}
                      </span>
                      {tpl.badge && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
                          {tpl.badge}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>3D ﴿﴾</span>
                      <span>•</span>
                      <span>بدون ظل</span>
                      <span>•</span>
                      <span>لوجو ذهبي</span>
                    </div>
                  </div>
                ))}
              </div>

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
                    <Button size="sm" onClick={handleSaveTemplate} disabled={!templateName.trim()} className="gap-1.5 gradient-primary">
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
