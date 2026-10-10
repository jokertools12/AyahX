import { describe, it, expect } from 'vitest';
import { timingMigrationSql, downQuranTimingTables } from '../../server/db/migrations/003_addQuranTimingTables';
describe('D3 additive scope', () => {
  it('has no FKs or mutation of tables before D1 and uses explicit collation', () => {
    const sql = timingMigrationSql();
    expect(sql.join('\n')).not.toMatch(/FOREIGN KEY|ALTER TABLE (?:users|riwayat|render_jobs)|DROP TABLE/iu);
    expect(sql.filter((s) => s.startsWith('CREATE')).every((s) => s.includes('COLLATE=utf8mb4_unicode_ci'))).toBe(true);
    expect(sql.filter((s) => s.startsWith('SET'))).toHaveLength(3);
  });
  it('rejects down outside private rehearsal before querying anything', async () => {
    let calls = 0;
    await expect(downQuranTimingTables({ query: async () => { calls++; } }, 'production' as 'local-rehearsal')).rejects.toThrow('DESTRUCTIVE_REHEARSAL_ONLY');
    expect(calls).toBe(0);
  });
});
