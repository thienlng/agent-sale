/**
 * Per-tenant fairness (ADR-003): a token bucket per key, checked at job start.
 * Over-budget jobs are re-delayed with jitter by the worker. The store is
 * pluggable: Redis in production (atomic Lua), in-memory for tests.
 */

export interface BucketConfig {
  /** Tokens added per second. */
  refillPerSecond: number;
  /** Maximum burst. */
  capacity: number;
}

export interface BucketStore {
  /** Atomically tries to take one token; returns ms to wait when denied. */
  take(
    key: string,
    config: BucketConfig,
    now: number,
  ): Promise<{ allowed: boolean; retryAfterMs: number }>;
}

export class InMemoryBucketStore implements BucketStore {
  readonly #state = new Map<string, { tokens: number; updatedAt: number }>();

  async take(key: string, config: BucketConfig, now: number) {
    const s = this.#state.get(key) ?? { tokens: config.capacity, updatedAt: now };
    const elapsed = Math.max(0, now - s.updatedAt) / 1000;
    const tokens = Math.min(config.capacity, s.tokens + elapsed * config.refillPerSecond);
    if (tokens >= 1) {
      this.#state.set(key, { tokens: tokens - 1, updatedAt: now });
      return { allowed: true, retryAfterMs: 0 };
    }
    this.#state.set(key, { tokens, updatedAt: now });
    const retryAfterMs = Math.ceil(((1 - tokens) / config.refillPerSecond) * 1000);
    return { allowed: false, retryAfterMs };
  }
}

export interface FairnessPolicy {
  /** Per-workspace budget for a queue, by tier. */
  tenant: Record<'free' | 'standard' | 'priority', BucketConfig>;
  /** Per-channel send budget (e.g. per Facebook page / Zalo OA). */
  channel?: BucketConfig;
}

export class TenantFairness {
  constructor(
    private readonly store: BucketStore,
    private readonly policy: FairnessPolicy,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** Returns 0 when the job may run now, otherwise the delay to re-enqueue with. */
  async admit(opts: {
    queue: string;
    workspaceId: string;
    tier: keyof FairnessPolicy['tenant'];
    channelId?: string;
  }): Promise<number> {
    const now = this.clock();
    const tenant = await this.store.take(
      `fair:${opts.queue}:ws:${opts.workspaceId}`,
      this.policy.tenant[opts.tier],
      now,
    );
    if (!tenant.allowed) return withJitter(tenant.retryAfterMs);
    if (opts.channelId && this.policy.channel) {
      const ch = await this.store.take(
        `fair:${opts.queue}:ch:${opts.channelId}`,
        this.policy.channel,
        now,
      );
      if (!ch.allowed) return withJitter(ch.retryAfterMs);
    }
    return 0;
  }
}

function withJitter(ms: number): number {
  return ms + Math.floor(Math.random() * Math.min(250, ms));
}
