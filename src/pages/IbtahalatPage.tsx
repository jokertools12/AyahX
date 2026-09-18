import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Layout } from '@/components/Layout';
import { BackgroundSelector } from '@/components/BackgroundSelector';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { BackgroundItem, backgroundImages } from '@/data/backgrounds';
import {
  performers,
  ibtahalatTracks,
  getTracksByPerformer,
  getTracksByCategory,
  getPerformerById,
  searchTracks,
  Performer,
  IbtahalTrack,
} from '@/data/ibtahalat';
import {
  Play,
  Pause,
  ChevronRight,
  ChevronLeft,
  Search,
  Sparkles,
  Music,
  Mic,
  Monitor,
  Smartphone,
  Volume2,
  Filter,
  List,
  User,
  Heart,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { api } from '@/lib/api';
import { isBasicBackground } from '../../shared/planEntitlements';

type AspectRatio = '9:16' | '16:9';
type BrowseMode = 'byPerformer' | 'byCategory' | 'search';

export default function IbtahalatPage() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { loading: subscriptionLoading, isPremium } = useSubscription();
  const [searchParams] = useSearchParams();
  const [currentStep, setCurrentStep] = useState(1);
  
  // Handle step param from BrowsePage (skip to step 2 with pre-selected track)
  const initializedFromParams = useRef(false);
  const [selectedPerformer, setSelectedPerformer] = useState<string | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  const [selectedBackground, setSelectedBackground] = useState<BackgroundItem | null>(
    // A free member must never begin this flow with an animated background.
    // Premium choices are exposed deliberately by the selector after the
    // subscription is known, rather than leaking through a random default.
    () => backgroundImages[0]
  );
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [customBg, setCustomBg] = useState<string | null>(null);
  const [customBgType, setCustomBgType] = useState<'image' | 'video'>('image');
  const [searchQuery, setSearchQuery] = useState('');
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);
  const [browseMode, setBrowseMode] = useState<BrowseMode>('byCategory');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [favPerformers, setFavPerformers] = useState<Set<string>>(new Set());

  // Keep this standalone creation flow in lockstep with the main Quran flow.
  // The preview and API also enforce the plan, but correcting stale state here
  // prevents a free member from seeing a paid selection in the summary first.
  useEffect(() => {
    if (subscriptionLoading || isPremium) return;
    setSelectedBackground((previous) => previous && isBasicBackground(previous.category, previous.type)
      ? previous
      : backgroundImages[0]);
    setCustomBg(null);
  }, [subscriptionLoading, isPremium]);

  // Load favorite performers
  useEffect(() => {
    if (!user) return;
    api.users.getFavorites()
      .then((data) => {
        if (data?.performers) setFavPerformers(new Set(data.performers));
      })
      .catch((err) => console.error(err));
  }, [user]);

  // Initialize from URL params (e.g. coming from BrowsePage)
  useEffect(() => {
    if (initializedFromParams.current) return;
    const stepParam = searchParams.get('step');
    const trackIdParam = searchParams.get('trackId');
    if (stepParam === '2' && trackIdParam) {
      initializedFromParams.current = true;
      setSelectedTrack(trackIdParam);
      setCurrentStep(2);
    }
  }, [searchParams]);

  const toggleFavPerformer = async (performerId: string) => {
    if (!isAuthenticated || !user) {
      toast.error('سجل دخول لإضافة المفضلة');
      return;
    }
    try {
      const res = await api.users.toggleFavoritePerformer(performerId);
      if (res.isFavorite) {
        setFavPerformers(prev => new Set(prev).add(performerId));
        toast.success('تمت الإضافة للمفضلة');
      } else {
        setFavPerformers(prev => { const s = new Set(prev); s.delete(performerId); return s; });
        toast.success('تمت الإزالة من المفضلة');
      }
    } catch (err) {
      toast.error('حدث خطأ في تحديث المفضلة');
    }
  };

  const selectedPerformerData = performers.find(p => p.id === selectedPerformer);
  const selectedTrackData = ibtahalatTracks.find(t => t.id === selectedTrack);

  // Get tracks based on browse mode
  const getFilteredTracks = (): IbtahalTrack[] => {
    let tracks: IbtahalTrack[];

    if (browseMode === 'search' && searchQuery.trim()) {
      tracks = searchTracks(searchQuery);
    } else if (browseMode === 'byPerformer' && selectedPerformer) {
      tracks = getTracksByPerformer(selectedPerformer);
    } else if (browseMode === 'byCategory') {
      tracks = selectedCategory === 'all'
        ? ibtahalatTracks
        : getTracksByCategory(selectedCategory as IbtahalTrack['category']);
    } else {
      tracks = ibtahalatTracks;
    }

    return tracks;
  };

  const filteredTracks = getFilteredTracks();

  const filteredPerformers = performers.filter(
    p => p.name.includes(searchQuery) || p.englishName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handlePlayPreview = useCallback((track: IbtahalTrack) => {
    if (playingTrackId === track.id) {
      audioRef.current?.pause();
      setPlayingTrackId(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(track.audioUrl);
    audio.play().catch(() => toast.error('تعذر تشغيل الصوت'));
    audio.onended = () => setPlayingTrackId(null);
    audioRef.current = audio;
    setPlayingTrackId(track.id);
  }, [playingTrackId]);

  const handleNextStep = () => {
    if (currentStep === 1 && !selectedTrack) {
      toast.error('الرجاء اختيار ابتهال');
      return;
    }
    if (currentStep === 2 && !selectedBackground) {
      toast.error('الرجاء اختيار خلفية');
      return;
    }
    if (currentStep === 2 && !isPremium && selectedBackground
      && (!isBasicBackground(selectedBackground.category, selectedBackground.type) || customBg)) {
      toast.error('الخطة المجانية تدعم الخلفيات الإسلامية والطبيعية الثابتة فقط');
      return;
    }
    setCurrentStep(prev => Math.min(prev + 1, 3));
  };

  const handlePrevStep = () => {
    setCurrentStep(prev => Math.max(prev - 1, 1));
  };

  const handleCreateVideo = () => {
    if (!selectedTrack || !selectedBackground) {
      toast.error('الرجاء إكمال جميع الخطوات');
      return;
    }
    if (!isPremium && (!isBasicBackground(selectedBackground.category, selectedBackground.type) || customBg)) {
      toast.error('الخطة المجانية تدعم الخلفيات الإسلامية والطبيعية الثابتة فقط');
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
    if (customBg) {
      params.set('customBgUrl', customBg);
      params.set('customBgType', customBgType);
    }

    navigate(`/preview?${params.toString()}`);
  };

  const stepLabels = ['اختر الابتهال', 'اختر الخلفية', 'المعاينة'];

  const categories = [
    { value: 'all', label: 'الكل', count: ibtahalatTracks.length },
    { value: 'ابتهال', label: 'ابتهال', count: getTracksByCategory('ابتهال').length },
    { value: 'توشيح', label: 'توشيح', count: getTracksByCategory('توشيح').length },
    { value: 'مديح', label: 'مديح', count: getTracksByCategory('مديح').length },
    { value: 'دعاء', label: 'دعاء', count: getTracksByCategory('دعاء').length },
  ];

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="text-3xl md:text-4xl font-bold mb-2 flex items-center gap-3">
            <Music className="h-8 w-8 text-primary" />
            ابتهالات وتواشيح
          </h1>
          <p className="text-muted-foreground">
            أنشئ فيديو بابتهالات وتواشيح أشهر المبتهلين والمنشدين - {ibtahalatTracks.length} تسجيل متاح
          </p>
        </motion.div>

        {/* Progress Steps */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex items-center justify-center gap-1 md:gap-2 mb-6 overflow-x-auto pb-2"
        >
          {[1, 2, 3].map((step) => (
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
              {step < 3 && (
                <div
                  className={`w-6 md:w-12 h-1 rounded ${
                    currentStep > step ? 'bg-primary' : 'bg-muted'
                  }`}
                />
              )}
            </div>
          ))}
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
          key={currentStep}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="mb-8"
        >
          {/* Step 1: Select Track (with browse modes) */}
          {currentStep === 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Music className="h-5 w-5" />
                  اختر الابتهال
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Browse Mode Tabs */}
                <div className="flex gap-2 mb-4 flex-wrap">
                  <Button
                    variant={browseMode === 'byCategory' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setBrowseMode('byCategory')}
                    className="gap-1"
                  >
                    <Filter className="h-4 w-4" />
                    حسب التصنيف
                  </Button>
                  <Button
                    variant={browseMode === 'byPerformer' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setBrowseMode('byPerformer')}
                    className="gap-1"
                  >
                    <User className="h-4 w-4" />
                    حسب المبتهل
                  </Button>
                  <Button
                    variant={browseMode === 'search' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setBrowseMode('search')}
                    className="gap-1"
                  >
                    <Search className="h-4 w-4" />
                    بحث
                  </Button>
                </div>

                {/* Search Input */}
                {browseMode === 'search' && (
                  <div className="relative mb-4">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <Input
                      placeholder="ابحث في الابتهالات والتواشيح..."
                      aria-label="ابحث في الابتهالات والتواشيح"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pr-10"
                      autoFocus
                    />
                  </div>
                )}

                {/* Category Filter */}
                {browseMode === 'byCategory' && (
                  <div className="flex gap-2 mb-4 flex-wrap">
                    {categories.map(cat => (
                      <Button
                        key={cat.value}
                        variant={selectedCategory === cat.value ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setSelectedCategory(cat.value)}
                      >
                        {cat.label}
                        <Badge variant="secondary" className="mr-1 text-xs">
                          {cat.count}
                        </Badge>
                      </Button>
                    ))}
                  </div>
                )}

                {/* Performer Selector */}
                {browseMode === 'byPerformer' && (
                  <div className="mb-4">
                    <div className="relative mb-3">
                      <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <Input
                        placeholder="ابحث عن مبتهل..."
                        aria-label="ابحث عن مبتهل"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pr-10"
                      />
                    </div>
                    <div className="flex gap-2 flex-wrap mb-4">
                      {filteredPerformers.map(p => (
                        <div key={p.id} className="flex items-center gap-1">
                          <Button
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
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={favPerformers.has(p.id) ? `إزالة ${p.name} من المفضلة` : `إضافة ${p.name} للمفضلة`}
                            className="h-7 w-7"
                            onClick={(e) => { e.stopPropagation(); toggleFavPerformer(p.id); }}
                          >
                            <Heart className={`h-4 w-4 ${favPerformers.has(p.id) ? 'fill-destructive text-destructive' : 'text-muted-foreground'}`} aria-hidden="true" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tracks List */}
                <ScrollArea className="h-[55vh]">
                  <div className="space-y-3 p-1">
                    {filteredTracks.length === 0 ? (
                      <p className="text-center text-muted-foreground py-8">
                        لا توجد نتائج
                      </p>
                    ) : (
                      filteredTracks.map(track => (
                        <TrackCard
                          key={track.id}
                          track={track}
                          showPerformer={browseMode !== 'byPerformer'}
                          isSelected={selectedTrack === track.id}
                          isPlaying={playingTrackId === track.id}
                          onClick={() => setSelectedTrack(track.id)}
                          onPlayPreview={() => handlePlayPreview(track)}
                        />
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {/* Step 2: Background */}
          {currentStep === 2 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <BackgroundSelector
                  selectedBackground={selectedBackground}
                  onSelect={(background) => {
                    if (!isPremium && !isBasicBackground(background.category, background.type)) {
                      toast.error('الخلفيات المتحركة والفيديوهات متاحة للعضوية المميزة فقط');
                      return;
                    }
                    setCustomBg(null);
                    setSelectedBackground(background);
                  }}
                  customBackground={customBg}
                  onCustomBackgroundChange={(url) => {
                    if (url && !isPremium) {
                      toast.error('رفع الخلفيات المخصصة متاح للعضوية المميزة فقط');
                      return;
                    }
                    if (url) {
                      setCustomBg(url);
                    } else {
                      setCustomBg(null);
                    }
                  }}
                  onCustomBackgroundTypeChange={(type) => setCustomBgType(type)}
                />
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>نسبة الأبعاد</CardTitle>
                </CardHeader>
                <CardContent>
                  <RadioGroup
                    value={aspectRatio}
                    onValueChange={(v) => setAspectRatio(v as AspectRatio)}
                    className="space-y-3"
                  >
                    <div className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer">
                      <RadioGroupItem value="9:16" id="ratio-916-ibt" />
                      <Label htmlFor="ratio-916-ibt" className="flex items-center gap-2 cursor-pointer">
                        <Smartphone className="h-5 w-5" />
                        <div>
                          <p className="font-medium">عمودي 9:16</p>
                          <p className="text-xs text-muted-foreground">مثالي للريلز وتيكتوك</p>
                        </div>
                      </Label>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer">
                      <RadioGroupItem value="16:9" id="ratio-169-ibt" />
                      <Label htmlFor="ratio-169-ibt" className="flex items-center gap-2 cursor-pointer">
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
            </div>
          )}

          {/* Step 3: Summary */}
          {currentStep === 3 && (
            <Card>
              <CardHeader>
                <CardTitle>ملخص الفيديو</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                    <p className="text-sm text-muted-foreground">نسبة الأبعاد</p>
                    <p className="font-bold">{aspectRatio === '9:16' ? 'عمودي (ريلز)' : 'أفقي (يوتيوب)'}</p>
                  </div>
                </div>
                {selectedTrackData?.lyrics && (
                  <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                    <p className="text-sm text-muted-foreground">كلمات الابتهال</p>
                    <p className="font-medium text-right leading-relaxed whitespace-pre-line text-sm">
                      {selectedTrackData.lyrics}
                    </p>
                  </div>
                )}
                <Button onClick={handleCreateVideo} size="lg" className="w-full text-lg">
                  <Play className="h-5 w-5 ml-2" />
                  إنشاء الفيديو
                </Button>
              </CardContent>
            </Card>
          )}
        </motion.div>

        {/* Navigation Buttons */}
        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={handlePrevStep}
            disabled={currentStep === 1}
            className="gap-2"
          >
            <ChevronRight className="h-4 w-4" />
            السابق
          </Button>
          {currentStep < 3 ? (
            <Button onClick={handleNextStep} className="gap-2">
              التالي
              <ChevronLeft className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleCreateVideo} className="gap-2">
              <Play className="h-4 w-4" />
              إنشاء الفيديو
            </Button>
          )}
        </div>
      </div>
    </Layout>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function TrackCard({
  track,
  showPerformer = false,
  isSelected,
  isPlaying,
  onClick,
  onPlayPreview,
}: {
  track: IbtahalTrack;
  showPerformer?: boolean;
  isSelected: boolean;
  isPlaying: boolean;
  onClick: () => void;
  onPlayPreview: () => void;
}) {
  const performer = showPerformer ? getPerformerById(track.performerId) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary ${
        isSelected
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-primary/50 hover:bg-muted/50'
      }`}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPlayPreview();
        }}
        aria-label={isPlaying ? `إيقاف مؤقت لـ ${track.title}` : `تشغيل معاينة ${track.title}`}
        className={`flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
          isPlaying
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted hover:bg-primary/20'
        }`}
      >
        {isPlaying ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
      </button>
      <div className="flex-1 min-w-0">
        <h4 className="font-bold truncate">{track.title}</h4>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {showPerformer && performer && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Mic className="h-3 w-3" />
              {performer.name}
            </span>
          )}
          <Badge variant="outline" className="text-xs">
            {track.category}
          </Badge>
          <span className="text-xs text-muted-foreground">{track.duration}</span>
          {track.lyrics && (
            <Badge variant="secondary" className="text-xs">
              كلمات
            </Badge>
          )}
        </div>
      </div>
      {isSelected && (
        <div className="flex-shrink-0 h-6 w-6 rounded-full bg-primary flex items-center justify-center">
          <Sparkles className="h-3 w-3 text-primary-foreground" />
        </div>
      )}
    </div>
  );
}
