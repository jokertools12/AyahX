import { describe, it, expect } from 'vitest';
import { QUALITY_PRESETS, getQualityDimensions, ExportQuality } from '@/hooks/useVideoRecorder';
import { VIDEO_PRESETS } from '@/data/videoPresets';

describe('Video Quality Presets and Dimensions', () => {
  it('ships all three selectable cinematic Quran Reels directions', () => {
    const directions = ['dawn', 'editorial', 'moonlit'];
    for (const direction of directions) {
      expect(VIDEO_PRESETS.some((preset) => preset.displaySettings.visualDesign === direction)).toBe(true);
    }
  });

  it('defines all required quality levels', () => {
    const requiredKeys: ExportQuality[] = ['medium', 'high', 'ultra'];
    for (const key of requiredKeys) {
      expect(QUALITY_PRESETS[key]).toBeDefined();
      expect(QUALITY_PRESETS[key].bitrate).toBeGreaterThan(0);
      expect(QUALITY_PRESETS[key].canvasWidth).toBeGreaterThan(0);
      expect(QUALITY_PRESETS[key].canvasHeight).toBeGreaterThan(0);
    }
  });

  it('maintains strict bitrate hierarchy (ultra > high > medium)', () => {
    expect(QUALITY_PRESETS.ultra.bitrate).toBeGreaterThan(QUALITY_PRESETS.high.bitrate);
    expect(QUALITY_PRESETS.high.bitrate).toBeGreaterThan(QUALITY_PRESETS.medium.bitrate);
  });

  describe('getQualityDimensions', () => {
    it('returns portrait dimensions (width < height) for 9:16 aspect ratio', () => {
      const dimensions = getQualityDimensions('high', '9:16');
      expect(dimensions.width).toBe(1080);
      expect(dimensions.height).toBe(1920);
      expect(dimensions.width).toBeLessThan(dimensions.height);
    });

    it('returns landscape dimensions (width > height) for 16:9 aspect ratio by swapping', () => {
      const dimensions = getQualityDimensions('high', '16:9');
      expect(dimensions.width).toBe(1920);
      expect(dimensions.height).toBe(1080);
      expect(dimensions.width).toBeGreaterThan(dimensions.height);
    });

    it('correctly calculates dimensions for ultra (4K)', () => {
      const portrait = getQualityDimensions('ultra', '9:16');
      expect(portrait.width).toBe(2160);
      expect(portrait.height).toBe(3840);

      const landscape = getQualityDimensions('ultra', '16:9');
      expect(landscape.width).toBe(3840);
      expect(landscape.height).toBe(2160);
    });
  });
});
