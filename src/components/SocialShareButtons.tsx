import { useState, useEffect } from 'react';
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
  const activeBlob = mp4Blob || (videoBlob?.type.includes('mp4') ? videoBlob : null);
  const [caption, setCaption] = useState(text + '\n\n#قرآن_كريم #تلاوة #quran');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setCaption(text + '\n\n#قرآن_كريم #تلاوة #quran'); }, [text]);
  const download = () => {
    if (!activeBlob) return;
    const url = URL.createObjectURL(activeBlob);
    const a = document.createElement('a');
    a.href = url; a.download = filename.replace(/\.[^.]+$/, '') + '.mp4';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  };
  const share = async (platform: string) => {
    if (!activeBlob || busy) return;
    setBusy(true);
    try {
      const file = new File([activeBlob], filename.replace(/\.[^.]+$/, '') + '.mp4', { type: 'video/mp4' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title, text: caption, files: [file] });
        toast.success('تم إرسال الفيديو إلى تطبيق المشاركة');
      } else {
        download();
        toast.info('تم تحميل MP4. افتح ' + platform + ' وارفع الفيديو، ثم الصق وصف المشاركة.', { duration: 6000 });
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') toast.error('تعذرت المشاركة. استخدم تحميل MP4 ونسخ الوصف.');
    } finally { setBusy(false); }
  };
  return <div className="space-y-3 rounded-xl border border-border/60 p-3">
    <div className="flex items-center gap-2 text-sm font-semibold"><Share2 className="h-4 w-4 text-primary" />تجهيز المشاركة على المنصات</div>
    <label className="block space-y-2 text-xs text-muted-foreground">وصف المشاركة والوسوم
      <textarea aria-label="وصف المشاركة والوسوم" maxLength={2200} rows={3} value={caption} onChange={e => setCaption(e.target.value)} className="w-full resize-y rounded-lg border bg-background p-2 text-sm" />
    </label>
    <div className="grid grid-cols-2 gap-2">
      <Button size="sm" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(caption); toast.success('تم نسخ الوصف'); } catch { toast.error('تعذر النسخ. حدد الوصف وانسخه يدوياً.'); } }}><Copy className="h-4 w-4 ml-2" />نسخ الوصف</Button>
      <Button size="sm" variant="outline" disabled={!activeBlob || busy} onClick={download}><Download className="h-4 w-4 ml-2" />تحميل MP4</Button>
    </div>
    <div className="grid grid-cols-5 gap-2">
      {[
        { name: 'Instagram', Icon: Instagram }, { name: 'TikTok', Icon: TikTokIcon },
        { name: 'Facebook', Icon: Facebook }, { name: 'WhatsApp', Icon: WhatsAppIcon }, { name: 'المزيد', Icon: Share2 },
      ].map(({ name, Icon }) => <Button key={name} size="sm" variant="outline" className="h-auto flex-col gap-1 px-1 py-2" disabled={!activeBlob || busy} onClick={() => void share(name)}><Icon className="h-4 w-4" /><span className="text-[9px]">{name}</span></Button>)}
    </div>
    <p className="text-[11px] leading-relaxed text-muted-foreground">على الأجهزة الداعمة تظهر نافذة المشاركة؛ اختر التطبيق المطلوب. على الكمبيوتر حمّل الفيديو وانشره من التطبيق. لا يتم النشر تلقائياً.</p>
    {!activeBlob && <p className="text-xs text-amber-500">تتاح مشاركة الملف بعد اكتمال تجهيز MP4.</p>}
  </div>;
}
