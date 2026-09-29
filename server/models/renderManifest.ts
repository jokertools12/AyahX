import { z } from 'zod';

const animationProfileSchema = z.enum([
  'static',
  'karaoke',
  'teleprompter',
  'reveal',
  'fade',
  'spotlight',
  'isolate',
  'consume',
]);

const timingSubsegmentSchema = z.object({
  occurrenceId: z.string().min(1).max(180),
  token: z.string().max(120),
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  confidence: z.number().min(0).max(1),
  flags: z.array(z.string().max(64)).optional(),
}).refine((segment) => segment.endMs > segment.startMs, {
  message: 'timing subsegment endMs must be greater than startMs',
});

const alignmentProvenanceSchema = z.object({
  provider: z.enum([
    'quran_foundation',
    'manual',
    'internal_ctc',
    'quranic_universal_aligner',
    'lafzize',
    'verified_dataset',
    'unknown',
  ]),
  providerVersion: z.string().max(128).optional(),
  providerResultId: z.string().max(256).optional(),
  requestedGranularity: z.enum(['word', 'letter', 'phoneme']),
  availableGranularities: z.array(z.enum(['word', 'letter', 'phoneme'])).min(1),
  modelId: z.string().max(256).optional(),
  modelVersion: z.string().max(128).optional(),
  checkpointSha256: z.string().regex(/^[a-fA-F0-9]{32,128}$/).optional(),
  preprocessingVersion: z.string().max(128).optional(),
  quranEdition: z.string().max(128).optional(),
  riwayah: z.string().max(64).optional(),
  license: z.string().max(256).optional(),
  inputAudioSha256: z.string().max(128).optional(),
  parentMapId: z.string().max(256).optional(),
  createdBy: z.enum(['provider', 'manual_review', 'dataset_import']).optional(),
}).optional();

const alignmentReviewSchema = z.object({
  status: z.enum(['unreviewed', 'needs_review', 'approved', 'rejected']),
  reviewerId: z.string().max(128).optional(),
  reviewedAt: z.string().max(64).optional(),
  note: z.string().max(2000).optional(),
}).optional();

