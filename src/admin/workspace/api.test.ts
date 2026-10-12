import { describe, expect, it } from 'vitest';
import { isPlayableAudioUrl, officialYoutubeEmbed, recitationLabel } from './api';

describe('admin recording boundary', () => {
  it('keeps the selected descriptive label instead of guessing from the reader', () => {
    expect(recitationLabel({ display_label_ar: 'تسجيل المسجد', reciter_name_ar: 'قارئ' }, 'ar')).toBe('تسجيل المسجد');
    expect(recitationLabel({ generated_label_ar: 'قارئ — مجود — مصدر' }, 'ar')).toBe('قارئ — مجود — مصدر');
  });

  it('allows only official HTTPS embeds, without granting a download path', () => {
    expect(officialYoutubeEmbed('https://www.youtube.com/embed/abcdefghijk?start=2')).toContain('/embed/abcdefghijk');
    for (const value of ['https://www.youtube.com.evil.test/embed/abcdefghijk', 'javascript:alert(1)', 'https://www.youtube.com/watch?v=abcdefghijk', 'http://www.youtube.com/embed/abcdefghijk']) expect(officialYoutubeEmbed(value)).toBeNull();
  });

  it('refuses unsafe browser media schemes and protocol-relative capabilities', () => {
    expect(isPlayableAudioUrl('/api/admin/listening/example/audio')).toBe(true);
    expect(isPlayableAudioUrl('https://audio.example.test/001.mp3')).toBe(true);
    for (const value of ['//evil.test/audio', 'javascript:alert(1)', 'data:audio/wav;base64,abc', 'file:///secret']) expect(isPlayableAudioUrl(value)).toBe(false);
  });
});
