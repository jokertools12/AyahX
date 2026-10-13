import { describe, expect, it } from 'vitest';
import { term, termHelp, termLabel } from './terms';

describe('owner-facing terminology', () => {
  it('distinguishes advisory automated checks from human confirmation', () => {
    expect(termLabel('auto_verified')).toBe('فحص آلي مبدئي');
    expect(termHelp('auto_verified')).toContain('ليس تأكيدًا');
    expect(termLabel('confirmed')).toBe('مؤكَّد بواسطتك');
  });
  it('never promotes an unknown enum into a successful or raw owner-facing label', () => {
    expect(termLabel('future_technical_state')).not.toContain('future_technical_state');
    expect(term('future_technical_state').tone).toBe('warning');
    expect(termHelp('future_technical_state')).toContain('لا يُعامل كموافقة');
  });
  it('keeps incomplete coverage and preliminary publication explicit', () => {
    expect(termHelp('near_complete')).toContain('ليست مكتملة');
    expect(termHelp('published')).toContain('يلزم أيضًا');
  });
});