export const RenderManifestSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  rendererVersion: z.literal('1.0.0'),
  renderEngine: z.enum(['browser', 'ffmpeg_ass', 'skia_canvas', 'browser_cloud']).default('ffmpeg_ass'),
  backgroundAsync: z.boolean().default(false),
  revision: z.string().min(1).max(128),
  aspectRatio: z.enum(['9:16', '16:9']),
  outputDimensions: z.object({
    width: z.number().int().min(360).max(3840),
    height: z.number().int().min(360).max(3840),
  }),
  fps: z.number().int().min(15).max(60).default(30),
  animationProfile: animationProfileSchema.default('karaoke'),
  animationReducedMotion: z.boolean().default(false),
  qualityPreset: z.enum(['low', 'medium', 'high', 'ultra']).default('high'),
  audioBitrate: z.enum(['128k', '192k', '320k']).default('192k'),
  codecProfile: z.enum(['high-4.1', 'main-4.0', 'baseline']).default('high-4.1'),
  
  reciter: z.object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(200),
    quranFoundationId: z.number().int().optional(),
    everyAyahSubfolder: z.string().optional(),
  }),

  canonicalAyahRange: z.object({
    surahNumber: z.number().int().min(1).max(114),
    surahName: z.string().min(1).max(100),
    startAyah: z.number().int().min(1),
    endAyah: z.number().int().min(1),
    ayahs: z.array(
      z.object({
        numberInSurah: z.number().int().min(1),
        text: z.string().min(1),
      })
    ).min(1),
  }),

  // Ibtahalat reuses the exact scene shell but provides time-bounded lyric
  // lines rather than Quran word spans. Keeping this in the manifest makes
  // Browser Hybrid, FFmpeg, Skia, and Browser Cloud render the same mode.
  contentKind: z.enum(['quran', 'lyrics']).default('quran'),
  lyrics: z.array(
    z.object({
      text: z.string().min(1).max(1000),
      start: z.number().min(0),
      end: z.number().min(0),
    }).refine((line) => line.end > line.start, {
      message: 'lyric end must be greater than start',
    })
  ).optional(),

  timingMap: z.object({
    mapId: z.string().min(1),
    // The browser preview and native scene workers use this explicit metadata
    // to resolve whether word offsets belong to the full source recitation or
    // to a local sliced timeline.
    sourceId: z.string().min(1).optional(),
    sourceMethod: z.string().min(1).optional(),
    audioContentHash: z.string().min(8),
    audioFingerprintKind: z.enum(['audio_bytes_sha256', 'dataset_asset_identity_sha256']).optional(),
    createdAt: z.string().datetime().optional(),
    validationStatus: z.enum(['approved', 'low_confidence', 'needs_review', 'rejected']),
    alignment: alignmentProvenanceSchema,
    review: alignmentReviewSchema,
    compositionOffsets: z.array(
      z.object({
        ayahNumber: z.number().int().min(1),
        startMs: z.number().min(0),
        endMs: z.number().min(0),
      }).refine((offset) => offset.endMs > offset.startMs, {
        message: 'composition offset endMs must be greater than startMs',
      })
    ).optional(),
    words: z.array(
      z.object({
        canonicalWordKey: z.string(),
        displayWordIndex: z.number().int().min(0),
        displayToken: z.string(),
        occurrenceId: z.string().min(1).max(180).optional(),
        startMs: z.number().min(0),
        endMs: z.number().min(0),
        confidence: z.number().min(0).max(1).optional(),
        letters: z.array(timingSubsegmentSchema).optional(),
        phonemes: z.array(timingSubsegmentSchema).optional(),
      }).refine((word) => word.endMs > word.startMs, {
        message: 'timing word endMs must be greater than startMs',
      })
    ),
    gaps: z.array(
      z.object({
        startMs: z.number().min(0),
        endMs: z.number().min(0),
        type: z.enum([
          'waqf',
          'silence',
          'breath',
          'intro',
          'outro',
          'inter_word',
          'inter_ayah',
          'acoustic_silence',
        ]),
      })
    ).optional(),
  }),

  audio: z.object({
    sourceMode: z.enum(['qf', 'everyayah', 'single_url']),
    audioUrl: z.string().min(1).max(2048),
    audioContentHash: z.string().min(8),
    durationSeconds: z.number().min(0.5).max(1200), // Max 20 minutes
    rangeMs: z.object({
      from: z.number().min(0),
      to: z.number().min(0),
    }).nullable().optional(),
    everyAyahUrls: z.array(z.string().max(2048)).optional(),
    everyAyahTimestamps: z.array(
      z.object({
        from: z.number().min(0),
        to: z.number().min(0),
      })
    ).optional(),
  }),

  audioEffects: z.object({
    reverbEnabled: z.boolean().default(false),
    reverbLevel: z.number().min(0).max(1).default(0.5),
    echoEnabled: z.boolean().default(false),
    echoDelay: z.number().min(0.05).max(2).default(0.3),
    echoFeedback: z.number().min(0.05).max(0.9).default(0.4),
    pitchShift: z.number().optional(),
    speedAdjust: z.number().optional(),
    copyrightProtectionEnabled: z.boolean().default(false),
    normalizeEnabled: z.boolean().default(false),
    eqEnabled: z.boolean().default(false),
    volume: z.number().min(0.1).max(3.0).default(1.25).optional(),
  }).optional(),

  // A premium AI/custom image may be sent as a data URL. The request parser
  // has a 60 MB ceiling; keep every individual inline visual comfortably
  // below it while still allowing a high-resolution portrait background.
  background: z.object({
    id: z.string().min(1).max(128),
    type: z.enum(['video', 'image', 'slideshow', 'color']),
    url: z.string().max(16 * 1024 * 1024),
    thumbnail: z.string().max(16 * 1024 * 1024).optional(),
    category: z.string().optional(),
    slideImages: z.array(z.string().max(1024)).optional(),
    framesPattern: z.string().max(1024).optional(),
    overlayOpacity: z.number().min(0).max(1).default(0.4),
    shadowIntensity: z.number().min(0).max(1).default(0.5),
    motionSpeed: z.number().min(1).max(10).default(3),
  }),

  typography: z.object({
    fontSize: z.number().min(12).max(120).default(28),
    fontFamily: z.string().min(1).max(100).default('"Noto Naskh Arabic", serif'),
    textColor: z.string().regex(/^#[0-9a-fA-F]{6}$|^rgba?\(/).default('#ffffff'),
    shadowIntensity: z.number().min(0).max(1).default(0.5),
    overlayOpacity: z.number().min(0).max(1).default(0.4),
  }),

  displaySettings: z.object({
    visualDesign: z.enum(['dawn', 'editorial', 'moonlit']).default('dawn'),
    showSurahName: z.boolean().default(false),
    showReciterName: z.boolean().default(false),
    showAyahText: z.boolean().default(true),
    showAyahNumber: z.boolean().default(false),
    highlightStyle: z.enum(['none', 'solid', 'glow', 'underline', 'shadow']).default('glow'),
    frameStyle: z.enum(['none', 'simple', 'ornate', 'golden', 'geometric', 'modern', 'minimal']).default('none'),
    screenBorderStyle: z.enum(['none', 'goldenTrim', 'islamicCorners', 'doubleCinema', 'royalCrest', 'subtleVignette']).default('none'),
    screenBorderColor: z.enum(['gold', 'emerald', 'silver', 'white']).default('gold'),
    ayahNumberStyle: z.enum(['quran3d', 'circle', 'star', 'diamond', 'octagon', 'flower', 'square', 'hexagon']).default('quran3d'),
    ayahNumberColor: z.enum(['gold', 'metallicGold3D', 'white', 'silver', 'emerald', 'royal']).default('metallicGold3D'),
  verseDisplayMode: z.enum(['full', 'twoWords', 'threeTwo', 'wordByWord', 'letterByLetter']).default('full'),
    surahNamePosition: z.enum(['top', 'bottom', 'topLeft', 'topRight', 'center']).default('top'),
    surahNameStyle: z.enum(['classic', 'goldenBadge', 'banner', 'calligraphy', 'circle', 'diamond', 'ribbon', 'modern', 'ornate', 'minimal']).default('classic'),
    reciterNameStyle: z.enum(['simple', 'elegant', 'audioPill', 'badge', 'tag', 'glow', 'pill', 'gold', 'bordered']).default('simple'),
    textShadowStyle: z.enum(['none', 'soft', 'strong', '3d', 'glow', 'outline', 'double']).default('none'),
    ayahTransition: z.enum(['none', 'fade', 'slide', 'zoom', 'blur', 'rise', 'rotate', 'cinematic', 'elastic', 'random']).default('fade'),
    
    // Legacy Watermark
    watermarkEnabled: z.boolean().default(false),
    watermarkText: z.string().max(100).default('@AyaQuran'),
    watermarkPosition: z.enum(['bottomLeft', 'bottomRight', 'topLeft', 'topRight', 'bottomCenter']).default('bottomRight'),

    // Dual-mode Watermark: Logo
    logoWatermarkEnabled: z.boolean().optional().default(false),
    logoWatermarkPreset: z.enum(['goldCalligraphy', 'circularMedallion', 'custom']).optional().default('goldCalligraphy'),
    logoWatermarkUrl: z.string().optional().default(''),
    logoWatermarkPosition: z.enum(['topRight', 'topLeft', 'bottomRight', 'bottomLeft']).optional().default('topRight'),
    logoWatermarkSize: z.number().min(20).max(300).optional().default(76),
    logoWatermarkOpacity: z.number().min(0).max(1).optional().default(0.95),
    logoBrandName: z.string().max(100).optional().default('آيات قرآنية'),
    logoSubtitle: z.string().max(100).optional().default('تلاوات خاشعة'),

    // Dual-mode Watermark: Social Handle
    socialWatermarkEnabled: z.boolean().optional().default(false),
    socialPlatform: z.enum(['facebook', 'instagram', 'tiktok', 'youtube', 'x', 'custom']).optional().default('facebook'),
    socialHandle: z.string().max(100).optional().default(''),
    socialWatermarkPosition: z.enum(['bottomCenter', 'bottomRight', 'bottomLeft', 'topCenter']).optional().default('bottomCenter'),
    socialWatermarkSize: z.number().min(8).max(100).optional().default(18),
    socialWatermarkOpacity: z.number().min(0).max(1).optional().default(0.9),

    glowStyle: z.enum(['none', 'golden', 'soft', 'neon', 'pulse', 'emerald', 'royal']).default('golden'),
    lyricsDisplayStyle: z.enum(['scroll', 'single', 'karaoke', 'fade']).optional().default('scroll'),
    slideshowTransition: z.enum(['crossfade', 'slideLeft', 'slideRight', 'slideUp', 'zoomThrough', 'wipe', 'mixed']).default('crossfade'),
  }).passthrough(),

  outputFormat: z.literal('mp4').default('mp4'),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

export type RenderManifest = z.infer<typeof RenderManifestSchema>;

export interface ValidationResult {
  valid: boolean;
  manifest?: RenderManifest;
  errors?: string[];
}

function validateManifestTimingIntervals(manifest: RenderManifest, errors: string[]): void {
  const words = manifest.timingMap.words || [];
  const occurrenceIds = new Set<string>();
  // Quran Foundation maps can be absolute chapter-clock timestamps while the
  // submitted audio is a clipped range. Validate against that explicit range
  // rather than mistaking an absolute offset for an overlong word.
  const timingWindowStart = manifest.audio.rangeMs?.from ?? 0;
  const durationMs = manifest.audio.rangeMs?.to ?? (timingWindowStart + manifest.audio.durationSeconds * 1000);
  let previousEnd = -1;
  words.forEach((word, index) => {
    const occurrenceId = word.occurrenceId || `${word.canonicalWordKey}:${index + 1}`;
    if (occurrenceIds.has(occurrenceId)) errors.push(`timingMap.words[${index}]: duplicate occurrenceId`);
    occurrenceIds.add(occurrenceId);
    if (index > 0 && word.startMs < previousEnd) {
      errors.push(`timingMap.words[${index}]: intervals overlap or are out of order`);
    }
    if (word.startMs < Math.max(0, timingWindowStart - 150) || word.endMs > durationMs + 150) {
      errors.push(`timingMap.words[${index}]: interval exceeds audio duration`);
    }
    previousEnd = Math.max(previousEnd, word.endMs);
    for (const kind of ['letters', 'phonemes'] as const) {
      const segments = word[kind] || [];
      const segmentIds = new Set<string>();
      let segmentEnd = word.startMs;
      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
        const segment = segments[segmentIndex];
        if (segmentIds.has(segment.occurrenceId)) {
          errors.push(`timingMap.words[${index}].${kind}[${segmentIndex}]: duplicate occurrenceId`);
        }
        segmentIds.add(segment.occurrenceId);
        if (segment.startMs < word.startMs || segment.endMs > word.endMs || segment.startMs < segmentEnd) {
          errors.push(`timingMap.words[${index}].${kind}[${segmentIndex}]: outside parent interval or overlapping`);
        }
        segmentEnd = Math.max(segmentEnd, segment.endMs);
      }
    }
  });
  for (const [index, gap] of (manifest.timingMap.gaps || []).entries()) {
    if (gap.endMs <= gap.startMs) errors.push(`timingMap.gaps[${index}]: endMs must be greater than startMs`);
  }
}

