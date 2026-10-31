import { describe, expect, it } from 'vitest';
import { repairArguments, repairToolName } from '../domain/tool-repair.js';

const known = ['search_products', 'product_details', 'send_message', 'handoff'];

describe('repairToolName', () => {
  it('keeps an exact name', () => expect(repairToolName('handoff', known)).toBe('handoff'));
  it('matches case-insensitively', () =>
    expect(repairToolName('Search_Products', known)).toBe('search_products'));
  it('maps dashes and spaces to underscores', () => {
    expect(repairToolName('search-products', known)).toBe('search_products');
    expect(repairToolName('send message', known)).toBe('send_message');
  });
  it('accepts a unique match within edit distance 2', () =>
    expect(repairToolName('serch_products', known)).toBe('search_products'));
  it('rejects an ambiguous near match', () =>
    expect(repairToolName('ab', ['aa', 'ac'])).toBeNull());
  it('rejects far names', () => expect(repairToolName('delete_everything', known)).toBeNull());
});

describe('repairArguments', () => {
  it('passes objects through', () =>
    expect(repairArguments({ a: 1 })).toEqual({ ok: true, value: { a: 1 } }));
  it('strips code fences', () =>
    expect(repairArguments('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } }));
  it('fixes trailing commas', () =>
    expect(repairArguments('{"a":[1,2,],}')).toEqual({ ok: true, value: { a: [1, 2] } }));
  it('fixes single quotes', () =>
    expect(repairArguments("{'a':'it\"s'}")).toEqual({ ok: true, value: { a: 'it"s' } }));
  it('fixes unquoted keys without touching values', () =>
    expect(repairArguments('{query: "red, shoes", limit: 3, ok: true}')).toEqual({
      ok: true,
      value: { query: 'red, shoes', limit: 3, ok: true },
    }));
  it('retries the raw string behind the invalid-json marker', () =>
    expect(repairArguments({ __invalidJson: "{a:'x',}" })).toEqual({
      ok: true,
      value: { a: 'x' },
    }));
  it('fails when the marker carries no raw string', () =>
    expect(repairArguments({ __invalidJson: true })).toMatchObject({ ok: false }));
  it('fails on garbage without echoing it', () => {
    const r = repairArguments('not json at all {{{');
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('garbage');
  });
});
