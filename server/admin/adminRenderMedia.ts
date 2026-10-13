import { createReadStream } from 'node:fs';
import { realpath, stat, unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import type { CatalogDatabase, CatalogRow } from '../services/catalogContracts';
import { CatalogError } from '../services/catalogContracts';
import { appendCatalogAudit, type CatalogActor } from '../services/catalogAudit';
import { requireRenderTester, renderLabCaptionSource, type RenderLabBuilder } from '../services/renderLabService';
import { deleteStoredRender, isObjectStoragePath, streamStoredRender } from '../services/objectStorage';
import { parseRuns } from '../services/catalogContracts';
import { checksumText } from '../services/quranTextImport';

export function parseVideoRange(raw: string | undefined, size: number): { start: number; end: number } | null {
  if (!raw) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(raw);
  if (!match || !match[1] && !match[2]) throw new CatalogError('RENDER_MEDIA_RANGE_INVALID', 416);
  const suffix = match[1] === '', start = suffix ? Math.max(0, size - Number(match[2])) : Number(match[1]), end = suffix || !match[2] ? size - 1 : Math.min(size - 1, Number(match[2]));
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start || suffix && Number(match[2]) < 1) throw new CatalogError('RENDER_MEDIA_RANGE_INVALID', 416);
  return { start, end };
}
export class AdminRenderMedia {
  constructor(private readonly db: CatalogDatabase, private readonly builder: RenderLabBuilder, private readonly storageRoot = resolve(process.cwd(), 'uploads')) {}
  async choices(actor: CatalogActor): Promise<CatalogRow> {
    requireRenderTester(actor);
    const rows = await this.db.read("SELECT r.id,r.reciter_id,e.name_ar reciter_name_ar,r.display_label_ar,r.slug,p.code provider FROM recitations r JOIN reciters e ON e.id=r.reciter_id JOIN audio_providers p ON p.id=r.provider_id WHERE r.status='published' AND r.published_by='rule-v1' AND r.offset_verified=1 AND r.audio_mode='surah_slice' AND r.riwayah_code='hafs_an_asim' AND r.canonical_text_available=1 AND r.timing_quality='verified' AND r.timing_level IN ('word','letter') AND p.code<>'youtube' ORDER BY e.name_ar,r.slug");
    return { recitations: rows, max_duration_ms: 90000, concurrency: 1 };
  }
  async chapters(actor: CatalogActor, id: string): Promise<CatalogRow> {
    requireRenderTester(actor);
    const available = (await this.choices(actor)).recitations as CatalogRow[];
    if (!available.some(row => row.id === id)) throw new CatalogError('RECITATION_NOT_TECHNICALLY_ELIGIBLE', 409);
    const rows = await this.db.read("SELECT c.surah,s.name_ar,s.ayah_count,c.available_runs,c.availability_state FROM recitation_chapters c JOIN quran_surahs s ON s.number=c.surah WHERE c.recitation_id=? AND COALESCE(c.is_enabled,1)=1 AND c.run_count>0 AND c.audio_status='available' ORDER BY c.surah", [id]);
    return { chapters: rows.map(row => ({ ...row, available_runs: parseRuns(row.available_runs) })) };
  }
  async ranges(actor: CatalogActor, id: string, surah: number): Promise<CatalogRow> {
    requireRenderTester(actor);
    if(!Number.isSafeInteger(surah)||surah<1||surah>114)throw new CatalogError('RENDER_V2_REQUEST_INVALID',422);
    // The builder computes authoritative canonical coverage/overlap runs before
    // its range check and before network audio. An out-of-bounds sentinel reads
    // that existing domain result without duplicating timeline normalization.
    try { await this.builder.build({ recitationId: id, surah, from: 65535, to: 65535, qa: true, options: {} }); }
    catch (error) { if (error instanceof CatalogError && error.code === 'RANGE_NOT_AVAILABLE' && Array.isArray(error.details.available_runs)) return { surah, available_runs: parseRuns(error.details.available_runs) }; throw error; }
    throw new CatalogError('RENDER_RANGE_INSPECTION_INVALID', 503);
  }
  private async output(actor: CatalogActor, id: string): Promise<CatalogRow> {
    requireRenderTester(actor);
    const [row] = await this.db.read("SELECT id,status,output_path,output_size_bytes,expires_at,recitation_id,manifest FROM render_jobs WHERE id=? AND JSON_UNQUOTE(JSON_EXTRACT(manifest,'$.schemaVersion'))='2.0.0'", [id]);
    if (!row) throw new CatalogError('RENDER_LAB_JOB_NOT_FOUND', 404);
    const expiry = new Date(String(row.expires_at)).getTime();
    if (row.status !== 'succeeded' || !row.output_path || !row.expires_at || !Number.isFinite(expiry) || expiry <= Date.now()) throw new CatalogError('RENDER_LAB_ARTIFACT_EXPIRED', 410);
    return row;
  }
  async captions(actor: CatalogActor, id: string, res: Response): Promise<void> {
    const row = await this.output(actor, id), source = renderLabCaptionSource(row.manifest);
    if (!source.manifest) throw new CatalogError(source.reason, 409);
    const manifest = source.manifest, range = manifest.canonicalAyahRange;
    if (row.recitation_id !== manifest.recitation.id) throw new CatalogError('RENDER_CAPTIONS_CANONICAL_MISMATCH', 409);
    const versions = await this.db.read('SELECT v.id,v.checksum,r.code riwayah_code FROM quran_text_versions v JOIN riwayat r ON r.id=v.riwayah_id WHERE v.id=?', [manifest.canonicalTextVersion.id]);
    const version = versions[0];
    if (versions.length !== 1 || version.id !== manifest.canonicalTextVersion.id || version.riwayah_code !== 'hafs_an_asim' || version.checksum !== manifest.canonicalTextVersion.checksum) throw new CatalogError('RENDER_CAPTIONS_CANONICAL_MISMATCH', 409);
    const corpus = await this.db.read('SELECT surah,ayah,text_uthmani FROM quran_ayahs WHERE text_version_id=? ORDER BY surah,ayah', [version.id]);
    const checksum = checksumText(corpus.map(ayah => `${ayah.surah}:${ayah.ayah}\t${ayah.text_uthmani}`).join('\n'));
    if (!corpus.length || checksum !== version.checksum) throw new CatalogError('RENDER_CAPTIONS_CANONICAL_MISMATCH', 409);
    const canonical = corpus.filter(ayah => Number(ayah.surah) === range.surahNumber && Number(ayah.ayah) >= range.startAyah && Number(ayah.ayah) <= range.endAyah);
    if (canonical.length !== range.ayahs.length || canonical.some((ayah, index) => Number(ayah.ayah) !== range.ayahs[index].numberInSurah || ayah.text_uthmani !== range.ayahs[index].text)) throw new CatalogError('RENDER_CAPTIONS_CANONICAL_MISMATCH', 409);
    // Format the existing render_ms coordinates. Never subtract offsets, infer
    // timings, extend intervals, normalize Quran text or synthesize gap cues.
    const timestamp = (ms: number): string => `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
    const cues = manifest.timeline.ayahs.map((cue, index) => {
      const text = range.ayahs[index].text;
      if (Array.from(text).some(char => { const code = char.codePointAt(0)!; return code < 32 || code === 127 || code === 0x2028 || code === 0x2029; })) throw new CatalogError('RENDER_CAPTIONS_TEXT_INVALID', 409);
      const payload = text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
      return `${range.surahNumber}:${cue.ayah}\n${timestamp(cue.startMs)} --> ${timestamp(cue.endMs)}\n${payload}\n\n`;
    });
    res.set('Content-Type', 'text/vtt; charset=utf-8').set('Cache-Control', 'private, no-store').set('X-Content-Type-Options', 'nosniff').set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'").send(`WEBVTT\n\n${cues.join('')}`);
  }
  private async localPath(raw: string): Promise<string> {
    const root = await realpath(this.storageRoot), file = await realpath(raw), location = relative(root, file);
    if (location.startsWith('..') || isAbsolute(location) || !location) throw new CatalogError('RENDER_MEDIA_PATH_INVALID', 503);
    return file;
  }
  async stream(actor: CatalogActor, id: string, req: Request, res: Response): Promise<void> {
    const row = await this.output(actor, id);
    res.set('Content-Type', 'video/mp4').set('Cache-Control', 'private, no-store').set('X-Content-Type-Options', 'nosniff').set('Content-Disposition', 'inline; filename="ayahx-preview.mp4"');
    if (isObjectStoragePath(String(row.output_path))) {
      const stored = await streamStoredRender(String(row.output_path));
      if (stored.size !== null) res.set('Content-Length', String(stored.size));
      try { await pipeline(stored.body as NodeJS.ReadableStream, res); } catch (error) { if (!res.headersSent) throw error; res.destroy(); }
      return;
    }
    const file = await this.localPath(String(row.output_path)), info = await stat(file), range = parseVideoRange(req.headers.range, info.size);
    res.set('Accept-Ranges', 'bytes');
    if (range) res.status(206).set('Content-Range', `bytes ${range.start}-${range.end}/${info.size}`).set('Content-Length', String(range.end - range.start + 1));
    else res.set('Content-Length', String(info.size));
    try { await pipeline(createReadStream(file, range ?? undefined), res); } catch (error) { if (!res.headersSent) throw error; res.destroy(); }
  }
  async remove(actor: CatalogActor, id: string): Promise<CatalogRow> {
    requireRenderTester(actor);
    const [row] = await this.db.read("SELECT id,status,output_path FROM render_jobs WHERE id=? AND JSON_UNQUOTE(JSON_EXTRACT(manifest,'$.schemaVersion'))='2.0.0'", [id]);
    if (!row) throw new CatalogError('RENDER_LAB_JOB_NOT_FOUND', 404);
    if (['running', 'queued'].includes(String(row.status))) throw new CatalogError('RENDER_LAB_JOB_ACTIVE', 409);
    if (!row.output_path) return { id, deleted: true, changed: false };
    if (isObjectStoragePath(String(row.output_path))) await deleteStoredRender(String(row.output_path));
    else { try { await unlink(await this.localPath(String(row.output_path))); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
    await this.db.transaction(async tx => {
      const [current] = await tx.read('SELECT output_path FROM render_jobs WHERE id=? FOR UPDATE', [id]);
      if (current?.output_path !== row.output_path) throw new CatalogError('RENDER_LAB_ARTIFACT_CHANGED', 409);
      await tx.execute("UPDATE render_jobs SET output_path=NULL,output_filename=NULL,output_size_bytes=NULL,stage='حُذف الفيديو التجريبي' WHERE id=?", [id]);
      await appendCatalogAudit(tx, actor, 'render_lab.artifact_deleted', 'render_job', id, { artifact_available: true }, { artifact_available: false });
    });
    return { id, deleted: true, changed: true };
  }
}
