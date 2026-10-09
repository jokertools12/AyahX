import { readFile, writeFile } from 'node:fs/promises';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { upQuranTextTables, downQuranTextTables, QURAN_TEXT_TABLES } from '../server/db/migrations/001_addQuranTextTables';
import { importQuranText, type QuranTextCorpus } from '../server/services/quranTextImport';
import { verifyQuranTextSchemaCollations } from '../server/services/quranTextSchemaVerification';

const option = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const corpusPath = option('--corpus');
const database = option('--db-name');
const host = option('--db-host');
if (!process.argv.includes('--corpus') || !process.argv.includes('--db-name') || !process.argv.includes('--db-host')
  || !['localhost', '127.0.0.1', '::1'].includes(host) || !database?.startsWith('ayahx_d1_')) throw new Error('EXPLICIT_LOCAL_D1_TEST_DB_REQUIRED');
const corpus = JSON.parse(await readFile(corpusPath, 'utf8')) as QuranTextCorpus;
const connection = await mysql.createConnection({ host, port: Number(option('--db-port') || 3306), user: 'root', password: process.env.D1_DB_PASSWORD || '', database, charset: 'utf8mb4' });
try {
  const [version] = await connection.query<RowDataPacket[]>('SELECT VERSION() AS version');
  if (version[0].version !== '9.7.2') throw new Error('EXACT_MYSQL_9_7_2_REQUIRED');
  await upQuranTextTables(connection);
  await upQuranTextTables(connection);
  const collations = await verifyQuranTextSchemaCollations(connection);
  const dryRun = await importQuranText(connection, corpus, true);
  const first = await importQuranText(connection, corpus, false);
  const second = await importQuranText(connection, corpus, false);
  const [counts] = await connection.query<RowDataPacket[]>(`SELECT
    (SELECT COUNT(*) FROM quran_surahs) AS surahs,
    (SELECT COUNT(*) FROM quran_ayahs) AS ayahs,
    (SELECT COUNT(*) FROM quran_words) AS words,
    (SELECT COUNT(*) FROM quran_text_versions) AS versions`);
  if (Number(counts[0].surahs) !== first.surahs || Number(counts[0].ayahs) !== first.ayahs
    || Number(counts[0].words) !== first.words || Number(counts[0].versions) !== 1) throw new Error('DB_IDEMPOTENCY_FAILED');
  // Temporary probe copies the actual canonical column definition, including
  // its collation, and adds a unique text key solely in the disposable DB.
  await connection.query('CREATE TEMPORARY TABLE d1_diacritic_probe LIKE quran_words');
  await connection.query('ALTER TABLE d1_diacritic_probe ADD UNIQUE KEY uk_probe_text (text_uthmani)');
  await connection.query(`INSERT INTO d1_diacritic_probe (id,ayah_id,position,text_uthmani,text_simple)
    VALUES ('diacritic-1','probe',1,'عَلَم','علم'),('diacritic-2','probe',2,'عِلْم','علم')`);
  const [distinct] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS rows_count,COUNT(DISTINCT text_uthmani) AS distinct_count FROM d1_diacritic_probe');
  if (Number(distinct[0].rows_count) !== 2 || Number(distinct[0].distinct_count) !== 2) throw new Error('DIACRITICS_COLLAPSED_BY_SQL_COLLATION');
  await connection.query('DROP TEMPORARY TABLE d1_diacritic_probe');
  const [existingUsers] = await connection.query<RowDataPacket[]>("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users'");
  let existingTableJoin = false;
  if (existingUsers.length) {
    await connection.query('SELECT COUNT(*) FROM quran_surahs s LEFT JOIN users u ON u.email=s.name_en');
    await connection.query('SELECT COUNT(*) FROM riwayat r LEFT JOIN users u ON u.id=r.id');
    existingTableJoin = true;
  } else if (process.argv.includes('--require-existing-users')) throw new Error('RESTORED_USERS_TABLE_REQUIRED_FOR_JOIN_TEST');
  // A corruption must fail closed and must not activate a changed legal text.
  await connection.query('UPDATE quran_ayahs SET text_uthmani=? WHERE surah=1 AND ayah=1', ['corrupt-test-fixture']);
  let corruptionRejected = false;
  try { await importQuranText(connection, corpus, false); }
  catch (error) { if (!(error instanceof Error) || error.message !== 'STORED_CANONICAL_TEXT_MISMATCH') throw error; corruptionRejected = true; }
  if (!corruptionRejected) throw new Error('CORRUPTION_WAS_NOT_REJECTED');
  // Test rollback on this disposable schema only; DDL has implicit commits.
  await downQuranTextTables(connection);
  const [remaining] = await connection.query<RowDataPacket[]>(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (${QURAN_TEXT_TABLES.map(() => '?').join(',')})`, [database, ...QURAN_TEXT_TABLES],
  );
  if (remaining.length) throw new Error('ROLLBACK_LEFT_D1_TABLES');
  await upQuranTextTables(connection);
  await importQuranText(connection, corpus, false);
  const report = { mysql: version[0].version, dryRun, first, second, counts: counts[0], collations, diacriticsDistinct: distinct[0], uniqueTextKeyPreserved: true, existingTableJoin, corruptionRejected, rollbackRemaining: remaining.length, reapplyAfterRollback: true };
  if (process.argv.includes('--out')) await writeFile(option('--out'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await connection.end();
}
