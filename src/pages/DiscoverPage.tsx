import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Compass, Heart, Share2, Video, Mic, BookOpen, Loader2,
  MessageCircle, Send, User, Trash2, Reply,
} from 'lucide-react';
import { toast } from 'sonner';
import { AdvancedSearchBar, SearchFilters, defaultFilters, getDateFilterTimestamp } from '@/components/AdvancedSearchBar';
import { Input } from '@/components/ui/input';
import { ErrorState } from '@/components/ErrorState';

interface PublicVideo {
  id: string;
  surah_name: string;
  surah_number: number;
  start_ayah: number;
  end_ayah: number;
  reciter_name: string;
  reciter_id: string;
  background_type: string;
  aspect_ratio: string;
  created_at: string;
  user_id: string;
  likes_count: number;
  is_liked: boolean;
  comments_count: number;
}

interface Comment {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  display_name: string | null;
  parent_id: string | null;
  replies?: Comment[];
}

export default function DiscoverPage() {
  const { user, isAuthenticated } = useAuth();
  const [videos, setVideos] = useState<PublicVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<SearchFilters>(defaultFilters);
  const [expandedComments, setExpandedComments] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [replyingTo, setReplyingTo] = useState<{ id: string; name: string } | null>(null);
  const [loadingComments, setLoadingComments] = useState(false);
  const [submittingComment, setSubmittingComment] = useState(false);

  const fetchVideos = async () => {
    setLoading(true);
    setError(null);
    try {
      const publicVideos = await api.videos.getPublic();
      const mapped: PublicVideo[] = (publicVideos || []).map((v: any) => ({
        ...v,
        likes_count: Number(v.likes_count || 0),
        is_liked: Boolean(v.is_liked),
        comments_count: Number(v.comments_count || 0),
      }));
      setVideos(mapped);
    } catch (err) {
      console.error('Fetch videos error:', err);
      setError('تعذر تحميل الفيديوهات. يرجى التحقق من اتصالك والمحاولة مرة أخرى.');
      toast.error('حدث خطأ في تحميل الفيديوهات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchVideos(); }, [user]);

  // Apply filters and sorting
  const filteredVideos = useMemo(() => {
    let result = [...videos];

    // Text search
    if (filters.query.trim()) {
      const q = filters.query.toLowerCase();
      result = result.filter(v => 
        v.surah_name.toLowerCase().includes(q) || 
        v.reciter_name.toLowerCase().includes(q)
      );
    }

    // Reciter filter
    if (filters.reciterId !== 'all') {
      result = result.filter(v => v.reciter_id === filters.reciterId);
    }

    // Surah filter
    if (filters.surahNumber !== 'all') {
      result = result.filter(v => v.surah_number === Number(filters.surahNumber));
    }

    // Date filter
    const dateTimestamp = getDateFilterTimestamp(filters.dateFilter);
    if (dateTimestamp) {
      result = result.filter(v => new Date(v.created_at) >= new Date(dateTimestamp));
    }

    // Sorting
    switch (filters.sortBy) {
      case 'popular':
        result.sort((a, b) => b.likes_count - a.likes_count);
        break;
      case 'oldest':
        result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        break;
      case 'latest':
      default:
        result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    return result;
  }, [videos, filters]);

  const toggleLike = async (videoId: string) => {
    if (!isAuthenticated || !user) { toast.error('سجل دخول أولاً'); return; }
    try {
      const res = await api.videos.toggleLike(videoId);
      setVideos(prev => prev.map(v => v.id === videoId ? { ...v, is_liked: res.isLiked, likes_count: res.likesCount } : v));
    } catch {
      toast.error('حدث خطأ في الإعجاب');
    }
  };

  const loadComments = async (videoId: string) => {
    if (expandedComments === videoId) { setExpandedComments(null); return; }
    setExpandedComments(videoId);
    setLoadingComments(true);
    setCommentText('');
    setReplyingTo(null);

    try {
      const data = await api.videos.getComments(videoId);
      const allComments = (data || []).map((c: any) => ({
        ...c,
        display_name: c.display_name || null,
        replies: [] as Comment[],
      }));

      const rootComments: Comment[] = [];
      const commentMap = new Map<string, Comment>();
      allComments.forEach(c => commentMap.set(c.id, c));
      allComments.forEach(c => {
        if (c.parent_id && commentMap.has(c.parent_id)) {
          commentMap.get(c.parent_id)!.replies = commentMap.get(c.parent_id)!.replies || [];
          commentMap.get(c.parent_id)!.replies!.push(c);
        } else {
          rootComments.push(c);
        }
      });

      setComments(rootComments);
    } catch (err) {
      console.error(err);
      toast.error('فشل تحميل التعليقات');
    } finally {
      setLoadingComments(false);
    }
  };

  const submitComment = async (videoId: string) => {
    if (!isAuthenticated || !user) { toast.error('سجل دخول أولاً'); return; }
    if (!commentText.trim()) return;
    setSubmittingComment(true);

    try {
      const data = await api.videos.addComment(videoId, commentText.trim(), replyingTo ? replyingTo.id : undefined);
      const newComment: Comment = { ...(data as any), display_name: (data as any).display_name || user.email, replies: [] };

      if (replyingTo) {
        setComments(prev => prev.map(c => c.id === replyingTo.id ? { ...c, replies: [...(c.replies || []), newComment] } : c));
      } else {
        setComments(prev => [...prev, newComment]);
      }
      setCommentText('');
      setReplyingTo(null);
      setVideos(prev => prev.map(v => v.id === videoId ? { ...v, comments_count: v.comments_count + 1 } : v));
    } catch (err) {
      console.error(err);
      toast.error('فشل إرسال التعليق');
    } finally {
      setSubmittingComment(false);
    }
  };

  const deleteComment = async (commentId: string, videoId: string) => {
    try {
      await api.videos.deleteComment(videoId, commentId);
      setComments(prev => prev.filter(c => c.id !== commentId).map(c => ({ ...c, replies: (c.replies || []).filter(r => r.id !== commentId) })));
      setVideos(prev => prev.map(v => v.id === videoId ? { ...v, comments_count: Math.max(0, v.comments_count - 1) } : v));
      toast.success('تم حذف التعليق');
    } catch {
      toast.error('فشل حذف التعليق');
    }
  };

  const shareVideo = (video: PublicVideo) => {
    const text = `🎬 ${video.surah_name} | القارئ: ${video.reciter_name} | آيات ${video.start_ayah}-${video.end_ayah}`;
    if (navigator.share) {
      navigator.share({ title: 'AyahX', text, url: window.location.origin });
    } else {
      navigator.clipboard.writeText(text);
      toast.success('تم نسخ معلومات الفيديو');
    }
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `منذ ${mins} دقيقة`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `منذ ${hours} ساعة`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `منذ ${days} يوم`;
    return `منذ ${Math.floor(days / 30)} شهر`;
  };

  const renderComment = (c: Comment, videoId: string, isReply = false) => (
    <div key={c.id} className={`flex items-start gap-2 text-sm ${isReply ? 'mr-6 border-r-2 border-primary/20 pr-2' : ''}`}>
      <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0">
        <User className="h-3 w-3 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link to={`/profile?id=${c.user_id}`} className="font-medium text-xs hover:text-primary transition-colors">
            {c.display_name || 'مستخدم'}
          </Link>
          <span className="text-[10px] text-muted-foreground">{timeAgo(c.created_at)}</span>
        </div>
        <p className="text-xs text-foreground mt-0.5">{c.content}</p>
        {!isReply && (
          <button
            onClick={() => setReplyingTo({ id: c.id, name: c.display_name || 'مستخدم' })}
            className="text-[10px] text-primary hover:underline mt-0.5 flex items-center gap-0.5"
          >
            <Reply className="h-3 w-3" />
            رد
          </button>
        )}
      </div>
      {c.user_id === user?.id && (
        <Button variant="ghost" size="icon" aria-label="حذف التعليق" className="h-6 w-6 shrink-0" onClick={() => deleteComment(c.id, videoId)}>
          <Trash2 className="h-3 w-3 text-destructive" />
        </Button>
      )}
    </div>
  );

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Compass className="h-8 w-8 text-primary" />
            اكتشف
          </h1>
          <p className="text-muted-foreground mt-1">استعرض أحدث وأشهر الفيديوهات من المجتمع</p>
        </motion.div>

        {/* Advanced Search Bar */}
        <div className="mb-6">
          <AdvancedSearchBar
            filters={filters}
            onFiltersChange={setFilters}
            placeholder="ابحث بالسورة أو القارئ..."
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : error ? (
          <ErrorState message={error} onRetry={fetchVideos} />
        ) : filteredVideos.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Video className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-medium mb-2">{filters.query ? 'لا توجد نتائج' : 'لا توجد فيديوهات عامة بعد'}</p>
              <p className="text-sm text-muted-foreground">{filters.query ? 'جرب كلمات بحث مختلفة' : 'كن أول من يشارك فيديو مع المجتمع!'}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredVideos.map((video, i) => (
              <motion.div key={video.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card className="overflow-hidden hover:shadow-lg transition-shadow">
                  <Link to={`/video?id=${video.id}`} className="block">
                    <div className="bg-gradient-to-br from-primary/10 to-accent/10 p-6 text-center">
                      <BookOpen className="h-10 w-10 text-primary mx-auto mb-2" />
                      <h3 className="font-bold text-lg">{video.surah_name}</h3>
                      <p className="text-sm text-muted-foreground">آية {video.start_ayah} - {video.end_ayah}</p>
                    </div>
                  </Link>

                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Mic className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{video.reciter_name}</span>
                      </div>
                      <Link to={`/profile?id=${video.user_id}`} className="text-xs text-primary hover:underline flex items-center gap-1">
                        <User className="h-3 w-3" />
                        الملف
                      </Link>
                    </div>

                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <Badge variant="secondary" className="text-xs">{video.aspect_ratio}</Badge>
                      <span className="text-xs text-muted-foreground">{timeAgo(video.created_at)}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button size="sm" variant={video.is_liked ? 'default' : 'outline'} onClick={() => toggleLike(video.id)} className="gap-1 flex-1">
                        <Heart className={`h-4 w-4 ${video.is_liked ? 'fill-current' : ''}`} />
                        {video.likes_count}
                      </Button>
                      <Button size="sm" variant={expandedComments === video.id ? 'default' : 'outline'} onClick={() => loadComments(video.id)} className="gap-1 flex-1">
                        <MessageCircle className="h-4 w-4" />
                        {video.comments_count}
                      </Button>
                      <Button size="sm" variant="outline" aria-label="مشاركة الفيديو" onClick={() => shareVideo(video)}>
                        <Share2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Comments Section */}
                    <AnimatePresence>
                      {expandedComments === video.id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden mt-4 border-t border-border pt-3"
                        >
                          {loadingComments ? (
                            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
                          ) : (
                            <>
                              <div className="space-y-3 max-h-60 overflow-y-auto mb-3">
                                {comments.length === 0 ? (
                                  <p className="text-xs text-muted-foreground text-center py-2">لا توجد تعليقات بعد</p>
                                ) : comments.map(c => (
                                  <div key={c.id} className="space-y-2">
                                    {renderComment(c, video.id)}
                                    {(c.replies || []).map(r => renderComment(r, video.id, true))}
                                  </div>
                                ))}
                              </div>

                              {/* Reply indicator */}
                              {replyingTo && (
                                <div className="flex items-center gap-2 text-xs text-primary mb-2 bg-primary/5 rounded p-1.5">
                                  <Reply className="h-3 w-3" />
                                  <span>رد على {replyingTo.name}</span>
                                  <button onClick={() => setReplyingTo(null)} aria-label="إلغاء الرد" className="text-muted-foreground hover:text-foreground mr-auto">✕</button>
                                </div>
                              )}

                              {isAuthenticated ? (
                                <div className="flex gap-2">
                                  <Input
                                    placeholder={replyingTo ? `رد على ${replyingTo.name}...` : 'أضف تعليقاً...'}
                                    aria-label={replyingTo ? `رد على ${replyingTo.name}` : 'أضف تعليقاً'}
                                    value={commentText}
                                    onChange={e => setCommentText(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && submitComment(video.id)}
                                    className="text-sm h-8"
                                  />
                                  <Button size="icon" aria-label="إرسال التعليق" className="h-8 w-8 shrink-0" onClick={() => submitComment(video.id)} disabled={submittingComment || !commentText.trim()}>
                                    <Send className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ) : (
                                <p className="text-xs text-center text-muted-foreground">
                                  <Link to="/auth" className="text-primary hover:underline">سجل دخول</Link> للتعليق
                                </p>
                              )}
                            </>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
