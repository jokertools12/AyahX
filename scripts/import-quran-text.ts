import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';
import { buildQuranTextCorpus, checksumText, importQuranText, type ScriptWord, type SourceSurah } from '../server/services/quranTextImport';
import { upQuranTextTables, downQuranTextTables, quranTextMigrationSql } from '../server/db/migrations/001_addQuranTextTables';
import { generateQuranTextSql } from '../server/services/quranTextSql';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export async function main(): Promise<void> {
  const manifestPath = option('--manifest');
  if (!manifestPath) throw new Error('Supply --manifest <pinned source manifest JSON>. Default is dry-run; --apply writes only to an explicit local database.');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    qud_version: string;
    script: { path?: string; url?: string; sha256: string };
    surahs: { path?: string; url?: string; sha256: string };
  };
  const cacheDir = option('--cache-dir') || resolve(tmpdir(), 'ayahx-qud-text-cache');
  const loadAsset = async (asset: typeof manifest.script): Promise<string> => {
    if (asset.path) return readFile(asset.path, 'utf8');
    if (!asset.url?.startsWith(`https://github.com/QUD-Technologies/quranic-universal-audio/releases/download/${manifest.qud_version}/`)) throw new Error('SOURCE_URL_MUST_BE_PINNED_QUD_RELEASE');
    const cachePath = resolve(cacheDir, `${asset.sha256}.json`);
    try { return await readFile(cachePath, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const response = await fetch(asset.url);
    if (!response.ok) throw new Error(`SOURCE_HTTP_${response.status}`);
    const text = await response.text();
    if (checksumText(text) !== asset.sha256) throw new Error('SOURCE_CHECKSUM_MISMATCH');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, text, 'utf8');
    return text;
  };
  const [scriptText, surahText] = await Promise.all([
    loadAsset(manifest.script), loadAsset(manifest.surahs),
  ]);
  if (checksumText(scriptText) !== manifest.script.sha256 || checksumText(surahText) !== manifest.surahs.sha256) throw new Error('SOURCE_CHECKSUM_MISMATCH');
  const corpus = buildQuranTextCorpus(JSON.parse(scriptText) as Record<string, ScriptWord>, JSON.parse(surahText) as Record<string, SourceSurah>, manifest.qud_version);
  const output = option('--output');
  if (output) await writeFile(output, JSON.stringify(corpus, null, 2), 'utf8');
  const apply = process.argv.includes('--apply');
  const rollback = process.argv.includes('--rollback-schema');
  const sqlOutput = option('--sql-output');
  if (sqlOutput) {
    if (apply || rollback) throw new Error('SQL_EXPORT_IS_DRY_RUN_ONLY');
    const outside = relative(process.cwd(), resolve(sqlOutput));
    if (!outside.startsWith('..') && !isAbsolute(outside)) throw new Error('RAW_SQL_MUST_STAY_OUTSIDE_REPOSITORY');
    const plan = generateQuranTextSql(corpus);
    await writeFile(sqlOutput, plan.sql, 'utf8');
    console.log(JSON.stringify({ dryRun: true, creates: quranTextMigrationSql.length, ...plan.counts, checksum: corpus.checksum, sql_sha256: plan.sha256, batch_size: plan.batchSize, statements: plan.statements }, null, 2));
    return;
  }
  if (!apply && !rollback) {
    console.log(JSON.stringify({ dryRun: true, qud_version: corpus.version, surahs: Object.keys(corpus.surahs).length, ayahs: corpus.ayahs.length, words: corpus.wordCount, checksum: corpus.checksum, codepoints: corpus.codepoints.length }, null, 2));
    return;
  }
  const host = option('--db-host');
  const database = option('--db-name');
  if (!host || !['127.0.0.1', 'localhost', '::1'].includes(host) || !database?.startsWith('ayahx_d1_')) throw new Error('D1_DB_TARGET_MUST_BE_EXPLICIT_LOCAL_TEST_DATABASE');
  if (rollback && !process.argv.includes('--confirm-drop-d1-tables')) throw new Error('ROLLBACK_REQUIRES_CONFIRM_DROP_D1_TABLES');
  // Deliberately ignores application .env and production DB configuration.
  const connection = await mysql.createConnection({ host, port: Number(option('--db-port') || 3306), user: option('--db-user') || 'root', password: process.env.D1_DB_PASSWORD || '', database, charset: 'utf8mb4' });
  try {
    if (rollback) {
      await downQuranTextTables(connection);
      console.log(JSON.stringify({ rollback: true, database }));
    } else {
      await upQuranTextTables(connection);
      console.log(JSON.stringify(await importQuranText(connection, corpus, false), null, 2));
    }
  } finally {
    await connection.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
