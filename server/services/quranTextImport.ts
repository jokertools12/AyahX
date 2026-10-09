import { createHash } from 'node:crypto';
import type { Connection, RowDataPacket } from 'mysql2/promise';

export interface ScriptWord { surah: string; ayah: string; word: string; text: string }
export interface SourceSurah {
  num_verses: number;
  name_ar: string;
  name_en: string;
  verses: Array<{ verse: number; num_words: number }>;
}
export interface CanonicalAyah { surah: number; ayah: number; text: string; words: string[] }
export interface QuranTextCorpus {
  version: string;
  checksum: string;
  surahs: Record<string, SourceSurah>;
  ayahs: CanonicalAyah[];
  wordCount: number;
  codepoints: number[];
}

export function checksumText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Search-only representation. The stored legal text is never normalized. */
export function simpleSearchText(text: string): string {
  return text.normalize('NFD').replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u08D3-\u08FF]/gu, '')
    .replace(/ٱ/gu, 'ا');
}

/** Build legal text only from the release's script, never HF recited text. */
export function buildQuranTextCorpus(
  script: Record<string, ScriptWord>, surahs: Record<string, SourceSurah>, version: string,
): QuranTextCorpus {
  const grouped = new Map<string, Array<{ position: number; text: string }>>();
  for (const [key, word] of Object.entries(script)) {
    if (key !== `${word.surah}:${word.ayah}:${word.word}`) throw new Error(`SCRIPT_LOCATION_MISMATCH:${key}`);
    const location = `${Number(word.surah)}:${Number(word.ayah)}`;
    const words = grouped.get(location) || [];
    words.push({ position: Number(word.word), text: word.text });
    grouped.set(location, words);
  }
  const ayahs: CanonicalAyah[] = [];
  for (const surah of Object.keys(surahs).map(Number).sort((a, b) => a - b)) {
    const info = surahs[String(surah)];
    if (info.verses.length !== info.num_verses) throw new Error(`SURAH_COUNT_MISMATCH:${surah}`);
    for (let ayah = 1; ayah <= info.num_verses; ayah += 1) {
      const reference = info.verses.find((verse) => verse.verse === ayah);
      const entries = grouped.get(`${surah}:${ayah}`)?.sort((a, b) => a.position - b.position);
      if (!entries || !reference) throw new Error(`AYAH_MISSING:${surah}:${ayah}`);
      entries.forEach((entry, index) => {
        if (entry.position !== index + 1) throw new Error(`WORD_POSITION_GAP:${surah}:${ayah}`);
      });
      // Release script has a final verse-number ornament which is not a word.
      const ornament = entries.at(-1);
      if (ornament && /^۝[٠-٩0-9]+$/u.test(ornament.text)) entries.pop();
      if (entries.length !== reference.num_words) throw new Error(`WORD_COUNT_MISMATCH:${surah}:${ayah}:${entries.length}:${reference.num_words}`);
      const words = entries.map((entry) => entry.text);
      const text = words.join(' ');
      if (text.split(/\s+/u).length !== words.length) throw new Error(`INTRAWORD_WHITESPACE:${surah}:${ayah}`);
      ayahs.push({ surah, ayah, text, words });
      grouped.delete(`${surah}:${ayah}`);
    }
  }
  if (grouped.size) throw new Error('SCRIPT_HAS_UNEXPECTED_AYAHS');
  return {
    version, surahs, ayahs,
    checksum: checksumText(ayahs.map((row) => `${row.surah}:${row.ayah}\t${row.text}`).join('\n')),
    wordCount: ayahs.reduce((total, row) => total + row.words.length, 0),
    codepoints: [...new Set(Array.from(ayahs.map((row) => row.text).join('')).map((char) => char.codePointAt(0)!))].sort((a, b) => a - b),
  };
}

