import { randomUUID } from 'node:crypto';
import { CatalogError, type CatalogDatabase } from './catalogContracts';
import { appendCatalogAudit, requireCatalogPermission, type CatalogActor } from './catalogAudit';
import { assertCatalogAudioUrl, type CatalogAudioSource } from './catalogAudioSource';
import { assertLicensedOffsetEvidence, type LicensedOffsetEvidence, type ProbedAudio } from './licensedAudioVerification';
import type { LicensedStorageHooks } from './catalogStorageAdminService';

export interface HostedLicensedVerifier {
  /** Server checks a pinned/allowlisted stream, ffprobe, blob SHA and the same QUD offset protocol. */
  verify(input: { url: string; hosts: string[]; recitationId: string; surah: number }): Promise<ProbedAudio & { sha256: string; offset: LicensedOffsetEvidence }>;
}
/** Admin-owned/licensed hosting is a reference; this service has no upload/rehosting method. */
export class CatalogLicensedHostedSourceService {
  constructor(private readonly db: CatalogDatabase, private readonly sources: Pick<CatalogAudioSource, 'validate'>, private readonly verifier: HostedLicensedVerifier, private readonly hooks: LicensedStorageHooks) {}
  async attach(actor: CatalogActor, input: { recitationId: string; surah: number; url: string; rightsRef: string }): Promise<string> {
    requireCatalogPermission(actor, 'storage.manage', true);
    if (!Number.isSafeInteger(input.surah) || input.surah < 1 || input.surah > 114) throw new CatalogError('STORAGE_INPUT_INVALID', 422);
    const [r] = await this.db.read('SELECT r.id,p.host_allowlist FROM recitations r JOIN audio_providers p ON p.id=r.provider_id WHERE r.id=?', [input.recitationId]);
    if (!r) throw new CatalogError('RECITATION_NOT_FOUND', 404);
    const hosts = (typeof r.host_allowlist === 'string' ? JSON.parse(r.host_allowlist) : r.host_allowlist) as unknown;
    if (!Array.isArray(hosts) || hosts.some(h => typeof h !== 'string')) throw new CatalogError('AUDIO_PROVIDER_INVALID', 503);
    const url = assertCatalogAudioUrl(input.url, hosts).href;
    const assertRights = async () => {
      const [review] = await this.db.read('SELECT status,type,subject_type,subject_id,decided_by FROM human_review_items WHERE id=?', [input.rightsRef]);
      if (!review || review.status !== 'approved' || !review.decided_by || !['storage_rights', 'youtube_rights'].includes(String(review.type)) || review.subject_type !== 'recitation' || review.subject_id !== input.recitationId) throw new CatalogError('LICENSED_RIGHTS_NOT_APPROVED', 409);
    };
    await assertRights(); await this.sources.validate(url, hosts);
    const proof = await this.verifier.verify({ url, hosts, recitationId: input.recitationId, surah: input.surah });
    if (!/^[a-f0-9]{64}$/u.test(proof.sha256) || !Number.isFinite(proof.durationMs) || proof.durationMs <= 0) throw new CatalogError('LICENSED_RECORDING_UNVERIFIED', 409);
    assertLicensedOffsetEvidence(proof.offset, input.recitationId, proof.sha256, input.surah);
    const id = randomUUID();
    await this.db.transaction(async tx => {
      const [locked] = await tx.read('SELECT id FROM recitations WHERE id=? FOR UPDATE', [input.recitationId]); if (!locked) throw new CatalogError('RECITATION_NOT_FOUND', 404);
      const [rights] = await tx.read("SELECT id FROM human_review_items WHERE id=? AND status='approved' AND decided_by IS NOT NULL AND subject_type='recitation' AND subject_id=? AND type IN ('storage_rights','youtube_rights') FOR UPDATE", [input.rightsRef, input.recitationId]);
      if (!rights) throw new CatalogError('LICENSED_RIGHTS_NOT_APPROVED', 409);
      if (proof.offset.method === 'v2') {
        const [review] = await tx.read("SELECT id FROM human_review_items WHERE id=? AND type='offset_exception' AND status='approved' AND decided_by IS NOT NULL AND subject_type='recitation' AND subject_id=? FOR UPDATE", [proof.offset.v2Acceptance!.humanReviewId, input.recitationId]);
        if (!review) throw new CatalogError('LICENSED_V2_REQUIRES_HUMAN_ACCEPTANCE', 409);
      }
      await tx.execute("UPDATE recitation_source_urls SET is_active=0 WHERE recitation_id=? AND surah=? AND kind='licensed_file' AND is_active=1", [input.recitationId, input.surah]);
      await tx.execute("INSERT INTO recitation_source_urls(id,recitation_id,surah,url,kind,rights_ref,sha256,duration_ms,verification_status,verification_details,approved_by,priority,is_active) VALUES(?,?,?,?,'licensed_file',?,?,?,'verified',?,?,0,1)", [id, input.recitationId, input.surah, url, input.rightsRef, proof.sha256, Math.round(proof.durationMs), JSON.stringify(proof.offset), actor.id]);
      await appendCatalogAudit(tx, actor, 'storage.hosted_licensed_attach', 'recitation_source_url', id, null, { recitation_id: input.recitationId, surah: input.surah, url, rights_ref: input.rightsRef, sha256: proof.sha256, offset: proof.offset });
      await this.hooks.enqueueVoiceReverification(tx, input.recitationId, id);
    });
    return id;
  }
}
