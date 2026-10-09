import { describe, expect, it, vi } from 'vitest';
import { buildQuranTextCorpus, importQuranText, type ScriptWord, type SourceSurah } from '../../server/services/quranTextImport';
import type { PoolConnection } from 'mysql2/promise';

const script: Record<string, ScriptWord> = {
  '1:1:1': { surah: '1', ayah: '1', word: '1', text: 'بِسْمِ' },
  '1:1:2': { surah: '1', ayah: '1', word: '2', text: 'ٱللَّهِ' },
  '1:1:3': { surah: '1', ayah: '1', word: '3', text: '۝١' },
};
const surahs: Record<string, SourceSurah> = { '1': { num_verses: 1, name_ar: 'الفاتحة', name_en: 'Fatiha', verses: [{ verse: 1, num_words: 2 }] } };

describe('D1 legal Quran text importer', () => {
  it('preserves exact legal words, separates ornaments and derives counts', () => {
    const corpus = buildQuranTextCorpus(script, surahs, 'fixture');
    expect(corpus.ayahs[0].text).toBe('بِسْمِ ٱللَّهِ');
    expect(corpus.wordCount).toBe(2);
    expect(corpus.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(buildQuranTextCorpus(script, surahs, 'fixture').checksum).toBe(corpus.checksum);
  });
  it('fails closed on missing words or mismatched references', () => {
    expect(() => buildQuranTextCorpus({ ...script, '1:1:1': { ...script['1:1:1'], word: '9' } }, surahs, 'fixture')).toThrow('SCRIPT_LOCATION_MISMATCH');
    expect(() => buildQuranTextCorpus(script, { '1': { ...surahs['1'], verses: [{ verse: 1, num_words: 4 }] } }, 'fixture')).toThrow('WORD_COUNT_MISMATCH');
  });
  it('dry-run never starts a transaction or issues a query', async () => {
    const db = { query: vi.fn(), beginTransaction: vi.fn() } as unknown as PoolConnection;
    const result = await importQuranText(db, buildQuranTextCorpus(script, surahs, 'fixture'));
    expect(result.dryRun).toBe(true);
    expect(db.query).not.toHaveBeenCalled();
    expect(db.beginTransaction).not.toHaveBeenCalled();
  });
  it('rolls back and propagates database errors', async () => {
    const db = { query: vi.fn().mockRejectedValue(new Error('write failed')), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn() } as unknown as PoolConnection;
    await expect(importQuranText(db, buildQuranTextCorpus(script, surahs, 'fixture'), false)).rejects.toThrow('write failed');
    expect(db.rollback).toHaveBeenCalledOnce();
    expect(db.commit).not.toHaveBeenCalled();
  });
});
