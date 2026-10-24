import { describe, expect, it } from 'vitest';

import { withinReplySchedule } from '../api/index.js';

// Vietnam is UTC+7: 01:00Z = 08:00, 10:00Z = 17:00, 16:30Z = 23:30.
const at = (iso: string) => new Date(iso);

describe('withinReplySchedule', () => {
  it('always answers in "always" mode', () => {
    expect(
      withinReplySchedule(
        { mode: 'always', start: '08:00', end: '09:00' },
        at('2026-10-24T20:00:00Z'),
      ),
    ).toBe(true);
  });

  it('treats the window as [start, end) in Vietnam time', () => {
    const day = { mode: 'custom' as const, start: '08:00', end: '17:00' };
    expect(withinReplySchedule(day, at('2026-10-24T01:00:00Z'))).toBe(true);
    expect(withinReplySchedule(day, at('2026-10-24T00:59:00Z'))).toBe(false);
    expect(withinReplySchedule(day, at('2026-10-24T10:00:00Z'))).toBe(false);
  });

  it('spans midnight when end is before start', () => {
    const night = { mode: 'custom' as const, start: '22:00', end: '06:00' };
    expect(withinReplySchedule(night, at('2026-10-24T16:30:00Z'))).toBe(true);
    expect(withinReplySchedule(night, at('2026-10-24T22:00:00Z'))).toBe(true); // 05:00
    expect(withinReplySchedule(night, at('2026-10-24T05:00:00Z'))).toBe(false); // 12:00
  });
});
