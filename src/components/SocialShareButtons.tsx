import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Share2, Instagram, Facebook, Copy, Download } from 'lucide-react';

interface SocialShareButtonsProps {
  videoBlob: Blob | null;
  mp4Blob?: Blob | null;
  title: string;
  text: string;
  filename: string;
}

// TikTok icon component
const TikTokIcon = ({ className }: { className?: string }) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="currentColor" 
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/>
  </svg>
);

// WhatsApp icon
const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

export function SocialShareButtons({ videoBlob, mp4Blob, title, text, filename }: SocialShareButtonsProps) {
  const shareToSocial = async (platform: 'instagram' | 'facebook' | 'tiktok' | 'whatsapp' | 'native') => {
    const activeBlob = mp4Blob || videoBlob;
    if (!activeBlob) {
      toast.error('لا يوجد فيديو للمشاركة');
      return;
    }

    // Determine accurate MIME type and extension
    const mimeType = activeBlob.type || (mp4Blob ? 'video/mp4' : 'video/webm');
    const ext = mimeType.includes('mp4') ? '.mp4' : '.webm';
    const shareFilename = filename.replace(/\.[^/.]+$/, ext);
    const file = new File([activeBlob], shareFilename, { type: mimeType });
    const navAny = navigator as Navigator & { canShare?: (data: ShareData) => boolean };

    // WhatsApp sharing
    if (platform === 'whatsapp') {
      if (navigator.share && navAny.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            title,
            text: `${text}\n\n#قرآن_كريم #quran`,
            files: [file],
          });
          toast.success('تمت المشاركة بنجاح!');
          return;
        } catch (e) {
          if ((e as Error).name === 'AbortError') return;
        }
      }
      // Fallback - download and suggest
      downloadFile(activeBlob, shareFilename);
      toast.info('تم تحميل الفيديو. أرسله عبر واتساب');
      return;
    }

    // For Instagram, TikTok, Facebook - use native share to send file
    if (navigator.share && navAny.canShare?.({ files: [file] })) {
      try {
        const hashtags = '#قرآن_كريم #quran #islamic #reels #تلاوة';
        await navigator.share({
          title,
          text: `${text}\n\n${hashtags}`,
          files: [file],
        });
        toast.success('تمت المشاركة بنجاح!');
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        console.error('Share failed:', e);
      }
    }
    
    // Fallback: download the file so user can upload manually
    downloadFile(activeBlob, shareFilename);
    
    const platformMessages: Record<string, string> = {
      instagram: '📱 تم تحميل الفيديو. افتح Instagram → أنشئ Reel جديد → اختر الفيديو المحمّل',
      tiktok: '📱 تم تحميل الفيديو. افتح TikTok → اضغط + → اختر الفيديو المحمّل',
      facebook: '📱 تم تحميل الفيديو. افتح Facebook → أنشئ Reel → اختر الفيديو المحمّل',
      native: '📱 تم تحميل الفيديو',
    };
    
    toast.info(platformMessages[platform] || platformMessages.native, { duration: 6000 });
  };

  const downloadFile = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const copyVideoToClipboard = async () => {
    if (!videoBlob) return;
    try {
      // Copy as file to clipboard if supported
      const file = new File([videoBlob], filename, { type: videoBlob.type });
      if (navigator.clipboard && 'write' in navigator.clipboard) {
        await (navigator.clipboard as any).write([
          new ClipboardItem({ [videoBlob.type]: videoBlob })
        ]);
        toast.success('تم نسخ الفيديو للحافظة');
        return;
      }
    } catch {
      // Clipboard write failed or is unsupported; fallback to download
    }
    // Fallback: download
    downloadFile(videoBlob, filename);
    toast.info('تم تحميل الفيديو');
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground text-center">مشاركة مباشرة على:</p>
      <div className="grid grid-cols-5 gap-2">
        {/* Instagram Reels */}
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => { e.stopPropagation(); shareToSocial('instagram'); }}
          disabled={!videoBlob}
          className="flex flex-col items-center gap-1 h-auto py-2 bg-gradient-to-br from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white border-0"
        >
          <Instagram className="h-5 w-5" />
          <span className="text-[10px]">Reels</span>
        </Button>

        {/* TikTok */}
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => { e.stopPropagation(); shareToSocial('tiktok'); }}
          disabled={!videoBlob}
          className="flex flex-col items-center gap-1 h-auto py-2 bg-black hover:bg-gray-900 text-white border-0"
        >
          <TikTokIcon className="h-5 w-5" />
          <span className="text-[10px]">TikTok</span>
        </Button>

        {/* Facebook Reels */}
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => { e.stopPropagation(); shareToSocial('facebook'); }}
          disabled={!videoBlob}
          className="flex flex-col items-center gap-1 h-auto py-2 bg-blue-600 hover:bg-blue-700 text-white border-0"
        >
          <Facebook className="h-5 w-5" />
          <span className="text-[10px]">Reels</span>
        </Button>

        {/* WhatsApp */}
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => { e.stopPropagation(); shareToSocial('whatsapp'); }}
          disabled={!videoBlob}
          className="flex flex-col items-center gap-1 h-auto py-2 bg-green-600 hover:bg-green-700 text-white border-0"
        >
          <WhatsAppIcon className="h-4 w-4" />
          <span className="text-[10px]">واتساب</span>
        </Button>

        {/* Native Share */}
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => { e.stopPropagation(); shareToSocial('native'); }}
          disabled={!videoBlob}
          className="flex flex-col items-center gap-1 h-auto py-2"
        >
          <Share2 className="h-5 w-5" />
          <span className="text-[10px]">المزيد</span>
        </Button>
      </div>
      
      <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
        💡 على الهاتف: يتم فتح نافذة المشاركة مباشرة مع الفيديو. اختر التطبيق وانشر
      </p>
    </div>
  );
}
