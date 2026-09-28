import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, CheckCircle2, Clock, Loader2, Save, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { TimingMap, TimingWord } from '@/lib/timingMap';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

interface AlignmentReviewPanelProps {
  timingMap: TimingMap | null;
  isAuthenticated: boolean;
  reciterId: string;
  surahNumber: number;
  startAyah: number;
  endAyah: number;
  ayahs: Array<{ numberInSurah: number; text: string }>;
  audioUrl: string;
  /** Chapter-recitation id used by the server-side QF attestation path. */
  quranFoundationRecitationId?: number;
  onTimingMapChange: (map: TimingMap) => void;
}

interface EditableWord {
  identity: string;
  canonicalWordKey: string;
  token: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

function statusLabel(status?: TimingMap['validationStatus']): string {
  if (status === 'approved') return 'معتمد';
  if (status === 'rejected') return 'مرفوض';
  if (status === 'low_confidence') return 'ثقة منخفضة';
  return 'بحاجة إلى مراجعة';
}

function statusClass(status?: TimingMap['validationStatus']): string {
  if (status === 'approved') return 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10';
  if (status === 'rejected') return 'border-destructive/40 text-destructive bg-destructive/10';
  return 'border-amber-500/40 text-amber-400 bg-amber-500/10';
}

function toEditableWord(word: TimingWord, index: number): EditableWord {
  return {
    identity: word.occurrenceId || `${word.canonicalWordKey}:${index + 1}`,
    canonicalWordKey: word.canonicalWordKey,
    token: word.displayToken,
    startMs: word.startMs,
    endMs: word.endMs,
    confidence: word.confidence,
  };
}

function toFiniteNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function AlignmentReviewPanel({
  timingMap,
  isAuthenticated,
  reciterId,
  surahNumber,
  startAyah,
  endAyah,
  ayahs,
  audioUrl,
  quranFoundationRecitationId,
  onTimingMapChange,
}: AlignmentReviewPanelProps) {
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [providerLabel, setProviderLabel] = useState<string>('');
  const [words, setWords] = useState<EditableWord[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'save' | 'approve' | null>(null);

  useEffect(() => {
    setWords((timingMap?.words || []).map(toEditableWord));
    setDocumentId(timingMap?.mapId?.startsWith('aln-') ? timingMap.mapId : null);
  }, [timingMap?.mapId]);

  useEffect(() => {
    let cancelled = false;
    if (!isAuthenticated) return undefined;
    api.alignments.getProviders().then((result) => {
      if (cancelled) return;
      const selected = result.providers.find((provider) => provider.id === timingMap?.alignment?.provider);
      setProviderLabel(selected?.label || timingMap?.alignment?.provider || 'غير محدد');
    }).catch(() => {
      if (!cancelled) setProviderLabel(timingMap?.alignment?.provider || 'غير محدد');
    });
    return () => { cancelled = true; };
  }, [isAuthenticated, timingMap?.alignment?.provider]);

  const changedRevisions = useMemo(() => {
    if (!timingMap) return [];
    return words.filter((word, index) => {
      const original = timingMap.words[index];
      return original && (original.startMs !== word.startMs || original.endMs !== word.endMs || original.confidence !== word.confidence);
    }).map((word) => ({
      occurrenceId: word.identity,
      canonicalWordKey: word.canonicalWordKey,
      startMs: word.startMs,
      endMs: word.endMs,
      confidence: word.confidence,
    }));
  }, [timingMap, words]);

  if (!timingMap) return null;

  const createReviewDocument = async () => {
    if (!isAuthenticated) {
      toast.error('سجّل الدخول لحفظ وثيقة المحاذاة ومراجعتها');
      return;
    }
    const useQuranFoundationAttestation = timingMap.alignment?.provider === 'quran_foundation'
      && Number.isInteger(quranFoundationRecitationId)
      && (quranFoundationRecitationId || 0) > 0;
    if (!useQuranFoundationAttestation && (!audioUrl || audioUrl.startsWith('blob:'))) {
      toast.error('لا يمكن توثيق خريطة بلا أصل صوتي ثابت؛ استخدم رابطاً أو asset ID ثابتاً');
      return;
    }
    setBusy('save');
    try {
      const result = await api.alignments.create({
        providerId: useQuranFoundationAttestation ? 'quran_foundation' : 'manual',
        reciterId,
        granularity: timingMap.alignment?.requestedGranularity || 'word',
        ...(useQuranFoundationAttestation ? {} : {
          audio: {
            contentHash: timingMap.audioContentHash,
            durationMs: timingMap.decodedDurationMs || 1,
            sampleRate: timingMap.sampleRate,
            channels: timingMap.channels,
            sourceUrlOrAssetId: audioUrl,
          },
        }),
        reference: {
          surahNumber,
          startAyah,
          endAyah,
          ayahs,
          quranTextVersion: timingMap.quranTextVersion,
          riwayah: timingMap.alignment?.riwayah,
        },
        providerInput: useQuranFoundationAttestation
          ? { recitationId: quranFoundationRecitationId }
          : {
            words: timingMap.words.map((word) => ({
              canonicalWordKey: word.canonicalWordKey,
              displayToken: word.displayToken,
              normalizedAlignmentToken: word.normalizedAlignmentToken,
              startMs: word.startMs,
              endMs: word.endMs,
              confidence: word.confidence,
              flags: word.flags,
            })),
          },
      });
      setDocumentId(result.document.documentId);
      onTimingMapChange(result.timingMap as TimingMap);
      toast.success('تم حفظ نسخة محاذاة للمراجعة البشرية');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ وثيقة المحاذاة');
    } finally {
      setBusy(null);
    }
  };

  const approveReview = async () => {
    if (!documentId) {
      toast.error('احفظ نسخة للمراجعة أولاً');
      return;
    }
    setBusy('approve');
    try {
      const result = await api.alignments.review(documentId, {
        status: 'approved',
        note: note.trim() || undefined,
        revisions: changedRevisions,
      });
      setDocumentId(result.document.documentId);
      onTimingMapChange(result.timingMap as TimingMap);
      setNote('');
      toast.success('تم اعتماد المحاذاة كنسخة جديدة مرتبطة بالصوت');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر اعتماد المحاذاة');
    } finally {
      setBusy(null);
    }
  };

  const updateWord = (index: number, field: 'startMs' | 'endMs' | 'confidence', value: string) => {
    setWords((current) => current.map((word, wordIndex) => wordIndex === index
      ? { ...word, [field]: toFiniteNumber(value, word[field]) }
      : word));
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          عقد المحاذاة والمراجعة البشرية
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" className={`gap-1 ${statusClass(timingMap.validationStatus)}`}>
            {timingMap.validationStatus === 'approved' ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
            {statusLabel(timingMap.validationStatus)}
          </Badge>
          <Badge variant="outline" className="gap-1">
            <Clock className="h-3 w-3" /> {timingMap.words.length} كلمة
          </Badge>
          {providerLabel && <span className="text-muted-foreground">المزوّد: {providerLabel}</span>}
        </div>

        {!isAuthenticated && (
          <p className="text-xs text-muted-foreground">المراجعة تحفظ نسخة مرتبطة ببصمة الصوت؛ يلزم تسجيل الدخول.</p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={createReviewDocument} disabled={busy !== null || timingMap.words.length === 0}>
            {busy === 'save' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            حفظ نسخة للمراجعة
          </Button>
          <Button size="sm" className="h-8 text-xs gap-1" onClick={approveReview} disabled={busy !== null || !documentId}>
            {busy === 'approve' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            اعتماد بعد التحقق
          </Button>
        </div>

        {documentId && (
          <p className="text-[11px] text-muted-foreground break-all">معرّف النسخة: {documentId}</p>
        )}

        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="ملاحظة المراجع (اختياري)"
          className="h-8 text-xs"
          maxLength={2000}
        />

        {words.length > 0 && timingMap.validationStatus !== 'approved' && (
          <ScrollArea className="max-h-[260px] pr-2">
            <div className="space-y-1.5">
              {words.map((word, index) => (
                <div key={word.identity} className="grid grid-cols-[1fr_72px_72px] items-center gap-1.5 rounded-md bg-muted/40 p-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-xs" dir="rtl" title={word.token}>{index + 1}. {word.token}</p>
                    <p className="truncate text-[10px] text-muted-foreground">{word.canonicalWordKey}</p>
                  </div>
                  <Input aria-label={`بداية ${word.token}`} className="h-7 px-1 text-center text-[10px]" type="number" min={0} step={1} value={word.startMs} onChange={(event) => updateWord(index, 'startMs', event.target.value)} />
                  <Input aria-label={`نهاية ${word.token}`} className="h-7 px-1 text-center text-[10px]" type="number" min={0} step={1} value={word.endMs} onChange={(event) => updateWord(index, 'endMs', event.target.value)} />
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
