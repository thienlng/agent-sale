import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceFacade } from '../../workspace/api/index.js';
import type { BillingState, BillingStore } from '../application/ports/billing-store.js';
import { BillingService } from '../application/billing.service.js';
import type { PlanRecord } from '../domain/entitlements.js';

const ws = workspaceId('00000000-0000-4000-8000-0000000000a1');
const plans: Record<string, PlanRecord> = {
  'free@1': {
    code: 'free',
    version: 1,
    name: 'Free',
    entitlements: { 'members.max': 1, 'ai.included_messages': { amount: 1000, periodDays: 14 } },
  },
  'sales_pro@1': {
    code: 'sales_pro',
    version: 1,
    name: 'Pro',
    entitlements: { 'members.max': 15, 'ai.included_messages': { amount: 7000, periodDays: 30 } },
  },
};
const sub = (planCode: string, cycleAnchor = new Date('2026-10-01T00:00:00Z')) => ({
  planCode,
  planVersion: 1,
  status: 'active' as const,
  currentPeriodEnd: null,
  cycleAnchor,
});

function setup(state: Partial<BillingState>, accountId: string | null = 'acc-1') {
  const store = {
    state: vi.fn(async () => ({
      subscription: null,
      overrides: [],
      accountSubscription: null,
      accountOverrides: [],
      ...state,
    })),
    plan: vi.fn(async (code: string, version: number) => plans[`${code}@${version}`] ?? null),
    reserve: vi.fn(async () => 'reserved' as const),
    capture: vi.fn(),
    release: vi.fn(),
    used: vi.fn(async () => 3),
  } satisfies BillingStore;
  const workspaces = { accountOf: vi.fn(async () => accountId) };
  return {
    store,
    workspaces,
    billing: new BillingService(store, workspaces as unknown as WorkspaceFacade),
  };
}

describe('BillingService (ADR-012 §5)', () => {
  it("prefers the account's subscription and applies business overrides last", async () => {
    const { billing } = setup({
      subscription: sub('free'),
      accountSubscription: sub('sales_pro'),
      accountOverrides: [{ key: 'members.max', value: 20, expiresAt: null }],
      overrides: [{ key: 'members.max', value: null, expiresAt: null }],
    });
    const e = await billing.entitlements(ws);
    expect(e.plan.code).toBe('sales_pro');
    expect(e.limits['members.max']).toBeNull();
    expect(e.aiIncludedMessages).toEqual({ amount: 7000, periodDays: 30 });
  });

  it("falls back to the business's own subscription until the backfill copied it", async () => {
    const { billing } = setup({ subscription: sub('sales_pro') });
    expect((await billing.entitlements(ws)).plan.code).toBe('sales_pro');
  });

  it('reserves against the account allowance of the current cycle', async () => {
    const { billing, store } = setup({ accountSubscription: sub('sales_pro') });
    const key = { idempotencyKey: 'bot:e1', conversationId: 'c1', botId: 'b1' };
    expect(await billing.reserveReply(ws, key)).toEqual({ allowed: true, metered: true });
    expect(store.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-1', key: 'bot:e1', limit: 7000 }),
    );
    store.reserve.mockResolvedValueOnce('exhausted' as never);
    expect(await billing.reserveReply(ws, key)).toMatchObject({
      allowed: false,
      reason: 'allowance_exhausted',
    });
  });

  it('does not meter a business without an account', async () => {
    const { billing, store } = setup({}, null);
    const key = { idempotencyKey: 'bot:e1', conversationId: null, botId: null };
    expect(await billing.reserveReply(ws, key)).toEqual({ allowed: true, metered: false });
    expect(store.reserve).not.toHaveBeenCalled();
    expect(await billing.usage(ws)).toMatchObject({ metered: false, used: 0, exhausted: false });
  });

  it('reports usage and exhaustion for the account', async () => {
    const { billing, store } = setup({
      accountOverrides: [
        { key: 'ai.included_messages', value: { amount: 3, periodDays: 14 }, expiresAt: null },
      ],
    });
    expect(await billing.usage(ws)).toMatchObject({
      metered: true,
      used: 3,
      limit: 3,
      exhausted: true,
    });
    expect(store.used).toHaveBeenCalledWith('acc-1', expect.any(Date), expect.any(Date));
  });

  it('remembers the account of a business', async () => {
    const { billing, workspaces } = setup({});
    await billing.entitlements(ws);
    await billing.entitlements(ws);
    expect(workspaces.accountOf).toHaveBeenCalledTimes(1);
  });
});
