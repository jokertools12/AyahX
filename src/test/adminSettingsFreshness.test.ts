// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ value: 'openrouter', selects: 0 }));
// Isolated unit only: importing the settings reader must not open a DB pool.
vi.mock('../../server/db', () => ({ query: vi.fn(async (sql: string) => {
  if (sql.includes('WHERE key_name IN')) {
    state.selects++;
    return [{ key_name: 'AI_PROVIDER', value_text: state.value, is_secret: false }];
  }
  return [];
}) }));
import { getRawSettings } from '../../server/services/settingsService';

describe('registered settings runtime consumer', () => {
  it('reads changed database values on the next call without a stale value cache', async () => {
    expect((await getRawSettings(['AI_PROVIDER'])).AI_PROVIDER).toBe('openrouter');
    state.value = 'openai';
    expect((await getRawSettings(['AI_PROVIDER'])).AI_PROVIDER).toBe('openai');
    expect(state.selects).toBe(2);
  });
});