function stableId(kind: string, key: string): string {
  const hash = checksumText(`${kind}:${key}`);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/** Atomic data import. DDL is deliberately not part of this transaction. */
export async function importQuranText(
  connection: Pick<Connection, 'query' | 'beginTransaction' | 'commit' | 'rollback'>, corpus: QuranTextCorpus, dryRun = true,
): Promise<{ dryRun: boolean; surahs: number; ayahs: number; words: number; checksum: string }> {
  const report = { dryRun, surahs: Object.keys(corpus.surahs).length, ayahs: corpus.ayahs.length, words: corpus.wordCount, checksum: corpus.checksum };
  if (dryRun) return report;
  const riwayahId = stableId('riwayah', 'hafs_an_asim');
  const versionId = stableId('version', `${corpus.version}:${corpus.checksum}`);
  await connection.beginTransaction();
  try {
    await connection.query(`INSERT INTO riwayat (id,code,name_ar,name_en,aligner_code) VALUES (?,?,?,?,?)
      ON DUPLICATE KEY UPDATE name_ar=VALUES(name_ar),name_en=VALUES(name_en),aligner_code=VALUES(aligner_code)`,
    [riwayahId, 'hafs_an_asim', 'حفص عن عاصم', 'Hafs an Asim', 'hafs']);
    await connection.query(`INSERT INTO quran_text_versions (id,riwayah_id,source,script,version_label,qud_version,checksum,is_active)
      VALUES (?,?,'qud','uthmani',?,?,?,TRUE) ON DUPLICATE KEY UPDATE id=id`,
    [versionId, riwayahId, corpus.version, corpus.version, corpus.checksum]);
    for (const [number, surah] of Object.entries(corpus.surahs)) {
      await connection.query(`INSERT INTO quran_surahs (id,number,name_ar,name_en,ayah_count,has_basmala)
        VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name_ar=VALUES(name_ar),name_en=VALUES(name_en),ayah_count=VALUES(ayah_count),has_basmala=VALUES(has_basmala)`,
      [stableId('surah', number), Number(number), surah.name_ar, surah.name_en, surah.num_verses, Number(number) !== 9]);
    }
    for (const row of corpus.ayahs) {
      const ayahId = stableId('ayah', `${versionId}:${row.surah}:${row.ayah}`);
      await connection.query(`INSERT INTO quran_ayahs (id,text_version_id,surah,ayah,text_uthmani,text_simple,words_count)
        VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`,
      [ayahId, versionId, row.surah, row.ayah, row.text, simpleSearchText(row.text), row.words.length]);
      for (let i = 0; i < row.words.length; i += 1) {
        await connection.query(`INSERT INTO quran_words (id,ayah_id,position,text_uthmani,text_simple)
          VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`,
        [stableId('word', `${ayahId}:${i + 1}`), ayahId, i + 1, row.words[i], simpleSearchText(row.words[i])]);
      }
    }
    const [stored] = await connection.query<RowDataPacket[]>(
      'SELECT surah,ayah,text_uthmani,words_count FROM quran_ayahs WHERE text_version_id=? ORDER BY surah,ayah', [versionId],
    );
    const storedChecksum = checksumText(stored.map((row) => `${row.surah}:${row.ayah}\t${row.text_uthmani}`).join('\n'));
    if (stored.length !== corpus.ayahs.length || storedChecksum !== corpus.checksum) throw new Error('STORED_CANONICAL_TEXT_MISMATCH');
    const [storedWords] = await connection.query<RowDataPacket[]>(
      `SELECT a.surah,a.ayah,w.position,w.text_uthmani FROM quran_words w
       JOIN quran_ayahs a ON a.id=w.ayah_id WHERE a.text_version_id=? ORDER BY a.surah,a.ayah,w.position`, [versionId],
    );
    const expectedWords = corpus.ayahs.flatMap((row) => row.words.map((word, index) => `${row.surah}:${row.ayah}:${index + 1}\t${word}`));
    const actualWords = storedWords.map((row) => `${row.surah}:${row.ayah}:${row.position}\t${row.text_uthmani}`);
    if (checksumText(actualWords.join('\n')) !== checksumText(expectedWords.join('\n'))) throw new Error('STORED_CANONICAL_WORDS_MISMATCH');
    await connection.query('UPDATE quran_text_versions SET is_active=(id=?) WHERE riwayah_id=?', [versionId, riwayahId]);
    await connection.commit();
    return report;
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}
