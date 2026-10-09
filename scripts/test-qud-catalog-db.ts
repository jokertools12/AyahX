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
  await upQuranCatalogTables(db);
  await upQuranCatalogTables(db);
  await db.query(plan.sql);
  const first = await verifyCatalogRows(db, data);
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
  const [chapter] = await db.query<RowDataPacket[]>('SELECT id FROM recitation_chapters LIMIT 1');
  await db.query("UPDATE recitation_chapters SET audio_url='https://example.org/corruption-fixture' WHERE id=?", [chapter[0].id]);
  await assert.rejects(verifyCatalogRows(db, data), /STORED_CATALOG_VALUE_MISMATCH/u);
  await downQuranCatalogTables(db, 'local-rehearsal');
  const [remaining] = await db.query<RowDataPacket[]>(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${QURAN_CATALOG_TABLES.map(() => '?').join(',')})`, [...QURAN_CATALOG_TABLES]);
  assert.equal(remaining.length, 0);
  assert.equal(await canonical(), before);
  await db.query(plan.sql);
  await verifyCatalogRows(db, data);
  assert.equal(await canonical(), before);
  const report = { mysql_version: version[0].version, counts: first, schema, d1_collations: d1, canonical_checksum: before,
    migration_twice: true, import_twice: true, replay_table_checksums_unchanged: true, existing_users_join: true, unverified_audio_publication_rejected: true,
    publication_without_audio_evidence_rejected: true, corrupted_catalog_rejected: true, rollback_remaining: remaining.length, reapply_after_rollback: true };
  await writeFile(option('--out'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally { await db.end(); }
