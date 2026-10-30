import { describe, expect, it } from 'vitest';

import { cycleOf, FREE_CYCLE_ANCHOR } from './usage.js';

describe('cycleOf (ADR-012 §5)', () => {
  const anchor = new Date('2026-10-01T05:30:00Z');

  it('repeats every periodDays from the anchor, at the anchor time of day', () => {
    expect(cycleOf(anchor, 30, new Date('2026-10-15T00:00:00Z'))).toEqual({
      start: anchor,
      end: new Date('2026-10-31T05:30:00Z'),
    });
    expect(cycleOf(anchor, 30, new Date('2026-11-05T00:00:00Z')).start).toEqual(
      new Date('2026-10-31T05:30:00Z'),
    );
  });

  it('starts the next cycle exactly at the boundary', () => {
    const boundary = new Date('2026-10-15T05:30:00Z');
    expect(cycleOf(anchor, 14, boundary).start).toEqual(boundary);
    expect(cycleOf(anchor, 14, new Date(boundary.getTime() - 1)).start).toEqual(anchor);
  });

  it('uses the first cycle before the anchor and at least one day per cycle', () => {
    expect(cycleOf(anchor, 30, new Date('2026-09-01T00:00:00Z')).start).toEqual(anchor);
    expect(cycleOf(anchor, 0, new Date('2026-10-01T06:00:00Z')).end).toEqual(
      new Date('2026-10-02T05:30:00Z'),
    );
  });

  it('resets free allowances at midnight in Vietnam', () => {
    const { start } = cycleOf(FREE_CYCLE_ANCHOR, 14, new Date('2026-10-28T12:00:00Z'));
    expect(start.toISOString().slice(11)).toBe('17:00:00.000Z');
  });
});
