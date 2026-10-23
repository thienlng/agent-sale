import { describe, expect, it } from 'vitest';

import { InMemoryBucketStore, TenantFairness } from './fairness.js';
import { jobId } from './queues.js';

const policy = {
  tenant: {
    free: { refillPerSecond: 1, capacity: 2 },
    standard: { refillPerSecond: 5, capacity: 10 },
    priority: { refillPerSecond: 20, capacity: 50 },
  },
  channel: { refillPerSecond: 2, capacity: 2 },
};

describe('TenantFairness', () => {
  it('lets a tenant burst up to capacity, then delays it', async () => {
    let now = 0;
    const f = new TenantFairness(new InMemoryBucketStore(), policy, () => now);
    expect(await f.admit({ queue: 'conversation', workspaceId: 'a', tier: 'free' })).toBe(0);
    expect(await f.admit({ queue: 'conversation', workspaceId: 'a', tier: 'free' })).toBe(0);
    const delay = await f.admit({ queue: 'conversation', workspaceId: 'a', tier: 'free' });
    expect(delay).toBeGreaterThan(0);
    now = 1_000; // one token refilled
    expect(await f.admit({ queue: 'conversation', workspaceId: 'a', tier: 'free' })).toBe(0);
  });

  it('does not let one tenant consume another tenant budget', async () => {
    const f = new TenantFairness(new InMemoryBucketStore(), policy, () => 0);
    await f.admit({ queue: 'conversation', workspaceId: 'a', tier: 'free' });
    await f.admit({ queue: 'conversation', workspaceId: 'a', tier: 'free' });
    expect(await f.admit({ queue: 'conversation', workspaceId: 'b', tier: 'free' })).toBe(0);
  });

  it('applies the per-channel send budget too', async () => {
    const f = new TenantFairness(new InMemoryBucketStore(), policy, () => 0);
    const opts = {
      queue: 'outbound',
      workspaceId: 'a',
      tier: 'priority' as const,
      channelId: 'page-1',
    };
    expect(await f.admit(opts)).toBe(0);
    expect(await f.admit(opts)).toBe(0);
    expect(await f.admit(opts)).toBeGreaterThan(0);
  });
});

describe('jobId', () => {
  it('builds a deterministic id for idempotent enqueue', () => {
    expect(jobId(['reply', 'conv-1', 42])).toBe('reply:conv-1:42');
  });
});
