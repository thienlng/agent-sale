import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { InMemoryLimiter, LocalLimiter, RedisLimiter } from './limiter.js';

describe('InMemoryLimiter', () => {
  it('counts hits in a fixed window and refuses past the limit without counting', async () => {
    let now = 1_000;
    const l = new InMemoryLimiter(() => now);
    expect((await l.hit('k', 2, 1000)).ok).toBe(true);
    expect((await l.hit('k', 2, 1000)).count).toBe(2);
    const refused = await l.hit('k', 2, 1000);
    expect(refused).toMatchObject({ ok: false, count: 2 });
    expect(refused.retryAfterMs).toBe(1000);
    now += 1000;
    expect(await l.hit('k', 2, 1000)).toMatchObject({ ok: true, count: 1 });
  });

  it('adds amounts in a window and peeks the total', async () => {
    let now = 0;
    const l = new InMemoryLimiter(() => now);
    expect(await l.add('t', 500, 60_000)).toBe(500);
    expect(await l.add('t', 250, 60_000)).toBe(750);
    expect(await l.peek('t')).toBe(750);
    now = 60_000;
    expect(await l.peek('t')).toBe(0);
  });

  it('hands out at most max concurrency slots until one is released or expires', async () => {
    let now = 0;
    const l = new InMemoryLimiter(() => now);
    expect(await l.acquire('s', 2, 10_000)).toBe(true);
    expect(await l.acquire('s', 2, 10_000)).toBe(true);
    expect(await l.acquire('s', 2, 10_000)).toBe(false);
    await l.release('s');
    expect(await l.acquire('s', 2, 10_000)).toBe(true);
    now = 10_000;
    expect(await l.acquire('s', 2, 10_000)).toBe(true);
  });

  it('stays bounded under a flood of distinct keys', async () => {
    const l = new InMemoryLimiter();
    for (let i = 0; i < 60_000; i++) await l.hit(`flood:${i}`, 1, 60_000);
    // The first keys were evicted, so they count from zero again.
    expect((await l.hit('flood:0', 1, 60_000)).ok).toBe(true);
  });
});

describe('LocalLimiter as a token-bucket store', () => {
  it('refills tokens over time', async () => {
    const l = new LocalLimiter();
    const cfg = { capacity: 1, refillPerSecond: 1 };
    expect((await l.take('b', cfg, 0)).allowed).toBe(true);
    const denied = await l.take('b', cfg, 100);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBe(900);
    expect((await l.take('b', cfg, 1100)).allowed).toBe(true);
  });
});

describe('RedisLimiter', () => {
  it('uses the script results when Redis answers', async () => {
    const redis = { eval: async () => [3, 0, 1], get: async () => '42' } as unknown as Redis;
    const l = new RedisLimiter(redis);
    expect(await l.hit('k', 5, 1000)).toEqual({ ok: true, count: 3, retryAfterMs: 0 });
    expect(await l.peek('k')).toBe(42);
  });

  it('reports the remaining window when Redis refuses', async () => {
    const redis = { eval: async () => [5, 700, 0] } as unknown as Redis;
    expect(await new RedisLimiter(redis).hit('k', 5, 1000)).toEqual({
      ok: false,
      count: 5,
      retryAfterMs: 700,
    });
  });

  it('falls back to in-process counters when Redis fails, still enforcing limits', async () => {
    const fail = async () => {
      throw new Error('connection refused');
    };
    const l = new RedisLimiter({ eval: fail, get: fail } as unknown as Redis);
    expect((await l.hit('k', 1, 1000)).ok).toBe(true);
    expect((await l.hit('k', 1, 1000)).ok).toBe(false);
    expect(await l.add('t', 10, 1000)).toBe(10);
    expect(await l.peek('t')).toBe(10);
    expect(await l.acquire('s', 1, 1000)).toBe(true);
    expect(await l.acquire('s', 1, 1000)).toBe(false);
    await l.release('s');
    expect(await l.acquire('s', 1, 1000)).toBe(true);
    expect((await l.take('b', { capacity: 1, refillPerSecond: 1 }, 0)).allowed).toBe(true);
  });
});
