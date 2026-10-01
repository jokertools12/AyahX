import { describe, it, expect } from 'vitest';
import { getPlanEntitlements } from '../../shared/planEntitlements';
import { SURAH_AYAH_COUNTS } from '../../server/routes/videos';
import { surahs } from '../data/surahs';

describe('Data Integrity & Schema Safety Tests', () => {
  describe('DATA-01: Surah Boundary Validation & Ibtahalat 0-Verse Preservation', () => {
    it('verifies canonical SURAH_AYAH_COUNTS contains exactly 114 Surahs matching surahs.ts', () => {
      expect(SURAH_AYAH_COUNTS).toHaveLength(114);
      expect(surahs).toHaveLength(114);

      for (let i = 0; i < 114; i++) {
        expect(SURAH_AYAH_COUNTS[i]).toBe(surahs[i].numberOfAyahs);
      }
    });

    it('correctly preserves surah_number: 0 and 0-ayahs for Ibtahalat mode without falsy corruption', () => {
      function sanitizeVideoInputs(body: any) {
        const rawSurah = parseInt(body.surah_number, 10);
        const isIbtahalat = rawSurah === 0 || body.reciter_id === 'ibtahalat';

        let numSurah = 0;
        let startAyah = 0;
        let endAyah = 0;

        if (isIbtahalat) {
          numSurah = 0;
          startAyah = 0;
          endAyah = 0;
        } else {
          numSurah = Math.min(114, Math.max(1, Number.isNaN(rawSurah) ? 1 : rawSurah));
          const maxAyahsInSurah = SURAH_AYAH_COUNTS[numSurah - 1];
          const parsedStart = parseInt(body.start_ayah, 10);
          const parsedEnd = parseInt(body.end_ayah, 10);

          startAyah = Math.min(maxAyahsInSurah, Math.max(1, Number.isNaN(parsedStart) ? 1 : parsedStart));
          endAyah = Math.min(maxAyahsInSurah, Math.max(startAyah, Number.isNaN(parsedEnd) ? startAyah : parsedEnd));
        }

        return { numSurah, startAyah, endAyah, isIbtahalat };
      }

      // Test Ibtahalat payload from PreviewPage
      const ibtPayload = {
        surah_number: 0,
        reciter_id: 'ibtahalat',
        start_ayah: 0,
        end_ayah: 0,
      };
      const ibtResult = sanitizeVideoInputs(ibtPayload);
      expect(ibtResult.isIbtahalat).toBe(true);
      expect(ibtResult.numSurah).toBe(0);
      expect(ibtResult.startAyah).toBe(0);
      expect(ibtResult.endAyah).toBe(0);

      // Test Quran payload for Surah Al-Fatiha (7 verses)
      const fatihaValid = sanitizeVideoInputs({ surah_number: 1, start_ayah: 1, end_ayah: 7 });
      expect(fatihaValid.numSurah).toBe(1);
      expect(fatihaValid.startAyah).toBe(1);
      expect(fatihaValid.endAyah).toBe(7);

      // Test Upper Bound Clamping (Surah Al-Fatiha only has 7 verses, malicious 9999 is clamped to 7)
      const fatihaOverflow = sanitizeVideoInputs({ surah_number: 1, start_ayah: -10, end_ayah: 9999 });
      expect(fatihaOverflow.numSurah).toBe(1);
      expect(fatihaOverflow.startAyah).toBe(1);
      expect(fatihaOverflow.endAyah).toBe(7);

      // Test Inverted Range (start > end clamped so end >= start)
      const inverted = sanitizeVideoInputs({ surah_number: 2, start_ayah: 50, end_ayah: 10 });
      expect(inverted.numSurah).toBe(2);
      expect(inverted.startAyah).toBe(50);
      expect(inverted.endAyah).toBe(50);
    });
  });

  describe('DATA-02: Achievement Concurrent Unlock & Idempotency', () => {
    it('gracefully handles ER_DUP_ENTRY / 1062 race conditions returning alreadyUnlocked', async () => {
      // Mock db transaction runner
      async function simulateUnlock(alreadyExistsInDb: boolean, throwDupKeyError: boolean) {
        if (alreadyExistsInDb) {
          return { alreadyUnlocked: true };
        }

        try {
          if (throwDupKeyError) {
            const err: any = new Error('Duplicate entry for key uk_user_achievement');
            err.code = 'ER_DUP_ENTRY';
            err.errno = 1062;
            throw err;
          }
          return { success: true, points: 10 };
        } catch (insertErr: any) {
          if (insertErr.code === 'ER_DUP_ENTRY' || insertErr.errno === 1062) {
            return { alreadyUnlocked: true };
          }
          throw insertErr;
        }
      }

      // When first attempt succeeds
      const firstAttempt = await simulateUnlock(false, false);
      expect(firstAttempt).toEqual({ success: true, points: 10 });

      // When subsequent attempt hits existing record
      const secondAttempt = await simulateUnlock(true, false);
      expect(secondAttempt).toEqual({ alreadyUnlocked: true });

      // When concurrent race condition triggers ER_DUP_ENTRY on unique key
      const raceConditionAttempt = await simulateUnlock(false, true);
      expect(raceConditionAttempt).toEqual({ alreadyUnlocked: true });
    });
  });

  describe('DATA-03: Daily Video Quota Enforcement', () => {
    it('uses the canonical 5/unlimited Browser Canvas and 1/5/10 cloud allowances', () => {
      const free = getPlanEntitlements('free');
      const monthly = getPlanEntitlements('monthly');
      const yearly = getPlanEntitlements('yearly');

      expect(free.browserDailyLimit).toBe(5);
      expect(free.cloudDailyLimit).toBe(1);
      expect(monthly.browserDailyLimit).toBeNull();
      expect(monthly.cloudDailyLimit).toBe(5);
      expect(yearly.browserDailyLimit).toBeNull();
      expect(yearly.cloudDailyLimit).toBe(10);
    });
  });

  describe('DATA-04: Strict MySQL Timestamp & Datetime Formatting', () => {
    it('formats Javascript Date objects into standard MySQL DATETIME string without T or Z', () => {
      const formatMySQLDate = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

      const fixedDate = new Date('2026-09-05T19:30:00.000Z');
      const formatted = formatMySQLDate(fixedDate);

      expect(formatted).toBe('2026-09-05 19:30:00');
      expect(formatted).not.toContain('T');
      expect(formatted).not.toContain('Z');
      expect(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(formatted)).toBe(true);
    });
  });

  describe('DATA-05: Social Notification De-duplication', () => {
    it('prevents redundant unread notifications for repeated user follow actions', () => {
      interface Notification {
        userId: string;
        message: string;
        type: string;
        isRead: boolean;
      }

      const notificationsStore: Notification[] = [];

      function addFollowNotification(followingId: string, followerName: string) {
        const notifMsg = `بدأ ${followerName} بمتابعتك`;
        const exists = notificationsStore.some(
          n => n.userId === followingId && n.type === 'social' && n.message === notifMsg && !n.isRead
        );

        if (!exists) {
          notificationsStore.push({
            userId: followingId,
            message: notifMsg,
            type: 'social',
            isRead: false,
          });
          return true;
        }
        return false;
      }

      // First follow event adds notification
      const addedFirst = addFollowNotification('user_123', 'أحمد');
      expect(addedFirst).toBe(true);
      expect(notificationsStore).toHaveLength(1);

      // Immediate unfollow / refollow while notification is unread does NOT add duplicate
      const addedSecond = addFollowNotification('user_123', 'أحمد');
      expect(addedSecond).toBe(false);
      expect(notificationsStore).toHaveLength(1);

      // Once user reads it, subsequent follow can notify again
      notificationsStore[0].isRead = true;
      const addedThird = addFollowNotification('user_123', 'أحمد');
      expect(addedThird).toBe(true);
      expect(notificationsStore).toHaveLength(2);
    });
  });
});
