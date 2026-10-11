import { z } from 'zod';
import { RenderManifestSchema, type RenderManifest } from './renderManifest';
import { assertTimelineValid, type RenderTimeline } from '../../shared/timing/toRenderTimeline';

const ms = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positiveMs = ms.min(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const RenderOptionsV2Schema = z.object({
  aspectRatio: z.enum(['9:16', '16:9']).default('9:16'),
  fps: z.union([z.literal(30), z.literal(60)]).default(30),
  fontFamily: z.enum(['Amiri', 'Amiri Quran', 'Noto Naskh Arabic', 'Scheherazade New', 'Lateef', 'Mada']).default('Amiri Quran'),
  fontSize: z.number().int().min(12).max(120).default(28),
  textColor: z.string().regex(/^#[a-f0-9]{6}$/iu).default('#ffffff'),
  backgroundColor: z.string().regex(/^#[a-f0-9]{6}$/iu).default('#0b1514'),
  padMs: ms.max(150).default(150),
  showSurahName: z.boolean().default(true),
  showReciterName: z.boolean().default(true),
  showAyahNumber: z.boolean().default(true),
}).strict();
export const RenderLabRequestSchema = z.object({
  recitationId: z.string().min(1).max(100), surah: z.number().int().min(1).max(114),
  from: z.number().int().min(1), to: z.number().int().min(1),
  options: RenderOptionsV2Schema.default({}), qa: z.literal(true),
}).strict().refine(r => r.to >= r.from, { message: 'RANGE_NOT_AVAILABLE', path: ['to'] });
export type RenderLabRequest = z.infer<typeof RenderLabRequestSchema>;
export const RenderManifestV2RequestSchema = RenderLabRequestSchema;
export type RenderManifestV2Request = RenderLabRequest;
const timelineWord = z.object({ wordIndex: z.number().int().min(1), occurrenceId: z.string().min(1),
  canonicalWordKey: z.string().regex(/^\d+:\d+:\d+$/u), startMs: ms, endMs: positiveMs }).strict();
const canonicalWord = z.object({ wordIndex: z.number().int().min(1), text: z.string().min(1), canonicalWordKey: z.string() }).strict();
export const RenderManifestV2Schema = z.object({
  schemaVersion: z.literal('2.0.0'), rendererVersion: z.literal('2.0.0'), renderEngine: z.literal('skia_canvas'),
  repetitionDisplayMode: z.literal('canonical'),
  recitation: z.object({ id: z.string().min(1), slug: z.string().min(1), reciterId: z.string().min(1), reciterName: z.string().min(1), providerCode: z.string().min(1) }).strict(),
  canonicalTextVersion: z.object({ id: z.string().min(1), checksum: hash }).strict(),
  canonicalAyahRange: z.object({ surahNumber: z.number().int().min(1).max(114), surahName: z.string().min(1), startAyah: z.number().int().min(1), endAyah: z.number().int().min(1),
    ayahs: z.array(z.object({ numberInSurah: z.number().int().min(1), text: z.string().min(1), words: z.array(canonicalWord).min(1) }).strict()).min(1) }).strict(),
  timeline: z.object({ coordinate: z.literal('render_ms'), durationMs: positiveMs.max(90_000),
    sourceWindow: z.object({ fromMs: ms, toMs: positiveMs }).strict(),
    ayahs: z.array(z.object({ ayah: z.number().int().min(1), startMs: ms, endMs: positiveMs, highlightMode: z.enum(['word', 'ayah']), highlightReason: z.string().optional(), words: z.array(timelineWord) }).strict()).min(1),
    gaps: z.array(z.object({ startMs: ms, endMs: positiveMs, type: z.literal('inter_ayah'), evidence: z.literal('source_timestamps') }).strict()),
  }).strict(),
  audioPlan: z.object({ recitationId: z.string(), mode: z.literal('surah_slice'), coordinate: z.literal('source_ms'), provider: z.string(), license: z.string().nullable(), attribution: z.string().nullable(),
    parts: z.array(z.object({ url: z.string(), sliceFromMs: ms, sliceToMs: positiveMs }).strict()).length(1),
    fallbackUsed: z.boolean(), fallbackReason: z.string().optional(), alternateSourceId: z.string().optional(), allowedHosts: z.array(z.string()),
    sourceIdentity: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('external_url'), url: z.string().url() }).strict(),
      z.object({ kind: z.literal('licensed_r2'), objectKey: z.string().min(1), sha256: hash, sourceId: z.string().min(1) }).strict(),
      z.object({ kind: z.literal('licensed_url'), url: z.string().url(), sha256: hash, sourceId: z.string().min(1) }).strict(),
    ]),
  }).strict(),
  audioPlanHash: hash, timingVersionHash: hash, options: RenderOptionsV2Schema,
  warnings: z.array(z.object({ code: z.string().min(1), ayah: z.number().int().min(1).optional() }).strict()),
}).strict().superRefine((manifest, context) => {
  const fail = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
  try { assertTimelineValid(timelineV2ToShared(manifest.timeline), manifest.timeline.durationMs); }
  catch (error) { fail(error instanceof Error ? error.message : 'TIMELINE_INVALID'); }
  const range = manifest.canonicalAyahRange;
  if (range.endAyah < range.startAyah || range.ayahs.length !== range.endAyah - range.startAyah + 1 || manifest.timeline.ayahs.length !== range.ayahs.length) fail('CANONICAL_RANGE_INVALID');
  range.ayahs.forEach((ayah, i) => {
    if (ayah.numberInSurah !== range.startAyah + i || manifest.timeline.ayahs[i]?.ayah !== ayah.numberInSurah || ayah.words.some((word, index) => word.wordIndex !== index + 1 || word.canonicalWordKey !== `${range.surahNumber}:${ayah.numberInSurah}:${word.wordIndex}`)) fail('CANONICAL_WORDS_INVALID');
    const occurrences = new Set<string>();
    for (const word of manifest.timeline.ayahs[i]?.words ?? []) {
      if (word.canonicalWordKey !== `${range.surahNumber}:${ayah.numberInSurah}:${word.wordIndex}` || !ayah.words[word.wordIndex - 1] || occurrences.has(word.occurrenceId)) fail('TIMELINE_CANONICAL_MAPPING_INVALID');
      occurrences.add(word.occurrenceId);
    }
  });
  const part = manifest.audioPlan.parts[0];
  if (manifest.audioPlan.recitationId !== manifest.recitation.id || part.sliceFromMs !== manifest.timeline.sourceWindow.fromMs || part.sliceToMs !== manifest.timeline.sourceWindow.toMs) fail('AUDIO_PLAN_TIMELINE_MISMATCH');
  if (manifest.audioPlan.sourceIdentity.kind === 'licensed_r2' && part.url !== '') fail('SIGNED_AUDIO_URL_NOT_PERSISTABLE');
});
export type RenderManifestV2 = z.infer<typeof RenderManifestV2Schema>;

