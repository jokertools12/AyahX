import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Upload, X, Image as ImageIcon, Video, Check } from 'lucide-react';
import { useState, useRef, useMemo, useEffect } from 'react';

interface CustomBackgroundUploaderProps {
  onUpload: (url: string, type?: 'image' | 'video') => void;
  currentBackground?: string | null;
  currentBackgroundType?: 'image' | 'video';
}

// Store video blobs globally so they persist across navigation
(window as any).__customBgBlobs = (window as any).__customBgBlobs || {};

export function CustomBackgroundUploader({ onUpload, currentBackground, currentBackgroundType }: CustomBackgroundUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);

    try {
      const isVideo = file.type.startsWith('video/');
      const isImage = file.type.startsWith('image/');
      
      if (!isVideo && !isImage) {
        alert('الرجاء اختيار ملف صورة أو فيديو');
        return;
      }

      if (isImage) {
        // Convert image to data URL (persists across navigation)
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          onUpload(dataUrl, 'image');
        };
        reader.readAsDataURL(file);
      } else {
        // For video: revoke previous blob URL and cap global retention to prevent memory bloat
        const previousBlobUrl = sessionStorage.getItem('customBgVideoBlobUrl');
        if (previousBlobUrl) {
          try {
            URL.revokeObjectURL(previousBlobUrl);
          } catch (_err) {
            // Ignore revoke errors on already-released or invalid blob URLs
          }
        }

        const bgBlobs = (window as any).__customBgBlobs || {};
        const blobKeys = Object.keys(bgBlobs);
        if (blobKeys.length >= 2) {
          delete bgBlobs[blobKeys[0]];
        }

        const blobUrl = URL.createObjectURL(file);
        const key = `custom_bg_video_${Date.now()}`;
        bgBlobs[key] = file;
        (window as any).__customBgBlobs = bgBlobs;

        // Keep the key for compatibility with an already-open flow, but pass
        // the usable object URL to the parent. Passing the key directly made
        // an immediately selected premium video resolve as a broken relative
        // URL in the preview canvas.
        sessionStorage.setItem('customBgVideoKey', key);
        sessionStorage.setItem('customBgVideoBlobUrl', blobUrl);
        onUpload(blobUrl, 'video');
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      alert('حدث خطأ في رفع الملف');
    } finally {
      setIsUploading(false);
    }
  };

  const isVideo = currentBackgroundType === 'video';
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!currentBackground) {
      setDisplayUrl(null);
      return;
    }
    const blob = (window as Window & { __customBgBlobs?: Record<string, Blob> }).__customBgBlobs?.[currentBackground];
    if (blob) {
      const url = URL.createObjectURL(blob);
      setDisplayUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    }
    setDisplayUrl(currentBackground);
  }, [currentBackground]);

  return (
    <div className="space-y-4">
      {currentBackground ? (
        <div className="relative">
          <div className="aspect-video rounded-lg overflow-hidden bg-muted border-2 border-primary ring-2 ring-primary/30">
            {isVideo ? (
              <video 
                src={displayUrl || ''} 
                className="w-full h-full object-cover"
                muted
                loop
                autoPlay
                playsInline
              />
            ) : (
              <img 
                src={displayUrl || ''}
                alt="خلفية مخصصة"
                className="w-full h-full object-cover"
              />
            )}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
            <div className="absolute top-2 left-2 p-1 rounded-full bg-primary text-primary-foreground">
              <Check className="h-4 w-4" />
            </div>
            <div className="absolute bottom-2 right-2 left-2">
              <p className="text-white text-sm font-medium text-right">خلفية مخصصة</p>
            </div>
          </div>
          <Button
            variant="destructive"
            size="sm"
            className="absolute top-2 right-2 gap-1"
            onClick={() => onUpload('')}
          >
            <X className="h-3 w-3" />
            إزالة
          </Button>
        </div>
      ) : (
        <>
          <div 
            className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors aspect-video flex items-center justify-center"
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="flex flex-col items-center gap-3">
              <div className="flex gap-2">
                <ImageIcon className="h-8 w-8 text-muted-foreground" />
                <Video className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">اضغط لرفع خلفية</p>
                <p className="text-xs text-muted-foreground">صورة أو فيديو من جهازك</p>
              </div>
            </div>
          </div>
          
          <Button 
            variant="outline" 
            className="w-full gap-2"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            <Upload className="h-4 w-4" />
            {isUploading ? 'جاري الرفع...' : 'رفع خلفية مخصصة'}
          </Button>
        </>
      )}
      
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        onChange={handleFileChange}
        className="hidden"
      />
      
      <p className="text-xs text-muted-foreground text-center">
        يمكنك رفع صورة (JPG, PNG) أو فيديو (MP4, WebM)
      </p>
    </div>
  );
}
