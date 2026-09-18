import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { downloadSavedVideo } from '@/lib/download';
import { ErrorState } from '@/components/ErrorState';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Video, 
  Trash2, 
  Play, 
  Calendar,
  Loader2,
  Library as LibraryIcon,
  Plus,
  ExternalLink,
  RotateCcw,
  Search,
  Copy,
  Edit3,
  Check,
  X,
  Download,
  Clock,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

interface SavedVideo {
  id: string;
  surah_name: string;
  surah_number: number;
  reciter_id: string;
  reciter_name: string;
  start_ayah: number;
  end_ayah: number;
  aspect_ratio: string;
  background_type: string;
  created_at: string;
  video_url?: string;
  thumbnail_url?: string;
  expires_at?: string;
  render_engine?: string;
}

type SortType = 'latest' | 'oldest' | 'surah' | 'reciter';

export default function LibraryPage() {
  const navigate = useNavigate();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [videos, setVideos] = useState<SavedVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortType>('latest');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [savingRename, setSavingRename] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const fetchVideos = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      const data = await api.videos.getMy();
      setVideos((data as unknown as SavedVideo[]) || []);
    } catch (err) {
      console.error('Error fetching videos:', err);
      setError('تعذر تحميل مكتبة الفيديوهات. يرجى التحقق من اتصالك والمحاولة مرة أخرى.');
      toast.error('حدث خطأ في تحميل الفيديوهات');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/auth');
      return;
    }

    if (isAuthenticated && user) {
      fetchVideos();
    }
  }, [isAuthenticated, authLoading, navigate, user, fetchVideos]);

  const filteredVideos = useMemo(() => {
    let result = videos.filter((v) => {
      const query = searchQuery.toLowerCase();
      return (
        v.surah_name.toLowerCase().includes(query) ||
        v.reciter_name.toLowerCase().includes(query)
      );
    });

    // Sorting
    switch (sortBy) {
      case 'oldest':
        result = [...result].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        break;
      case 'surah':
        result = [...result].sort((a, b) => a.surah_number - b.surah_number);
        break;
      case 'reciter':
        result = [...result].sort((a, b) => a.reciter_name.localeCompare(b.reciter_name, 'ar'));
        break;
      default:
        // latest - already sorted by fetch
        break;
    }

    return result;
  }, [videos, searchQuery, sortBy]);

  const handleDelete = async (id: string) => {
    try {
      await api.videos.delete(id);
      setVideos((prev) => prev.filter((v) => v.id !== id));
      toast.success('تم حذف الفيديو');
    } catch (err) {
      console.error('Error deleting video:', err);
      toast.error('حدث خطأ في حذف الفيديو');
    }
  };

  const handleSaveRename = async (id: string) => {
    if (!editingName.trim()) {
      toast.error('اسم المشروع لا يمكن أن يكون فارغاً');
      return;
    }
    setSavingRename(true);
    try {
      await api.videos.update(id, { surah_name: editingName.trim() });
      setVideos((prev) => prev.map((v) => (v.id === id ? { ...v, surah_name: editingName.trim() } : v)));
      toast.success('تم تعديل اسم المشروع بنجاح');
      setEditingId(null);
    } catch (err) {
      console.error('Error renaming video:', err);
      toast.error('فشل تعديل اسم المشروع');
    } finally {
      setSavingRename(false);
    }
  };

  const handleDuplicate = async (id: string) => {
    setDuplicatingId(id);
    try {
      const duplicated = await api.videos.duplicate(id);
      setVideos((prev) => [duplicated as unknown as SavedVideo, ...prev]);
      toast.success('تم تكرار المشروع بنجاح');
    } catch (err) {
      console.error('Error duplicating video:', err);
      toast.error('فشل تكرار المشروع');
    } finally {
      setDuplicatingId(null);
    }
  };

  // Open the saved video in preview page to regenerate
  const handleOpenInPreview = (video: SavedVideo) => {
    const params = new URLSearchParams({
      surah: video.surah_number.toString(),
      reciter: video.reciter_id,
      start: video.start_ayah.toString(),
      end: video.end_ayah.toString(),
      backgroundType: video.background_type,
      ratio: video.aspect_ratio,
    });
    
    navigate(`/preview?${params.toString()}`);
  };

  // Re-create the video (open in preview)
  const handleRecreate = (video: SavedVideo) => {
    toast.info('جاري فتح المعاينة لإعادة إنشاء الفيديو...');
    handleOpenInPreview(video);
  };

  const handleDownload = async (video: SavedVideo) => {
    if (!video.video_url || downloadingId) return;

    setDownloadingId(video.id);
    try {
      await downloadSavedVideo(video.video_url, `quran_${video.surah_number || 'reel'}.mp4`);
      toast.success('تم بدء تحميل الفيديو بنجاح.');
    } catch (err: any) {
      console.error('Library video download error:', err);
      toast.error(err?.message || 'تعذر تحميل الفيديو، يرجى المحاولة مرة أخرى.');
    } finally {
      setDownloadingId(null);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('ar', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date);
  };

  if (authLoading || loading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-16 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-16">
          <ErrorState message={error} onRetry={fetchVideos} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8"
        >
          <div>
            <h1 className="text-3xl md:text-4xl font-bold mb-2 flex items-center gap-3">
              <LibraryIcon className="h-8 w-8 text-primary" />
              مكتبتي
            </h1>
            <p className="text-muted-foreground">
              {videos.length} فيديو محفوظ
            </p>
          </div>

          <Button asChild>
            <Link to="/create" className="gap-2">
              <Plus className="h-4 w-4" />
              إنشاء فيديو جديد
            </Link>
          </Button>
        </motion.div>

        {/* 48-Hour Retention Info Banner */}
        <div className="p-3.5 rounded-xl border border-primary/20 bg-primary/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-muted-foreground mb-6">
          <div className="flex items-center gap-2 text-foreground font-medium">
            <Clock className="h-4 w-4 text-primary shrink-0" />
            <span>مدة صلاحية تحميل ملفات الفيديو السحابية: <strong className="text-primary font-bold">48 ساعة (يومان)</strong> للحفاظ على مساحة وأداء السيرفر.</span>
          </div>
          <span className="text-[11px] text-muted-foreground">
            تظل تصاميمك وإعداداتك محفوظة دائماً، ويمكنك إعادة تصدير أي فيديو مجدداً في أي وقت.
          </span>
        </div>

        {/* Search and Sort */}
        {videos.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="flex flex-col sm:flex-row gap-4 mb-6"
          >
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                placeholder="ابحث بالسورة أو القارئ..."
                aria-label="ابحث بالسورة أو القارئ"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-10"
              />
            </div>

            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortType)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="ترتيب حسب" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="latest">الأحدث</SelectItem>
                <SelectItem value="oldest">الأقدم</SelectItem>
                <SelectItem value="surah">السورة</SelectItem>
                <SelectItem value="reciter">القارئ</SelectItem>
              </SelectContent>
            </Select>
          </motion.div>
        )}

        {/* Videos Grid */}
        {filteredVideos.length > 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {filteredVideos.map((video, index) => (
              <motion.div
                key={video.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className="overflow-hidden hover:shadow-lg transition-shadow">
                  {/* Thumbnail */}
                  <div className="relative aspect-video bg-gradient-to-br from-primary/20 to-quran-gold/20">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center">
                        <p className="text-2xl font-bold font-quran">{video.surah_name}</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          {video.reciter_name}
                        </p>
                      </div>
                    </div>
                    <div className="absolute top-2 left-2 bg-foreground/60 text-background text-xs px-2 py-1 rounded">
                      {video.aspect_ratio}
                    </div>
                    <Button
                      variant="secondary"
                      size="icon"
                      aria-label={`معاينة سورة ${video.surah_name}`}
                      className="absolute bottom-2 left-2 h-10 w-10 rounded-full"
                      onClick={() => handleOpenInPreview(video)}
                    >
                      <Play className="h-5 w-5" aria-hidden="true" />
                    </Button>
                  </div>

                  <CardContent className="p-4">
                    {/* Info with inline rename */}
                    <div className="mb-4">
                      {editingId === video.id ? (
                        <div className="flex items-center gap-1.5 mb-1">
                          <Input
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            className="h-8 text-sm font-bold"
                            autoFocus
                            disabled={savingRename}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-primary shrink-0"
                            onClick={() => handleSaveRename(video.id)}
                            disabled={savingRename}
                            aria-label="حفظ الاسم"
                          >
                            {savingRename ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground shrink-0"
                            onClick={() => setEditingId(null)}
                            aria-label="إلغاء التعديل"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-1">
                          <h3 className="font-bold text-lg truncate">{video.surah_name}</h3>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
                            onClick={() => { setEditingId(video.id); setEditingName(video.surah_name); }}
                            aria-label={`تعديل اسم مشروع ${video.surah_name}`}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                      <p className="text-sm text-muted-foreground">
                        الآيات {video.start_ayah} - {video.end_ayah}
                      </p>
                    </div>

                    {/* Engine badge & 48-Hour Retention Timer */}
                    <div className="flex flex-wrap items-center gap-1.5 mb-3">
                      {video.render_engine && (
                        <Badge variant="outline" className="text-[11px] py-0.5 border-primary/30 text-primary bg-primary/5">
                          {video.render_engine === 'ffmpeg_ass' ? '⚡ FFmpeg ASS' : video.render_engine === 'skia_canvas' ? '🎨 Skia Rust' : '🌐 Browser'}
                        </Badge>
                      )}

                      {(() => {
                        if (!video.expires_at) return null;
                        const diffMs = new Date(video.expires_at).getTime() - Date.now();
                        const remainingHours = Math.ceil(diffMs / (1000 * 60 * 60));

                        if (diffMs <= 0 || !video.video_url) {
                          return (
                            <Badge variant="destructive" className="text-[10px] py-0.5 bg-destructive/15 text-destructive border-destructive/20 gap-1 font-normal">
                              <AlertCircle className="h-3 w-3" />
                              انتهت صلاحية التحميل (48 ساعة)
                            </Badge>
                          );
                        }

                        if (remainingHours <= 12) {
                          return (
                            <Badge variant="outline" className="text-[10px] py-0.5 border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10 gap-1 font-normal">
                              <Clock className="h-3 w-3 text-amber-500 animate-pulse" />
                              متبقي {remainingHours} ساعة للتحميل
                            </Badge>
                          );
                        }

                        return (
                          <Badge variant="outline" className="text-[10px] py-0.5 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 gap-1 font-normal">
                            <Clock className="h-3 w-3 text-emerald-500" />
                            متاح للتحميل: {remainingHours} س متبقية
                          </Badge>
                        );
                      })()}
                    </div>

                    {/* Date */}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                      <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{formatDate(video.created_at)}</span>
                    </div>

                    {/* Direct MP4 Download Button (if ready and valid) */}
                    {video.video_url && (!video.expires_at || new Date(video.expires_at).getTime() > Date.now()) ? (
                      <Button
                        onClick={() => { void handleDownload(video); }}
                        disabled={downloadingId === video.id}
                        className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-sm mb-2 h-9"
                      >
                        {downloadingId === video.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        {downloadingId === video.id ? 'جاري تجهيز التحميل...' : 'تحميل الفيديو مباشرة (MP4)'}
                      </Button>
                    ) : video.expires_at && new Date(video.expires_at).getTime() <= Date.now() ? (
                      <Button
                        onClick={() => handleRecreate(video)}
                        variant="secondary"
                        className="w-full gap-2 text-xs mb-2 h-9 border border-border"
                      >
                        <RotateCcw className="h-4 w-4 text-primary" />
                        إعادة إنشاء وتحميل فوري
                      </Button>
                    ) : null}

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenInPreview(video)}
                        className="flex-1 gap-1 text-xs sm:text-sm px-2"
                      >
                        <ExternalLink className="h-4 w-4" aria-hidden="true" />
                        فتح
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRecreate(video)}
                        className="flex-1 gap-1 text-xs sm:text-sm px-2"
                      >
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        إعادة إنشاء
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={`تكرار مشروع ${video.surah_name}`}
                        onClick={() => handleDuplicate(video.id)}
                        disabled={duplicatingId === video.id}
                        title="تكرار المشروع"
                        className="shrink-0"
                      >
                        {duplicatingId === video.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={`حذف فيديو سورة ${video.surah_name}`}
                        onClick={() => handleDelete(video.id)}
                        className="text-destructive hover:text-destructive shrink-0"
                        title="حذف المشروع"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        ) : videos.length > 0 ? (
          /* No search results */
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-12"
          >
            <p className="text-muted-foreground text-lg">
              لم يتم العثور على نتائج للبحث "{searchQuery}"
            </p>
          </motion.div>
        ) : (
          /* Empty State */
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center py-16"
          >
            <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-muted mb-6">
              <Video className="h-10 w-10 text-muted-foreground" />
            </div>
            <h2 className="text-2xl font-bold mb-2">لا توجد فيديوهات بعد</h2>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              ابدأ بإنشاء أول مقطع قرآني لك وسيظهر هنا
            </p>
            <Button asChild size="lg">
              <Link to="/create" className="gap-2">
                <Plus className="h-5 w-5" />
                إنشاء فيديو جديد
              </Link>
            </Button>
          </motion.div>
        )}
      </div>
    </Layout>
  );
}