/**
 * Validates an incoming RenderManifest object against the schema and security rules
 */
export function validateRenderManifest(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['بيانات أمر الريندر غير صالحة (RenderManifest must be an object)'] };
  }

  // Auto-heal defense-in-depth: if client sent blob URL for audio, fallback to EveryAyah CDN if available
  const manifestData = raw as any;
  if (manifestData?.audio) {
    const audioObj = manifestData.audio;
    if (typeof audioObj.audioUrl === 'string' && audioObj.audioUrl.startsWith('blob:')) {
      if (Array.isArray(audioObj.everyAyahUrls) && audioObj.everyAyahUrls.length > 0) {
        audioObj.audioUrl = audioObj.everyAyahUrls[0];
      } else if (manifestData.reciter && manifestData.canonicalAyahRange) {
        const subfolder = manifestData.reciter.everyAyahSubfolder;
        const surah = manifestData.canonicalAyahRange.surahNumber;
        const start = manifestData.canonicalAyahRange.startAyah;
        if (subfolder && surah && start) {
          const pSurah = surah.toString().padStart(3, '0');
          const pAyah = start.toString().padStart(3, '0');
          audioObj.audioUrl = `https://everyayah.com/data/${subfolder}/${pSurah}${pAyah}.mp3`;
        } else if (manifestData.reciter?.server && surah) {
          const pSurah = surah.toString().padStart(3, '0');
          audioObj.audioUrl = `${manifestData.reciter.server}/${pSurah}.mp3`;
        }
      }
    }
  }

  const parseResult = RenderManifestSchema.safeParse(raw);
  if (!parseResult.success) {
    const errorDetails = parseResult.error.errors.map(
      (e) => `${e.path.join('.')}: ${e.message}`
    );
    return { valid: false, errors: errorDetails };
  }

  const manifest = parseResult.data;
  const errors: string[] = [];

  validateManifestTimingIntervals(manifest, errors);

  // An animation map and its render audio must identify the exact same bytes.
  // A range may be clipped from that source, but it may not swap in a second
  // recording with superficially compatible timestamps.
  if (manifest.timingMap.validationStatus === 'approved'
    && manifest.timingMap.audioContentHash !== manifest.audio.audioContentHash) {
    errors.push('timingMap audio hash must match render audio hash for approved timing.');
  }

  const isQuranFoundationTiming = manifest.timingMap.sourceId === 'quran_foundation'
    || manifest.timingMap.alignment?.provider === 'quran_foundation'
    || manifest.audio.sourceMode === 'qf';
  if (isQuranFoundationTiming) {
    const timingCreatedAt = Date.parse(manifest.timingMap.createdAt || '');
    if (!Number.isFinite(timingCreatedAt)) {
      errors.push('QF_TIMING_MAP_CREATED_AT_REQUIRED');
    } else if (timingCreatedAt > Date.now() + 5 * 60_000) {
      errors.push('QF_TIMING_MAP_CREATED_AT_INVALID');
    } else if (Date.now() - timingCreatedAt >= 5 * 24 * 60 * 60_000) {
      errors.push('QF_TIMING_MAP_EXPIRED');
    }
  }

  // An approved word map is bound to the original audio clock.  Any tempo
  // transform changes every word boundary, so require a new reviewed map
  // rather than rendering a visually plausible but inaccurate highlight.
  const audioEffects = manifest.audioEffects;
  const changesAudioClock = Boolean(audioEffects?.copyrightProtectionEnabled)
    || (typeof audioEffects?.speedAdjust === 'number' && Math.abs(audioEffects.speedAdjust - 1) > 0.0001);
  if (manifest.timingMap.validationStatus === 'approved' && changesAudioClock) {
    errors.push('Approved word timing cannot be exported after an audio speed change. Re-align or disable the speed transform.');
  }

  // This legacy field previously requested audio fingerprint alteration.  It
  // is retired: a project must use audio it is licensed to publish, and this
  // renderer must not offer a mechanism intended to evade platform matching.
  if (audioEffects?.copyrightProtectionEnabled) {
    errors.push('The retired copyrightProtectionEnabled audio transform is not supported.');
  }

  // Dimension sanity check
  if (manifest.aspectRatio === '9:16' && manifest.outputDimensions.width > manifest.outputDimensions.height) {
    errors.push('Aspect ratio 9:16 requires portrait dimensions (height > width).');
  } else if (manifest.aspectRatio === '16:9' && manifest.outputDimensions.width < manifest.outputDimensions.height) {
    errors.push('Aspect ratio 16:9 requires landscape dimensions (width > height).');
  }

  // Surah ayah range sanity check
  if (manifest.canonicalAyahRange.startAyah > manifest.canonicalAyahRange.endAyah) {
    errors.push('startAyah cannot be greater than endAyah.');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, manifest };
}
