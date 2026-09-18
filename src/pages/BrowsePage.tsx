import { useState, useMemo, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { surahs, Surah } from '@/data/surahs';
import {
  performers,
  ibtahalatTracks,
  getTracksByCategory,
  getPerformerById,
  IbtahalTrack,
} from '@/data/ibtahalat';
import {
  Search,
  BookOpen,
  Music,
  Play,
  Pause,
  Filter,
  Sparkles,
  Video,
  ChevronLeft,
  Mic,
  Globe,
  Star,
} from 'lucide-react';
import { toast } from 'sonner';

type ContentType = 'all' | 'quran' | 'ibtahalat';
type RevelationType = 'all' | 'Meccan' | 'Medinan';

export default function BrowsePage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [contentType, setContentType] = useState<ContentType>('all');
  const [revelationFilter, setRevelationFilter] = useState<RevelationType>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Filter surahs
  const filteredSurahs = useMemo(() => {
    if (contentType === 'ibtahalat') return [];
    let result = surahs;
    if (revelationFilter !== 'all') {
      result = result.filter(s => s.revelationType === revelationFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(s =>
        s.name.includes(q) ||
        s.englishName.toLowerCase().includes(q) ||
        s.englishNameTranslation.toLowerCase().includes(q) ||
        s.number.toString() === q
      );
    }
    return result;
  }, [contentType, revelationFilter, searchQuery]);

  // Filter ibtahalat
  const filteredTracks = useMemo(() => {
    if (contentType === 'quran') return [];
    let result = ibtahalatTracks;
    if (categoryFilter !== 'all') {
      result = getTracksByCategory(categoryFilter as IbtahalTrack['category']);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(t =>
        t.title.includes(q) ||
        (getPerformerById(t.performerId)?.name || '').includes(q)
      );
    }
    return result;
  }, [contentType, categoryFilter, searchQuery]);

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

  const categories = [
    { value: 'all', label: 'الكل' },
    { value: 'ابتهال', label: 'ابتهال' },
    { value: 'توشيح', label: 'توشيح' },
    { value: 'مديح', label: 'مديح' },
    { value: 'دعاء', label: 'دعاء' },
  ];

  const totalCount = (contentType === 'quran' ? 0 : filteredTracks.length) +
    (contentType === 'ibtahalat' ? 0 : filteredSurahs.length);

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 text-center"
        >
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm font-medium text-primary mb-4">
            <Sparkles className="h-4 w-4" />
            <span>تصفح شامل</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-2">المكتبة الشاملة</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            تصفح جميع السور القرآنية والابتهالات والتواشيح في مكان واحد — {surahs.length} سورة و{ibtahalatTracks.length} تسجيل
          </p>
        </motion.div>

        {/* Search & Filters */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-4 mb-8"
        >
          <div className="relative max-w-lg mx-auto">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="ابحث عن سورة أو ابتهال أو مبتهل..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-11 h-12 text-base"
            />
          </div>

          {/* Content Type Tabs */}
          <div className="flex justify-center">
            <div className="flex gap-2 bg-muted/50 p-1 rounded-lg">
              {([
                { value: 'all', label: 'الكل', icon: Globe },
                { value: 'quran', label: 'القرآن الكريم', icon: BookOpen },
                { value: 'ibtahalat', label: 'ابتهالات وتواشيح', icon: Music },
              ] as const).map(tab => (
                <Button
                  key={tab.value}
                  variant={contentType === tab.value ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setContentType(tab.value)}
                  className="gap-1.5"
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Sub-Filters */}
          <div className="flex justify-center gap-2 flex-wrap">
            {contentType !== 'ibtahalat' && (
              <>
                <Button
                  variant={revelationFilter === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setRevelationFilter('all')}
                >
                  كل السور
                </Button>
                <Button
                  variant={revelationFilter === 'Meccan' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setRevelationFilter('Meccan')}
                >
                  مكية
                </Button>
                <Button
                  variant={revelationFilter === 'Medinan' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setRevelationFilter('Medinan')}
                >
                  مدنية
                </Button>
              </>
            )}
            {contentType !== 'quran' && (
              <>
                {categories.map(cat => (
                  <Button
                    key={cat.value}
                    variant={categoryFilter === cat.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setCategoryFilter(cat.value)}
                  >
                    {cat.label}
                  </Button>
                ))}
              </>
            )}
          </div>

          <p className="text-center text-sm text-muted-foreground">
            {totalCount} نتيجة
          </p>
        </motion.div>

        {/* Results */}
        <div className="space-y-6">
          {/* Quran Surahs */}
          {contentType !== 'ibtahalat' && filteredSurahs.length > 0 && (
            <section>
              {contentType === 'all' && (
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-primary" />
                  السور القرآنية ({filteredSurahs.length})
                </h2>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {filteredSurahs.map(surah => (
                  <motion.div
                    key={surah.number}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    whileHover={{ scale: 1.02 }}
                  >
                    <Card className="hover:shadow-md hover:shadow-primary/5 transition-all cursor-pointer group"
                      onClick={() => navigate(`/create?surah=${surah.number}`)}>
                      <CardContent className="p-4 flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-sm group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                          {surah.number}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold truncate">{surah.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {surah.englishNameTranslation} • {surah.numberOfAyahs} آية
                          </p>
                        </div>
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {surah.revelationType === 'Meccan' ? 'مكية' : 'مدنية'}
                        </Badge>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </section>
          )}

          {/* Ibtahalat */}
          {contentType !== 'quran' && filteredTracks.length > 0 && (
            <section>
              {contentType === 'all' && (
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <Music className="h-5 w-5 text-primary" />
                  ابتهالات وتواشيح ({filteredTracks.length})
                </h2>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredTracks.map(track => {
                  const performer = getPerformerById(track.performerId);
                  const isSelected = playingTrackId === track.id;
                  return (
                    <motion.div
                      key={track.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      whileHover={{ scale: 1.02 }}
                    >
                      <Card className={`hover:shadow-md hover:shadow-primary/5 transition-all ${isSelected ? 'ring-2 ring-primary' : ''}`}>
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="shrink-0 h-10 w-10 rounded-full bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground"
                              onClick={() => handlePlayPreview(track)}
                            >
                              {isSelected ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                            </Button>
                            <div className="flex-1 min-w-0">
                              <p className="font-bold truncate text-sm">{track.title}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {performer?.name} • {track.duration}
                              </p>
                              <div className="flex items-center gap-1.5 mt-1.5">
                                <Badge variant="secondary" className="text-xs">{track.category}</Badge>
                                {track.lyrics && (
                                  <Badge variant="outline" className="text-xs gap-0.5">
                                    <Star className="h-2.5 w-2.5" />
                                    كلمات
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="shrink-0 gap-1"
                              onClick={() => {
                                const performer = getPerformerById(track.performerId);
                                const params = new URLSearchParams({
                                  mode: 'ibtahalat',
                                  trackId: track.id,
                                  trackTitle: track.title,
                                  performerName: performer?.name || '',
                                  audioUrl: track.audioUrl,
                                });
                                navigate(`/ibtahalat?step=2&${params.toString()}`);
                              }}
                            >
                              <Video className="h-3 w-3" />
                              فيديو
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>
            </section>
          )}

          {totalCount === 0 && (
            <div className="text-center py-20 text-muted-foreground">
              <Search className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p className="text-lg">لا توجد نتائج</p>
              <p className="text-sm">جرب البحث بكلمات مختلفة</p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
