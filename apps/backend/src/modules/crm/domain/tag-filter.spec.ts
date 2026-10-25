import { describe, expect, it } from 'vitest';
import { resolveTagFilter } from './tag-filter.js';

// c1: hot + vip, c2: hot, c3: vip, c4: no tag.
const pairs = [
  { entityId: 'c1', tagId: 'hot' },
  { entityId: 'c1', tagId: 'vip' },
  { entityId: 'c2', tagId: 'hot' },
  { entityId: 'c3', tagId: 'vip' },
];
const tagged = new Set(['c1', 'c2', 'c3']);
const run = (filter: Parameters<typeof resolveTagFilter>[0]) => {
  const r = resolveTagFilter(filter, pairs, tagged);
  return { include: r.include?.sort() ?? null, exclude: r.exclude.sort() };
};

describe('resolveTagFilter', () => {
  it('does not narrow anything without conditions', () => {
    expect(run({})).toEqual({ include: null, exclude: [] });
  });
  it('matches entities with any of the tags', () => {
    expect(run({ any: ['hot'] })).toEqual({ include: ['c1', 'c2'], exclude: [] });
    expect(run({ any: ['hot', 'vip'] })).toEqual({ include: ['c1', 'c2', 'c3'], exclude: [] });
  });
  it('matches entities with all of the tags', () => {
    expect(run({ all: ['hot', 'vip'] })).toEqual({ include: ['c1'], exclude: [] });
    expect(run({ all: ['hot'] })).toEqual({ include: ['c1', 'c2'], exclude: [] });
  });
  it('combines any and all', () => {
    expect(run({ any: ['vip'], all: ['hot'] })).toEqual({ include: ['c1'], exclude: [] });
  });
  it('excludes entities with any excluded tag', () => {
    expect(run({ exclude: ['vip'] })).toEqual({ include: null, exclude: ['c1', 'c3'] });
    expect(run({ any: ['hot'], exclude: ['vip'] })).toEqual({
      include: ['c1', 'c2'],
      exclude: ['c1', 'c3'],
    });
  });
  it('excludes every tagged entity for untagged', () => {
    expect(run({ untagged: true })).toEqual({ include: null, exclude: ['c1', 'c2', 'c3'] });
  });
  it('is empty when the tags match nobody', () => {
    expect(run({ any: ['ghost'] })).toEqual({ include: [], exclude: [] });
    expect(run({ all: ['hot', 'ghost'] })).toEqual({ include: [], exclude: [] });
  });
});
