import { createHash } from 'node:crypto';
import { toRenderTimeline, type SourceAyahTiming } from '../../shared/timing/toRenderTimeline';
import { RenderManifestV2RequestSchema, RenderManifestV2Schema, type RenderManifestV2 } from '../models/renderManifestV2';
import { CatalogError, type CatalogDatabase, type CatalogRow } from './catalogContracts';
import { canonicalAuditJson } from './catalogAudit';
import { assertCatalogAudioUrl, type CatalogAudioSource } from './catalogAudioSource';
import { connectedAyahRuns, isRangeAvailable } from './recitationAvailability';
import { hasVerifiedCatalogOffset } from './recitationAudioResolver';
import { assertLicensedOffsetEvidence } from './licensedAudioVerification';
import type { LicensedSourceResolver } from './licensedSourceResolver';
import type { AudioObjectStorage } from './catalogStorageContracts';

const json = (value: unknown): unknown => typeof value === 'string' ? JSON.parse(value) : value;
const sha = (value: unknown): string => createHash('sha256').update(canonicalAuditJson(value)).digest('hex');
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const enabled = (value: unknown): boolean => value === true || value === 1 || value === '1';
export interface CatalogRenderManifestDependencies {
  db: Pick<CatalogDatabase, 'read'>;
  source: Pick<CatalogAudioSource, 'checkLink'>;
  licensedResolver?: LicensedSourceResolver;
  licensedStorage?: AudioObjectStorage;
}

/** This private QA builder does not mutate, publish, grant rights or consult the public flag. */
export class CatalogRenderManifestService {
  constructor(private readonly dependencies: CatalogRenderManifestDependencies) {}

