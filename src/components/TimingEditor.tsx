import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Check, X, Clock } from 'lucide-react';
import { toast } from 'sonner';

interface TimingLine {
  text: string;
  start: number;
  end: number;
}

interface TimingEditorProps {
  lines: TimingLine[];
  onSave: (lines: TimingLine[]) => void;
  onCancel: () => void;
}

function formatSec(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${sec.padStart(4, '0')}`;
}

function parseSec(v: string): number | null {
  // Accept formats: "1:23.4", "83.4", "83"
  const parts = v.split(':');
  if (parts.length === 2) {
    const mins = parseInt(parts[0]);
    const secs = parseFloat(parts[1]);
    if (!isNaN(mins) && !isNaN(secs)) return mins * 60 + secs;
  }
  const num = parseFloat(v);
  return isNaN(num) ? null : num;
}

export function TimingEditor({ lines, onSave, onCancel }: TimingEditorProps) {
  const [editedLines, setEditedLines] = useState<TimingLine[]>(
    lines.map((l) => ({ ...l }))
  );

  const updateLine = (index: number, field: 'start' | 'end', value: string) => {
    const parsed = parseSec(value);
    if (parsed === null) return;
    setEditedLines((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: Math.max(0, parsed) };
      return copy;
    });
  };

  const handleSave = () => {
    // Validate: each line's end > start, and lines are ordered
    for (let i = 0; i < editedLines.length; i++) {
      if (editedLines[i].end <= editedLines[i].start) {
        toast.error(`السطر ${i + 1}: وقت النهاية يجب أن يكون أكبر من البداية`);
        return;
      }
    }
    onSave(editedLines);
    toast.success('تم حفظ التوقيتات بنجاح');
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Clock className="h-4 w-4" />
          تعديل توقيت كل سطر
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3">
        <ScrollArea className="max-h-[300px]">
          <div className="space-y-2">
            {editedLines.map((line, i) => (
              <div
                key={i}
                className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 text-sm"
              >
                <span className="w-6 text-xs text-muted-foreground shrink-0 text-center">
                  {i + 1}
                </span>
                <p className="flex-1 truncate text-xs font-medium" dir="rtl" title={line.text}>
                  {line.text}
                </p>
                <Input
                  className="w-[70px] h-7 text-xs text-center p-1"
                  defaultValue={formatSec(line.start)}
                  onBlur={(e) => updateLine(i, 'start', e.target.value)}
                  dir="ltr"
                  title="وقت البداية (دقيقة:ثانية)"
                />
                <span className="text-muted-foreground text-xs">→</span>
                <Input
                  className="w-[70px] h-7 text-xs text-center p-1"
                  defaultValue={formatSec(line.end)}
                  onBlur={(e) => updateLine(i, 'end', e.target.value)}
                  dir="ltr"
                  title="وقت النهاية (دقيقة:ثانية)"
                />
              </div>
            ))}
          </div>
        </ScrollArea>
        <div className="flex gap-2 mt-3">
          <Button size="sm" className="flex-1 gap-1 h-8 text-xs" onClick={handleSave}>
            <Check className="h-3 w-3" />
            حفظ التوقيتات
          </Button>
          <Button size="sm" variant="ghost" className="gap-1 h-8 text-xs" onClick={onCancel}>
            <X className="h-3 w-3" />
            إلغاء
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
