import { expect, it } from 'vitest';
import { notificationTimeAgo } from '../lib/notificationTime';
it('interprets UTC database dates like offset-qualified ISO dates', () => {
  const now = Date.parse('2026-10-01T03:02:00Z');
  expect(notificationTimeAgo('2026-10-01 03:00:00', now)).toBe(notificationTimeAgo('2026-10-01T03:00:00Z', now));
  expect(notificationTimeAgo('2026-10-01 03:00:00', now)).toContain('دقيقتين');
});
it('handles invalid and future dates without misleading negative ages', () => {
  expect(notificationTimeAgo('invalid')).toBe('وقت غير محدد');
  expect(notificationTimeAgo('2026-10-02T00:00:00Z', Date.parse('2026-10-01T00:00:00Z'))).toBe('الآن');
});
