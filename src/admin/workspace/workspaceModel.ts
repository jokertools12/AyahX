import type { ReviewCount, ReviewItem } from '../../../shared/admin/batch5';

/** Prioritize technically eligible work without inventing approvals or hiding other work. */
export function pendingReviewGroups(counts: ReviewCount[]) {
  return counts.filter(item => item.status === 'pending' && item.count > 0)
    .sort((a, b) => b.eligible_count - a.eligible_count || b.count - a.count || a.type.localeCompare(b.type));
}

export function reviewShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>, editing: boolean): 'next' | 'previous' | 'approved' | 'rejected' | 'deferred' | null {
  if (editing || event.ctrlKey || event.metaKey || event.altKey) return null;
  return ({ j: 'next', k: 'previous', a: 'approved', r: 'rejected', d: 'deferred' } as const)[event.key.toLowerCase()] ?? null;
}

const bulkSafeTypes = new Set(['data_conflict', 'near_complete_chapters', 'youtube_audio_missing']);
export const allowsBulkDecision = (items: ReviewItem[]) => items.length > 0 && items.every(item => item.status === 'pending' && bulkSafeTypes.has(item.type));

/** Both endpoints must belong to one verified run; filling a gap by interpolation is forbidden. */
export function isAvailableRange(runs: Array<[number, number]>, from: number, to: number): boolean {
  return Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to >= from && runs.some(([first, last]) => from >= first && to <= last);
}

export function safeAdminMediaPath(value: unknown): value is string {
  return typeof value === 'string' && /^\/api\/admin\/render-lab\/jobs\/[a-zA-Z0-9_-]+\/media$/u.test(value);
}

export function formatDuration(milliseconds: unknown, locale: 'ar' | 'en' = 'ar'): string {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds < 0) return locale === 'ar' ? 'غير متاح' : 'Unavailable';
  return `${(milliseconds / 1000).toLocaleString(locale, { maximumFractionDigits: 2 })} ${locale === 'ar' ? 'ثانية' : 'seconds'}`;
}
