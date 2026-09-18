import { describe, it, expect } from 'vitest';
import { formatTimeFull, parseTimeString } from '@/components/AudioTrimControl';

describe('AudioTrimControl time helpers', () => {
  describe('formatTimeFull', () => {
    it('formats zero seconds as 00:00', () => {
      expect(formatTimeFull(0)).toBe('00:00');
    });

    it('formats seconds less than a minute with zero-padding', () => {
      expect(formatTimeFull(9)).toBe('00:09');
      expect(formatTimeFull(59)).toBe('00:59');
    });

    it('formats minutes and seconds accurately', () => {
      expect(formatTimeFull(65)).toBe('01:05');
      expect(formatTimeFull(125)).toBe('02:05');
      expect(formatTimeFull(600)).toBe('10:00');
    });

    it('handles decimal seconds by flooring', () => {
      expect(formatTimeFull(65.8)).toBe('01:05');
      expect(formatTimeFull(0.99)).toBe('00:00');
    });
  });

  describe('parseTimeString', () => {
    it('parses valid mm:ss strings', () => {
      expect(parseTimeString('00:00')).toBe(0);
      expect(parseTimeString('00:30')).toBe(30);
      expect(parseTimeString('01:05')).toBe(65);
      expect(parseTimeString('10:00')).toBe(600);
      expect(parseTimeString('59:59')).toBe(3599);
    });

    it('rejects strings without exact colon separator', () => {
      expect(parseTimeString('0105')).toBeNull();
      expect(parseTimeString('01:05:00')).toBeNull();
      expect(parseTimeString('')).toBeNull();
    });

    it('rejects invalid seconds (>= 60 or negative)', () => {
      expect(parseTimeString('01:60')).toBeNull();
      expect(parseTimeString('01:99')).toBeNull();
      expect(parseTimeString('01:-5')).toBeNull();
      expect(parseTimeString('-1:30')).toBeNull();
    });

    it('rejects non-numeric inputs', () => {
      expect(parseTimeString('ab:cd')).toBeNull();
      expect(parseTimeString('01:xx')).toBeNull();
    });
  });
});
