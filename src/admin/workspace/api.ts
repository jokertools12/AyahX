import { useQuery } from '@tanstack/react-query';
import { adminApi, adminWrite } from '../adminApi';
import type { AdminPreferences, ListeningRoom, ReviewDecisionInput, ReviewItem, WorkspaceSummary } from '../../../shared/admin/batch5';

export interface ReviewDetail {
  item: ReviewItem;
  evidence: unknown;
  subject: Record<string, unknown> | null;
  listening_path: string | null;
  history: Array<Record<string, unknown>>;
  remaining: number;
}
export interface ReviewDecisionResult { changed: boolean; next_id: string | null; remaining: number }

export function useWorkspace() {
  return useQuery({ queryKey: ['admin', 'workspace'], queryFn: () => adminApi<WorkspaceSummary>('/workspace'), retry: false });
}

export function useReviewDetail(id: string) {
  return useQuery({ queryKey: ['admin', 'review', id], queryFn: () => adminApi<ReviewDetail>(`/reviews/${encodeURIComponent(id)}`), enabled: !!id, retry: false });
}

export function useListeningRoom(id: string) {
  return useQuery({ queryKey: ['admin', 'listening', id], queryFn: () => adminApi<ListeningRoom>(`/listening/${encodeURIComponent(id)}`), enabled: !!id, retry: false });
}

export const writeReviewDecision = (id: string, input: ReviewDecisionInput) =>
  adminWrite<ReviewDecisionResult>(`/reviews/${encodeURIComponent(id)}/decision`, 'POST', input);

export const writeAdminPreferences = (preferences: AdminPreferences) =>
  adminWrite<AdminPreferences>('/preferences', 'PATCH', preferences);

/** Explicit recording selection survives sorting and does not collapse readers' styles. */
export function recitationLabel(row: Record<string, unknown>, language: 'ar' | 'en'): string {
  const value = language === 'ar'
    ? row.display_label_ar ?? row.generated_label_ar ?? row.reciter_name_ar
    : row.display_label_en ?? row.generated_label_en ?? row.display_label_ar ?? row.reciter_name_en ?? row.reciter_name_ar;
  return typeof value === 'string' && value.trim() ? value : language === 'ar' ? 'تلاوة بلا اسم معتمد' : 'Recitation without an approved label';
}

/** Audio URLs must be response capabilities, never a persisted copy in localStorage. */
export function isPlayableAudioUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.startsWith('/api/admin/')) return true;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

export function officialYoutubeEmbed(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['www.youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname) && /^\/embed\/[a-zA-Z0-9_-]{11}$/u.test(url.pathname) ? url.href : null;
  } catch { return null; }
}
