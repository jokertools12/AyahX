import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { upQuranCatalogTables, downQuranCatalogTables, QURAN_CATALOG_TABLES } from '../server/db/migrations/002_addQuranCatalogTables';
import { generateCatalogSql } from '../server/services/qudCatalogSql';
import { verifyCatalogRows, verifyCatalogSchema } from '../server/services/qudCatalogVerification';
import { verifyQuranTextSchemaCollations } from '../server/services/quranTextSchemaVerification';
import { sha, type CatalogDataset } from '../server/services/qudCatalogImport';

const option = (name: string): string => { const index = process.argv.indexOf(name); if (index < 0 || !process.argv[index + 1]) throw new Error(`OPTION_REQUIRED:${name}`); return process.argv[index + 1]; };
const database = option('--db-name');
if (!database.startsWith('ayahx_d2_') || option('--db-host') !== '127.0.0.1') throw new Error('LOCAL_D2_REHEARSAL_REQUIRED');
const data = JSON.parse(await readFile(option('--dataset'), 'utf8')) as CatalogDataset;
const plan = generateCatalogSql(data);
const db = await mysql.createConnection({ host: '127.0.0.1', port: 33319, user: 'root', database, charset: 'utf8mb4', multipleStatements: true });
try {
  const [version] = await db.query<RowDataPacket[]>('SELECT VERSION() AS version');
  assert.equal(version[0].version, '9.7.2');
  if (process.argv.includes('--reset-local-catalog')) {
    await downQuranCatalogTables(db, 'local-rehearsal');
    // Only the inactive metadata IDs introduced by this D2 plan, in the guarded
    // restored LOCAL DB, are reset between development plans. Never Hafs.
    if (data.riwayat.length) await db.query(`DELETE FROM riwayat WHERE is_active=0 AND id IN (${data.riwayat.map(() => '?').join(',')})`, data.riwayat.map((row) => row.id));
  }
  const canonical = async (): Promise<string> => { const [rows] = await db.query<RowDataPacket[]>('SELECT surah,ayah,text_uthmani FROM quran_ayahs ORDER BY surah,ayah'); return sha(rows.map((row) => `${row.surah}:${row.ayah}\t${row.text_uthmani}`).join('\n')); };
  const before = await canonical();
  const existingTables = ['users','subscriptions','payment_requests','saved_videos','render_jobs','system_settings','user_roles','notifications','quran_surahs','quran_ayahs','quran_words','quran_text_versions','translations','translation_ayahs'];
  const criticalCounts = async (): Promise<Record<string, number>> => {
    const counts: Record<string, number> = {};
    for (const table of existingTables) {
      const [rows] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM ${table}`);
      counts[table] = Number(rows[0].count);
    }
    return counts;
  };
  const criticalBefore = await criticalCounts();
  let failedImportedBefore = 0;
  if (process.argv.includes('--previous-sql')) {
    // Reproduce the acknowledged staging pre-state only in this local clone.
    await db.query(await readFile(option('--previous-sql'), 'utf8'));
    const [rows] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM recitations WHERE verification_status='failed' AND status='imported'");
    failedImportedBefore = Number(rows[0].count);
    assert.ok(failedImportedBefore > 0, 'PREVIOUS_STATUS_BUG_NOT_REPRODUCED');
  }
  await upQuranCatalogTables(db);
  await upQuranCatalogTables(db);
  await db.query(plan.sql);
  const first = await verifyCatalogRows(db, data);
  const [failedImportedAfter] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM recitations WHERE verification_status='failed' AND status='imported'");
  assert.equal(Number(failedImportedAfter[0].count), 0, 'FAILED_OFFSET_LEFT_IMPORTED');
  const [firstChecksums] = await db.query<RowDataPacket[]>(`CHECKSUM TABLE ${QURAN_CATALOG_TABLES.join(',')}`);
  await db.query(plan.sql);
  assert.deepEqual(await verifyCatalogRows(db, data), first);
  const [secondChecksums] = await db.query<RowDataPacket[]>(`CHECKSUM TABLE ${QURAN_CATALOG_TABLES.join(',')}`);
  assert.deepEqual(secondChecksums, firstChecksums, 'REPLAY_CHANGED_CATALOG_TABLE_CHECKSUM');
  const schema = await verifyCatalogSchema(db);
  const d1 = await verifyQuranTextSchemaCollations(db);
  await db.query('SELECT COUNT(*) FROM reciters r LEFT JOIN users u ON u.id=r.id');
  await db.query('SELECT COUNT(*) FROM reciters r LEFT JOIN users u ON u.email=r.name_en');
  const [publish] = await db.query<RowDataPacket[]>('SELECT id FROM recitations LIMIT 1');
  await assert.rejects(db.query("UPDATE recitations SET status='published',canonical_text_available=1,ayahs_complete=1,offset_verified=1,offset_check_score=1,verification_status='passed',timing_quality='verified',timing_level='word',verification_details=JSON_OBJECT('basmala_audio_evidence',JSON_OBJECT('review','local-test')) WHERE id=?", [publish[0].id]), /chk_catalog_publish/u);
  await assert.rejects(db.query("UPDATE recitations SET status='published',canonical_text_available=1,ayahs_complete=1,offset_verified=1,offset_check_score=1,verification_status='passed',timing_quality='verified',timing_level='word',surah_start_basmala_audio_status='verified' WHERE id=?", [publish[0].id]), /chk_catalog_publish/u);
  const [unverified] = await db.query<RowDataPacket[]>('SELECT id FROM recitations WHERE offset_verified=0 LIMIT 1');
  assert.ok(unverified.length, 'ACTUAL_UNVERIFIED_SOURCE_REQUIRED_FOR_NEGATIVE_CONTROL');
  await assert.rejects(db.query("UPDATE recitations SET audio_mode='surah_slice' WHERE id=?", [unverified[0].id]), /chk_catalog_slice/u);
  await assert.rejects(db.query("UPDATE recitations SET offset_verified=1,verification_status='passed',offset_check_score=NULL WHERE id=?", [unverified[0].id]), /chk_catalog_offset/u);
  const [chapter] = await db.query<RowDataPacket[]>('SELECT id FROM recitation_chapters LIMIT 1');
  await db.query("UPDATE recitation_chapters SET audio_url='https://example.org/corruption-fixture' WHERE id=?", [chapter[0].id]);
  await assert.rejects(verifyCatalogRows(db, data), /STORED_CATALOG_VALUE_MISMATCH/u);
  await downQuranCatalogTables(db, 'local-rehearsal');
  const [remaining] = await db.query<RowDataPacket[]>(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${QURAN_CATALOG_TABLES.map(() => '?').join(',')})`, [...QURAN_CATALOG_TABLES]);
  assert.equal(remaining.length, 0);
  assert.equal(await canonical(), before);
  assert.deepEqual(await criticalCounts(), criticalBefore, 'LOCAL_EXISTING_TABLE_COUNTS_CHANGED');
  await db.query(plan.sql);
  await verifyCatalogRows(db, data);
  assert.equal(await canonical(), before);
  const report = { mysql_version: version[0].version, sql_sha256: plan.sha256, catalog_sha256: data.catalog_sha256, counts: first, schema, d1_collations: d1, canonical_checksum: before,
    migration_twice: true, import_twice: true, replay_table_checksums_unchanged: true, existing_users_join: true, unverified_audio_publication_rejected: true,
    publication_without_audio_evidence_rejected: true, corrupted_catalog_rejected: true, rollback_remaining: remaining.length, reapply_after_rollback: true };
  Object.assign(report, { unverified_surah_slice_rejected: true, offset_without_score_rejected: true,
    previous_failed_imported_rows: failedImportedBefore, failed_imported_after: 0, existing_table_counts_unchanged: true, critical_counts: criticalBefore });
  await writeFile(option('--out'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} catch (error) {
  // mysql2 errors also contain the complete SQL payload. Expose the failure
  // and a nonzero exit, never that payload (or user rows from the clone).
  console.error(JSON.stringify({ rehearsal_passed: false, message: error instanceof Error ? error.message : 'UNKNOWN_REHEARSAL_ERROR' }));
  process.exitCode = 1;
} finally { await db.end(); }
