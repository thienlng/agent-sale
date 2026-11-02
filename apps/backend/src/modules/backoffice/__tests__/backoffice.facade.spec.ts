import type { AdminSubscriptionDto } from '@agent-sales/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { AccountFacade, AdminAccount } from '../../account/api/index.js';
import type { BillingAdminFacade } from '../../billing/api/index.js';
import type { IdentityAdminFacade } from '../../identity/api/index.js';
import type { AccountBusiness, WorkspaceFacade } from '../../workspace/api/index.js';
import { BackofficeFacadeImpl } from '../application/backoffice.facade.impl.js';
import type {
  PlatformAuditFilter,
  PlatformAuditRecord,
  PlatformAuditStore,
} from '../application/ports/platform-audit-store.js';
import { AdminAccountNotFoundError, InvalidAdminCursorError } from '../domain/backoffice.errors.js';

const ACC1 = '00000000-0000-4000-8000-000000000001';
const ACC2 = '00000000-0000-4000-8000-000000000002';
const U1 = '00000000-0000-4000-8000-0000000000a1';
const U2 = '00000000-0000-4000-8000-0000000000a2';

const account = (id: string, ownerUserId: string | null, name = 'Acme'): AdminAccount => ({
  id,
  name,
  status: 'active',
  statusReason: '',
  statusChangedAt: null,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  ownerUserId,
});

const sub: AdminSubscriptionDto = {
  plan: { code: 'pro', version: 1, name: 'Pro' },
  effectivePlan: { code: 'pro', version: 1, name: 'Pro' },
  status: 'active',
  periodMonths: 1,
  periodStart: '2026-11-01T00:00:00.000Z',
  periodEnd: '2026-12-01T00:00:00.000Z',
  version: 3,
};

const business = (accountId: string, n: number): AccountBusiness =>
  ({
    workspaceId: `00000000-0000-4000-8000-00000000b00${n}`,
    accountId,
    name: `Shop ${n}`,
    industry: 'saas',
    status: 'active',
    memberCount: 2,
    createdAt: new Date('2026-11-01T00:00:00Z'),
  }) as AccountBusiness;

function setup(opts: { accounts?: AdminAccount[]; audit?: PlatformAuditRecord[] } = {}) {
  const accounts = opts.accounts ?? [account(ACC1, U1), account(ACC2, U2, 'Beta')];
  const accountFacade = {
    listForAdmin: vi.fn(async () => ({ data: accounts, nextCursor: 'next' })),
    getForAdmin: vi.fn(async (ids: readonly string[]) =>
      accounts.filter((a) => ids.includes(a.id)),
    ),
    membersForAdmin: vi.fn(async () => [
      { userId: U1, role: 'owner' as const },
      { userId: U2, role: 'billing' as const },
    ]),
  };
  const workspaces = {
    listByAccounts: vi.fn(async () => [business(ACC1, 1), business(ACC1, 2), business(ACC2, 3)]),
  };
  const identity: IdentityAdminFacade = {
    usersByIds: vi.fn(async (ids: readonly string[]) =>
      ids.map((id) => ({
        id,
        name: `User ${id.slice(-2)}`,
        email: `${id.slice(-2)}@x.vn`,
        phone: null,
      })),
    ),
    searchUsers: vi.fn(async () => [{ id: U2, name: 'User a2', email: 'a2@x.vn', phone: null }]),
  };
  const billing = {
    matchAccounts: vi.fn(async () => null as { ids: string[]; exclude: boolean } | null),
    subscriptionsOf: vi.fn(async () => new Map([[ACC1, sub]])),
    accountBilling: vi.fn(async () => ({ overrides: [], usage: null, payments: [] })),
  };
  const audit: PlatformAuditStore = {
    list: vi.fn(async (f: PlatformAuditFilter) => (opts.audit ?? []).slice(0, f.limit)),
  };
  const facade = new BackofficeFacadeImpl(
    accountFacade as unknown as AccountFacade,
    workspaces as unknown as WorkspaceFacade,
    identity,
    billing as unknown as BillingAdminFacade,
    audit,
  );
  return { facade, accountFacade, workspaces, identity, billing, audit };
}

const auditRow = (n: number): PlatformAuditRecord => ({
  id: `00000000-0000-4000-8000-00000000c00${n}`,
  actorName: 'Ops',
  action: 'billing.plan_set',
  targetType: 'account',
  targetId: ACC1,
  reason: 'because',
  data: {},
  createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, 10 - n)),
});

describe('BackofficeFacade', () => {
  it('lists accounts with one batched call per module (no N+1)', async () => {
    const t = setup();
    const res = await t.facade.listAccounts({ limit: 50 });
    expect(res.page.nextCursor).toBe('next');
    expect(
      res.data.map((r) => [
        r.name,
        r.owner?.id,
        r.subscription?.plan.code ?? null,
        r.businessCount,
      ]),
    ).toEqual([
      ['Acme', U1, 'pro', 2],
      ['Beta', U2, null, 1],
    ]);
    expect(t.billing.subscriptionsOf).toHaveBeenCalledTimes(1);
    expect(t.identity.usersByIds).toHaveBeenCalledTimes(1);
    expect(t.workspaces.listByAccounts).toHaveBeenCalledTimes(1);
    expect(t.identity.searchUsers).not.toHaveBeenCalled();
  });

  it('searches owners by email/phone/name and passes billing matches to the account list', async () => {
    const t = setup();
    t.billing.matchAccounts.mockResolvedValueOnce({ ids: [ACC2], exclude: true });
    await t.facade.listAccounts({ q: 'a2@x', planCode: 'free', limit: 10 });
    expect(t.billing.matchAccounts).toHaveBeenCalledWith({ planCode: 'free' });
    expect(t.accountFacade.listForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'a2@x',
        ownerUserIds: [U2],
        accountIds: undefined,
        excludeAccountIds: [ACC2],
        limit: 10,
      }),
    );
  });

  it('skips the batch calls on an empty page', async () => {
    const t = setup({ accounts: [] });
    expect((await t.facade.listAccounts({ limit: 50 })).data).toEqual([]);
    expect(t.billing.subscriptionsOf).not.toHaveBeenCalled();
  });

  it('builds the account detail', async () => {
    const t = setup({ audit: [auditRow(1)] });
    const d = await t.facade.accountDetail(ACC1);
    expect(d.owner?.id).toBe(U1);
    expect(d.businesses).toHaveLength(3);
    expect(d.accountMembers.map((m) => m.role)).toEqual(['owner', 'billing']);
    expect(d.audit[0]?.action).toBe('billing.plan_set');
    expect(t.audit.list).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: 'account', targetId: ACC1 }),
    );
  });

  it('answers NOT_FOUND for an unknown account', async () => {
    const t = setup();
    await expect(
      t.facade.accountDetail('00000000-0000-4000-8000-0000000000ff'),
    ).rejects.toBeInstanceOf(AdminAccountNotFoundError);
  });

  it('pages the platform audit trail with a keyset cursor', async () => {
    const t = setup({ audit: [auditRow(1), auditRow(2), auditRow(3)] });
    const first = await t.facade.listAudit({ limit: 2 });
    expect(first.data).toHaveLength(2);
    expect(first.page.nextCursor).not.toBeNull();
    await t.facade.listAudit({ limit: 2, cursor: first.page.nextCursor! });
    expect(t.audit.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        before: { at: auditRow(2).createdAt, id: auditRow(2).id },
        limit: 3,
      }),
    );
    await expect(t.facade.listAudit({ limit: 2, cursor: 'garbage' })).rejects.toBeInstanceOf(
      InvalidAdminCursorError,
    );
  });
});
