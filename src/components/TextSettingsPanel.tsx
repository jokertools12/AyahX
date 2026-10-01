import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PremiumBadge } from '@/components/PremiumBadge';
import { useSubscription, FREE_FONTS } from '@/hooks/useSubscription';
import { Type, Palette, Layers, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { ARABIC_FONT_CATALOG } from '../../shared/planEntitlements';

export interface TextSettings {
  fontSize: number;
  fontFamily: string;
  textColor: string;
  shadowIntensity: number;
  overlayOpacity: number;
}

interface TextSettingsPanelProps {
  settings: TextSettings;
  onChange: (settings: TextSettings) => void;
}

const fontLabels: Record<(typeof ARABIC_FONT_CATALOG)[number], string> = {
  '"Noto Naskh Arabic", serif': 'نسخ',
  '"Amiri", serif': 'أميري',
  '"Cairo", sans-serif': 'القاهرة',
  '"Amiri Quran", serif': 'أميري قرآن',
  '"Scheherazade New", serif': 'شهرزاد',
  '"Aref Ruqaa", serif': 'رقعة',
  '"Reem Kufi", sans-serif': 'ريم كوفي',
  '"Lateef", serif': 'لطيف',
  '"El Messiri", sans-serif': 'المسيري',
  '"Tajawal", sans-serif': 'تجول',
  '"Mada", sans-serif': 'مدى',
  '"Katibeh", serif': 'كاتبة',
  '"Rakkas", serif': 'رقّاص',
  '"Lalezar", cursive': 'لاله‌زار',
  '"Mirza", serif': 'ميرزا',
  '"Marhey", cursive': 'مرحي',
};

const fontOptions = ARABIC_FONT_CATALOG.map((value) => ({ value, label: fontLabels[value] }));

const colorOptions = [
  { value: '#ffffff', label: 'أبيض', className: 'bg-white border border-gray-300' },
  { value: '#fef3c7', label: 'ذهبي فاتح', className: 'bg-amber-100' },
  { value: '#fbbf24', label: 'ذهبي', className: 'bg-amber-400' },
  { value: '#e0f2fe', label: 'سماوي', className: 'bg-sky-100' },
  { value: '#dcfce7', label: 'أخضر', className: 'bg-green-100' },
  { value: '#fce7f3', label: 'وردي', className: 'bg-pink-100' },
  { value: '#c0c0c0', label: 'فضي', className: 'bg-gray-300' },
  { value: '#f59e0b', label: 'كهرماني', className: 'bg-amber-500' },
  { value: '#38bdf8', label: 'أزرق سماوي', className: 'bg-sky-400' },
  { value: '#a78bfa', label: 'بنفسجي', className: 'bg-violet-400' },
  { value: '#d4af37', label: 'ذهبي ملكي', className: 'bg-yellow-600' },
  { value: '#2d6a4f', label: 'أخضر إسلامي', className: 'bg-emerald-800' },
  { value: '#1e3a5f', label: 'أزرق ملكي', className: 'bg-blue-900' },
  { value: '#e8d5b7', label: 'عاجي', className: 'bg-orange-100' },
  { value: '#ff6b6b', label: 'أحمر ناعم', className: 'bg-red-400' },
];

export function TextSettingsPanel({ settings, onChange }: TextSettingsPanelProps) {
  const { isFreeFont, isPremium } = useSubscription();

  const updateSetting = <K extends keyof TextSettings>(key: K, value: TextSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  const handleFontChange = (value: string) => {
    if (!isFreeFont(value) && !isPremium) {
      toast.error('هذا الخط متاح للأعضاء المميزين فقط');
      return;
    }
    updateSetting('fontFamily', value);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Type className="h-5 w-5" />
          تخصيص النص
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Font Size */}
        <div className="space-y-3">
          <Label className="text-sm">حجم الخط</Label>
          <Slider
            value={[settings.fontSize]}
            onValueChange={([value]) => updateSetting('fontSize', value)}
            min={18}
            max={48}
            step={2}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>صغير</span>
            <span>{settings.fontSize}px</span>
            <span>كبير</span>
          </div>
        </div>

        {/* Font Family */}
        <div className="space-y-3">
          <Label className="text-sm">نوع الخط</Label>
          <RadioGroup
            value={settings.fontFamily}
            onValueChange={handleFontChange}
            className="grid grid-cols-3 gap-2"
          >
            {fontOptions.map((font) => {
              const isFree = isFreeFont(font.value);
              const locked = !isFree && !isPremium;
              return (
                <div key={font.value} className="relative">
                  <RadioGroupItem value={font.value} id={font.value} className="peer sr-only" />
                  <Label
                    htmlFor={font.value}
                    className={`flex items-center justify-center rounded-lg border-2 border-muted p-3 hover:bg-muted/50 peer-data-[state=checked]:border-primary cursor-pointer transition-all ${locked ? 'opacity-60' : ''}`}
                    style={{ fontFamily: font.value }}
                  >
                    {font.label}
                    {locked && <Lock className="h-3 w-3 mr-1 inline-block" />}
                  </Label>
                </div>
              );
            })}
          </RadioGroup>
          {!isPremium && <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1"><PremiumBadge size="sm" showLock /> بعض الخطوط للأعضاء المميزين</div>}
        </div>

        {/* Text Color */}
        <div className="space-y-3">
          <Label className="text-sm flex items-center gap-2">
            <Palette className="h-4 w-4" />
            لون النص
          </Label>
          <p className="text-xs text-muted-foreground">لون الكلمات غير المميزة. لون الكلمة النشطة يأتي من إعدادات التمييز والتوهج أدناه.</p>
          <RadioGroup
            value={settings.textColor}
            onValueChange={(value) => updateSetting('textColor', value)}
            className="flex gap-2 flex-wrap"
          >
            {colorOptions.map((color) => (
              <div key={color.value} className="relative">
                <RadioGroupItem value={color.value} id={`color-${color.value}`} className="peer sr-only" />
                <Label
                  htmlFor={`color-${color.value}`}
                  className={`flex h-8 w-8 rounded-full cursor-pointer ring-offset-2 peer-data-[state=checked]:ring-2 peer-data-[state=checked]:ring-primary transition-all ${color.className}`}
                  title={color.label}
                />
              </div>
            ))}
          </RadioGroup>
        </div>

        {/* Shadow Intensity */}
        <div className="space-y-3">
          <Label className="text-sm flex items-center gap-2">
            <Layers className="h-4 w-4" />
            كثافة الظل
          </Label>
          <Slider
            value={[settings.shadowIntensity]}
            onValueChange={([value]) => updateSetting('shadowIntensity', value)}
            min={0}
            max={1}
            step={0.1}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>بدون</span>
            <span>قوي</span>
          </div>
        </div>

        {/* Overlay Opacity */}
        <div className="space-y-3">
          <Label className="text-sm">تعتيم الخلفية</Label>
          <Slider
            value={[settings.overlayOpacity]}
            onValueChange={([value]) => updateSetting('overlayOpacity', value)}
            min={0}
            max={0.7}
            step={0.05}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>فاتح</span>
            <span>{Math.round(settings.overlayOpacity * 100)}%</span>
            <span>معتم</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
