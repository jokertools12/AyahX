import { useState, useEffect, useRef, useCallback } from 'react';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Scissors, RotateCcw, Clock } from 'lucide-react';

interface AudioTrimControlProps {
  /** Total duration of the audio in seconds */
  totalDuration: number;
  /** Called when trim range changes — values in seconds */
  onTrimChange: (trimStart: number, trimEnd: number) => void;
  /** Whether trimming is active */
  trimEnabled: boolean;
  onTrimEnabledChange: (enabled: boolean) => void;
  disabled?: boolean;
}

export function formatTimeFull(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function parseTimeString(str: string): number | null {
  const parts = str.split(':');
  if (parts.length !== 2) return null;
  const m = parseInt(parts[0], 10);
  const s = parseInt(parts[1], 10);
  if (isNaN(m) || isNaN(s) || m < 0 || s < 0 || s >= 60) return null;
  return m * 60 + s;
}

export function AudioTrimControl({
  totalDuration,
  onTrimChange,
  trimEnabled,
  onTrimEnabledChange,
  disabled = false,
}: AudioTrimControlProps) {
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(totalDuration);
  const [startInput, setStartInput] = useState('00:00');
  const [endInput, setEndInput] = useState(formatTimeFull(totalDuration));

  const prevDurationRef = useRef(totalDuration);

  // Update trim range only when a new audio track totalDuration is loaded
  useEffect(() => {
    if (totalDuration > 0 && totalDuration !== prevDurationRef.current) {
      prevDurationRef.current = totalDuration;
      setTrimStart(0);
      setTrimEnd(totalDuration);
      setStartInput('00:00');
      setEndInput(formatTimeFull(totalDuration));
      onTrimChange(0, totalDuration);
    }
  }, [totalDuration, onTrimChange]);

  const handleSliderChange = useCallback((values: number[]) => {
    const [start, end] = values;
    setTrimStart(start);
    setTrimEnd(end);
    setStartInput(formatTimeFull(start));
    setEndInput(formatTimeFull(end));
    onTrimChange(start, end);
  }, [onTrimChange]);

  const handleStartInputBlur = useCallback(() => {
    const val = parseTimeString(startInput);
    if (val !== null && val >= 0 && val < trimEnd) {
      setTrimStart(val);
      onTrimChange(val, trimEnd);
    } else {
      setStartInput(formatTimeFull(trimStart));
    }
  }, [startInput, trimStart, trimEnd, onTrimChange]);

  const handleEndInputBlur = useCallback(() => {
    const val = parseTimeString(endInput);
    if (val !== null && val > trimStart && val <= totalDuration) {
      setTrimEnd(val);
      onTrimChange(trimStart, val);
    } else {
      setEndInput(formatTimeFull(trimEnd));
    }
  }, [endInput, trimStart, trimEnd, totalDuration, onTrimChange]);

  const handleReset = useCallback(() => {
    setTrimStart(0);
    setTrimEnd(totalDuration);
    setStartInput('00:00');
    setEndInput(formatTimeFull(totalDuration));
    onTrimChange(0, totalDuration);
  }, [totalDuration, onTrimChange]);

  const trimmedDuration = trimEnd - trimStart;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Scissors className="h-4 w-4" />
            قص المقطع
          </span>
          <Switch
            checked={trimEnabled}
            onCheckedChange={onTrimEnabledChange}
            disabled={disabled || totalDuration <= 0}
          />
        </CardTitle>
      </CardHeader>
      {trimEnabled && totalDuration > 0 && (
        <CardContent className="space-y-4 pt-0">
          {/* Dual-thumb range slider */}
          <div className="space-y-2">
            <Slider
              min={0}
              max={Math.floor(totalDuration)}
              step={1}
              value={[Math.floor(trimStart), Math.floor(trimEnd)]}
              onValueChange={handleSliderChange}
              disabled={disabled}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>00:00</span>
              <span>{formatTimeFull(totalDuration)}</span>
            </div>
          </div>

          {/* Time inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">البداية</Label>
              <Input
                value={startInput}
                onChange={(e) => setStartInput(e.target.value)}
                onBlur={handleStartInputBlur}
                onKeyDown={(e) => e.key === 'Enter' && handleStartInputBlur()}
                placeholder="00:00"
                className="text-center font-mono text-sm h-8"
                disabled={disabled}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">النهاية</Label>
              <Input
                value={endInput}
                onChange={(e) => setEndInput(e.target.value)}
                onBlur={handleEndInputBlur}
                onKeyDown={(e) => e.key === 'Enter' && handleEndInputBlur()}
                placeholder="00:00"
                className="text-center font-mono text-sm h-8"
                disabled={disabled}
              />
            </div>
          </div>

          {/* Duration info */}
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" />
              المدة بعد القص: {formatTimeFull(trimmedDuration)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="h-6 px-2 text-xs"
              disabled={disabled}
            >
              <RotateCcw className="h-3 w-3 ml-1" />
              إعادة تعيين
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
