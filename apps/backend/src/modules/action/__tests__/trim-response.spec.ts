import { describe, expect, it } from 'vitest';

import { trimResponse } from '../domain/trim-response.js';

const f = (name: string, type: 'string' | 'number' | 'boolean' | 'object' | 'array') => ({
  name,
  type,
  description: 'd',
});

describe('trimResponse', () => {
  it('keeps only declared fields', () => {
    expect(
      trimResponse({ status: 'paid', total: 5, internal: 'x' }, [f('status', 'string')]),
    ).toEqual({ status: 'paid' });
  });

  it('truncates strings, caps arrays and depth', () => {
    const out = trimResponse(
      {
        s: 'x'.repeat(900),
        a: Array.from({ length: 30 }, (_, i) => i),
        o: { a: { b: { c: { d: 1 } } } },
      },
      [f('s', 'string'), f('a', 'array'), f('o', 'object')],
    ) as { s: string; a: number[]; o: unknown };
    expect(out.s).toHaveLength(500);
    expect(out.a).toHaveLength(10);
    expect(out.o).toEqual({ a: { b: { c: null } } });
  });

  it('drops declared fields whose type does not match', () => {
    expect(trimResponse({ n: 'oops', b: true }, [f('n', 'number'), f('b', 'boolean')])).toEqual({
      b: true,
    });
  });

  it('trims each element of a top-level array (max 10)', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: i, secret: 's' }));
    const out = trimResponse(rows, [f('id', 'number')]) as unknown[];
    expect(out).toHaveLength(10);
    expect(out[0]).toEqual({ id: 0 });
  });

  it('ignores prototype pollution keys and non-object bodies', () => {
    const body = JSON.parse('{"__proto__":{"x":1},"ok":true}');
    const out = trimResponse(body, [f('__proto__', 'object'), f('ok', 'boolean')]);
    expect(out).toEqual({ ok: true });
    expect(trimResponse(null, [f('a', 'string')])).toBeNull();
    expect(trimResponse('text', [f('a', 'string')])).toBeNull();
  });
});
