import { describe, expect, it } from 'vitest';
import { buildQuranTextCorpus } from '../../server/services/quranTextImport';
import { generateQuranTextSql } from '../../server/services/quranTextSql';

const corpus = buildQuranTextCorpus({
  '1:1:1': { surah: '1', ayah: '1', word: '1', text: 'بِسْمِ' },
  '1:1:2': { surah: '1', ayah: '1', word: '2', text: '۝١' },
}, { '1': { num_verses: 1, name_ar: 'الفاتحة', name_en: 'Fatiha', verses: [{ verse: 1, num_words: 1 }] } }, 'fixture');

describe('D1 deterministic SQL export', () => {
  it('preserves UTF-8 bytes and emits only additive schema/data statements', () => {
    const plan = generateQuranTextSql(corpus, 1);
    expect(plan.sha256).toBe(generateQuranTextSql(corpus, 1).sha256);
    expect(plan.sql).toContain(`CONVERT(X'${Buffer.from('بِسْمِ').toString('hex')}' USING utf8mb4)`);
    expect(plan.sql).not.toMatch(/^(?:ALTER|DROP|DELETE|RENAME)\b/mu);
    expect(plan.sql).not.toMatch(/^UPDATE /mu);
    expect(plan.sql).not.toContain('INSERT INTO users');
    expect(plan.batchSize).toBe(1);
  });
  it('rejects oversized batches and corrupted corpus before generating SQL', () => {
    expect(() => generateQuranTextSql(corpus, 1001)).toThrow('SQL_BATCH_LIMIT_EXCEEDED');
    expect(() => generateQuranTextSql({ ...corpus, checksum: 'wrong' })).toThrow('CORPUS_INTEGRITY_MISMATCH');
  });
});