export function timelineV2ToShared(timeline: {
  coordinate: 'render_ms'; durationMs: number; sourceWindow: { fromMs: number; toMs: number };
  ayahs: Array<{ ayah: number; startMs: number; endMs: number; highlightMode: 'word'|'ayah'; highlightReason?: string; words: Array<{ wordIndex: number; startMs: number; endMs: number }> }>;
  gaps: NonNullable<RenderTimeline['gaps']>;
}): RenderTimeline {
  return { ...timeline, ayahs: timeline.ayahs.map(a => ({ ...a, words: a.words.map((w, i) => [w.wordIndex, i, w.startMs, w.endMs]) })) };
}
export type RenderManifestV1Internal = RenderManifest & {
  renderV2Timeline: RenderManifestV2['timeline']; renderV2CanonicalAyahs: RenderManifestV2['canonicalAyahRange']['ayahs'];
};
/** Only the native worker uses this adapter. It never invokes legacy validation/auto-healing. */
export function toRenderManifestV1Internal(raw: RenderManifestV2, preparedAudioFile?: string): RenderManifestV1Internal {
  const v2 = RenderManifestV2Schema.parse(raw), portrait = v2.options.aspectRatio === '9:16';
  const audio: RenderManifest['audio'] = { sourceMode: 'single_url', audioUrl: preparedAudioFile ?? (v2.audioPlan.parts[0].url || 'catalog-v2-prepared-audio'), audioContentHash: v2.audioPlanHash, durationSeconds: v2.timeline.durationMs / 1000 };
  // Legacy audio's 500ms UI minimum is not a timing repair rule for server-built v2.
  const legacy = RenderManifestSchema.omit({ audio: true }).parse({
    schemaVersion: '1.0.0', rendererVersion: '1.0.0', renderEngine: 'skia_canvas', revision: v2.timingVersionHash,
    aspectRatio: v2.options.aspectRatio, outputDimensions: portrait ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 }, fps: v2.options.fps,
    reciter: { id: v2.recitation.reciterId, name: v2.recitation.reciterName }, canonicalAyahRange: v2.canonicalAyahRange,
    timingMap: { mapId: v2.timingVersionHash, sourceId: 'catalog_v2', sourceMethod: 'server_catalog_v2', audioContentHash: v2.audioPlanHash,
      validationStatus: 'approved', compositionOffsets: v2.timeline.ayahs.map(a => ({ ayahNumber: a.ayah, startMs: a.startMs, endMs: a.endMs })),
      words: v2.timeline.ayahs.flatMap(a => a.words.map(w => ({ canonicalWordKey: w.canonicalWordKey, occurrenceId: w.occurrenceId, displayWordIndex: w.wordIndex - 1,
        displayToken: v2.canonicalAyahRange.ayahs.find(c => c.numberInSurah === a.ayah)!.words[w.wordIndex - 1].text, startMs: w.startMs, endMs: w.endMs }))), gaps: v2.timeline.gaps },
    background: { id: 'catalog-v2-solid', type: 'color', url: v2.options.backgroundColor, overlayOpacity: 0, shadowIntensity: 0, motionSpeed: 1 },
    typography: { fontFamily: `"${v2.options.fontFamily}", serif`, fontSize: v2.options.fontSize, textColor: v2.options.textColor, shadowIntensity: 0, overlayOpacity: 0 },
    displaySettings: { showAyahText: true, showSurahName: v2.options.showSurahName, showReciterName: v2.options.showReciterName, showAyahNumber: v2.options.showAyahNumber,
      verseDisplayMode: 'full', highlightStyle: 'glow', glowStyle: 'golden', animationProfile: 'karaoke', ayahTransition: 'none', watermarkEnabled: false },
  });
  return { ...legacy, audio, renderV2Timeline: v2.timeline, renderV2CanonicalAyahs: v2.canonicalAyahRange.ayahs };
}
