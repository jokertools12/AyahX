import { quranTextMigrationSql } from '../db/migrations/001_addQuranTextTables';
import { checksumText, simpleSearchText, stableId, type QuranTextCorpus } from './quranTextImport';

type SqlValue = string | number | boolean | null;

function literal(value: SqlValue): string {
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('SQL_INTEGER_REQUIRED');
    return String(value);
  }
  // Hex UTF-8 preserves exact bytes and is independent of client escaping or
  // NO_BACKSLASH_ESCAPES. No text normalization is performed here.
  return `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`;
}

/** Pure dry-run plan; never connects to Railway or the application database. */
export function generateQuranTextSql(corpus: QuranTextCorpus, batchSize = 500): {
  sql: string; sha256: string; statements: number; batchSize: number;
  counts: { surahs: number; ayahs: number; words: number };
} {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error('SQL_BATCH_LIMIT_EXCEEDED');
  const actualChecksum = checksumText(corpus.ayahs.map((row) => `${row.surah}:${row.ayah}\t${row.text}`).join('\n'));
  if (actualChecksum !== corpus.checksum || corpus.ayahs.reduce((sum, row) => sum + row.words.length, 0) !== corpus.wordCount) throw new Error('CORPUS_INTEGRITY_MISMATCH');
  const statements = [...quranTextMigrationSql.map((sql) => `${sql};`), 'START TRANSACTION;'];
  const insert = (table: string, columns: string[], rows: SqlValue[][]): void => {
    for (let start = 0; start < rows.length; start += batchSize) {
      const values = rows.slice(start, start + batchSize).map((row) => `(${row.map(literal).join(',')})`).join(',\n');
      statements.push(`INSERT INTO ${table} (${columns.join(',')}) VALUES\n${values}\nON DUPLICATE KEY UPDATE id=id;`);
    }
  };
  const riwayahId = stableId('riwayah', 'hafs_an_asim');
  const versionId = stableId('version', `${corpus.version}:${corpus.checksum}`);
  insert('riwayat', ['id', 'code', 'name_ar', 'name_en', 'aligner_code'], [[riwayahId, 'hafs_an_asim', 'حفص عن عاصم', 'Hafs an Asim', 'hafs']]);
  insert('quran_text_versions', ['id', 'riwayah_id', 'source', 'script', 'version_label', 'qud_version', 'checksum', 'is_active'], [[versionId, riwayahId, 'qud', 'uthmani', corpus.version, corpus.version, corpus.checksum, true]]);
  insert('quran_surahs', ['id', 'number', 'name_ar', 'name_en', 'ayah_count', 'has_basmala'],
    Object.keys(corpus.surahs).map(Number).sort((a, b) => a - b).map((number) => {
      const info = corpus.surahs[String(number)];
      return [stableId('surah', String(number)), number, info.name_ar, info.name_en, info.num_verses, number !== 9];
    }));
  const ayahs: SqlValue[][] = [];
  const words: SqlValue[][] = [];
  for (const row of [...corpus.ayahs].sort((a, b) => a.surah - b.surah || a.ayah - b.ayah)) {
    const ayahId = stableId('ayah', `${versionId}:${row.surah}:${row.ayah}`);
    ayahs.push([ayahId, versionId, row.surah, row.ayah, row.text, simpleSearchText(row.text), row.words.length]);
    row.words.forEach((word, index) => words.push([stableId('word', `${ayahId}:${index + 1}`), ayahId, index + 1, word, simpleSearchText(word)]));
  }
  insert('quran_ayahs', ['id', 'text_version_id', 'surah', 'ayah', 'text_uthmani', 'text_simple', 'words_count'], ayahs);
  insert('quran_words', ['id', 'ayah_id', 'position', 'text_uthmani', 'text_simple'], words);
  statements.push('COMMIT;');
  const sql = `-- D1 QUD ${corpus.version}; canonical SHA-256 ${corpus.checksum}\n${statements.join('\n\n')}\n`;
  return { sql, sha256: checksumText(sql), statements: statements.length, batchSize,
    counts: { surahs: Object.keys(corpus.surahs).length, ayahs: corpus.ayahs.length, words: corpus.wordCount } };
}
