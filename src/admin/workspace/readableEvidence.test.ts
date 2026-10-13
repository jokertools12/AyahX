import { describe, expect, it } from 'vitest';
import { readableCode, readableEvidence } from './readableEvidence';

describe('owner evidence projection', () => {
  it('distinguishes automated evidence from human confirmation and preserves actual values', () => {
    const facts = readableEvidence({ voice_identity_status: 'auto_verified', auto_evidence: { result: { V1: { passed: true }, V2: { passed: false } } }, coverage_words: 50, expected_words: 51 }, 'ar');
    expect(facts.map(fact => fact.value)).toContain('فحص آلي مبدئي');
    expect(facts.find(fact => fact.field === 'V2')?.value).toBe('لم ينجح الفحص');
    expect(facts.find(fact => fact.field === 'coverage_words')?.value).toBe((50).toLocaleString('ar'));
  });
  it('does not expose arbitrary diagnostics or raw unknown enums as owner labels', () => {
    expect(readableEvidence({ password: 'private', connection_string: 'private', license_status: 'future_enum' }, 'ar')).toEqual([{ field: 'license_status', label: 'قرار الترخيص', value: 'قيمة تحتاج تفسيرًا' }]);
    expect(readableCode('UNKNOWN_INTERNAL_CODE', 'ar')).not.toContain('UNKNOWN');
  });
});
