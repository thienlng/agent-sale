/** Waits before each retry of a failed delivery (ADR-022 §5): 1 m, 5 m, 30 m, 2 h, 6 h, 12 h, 24 h. */
export const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 3_600_000,
  6 * 3_600_000,
  12 * 3_600_000,
  24 * 3_600_000,
] as const;

/** An endpoint failing for this long without one success is disabled. */
export const DISABLE_AFTER_FAILING_MS = 3 * 24 * 3_600_000;

/**
 * When to try again after `attempts` failed attempts (the first send included); null = give up,
 * the delivery is `failed`.
 */
export function nextAttemptAt(attempts: number, now: Date): Date | null {
  const delay = RETRY_DELAYS_MS[attempts - 1];
  return delay === undefined ? null : new Date(now.getTime() + delay);
}

/** Has an endpoint failing since `failingSince` failed long enough to be disabled? */
export function shouldDisable(failingSince: Date | null, now: Date): boolean {
  return (
    failingSince !== null && now.getTime() - failingSince.getTime() >= DISABLE_AFTER_FAILING_MS
  );
}
