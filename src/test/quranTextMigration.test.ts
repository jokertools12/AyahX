import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

import {
  QURAN_TEXT_TABLES,
  downQuranTextTables,
  quranTextMigrationSql,
  upQuranTextTables,
} from '../../server/db/migrations/001_addQuranTextTables';

afterEach(() => vi.restoreAllMocks());

function executor() {
  return { query: vi.fn(async (_sql: string) => []) };
}

describe('D1 Quran text migration', () => {
  it('creates all tables in dependency order and is safe to replay', async () => {
    const db = executor();
    await upQuranTextTables(db);
    await upQuranTextTables(db);

    expect(db.query).toHaveBeenCalledTimes(quranTextMigrationSql.length * 2);
    expect(db.query.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS riwayat');
    expect(db.query.mock.calls.at(-1)?.[0]).toContain('translation_ayahs');
    expect(quranTextMigrationSql.every((sql) => sql.includes('IF NOT EXISTS'))).toBe(true);
  });

  it('drops dependants before parents for the documented rollback', async () => {
    const db = executor();
    await downQuranTextTables(db);

    expect(db.query.mock.calls.map(([sql]) => sql)).toEqual(
      QURAN_TEXT_TABLES.map((table) => `DROP TABLE IF EXISTS \`${table}\``),
    );
  });

  it('keeps legal text tables separate from future recitation tables', () => {
    expect(quranTextMigrationSql.join('\n')).not.toContain('CREATE TABLE IF NOT EXISTS recitations');
    expect(quranTextMigrationSql.join('\n')).toContain('text_uthmani TEXT NOT NULL');
  });
});