  async build(raw: unknown): Promise<RenderManifestV2> {
    const parsed = RenderManifestV2RequestSchema.safeParse(raw);
    if (!parsed.success) throw new CatalogError('RENDER_V2_REQUEST_INVALID', 422);
    const request = parsed.data, { db, source, licensedResolver } = this.dependencies;
    const [recitation] = await db.read(`SELECT r.*,e.name_ar reciter_name,p.code provider,p.host_allowlist,p.license_text,p.attribution_text provider_attribution,p.is_active provider_active FROM recitations r JOIN reciters e ON e.id=r.reciter_id JOIN audio_providers p ON p.id=r.provider_id WHERE r.id=?`, [request.recitationId]);
    if (!recitation) throw new CatalogError('RECITATION_NOT_FOUND', 404);
    // Order matters: unlicensed YouTube is never disguised as a technical timing failure.
    const licensed = await licensedResolver?.resolveLicensedSource(request.recitationId, request.surah) ?? null;
    if ((recitation.provider === 'youtube' || recitation.channel === 'youtube') && !licensed) throw new CatalogError('YOUTUBE_RENDER_REQUIRES_LICENSED_FILE', 409);
    if (recitation.riwayah_code !== 'hafs_an_asim' || !enabled(recitation.canonical_text_available)) throw new CatalogError('RECITATION_NOT_TECHNICALLY_ELIGIBLE', 409, { reason: 'HAFS_CANONICAL_REQUIRED' });
    if (['hidden', 'deprecated'].includes(String(recitation.status))) throw new CatalogError('RECITATION_NOT_TECHNICALLY_ELIGIBLE', 409, { reason: 'ADMIN_STATUS_PROTECTED' });
    if (recitation.timing_quality !== 'verified' || !['word', 'letter'].includes(String(recitation.timing_level))) throw new CatalogError('RECITATION_NOT_TECHNICALLY_ELIGIBLE', 409, { reason: 'WORD_TIMING_NOT_VERIFIED' });
    if (!licensed && (recitation.status !== 'published' || recitation.published_by !== 'rule-v1' || recitation.audio_mode !== 'surah_slice' || !hasVerifiedCatalogOffset(recitation))) throw new CatalogError('RECITATION_NOT_TECHNICALLY_ELIGIBLE', 409, { reason: 'OFFSET_OR_RULE_V1_UNVERIFIED' });
    if (recitation.provider_active !== undefined && !enabled(recitation.provider_active)) throw new CatalogError('SOURCE_DISABLED', 409);
    if (licensed) {
      if (licensed.recitationId !== request.recitationId || licensed.surah !== request.surah || licensed.sourceChapterOffsetMs !== licensed.offsetEvidence.sourceChapterOffsetMs || !Number.isFinite(licensed.durationMs) || licensed.durationMs <= 0) throw new CatalogError('LICENSED_OFFSET_NOT_VERIFIED', 409);
      assertLicensedOffsetEvidence(licensed.offsetEvidence, request.recitationId, licensed.sha256, request.surah);
    }
    const conflicts = await db.read("SELECT type,subject_type,subject_id,evidence FROM human_review_items WHERE type='same_audio_conflict'");
    for (const conflict of conflicts) {
      const proof = json(conflict.evidence) as CatalogRow | null;
      if (['recitation', 'recitations'].includes(String(conflict.subject_type)) && conflict.subject_id === request.recitationId
        || ['recitations', 'recitation_ids'].some(key => Array.isArray(proof?.[key]) && (proof![key] as unknown[]).some(id => id === request.recitationId || id === recitation.slug))) throw new CatalogError('RECITATION_NOT_TECHNICALLY_ELIGIBLE', 409, { reason: 'SAME_AUDIO_CONFLICT' });
    }
    const [chapter] = await db.read('SELECT c.*,s.name_ar surah_name,s.ayah_count FROM recitation_chapters c JOIN quran_surahs s ON s.number=c.surah WHERE c.recitation_id=? AND c.surah=?', [request.recitationId, request.surah]);
    if (!chapter || Number(chapter.coverage_mismatch) !== 0) throw new CatalogError('RANGE_NOT_AVAILABLE', 422, { available_runs: [] });
    if (chapter.is_enabled !== null && chapter.is_enabled !== undefined && !enabled(chapter.is_enabled)) throw new CatalogError('SOURCE_DISABLED', 409, { available_runs: [] });
    const versions = await db.read("SELECT v.id,v.checksum FROM quran_text_versions v JOIN riwayat r ON r.id=v.riwayah_id WHERE v.is_active=1 AND r.code='hafs_an_asim' ORDER BY v.id");
    if (versions.length !== 1) throw new CatalogError('ACTIVE_CANONICAL_VERSION_AMBIGUOUS', 503);
    const version = versions[0];
    const canonical = await db.read('SELECT a.id,a.ayah,a.text_uthmani,a.words_count,w.position,w.text_uthmani word_text FROM quran_ayahs a JOIN quran_words w ON w.ayah_id=a.id WHERE a.text_version_id=? AND a.surah=? ORDER BY a.ayah,w.position', [version.id, request.surah]);
    const ayahs = new Map<number, RenderManifestV2['canonicalAyahRange']['ayahs'][number]>();
    const canonicalIds = new Map<number, string>();
    for (const row of canonical) {
      const ayah = Number(row.ayah), position = Number(row.position);
      if (!integer(ayah) || ayah === 0 || !integer(position) || position === 0) throw new CatalogError('CANONICAL_WORDS_INVALID', 503);
      const entry = ayahs.get(ayah) ?? { numberInSurah: ayah, text: String(row.text_uthmani), words: [] };
      if (position !== entry.words.length + 1 || !String(row.word_text)) throw new CatalogError('CANONICAL_WORDS_INVALID', 503);
      entry.words.push({ wordIndex: position, text: String(row.word_text), canonicalWordKey: `${request.surah}:${ayah}:${position}` });
      if (entry.words.length > Number(row.words_count)) throw new CatalogError('CANONICAL_WORDS_INVALID', 503);
      ayahs.set(ayah, entry); canonicalIds.set(ayah, String(row.id));
    }
    if (ayahs.size !== Number(chapter.ayah_count) || [...ayahs.keys()].some((a, i) => a !== i + 1)) throw new CatalogError('CANONICAL_WORDS_INVALID', 503);
    for (const row of canonical) if (ayahs.get(Number(row.ayah))!.words.length !== Number(row.words_count)) throw new CatalogError('CANONICAL_WORDS_INVALID', 503);
    const timings = await db.read('SELECT ayah,ayah_id,coordinate,source,source_offset_ms,start_ms,end_ms,words,review_status,review_reasons,quality,word_highlight_enabled,coverage_words,expected_words,missing_words,version_hash,canonical_checksum,qud_version,source_sha256 FROM ayah_timings WHERE recitation_id=? AND surah=? ORDER BY ayah', [request.recitationId, request.surah]);
    const usable = new Map<number, SourceAyahTiming>();
    const timingRows = new Map<number, CatalogRow>();
    for (const row of timings) {
      const ayah = Number(row.ayah), legal = ayahs.get(ayah);
      if (timingRows.has(ayah)) throw new CatalogError('DUPLICATE_AYAH_TIMING', 503);
      timingRows.set(ayah, row);
      const words = json(row.words), missing = json(row.missing_words), reasons = json(row.review_reasons);
      if (!legal || row.ayah_id !== canonicalIds.get(ayah) || row.canonical_checksum !== version.checksum || row.review_status === 'rejected' || !Array.isArray(words) || !words.length || !Array.isArray(missing) || missing.length || !Array.isArray(reasons)
        || Number(row.expected_words) !== legal.words.length || Number(row.coverage_words) !== legal.words.length) continue;
      const covered = new Set<number>(), occurrences = new Set<number>(); let priorEnd = -1; let valid = true;
      for (const word of words) {
        if (!Array.isArray(word) || word.length !== 4) { valid = false; break; }
        const [index, occurrence, from, to] = word;
        if (index !== null && (!integer(index) || index === 0 || index > legal.words.length) || !integer(occurrence) || occurrences.has(occurrence) || !integer(from) || !integer(to) || to <= from || from < priorEnd) { valid = false; break; }
        if (index !== null) covered.add(index); occurrences.add(occurrence); priorEnd = to;
      }
      if (!valid || covered.size !== legal.words.length || !['ready', 'approved', 'needs_review'].includes(String(row.review_status)) || !['source_ms', 'chapter_ms', 'clip_ms'].includes(String(row.coordinate)) || row.coordinate === 'clip_ms' && (!integer(Number(row.source_offset_ms)) || row.source_offset_ms === null) || !['qud', 'aligner'].includes(String(row.source)) || !['aligned', 'verified', 'estimated'].includes(String(row.quality)) || row.source === 'aligner' && row.review_status !== 'approved') continue;
      usable.set(ayah, { ayah, coordinate: row.coordinate as SourceAyahTiming['coordinate'], source: String(row.source), source_offset_ms: row.source_offset_ms === null ? null : Number(row.source_offset_ms),
        words: words as SourceAyahTiming['words'], quality: String(row.quality), review_status: String(row.review_status), word_highlight_enabled: enabled(row.word_highlight_enabled) && reasons.length === 0 });
    }
    const runs = connectedAyahRuns([...usable.keys()]);
    if (!isRangeAvailable(runs, request.from, request.to)) throw new CatalogError('RANGE_NOT_AVAILABLE', 422, { available_runs: runs });
    const selected = Array.from({ length: request.to - request.from + 1 }, (_, i) => usable.get(request.from + i)!);
    const timeline = toRenderTimeline(selected, { chapterOffsetMs: licensed?.sourceChapterOffsetMs ?? (chapter.chapter_offset_ms === null ? 0 : Number(chapter.chapter_offset_ms)), sourceFormat: 'qud_release', padMs: request.options.padMs, allowAyahOnly: true });
    if (timeline.durationMs > 90_000) throw new CatalogError('MAX_RENDER_DURATION_EXCEEDED', 422, { maximum_duration_ms: 90_000 });
    if (licensed && timeline.sourceWindow.toMs > licensed.durationMs + 30) throw new CatalogError('LICENSED_TIMING_COORDINATES_INVALID', 409);
    const hosts = json(recitation.host_allowlist);
    if (!Array.isArray(hosts) || hosts.some(host => typeof host !== 'string')) throw new CatalogError('AUDIO_PROVIDER_INVALID', 503);
    let url = '', allowedHosts = hosts as string[];
    let identity: RenderManifestV2['audioPlan']['sourceIdentity'];
    if (licensed?.adapter === 'r2') identity = { kind: 'licensed_r2', objectKey: licensed.objectKey, sha256: licensed.sha256, sourceId: licensed.sourceId };
    else if (licensed) { url = licensed.url; allowedHosts = licensed.allowedHosts; identity = { kind: 'licensed_url', url, sha256: licensed.sha256, sourceId: licensed.sourceId }; }
    else {
      const primary = String(chapter.audio_url); assertCatalogAudioUrl(primary, allowedHosts);
      const health = await source.checkLink(primary, allowedHosts);
      if (health.status !== 'available') throw new CatalogError(health.status === 'AUDIO_RATE_LIMITED' ? 'AUDIO_RATE_LIMITED' : 'AUDIO_UNAVAILABLE', health.httpStatus === 429 ? 429 : 502);
      url = health.finalUrl ?? primary; assertCatalogAudioUrl(url, allowedHosts); identity = { kind: 'external_url', url };
    }
    const audioPlan: RenderManifestV2['audioPlan'] = { recitationId: request.recitationId, mode: 'surah_slice', coordinate: 'source_ms', provider: licensed ? 'licensed_file' : String(recitation.provider),
      license: licensed ? 'admin_owned_or_licensed' : recitation.license_text === null ? null : String(recitation.license_text),
      attribution: recitation.attribution_text || recitation.provider_attribution ? String(recitation.attribution_text || recitation.provider_attribution) : null,
      parts: [{ url, sliceFromMs: timeline.sourceWindow.fromMs, sliceToMs: timeline.sourceWindow.toMs }], fallbackUsed: !!licensed,
      ...(licensed ? { fallbackReason: 'EXPLICIT_LICENSED_SAME_RECORDING', alternateSourceId: licensed.sourceId } : {}), allowedHosts, sourceIdentity: identity };
    const rangeAyahs = selected.map(row => ayahs.get(row.ayah)!);
    const outputTimeline: RenderManifestV2['timeline'] = { ...timeline, gaps: timeline.gaps ?? [], ayahs: timeline.ayahs.map(row => ({ ...row, highlightMode: row.highlightMode!,
      words: row.words.map(([index, occurrence, startMs, endMs], sequence) => ({ wordIndex: index, occurrenceId: `${request.surah}:${row.ayah}:${index}:${occurrence}:${sequence}`, canonicalWordKey: `${request.surah}:${row.ayah}:${index}`, startMs, endMs })) })) };
    const warnings = outputTimeline.ayahs.filter(a => a.highlightMode === 'ayah').map(a => ({ code: a.highlightReason ?? 'AYAH_ONLY', ayah: a.ayah }));
    const canonicalRange = { surahNumber: request.surah, surahName: String(chapter.surah_name), startAyah: request.from, endAyah: request.to, ayahs: rangeAyahs };
    return RenderManifestV2Schema.parse({ schemaVersion: '2.0.0', rendererVersion: '2.0.0', renderEngine: 'skia_canvas', repetitionDisplayMode: 'canonical',
      recitation: { id: request.recitationId, slug: String(recitation.slug), reciterId: String(recitation.reciter_id), reciterName: String(recitation.reciter_name), providerCode: String(recitation.provider) },
      canonicalTextVersion: { id: String(version.id), checksum: String(version.checksum) }, canonicalAyahRange: canonicalRange,
      timeline: outputTimeline, audioPlan, audioPlanHash: sha(audioPlan),
      timingVersionHash: sha({ canonicalTextVersion: version, canonicalRange, timeline: outputTimeline, rows: selected.map(a => timingRows.get(a.ayah)), warnings }), options: request.options, warnings });
  }
}
