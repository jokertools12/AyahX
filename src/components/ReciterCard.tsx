import { useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Pause, Volume2, Heart, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFavorites } from '@/hooks/useFavorites';
import type { Reciter } from '@/data/reciters';
import { getPreviewAudioUrl, isAccreditedReciter, getReciterRiwayah } from '@/data/reciters';

interface ReciterCardProps {
  reciter: Reciter;
  isSelected?: boolean;
  onClick?: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: (e: React.MouseEvent) => void;
}

export function ReciterCard({
  reciter,
  isSelected,
  onClick,
  isFavorite: isFavoriteProp,
  onToggleFavorite: onToggleFavoriteProp,
}: ReciterCardProps) {
  const { isFavoriteReciter, toggleFavoriteReciter } = useFavorites();
  const isFavorite = isFavoriteProp !== undefined ? isFavoriteProp : isFavoriteReciter(reciter.id);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const isAccredited = isAccreditedReciter(reciter);
  const riwayah = getReciterRiwayah(reciter);

  const toggleFavorite = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleFavoriteProp) {
      onToggleFavoriteProp(e);
    } else {
      toggleFavoriteReciter(reciter.id);
    }
  }, [onToggleFavoriteProp, toggleFavoriteReciter, reciter.id]);

  const togglePreview = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (isPreviewPlaying && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPreviewPlaying(false);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    }

    const audio = new Audio(getPreviewAudioUrl(reciter));
    audio.volume = 0.5;
    audioRef.current = audio;

    audio.onended = () => setIsPreviewPlaying(false);
    audio.onerror = () => setIsPreviewPlaying(false);

    audio.play().then(() => {
      setIsPreviewPlaying(true);
      setTimeout(() => {
        if (audioRef.current === audio && !audio.paused) {
          audio.pause();
          audio.currentTime = 0;
          setIsPreviewPlaying(false);
        }
      }, 15000);
    }).catch(() => setIsPreviewPlaying(false));
  }, [isPreviewPlaying, reciter]);

  return (
    <motion.div
      whileHover={{ scale: 1.015 }}
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-xl border p-3.5 transition-all duration-300 relative overflow-hidden",
        "bg-card hover:shadow-lg hover:shadow-primary/10",
        isSelected && "ring-2 ring-primary border-primary bg-primary/5",
        isAccredited && "border-emerald-500/20 hover:border-emerald-500/40"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Avatar with optional accredited halo */}
        <div className="relative shrink-0 mt-0.5">
          <div className={cn(
            "flex h-11 w-11 items-center justify-center rounded-full font-bold text-base transition-transform",
            isAccredited
              ? "bg-gradient-to-br from-emerald-500 to-teal-700 text-white shadow-md shadow-emerald-500/20"
              : "gradient-gold text-accent-foreground shadow-sm"
          )}>
            {reciter.name.charAt(0)}
          </div>
          {isAccredited && (
            <span
              title="قارئ معتمد بمحاذاة زمنية فائقة الدقة"
              className="absolute -bottom-1 -left-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[9px] text-white shadow-sm ring-2 ring-card"
            >
              ⚡
            </span>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1 mb-1">
            <h3 className="font-bold text-sm leading-tight truncate">{reciter.name}</h3>
          </div>
          {reciter.description && (
            <p className="text-xs text-muted-foreground truncate mb-2">{reciter.description}</p>
          )}

          {/* Badges row: Accreditation, Riwayah, Style */}
          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
            {isAccredited ? (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shrink-0">
                <Zap className="h-2.5 w-2.5 fill-current" />
                معتمد ⚡
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground border border-border/40 shrink-0">
                تلاوة قياسية
              </span>
            )}

            <span className="rounded-full bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-[10px] font-medium shrink-0">
              {riwayah}
            </span>

            <span className="rounded-full bg-secondary text-secondary-foreground px-2 py-0.5 text-[10px] font-medium shrink-0">
              {reciter.style}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1 shrink-0 -mt-0.5">
          {/* Favorite Button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={toggleFavorite}
            title={isFavorite ? "إزالة من المفضلة" : "إضافة للمفضلة"}
          >
            <Heart className={cn("h-4 w-4", isFavorite && "fill-red-500 text-red-500")} />
          </Button>

          {/* Preview Audio Button */}
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-8 w-8 rounded-full transition-colors",
              isPreviewPlaying && "text-primary bg-primary/10 animate-pulse"
            )}
            onClick={togglePreview}
            title="معاينة الصوت"
          >
            {isPreviewPlaying ? (
              <Pause className="h-4 w-4 text-primary" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
