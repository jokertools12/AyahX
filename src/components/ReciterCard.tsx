import { useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Play, Pause, Volume2, Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFavorites } from '@/hooks/useFavorites';
import type { Reciter } from '@/data/reciters';
import { getPreviewAudioUrl } from '@/data/reciters';

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
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-xl border p-4 transition-all duration-300",
        "bg-card hover:shadow-lg hover:shadow-primary/10",
        isSelected && "ring-2 ring-primary border-primary bg-primary/5"
      )}
    >
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div className="flex h-11 w-11 items-center justify-center rounded-full gradient-gold text-accent-foreground font-bold text-base shrink-0">
          {reciter.name.charAt(0)}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-sm leading-tight truncate">{reciter.name}</h3>
          <p className="text-xs text-muted-foreground truncate">{reciter.description}</p>
        </div>

        {/* Favorite Button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full shrink-0"
          onClick={toggleFavorite}
        >
          <Heart className={cn("h-4 w-4", isFavorite && "fill-red-500 text-red-500")} />
        </Button>

        {/* Preview Button */}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-9 w-9 rounded-full shrink-0 transition-colors",
            isPreviewPlaying && "text-primary bg-primary/10"
          )}
          onClick={togglePreview}
          title="معاينة الصوت"
        >
          {isPreviewPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )}
        </Button>

        {/* Style Badge */}
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground shrink-0">
          {reciter.style}
        </span>
      </div>
    </motion.div>
  );
}
