import { describe, expect, it } from 'vitest';
import { allowsBulkDecision, formatDuration, isAvailableRange, pendingReviewGroups, reviewShortcut, safeAdminMediaPath } from './workspaceModel';
import type { ReviewItem } from '../../../shared/admin/batch5';

describe('owner workflow boundaries', () => {
  it('prioritizes eligible pending work without counting previous approvals as pending', () => {
    expect(pendingReviewGroups([{ type: 'label_review', status: 'approved', count: 50, eligible_count: 20 }, { type: 'provider_license', status: 'pending', count: 2, eligible_count: 0 }, { type: 'voice_confirmation', status: 'pending', count: 10, eligible_count: 4 }]).map(row => row.type)).toEqual(['voice_confirmation', 'provider_license']);
  });
  it('does not fire decisions while typing or using browser shortcuts', () => {
    expect(reviewShortcut({ key: 'A', ctrlKey: false, metaKey: false, altKey: false }, false)).toBe('approved');
    expect(reviewShortcut({ key: 'a', ctrlKey: false, metaKey: false, altKey: false }, true)).toBeNull();
    expect(reviewShortcut({ key: 'r', ctrlKey: true, metaKey: false, altKey: false }, false)).toBeNull();
  });
  it('never offers bulk voice or provider license decisions', () => {
    expect(allowsBulkDecision([{ type: 'voice_confirmation', status: 'pending' } as ReviewItem])).toBe(false);
    expect(allowsBulkDecision([{ type: 'provider_license', status: 'pending' } as ReviewItem])).toBe(false);
    expect(allowsBulkDecision([])).toBe(false);
  });
  it('rejects a range crossing missing verses and accepts endpoints within one verified run', () => {
    expect(isAvailableRange([[1, 3], [5, 8]], 2, 6)).toBe(false);
    expect(isAvailableRange([[1, 3], [5, 8]], 5, 8)).toBe(true);
    expect(isAvailableRange([[1, 3]], 1.5, 2)).toBe(false);
  });
  it('only embeds same-origin admin media and never treats invalid metrics as zero', () => {
    expect(safeAdminMediaPath('/api/admin/render-lab/jobs/a-b/media')).toBe(true);
    expect(safeAdminMediaPath('//host/api/admin/render-lab/jobs/a/media')).toBe(false);
    expect(formatDuration(null)).toBe('غير متاح');
  });
});
