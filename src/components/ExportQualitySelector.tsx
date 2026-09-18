import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Settings2 } from 'lucide-react';
import { ExportQuality, QUALITY_PRESETS } from '@/hooks/useVideoRecorder';

interface ExportQualitySelectorProps {
  quality: ExportQuality;
  onChange: (quality: ExportQuality) => void;
}

export function ExportQualitySelector({ quality, onChange }: ExportQualitySelectorProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Settings2 className="h-5 w-5" />
          جودة التصدير
        </CardTitle>
      </CardHeader>
      <CardContent>
        <RadioGroup
          value={quality}
          onValueChange={(value) => onChange(value as ExportQuality)}
          className="grid grid-cols-2 gap-2"
        >
          {(Object.entries(QUALITY_PRESETS) as [ExportQuality, typeof QUALITY_PRESETS[ExportQuality]][]).map(([key, preset]) => (
            <div key={key} className="relative">
              <RadioGroupItem value={key} id={`quality-${key}`} className="peer sr-only" />
              <Label
                htmlFor={`quality-${key}`}
                className="flex flex-col items-center rounded-lg border-2 border-muted p-3 hover:bg-muted/50 peer-data-[state=checked]:border-primary cursor-pointer transition-all text-center"
              >
                <span className="font-medium text-sm">{preset.label}</span>
                <span className="text-xs text-muted-foreground">{preset.resolution}</span>
              </Label>
            </div>
          ))}
        </RadioGroup>
      </CardContent>
    </Card>
  );
}
