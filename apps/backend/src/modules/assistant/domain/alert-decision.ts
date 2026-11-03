import { createHash } from 'node:crypto';

/** An unchanged alert is repeated once this long after the last one (S3-R13). */
export const ALERT_REPEAT_MS = 24 * 3_600_000;

/** sha256 of the sorted, de-duplicated ids: the same set gives the same fingerprint. */
export function alertFingerprint(ids: string[]): string {
  return createHash('sha256')
    .update([...new Set(ids)].sort().join('\n'))
    .digest('hex');
}

/**
 * Whether an alert fires (S3-R13): when the set of hits changed since the last alert, or the same
 * set is still there 24 h after it. No hits: no fire, and the fingerprint resets to null.
 */
export function decideAlert(i: {
  hitIds: string[];
  lastFingerprint: string | null;
  lastAlertedAt: Date | null;
  now: Date;
}): { fire: boolean; fingerprint: string | null } {
  if (i.hitIds.length === 0) return { fire: false, fingerprint: null };
  const fingerprint = alertFingerprint(i.hitIds);
  const changed = fingerprint !== i.lastFingerprint;
  const stale =
    i.lastAlertedAt === null || i.now.getTime() - i.lastAlertedAt.getTime() >= ALERT_REPEAT_MS;
  return { fire: changed || stale, fingerprint };
}
