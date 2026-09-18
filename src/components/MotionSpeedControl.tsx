import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PremiumBadge } from '@/components/PremiumBadge';
import { useSubscription } from '@/hooks/useSubscription';
import { Gauge, Zap, Snail, Lock } from 'lucide-react';
import { toast } from 'sonner';

interface MotionSpeedControlProps {
  speed: number;
  onChange: (speed: number) => void;
}

export function MotionSpeedControl({ speed, onChange }: MotionSpeedControlProps) {
  const { canUseFeature } = useSubscription();
  const locked = !canUseFeature('animatedBackgrounds');

  const handleChange = (value: number) => {
    if (locked) {
      toast.error('التحكم في سرعة الخلفية متاح للأعضاء المميزين فقط');
      return;
    }
    onChange(value);
  };

  return (
    <Card className={locked ? 'opacity-70' : ''}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Gauge className="h-5 w-5" />
          سرعة الخلفية
          {locked && <Lock className="h-4 w-4 text-muted-foreground" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {locked ? (
          <div className="text-center py-4 space-y-3">
            <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">التحكم في السرعة متاح للأعضاء المميزين</p>
            <PremiumBadge showLock />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <Snail className="h-5 w-5 text-muted-foreground" />
              <span className="text-2xl font-bold text-primary">x{speed}</span>
              <Zap className="h-5 w-5 text-muted-foreground" />
            </div>
            
            <Slider
              value={[speed]}
              onValueChange={([value]) => handleChange(value)}
              min={1}
              max={10}
              step={0.5}
              className="w-full"
            />
            
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>بطيء جداً</span>
              <span>متوسط</span>
              <span>سريع جداً</span>
            </div>

            <div className="grid grid-cols-5 gap-1 pt-2">
              {[1, 2, 3, 5, 10].map((preset) => (
                <button
                  key={preset}
                  onClick={() => handleChange(preset)}
                  className={`py-2 px-1 text-xs rounded-lg border transition-all ${
                    speed === preset
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-muted hover:border-primary/50 hover:bg-muted/50'
                  }`}
                >
                  x{preset}
                </button>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
