import { type BucketConfig, type BucketStore, InMemoryBucketStore } from '@agent-sales/queue';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { getEnv } from '../config.js';

const log = new Logger('Limiter');

/** What one counted hit decided. */
export interface HitResult {
  ok: boolean;
  /** Hits counted in the current window, this one included when `ok`. */
  count: number;
  /** Time until the window resets when refused, 0 otherwise. */
  retryAfterMs: number;
}

/**
 * Shared counters for abuse limits (fixed windows, amounts and concurrency slots). Redis in
 * production so every API/agent process sees the same totals and keys expire on their own; an
 * in-process fallback serves tests, development without Redis, and a Redis outage (fail-open
 * would let a flood through, fail-closed would take the product down: the local counters keep
 * each process bounded meanwhile).
 */
export interface Limiter {
  /** Counts one hit; refused once `limit` hits were counted inside the window. */
  hit(key: string, limit: number, windowMs: number): Promise<HitResult>;
  /**
   * Counts one hit on every key only when every key still has room (all or nothing, atomic on
   * Redis), so a refused call never spends the other counters. `refused` is the index of the
   * first full key, -1 when the hit was counted.
   */
  hitAll(checks: readonly WindowCheck[]): Promise<{ refused: number; retryAfterMs: number }>;
  /** Adds `amount` to a windowed total (e.g. tokens) and returns the new total. */
  add(key: string, amount: number, windowMs: number): Promise<number>;
  /** The current windowed total of `key` (0 when absent or expired). */
  peek(key: string): Promise<number>;
  /**
   * Takes one of `max` concurrency slots and returns its id (null when all are taken). Each slot
   * expires `ttlMs` after it was taken, on its own, so a holder that crashed without `release`
   * frees its slot even while other slots keep being taken.
   */
  acquire(key: string, max: number, ttlMs: number): Promise<string | null>;
  release(key: string, slot: string): Promise<void>;
}

/** One fixed-window counter of a `hitAll`. */
export interface WindowCheck {
  key: string;
  limit: number;
  windowMs: number;
}

const MAX_KEYS = 50_000;
const SWEEP_EVERY_MS = 30_000;

/** In-process limiter: bounded memory (oldest key evicted at `MAX_KEYS`), expired keys swept. */
export class InMemoryLimiter implements Limiter {
  readonly #entries = new Map<string, { value: number; expiresAt: number }>();
  /** Concurrency slots: slot id → expiry, per key. */
  readonly #slots = new Map<string, Map<string, number>>();
  #slotSeq = 0;
  #lastSweep = Date.now();

  constructor(private readonly clock: () => number = () => Date.now()) {}

  async hit(key: string, limit: number, windowMs: number): Promise<HitResult> {
    return this.hitSync(key, limit, windowMs);
  }

  /** Synchronous `hit`, for the Redis fallback path. */
  hitSync(key: string, limit: number, windowMs: number): HitResult {
    const now = this.clock();
    const e = this.#live(key, now, windowMs);
    if (e.value >= limit)
      return { ok: false, count: e.value, retryAfterMs: Math.max(1, e.expiresAt - now) };
    e.value += 1;
    return { ok: true, count: e.value, retryAfterMs: 0 };
  }

  async add(key: string, amount: number, windowMs: number): Promise<number> {
    return this.addSync(key, amount, windowMs);
  }

  addSync(key: string, amount: number, windowMs: number): number {
    const e = this.#live(key, this.clock(), windowMs);
    e.value += amount;
    return e.value;
  }

  async peek(key: string): Promise<number> {
    return this.peekSync(key);
  }

  peekSync(key: string): number {
    const e = this.#entries.get(key);
    return e && e.expiresAt > this.clock() ? e.value : 0;
  }

  async hitAll(checks: readonly WindowCheck[]): Promise<{ refused: number; retryAfterMs: number }> {
    return this.hitAllSync(checks);
  }

