import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Play, RefreshCw, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  searchPexelsVideos,
  PexelsVideo,
  VIDEO_CATEGORIES,
  VideoCategory,
  getBestVideoUrl,
} from '@/lib/pexelsApi';

interface PexelsVideoSelectorProps {
  onSelect: (videoUrl: string, thumbnailUrl: string) => void;
}

export function PexelsVideoSelector({ onSelect }: PexelsVideoSelectorProps) {
  const [videos, setVideos] = useState<PexelsVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<VideoCategory>('nature');
  const [selectedVideoId, setSelectedVideoId] = useState<number | null>(null);

  const fetchVideos = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const results = await searchPexelsVideos(query, {
        orientation: 'portrait',
        perPage: 12,
      });
      setVideos(results);
    } catch (error) {
      console.error('Error fetching videos:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load initial videos
  useEffect(() => {
    const category = VIDEO_CATEGORIES.find((c) => c.id === selectedCategory);
    if (category) {
      fetchVideos(category.query);
    }
  }, [selectedCategory, fetchVideos]);

  const handleSearch = () => {
    if (searchQuery.trim()) {
      fetchVideos(searchQuery);
    }
  };

  const handleCategoryClick = (category: VideoCategory) => {
    setSelectedCategory(category);
    setSearchQuery('');
  };

  const handleVideoSelect = (video: PexelsVideo) => {
    setSelectedVideoId(video.id);
    const videoUrl = getBestVideoUrl(video);
    onSelect(videoUrl, video.image);
  };

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="flex gap-2">
        <Input
          placeholder="ابحث عن فيديو..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          className="flex-1"
        />
        <Button variant="outline" size="icon" onClick={handleSearch} disabled={loading}>
          <Search className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => {
            const category = VIDEO_CATEGORIES.find((c) => c.id === selectedCategory);
            if (category) fetchVideos(category.query);
          }}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Categories */}
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-2 min-w-max">
          {VIDEO_CATEGORIES.map((category) => (
            <Badge
              key={category.id}
              variant={selectedCategory === category.id ? 'default' : 'outline'}
              className="cursor-pointer hover:bg-primary/80 transition-colors px-3 py-1.5"
              onClick={() => handleCategoryClick(category.id)}
            >
              {category.label}
            </Badge>
          ))}
        </div>
      </div>

      {/* Videos Grid */}
      <ScrollArea className="h-[280px]">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Play className="h-12 w-12 mb-2 opacity-50" />
            <p className="text-sm">لا توجد فيديوهات</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 p-1">
            {videos.map((video) => (
              <motion.div
                key={video.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleVideoSelect(video)}
                className={`relative cursor-pointer rounded-lg overflow-hidden aspect-[9/16] border-2 transition-all ${
                  selectedVideoId === video.id
                    ? 'border-primary ring-2 ring-primary/30'
                    : 'border-transparent hover:border-primary/50'
                }`}
              >
                <img
                  src={video.image}
                  alt="Video thumbnail"
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                
                {/* Play indicator */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity bg-black/30">
                  <Play className="h-8 w-8 text-white" />
                </div>

                {/* Duration */}
                <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/70 text-white text-xs">
                  {Math.floor(video.duration / 60)}:{String(video.duration % 60).padStart(2, '0')}
                </div>

                {/* Selected indicator */}
                {selectedVideoId === video.id && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute top-1 left-1 p-1 rounded-full bg-primary text-primary-foreground"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </motion.div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </ScrollArea>

      <p className="text-xs text-muted-foreground text-center">
        مقاطع فيديو مقدمة من <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer" className="underline">Pexels</a>
      </p>
    </div>
  );
}
