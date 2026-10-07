import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Layout } from '@/components/Layout';
import { useAuth } from '@/hooks/useAuth';
import { api, SavedVideo, VideoComment } from '@/lib/api';
import { downloadSavedVideo } from '@/lib/download';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Heart, Share2, BookOpen, Loader2,
  MessageCircle, Send, User, Trash2, Reply, ArrowRight,
  Mic, Clock, Copy, Download, Zap, Sparkles, Clock3,
} from 'lucide-react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/ErrorState';

type Comment = VideoComment;

export default function VideoDetailPage() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const videoId = searchParams.get('id');

  const [video, setVideo] = useState<SavedVideo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [likesCount, setLikesCount] = useState(0);
  const [isLiked, setIsLiked] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [replyingTo, setReplyingTo] = useState<{ id: string; name: string } | null>(null);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const loadVideo = useCallback(async () => {
    if (!videoId) return;
    setLoading(true);
    setError(null);

    try {
      const [detail, commentsData] = await Promise.all([
        api.videos.getById(videoId),
        api.videos.getComments(videoId),
      ]);

      setVideo(detail.video);
      setLikesCount(detail.likesCount);
      setIsLiked(detail.isLiked);

      // Build threaded comments
      const commentMap = new Map<string, Comment>();
      const rootComments: Comment[] = [];
      const allComments: Comment[] = commentsData.map((c) => ({ ...c, replies: [] }));

      allComments.forEach((c) => commentMap.set(c.id, c));
      allComments.forEach((c) => {
        if (c.parent_id && commentMap.has(c.parent_id)) {
          commentMap.get(c.parent_id)!.replies!.push(c);
        } else {
          rootComments.push(c);
        }
      });

      setComments(rootComments);
    } catch (e) {
      console.error('Load video error:', e);
      setError('تعذر تحميل تفاصيل الفيديو. يرجى التحقق من اتصالك والمحاولة مرة أخرى.');
    } finally {
      setLoading(false);
    }
  }, [videoId]);

  useEffect(() => {
    if (videoId) {
      loadVideo();
    }
  }, [videoId, loadVideo]);

  const toggleLike = async () => {
    if (!isAuthenticated || !user || !videoId) {
      toast.error('سجل دخول أولاً');
      return;
    }
    try {
      const res = await api.videos.toggleLike(videoId);
      setIsLiked(res.isLiked);
      setLikesCount(res.likesCount);
    } catch {
      toast.error('فشل تحديث الإعجاب');
    }
  };

  const handleDownload = async () => {
    if (!video?.video_url || isDownloading) return;

    setIsDownloading(true);
    try {
      await downloadSavedVideo(video.video_url, `quran_${video.surah_number || 'reel'}.mp4`);
      toast.success('تم بدء تحميل الفيديو بنجاح.');
    } catch (err: any) {
      console.error('Video detail download error:', err);
      toast.error(err?.message || 'تعذر تحميل الفيديو، يرجى المحاولة مرة أخرى.');
    } finally {
      setIsDownloading(false);
    }
  };

  const submitComment = async () => {
    if (!isAuthenticated || !user || !videoId) {
      toast.error('سجل دخول أولاً');
      return;
    }
    if (!commentText.trim()) return;
    setSubmittingComment(true);

    try {
      const newComment = await api.videos.addComment(videoId, commentText.trim(), replyingTo?.id || null);
      if (replyingTo) {
        setComments((prev) =>
          prev.map((c) => (c.id === replyingTo.id ? { ...c, replies: [...(c.replies || []), newComment] } : c))
        );
      } else {
        setComments((prev) => [...prev, { ...newComment, replies: [] }]);
      }
      setCommentText('');
      setReplyingTo(null);
    } catch {
      toast.error('فشل إضافة التعليق');
    } finally {
      setSubmittingComment(false);
    }
  };

  const deleteComment = async (commentId: string) => {
    if (!videoId) return;
    try {
      await api.videos.deleteComment(videoId, commentId);
      setComments((prev) =>
        prev
          .filter((c) => c.id !== commentId)
          .map((c) => ({ ...c, replies: (c.replies || []).filter((r) => r.id !== commentId) }))
      );
    } catch {
      toast.error('فشل حذف التعليق');
    }
  };

  const shareVideo = () => {
    const url = `${window.location.origin}/video?id=${videoId}`;
    const text = video ? `🎬 ${video.surah_name} | القارئ: ${video.reciter_name}` : '';
    if (navigator.share) {
      navigator.share({ title: 'AyahX', text, url });
    } else {
      navigator.clipboard.writeText(url);
      toast.success('تم نسخ رابط الفيديو');
    }
  };

  const copyLink = () => {
    const url = `${window.location.origin}/video?id=${videoId}`;
    navigator.clipboard.writeText(url);
    toast.success('تم نسخ الرابط');
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

  if (loading || authLoading) {
    return <Layout><div className="flex justify-center items-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></Layout>;
  }

  if (error) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-16">
          <ErrorState message={error} onRetry={loadVideo} />
        </div>
      </Layout>
    );
  }

  if (!video) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-20 text-center">
          <BookOpen className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">الفيديو غير موجود</h2>
          <p className="text-muted-foreground mb-4">قد يكون تم حذفه أو أنه غير عام</p>
          <Button asChild><Link to="/discover">العودة للاكتشاف</Link></Button>
        </div>
      </Layout>
    );
  }

  const totalComments = comments.reduce((sum, c) => sum + 1 + (c.replies?.length || 0), 0);

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        {/* Back link */}
        <Button asChild variant="ghost" size="sm" className="mb-4 gap-1">
          <Link to="/discover">
            <ArrowRight className="h-4 w-4" />
            العودة للاكتشاف
          </Link>
        </Button>

        {/* Video Info Card */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="overflow-hidden mb-6">
            {/* Header */}
            <div className="bg-gradient-to-br from-primary/10 to-accent/10 p-8 text-center">
              <BookOpen className="h-14 w-14 text-primary mx-auto mb-3" />
              <h1 className="text-2xl font-bold">{video.surah_name}</h1>
              <p className="text-muted-foreground mt-1">آية {video.start_ayah} - {video.end_ayah}</p>
            </div>

            <CardContent className="p-6">
              {/* Creator info */}
              <Link to={`/profile?id=${video.user_id}`} className="flex items-center gap-3 mb-5 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center overflow-hidden">
                  {video.avatar_url ? (
                    <img src={video.avatar_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <User className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <p className="font-medium">{video.display_name || 'مستخدم'}</p>
                  {(video as any).bio && <p className="text-xs text-muted-foreground line-clamp-1">{(video as any).bio}</p>}
                </div>
              </Link>

              {/* Meta */}
              <div className="flex items-center gap-3 mb-5 flex-wrap">
                <div className="flex items-center gap-1.5 text-sm">
                  <Mic className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{video.reciter_name}</span>
                </div>
                <Badge variant="secondary">{video.aspect_ratio}</Badge>
                <Badge variant="outline">{video.background_type}</Badge>
                {(video as any).render_engine === 'ffmpeg_ass' && (
                  <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-xs">
                    ⚡ FFmpeg ASS (صاروخي)
                  </Badge>
                )}
                {(video as any).render_engine === 'skia_canvas' && (
                  <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20 text-xs">
                    الإنتاج السحابي — Skia
                  </Badge>
                )}
                {(video as any).render_engine === 'browser_cloud' && (
                  <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">
                    🌐 Browser Cloud (كامل)
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {timeAgo(video.created_at)}
                </span>
              </div>

              {/* 48-Hour Retention Countdown & Download */}
              {(() => {
                const hasExpiry = Boolean((video as any).expires_at);
                const remainingHours = hasExpiry
                  ? Math.max(0, Math.ceil((new Date((video as any).expires_at).getTime() - Date.now()) / (1000 * 60 * 60)))
                  : null;
                const isExpired = hasExpiry && (remainingHours === 0 || !video.video_url);

                return (
                  <div className="mb-4">
                    {hasExpiry && (
                      <div className="p-3 rounded-lg border flex items-center justify-between text-xs bg-muted/40 mb-3">
                        <div className="flex items-center gap-2">
                          <Clock3 className={`h-4 w-4 ${isExpired ? 'text-destructive' : 'text-primary'}`} />
                          <span>
                            {isExpired
                              ? 'انتهت صلاحية التحميل المباشر (48 ساعة)'
                              : `متاح للتحميل بالمكتبة: متبقي ${remainingHours} ساعة`}
                          </span>
                        </div>
                        <Badge variant={isExpired ? 'destructive' : 'secondary'} className="text-[10px]">
                          {isExpired ? 'منتهي الصلاحية' : 'صالح 48 ساعة'}
                        </Badge>
                      </div>
                    )}
                    {video.video_url && !isExpired && (
                      <Button onClick={() => { void handleDownload(); }} disabled={isDownloading} className="w-full gap-2 gradient-primary text-primary-foreground font-semibold">
                        {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        {isDownloading ? 'جاري تجهيز التحميل...' : 'تحميل الفيديو مباشرة (MP4)'}
                      </Button>
                    )}
                  </div>
                );
              })()}

              {/* Actions */}
              <div className="flex gap-3 mb-2">
                <Button
                  variant={isLiked ? 'default' : 'outline'}
                  onClick={toggleLike}
                  className="gap-2 flex-1"
                >
                  <Heart className={`h-5 w-5 ${isLiked ? 'fill-current' : ''}`} />
                  {likesCount} إعجاب
                </Button>
                <Button variant="outline" onClick={shareVideo} className="gap-2 flex-1">
                  <Share2 className="h-5 w-5" />
                  مشاركة
                </Button>
                <Button variant="outline" size="icon" aria-label="نسخ رابط الفيديو" onClick={copyLink}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Comments Section */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card>
            <CardContent className="p-6">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-primary" />
                التعليقات ({totalComments})
              </h2>

              {/* Comment Input */}
              {isAuthenticated ? (
                <div className="mb-6">
                  {replyingTo && (
                    <div className="flex items-center gap-2 text-xs text-primary mb-2 bg-primary/5 rounded p-2">
                      <Reply className="h-3 w-3" />
                      <span>رد على {replyingTo.name}</span>
                      <button onClick={() => setReplyingTo(null)} aria-label="إلغاء الرد" className="text-muted-foreground hover:text-foreground mr-auto">✕</button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Input
                      placeholder={replyingTo ? `رد على ${replyingTo.name}...` : 'اكتب تعليقاً...'}
                      aria-label={replyingTo ? `رد على ${replyingTo.name}` : 'اكتب تعليقاً'}
                      value={commentText}
                      onChange={e => setCommentText(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && submitComment()}
                      className="text-sm"
                    />
                    <Button onClick={submitComment} disabled={submittingComment || !commentText.trim()} className="gap-1">
                      <Send className="h-4 w-4" />
                      إرسال
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 mb-4 bg-muted/30 rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    <Link to="/auth" className="text-primary hover:underline font-medium">سجل دخول</Link> لإضافة تعليق
                  </p>
                </div>
              )}

              {/* Comments List */}
              <div className="space-y-4">
                {comments.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">لا توجد تعليقات بعد. كن أول من يعلق!</p>
                ) : comments.map(c => (
                  <div key={c.id} className="space-y-3">
                    {/* Root comment */}
                    <div className="flex items-start gap-3">
                      <Link to={`/profile?id=${c.user_id}`} aria-label={`الملف الشخصي لـ ${c.display_name || 'مستخدم'}`}>
                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
                          {c.avatar_url ? (
                            <img src={c.avatar_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <User className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      </Link>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Link to={`/profile?id=${c.user_id}`} className="font-medium text-sm hover:text-primary transition-colors">
                            {c.display_name || 'مستخدم'}
                          </Link>
                          <span className="text-xs text-muted-foreground">{timeAgo(c.created_at)}</span>
                        </div>
                        <p className="text-sm text-foreground mt-1">{c.content}</p>
                        <button
                          onClick={() => setReplyingTo({ id: c.id, name: c.display_name || 'مستخدم' })}
                          className="text-xs text-primary hover:underline mt-1 flex items-center gap-1"
                        >
                          <Reply className="h-3 w-3" />
                          رد
                        </button>
                      </div>
                      {c.user_id === user?.id && (
                        <Button variant="ghost" size="icon" aria-label="حذف التعليق" className="h-7 w-7 shrink-0" onClick={() => deleteComment(c.id)}>
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      )}
                    </div>

                    {/* Replies */}
                    {(c.replies || []).map(r => (
                      <div key={r.id} className="flex items-start gap-3 mr-8 border-r-2 border-primary/20 pr-3">
                        <Link to={`/profile?id=${r.user_id}`} aria-label={`الملف الشخصي لـ ${r.display_name || 'مستخدم'}`}>
                          <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
                            {r.avatar_url ? (
                              <img src={r.avatar_url} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <User className="h-3 w-3 text-muted-foreground" />
                            )}
                          </div>
                        </Link>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Link to={`/profile?id=${r.user_id}`} className="font-medium text-xs hover:text-primary transition-colors">
                              {r.display_name || 'مستخدم'}
                            </Link>
                            <span className="text-[10px] text-muted-foreground">{timeAgo(r.created_at)}</span>
                          </div>
                          <p className="text-xs text-foreground mt-0.5">{r.content}</p>
                        </div>
                        {r.user_id === user?.id && (
                          <Button variant="ghost" size="icon" aria-label="حذف الرد" className="h-6 w-6 shrink-0" onClick={() => deleteComment(r.id)}>
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </Layout>
  );
}
