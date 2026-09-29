import { describe, expect, it } from 'vitest';
import { omitUnchangedOpenRouterSecret } from '@/lib/adminSettings';

describe('admin settings secret payload', () => {
  it('omits an empty OpenRouter key so unrelated settings saves preserve the current secret', () => {
    expect(omitUnchangedOpenRouterSecret({
      AI_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: '',
    })).toEqual({ AI_PROVIDER: 'openrouter' });
  });

  it('never resubmits a server-provided mask as the actual key', () => {
    expect(omitUnchangedOpenRouterSecret({
      OPENROUTER_API_KEY: 'sk-****-abc',
    })).toEqual({});
  });

  it('sends a newly entered key after trimming surrounding whitespace', () => {
    expect(omitUnchangedOpenRouterSecret({
      AI_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: '  sk-or-new-test-key  ',
    })).toEqual({
      AI_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'sk-or-new-test-key',
    });
  });
});
