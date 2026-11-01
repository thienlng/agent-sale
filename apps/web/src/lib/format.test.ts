import { describe, expect, it } from 'vitest';

import { formatRelativeTime } from './format';

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-11-01T10:00:00.000Z');

  it('says how long ago an instant was, in the largest whole unit', () => {
    expect(formatRelativeTime('2026-11-01T09:58:00.000Z', now)).toBe('2 phút trước');
    expect(formatRelativeTime('2026-11-01T07:00:00.000Z', now)).toBe('3 giờ trước');
    expect(formatRelativeTime('2026-10-30T10:00:00.000Z', now)).toBe('2 ngày trước');
  });

  it('reads a just-now or future instant as now', () => {
    expect(formatRelativeTime('2026-11-01T10:00:05.000Z', now)).toBe('bây giờ');
  });
});
