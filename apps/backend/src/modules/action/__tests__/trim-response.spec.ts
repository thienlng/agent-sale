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

  it('reaches into arrays and objects with dotted names', () => {
    const body = {
      total: 2,
      items: [
        { code: 'BK1', service: 'Cut', phone: '0901' },
        { code: 'BK2', service: 'Dye', phone: '0902' },
      ],
      meta: { page: 1, token: 'x' },
    };
    expect(
      trimResponse(body, [
        f('total', 'number'),
        f('items', 'array'),
        f('items.code', 'string'),
        f('items.service', 'string'),
        f('meta.page', 'number'),
      ]),
    ).toEqual({
      total: 2,
      items: [
        { code: 'BK1', service: 'Cut' },
        { code: 'BK2', service: 'Dye' },
      ],
      meta: { page: 1 },
    });
  });

  it('caps nested arrays, drops mismatched types and ignores unsafe paths', () => {
    const body = JSON.parse(
      '{"items":' +
        JSON.stringify(Array.from({ length: 15 }, (_, i) => ({ n: i, s: 1 }))) +
        ',"a":{"__proto__":{"x":1}}}',
    );
    const out = trimResponse(body, [
      f('items.n', 'number'),
      f('items.s', 'string'),
      f('a.__proto__.x', 'number'),
      f('.bad', 'string'),
    ]) as { items: unknown[]; a?: unknown };
    expect(out.items).toHaveLength(10);
    expect(out.items[0]).toEqual({ n: 0 });
    expect(out.a).toBeUndefined();
  });

  it('keeps a whole declared container when no child is declared', () => {
    expect(trimResponse({ items: [{ a: 1 }] }, [f('items', 'array')])).toEqual({
      items: [{ a: 1 }],
    });
  });

  it('still matches a literal key that contains a dot', () => {
    expect(trimResponse({ 'user.name': 'An', other: 1 }, [f('user.name', 'string')])).toEqual({
      'user.name': 'An',
    });
  });

  it('applies dotted fields to a top-level array response', () => {
    const out = trimResponse(
      [{ order: { id: 1, secret: 's' } }, { order: { id: 2, secret: 's' } }],
      [f('order.id', 'number')],
    );
    expect(out).toEqual([{ order: { id: 1 } }, { order: { id: 2 } }]);
  });

  it('ignores a parent whose declared type contradicts the data and skips non-object rows', () => {
    expect(
      trimResponse({ items: { a: 1 } }, [f('items', 'array'), f('items.a', 'number')]),
    ).toEqual({});
    expect(
      trimResponse({ items: [1, { a: 1, b: 2 }, null] }, [
        f('items', 'array'),
        f('items.a', 'number'),
      ]),
    ).toEqual({ items: [{ a: 1 }] });
  });

  it('does not follow paths deeper than the depth limit', () => {
    expect(trimResponse({ a: { b: { c: { d: 1 } } } }, [f('a.b.c.d', 'number')])).toEqual({});
  });
});
