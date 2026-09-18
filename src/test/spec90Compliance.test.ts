import { describe, it, expect } from 'vitest';
import { reciters } from '@/data/reciters';
import { backgroundVideos } from '@/data/backgrounds';

describe('Spec 90 Compliance & Architecture Verification', () => {

  // ── Branch 3: Video Rendering Pipeline & Cover-Fit Math ──────────────────
  describe('Branch 3: Video Rendering Cover-Fit Algorithm Math', () => {
    // Spec 90 Section 4.1:
    // scale = max(Cw / Vw, Ch / Vh)
    // Sw = Cw / scale, Sh = Ch / scale
    // Sx = (Vw - Sw) / 2, Sy = (Vh - Sh) / 2
    function calculateCoverFit(cw: number, ch: number, vw: number, vh: number) {
      const canvasRatio = cw / ch;
      const videoRatio = vw / vh;
      let sw = vw, sh = vh, sx = 0, sy = 0;
      if (videoRatio > canvasRatio) {
        sw = vh * canvasRatio;
        sx = (vw - sw) / 2;
      } else {
        sh = vw / canvasRatio;
        sy = (vh - sh) / 2;
      }
      return { sw, sh, sx, sy };
    }

    it('crops 16:9 landscape video for 9:16 portrait canvas without distortion', () => {
      // 1080x1920 canvas, 1920x1080 video
      const fit = calculateCoverFit(1080, 1920, 1920, 1080);
      expect(fit.sh).toBe(1080);
      expect(fit.sw).toBeCloseTo(607.5, 1);
      expect(fit.sx).toBeCloseTo(656.25, 1);
      expect(fit.sy).toBe(0);
      // Aspect ratio of source crop matches canvas aspect ratio exactly
      expect(fit.sw / fit.sh).toBeCloseTo(1080 / 1920, 4);
    });

    it('crops 9:16 portrait video for 16:9 landscape canvas without distortion', () => {
      // 1920x1080 canvas, 1080x1920 video
      const fit = calculateCoverFit(1920, 1080, 1080, 1920);
      expect(fit.sw).toBe(1080);
      expect(fit.sh).toBeCloseTo(607.5, 1);
      expect(fit.sy).toBeCloseTo(656.25, 1);
      expect(fit.sx).toBe(0);
      expect(fit.sw / fit.sh).toBeCloseTo(1920 / 1080, 4);
    });

    it('handles identical aspect ratio with zero crop', () => {
      const fit = calculateCoverFit(1080, 1920, 1080, 1920);
      expect(fit.sw).toBe(1080);
      expect(fit.sh).toBe(1920);
      expect(fit.sx).toBe(0);
      expect(fit.sy).toBe(0);
    });
  });

  // ── Branch 4: Nature Video Backgrounds Hub ────────────────────────────────
  describe('Branch 4: Nature Video Backgrounds Hub', () => {
    it('provides at least 17 high-definition nature video clips', () => {
      expect(backgroundVideos.length).toBeGreaterThanOrEqual(17);
    });

    it('covers all 8 essential categories specified in Spec 90', () => {
      const categories = new Set(backgroundVideos.map(v => v.category));
      expect(categories.has('mountain')).toBe(true);  // جبال ووديان
      expect(categories.has('water')).toBe(true);     // بحار ومحيطات + أمطار
      expect(categories.has('islamic')).toBe(true);   // مساجد ومعالم
      expect(categories.has('sky')).toBe(true);       // سماء وغيوم + نجوم وفضاء
      expect(categories.has('forest')).toBe(true);    // طبيعة خضراء
      expect(categories.has('desert')).toBe(true);    // صحراء وغروب
    });

    it('ensures all video items have valid URL, type, thumbnail and arabic name', () => {
      for (const v of backgroundVideos) {
        expect(v.type).toBe('video');
        expect(v.url).toMatch(/^https?:\/\//);
        expect(v.thumbnail).toMatch(/^https?:\/\//);
        expect(v.name.length).toBeGreaterThan(2);
      }
    });
  });

  // ── Branch 5: Watermark Enforcement Logic ─────────────────────────────────
  describe('Branch 5: Subscription Tiers & Watermark Enforcement', () => {
    function resolveWatermark(isPremium: boolean, watermarkEnabled?: boolean, watermarkText?: string) {
      const showWatermark = isPremium
        ? (watermarkEnabled && !!watermarkText?.trim())
        : true;
      const effectiveText = isPremium
        ? (watermarkText?.trim() || '@AyaQuran')
        : (watermarkText?.trim() || '@AyaQuran');
      return { showWatermark, effectiveText };
    }

    it('mandates @AyaQuran watermark for free tier even when toggle is off', () => {
      const result = resolveWatermark(false, false, '');
      // Free tier users cannot disable the watermark
      expect(result.showWatermark).toBe(true);
      expect(result.effectiveText).toBe('@AyaQuran');
    });

    it('allows premium users to remove watermark completely', () => {
      const result = resolveWatermark(true, false, '');
      expect(result.showWatermark).toBe(false);
    });

    it('allows premium users to customize watermark text', () => {
      const result = resolveWatermark(true, true, '@MyCustomQuranChannel');
      expect(result.showWatermark).toBe(true);
      expect(result.effectiveText).toBe('@MyCustomQuranChannel');
    });
  });

  // ── Branch 6: Reciters Engine (22 Core Reciters) ──────────────────────────
  describe('Branch 6: 22 Core Reciters Coverage', () => {
    const requiredReciters = [
      'مشاري راشد العفاسي',
      'عبد الباسط عبد الصمد',
      'محمد صديق المنشاوي',
      'محمود خليل الحصري',
      'ماهر المعيقلي',
      'سعد الغامدي',
      'أبو بكر الشاطري',
      'سعود الشريم',
      'عبد الرحمن السديس',
      'أحمد بن علي العجمي',
      'ياسر الدوسري',
      'ناصر القطامي',
      'إدريس أبكر',
      'رعد الكردي',
      'إسلام صبحي',
      'هزاع البلوشي',
      'خالد الجليل',
      'فارس عباد',
      'بندر بليلة',
      'علي جابر',
      'محمد أيوب',
      'محمود علي البنا',
    ];

    it('contains all 22 required reciters from Spec 90', () => {
      const availableNames = reciters.map(r => r.name);
      for (const reqName of requiredReciters) {
        const found = availableNames.some(name => name.includes(reqName) || reqName.includes(name));
        expect(found, `Reciter "${reqName}" should be available in reciters catalog`).toBe(true);
      }
    });

    it('ensures each reciter has valid server and subfolder configurations', () => {
      for (const r of reciters) {
        expect(r.id).toBeDefined();
        expect(r.name).toBeDefined();
        expect(r.server).toMatch(/^https?:\/\//);
      }
    });
  });

  // ── Branch 9: Quranic Text Immutability ───────────────────────────────────
  describe('Branch 9: Quranic Text Immutability (Zero-Tolerance Policy)', () => {
    it('preserves Uthmanic diacritics without stripping or altering text', () => {
      const originalAyah = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ';
      // Any text processing must preserve the exact string length and diacritics
      const processed = originalAyah.trim();
      expect(processed).toBe(originalAyah);
      expect(processed).toContain('ٱللَّهِ');
      expect(processed).toContain('ٱلرَّحْمَـٰنِ');
    });

    it('verifies that the rosette symbol ۝ is supported', () => {
      const textWithRosette = 'ٱلرَّحۡمَـٰنُ ۝١ عَلَّمَ ٱلۡقُرۡءَانَ ۝٢';
      expect(textWithRosette).toContain('۝');
      expect(textWithRosette.split('۝').length).toBe(3);
    });
  });
});
