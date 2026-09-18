import { describe, expect, it } from 'vitest';
import {
  ARABIC_FONT_CATALOG,
  FREE_BACKGROUND_ASSET_URLS,
  getPlanEntitlements,
  type PremiumFeature,
  validateRenderEntitlements,
} from '../../shared/planEntitlements';
import { getH264BroadcastArgs } from '@/lib/ffmpeg';

const freeCatalogBackground = {
  id: 'mosque-1',
  type: 'image',
  category: 'islamic',
  url: `${FREE_BACKGROUND_ASSET_URLS['mosque-1']}?w=1920&q=80`,
  motionSpeed: 1,
};

function makeManifest(overrides: Record<string, unknown> = {}) {
  return {
    qualityPreset: 'high',
    fps: 30,
    outputDimensions: { width: 1080, height: 1920 },
    aspectRatio: '9:16',
    audioBitrate: '192k',
    background: freeCatalogBackground,
    typography: { fontFamily: '"Noto Naskh Arabic", serif' },
    audioEffects: {},
    displaySettings: {},
    ...overrides,
  };
}

describe('Plan entitlement contract', () => {
  it('defines the exact independent Browser Canvas and cloud daily allowances', () => {
    expect(getPlanEntitlements('free')).toMatchObject({
      browserDailyLimit: 5,
      cloudDailyLimit: 1,
      allowedQualities: ['medium', 'high'],
      allowedFps: [30],
    });
    expect(getPlanEntitlements('monthly')).toMatchObject({
      browserDailyLimit: null,
      cloudDailyLimit: 15,
      allowedFps: [30, 60],
    });
    expect(getPlanEntitlements('yearly')).toMatchObject({
      browserDailyLimit: null,
      cloudDailyLimit: 25,
      allowedFps: [30, 60],
    });
  });

  it('keeps every advertised premium capability unavailable to free users and enabled on both paid plans', () => {
    const advertisedPremiumFeatures: PremiumFeature[] = [
      'pexelsVideos',
      'aiBackgrounds',
      'animatedBackgrounds',
      'premiumFonts',
      'customBranding',
      'aiLogo',
      'audioFilters',
      'copyrightProtection',
      'premiumTemplates',
      'prioritySupport',
      'priorityCloudQueue',
      'customBackgrounds',
    ];

    for (const feature of advertisedPremiumFeatures) {
      expect(getPlanEntitlements('free').features[feature]).toBe(false);
      expect(getPlanEntitlements('monthly').features[feature]).toBe(true);
      expect(getPlanEntitlements('yearly').features[feature]).toBe(true);
    }
  });

  it('permits only a curated static basic image and 720p/1080p at 30fps for free cloud renders', () => {
    expect(validateRenderEntitlements('free', makeManifest()).valid).toBe(true);

    const medium = makeManifest({
      qualityPreset: 'medium',
      outputDimensions: { width: 720, height: 1280 },
    });
    expect(validateRenderEntitlements('free', medium).valid).toBe(true);

    const upgraded = validateRenderEntitlements('free', makeManifest({
      qualityPreset: 'ultra',
      fps: 60,
      outputDimensions: { width: 2160, height: 3840 },
      audioBitrate: '320k',
      background: { ...freeCatalogBackground, type: 'video' },
      typography: { fontFamily: '"Amiri Quran", serif' },
      audioEffects: { reverbEnabled: true },
      displaySettings: { logoWatermarkEnabled: true },
    }));
    expect(upgraded.valid).toBe(false);
    expect(upgraded.violations).toHaveLength(7);
  });

  it('rejects a hand-crafted free background even when its category claims to be natural', () => {
    const result = validateRenderEntitlements('free', makeManifest({
      background: {
        id: 'spoofed-nature',
        type: 'image',
        category: 'nature',
        url: 'https://example.test/not-a-free-catalog-asset.jpg',
      },
    }));

    expect(result.valid).toBe(false);
    expect(result.violations).toContain('الخطة المجانية تدعم الخلفيات الإسلامية والطبيعية الثابتة فقط');
  });

  it('rejects animated motion in a free render even for an otherwise allowed still image', () => {
    const result = validateRenderEntitlements('free', makeManifest({
      background: { ...freeCatalogBackground, motionSpeed: 3 },
    }));

    expect(result.valid).toBe(false);
    expect(result.violations).toContain('الخلفيات المتحركة متاحة للعضوية المميزة فقط');
  });

  it('allows the paid 4K/60fps/320kbps configuration for monthly and yearly members', () => {
    const premiumManifest = makeManifest({
      qualityPreset: 'ultra',
      fps: 60,
      outputDimensions: { width: 2160, height: 3840 },
      audioBitrate: '320k',
      background: {
        id: 'premium-video',
        type: 'video',
        category: 'nature',
        url: 'https://assets.mixkit.co/videos/example.mp4',
      },
      typography: { fontFamily: '"Amiri Quran", serif' },
      audioEffects: { reverbEnabled: true, copyrightProtectionEnabled: true },
      displaySettings: { logoWatermarkEnabled: true },
    });

    expect(validateRenderEntitlements('monthly', premiumManifest).valid).toBe(true);
    expect(validateRenderEntitlements('yearly', premiumManifest).valid).toBe(true);
  });

  it('treats Idea 3 as its own full-fidelity engine quota instead of a background flag', () => {
    const free = validateRenderEntitlements('free', makeManifest({ renderEngine: 'browser_cloud' }));
    expect(free.valid).toBe(false);
    expect(free.violations).toContain('محرك المتصفح السحابي الكامل متاح للعضوية المميزة فقط');

    expect(validateRenderEntitlements('monthly', makeManifest({ renderEngine: 'browser_cloud' })).valid).toBe(true);
  });

  it('uses one approved Arabic/Ottoman font catalog for the premium UI and cloud renderer', () => {
    expect(ARABIC_FONT_CATALOG).toHaveLength(16);
    expect(ARABIC_FONT_CATALOG).toContain('"Katibeh", serif');
    expect(ARABIC_FONT_CATALOG).toContain('"Rakkas", serif');
    expect(ARABIC_FONT_CATALOG).toContain('"Lalezar", cursive');
    expect(validateRenderEntitlements('monthly', makeManifest({
      typography: { fontFamily: 'A made-up font' },
    })).valid).toBe(false);
  });

  it('builds a true constant-60fps / 320kbps FFmpeg profile for premium MP4 exports', () => {
    const args = getH264BroadcastArgs(60, '320k');
    expect(args).toContain('-r');
    expect(args[args.indexOf('-r') + 1]).toBe('60');
    expect(args).toContain('-vsync');
    expect(args).toContain('cfr');
    expect(args).toContain('-g');
    expect(args[args.indexOf('-g') + 1]).toBe('120');
    expect(args).toContain('-b:a');
    expect(args[args.indexOf('-b:a') + 1]).toBe('320k');
    expect(args[args.indexOf('-ar') + 1]).toBe('96000');
  });
});
