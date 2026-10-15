import { describe, expect, it } from 'vitest';
import { isPermanentObjectStoragePath, renderObjectKey } from '../../server/services/objectStorage';

describe('R2 temporary render keys', () => {
  it('uses the lifecycle prefix and UTC date partition', () => {
    expect(renderObjectKey('user-1', 'job-2', new Date('2026-10-15T23:59:00.000Z')))
      .toBe('temp-48h/renders/2026-10-15/user-1_job-2.mp4');
  });

  it('does not allow path separators or unbounded identifiers into object keys', () => {
    const key = renderObjectKey('../user', 'job/with\\path', new Date('2026-01-01T00:00:00.000Z'));
    expect(key).toBe('temp-48h/renders/2026-01-01/.._user_job_with_path.mp4');
    expect(key.length).toBeLessThan(300);
  });

  it('recognizes permanent objects so expiry cleanup can fail closed', () => {
    expect(isPermanentObjectStoragePath('s3://bucket/permanent/fonts/quran.otf')).toBe(true);
    expect(isPermanentObjectStoragePath('s3://bucket/temp-48h/renders/2026-01-01/job.mp4')).toBe(false);
    expect(isPermanentObjectStoragePath('uploads/renders/job.mp4')).toBe(false);
  });
});
