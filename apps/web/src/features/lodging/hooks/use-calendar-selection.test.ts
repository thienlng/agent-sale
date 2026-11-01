import { describe, expect, it } from 'vitest';

import { type CellRef, nextSelection } from './use-calendar-selection';

const P = 'p1';
const room = (unitId: string, night: string): CellRef => ({
  propertyId: P,
  unitId,
  night,
  room: true,
});
const whole = (night: string, propertyId = P): CellRef => ({
  propertyId,
  unitId: 'u',
  night,
  room: false,
});

describe('nextSelection', () => {
  it('starts on the first click and ends on a later night of the same property', () => {
    const a = nextSelection(null, whole('2026-11-02'));
    expect(a).toMatchObject({
      start: '2026-11-02',
      end: '2026-11-02',
      complete: false,
      whole: true,
    });
    expect(nextSelection(a, whole('2026-11-04'))).toMatchObject({
      end: '2026-11-04',
      complete: true,
    });
  });

  it('restarts on an earlier night or another property', () => {
    const a = nextSelection(null, whole('2026-11-05'));
    expect(nextSelection(a, whole('2026-11-03'))).toMatchObject({
      start: '2026-11-03',
      complete: false,
    });
    expect(nextSelection(a, whole('2026-11-07', 'p2'))).toMatchObject({
      propertyId: 'p2',
      complete: false,
    });
  });

  it('shift-click extends a range in either direction', () => {
    const done = nextSelection(nextSelection(null, whole('2026-11-05')), whole('2026-11-06'));
    expect(nextSelection(done, whole('2026-11-03'), { shift: true })).toMatchObject({
      start: '2026-11-03',
      end: '2026-11-06',
      complete: true,
    });
  });

  it('ctrl-click adds and removes rooms of the same property', () => {
    const a = nextSelection(null, room('r1', '2026-11-02'));
    const b = nextSelection(a, room('r2', '2026-11-02'), { multi: true });
    expect(b).toMatchObject({ unitIds: ['r1', 'r2'], whole: false, complete: false });
    expect(nextSelection(b, room('r1', '2026-11-02'), { multi: true }).unitIds).toEqual(['r2']);
  });
});