  hitAllSync(checks: readonly WindowCheck[]): { refused: number; retryAfterMs: number } {
    const now = this.clock();
    const live = checks.map((c) => ({ check: c, entry: this.#live(c.key, now, c.windowMs) }));
    const refused = live.findIndex(({ check, entry }) => entry.value >= check.limit);
    const hit = live[refused];
    if (hit) return { refused, retryAfterMs: Math.max(1, hit.entry.expiresAt - now) };
    for (const { entry } of live) entry.value += 1;
    return { refused: -1, retryAfterMs: 0 };
  }

  async acquire(key: string, max: number, ttlMs: number): Promise<string | null> {
    return this.acquireSync(key, max, ttlMs);
  }

  acquireSync(key: string, max: number, ttlMs: number): string | null {
    const now = this.clock();
    let slots = this.#slots.get(key);
    if (!slots) {
      if (this.#slots.size >= MAX_KEYS) {
        const oldest = this.#slots.keys().next().value;
        if (oldest !== undefined) this.#slots.delete(oldest);
      }
      slots = new Map();
      this.#slots.set(key, slots);
    }
    for (const [id, expiresAt] of slots) if (expiresAt <= now) slots.delete(id);
    if (slots.size >= max) return null;
    const id = `s${++this.#slotSeq}`;
    slots.set(id, now + ttlMs);
    return id;
  }

  async release(key: string, slot: string): Promise<void> {
    this.releaseSync(key, slot);
  }

  releaseSync(key: string, slot: string): void {
    const slots = this.#slots.get(key);
    if (!slots) return;
    slots.delete(slot);
    if (!slots.size) this.#slots.delete(key);
  }

  #live(key: string, now: number, windowMs: number): { value: number; expiresAt: number } {
    this.#sweep(now);
    const current = this.#entries.get(key);
    if (current && current.expiresAt > now) return current;
    if (!current && this.#entries.size >= MAX_KEYS) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) this.#entries.delete(oldest);
    }
    this.#entries.delete(key);
    const fresh = { value: 0, expiresAt: now + windowMs };
    this.#entries.set(key, fresh);
    return fresh;
  }

  #sweep(now: number): void {
    if (now - this.#lastSweep < SWEEP_EVERY_MS) return;
    this.#lastSweep = now;
    for (const [key, e] of this.#entries) if (e.expiresAt <= now) this.#entries.delete(key);
  }
}

// Fixed window: refuse without counting once the limit is reached; the first hit sets the TTL.
const HIT = `
local c = tonumber(redis.call('GET', KEYS[1]) or '0')
local ttl = redis.call('PTTL', KEYS[1])
if c >= tonumber(ARGV[1]) and ttl > 0 then return {c, ttl, 0} end
if ttl <= 0 then
  redis.call('SET', KEYS[1], 1, 'PX', ARGV[2])
  return {1, 0, 1}
end
c = redis.call('INCR', KEYS[1])
return {c, 0, 1}`;

const ADD = `
if redis.call('PTTL', KEYS[1]) <= 0 then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return tonumber(ARGV[1])
end
return redis.call('INCRBY', KEYS[1], ARGV[1])`;

// All or nothing over several fixed windows: ARGV = limit1, window1, limit2, window2, …
// Returns {index of the first full key (1-based), its ttl} or {0, 0} once every key was counted.
const HIT_ALL = `
for i = 1, #KEYS do
  local c = tonumber(redis.call('GET', KEYS[i]) or '0')
  local ttl = redis.call('PTTL', KEYS[i])
  if ttl > 0 and c >= tonumber(ARGV[2 * i - 1]) then return {i, ttl} end
end
for i = 1, #KEYS do
  if redis.call('PTTL', KEYS[i]) <= 0 then
    redis.call('SET', KEYS[i], 1, 'PX', ARGV[2 * i])
  else
    redis.call('INCR', KEYS[i])
  end
end
return {0, 0}`;

// Concurrency slots as a sorted set {slot id → taken at (ms)}: stale slots are trimmed on every
// acquire, so a slot a crashed holder never released expires on its own after ARGV[2] ms.
const ACQUIRE = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local ttl = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - ttl)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then return 0 end
redis.call('ZADD', KEYS[1], now, ARGV[3])
redis.call('PEXPIRE', KEYS[1], ttl)
return 1`;

// Token bucket stored as a hash {tokens, at}; returns {allowed, retryAfterMs}.
const TAKE = `
local cap = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local s = redis.call('HMGET', KEYS[1], 'tokens', 'at')
local tokens = tonumber(s[1]) or cap
local at = tonumber(s[2]) or now
tokens = math.min(cap, tokens + math.max(0, now - at) / 1000 * rate)
local allowed = 0
local wait = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  wait = math.ceil((1 - tokens) / rate * 1000)
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'at', tostring(now))
redis.call('PEXPIRE', KEYS[1], math.ceil(cap / rate * 1000) + 1000)
return {allowed, wait}`;

const PREFIX = 'rl:';
/** Slot sets live apart from the counters (a different Redis type). */
const SLOTS = 'rl:slots:';

/**
 * Redis-backed limiter. Commands time out quickly and never queue while disconnected; any error
 * falls back to the in-process counters for that call (logged once per outage).
 */
export class RedisLimiter implements Limiter, BucketStore {
  readonly #fallback = new InMemoryLimiter();
  readonly #fallbackBuckets = new InMemoryBucketStore();
  #degraded = false;

  constructor(private readonly redis: Redis) {}

  async hit(key: string, limit: number, windowMs: number): Promise<HitResult> {
    try {
      const [count, ttl, ok] = (await this.redis.eval(HIT, 1, PREFIX + key, limit, windowMs)) as [
        number,
        number,
        number,
      ];
      this.#recovered();
      return { ok: ok === 1, count, retryAfterMs: ok === 1 ? 0 : Math.max(1, ttl) };
    } catch (err) {
      this.#degrade(err);
      return this.#fallback.hitSync(key, limit, windowMs);
    }
  }

  async add(key: string, amount: number, windowMs: number): Promise<number> {
    try {
      const total = Number(
        await this.redis.eval(ADD, 1, PREFIX + key, Math.round(amount), windowMs),
      );
      this.#recovered();
      return total;
    } catch (err) {
      this.#degrade(err);
      return this.#fallback.addSync(key, amount, windowMs);
    }
  }

  async peek(key: string): Promise<number> {
    try {
      const v = await this.redis.get(PREFIX + key);
      this.#recovered();
      return v ? Number(v) : 0;
    } catch (err) {
      this.#degrade(err);
      return this.#fallback.peekSync(key);
    }
  }

  async hitAll(checks: readonly WindowCheck[]): Promise<{ refused: number; retryAfterMs: number }> {
    if (!checks.length) return { refused: -1, retryAfterMs: 0 };
    try {
      const [index, ttl] = (await this.redis.eval(
        HIT_ALL,
        checks.length,
        ...checks.map((c) => PREFIX + c.key),
        ...checks.flatMap((c) => [c.limit, c.windowMs]),
      )) as [number, number];
      this.#recovered();
      return index > 0
        ? { refused: index - 1, retryAfterMs: Math.max(1, ttl) }
        : { refused: -1, retryAfterMs: 0 };
    } catch (err) {
      this.#degrade(err);
      return this.#fallback.hitAllSync(checks);
    }
  }

  async acquire(key: string, max: number, ttlMs: number): Promise<string | null> {
    const slot = randomUUID();
    try {
      const ok = Number(await this.redis.eval(ACQUIRE, 1, SLOTS + key, max, ttlMs, slot));
      this.#recovered();
      return ok === 1 ? slot : null;
    } catch (err) {
      this.#degrade(err);
      return this.#fallback.acquireSync(key, max, ttlMs);
    }
  }

  async release(key: string, slot: string): Promise<void> {
    try {
      await this.redis.zrem(SLOTS + key, slot);
      this.#recovered();
    } catch (err) {
      this.#degrade(err);
      this.#fallback.releaseSync(key, slot);
    }
  }

  async take(key: string, config: BucketConfig, now: number) {
    try {
      const [allowed, wait] = (await this.redis.eval(
        TAKE,
        1,
        PREFIX + key,
        config.capacity,
        config.refillPerSecond,
        now,
      )) as [number, number];
      this.#recovered();
      return { allowed: allowed === 1, retryAfterMs: wait };
    } catch (err) {
      this.#degrade(err);
      return this.#fallbackBuckets.take(key, config, now);
    }
  }

  #degrade(err: unknown): void {
    if (this.#degraded) return;
    this.#degraded = true;
    log.warn(
      `redis unavailable, using in-process counters: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  #recovered(): void {
    if (!this.#degraded) return;
    this.#degraded = false;
    log.log('redis back');
  }
}

/** In-process limiter that also serves as a token-bucket store (tests, dev without Redis). */
export class LocalLimiter extends InMemoryLimiter implements BucketStore {
  readonly #buckets = new InMemoryBucketStore();
  take(key: string, config: BucketConfig, now: number) {
    return this.#buckets.take(key, config, now);
  }
}

export type SharedLimiter = Limiter & BucketStore;

let shared: SharedLimiter | undefined;

/**
 * The process-wide limiter: Redis when `REDIS_URL` is set (outside tests), in-process otherwise.
 * One connection per process, created lazily.
 */
export function sharedLimiter(): SharedLimiter {
  if (shared) return shared;
  const env = getEnv();
  if (env.REDIS_URL && env.NODE_ENV !== 'test') {
    const redis = new Redis(env.REDIS_URL, {
      lazyConnect: false,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: 250,
      connectTimeout: 2000,
    });
    redis.on('error', () => undefined); // surfaced per command via the fallback path
    shared = new RedisLimiter(redis);
  } else {
    shared = new LocalLimiter();
  }
  return shared;
}

/** Nest token for the shared limiter. */
export const LIMITER = Symbol('LIMITER');
