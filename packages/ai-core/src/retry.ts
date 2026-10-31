import type { LlmErrorKind } from './gateway.js';

export const MAX_RETRIES = 3;
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_CAP_MS = 15_000;

const RETRYABLE: ReadonlySet<LlmErrorKind> = new Set([
  'rate_limit',
  'overloaded',
  'timeout',
  'network',
  'unknown',
]);

export function isRetryable(kind: LlmErrorKind): boolean {
  return RETRYABLE.has(kind);
}

/**
 * Full-jitter exponential backoff: a uniform draw from `[0, min(cap, base × 2^attempt))`.
 * A server `Retry-After` wins, capped by the call timeout when one is set.
 */
export function backoffDelayMs(
  attempt: number,
  random: () => number,
  retryAfterMs?: number,
  timeoutMs?: number,
): number {
  if (retryAfterMs !== undefined) {
    return timeoutMs !== undefined ? Math.min(retryAfterMs, timeoutMs) : retryAfterMs;
  }
  return Math.floor(random() * Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt));
}

/** Sleeps `ms`, rejecting early with an AbortError when `signal` fires. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(): Error {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}
