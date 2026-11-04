import { describe, expect, it } from 'vitest';

import { stepDetail } from './step-detail.js';

describe('stepDetail', () => {
  it('keeps the token usage and the requested tools of a model call', () => {
    expect(
      stepDetail({
        kind: 'model_call',
        ms: 900,
        usage: { inputTokens: 1200, cachedInputTokens: 800, outputTokens: 45 },
        requested: ['tool_search', 'tool_call'],
      }),
    ).toEqual({
      tokens: { input: 1200, cached: 800, output: 45 },
      requested: ['tool_search', 'tool_call'],
    });
  });

  it('redacts and cuts the arguments and result of a tool', () => {
    const d = stepDetail({
      kind: 'tool',
      name: 'tool_call',
      ok: true,
      ms: 31,
      input: { key: 'GET /contacts', query: { q: '0912345678' } },
      result: `{"items":[{"email":"a@b.vn"}]}${'x'.repeat(2000)}`,
    });
    expect(d).toMatchObject({ resultChars: 2030 });
    if (!d || !('args' in d)) throw new Error('tool detail expected');
    expect(d.args).toContain('GET /contacts');
    expect(d.args).not.toContain('0912345678');
    expect(d.result).not.toContain('a@b.vn');
    expect(d.result.length).toBeLessThanOrEqual(600);
  });

  it('stays under the column byte cap with multi-byte text', () => {
    const d = stepDetail({
      kind: 'tool',
      name: 'run_sql',
      input: 'ữ'.repeat(3000),
      result: 'ữ '.repeat(3000),
    });
    expect(Buffer.byteLength(JSON.stringify(d), 'utf8')).toBeLessThanOrEqual(4000);
  });

  it('has no detail for other steps', () => {
    expect(stepDetail({ kind: 'wrap_up' })).toBeNull();
  });
});
