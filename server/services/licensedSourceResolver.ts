import { CatalogError, type CatalogDatabase } from './catalogContracts';
import type { AudioObjectStorage } from './catalogStorageContracts';
import { assertLicensedOffsetEvidence, type LicensedOffsetEvidence } from './licensedAudioVerification';

export interface StorageAudioPlan { kind: 'licensed_file'; recitationId: string; surah: number; sourceId: string; storageObjectId: string; adapter: 'r2'; bucket: string; objectKey: string; sha256: string; durationMs: number; sourceChapterOffsetMs: number; offsetEvidence: LicensedOffsetEvidence }
/** Root's AudioResolver applies coverage and toRenderTimeline once, then attaches this source. */
export interface LicensedSourceResolver { resolveLicensedSource(recitationId: string, surah: number): Promise<StorageAudioPlan | null> }
export class CatalogLicensedSourceResolver implements LicensedSourceResolver {
  constructor(private readonly db: CatalogDatabase, private readonly storage: AudioObjectStorage) {}
  async resolveLicensedSource(recitationId: string, surah: number): Promise<StorageAudioPlan | null> {
    if (!recitationId || !Number.isSafeInteger(surah) || surah < 1 || surah > 114) throw new CatalogError('STORAGE_INPUT_INVALID', 422);
    const rows = await this.db.read("SELECT u.id source_id,u.recitation_id,u.surah,u.rights_ref,u.sha256 source_sha256,u.verification_status,u.verification_details,o.id storage_id,o.adapter,o.bucket,o.object_key,o.sha256,o.size_bytes,o.duration_ms,o.upload_status,o.verified_at,o.recitation_id object_recitation_id,o.surah object_surah,o.rights_ref object_rights_ref FROM recitation_source_urls u JOIN storage_objects o ON o.id=u.storage_object_id JOIN human_review_items h ON h.id=u.rights_ref AND h.status='approved' AND h.decided_by IS NOT NULL AND h.subject_type='recitation' AND h.subject_id=u.recitation_id AND h.type IN ('storage_rights','youtube_rights') WHERE u.recitation_id=? AND u.surah=? AND u.kind='licensed_file' AND u.is_active=1 ORDER BY u.priority,u.id", [recitationId, surah]);
    for (const row of rows) {
      if (row.recitation_id !== recitationId || row.object_recitation_id !== recitationId || Number(row.surah) !== surah || Number(row.object_surah) !== surah || row.upload_status !== 'verified' || row.verification_status !== 'verified' || !row.verified_at || !row.rights_ref || row.rights_ref !== row.object_rights_ref || row.source_sha256 !== row.sha256 || !/^[a-f0-9]{64}$/u.test(String(row.sha256)) || !Number.isFinite(Number(row.duration_ms)) || Number(row.duration_ms) <= 0 || row.adapter !== this.storage.adapter || row.bucket !== this.storage.bucket) continue;
      let evidence: LicensedOffsetEvidence;
      try { evidence = (typeof row.verification_details === 'string' ? JSON.parse(row.verification_details) : row.verification_details) as LicensedOffsetEvidence; assertLicensedOffsetEvidence(evidence, recitationId, String(row.sha256), surah); }
      catch (error) { if (error instanceof CatalogError || error instanceof SyntaxError) continue; throw error; }
      if (evidence.method === 'v2') {
        const [review] = await this.db.read("SELECT id FROM human_review_items WHERE id=? AND type='offset_exception' AND status='approved' AND decided_by IS NOT NULL AND subject_type='recitation' AND subject_id=?", [evidence.v2Acceptance!.humanReviewId, recitationId]);
        if (!review) continue;
      }
      const head = await this.storage.head(String(row.object_key)); if (!head || head.sizeBytes !== Number(row.size_bytes)) throw new CatalogError('LICENSED_OBJECT_MISSING_OR_CHANGED', 409);
      return { kind: 'licensed_file', recitationId, surah, sourceId: String(row.source_id), storageObjectId: String(row.storage_id), adapter: 'r2', bucket: String(row.bucket), objectKey: String(row.object_key), sha256: String(row.sha256), durationMs: Number(row.duration_ms), sourceChapterOffsetMs: evidence.sourceChapterOffsetMs, offsetEvidence: evidence };
    }
    return null;
  }
}
