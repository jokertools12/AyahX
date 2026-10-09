import { readFile, writeFile } from 'node:fs/promises';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { upQuranTextTables, downQuranTextTables, QURAN_TEXT_TABLES } from '../server/db/migrations/001_addQuranTextTables';
import { importQuranText, type QuranTextCorpus } from '../server/services/quranTextImport';

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
  await upQuranTextTables(connection);
  await upQuranTextTables(connection);
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
  const report = { mysql: version[0].version, dryRun, first, second, counts: counts[0], corruptionRejected, rollbackRemaining: remaining.length, reapplyAfterRollback: true };
  if (process.argv.includes('--out')) await writeFile(option('--out'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await connection.end();
}
