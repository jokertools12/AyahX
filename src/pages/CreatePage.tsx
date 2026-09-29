import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Layout } from '@/components/Layout';
import { SettingsSection } from '@/components/SettingsSection';
import { SurahCard } from '@/components/SurahCard';
import { ReciterCard } from '@/components/ReciterCard';
import { AyahDisplay } from '@/components/AyahDisplay';
import { BackgroundSelector } from '@/components/BackgroundSelector';
import { TextSettingsPanel, TextSettings } from '@/components/TextSettingsPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { surahs } from '@/data/surahs';
import { reciters, isAccreditedReciter, getReciterRiwayah, getAvailableRiwayahs, getAudioUrl } from '@/data/reciters';
import { BackgroundItem, getRandomBackground, slideshowBackgrounds, backgroundImages } from '@/data/backgrounds';
import { FamousAyah, famousAyahs, ayahCategories, getAyahsByCategory } from '@/data/famousAyahs';
import {
  performers,
  ibtahalatTracks,
  getTracksByPerformer,
  getTracksByCategory,
  getPerformerById,
  searchTracks,
  IbtahalTrack,
} from '@/data/ibtahalat';
import { useQuranApi } from '@/hooks/useQuranApi';
import { useSubscription } from '@/hooks/useSubscription';
import { isBasicBackground } from '../../shared/planEntitlements';
import {
  Monitor,
  Smartphone,
  Loader2,
  Play,
  Pause,
  ChevronRight,
  ChevronLeft,
  BookOpen,
  Search,
  Settings,
  Sparkles,
  Bookmark,
  Music,
  Mic,
  Filter,
  User,
  RotateCcw,
  History,
  X,
  Plus,
  Minus,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/ErrorState';
import { normalizeArabicText } from '@/lib/utils';

type AspectRatio = '9:16' | '16:9';
type ContentMode = 'surah' | 'famous' | 'ibtahalat';

const defaultTextSettings: TextSettings = {
  fontSize: 28,
  fontFamily: '"Amiri", serif',
  textColor: '#ffffff',
  shadowIntensity: 0.5,
  overlayOpacity: 0.4,
};

export default function CreatePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { fetchAyahs, loading: apiLoading, error: quranApiError } = useQuranApi();
  const { loading: subscriptionLoading, isPremium, isFreeFont } = useSubscription();

  // Determine initial tab from URL
  const initialTab = searchParams.get('tab') || 'surahs';
  const preSelectedSurah = searchParams.get('surah')
    ? parseInt(searchParams.get('surah')!)
    : null;

  const [currentStep, setCurrentStep] = useState(preSelectedSurah ? 2 : 1);
  const [contentMode, setContentMode] = useState<ContentMode>(
    preSelectedSurah ? 'surah' : 'surah'
  );
  const [activeContentTab, setActiveContentTab] = useState<string>(
    initialTab === 'ibtahalat' ? 'ibtahalat' : 'surahs'
  );

  // ── Shared state ──
  const [selectedBackground, setSelectedBackground] = useState<BackgroundItem | null>(
    () => backgroundImages[0] || slideshowBackgrounds[0] || getRandomBackground('animated')
  );
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [textSettings, setTextSettings] = useState<TextSettings>(defaultTextSettings);

  // A draft, URL, or cached selection must not carry paid assets through the
  // create flow after a user is on the free plan.
  useEffect(() => {
    if (subscriptionLoading || isPremium) return;
    setSelectedBackground((previous) => previous && isBasicBackground(previous.category, previous.type)
      ? previous
      : backgroundImages[0]);
    setTextSettings((previous) => isFreeFont(previous.fontFamily)
      ? previous
      : { ...previous, fontFamily: '"Noto Naskh Arabic", serif' });
  }, [subscriptionLoading, isPremium, isFreeFont]);

  // ── Surah / Quran state ──
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSurah, setSelectedSurah] = useState<number | null>(preSelectedSurah);
  const [selectedReciter, setSelectedReciter] = useState<string | null>(null);
  const [startAyah, setStartAyah] = useState(1);
  const [endAyah, setEndAyah] = useState(5);
  const [startAyahInput, setStartAyahInput] = useState('1');
  const [endAyahInput, setEndAyahInput] = useState('5');
  const [reciterSearch, setReciterSearch] = useState('');
  const [reciterAccreditationFilter, setReciterAccreditationFilter] = useState<'all' | 'accredited' | 'standard'>('all');
  const [reciterRiwayahFilter, setReciterRiwayahFilter] = useState<string>('all');
  const [reciterStyleFilter, setReciterStyleFilter] = useState<string>('all');

  // ── Ibtahalat state ──
  const [ibtSearchQuery, setIbtSearchQuery] = useState('');
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  const [selectedPerformer, setSelectedPerformer] = useState<string | null>(null);
  const [ibtBrowseMode, setIbtBrowseMode] = useState<'byCategory' | 'byPerformer' | 'search'>('byCategory');
  const [ibtCategory, setIbtCategory] = useState('all');
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ── Ayah preview data ──
  const [ayahs, setAyahs] = useState<{ number: number; numberInSurah: number; text: string }[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewAyahIndex, setPreviewAyahIndex] = useState(0);

  const selectedSurahData = surahs.find((s) => s.number === selectedSurah);
  const selectedReciterData = reciters.find((r) => r.id === selectedReciter);
  const selectedTrackData = ibtahalatTracks.find((t) => t.id === selectedTrack);

  // ── Recent reciters quick-chips state ──
  const [recentReciters, setRecentReciters] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('recent_reciter_ids');
      return saved ? JSON.parse(saved) : ['mishary_alafasy', 'abdul_basit_murattal', 'al_husary', 'al_dosari', 'al_muaiqly'];
    } catch {
      return ['mishary_alafasy', 'abdul_basit_murattal', 'al_husary', 'al_dosari', 'al_muaiqly'];
    }
  });

  const saveRecentReciter = useCallback((id: string) => {
    setRecentReciters(prev => {
      const updated = [id, ...prev.filter(r => r !== id)].slice(0, 6);
      try {
        localStorage.setItem('recent_reciter_ids', JSON.stringify(updated));
      } catch {
        // Recent-reciter convenience data is optional (storage can be disabled).
      }
      return updated;
    });
  }, []);

  // ── Draft auto-save and recovery state ──
  const [draftAvailable, setDraftAvailable] = useState<{
    surahNumber: number;
    surahName: string;
    reciterId: string;
    reciterName: string;
    startAyah: number;
    endAyah: number;
  } | null>(null);

  useEffect(() => {
    if (!preSelectedSurah && !initialTab) {
      try {
        const raw = localStorage.getItem('ayah_clip_maker_draft');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.surah && parsed.reciter) {
            const sData = surahs.find(s => s.number === parsed.surah);
            const rData = reciters.find(r => r.id === parsed.reciter);
            if (sData) {
              setDraftAvailable({
                surahNumber: parsed.surah,
                surahName: sData.name,
                reciterId: parsed.reciter,
                reciterName: rData?.name || '',
                startAyah: parsed.start || 1,
                endAyah: parsed.end || 5,
              });
            }
          }
        }
      } catch {
        // A malformed or unavailable local draft must never block new work.
      }
    }
  }, [preSelectedSurah, initialTab]);

  useEffect(() => {
    if (selectedSurah && selectedReciter && contentMode === 'surah') {
      try {
        localStorage.setItem('ayah_clip_maker_draft', JSON.stringify({
          surah: selectedSurah,
          reciter: selectedReciter,
          start: startAyah,
          end: endAyah,
          backgroundId: selectedBackground?.id,
          ratio: aspectRatio,
          updatedAt: Date.now(),
        }));
      } catch {
        // Draft persistence is a convenience only; creation remains usable.
      }
    }
  }, [selectedSurah, selectedReciter, startAyah, endAyah, selectedBackground, aspectRatio, contentMode]);

  const handleRestoreDraft = () => {
    if (!draftAvailable) return;
    setSelectedSurah(draftAvailable.surahNumber);
    setSelectedReciter(draftAvailable.reciterId);
    setStartAyah(draftAvailable.startAyah);
    setEndAyah(draftAvailable.endAyah);
    setStartAyahInput(draftAvailable.startAyah.toString());
    setEndAyahInput(draftAvailable.endAyah.toString());
    setCurrentStep(3);
    toast.success('تمت استعادة مسودة العمل بنجاح');
    setDraftAvailable(null);
  };

  const handleDismissDraft = () => {
    try {
      localStorage.removeItem('ayah_clip_maker_draft');
    } catch {
      // Clearing an unavailable local draft is already the desired outcome.
    }
    setDraftAvailable(null);
  };

  const filteredSurahs = surahs.filter((surah) => {
    const q = normalizeArabicText(searchQuery);
    if (!q) return true;
    return (
      normalizeArabicText(surah.name).includes(q) ||
      surah.englishName.toLowerCase().includes(q) ||
      surah.number.toString().includes(searchQuery.trim())
    );
  });

  const availableRiwayahs = useMemo(() => getAvailableRiwayahs(), []);
  const availableStyles = useMemo(() => [
    { id: 'all', label: 'الكل' },
    { id: 'مرتل', label: 'مرتل' },
    { id: 'مجود', label: 'مجود' },
    { id: 'ترتيل', label: 'ترتيل' },
    { id: 'معلم', label: 'المعلم' },
  ], []);

  const countAccredited = useMemo(() => reciters.filter(r => isAccreditedReciter(r)).length, []);
  const countStandard = useMemo(() => reciters.filter(r => !isAccreditedReciter(r)).length, []);

  const filteredReciters = useMemo(() => {
    const q = normalizeArabicText(reciterSearch);
    return reciters.filter((r) => {
      // 1. Search Query
      if (q) {
        const rNameNorm = normalizeArabicText(r.name);
        const rDescNorm = r.description ? normalizeArabicText(r.description) : '';
        const rRiwayahNorm = normalizeArabicText(getReciterRiwayah(r));
        const rStyleNorm = normalizeArabicText(r.style);
        const match =
          rNameNorm.includes(q) ||
          rNameNorm.replace(/\s+/g, '').includes(q.replace(/\s+/g, '')) ||
          r.englishName.toLowerCase().includes(q) ||
          rDescNorm.includes(q) ||
          rRiwayahNorm.includes(q) ||
          rStyleNorm.includes(q);
        if (!match) return false;
      }

      // 2. Accreditation Filter
      if (reciterAccreditationFilter === 'accredited' && !isAccreditedReciter(r)) return false;
      if (reciterAccreditationFilter === 'standard' && isAccreditedReciter(r)) return false;

      // 3. Riwayah Filter
      if (reciterRiwayahFilter !== 'all') {
        const riw = getReciterRiwayah(r);
        if (riw !== reciterRiwayahFilter) return false;
      }

      // 4. Style Filter
      if (reciterStyleFilter !== 'all') {
        if (r.style !== reciterStyleFilter) return false;
      }

      return true;
    });
  }, [reciterSearch, reciterAccreditationFilter, reciterRiwayahFilter, reciterStyleFilter]);

  const hasActiveReciterFilters = Boolean(
    reciterSearch.trim() ||
    reciterAccreditationFilter !== 'all' ||
    reciterRiwayahFilter !== 'all' ||
    reciterStyleFilter !== 'all'
  );

  const resetReciterFilters = useCallback(() => {
    setReciterSearch('');
    setReciterAccreditationFilter('all');
    setReciterRiwayahFilter('all');
    setReciterStyleFilter('all');
  }, []);

  // Ibtahalat filtering
  const getFilteredTracks = (): IbtahalTrack[] => {
    if (ibtBrowseMode === 'search' && ibtSearchQuery.trim()) {
      return searchTracks(ibtSearchQuery);
    }
    if (ibtBrowseMode === 'byPerformer' && selectedPerformer) {
      return getTracksByPerformer(selectedPerformer);
    }
    if (ibtBrowseMode === 'byCategory') {
      return ibtCategory === 'all' ? ibtahalatTracks : getTracksByCategory(ibtCategory as IbtahalTrack['category']);
    }
    return ibtahalatTracks;
  };
  const filteredTracks = getFilteredTracks();

  const ibtCategories = [
    { value: 'all', label: 'الكل', count: ibtahalatTracks.length },
    { value: 'ابتهال', label: 'ابتهال', count: getTracksByCategory('ابتهال').length },
    { value: 'توشيح', label: 'توشيح', count: getTracksByCategory('توشيح').length },
    { value: 'مديح', label: 'مديح', count: getTracksByCategory('مديح').length },
    { value: 'دعاء', label: 'دعاء', count: getTracksByCategory('دعاء').length },
  ];

  useEffect(() => {
    if (selectedSurah && startAyah && endAyah && contentMode !== 'ibtahalat') {
      loadAyahs();
    }
  }, [selectedSurah, startAyah, endAyah, contentMode]);

  useEffect(() => {
    if (currentStep === getMaxStep() && ayahs.length > 0) {
      const interval = setInterval(() => {
        setPreviewAyahIndex((prev) => (prev + 1) % ayahs.length);
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [currentStep, ayahs.length]);

  const loadAyahs = async () => {
    if (!selectedSurah) return;
    setPreviewLoading(true);
    const data = await fetchAyahs(selectedSurah, startAyah, endAyah);
    if (data) setAyahs(data);
    setPreviewLoading(false);
  };

  const handlePlayPreview = useCallback((track: IbtahalTrack) => {
    if (playingTrackId === track.id) {
      audioRef.current?.pause();
      setPlayingTrackId(null);
      return;
    }
    if (audioRef.current) audioRef.current.pause();
    const audio = new Audio(track.audioUrl);
    audio.play().catch(() => toast.error('تعذر تشغيل الصوت'));
    audio.onended = () => setPlayingTrackId(null);
    audioRef.current = audio;
    setPlayingTrackId(track.id);
  }, [playingTrackId]);

  const [isPlayingAyahAudio, setIsPlayingAyahAudio] = useState(false);

  const handlePlayAyahAudio = useCallback(() => {
    if (isPlayingAyahAudio) {
      audioRef.current?.pause();
      setIsPlayingAyahAudio(false);
      return;
    }
    if (!selectedReciterData || !selectedSurah) {
      toast.error('الرجاء اختيار القارئ والسورة أولاً');
      return;
    }
    if (audioRef.current) audioRef.current.pause();

    let audioUrl = '';
    if (selectedReciterData.everyAyahSubfolder) {
      const pSurah = selectedSurah.toString().padStart(3, '0');
      const pAyah = startAyah.toString().padStart(3, '0');
      audioUrl = `https://everyayah.com/data/${selectedReciterData.everyAyahSubfolder}/${pSurah}${pAyah}.mp3`;
    } else {
      audioUrl = getAudioUrl(selectedReciterData, selectedSurah);
    }

    const audio = new Audio(audioUrl);
    audio.play().catch(() => toast.error('تعذر تشغيل الصوت'));
    audio.onended = () => setIsPlayingAyahAudio(false);
    audioRef.current = audio;
    setIsPlayingAyahAudio(true);
  }, [isPlayingAyahAudio, selectedReciterData, selectedSurah, startAyah]);

  // Dynamic steps based on content mode
  const getStepLabels = (): string[] => {
    if (contentMode === 'ibtahalat') {
      return ['اختر المحتوى', 'اختر الخلفية', 'المعاينة'];
    }
    return ['اختر المحتوى', 'اختر القارئ', 'حدد الآيات', 'اختر الخلفية', 'المعاينة'];
  };
  const getMaxStep = () => getStepLabels().length;
  const stepLabels = getStepLabels();

  const handleNextStep = () => {
    if (currentStep === 1) {
      if (contentMode === 'ibtahalat' && !selectedTrack) {
        toast.error('الرجاء اختيار ابتهال');
        return;
      }
      if ((contentMode === 'surah' || contentMode === 'famous') && !selectedSurah) {
        toast.error('الرجاء اختيار سورة');
        return;
      }
    }
    if (contentMode !== 'ibtahalat') {
      if (currentStep === 2 && !selectedReciter) {
        toast.error('الرجاء اختيار قارئ');
        return;
      }
      if (currentStep === 4 && !selectedBackground) {
        toast.error('الرجاء اختيار خلفية');
        return;
      }
    } else {
      if (currentStep === 2 && !selectedBackground) {
        toast.error('الرجاء اختيار خلفية');
        return;
      }
    }
    setCurrentStep((prev) => Math.min(prev + 1, getMaxStep()));
  };

  const handlePrevStep = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const handleCreateVideo = () => {
    if (!isPremium && selectedBackground && !isBasicBackground(selectedBackground.category, selectedBackground.type)) {
      toast.error('الخطة المجانية تدعم الخلفيات الإسلامية والطبيعية الثابتة فقط.');
      return;
    }
    if (contentMode === 'ibtahalat') {
      if (!selectedTrack || !selectedBackground) {
        toast.error('الرجاء إكمال جميع الخطوات');
        return;
      }
      const track = ibtahalatTracks.find(t => t.id === selectedTrack)!;
      const performer = performers.find(p => p.id === track.performerId)!;
      const params = new URLSearchParams({
        mode: 'ibtahalat',
        trackId: track.id,
        trackTitle: track.title,
        performerName: performer.name,
        audioUrl: track.audioUrl,
        background: selectedBackground.id,
        backgroundType: selectedBackground.type,
        backgroundUrl: selectedBackground.url,
        backgroundThumb: selectedBackground.thumbnail,
        ratio: aspectRatio,
      });
      navigate(`/preview?${params.toString()}`);
      return;
    }

    if (!selectedSurah || !selectedReciter || !selectedBackground) {
      toast.error('الرجاء إكمال جميع الخطوات');
      return;
    }

    const params = new URLSearchParams({
      surah: selectedSurah.toString(),
      reciter: selectedReciter,
      start: startAyah.toString(),
      end: endAyah.toString(),
      background: selectedBackground.id,
      backgroundType: selectedBackground.type,
      backgroundUrl: selectedBackground.url,
      backgroundThumb: selectedBackground.thumbnail,
      ratio: aspectRatio,
      fontSize: textSettings.fontSize.toString(),
      fontFamily: textSettings.fontFamily,
      textColor: textSettings.textColor,
      shadowIntensity: textSettings.shadowIntensity.toString(),
      overlayOpacity: textSettings.overlayOpacity.toString(),
    });
    navigate(`/preview?${params.toString()}`);
  };

  // Quran step mapping (for non-ibtahalat): 1=content, 2=reciter, 3=ayahs, 4=bg, 5=preview
  // Ibtahalat step mapping: 1=content, 2=bg, 3=preview

  const isOnLastStep = currentStep === getMaxStep();

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 text-center"
        >
          <h1 className="text-3xl md:text-4xl font-bold mb-2 flex items-center justify-center gap-3">
            <Sparkles className="h-8 w-8 text-primary" />
            إنشاء فيديو جديد
          </h1>
          <p className="text-muted-foreground">
            اختر المحتوى واتبع الخطوات لإنشاء مقطع احترافي
          </p>
        </motion.div>

        {/* Draft Recovery Banner */}
        {draftAvailable && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-2xl mx-auto mb-6 p-4 rounded-xl border border-primary/40 bg-primary/10 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-md"
          >
            <div className="flex items-center gap-3 text-center sm:text-right">
              <History className="h-6 w-6 text-primary shrink-0" />
              <div>
                <p className="font-bold text-sm text-foreground">
                  لديك مسودة عمل سابقة غير مكتملة
                </p>
                <p className="text-xs text-muted-foreground">
                  {draftAvailable.surahName} • {draftAvailable.reciterName} (الآيات {draftAvailable.startAyah} إلى {draftAvailable.endAyah})
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" onClick={handleRestoreDraft} className="gap-1.5 gradient-primary">
                <RotateCcw className="h-3.5 w-3.5" />
                متابعة العمل
              </Button>
              <Button size="sm" variant="ghost" onClick={handleDismissDraft} className="text-muted-foreground hover:text-destructive">
                <X className="h-4 w-4" />
                مسح
              </Button>
            </div>
          </motion.div>
        )}

        {/* Progress Steps */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex items-center justify-center gap-1 md:gap-2 mb-4 overflow-x-auto pb-2"
        >
          {stepLabels.map((_, idx) => {
            const step = idx + 1;
            return (
              <div key={step} className="flex items-center">
                <div
                  className={`flex h-9 w-9 md:h-10 md:w-10 items-center justify-center rounded-full font-bold transition-all text-sm ${
                    currentStep === step
                      ? 'gradient-primary text-primary-foreground'
                      : currentStep > step
                      ? 'bg-primary/20 text-primary'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {step}
                </div>
                {step < stepLabels.length && (
                  <div
                    className={`w-3 sm:w-6 md:w-12 h-1 rounded ${
                      currentStep > step ? 'bg-primary' : 'bg-muted'
                    }`}
                  />
                )}
              </div>
            );
          })}
        </motion.div>

        {/* Step Labels */}
        <div className="hidden md:flex justify-center gap-6 mb-8">
          {stepLabels.map((label, index) => (
            <span
              key={index}
              className={`text-sm transition-colors ${
                currentStep === index + 1 ? 'text-primary font-medium' : 'text-muted-foreground'
              }`}
            >
              {label}
            </span>
          ))}
        </div>
        <div className="md:hidden text-center mb-6">
          <span className="text-primary font-medium">{stepLabels[currentStep - 1]}</span>
        </div>

        {/* Step Content */}
        <motion.div
          key={`${contentMode}-${currentStep}`}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="mb-8"
        >
          {/* ═══════ Step 1: Choose Content ═══════ */}
          {currentStep === 1 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5" />
                  اختر المحتوى
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <Tabs
                  value={activeContentTab}
                  onValueChange={(v) => {
                    setActiveContentTab(v);
                    if (v === 'ibtahalat') setContentMode('ibtahalat');
                    else if (v === 'famous') setContentMode('famous');
                    else setContentMode('surah');
                  }}
                  className="w-full"
                >
                  <TabsList className="w-full grid grid-cols-3 mb-4">
                    <TabsTrigger value="surahs" className="gap-1 text-xs sm:text-sm">
                      <BookOpen className="h-4 w-4" />
                      <span className="hidden sm:inline">السور</span>
                      <span className="sm:hidden">السور</span>
                    </TabsTrigger>
                    <TabsTrigger value="famous" className="gap-1 text-xs sm:text-sm">
                      <Bookmark className="h-4 w-4" />
                      <span className="hidden sm:inline">آيات مشهورة</span>
                      <span className="sm:hidden">مشهورة</span>
                    </TabsTrigger>
                    <TabsTrigger value="ibtahalat" className="gap-1 text-xs sm:text-sm">
                      <Music className="h-4 w-4" />
                      <span className="hidden sm:inline">تواشيح وابتهالات</span>
                      <span className="sm:hidden">ابتهالات</span>
                    </TabsTrigger>
                  </TabsList>

                  {/* ── Surahs Tab ── */}
                  <TabsContent value="surahs">
                    <div className="relative mb-4">
                      <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <Input
                        placeholder="ابحث عن سورة..."
                        aria-label="ابحث عن سورة بالاسم أو الرقم"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pr-10"
                      />
                    </div>
                    <ScrollArea className="h-[50vh]">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-1">
                        {filteredSurahs.map((surah) => (
                          <SurahCard
                            key={surah.number}
                            {...surah}
                            isSelected={selectedSurah === surah.number}
                            onClick={() => {
                              setSelectedSurah(surah.number);
                              setContentMode('surah');
                              setStartAyah(1);
                              const defaultEnd = Math.min(5, surah.numberOfAyahs);
                              setEndAyah(defaultEnd);
                              setStartAyahInput('1');
                              setEndAyahInput(defaultEnd.toString());
                            }}
                          />
                        ))}
                      </div>
                    </ScrollArea>
                  </TabsContent>

                  {/* ── Famous Ayahs Tab ── */}
                  <TabsContent value="famous">
                    <FamousAyahsGrid
                      onSelect={(ayah) => {
                        setContentMode('famous');
                        setSelectedSurah(ayah.surahNumber);
                        setStartAyah(ayah.startAyah);
                        setEndAyah(ayah.endAyah);
                        setStartAyahInput(ayah.startAyah.toString());
                        setEndAyahInput(ayah.endAyah.toString());
                        // Skip to reciter step
                        setCurrentStep(2);
                      }}
                    />
                  </TabsContent>

                  {/* ── Ibtahalat Tab ── */}
                  <TabsContent value="ibtahalat">
                    {/* Browse mode buttons */}
                    <div className="flex gap-2 mb-4 flex-wrap">
                      <Button
                        variant={ibtBrowseMode === 'byCategory' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setIbtBrowseMode('byCategory')}
                        className="gap-1"
                      >
                        <Filter className="h-4 w-4" />
                        حسب التصنيف
                      </Button>
                      <Button
                        variant={ibtBrowseMode === 'byPerformer' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setIbtBrowseMode('byPerformer')}
                        className="gap-1"
                      >
                        <User className="h-4 w-4" />
                        حسب المبتهل
                      </Button>
                      <Button
                        variant={ibtBrowseMode === 'search' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setIbtBrowseMode('search')}
                        className="gap-1"
                      >
                        <Search className="h-4 w-4" />
                        بحث
                      </Button>
                    </div>

                    {ibtBrowseMode === 'search' && (
                      <div className="relative mb-4">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <Input
                          placeholder="ابحث في الابتهالات والتواشيح..."
                          aria-label="ابحث في الابتهالات والتواشيح"
                          value={ibtSearchQuery}
                          onChange={(e) => setIbtSearchQuery(e.target.value)}
                          className="pr-10"
                          autoFocus
                        />
                      </div>
                    )}

                    {ibtBrowseMode === 'byCategory' && (
                      <div className="flex gap-2 mb-4 flex-wrap">
                        {ibtCategories.map(cat => (
                          <Button
                            key={cat.value}
                            variant={ibtCategory === cat.value ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setIbtCategory(cat.value)}
                          >
                            {cat.label}
                            <Badge variant="secondary" className="mr-1 text-xs">{cat.count}</Badge>
                          </Button>
                        ))}
                      </div>
                    )}

                    {ibtBrowseMode === 'byPerformer' && (
                      <div className="flex gap-2 flex-wrap mb-4">
                        {performers.map(p => (
                          <Button
                            key={p.id}
                            variant={selectedPerformer === p.id ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setSelectedPerformer(p.id)}
                            className="gap-1"
                          >
                            <Mic className="h-3 w-3" />
                            {p.name}
                            <Badge variant="secondary" className="mr-1 text-xs">
                              {getTracksByPerformer(p.id).length}
                            </Badge>
                          </Button>
                        ))}
                      </div>
                    )}

                    <ScrollArea className="h-[50vh]">
                      <div className="space-y-2 p-1">
                        {filteredTracks.length === 0 ? (
                          <p className="text-center text-muted-foreground py-8">لا توجد نتائج</p>
                        ) : (
                          filteredTracks.map(track => {
                            const performer = getPerformerById(track.performerId);
                            const isSelected = selectedTrack === track.id;
                            const isPlaying = playingTrackId === track.id;
                            return (
                              <motion.div
                                key={track.id}
                                whileHover={{ scale: 1.01 }}
                                whileTap={{ scale: 0.99 }}
                                onClick={() => {
                                  setSelectedTrack(track.id);
                                  setContentMode('ibtahalat');
                                }}
                                className={`cursor-pointer rounded-xl border-2 p-3 transition-all ${
                                  isSelected ? 'border-primary bg-primary/5' : 'border-transparent hover:border-primary/30 bg-muted/50'
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    aria-label={isPlaying ? `إيقاف مؤقت لـ ${track.title}` : `تشغيل معاينة ${track.title}`}
                                    className="shrink-0 h-9 w-9 rounded-full bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedTrack(track.id);
                                      setContentMode('ibtahalat');
                                      handlePlayPreview(track);
                                    }}
                                  >
                                    {isPlaying ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
                                  </Button>
                                  <div className="flex-1 min-w-0">
                                    <p className="font-bold text-sm truncate">{track.title}</p>
                                    <p className="text-xs text-muted-foreground truncate">
                                      {performer?.name} • {track.duration}
                                    </p>
                                  </div>
                                  <Badge variant="secondary" className="text-xs shrink-0">{track.category}</Badge>
                                </div>
                              </motion.div>
                            );
                          })
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}

          {/* ═══════ Quran: Step 2 - Select Reciter ═══════ */}
          {contentMode !== 'ibtahalat' && currentStep === 2 && (
            <Card className="border-border/60 shadow-md">
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Mic className="h-5 w-5 text-primary" />
                      اختيار القارئ والتلاوة والرواية
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      اختر من بين كبار القراء المعتمدين بمحاذاة الحروف والكلمات أو التلاوات القياسية بمختلف الروايات
                    </p>
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    <Badge variant="outline" className="text-xs font-normal">
                      {filteredReciters.length} من أصل {reciters.length} قارئ
                    </Badge>
                    {hasActiveReciterFilters && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={resetReciterFilters}
                        className="text-xs h-7 px-2 gap-1 text-muted-foreground hover:text-foreground"
                      >
                        <RotateCcw className="h-3 w-3" />
                        إعادة ضبط
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3.5">
                {/* Search Bar with Clear Button */}
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <Input
                    placeholder="ابحث باسم القارئ، الرواية، أو نوع التلاوة..."
                    aria-label="ابحث عن قارئ"
                    value={reciterSearch}
                    onChange={(e) => setReciterSearch(e.target.value)}
                    className="pr-10 pl-9"
                  />
                  {reciterSearch && (
                    <button
                      type="button"
                      onClick={() => setReciterSearch('')}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      title="مسح البحث"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* Primary Accreditation Filter Tabs */}
                <Tabs
                  value={reciterAccreditationFilter}
                  onValueChange={(val) => setReciterAccreditationFilter(val as any)}
                  className="w-full"
                >
                  <TabsList className="w-full grid grid-cols-3 h-9">
                    <TabsTrigger value="all" className="text-xs">
                      جميع القراء ({reciters.length})
                    </TabsTrigger>
                    <TabsTrigger value="accredited" className="text-xs gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                      <Zap className="h-3 w-3 fill-current" />
                      المعتمدون ⚡ ({countAccredited})
                    </TabsTrigger>
                    <TabsTrigger value="standard" className="text-xs">
                      تلاوات قياسية ({countStandard})
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                {/* Secondary Filters: Riwayah & Style */}
                <div className="space-y-2 pt-0.5">
                  {/* Riwayah Filter */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
                    <span className="text-[11px] font-medium text-muted-foreground shrink-0 ml-1">
                      الرواية:
                    </span>
                    {availableRiwayahs.map((riw) => {
                      const isSelected = reciterRiwayahFilter === (riw.id === 'all' ? 'all' : riw.arabicName);
                      return (
                        <button
                          key={riw.id}
                          type="button"
                          onClick={() => setReciterRiwayahFilter(riw.id === 'all' ? 'all' : riw.arabicName)}
                          className={cn(
                            "rounded-full px-2.5 py-1 text-xs whitespace-nowrap transition-all border shrink-0",
                            isSelected
                              ? "bg-primary text-primary-foreground border-primary font-medium shadow-sm"
                              : "bg-muted/50 hover:bg-muted text-muted-foreground border-transparent hover:border-border"
                          )}
                        >
                          {riw.arabicName}
                        </button>
                      );
                    })}
                  </div>

                  {/* Style Filter */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
                    <span className="text-[11px] font-medium text-muted-foreground shrink-0 ml-1">
                      النمط:
                    </span>
                    {availableStyles.map((st) => {
                      const isSelected = reciterStyleFilter === (st.id === 'all' ? 'all' : st.id);
                      return (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => setReciterStyleFilter(st.id === 'all' ? 'all' : st.id)}
                          className={cn(
                            "rounded-full px-2.5 py-1 text-xs whitespace-nowrap transition-all border shrink-0",
                            isSelected
                              ? "bg-secondary text-secondary-foreground border-secondary font-medium shadow-sm"
                              : "bg-muted/40 hover:bg-muted text-muted-foreground border-transparent hover:border-border"
                          )}
                        >
                          {st.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Recent / Popular Reciters Quick Chips */}
                {recentReciters.length > 0 && !reciterSearch && (
                  <div className="pt-1">
                    <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                      الأكثر استخداماً / حديثاً:
                    </p>
                    <div className="flex gap-2 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
                      {recentReciters.map((recId) => {
                        const rData = reciters.find((r) => r.id === recId);
                        if (!rData) return null;
                        const isSelected = selectedReciter === rData.id;
                        return (
                          <Button
                            key={rData.id}
                            type="button"
                            variant={isSelected ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => {
                              setSelectedReciter(rData.id);
                              saveRecentReciter(rData.id);
                            }}
                            className={cn(
                              "whitespace-nowrap rounded-full text-xs h-7 px-3 gap-1 transition-all shrink-0",
                              isSelected ? "gradient-primary text-primary-foreground shadow-sm" : "hover:border-primary/50"
                            )}
                          >
                            <span>{rData.name}</span>
                            <span className="text-[10px] opacity-70">({rData.style})</span>
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Reciter Grid / Empty State */}
                {filteredReciters.length === 0 ? (
                  <div className="p-8 text-center border rounded-xl bg-muted/20 border-dashed my-2">
                    <Mic className="h-10 w-10 mx-auto mb-2 opacity-40 text-muted-foreground" />
                    <p className="text-sm font-semibold mb-1">لا توجد نتائج مطابقة لخيار التصفية</p>
                    <p className="text-xs text-muted-foreground mb-4">
                      جرب تغيير الكلمات المفتاحية للبحث أو إزالة فلتر الرواية والاعتمادية
                    </p>
                    <Button type="button" variant="outline" size="sm" onClick={resetReciterFilters} className="text-xs gap-1.5">
                      <RotateCcw className="h-3.5 w-3.5" />
                      إعادة ضبط جميع الفلاتر
                    </Button>
                  </div>
                ) : (
                  <ScrollArea className="h-[52vh] rounded-lg border border-border/40 p-1">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 p-1">
                      {filteredReciters.map((reciter) => (
                        <ReciterCard
                          key={reciter.id}
                          reciter={reciter}
                          isSelected={selectedReciter === reciter.id}
                          onClick={() => {
                            setSelectedReciter(reciter.id);
                            saveRecentReciter(reciter.id);
                          }}
                        />
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          )}

          {/* ═══════ Quran: Step 3 - Select Ayahs ═══════ */}
          {contentMode !== 'ibtahalat' && currentStep === 3 && (
            <div className="grid grid-cols-1 gap-6">
              <Card className="border-border/60 shadow-md">
                <CardHeader className="pb-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <BookOpen className="h-5 w-5 text-primary" />
                        تحديد نطاق الآيات ومعاينتها
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">
                        اختر الآيات الكريمة التي ترغب في إنتاج مقطع الريلز لها بالرسم العثماني
                      </p>
                    </div>

                    {/* Quick Sheikh Recitation Audio Test Button */}
                    {selectedReciterData && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handlePlayAyahAudio}
                        className={`gap-2 text-xs border-primary/30 transition-all ${
                          isPlayingAyahAudio ? 'bg-primary text-primary-foreground shadow-md animate-pulse' : 'hover:bg-primary/10'
                        }`}
                      >
                        {isPlayingAyahAudio ? (
                          <>
                            <Pause className="h-3.5 w-3.5 text-current" />
                            <span>إيقاف تلاوة الشيخ {selectedReciterData.name.split(' ')[0]}</span>
                          </>
                        ) : (
                          <>
                            <Volume2 className="h-3.5 w-3.5 text-primary" />
                            <span>استمع لتلاوة الشيخ {selectedReciterData.name.split(' ')[0]}</span>
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Surah Summary Card */}
                  <div className="p-4 rounded-xl bg-muted/40 border border-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">السورة المختارة</p>
                      <p className="text-2xl font-bold font-quran text-foreground">{selectedSurahData?.name}</p>
                      <p className="text-xs text-muted-foreground">{selectedSurahData?.numberOfAyahs} آية كريمة • {selectedSurahData?.englishName}</p>
                    </div>

                    {/* Quick Range Chips */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs text-muted-foreground ml-1">نطاق سريع:</span>
                      {[
                        { label: '1 - 3', s: 1, e: Math.min(3, selectedSurahData?.numberOfAyahs || 3) },
                        { label: '1 - 5', s: 1, e: Math.min(5, selectedSurahData?.numberOfAyahs || 5) },
                        { label: '1 - 7', s: 1, e: Math.min(7, selectedSurahData?.numberOfAyahs || 7) },
                        { label: '10 آيات', s: 1, e: Math.min(10, selectedSurahData?.numberOfAyahs || 10) },
                        { label: 'السورة كاملة', s: 1, e: selectedSurahData?.numberOfAyahs || 1 },
                      ].map((chip) => (
                        <Button
                          key={chip.label}
                          type="button"
                          variant={startAyah === chip.s && endAyah === chip.e ? 'default' : 'outline'}
                          size="sm"
                          className="h-7 text-xs px-2.5 rounded-full"
                          onClick={() => {
                            setStartAyah(chip.s);
                            setStartAyahInput(chip.s.toString());
                            setEndAyah(chip.e);
                            setEndAyahInput(chip.e.toString());
                          }}
                        >
                          {chip.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* Stepper Inputs for Ayah Range */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Start Ayah */}
                    <div className="space-y-2 p-3.5 rounded-xl border border-border/50 bg-card/50">
                      <Label htmlFor="startAyah" className="text-xs font-semibold text-muted-foreground block">
                        من الآية
                      </Label>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-9 w-9 shrink-0 rounded-lg"
                          onClick={() => {
                            const next = Math.max(startAyah - 1, 1);
                            setStartAyah(next);
                            setStartAyahInput(next.toString());
                          }}
                          disabled={startAyah <= 1}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <Input
                          id="startAyah"
                          type="text"
                          inputMode="numeric"
                          value={startAyahInput}
                          onChange={(e) => {
                            const val = e.target.value;
                            setStartAyahInput(val);
                            const parsed = parseInt(val);
                            if (!isNaN(parsed) && parsed >= 1 && parsed <= (selectedSurahData?.numberOfAyahs || 1)) {
                              setStartAyah(parsed);
                              if (endAyah < parsed) {
                                setEndAyah(parsed);
                                setEndAyahInput(parsed.toString());
                              }
                            }
                          }}
                          onBlur={() => {
                            const max = selectedSurahData?.numberOfAyahs || 1;
                            const val = parseInt(startAyahInput) || 1;
                            const clamped = Math.min(Math.max(val, 1), max);
                            setStartAyah(clamped);
                            setStartAyahInput(clamped.toString());
                            if (endAyah < clamped) {
                              setEndAyah(clamped);
                              setEndAyahInput(clamped.toString());
                            }
                          }}
                          className="text-center font-bold text-lg h-9"
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-9 w-9 shrink-0 rounded-lg"
                          onClick={() => {
                            const max = selectedSurahData?.numberOfAyahs || 1;
                            const next = Math.min(startAyah + 1, endAyah);
                            setStartAyah(next);
                            setStartAyahInput(next.toString());
                          }}
                          disabled={startAyah >= endAyah}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* End Ayah */}
                    <div className="space-y-2 p-3.5 rounded-xl border border-border/50 bg-card/50">
                      <Label htmlFor="endAyah" className="text-xs font-semibold text-muted-foreground block">
                        إلى الآية
                      </Label>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-9 w-9 shrink-0 rounded-lg"
                          onClick={() => {
                            const next = Math.max(endAyah - 1, startAyah);
                            setEndAyah(next);
                            setEndAyahInput(next.toString());
                          }}
                          disabled={endAyah <= startAyah}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <Input
                          id="endAyah"
                          type="text"
                          inputMode="numeric"
                          value={endAyahInput}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEndAyahInput(val);
                            const parsed = parseInt(val);
                            if (!isNaN(parsed) && parsed >= startAyah && parsed <= (selectedSurahData?.numberOfAyahs || 1)) {
                              setEndAyah(parsed);
                            }
                          }}
                          onBlur={() => {
                            const max = selectedSurahData?.numberOfAyahs || 1;
                            const val = parseInt(endAyahInput) || startAyah;
                            const clamped = Math.min(Math.max(val, startAyah), max);
                            setEndAyah(clamped);
                            setEndAyahInput(clamped.toString());
                          }}
                          className="text-center font-bold text-lg h-9"
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-9 w-9 shrink-0 rounded-lg"
                          onClick={() => {
                            const max = selectedSurahData?.numberOfAyahs || 1;
                            const next = Math.min(endAyah + 1, max);
                            setEndAyah(next);
                            setEndAyahInput(next.toString());
                          }}
                          disabled={endAyah >= (selectedSurahData?.numberOfAyahs || 1)}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Summary Ribbon */}
                  <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-between">
                    <p className="text-xs sm:text-sm text-primary font-semibold flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4 text-amber-500" />
                      سيتم إنتاج فيديو ريلز يحتوي على {endAyah - startAyah + 1} {endAyah - startAyah + 1 === 1 ? 'آية كريمة' : 'آيات كريمة'}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      من الآية {startAyah} حتى {endAyah}
                    </span>
                  </div>

                  {/* Ayahs Preview Box */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <Label className="font-semibold flex items-center gap-2">
                        <BookOpen className="h-4 w-4 text-primary" />
                        معاينة الآيات الكريمة بالرسم العثماني
                      </Label>
                      {ayahs.length > 0 && !previewLoading && !apiLoading && (
                        <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-500 border-amber-500/30 font-semibold px-3 py-1">
                          {ayahs.length} {ayahs.length === 1 ? 'آية' : 'آيات'} مكتملة
                        </Badge>
                      )}
                    </div>

                    {previewLoading || apiLoading ? (
                      <div className="border border-primary/25 rounded-2xl p-8 bg-gradient-to-b from-primary/5 via-muted/30 to-background relative overflow-hidden shadow-inner">
                        {/* Shimmer effect */}
                        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-primary/15 to-transparent -translate-x-full animate-[shimmer_1.8s_infinite]" />
                        
                        <div className="flex flex-col items-center justify-center text-center space-y-4 py-8">
                          <div className="relative">
                            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/20 to-primary/20 flex items-center justify-center border border-amber-500/30 shadow-lg shadow-amber-500/10 animate-pulse">
                              <BookOpen className="h-8 w-8 text-amber-500" />
                            </div>
                            <Sparkles className="h-5 w-5 text-amber-400 absolute -top-1.5 -right-1.5 animate-bounce" />
                          </div>

                          <div className="space-y-1.5 max-w-md">
                            <p className="text-base font-bold text-foreground">
                              جاري جلب الآيات الكريمة بالرسم العثماني...
                            </p>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              يتم التحقق من النص القرآني الموثق من مجمع الملك فهد لطباعة المصحف الشريف ومنظومة Quran Foundation
                            </p>
                          </div>

                          {/* Pulsing Skeleton Lines */}
                          <div className="w-full max-w-lg space-y-3 pt-3">
                            <div className="h-5 bg-muted-foreground/15 rounded-full w-5/6 mx-auto animate-pulse" />
                            <div className="h-5 bg-muted-foreground/15 rounded-full w-full animate-pulse" style={{ animationDelay: '180ms' }} />
                            <div className="h-5 bg-muted-foreground/15 rounded-full w-4/5 mx-auto animate-pulse" style={{ animationDelay: '360ms' }} />
                          </div>
                        </div>
                      </div>
                    ) : quranApiError ? (
                      <ErrorState message={quranApiError} onRetry={loadAyahs} />
                    ) : ayahs.length === 0 ? (
                      <div className="text-center py-12 border border-dashed rounded-2xl text-muted-foreground bg-muted/20">
                        <BookOpen className="h-10 w-10 mx-auto mb-2 opacity-40 text-primary" />
                        <p className="text-sm font-medium">الرجاء تحديد نطاق الآيات لعرضها بالرسم العثماني</p>
                      </div>
                    ) : (
                      <ScrollArea className="h-[280px] border border-border/80 rounded-2xl p-4 bg-card/60 shadow-inner backdrop-blur-sm">
                        <div className="space-y-3">
                          {ayahs.map((ayah) => (
                            <AyahDisplay key={ayah.number} number={ayah.numberInSurah} text={ayah.text} />
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ═══════ Background Step (Quran: 4, Ibtahalat: 2) ═══════ */}
          {((contentMode !== 'ibtahalat' && currentStep === 4) || (contentMode === 'ibtahalat' && currentStep === 2)) && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <BackgroundSelector selectedBackground={selectedBackground} onSelect={(background) => {
                  if (!isPremium && !isBasicBackground(background.category, background.type)) {
                    toast.error('الخلفيات المتحركة والفيديوهات متاحة للعضوية المميزة فقط');
                    return;
                  }
                  setSelectedBackground(background);
                }} />
              </div>
              <div className="space-y-6">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Settings className="h-5 w-5" />
                      صيغة الفيديو
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <RadioGroup
                      value={aspectRatio}
                      onValueChange={(v) => setAspectRatio(v as AspectRatio)}
                      className="space-y-3"
                    >
                      <div className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer">
                        <RadioGroupItem value="9:16" id="ratio-916" />
                        <Label htmlFor="ratio-916" className="flex items-center gap-2 cursor-pointer">
                          <Smartphone className="h-5 w-5" />
                          <div>
                            <p className="font-medium">عمودي 9:16</p>
                            <p className="text-xs text-muted-foreground">مثالي للريلز وتيكتوك</p>
                          </div>
                        </Label>
                      </div>
                      <div className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer">
                        <RadioGroupItem value="16:9" id="ratio-169" />
                        <Label htmlFor="ratio-169" className="flex items-center gap-2 cursor-pointer">
                          <Monitor className="h-5 w-5" />
                          <div>
                            <p className="font-medium">أفقي 16:9</p>
                            <p className="text-xs text-muted-foreground">مثالي ليوتيوب</p>
                          </div>
                        </Label>
                      </div>
                    </RadioGroup>
                  </CardContent>
                </Card>
                {contentMode !== 'ibtahalat' && (
                  <SettingsSection title="إعدادات النص" description="الخط والحجم واللون والظل">
                  <TextSettingsPanel settings={textSettings} onChange={setTextSettings} />
                  </SettingsSection>
                )}
              </div>
            </div>
          )}

          {/* ═══════ Preview / Summary Step ═══════ */}
          {isOnLastStep && (
            <Card>
              <CardHeader>
                <CardTitle>ملخص الفيديو</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {contentMode === 'ibtahalat' ? (
                    <>
                      <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                        <p className="text-sm text-muted-foreground">المبتهل</p>
                        <p className="font-bold text-lg">
                          {selectedTrackData ? getPerformerById(selectedTrackData.performerId)?.name : ''}
                        </p>
                      </div>
                      <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                        <p className="text-sm text-muted-foreground">الابتهال</p>
                        <p className="font-bold text-lg">{selectedTrackData?.title}</p>
                      </div>
                      <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                        <p className="text-sm text-muted-foreground">المدة</p>
                        <p className="font-bold">{selectedTrackData?.duration}</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                        <p className="text-sm text-muted-foreground">السورة</p>
                        <p className="font-bold text-lg">{selectedSurahData?.name}</p>
                      </div>
                      <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                        <p className="text-sm text-muted-foreground">القارئ</p>
                        <p className="font-bold text-lg">{selectedReciterData?.name}</p>
                      </div>
                      <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                        <p className="text-sm text-muted-foreground">الآيات</p>
                        <p className="font-bold">من {startAyah} إلى {endAyah} ({endAyah - startAyah + 1} آية)</p>
                      </div>
                    </>
                  )}
                  <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                    <p className="text-sm text-muted-foreground">الخلفية</p>
                    <p className="font-bold">{selectedBackground?.name}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                    <p className="text-sm text-muted-foreground">الصيغة</p>
                    <p className="font-bold">
                      {aspectRatio === '9:16' ? 'عمودي (ريلز)' : 'أفقي (يوتيوب)'}
                    </p>
                  </div>
                </div>

                <div className="pt-4">
                  <Button onClick={handleCreateVideo} size="lg" className="w-full gap-2 text-lg py-6">
                    <Play className="h-5 w-5" />
                    إنشاء الفيديو
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </motion.div>

        {/* Navigation Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex justify-between"
        >
          <Button
            variant="outline"
            onClick={handlePrevStep}
            disabled={currentStep === 1}
            className="gap-2"
          >
            <ChevronRight className="h-4 w-4" />
            السابق
          </Button>

          {!isOnLastStep && (
            <Button onClick={handleNextStep} className="gap-2">
              التالي
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
        </motion.div>
      </div>
    </Layout>
  );
}

// ── Famous Ayahs Grid Component ──
function FamousAyahsGrid({ onSelect }: { onSelect: (ayah: FamousAyah) => void }) {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const filteredAyahs = getAyahsByCategory(selectedCategory);

  return (
    <div className="space-y-4">
      <div className="w-full overflow-x-auto pb-2" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="flex gap-2 min-w-max">
          {ayahCategories.map((cat) => (
            <Button
              key={cat.id}
              variant={selectedCategory === cat.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedCategory(cat.id)}
              className="whitespace-nowrap"
            >
              {cat.name}
            </Button>
          ))}
        </div>
      </div>
      <ScrollArea className="h-[45vh]">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-1">
          {filteredAyahs.map((ayah) => (
            <motion.div
              key={ayah.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onSelect(ayah)}
              className="cursor-pointer rounded-xl border-2 border-transparent hover:border-primary/50 transition-all p-4 bg-muted/50 hover:bg-muted"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-bold text-lg">{ayah.name}</h3>
                  <p className="text-sm text-muted-foreground">{ayah.description}</p>
                  <div className="flex gap-2 mt-2">
                    <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
                      {ayah.endAyah - ayah.startAyah + 1} آية
                    </span>
                  </div>
                </div>
                <ChevronLeft className="h-5 w-5 text-muted-foreground" />
              </div>
            </motion.div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
