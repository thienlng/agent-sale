import { describe, expect, it } from 'vitest';

import { alertFingerprint, decideAlert } from '../domain/alert-decision.js';

const now = new Date('2026-11-02T10:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

describe('decideAlert', () => {
  it('fires on a new or changed set, not on the same set within 24 h', () => {
    const fp = alertFingerprint(['b', 'a']);
    expect(fp).toBe(alertFingerprint(['a', 'b', 'a']));
    expect(
      decideAlert({ hitIds: ['a', 'b'], lastFingerprint: null, lastAlertedAt: null, now }),
    ).toEqual({ fire: true, fingerprint: fp });
    expect(
      decideAlert({ hitIds: ['a', 'c'], lastFingerprint: fp, lastAlertedAt: hoursAgo(1), now }),
    ).toMatchObject({ fire: true });
    expect(
      decideAlert({ hitIds: ['b', 'a'], lastFingerprint: fp, lastAlertedAt: hoursAgo(23), now }),
    ).toEqual({ fire: false, fingerprint: fp });
    expect(
      decideAlert({ hitIds: ['a', 'b'], lastFingerprint: fp, lastAlertedAt: hoursAgo(24), now }),
    ).toEqual({ fire: true, fingerprint: fp });
  });

  it('does not fire on an empty set and resets the fingerprint', () => {
    expect(
      decideAlert({ hitIds: [], lastFingerprint: 'x', lastAlertedAt: hoursAgo(48), now }),
    ).toEqual({ fire: false, fingerprint: null });
  });
});
