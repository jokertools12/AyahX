import crypto from 'crypto';
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
       audio_content_hash, surah_number, start_ayah, end_ayah, document_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    ],
  );
}

export async function getAlignmentDocument(id: string, context: AlignmentOwnerContext): Promise<AlignmentDocument | null> {
  const rows = context.isAdmin
    ? await query<any[]>('SELECT document_json FROM alignment_documents WHERE id = ? LIMIT 1', [id])
    : await query<any[]>('SELECT document_json FROM alignment_documents WHERE id = ? AND user_id = ? LIMIT 1', [id, context.userId]);
  return rows.length ? parseDocument(rows[0]) : null;
}

export async function listAlignmentDocuments(context: AlignmentOwnerContext, limit = 50): Promise<AlignmentDocument[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const rows = context.isAdmin
    ? await query<any[]>(`SELECT document_json FROM alignment_documents ORDER BY created_at DESC LIMIT ${safeLimit}`)
    : await query<any[]>(`SELECT document_json FROM alignment_documents WHERE user_id = ? ORDER BY created_at DESC LIMIT ${safeLimit}`, [context.userId]);
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
         audio_content_hash, surah_number, start_ayah, end_ayah, document_json)
       SELECT ?, user_id, ?, ?, ?, ?, ?, ?, ?, ?, ?
       FROM alignment_documents WHERE id = ? LIMIT 1`,
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
      throw new Error('ALIGNMENT_PARENT_NOT_FOUND');
    }
    await conn.query(
      `INSERT INTO alignment_review_events
        (id, document_id, parent_document_id, user_id, status, note, revision_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        params.document.documentId,
        params.parentDocumentId,
        params.userId,
        params.document.review?.status || 'unreviewed',
        params.document.review?.note || null,
        JSON.stringify(params.revisions),
      ],
    );
  });
}
