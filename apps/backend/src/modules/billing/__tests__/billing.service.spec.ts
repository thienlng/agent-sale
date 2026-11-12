import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceFacade } from '../../workspace/api/index.js';
import { BillingCatalog } from '../application/billing-catalog.js';
import { BillingService } from '../application/billing.service.js';
import type {
  BillingAdminStore,
  BillingSettings,
} from '../application/ports/billing-admin-store.js';
import type { BillingState, BillingStore } from '../application/ports/billing-store.js';
import type { PlanRecord } from '../domain/entitlements.js';
import type { CatalogPlan } from '../domain/plan-catalog.js';

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

const settings: BillingSettings = {
  trialEnabled: true,
  trialPlanCode: 'sales_pro',
  trialDays: 14,
  afterTrialPlanCode: 'free',
  hqContactScope: 'owner',
  graceDays: 7,
  suspendDays: 30,
  bankBin: null,
  bankAccountNo: null,
  bankAccountName: null,
  version: 1,
  updatedAt: new Date(),
};
const catalogPlan = (p: PlanRecord): CatalogPlan => ({
  ...p,
  description: '',
  isPublic: true,
  sortOrder: 0,
  archivedAt: null,
  priceByPeriod: {},
  createdAt: new Date(),
});

function setup(
  state: Partial<BillingState>,
  accountId: string | null = 'acc-1',
  adminSettings: BillingSettings = settings,
) {
  const base = {
    subscription: null,
    overrides: [],
    accountSubscription: null,
    accountOverrides: [],
    accountStatus: accountId ? ('active' as const) : null,
    ...state,
  };
  const store = {
    state: vi.fn(async () => base),
    accountState: vi.fn(async () => base),
    plan: vi.fn(async (code: string, version: number) => plans[`${code}@${version}`] ?? null),
    reserve: vi.fn(async () => 'reserved' as const),
    capture: vi.fn(),
    release: vi.fn(),
    used: vi.fn(async () => 3),
  } satisfies BillingStore;
  const admin = {
    settings: vi.fn(async () => adminSettings),
    latestPlan: vi.fn(async (code: string) => {
      const plan = plans[`${code}@1`];
      return plan ? catalogPlan(plan) : null;
    }),
    changeSubscription: vi.fn(
      async (input: Parameters<BillingAdminStore['changeSubscription']>[0]) => {
        const next = input.next(null);
        return next ? ({ accountId: input.accountId, ...next } as never) : null;
      },
    ),
  };
  const adminStore = admin as unknown as BillingAdminStore;
  const workspaces = {
    accountOf: vi.fn(async () => accountId),
    isActive: vi.fn(async (_ws: string) => true),
  };
  return {
    store,
    admin,
    workspaces,
    billing: new BillingService(
      store,
      adminStore,
      workspaces as unknown as WorkspaceFacade,
      new BillingCatalog(store, adminStore),
    ),
  };
}

describe('BillingService (ADR-012 §5)', () => {
  it('entitles a deleted business to nothing and refuses every AI reply (ADR-033)', async () => {
    for (const account of ['acc-1', null]) {
      const { billing, workspaces, store } = setup(
        { accountSubscription: sub('sales_pro') },
        account,
      );
      workspaces.isActive.mockResolvedValue(false);
      const e = await billing.entitlements(ws);
      expect(e.limits['members.max']).toBe(0);
      expect(e.limits['brain.evaluations.daily']).toBe(0);
      expect(e.limits['care.messages.daily']).toBe(0);
      expect(e.features['feature.public_api']).toBe(false);
      expect(e.aiIncludedMessages?.amount).toBe(0);
      expect(await billing.limit(ws, 'contacts.max')).toBe(0);
      const reply = await billing.reserveReply(ws, {
        idempotencyKey: 'k',
        conversationId: null,
        botId: null,
      });
      expect(reply).toMatchObject({ allowed: false, reason: 'account_suspended' });
      expect(store.reserve).not.toHaveBeenCalled();
    }
  });

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

  it('ends a trial lazily: the plan after the trial applies as soon as the trial is over', async () => {
    const ended = new Date(Date.now() - 60_000);
    const { billing } = setup({
      accountSubscription: {
        ...sub('sales_pro'),
        status: 'trialing',
        currentPeriodEnd: ended,
      },
    });
    const e = await billing.entitlements(ws);
    expect(e.plan.code).toBe('free');
    expect(e.status).toBe('active');
    expect((await billing.usage(ws)).cycleStart).toBe(ended.toISOString());
  });

  it('keeps a running trial on the trial plan', async () => {
    const { billing } = setup({
      accountSubscription: {
        ...sub('sales_pro'),
        status: 'trialing',
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
      },
    });
    expect((await billing.entitlements(ws)).plan.code).toBe('sales_pro');
  });

  it('refuses AI replies of a suspended account or subscription (the bot hands off)', async () => {
    const key = { idempotencyKey: 'bot:e1', conversationId: null, botId: null };
    const suspendedAccount = setup({ accountStatus: 'suspended' });
    expect(await suspendedAccount.billing.reserveReply(ws, key)).toMatchObject({
      allowed: false,
      reason: 'account_suspended',
    });
    expect(suspendedAccount.store.reserve).not.toHaveBeenCalled();
    const suspendedSub = setup({
      accountSubscription: { ...sub('sales_pro'), status: 'suspended' },
    });
    expect(await suspendedSub.billing.reserveReply(ws, key)).toMatchObject({
      allowed: false,
      reason: 'account_suspended',
    });
  });

  it('starts the signup trial only when the settings enable it, once', async () => {
    const on = setup({});
    expect(await on.billing.startSignupTrial('acc-1')).toBe(true);
    const input = on.admin.changeSubscription.mock.calls[0]![0];
    expect(input.reason).toBe('signup_trial');
    expect(input.next(null)).toMatchObject({ planCode: 'sales_pro', status: 'trialing' });
    expect(input.next({} as never)).toBeNull();

    const off = setup({}, 'acc-1', { ...settings, trialEnabled: false });
    expect(await off.billing.startSignupTrial('acc-1')).toBe(false);
    expect(off.admin.changeSubscription).not.toHaveBeenCalled();
  });

  it("reports an account's allowance without a business", async () => {
    const { billing } = setup({ accountSubscription: sub('sales_pro') });
    expect(await billing.accountAllowance('acc-1')).toMatchObject({ used: 3, limit: 7000 });
  });
});
