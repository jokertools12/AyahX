import crypto from 'crypto';
import type { RowDataPacket } from 'mysql2';
import { query, transaction } from '../db';
import type { AlignmentDocument } from './alignmentProvider';
import type { AlignmentRevision } from './alignmentService';

export interface AlignmentOwnerContext {
  userId: string;
  isAdmin: boolean;
}

function parseDocument(row: any): AlignmentDocument {
  const raw = typeof row.document_json === 'string' ? JSON.parse(row.document_json) : row.document_json;
  if (!raw || typeof raw !== 'object') throw new Error('ALIGNMENT_DOCUMENT_CORRUPT');
  return raw as AlignmentDocument;
}

export async function saveAlignmentDocument(userId: string, document: AlignmentDocument): Promise<void> {
  await query(
    `INSERT INTO alignment_documents
      (id, user_id, parent_document_id, provider_id, validation_status, review_status,
       audio_content_hash, surah_number, start_ayah, end_ayah, document_json, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       CASE WHEN ? = 'quran_foundation' THEN DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 5 DAY) ELSE NULL END)`,
    [
      document.documentId,
      userId,
      document.parentDocumentId || null,
      document.providerId,
      document.validationStatus,
      document.review?.status || 'unreviewed',
      document.audio.contentHash,
      document.reference.surahNumber,
      document.reference.ayahRange.from,
      document.reference.ayahRange.to,
      JSON.stringify(document),
      document.providerId,
    ],
  );
}

export async function getAlignmentDocument(id: string, context: AlignmentOwnerContext): Promise<AlignmentDocument | null> {
  const rows = context.isAdmin
    ? await query<any[]>(
      'SELECT document_json FROM alignment_documents WHERE id = ? AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) LIMIT 1',
      [id],
    )
    : await query<any[]>(
      'SELECT document_json FROM alignment_documents WHERE id = ? AND user_id = ? AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) LIMIT 1',
      [id, context.userId],
    );
  return rows.length ? parseDocument(rows[0]) : null;
}

export async function listAlignmentDocuments(context: AlignmentOwnerContext, limit = 50): Promise<AlignmentDocument[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const rows = context.isAdmin
    ? await query<any[]>(
      `SELECT document_json FROM alignment_documents
       WHERE expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP
       ORDER BY created_at DESC LIMIT ${safeLimit}`,
    )
    : await query<any[]>(
      `SELECT document_json FROM alignment_documents
       WHERE user_id = ? AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
       ORDER BY created_at DESC LIMIT ${safeLimit}`,
      [context.userId],
    );
  return rows.map(parseDocument);
}

export async function saveReviewEvent(params: {
  userId: string;
  document: AlignmentDocument;
  parentDocumentId: string;
  revisions: AlignmentRevision[];
}): Promise<void> {
  await transaction(async (conn) => {
    const [insertResult] = await conn.query<any>(
      `INSERT INTO alignment_documents
        (id, user_id, parent_document_id, provider_id, validation_status, review_status,
         audio_content_hash, surah_number, start_ayah, end_ayah, document_json, expires_at)
       SELECT ?, user_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, expires_at
       FROM alignment_documents
       WHERE id = ? AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
       LIMIT 1`,
      [
        params.document.documentId,
        params.parentDocumentId,
        params.document.providerId,
        params.document.validationStatus,
        params.document.review?.status || 'unreviewed',
        params.document.audio.contentHash,
        params.document.reference.surahNumber,
        params.document.reference.ayahRange.from,
        params.document.reference.ayahRange.to,
        JSON.stringify(params.document),
        params.parentDocumentId,
      ],
    );
    // `INSERT ... SELECT` succeeds with zero affected rows when the parent was
    // deleted between the ownership read and this transaction.  Do not leave
    // an audit event pointing at a revision that was never persisted.
    if (Number(insertResult?.affectedRows || 0) !== 1) {
      throw new Error('ALIGNMENT_PARENT_EXPIRED');
    }
    const [eventInsertResult] = await conn.query<any>(
      `INSERT INTO alignment_review_events
        (id, document_id, parent_document_id, user_id, status, note, revision_json, expires_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, expires_at
       FROM alignment_documents WHERE id = ? LIMIT 1`,
      [
        crypto.randomUUID(),
        params.document.documentId,
        params.parentDocumentId,
        params.userId,
        params.document.review?.status || 'unreviewed',
        params.document.review?.note || null,
        JSON.stringify(params.revisions),
        params.document.documentId,
      ],
    );
    if (Number(eventInsertResult?.affectedRows || 0) !== 1) {
      throw new Error('ALIGNMENT_REVIEW_DOCUMENT_NOT_FOUND');
    }
  });
}

/**
 * Deletes one owner's alignment and every descendant review revision/event.
 * Audio bytes are not stored here; only the linked metadata/timing records are
 * removed. The account-delete foreign key is a separate defense in depth.
 */
export async function deleteAlignmentDocument(documentId: string, userId: string): Promise<boolean> {
  return transaction(async (conn) => {
    const [roots] = await conn.query<any[]>(
      'SELECT id FROM alignment_documents WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE',
      [documentId, userId],
    );
    if (!roots.length) return false;

    const documentIds = new Set<string>([documentId]);
    let frontier = [documentId];
    const maxRevisionDocuments = 5_000;
    while (frontier.length > 0) {
      const placeholders = frontier.map(() => '?').join(', ');
      const [children] = await conn.query<(RowDataPacket & { id: string })[]>(
        `SELECT id FROM alignment_documents
         WHERE user_id = ? AND parent_document_id IN (${placeholders})
         FOR UPDATE`,
        [userId, ...frontier],
      );
      frontier = [];
      for (const child of children) {
        if (documentIds.has(child.id)) continue;
        documentIds.add(child.id);
        frontier.push(child.id);
        if (documentIds.size > maxRevisionDocuments) {
          throw new Error('ALIGNMENT_DELETE_REVISION_TREE_TOO_LARGE');
        }
      }
    }

    const ids = [...documentIds];
    const placeholders = ids.map(() => '?').join(', ');
    await conn.query(
      `DELETE FROM alignment_review_events
       WHERE user_id = ?
         AND (document_id IN (${placeholders}) OR parent_document_id IN (${placeholders}))`,
      [userId, ...ids, ...ids],
    );
    await conn.query(
      `DELETE FROM alignment_documents WHERE user_id = ? AND id IN (${placeholders})`,
      [userId, ...ids],
    );
    return true;
  });
}
