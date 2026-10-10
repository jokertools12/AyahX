import { quranCatalogMigrationSql } from '../db/migrations/002_addQuranCatalogTables';
import { sha, type CatalogDataset, type CatalogRow } from './qudCatalogImport';

export function sqlLiteral(value: string | number | boolean | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('SQL_FINITE_NUMBER_REQUIRED');
    return String(value);
  }
  return `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`;
}

export function generateCatalogSql(dataset: CatalogDataset, batchSize = 250): { sql: string; sha256: string; statements: string[]; counts: Record<string, number>; batchSize: number } {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error('SQL_BATCH_LIMIT_EXCEEDED');
  if (dataset.recitations.some((row) => row.status === 'published' || row.surah_start_basmala_audio_status !== 'unverified') || dataset.chapters.some((row) => row.timing_complete !== null)) throw new Error('D2_PUBLICATION_OR_TIMING_IMPORT_PROHIBITED');
  if (dataset.riwayat.some((row) => row.is_active !== false || !['warsh_an_nafi','qalon_an_nafi','shubah_an_asim'].includes(String(row.code)))) throw new Error('D2_RIWAYAH_INSERT_NOT_APPROVED');
  const statements = [...quranCatalogMigrationSql.map((sql) => `${sql};`), 'START TRANSACTION;'];
  const tables: Record<string, CatalogRow[]> = { riwayat: dataset.riwayat, reciters: dataset.reciters, audio_providers: dataset.providers, recitations: dataset.recitations, recitation_chapters: dataset.chapters };
  for (const [table, rows] of Object.entries(tables)) {
    if (!rows.length) continue;
    const columns = Object.keys(rows[0]);
    if (columns.some((name) => !/^[a-z][a-z0-9_]*$/u.test(name)) || rows.some((row) => Object.keys(row).join(',') !== columns.join(','))) throw new Error('SQL_FIXED_COLUMNS_REQUIRED');
    if (table === 'riwayat') {
      // This table predates D2: only insert absent, approved metadata. No
      // duplicate-key UPDATE, even a no-op, may touch its existing rows.
      for (const row of rows) statements.push(`INSERT INTO riwayat (${columns.join(',')}) SELECT ${columns.map((column) => sqlLiteral(row[column])).join(',')} WHERE NOT EXISTS (SELECT 1 FROM riwayat WHERE id=${sqlLiteral(row.id)} COLLATE utf8mb4_unicode_ci);`);
      continue;
    }
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      statements.push(`INSERT INTO ${table} (${columns.join(',')}) VALUES\n${rows.slice(offset, offset + batchSize).map((row) => `(${columns.map((column) => sqlLiteral(row[column])).join(',')})`).join(',\n')}\nON DUPLICATE KEY UPDATE id=id;`);
    }
  }
  // Correct the verified old staging import without replacing its other data.
  // The pre-state is reconciled against its original dataset before replay.
  statements.push("UPDATE recitations SET status='needs_review' WHERE verification_status='failed' AND status='imported';");
  statements.push('COMMIT;');
  const sql = `-- D2 ${dataset.qud_version}; catalog SHA256 ${dataset.catalog_sha256}\n${statements.join('\n\n')}\n`;
  return { sql, sha256: sha(sql), statements, batchSize, counts: Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length])) };
}
