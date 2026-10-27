import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryRateLimiter } from '../application/rate-limiter.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('InMemoryRateLimiter', () => {
  it('rejects once the limit is reached and tells how long to wait', () => {
    const limiter = new InMemoryRateLimiter();
    for (let i = 0; i < 3; i++) expect(limiter.hit('k', 3, 1000).ok).toBe(true);
    vi.advanceTimersByTime(400);
    const blocked = limiter.hit('k', 3, 1000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBe(600);
  });
  it('starts a new window after windowMs and keeps keys apart', () => {
    const limiter = new InMemoryRateLimiter();
    limiter.hit('a', 1, 1000);
    expect(limiter.hit('a', 1, 1000).ok).toBe(false);
    expect(limiter.hit('b', 1, 1000).ok).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(limiter.hit('a', 1, 1000).ok).toBe(true);
  });
  it('stays bounded under a flood of distinct keys', () => {
    const limiter = new InMemoryRateLimiter();
    for (let i = 0; i < 50_010; i++) limiter.hit(`k${i}`, 1, 60_000);
    // The oldest keys were evicted, so they get a fresh window again.
    expect(limiter.hit('k0', 1, 60_000).ok).toBe(true);
    expect(limiter.hit('k50009', 1, 60_000).ok).toBe(false);
  });
});
