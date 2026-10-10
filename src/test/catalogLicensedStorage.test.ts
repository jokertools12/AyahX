// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import { AUDIO_OBJECT_LIMIT_BYTES, assertStorageSize, assertSignedExpiry, licensedObjectKey, validateBatchAudioNames, type AudioObjectStorage } from '../../server/services/catalogStorageContracts';
import { S3LicensedAudioStorage, UrlReferenceAudioStorage, validateS3AudioConfig } from '../../server/services/catalogObjectStorage';
import { audioMagic, parseAudioProbe, assertLicensedOffsetEvidence, type LicensedOffsetEvidence } from '../../server/services/licensedAudioVerification';
import { CatalogLicensedSourceResolver } from '../../server/services/licensedSourceResolver';
import { CatalogStorageAdminService } from '../../server/services/catalogStorageAdminService';
import { reconcileAudioStorage, audioStorageManifest, estimateAudioStorageCost } from '../../server/services/catalogStorageReconciliation';
import type { CatalogDatabase, CatalogRow } from '../../server/services/catalogContracts';
import { catalogStorageFromEnvironment } from '../../server/services/catalogStorageRuntime';

const sha = 'a'.repeat(64);
const evidence = (): LicensedOffsetEvidence => ({ method: 'v1', sourceSha256: sha, recitationId: 'r1', sourceSurah: 1, sourceChapterOffsetMs: 0, qudVersion: 'v3.2.0', protocol: 'distributed_3_surahs_interior_300ms', samples: [{ surah: 1, ayah: 1, chapterAyahCount: 7, ncc: .95, lagMs: 30, durationDifferenceMs: 30 }, { surah: 1, ayah: 4, chapterAyahCount: 7, ncc: 1, lagMs: 0, durationDifferenceMs: 0 }, { surah: 36, ayah: 2, chapterAyahCount: 83, ncc: 1, lagMs: 0, durationDifferenceMs: 0 }, { surah: 36, ayah: 70, chapterAyahCount: 83, ncc: 1, lagMs: 0, durationDifferenceMs: 0 }, { surah: 112, ayah: 4, chapterAyahCount: 4, ncc: 1, lagMs: 0, durationDifferenceMs: 0 }] });
const storage = (): AudioObjectStorage => ({ adapter: 'r2', bucket: 'test-audio', head: vi.fn(async () => ({ sizeBytes: 100, contentType: 'audio/mpeg', etag: 'e' })), read: vi.fn(async () => ({ body: Readable.from(Buffer.alloc(100)), head: { sizeBytes: 100, contentType: 'audio/mpeg', etag: 'e' } })), presignGet: vi.fn(), presignPut: vi.fn(), beginMultipart: vi.fn(), presignPart: vi.fn(), listParts: vi.fn(), completeMultipart: vi.fn(), abortMultipart: vi.fn(), listObjects: vi.fn(), deleteObject: vi.fn() });
const database = (rows: CatalogRow[] = []): CatalogDatabase => ({ read: vi.fn(async () => rows), execute: vi.fn(), transaction: vi.fn() });
describe('licensed audio boundaries', () => {
  it('content-addressed names have exact recitation/surah and reject traversal', () => {
    expect(licensedObjectKey('reader_2026', 1, sha, 'wav')).toBe(`licensed/reader_2026/001/${sha}.wav`);
    for (const slug of ['../reader', 'reader/other', 'Reader', 'reader%2fother']) expect(() => licensedObjectKey(slug, 1, sha, 'wav')).toThrow('STORAGE_INPUT_INVALID');
  });
  it('rejects empty, above 1GB and unsafe integer object sizes', () => { expect(() => assertStorageSize(AUDIO_OBJECT_LIMIT_BYTES)).not.toThrow(); for (const size of [0, -1, 1.2, AUDIO_OBJECT_LIMIT_BYTES + 1, Infinity]) expect(() => assertStorageSize(size)).toThrow(); });
  it('caps every signing capability at fifteen minutes', () => { expect(() => assertSignedExpiry(900)).not.toThrow(); for (const value of [901, 0, Infinity, 1.1]) expect(() => assertSignedExpiry(value)).toThrow(); });
  it('reports batch missing/duplicates/failures without choosing a duplicate', () => {
    const r = validateBatchAudioNames(['001.mp3', '001.wav', '114.flac', '115.mp3', '../002.mp3', '2.mp3']);
    expect(r.duplicates).toEqual([1]); expect(r.accepted).toEqual([{ name: '114.flac', surah: 114 }]); expect(r.missing).toContain(2); expect(r.invalid).toHaveLength(3);
  });
  it('url reference never stores or rehosts providers', async () => { const s = new UrlReferenceAudioStorage(['audio.example.org']); expect(s.reference('https://audio.example.org/001.mp3')).toContain('001'); await expect(s.presignPut()).rejects.toThrow('STORAGE_UPLOAD_NOT_CONFIGURED'); expect(() => s.reference('https://youtube.com/v')).toThrow(); });
  it('R2 account endpoint is exact; production cannot use arbitrary endpoints', () => {
    const config = { bucket: 'test-audio', accountId: 'a'.repeat(32), endpoint: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`, accessKeyId: 'local-fixture-id', secretAccessKey: 'local-fixture-secret', access: 'read_only' as const };
    expect(() => validateS3AudioConfig(config)).not.toThrow();
    for (const endpoint of ['http://127.0.0.1:8000', 'https://evil.r2.cloudflarestorage.com', 'https://example.org', config.endpoint + '/nested']) expect(() => validateS3AudioConfig({ ...config, endpoint })).toThrow('STORAGE_CONFIGURATION_INVALID');
    expect(() => validateS3AudioConfig({ ...config, endpoint: 'http://127.0.0.1:8000', localTestOnly: true })).not.toThrow();
  });
  it('read-only adapter rejects mutation before network', async () => {
    const s = new S3LicensedAudioStorage({ bucket: 'test-audio', endpoint: 'http://127.0.0.1:65500', localTestOnly: true, access: 'read_only', accessKeyId: 'fixture', secretAccessKey: 'fixture' });
    try { await expect(s.presignPut({ objectKey: licensedObjectKey('r', 1, sha, 'mp3'), sizeBytes: 100, sha256: sha, contentType: 'audio/mpeg' })).rejects.toThrow('STORAGE_READ_ONLY'); await expect(s.deleteObject(licensedObjectKey('r', 1, sha, 'mp3'))).rejects.toThrow('STORAGE_READ_ONLY'); } finally { s.close(); }
  });
  it('signed GET remains runtime-only and contains no credential in errors', async () => {
    const s = new S3LicensedAudioStorage({ bucket: 'test-audio', endpoint: 'http://127.0.0.1:65500', localTestOnly: true, access: 'read_only', accessKeyId: 'unit-id', secretAccessKey: 'unit-secret' });
    try { const r = await s.presignGet(licensedObjectKey('r', 1, sha, 'mp3'), 300); expect(new URL(r.url).searchParams.get('X-Amz-Expires')).toBe('300'); await expect(s.presignGet('../a', 300)).rejects.toThrow('STORAGE_KEY_INVALID'); await expect(s.head(licensedObjectKey('r', 1, sha, 'mp3'))).rejects.toThrow(/^STORAGE_REQUEST_FAILED$/u); } finally { s.close(); }
  });
  it('multipart URLs sign exact Content-Length and reject oversized parts before network', async () => {
    const s = new S3LicensedAudioStorage({ bucket: 'test-audio', endpoint: 'http://127.0.0.1:65500', localTestOnly: true, access: 'read_write', accessKeyId: 'unit-id', secretAccessKey: 'unit-secret' });
    try { const r = await s.presignPart(licensedObjectKey('r', 1, sha, 'wav'), 'upload-id', 1, 1024, 300); expect(new URL(r.url).searchParams.get('X-Amz-SignedHeaders')).toContain('content-length'); await expect(s.presignPart(licensedObjectKey('r', 1, sha, 'wav'), 'upload-id', 1, 9 * 1024 * 1024, 300)).rejects.toThrow('STORAGE_PART_SIZE_INVALID'); } finally { s.close(); }
  });
  it('identifies magic and rejects renamed text', () => {
    const wav = Buffer.alloc(44); wav.write('RIFF'); wav.write('WAVE', 8); expect(audioMagic(wav)).toBe('wav'); expect(() => audioMagic(Buffer.from('not audio renamed.mp3'))).toThrow('AUDIO_MAGIC_INVALID');
  });
  it('rejects any video or attached picture stream even with valid MP4 audio', () => {
    const audio = { codec_type: 'audio', codec_name: 'aac', sample_rate: '44100', channels: 2 };
    expect(() => parseAudioProbe({ format: { format_name: 'mov,mp4,m4a', duration: '1' }, streams: [audio, { codec_type: 'video' }] }, 'mp4')).toThrow('AUDIO_STREAMS_INVALID');
  });
  it('ffprobe container/magic/codec must agree', () => {
    const p = { format: { format_name: 'wav', duration: '1.500' }, streams: [{ codec_type: 'audio', codec_name: 'pcm_s16le', sample_rate: '16000', channels: 1 }] };
    expect(parseAudioProbe(p, 'wav').durationMs).toBe(1500); expect(() => parseAudioProbe(p, 'mp3')).toThrow('AUDIO_PROBE_INVALID');
  });
  it('offset decision uses raw NCC; rounding cannot grant acceptance', () => { const e = evidence(); e.samples[0].ncc = .949999997; expect(() => assertLicensedOffsetEvidence(e, 'r1', sha)).toThrow('LICENSED_OFFSET_NOT_VERIFIED'); });
  it('requires five unique ayahs in three different-length surahs', () => {
    expect(() => assertLicensedOffsetEvidence(evidence(), 'r1', sha)).not.toThrow();
    const e = evidence(); e.samples[4] = { ...e.samples[0] }; expect(() => assertLicensedOffsetEvidence(e, 'r1', sha)).toThrow();
    const short = evidence(); short.samples.pop(); expect(() => assertLicensedOffsetEvidence(short, 'r1', sha)).toThrow();
  });
  it('ties offset to uploaded source SHA and selected recitation', () => { expect(() => assertLicensedOffsetEvidence(evidence(), 'different', sha)).toThrow(); expect(() => assertLicensedOffsetEvidence(evidence(), 'r1', 'b'.repeat(64))).toThrow(); });
  it('rejects excessive full duration and lag, independent of correlation', () => { for (const key of ['durationDifferenceMs', 'lagMs'] as const) { const e = evidence(); e.samples[0][key] = 30.00001; expect(() => assertLicensedOffsetEvidence(e, 'r1', sha)).toThrow(); } });
  it('v2 is blocked until human exception and codec evidence exist', () => { const e = evidence(); e.method = 'v2'; for (const s of e.samples) s.vadAgreement = .95; expect(() => assertLicensedOffsetEvidence(e, 'r1', sha)).toThrow('LICENSED_V2_REQUIRES_HUMAN_ACCEPTANCE'); e.v2Acceptance = { cause: 'codec_processing_only', decision: 'accepted_for_data_pipeline_verification', reviewBlockers: [], evidenceSha256: sha, humanReviewId: 'review-id' }; expect(() => assertLicensedOffsetEvidence(e, 'r1', sha)).not.toThrow(); });
  it('requires measured source offset and matching source surah, never assumes zero', () => { const e = evidence(); e.sourceChapterOffsetMs = NaN; expect(() => assertLicensedOffsetEvidence(e, 'r1', sha, 1)).toThrow(); e.sourceChapterOffsetMs = 0; expect(() => assertLicensedOffsetEvidence(e, 'r1', sha, 2)).toThrow(); });
  it('credentials do not activate storage and readonly never borrows write credentials', () => { expect(catalogStorageFromEnvironment('url_reference', 'read_only', [], { R2_SECRET_ACCESS_KEY: 'not-used' }).adapter).toBe('url_reference'); expect(() => catalogStorageFromEnvironment('r2', 'read_only', [], { R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: 'test-audio', R2_ENDPOINT: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`, R2_ACCESS_KEY_ID: 'writer', R2_SECRET_ACCESS_KEY: 'writer-secret' })).toThrow('STORAGE_CREDENTIALS_UNAVAILABLE'); });
});
describe('licensed resolver and administration', () => {
  const row = () => ({ source_id: 's1', recitation_id: 'r1', surah: 1, object_recitation_id: 'r1', object_surah: 1, rights_ref: 'human1', object_rights_ref: 'human1', source_sha256: sha, sha256: sha, duration_ms: 1000, upload_status: 'verified', verification_status: 'verified', verified_at: '2026-10-10', verification_details: evidence(), adapter: 'r2', bucket: 'test-audio', object_key: licensedObjectKey('r1', 1, sha, 'wav'), storage_id: 'o1', size_bytes: 100 });
  it('returns source contract, never a signed persisted URL', async () => { const r = await new CatalogLicensedSourceResolver(database([row()]), storage()).resolveLicensedSource('r1', 1); expect(r?.objectKey).toContain(sha); expect(r).not.toHaveProperty('url'); });
  it('does not substitute another recitation/object or unverified/rightsless source', async () => { for (const change of [{ object_recitation_id: 'r2' }, { upload_status: 'uploaded' }, { rights_ref: null }, { source_sha256: 'b'.repeat(64) }]) expect(await new CatalogLicensedSourceResolver(database([{ ...row(), ...change }]), storage()).resolveLicensedSource('r1', 1)).toBeNull(); });
  it('missing or changed object blocks render', async () => { const s = storage(); vi.mocked(s.head).mockResolvedValue(null); await expect(new CatalogLicensedSourceResolver(database([row()]), s).resolveLicensedSource('r1', 1)).rejects.toThrow('LICENSED_OBJECT_MISSING_OR_CHANGED'); });
  it('non-admin/system upload denied before DB, network or rate limiter', async () => {
    const db = database(), s = storage(), consume = vi.fn(); const service = new CatalogStorageAdminService(db, s, { consume }, { verify: vi.fn() }, { enqueueVoiceReverification: vi.fn() }, '/private');
    await expect(service.beginUpload({ id: 'system', kind: 'system', permissions: new Set(['storage.manage']) }, { recitationId: 'r1', surah: 1, sha256: sha, sizeBytes: 10, extension: 'wav', contentType: 'audio/wav', rightsRef: 'r', multipart: false })).rejects.toThrow('CATALOG_PERMISSION_DENIED'); expect(db.read).not.toHaveBeenCalled(); expect(s.head).not.toHaveBeenCalled(); expect(consume).not.toHaveBeenCalled();
  });
  it('old soft-deleted file requires age and two exact confirmations', async () => {
    const service = new CatalogStorageAdminService(database([{ ...row(), id: 'o1', soft_deleted_at: new Date().toISOString(), upload_status: 'soft_deleted' }]), storage(), { consume: vi.fn() }, { verify: vi.fn() }, { enqueueVoiceReverification: vi.fn() }, '/private');
    await expect(service.deleteSoftDeleted({ id: 'a', kind: 'human', permissions: new Set(['storage.manage']) }, 'o1', { objectId: 'o1', sha256: sha })).rejects.toThrow('STORAGE_DELETE_NOT_CONFIRMED_OR_TOO_EARLY');
  });
  it('reconciliation detects orphans/missing/mismatch and never deletes', async () => {
    const s = storage(); vi.mocked(s.listObjects).mockResolvedValue([{ objectKey: 'known', sizeBytes: 2 }, { objectKey: 'orphan', sizeBytes: 10 }]);
    const r = await reconcileAudioStorage(s, [{ id: 'a', object_key: 'known', size_bytes: 1, adapter: 'r2', bucket: 'test-audio', upload_status: 'verified' }, { id: 'b', object_key: 'missing', adapter: 'r2', bucket: 'test-audio', upload_status: 'verified' }]);
    expect(r.orphanedObjects).toEqual(['orphan']); expect(r.missingObjects).toEqual(['b']); expect(r.sizeMismatches).toEqual(['a']); expect(s.deleteObject).not.toHaveBeenCalled();
  });
  it('manifest contains SHA and metadata, not audio/credentials/signed URLs', () => { const r = audioStorageManifest([{ ...row(), recitation_id: 'r1' }]); expect(r.objects).toHaveLength(1); expect(JSON.stringify(r)).not.toMatch(/url|secret|credential|audio_data/u); });
  it('cost derives from recorded prices and triggers free-tier/budget alerts', () => { const r = estimateAudioStorageCost(500_000_000_000, 0, 0, { recordedAt: '2026-10-10', sourceUrl: 'https://developers.cloudflare.com/r2/pricing/', freeStorageBytes: 10_000_000_000, storageDollarsPerGbMonth: .015, freeClassA: 1_000_000, classADollarsPerMillion: 4.5, freeClassB: 10_000_000, classBDollarsPerMillion: .36 }); expect(r.dollars).toBe(7.35); expect(r.alerts).toContain('STORAGE_BUDGET_OVER_FIVE_DOLLARS'); });
});
