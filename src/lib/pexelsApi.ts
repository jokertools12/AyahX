// Pexels API client (Proxied via backend to eliminate client-side key exposure)
const CLIENT_PEXELS_KEY = (import.meta.env.VITE_PEXELS_API_KEY as string) || '';
const DIRECT_BASE_URL = 'https://api.pexels.com/videos';

export interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number;
  url: string;
  image: string;
  video_files: {
    id: number;
    quality: string;
    file_type: string;
    width: number;
    height: number;
    link: string;
  }[];
}

export interface PexelsSearchResponse {
  page: number;
  per_page: number;
  total_results: number;
  videos: PexelsVideo[];
}

export type VideoCategory = 
  | 'nature'
  | 'sky'
  | 'mountains'
  | 'ocean'
  | 'forest'
  | 'clouds'
  | 'rain'
  | 'sunset'
  | 'stars'
  | 'desert'
  | 'waterfall'
  | 'flowers';

export const VIDEO_CATEGORIES: { id: VideoCategory; label: string; query: string }[] = [
  { id: 'nature', label: 'طبيعة', query: 'nature landscape' },
  { id: 'sky', label: 'سماء', query: 'sky clouds blue' },
  { id: 'mountains', label: 'جبال', query: 'mountains scenic' },
  { id: 'ocean', label: 'محيط', query: 'ocean waves sea' },
  { id: 'forest', label: 'غابة', query: 'forest trees green' },
  { id: 'clouds', label: 'سحب', query: 'clouds timelapse' },
  { id: 'rain', label: 'مطر', query: 'rain drops water' },
  { id: 'sunset', label: 'غروب', query: 'sunset golden hour' },
  { id: 'stars', label: 'نجوم', query: 'stars night sky' },
  { id: 'desert', label: 'صحراء', query: 'desert sand dunes' },
  { id: 'waterfall', label: 'شلال', query: 'waterfall water' },
  { id: 'flowers', label: 'زهور', query: 'flowers garden bloom' },
];

export async function searchPexelsVideos(
  query: string,
  options?: {
    orientation?: 'portrait' | 'landscape' | 'square';
    size?: 'small' | 'medium' | 'large';
    perPage?: number;
    page?: number;
  }
): Promise<PexelsVideo[]> {
  const { orientation = 'portrait', size = 'medium', perPage = 15, page = 1 } = options || {};

  try {
    const params = new URLSearchParams({
      query,
      orientation,
      size,
      per_page: perPage.toString(),
      page: page.toString(),
    });

    // 1. Prefer secure backend proxy to keep API key hidden
    const proxyResponse = await fetch(`/api/services/pexels/search?${params}`);
    if (proxyResponse.ok) {
      const data: PexelsSearchResponse = await proxyResponse.json();
      return data.videos || [];
    }

    // 2. Fallback to direct call only if custom frontend key is explicitly configured in .env
    if (CLIENT_PEXELS_KEY) {
      const directResponse = await fetch(`${DIRECT_BASE_URL}/search?${params}`, {
        headers: { Authorization: CLIENT_PEXELS_KEY },
      });
      if (directResponse.ok) {
        const data: PexelsSearchResponse = await directResponse.json();
        return data.videos || [];
      }
    }

    return [];
  } catch (error) {
    console.error('Error fetching Pexels videos:', error);
    return [];
  }
}

export async function getPopularPexelsVideos(
  options?: {
    perPage?: number;
    page?: number;
  }
): Promise<PexelsVideo[]> {
  const { perPage = 15, page = 1 } = options || {};

  try {
    const params = new URLSearchParams({
      per_page: perPage.toString(),
      page: page.toString(),
    });

    // 1. Prefer secure backend proxy
    const proxyResponse = await fetch(`/api/services/pexels/popular?${params}`);
    if (proxyResponse.ok) {
      const data: PexelsSearchResponse = await proxyResponse.json();
      return data.videos || [];
    }

    // 2. Fallback to direct call only if client key configured
    if (CLIENT_PEXELS_KEY) {
      const directResponse = await fetch(`${DIRECT_BASE_URL}/popular?${params}`, {
        headers: { Authorization: CLIENT_PEXELS_KEY },
      });
      if (directResponse.ok) {
        const data: PexelsSearchResponse = await directResponse.json();
        return data.videos || [];
      }
    }

    return [];
  } catch (error) {
    console.error('Error fetching popular Pexels videos:', error);
    return [];
  }
}

// Get optimal video URL — prefer SD/HD portrait, avoid UHD to reduce CPU load
export function getBestVideoUrl(video: PexelsVideo, preferLowRes = false): string {
  const files = [...video.video_files].sort((a, b) => {
    // Prefer portrait orientation
    const aIsPortrait = a.height > a.width;
    const bIsPortrait = b.height > b.width;
    if (aIsPortrait !== bIsPortrait) return aIsPortrait ? -1 : 1;
    
    // Prefer SD for low-res mode (mobile / compatibility), HD otherwise
    // Never pick UHD — too heavy for canvas recording
    const qualityOrder = preferLowRes
      ? { sd: 3, hd: 2, uhd: 0 }
      : { hd: 3, sd: 2, uhd: 0 };
    const aQuality = qualityOrder[a.quality as keyof typeof qualityOrder] ?? 0;
    const bQuality = qualityOrder[b.quality as keyof typeof qualityOrder] ?? 0;
    if (aQuality !== bQuality) return bQuality - aQuality;

    // For same quality tier, prefer smaller file (lower resolution)
    return (a.width * a.height) - (b.width * b.height);
  });

  return files[0]?.link || video.video_files[0]?.link || '';
}
