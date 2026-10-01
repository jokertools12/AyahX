// Pexels API client (Proxied via backend to eliminate client-side key exposure)
import { getAuthToken } from './api';

async function fetchPexels(endpoint: string, params: URLSearchParams): Promise<PexelsVideo[]> {
  const token = getAuthToken();
  if (!token) throw new Error('سجّل الدخول لعرض فيديوهات Pexels');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`/api/services/pexels/${endpoint}?${params}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'تعذر تحميل فيديوهات Pexels');
    return (data.videos || []).filter((video: PexelsVideo) => video.video_files?.some(file => file.file_type === 'video/mp4' && file.link));
  } catch (error) {
    if (controller.signal.aborted) throw new Error('استغرق تحميل الفيديوهات وقتًا طويلًا؛ أعد المحاولة');
    throw error;
  } finally { clearTimeout(timeout); }
}

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

  return fetchPexels('search', new URLSearchParams({ query, orientation, size, per_page: String(perPage), page: String(page) }));
}

export async function getPopularPexelsVideos(options?: { perPage?: number; page?: number }): Promise<PexelsVideo[]> {
  return fetchPexels('popular', new URLSearchParams({ per_page: String(options?.perPage || 15), page: String(options?.page || 1) }));
}

// Get optimal video URL — prefer SD/HD portrait, avoid UHD to reduce CPU load
export function getBestVideoUrl(video: PexelsVideo, preferLowRes = false): string {
  const files = video.video_files.filter(file => file.file_type === 'video/mp4' && file.link).sort((a, b) => {
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

  return files[0]?.link || '';
}
