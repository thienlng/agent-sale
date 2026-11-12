import { describe, expect, it } from 'vitest';

import { pickFair, scanLimit } from '../domain/fair-claim.js';

const ev = (workspaceId: string, sender: string, id: string) => ({
  id,
  workspaceId,
  connectionId: `conn-${workspaceId}`,
  senderExternalId: sender,
});

describe('pickFair', () => {
  const flood = Array.from({ length: 10 }, (_, i) => ev('a', `c${i}`, `a${i}`));

  it('keeps the plain oldest-first claim without a per-workspace cap', () => {
    expect(pickFair([...flood, ev('b', 'x', 'b0')], 4, undefined).map((e) => e.id)).toEqual([
      'a0',
      'a1',
      'a2',
      'a3',
    ]);
  });

  it('leaves room for other workspaces when one floods the queue', () => {
    const picked = pickFair([...flood, ev('b', 'x', 'b0'), ev('c', 'y', 'c0')], 5, 2);
    expect(picked.map((e) => e.id)).toEqual(['a0', 'a1', 'b0', 'c0']);
  });

  it('keeps every event of an admitted conversation together (a burst is one turn)', () => {
    const events = [ev('a', 'c0', '1'), ev('a', 'c1', '2'), ev('a', 'c2', '3'), ev('a', 'c0', '4')];
    expect(pickFair(events, 10, 2).map((e) => e.id)).toEqual(['1', '2', '4']);
  });

  it('never returns more than the limit', () => {
    expect(pickFair(flood, 3, 5)).toHaveLength(3);
  });

  it('reads a bounded window past the limit', () => {
    expect(scanLimit(25)).toBe(100);
    expect(scanLimit(100)).toBe(200);
  });
});
