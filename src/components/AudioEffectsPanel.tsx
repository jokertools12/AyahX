import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { AudioEffects } from '@/hooks/useAudioEffects';
import { PremiumBadge } from '@/components/PremiumBadge';
import { useSubscription } from '@/hooks/useSubscription';
import { Music, Waves, Timer, Volume2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface AudioEffectsPanelProps {
  effects: AudioEffects;
  onChange: (effects: AudioEffects) => void;
  disabled?: boolean;
}

export function AudioEffectsPanel({ effects, onChange, disabled }: AudioEffectsPanelProps) {
  const { isPremium, canUseFeature } = useSubscription();
  const locked = !canUseFeature('audioFilters');
  
  const updateEffect = <K extends keyof AudioEffects>(key: K, value: AudioEffects[K]) => {
    onChange({ ...effects, [key]: value });
  };

  const handlePremiumToggle = (key: keyof AudioEffects, checked: boolean) => {
    if (locked) {
      toast.error('هذه الميزة متاحة للأعضاء المميزين فقط');
      return;
    }
    updateEffect(key, checked as never);
  };

  if (locked) {
    return (
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Music className="h-5 w-5" />
            المؤثرات الصوتية
            <Lock className="h-4 w-4 text-amber-500" />
          </CardTitle>
        </CardHeader>
        <CardContent className="py-8 text-center space-y-3">
          <Lock className="h-9 w-9 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">تحسين وضوح التلاوة وضبط مستواها والصدى متاح للعضوية المميزة.</p>
          <PremiumBadge showLock />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Music className="h-5 w-5" />
          استوديو الصوت
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-xs leading-relaxed text-muted-foreground">حسّن وضوح التلاوة مع الحفاظ على صوت القارئ وتوقيت الكلمات. المعالجة لا تنقل ملكية التسجيل ولا تضمن قبول نشره على المنصات.</p>
        <div className="grid grid-cols-3 gap-2" aria-label="إعدادات الصوت الجاهزة">
          <Button variant="outline" disabled={disabled} onClick={() => onChange({ ...effects, volume: 1, normalizeEnabled: false, eqEnabled: false, reverbEnabled: false, echoEnabled: false, speedAdjust: 1, pitchShift: 0, copyrightProtectionEnabled: false })}>الصوت الأصلي</Button>
          <Button variant="outline" disabled={disabled} onClick={() => onChange({ ...effects, volume: 1, normalizeEnabled: true, eqEnabled: true, reverbEnabled: false, echoEnabled: false, speedAdjust: 1, pitchShift: 0, copyrightProtectionEnabled: false })}>وضوح متوازن</Button>
          <Button variant="outline" disabled={disabled} onClick={() => onChange({ ...effects, volume: 1, normalizeEnabled: true, eqEnabled: true, reverbEnabled: true, reverbLevel: 0.2, echoEnabled: false, speedAdjust: 1, pitchShift: 0, copyrightProtectionEnabled: false })}>صدى خفيف</Button>
        </div>
        {/* The old fingerprint-evasion toggle was intentionally retired. A
            licensed audio track and a stable audio clock are required for
            trustworthy Quran word timing. */}

        {/* Master Volume / Amplification - Free */}
        <div className="space-y-3 p-3 rounded-lg bg-secondary/40 border border-secondary">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">مستوى وتضخيم الصوت</span>
            </Label>
            <span className="text-xs font-semibold text-primary">
              {Math.round((effects.volume ?? 1.25) * 100)}%
            </span>
          </div>
          <Slider
            value={[effects.volume ?? 1.25]}
            onValueChange={([value]) => updateEffect('volume' as keyof AudioEffects, value as any)}
            min={0.5}
            max={2.0}
            step={0.05}
            disabled={disabled}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>50%</span>
            <span>100%</span>
            <span>125% (موصى به)</span>
            <span>200%</span>
          </div>
        </div>

        {/* Audio Normalization - Premium */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="normalize" className="flex items-center gap-2 cursor-pointer">
              <Volume2 className="h-4 w-4 text-primary" />
              <span>تسوية الصوت</span>
              {!isPremium && <Lock className="h-3 w-3 text-muted-foreground" />}
            </Label>
            <Switch
              id="normalize"
              checked={effects.normalizeEnabled ?? false}
              onCheckedChange={(checked) => handlePremiumToggle('normalizeEnabled' as keyof AudioEffects, checked)}
              disabled={disabled}
            />
          </div>
          <p className="text-xs text-muted-foreground pr-6">
            يضبط تفاوت المستوى ديناميكياً في المعاينة والتسجيل المحلي. يستخدم التصدير السحابي تسوية جهارة الصوت مع تحديد الذروة.
          </p>
        </div>

        {/* EQ Enhancement - Premium */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="eq" className="flex items-center gap-2 cursor-pointer">
              <svg className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 21v-8M8 21V9M12 21v-6M16 21v-10M20 21V5" />
              </svg>
              <span>تحسين EQ</span>
              {!isPremium && <Lock className="h-3 w-3 text-muted-foreground" />}
            </Label>
            <Switch
              id="eq"
              checked={effects.eqEnabled ?? false}
              onCheckedChange={(checked) => handlePremiumToggle('eqEnabled' as keyof AudioEffects, checked)}
              disabled={disabled}
            />
          </div>
          <p className="text-xs text-muted-foreground pr-6">
            موازنة الترددات لإبراز وضوح الصوت ودفئه؛ لا يزيل ضجيج التسجيل الأصلي.
          </p>
        </div>

        {/* Reverb - Free */}
        <div className="space-y-4 pt-2 border-t">
          <div className="flex items-center justify-between">
            <Label htmlFor="reverb" className="flex items-center gap-2 cursor-pointer">
              <Waves className="h-4 w-4 text-primary" />
              <span>تأثير المسجد (صدى)</span>
            </Label>
            <Switch
              id="reverb"
              checked={effects.reverbEnabled}
              onCheckedChange={(checked) => updateEffect('reverbEnabled', checked)}
              disabled={disabled}
            />
          </div>
          
          {effects.reverbEnabled && (
            <div className="space-y-2 pr-6">
              <Label className="text-sm text-muted-foreground">شدة الصدى</Label>
              <Slider
                value={[effects.reverbLevel]}
                onValueChange={([value]) => updateEffect('reverbLevel', value)}
                min={0}
                max={1}
                step={0.1}
                disabled={disabled}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>خفيف</span>
                <span>قوي</span>
              </div>
            </div>
          )}
        </div>

        {/* Echo - Free */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="echo" className="flex items-center gap-2 cursor-pointer">
              <Timer className="h-4 w-4 text-primary" />
              <span>تأثير الترديد</span>
            </Label>
            <Switch
              id="echo"
              checked={effects.echoEnabled}
              onCheckedChange={(checked) => updateEffect('echoEnabled', checked)}
              disabled={disabled}
            />
          </div>
          
          {effects.echoEnabled && (
            <div className="space-y-4 pr-6">
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">تأخير الترديد</Label>
                <Slider
                  value={[effects.echoDelay]}
                  onValueChange={([value]) => updateEffect('echoDelay', value)}
                  min={0.1}
                  max={0.8}
                  step={0.05}
                  disabled={disabled}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>قصير</span>
                  <span>{(effects.echoDelay * 1000).toFixed(0)}ms</span>
                  <span>طويل</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">تكرار الترديد</Label>
                <Slider
                  value={[effects.echoFeedback]}
                  onValueChange={([value]) => updateEffect('echoFeedback', value)}
                  min={0.1}
                  max={0.7}
                  step={0.05}
                  disabled={disabled}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>قليل</span>
                  <span>كثير</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {!isPremium && (
          <p className="text-xs text-muted-foreground text-center pt-2 flex items-center justify-center gap-1">
            <Lock className="h-3 w-3" />
            بعض المؤثرات متاحة للأعضاء المميزين فقط
          </p>
        )}
      </CardContent>
    </Card>
  );
}
