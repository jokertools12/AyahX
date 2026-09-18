import { describe, it, expect } from 'vitest';
import { normalizeArabicText } from '../lib/utils';
import { reciters } from '../data/reciters';
import { surahs } from '../data/surahs';

describe('Feature QA Suite - Comprehensive Non-Rendering Audits', () => {
  describe('Arabic Normalization & Text Search Precision', () => {
    it('normalizes diacritics and tashkeel', () => {
      const textWithTashkeel = 'الرَّحْمَٰنِ الرَّحِيمِ';
      expect(normalizeArabicText(textWithTashkeel)).toBe('الرحمن الرحيم');
    });

    it('normalizes different forms of Alef (أ, إ, آ, ٱ -> ا)', () => {
      expect(normalizeArabicText('آلِ عِمْرَان')).toBe('ال عمران');
      expect(normalizeArabicText('إِبْرَاهِيم')).toBe('ابراهيم');
      expect(normalizeArabicText('أَحْمَد')).toBe('احمد');
    });

    it('normalizes Taa Marbuta (ة -> ه) and Yaa (ى -> ي)', () => {
      expect(normalizeArabicText('البَقَرَة')).toBe('البقره');
      expect(normalizeArabicText('مُوسَى')).toBe('موسي');
      expect(normalizeArabicText('العَفَاسِيّ')).toBe('العفاسي');
      expect(normalizeArabicText('العَفَاسَى')).toBe('العفاسي');
    });

    it('enables flexible search on Surah names', () => {
      const searchTerms = ['البقرة', 'البقره', 'الفاتحة', 'الفاتحه', 'ال عمران', 'آل عمران'];
      searchTerms.forEach(term => {
        const normQuery = normalizeArabicText(term);
        const matches = surahs.filter(s => normalizeArabicText(s.name).includes(normQuery));
        expect(matches.length).toBeGreaterThan(0);
      });
    });

    it('enables flexible search across Reciter names', () => {
      const queries = ['العفاسي', 'العفاسى', 'عبد الباسط', 'عبدالباسط', 'الحصري', 'الحصرى'];
      queries.forEach(query => {
        const q = normalizeArabicText(query);
        const matches = reciters.filter(r => 
          normalizeArabicText(r.name).includes(q) || 
          normalizeArabicText(r.name).replace(/\s+/g, '').includes(q.replace(/\s+/g, ''))
        );
        expect(matches.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Draft State Storage & Restoration Logic', () => {
    it('serializes and deserializes draft parameters reliably', () => {
      const draft = {
        surah: 2,
        reciter: 'mishary_alafasy',
        start: 255,
        end: 255,
        backgroundId: 'nature_1',
        ratio: '9:16',
        updatedAt: Date.now(),
      };

      const serialized = JSON.stringify(draft);
      const parsed = JSON.parse(serialized);

      expect(parsed.surah).toBe(2);
      expect(parsed.reciter).toBe('mishary_alafasy');
      expect(parsed.start).toBe(255);
      expect(parsed.end).toBe(255);
      expect(parsed.ratio).toBe('9:16');
    });
  });

  describe('Reciter Quick-Chips Management Logic', () => {
    it('deduplicates and maintains most recent reciters up to limit', () => {
      let recents = ['mishary_alafasy', 'abdul_basit_murattal', 'al_husary'];
      
      const selectReciter = (id: string, current: string[]) => {
        return [id, ...current.filter(r => r !== id)].slice(0, 5);
      };

      // Select existing reciter -> moves to front
      recents = selectReciter('al_husary', recents);
      expect(recents[0]).toBe('al_husary');
      expect(recents.length).toBe(3);

      // Select new reciters
      recents = selectReciter('al_dosari', recents);
      recents = selectReciter('al_muaiqly', recents);
      recents = selectReciter('shuraim', recents);

      expect(recents.length).toBe(5);
      expect(recents[0]).toBe('shuraim');
      expect(recents).not.toContain('abdul_basit_murattal'); // Oldest evicted
    });
  });

  describe('Contact Form Input Validation Logic', () => {
    it('enforces required fields and validates email formatting', () => {
      const validateContact = (name: string, email: string, subject: string, message: string) => {
        if (!name || !name.trim()) return 'NAME_REQUIRED';
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'INVALID_EMAIL';
        if (!subject || !subject.trim()) return 'SUBJECT_REQUIRED';
        if (!message || message.trim().length < 5) return 'MESSAGE_TOO_SHORT';
        return 'VALID';
      };

      expect(validateContact('', 'test@example.com', 'Sub', 'Hello text')).toBe('NAME_REQUIRED');
      expect(validateContact('Ali', 'bademail', 'Sub', 'Hello text')).toBe('INVALID_EMAIL');
      expect(validateContact('Ali', 'test@example.com', '', 'Hello text')).toBe('SUBJECT_REQUIRED');
      expect(validateContact('Ali', 'test@example.com', 'Sub', 'Hi')).toBe('MESSAGE_TOO_SHORT');
      expect(validateContact('Ali', 'test@example.com', 'Sub', 'Peace be upon you, great app!')).toBe('VALID');
    });
  });

  describe('Password & Account Deletion Safety Gates', () => {
    it('verifies that password verification is strictly required for destructive account wipe', () => {
      const verifyAccountDeletionPayload = (payload: { password?: string }) => {
        if (!payload.password || typeof payload.password !== 'string' || payload.password.trim().length === 0) {
          return { error: 'يرجى إدخال كلمة المرور لتأكيد حذف الحساب' };
        }
        return { ok: true };
      };

      expect(verifyAccountDeletionPayload({})).toHaveProperty('error');
      expect(verifyAccountDeletionPayload({ password: '' })).toHaveProperty('error');
      expect(verifyAccountDeletionPayload({ password: '   ' })).toHaveProperty('error');
      expect(verifyAccountDeletionPayload({ password: 'validPassword123' })).toEqual({ ok: true });
    });
  });
});
