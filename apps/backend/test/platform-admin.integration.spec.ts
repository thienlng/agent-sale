import 'reflect-metadata';
import {
  AdminAccountDetail,
  AdminAccountList,
  AdminAuditList,
  AdminPaymentDto,
  AdminPaymentList,
  AdminPlanDto,
  AdminPlanList,
  AdminSubscriptionDto,
  BillingSettingsDto,
  SubscriptionChangedV1,
} from '@agent-sales/contracts';
import { and, desc, eq, schema, sql } from '@agent-sales/db';
import { workspaceId } from '@agent-sales/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BILLING_FACADE,
  BILLING_RUNNER,
  type BillingFacade,
  type BillingRunner,
} from '../src/modules/billing/api/index.js';
import { startHarness, type Harness, type TestUser } from './support/harness.js';
import { enableTwoFactor } from './support/mfa.js';

/**
 * Platform admin (ADR-021 §6) on Postgres: migration 0053, the signup trial, operator writes with
 * audit and events, lazy trial expiry, the lifecycle job, account suspension and VietQR payments.
 */
const REASON = 'customer called support';
let hx: Harness;
let admin: TestUser;
let billing: BillingFacade;
let runner: BillingRunner;

const accountOf = async (ws: string) => {
  const [row] = await hx.owner.db
    .select({ accountId: schema.workspaces.accountId })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, ws));
  return row?.accountId ?? '';
};

const subscription = async (accountId: string) => {
  const [row] = await hx.owner.db
    .select()
    .from(schema.accountSubscriptions)
    .where(eq(schema.accountSubscriptions.accountId, accountId));
  return row;
};

const subscriptionEvents = async (accountId: string) =>
  (
    await hx.owner.db
      .select({ payload: schema.outboxEvents.payload })
      .from(schema.outboxEvents)
      .where(
        and(
          eq(schema.outboxEvents.type, 'billing.subscription.changed.v1'),
          eq(schema.outboxEvents.aggregateId, accountId),
        ),
      )
      .orderBy(desc(schema.outboxEvents.createdAt))
  ).map((r) => SubscriptionChangedV1.parse(r.payload));

const settings = async () =>
  BillingSettingsDto.parse((await hx.call(admin.auth, 'GET', '/admin/billing-settings')).json());

async function putSettings(patch: Record<string, unknown>) {
  const current = await settings();
  const { version, updatedAt: _updatedAt, ...rest } = current;
  const res = await hx.call(admin.auth, 'PUT', '/admin/billing-settings', {
    ...rest,
    ...patch,
    expectedVersion: version,
    reason: REASON,
  });
  expect(res.statusCode).toBe(200);
  return BillingSettingsDto.parse(res.json());
}

const detail = async (accountId: string) =>
  AdminAccountDetail.parse(
    (await hx.call(admin.auth, 'GET', `/admin/accounts/${accountId}`)).json(),
  );

beforeAll(async () => {
  hx = await startHarness();
  admin = await hx.user('root@rapiz.vn', 'Rapiz Ops');
  await hx.owner.db
    .update(schema.users)
    .set({ isPlatformAdmin: true })
    .where(eq(schema.users.id, admin.userId));
  // The back office needs two-factor on and a session that passed it (enabling proves it).
  await enableTwoFactor((path, body) => hx.call(admin.auth, 'POST', path, body), admin.password);
  billing = hx.app.get(BILLING_FACADE);
  runner = hx.app.get(BILLING_RUNNER);
});

afterAll(async () => {
  await hx?.stop();
});

describe('migration 0053', () => {
  it('ships the trial off and keeps the new tables away from the tenant role', async () => {
    const s = await settings();
    expect(s).toMatchObject({ trialEnabled: false, afterTrialPlanCode: 'free', version: 1 });
    for (const table of ['billing_settings', 'payments', 'platform_audit_events']) {
      await expect(
        hx.owner.db.transaction(async (tx) => {
          await tx.execute(sql`set local role app_tenant`);
          await tx.execute(sql.raw(`select * from ${table} limit 1`));
        }),
      ).rejects.toThrow();
    }
  });
});

describe('platform admin routes', () => {
  it('are invisible (404) to users who are not platform admins', async () => {
    const someone = await hx.user('someone@shop.vn', 'Someone');
    for (const [method, url] of [
      ['GET', '/admin/accounts'],
      ['GET', '/admin/plans'],
      ['GET', '/admin/audit'],
      ['GET', '/admin/billing-settings'],
    ] as const) {
      expect((await hx.call(someone.auth, method, url)).statusCode).toBe(404);
    }
    const res = await hx.call(
      someone.auth,
      'POST',
      `/admin/accounts/${await accountOf(someone.ownWorkspace)}/status`,
      {
        status: 'suspended',
        reason: REASON,
      },
    );
    expect(res.statusCode).toBe(404);
  });

  it('answers 404 for an unknown account', async () => {
    const res = await hx.call(admin.auth, 'GET', `/admin/accounts/${crypto.randomUUID()}`);
    expect(res.statusCode).toBe(404);
  });
});

describe('plan catalog', () => {
  it('publishes versions with an optimistic check and audits every edit', async () => {
    const plans = AdminPlanList.parse((await hx.call(admin.auth, 'GET', '/admin/plans')).json());
    const pro = plans.data.find((p) => p.code === 'sales_pro');
    expect(pro).toBeDefined();
    const base = {
      name: 'Growth',
      description: 'For growing shops',
      isPublic: true,
      sortOrder: 40,
      priceByPeriod: { '1': 500_000, '12': 400_000 },
      entitlements: pro?.entitlements,
      reason: REASON,
    };
    const created = await hx.call(admin.auth, 'POST', '/admin/plans', { ...base, code: 'growth' });
    expect(created.statusCode).toBe(201);
    expect(AdminPlanDto.parse(created.json())).toMatchObject({ code: 'growth', version: 1 });

    const v2 = await hx.call(admin.auth, 'POST', '/admin/plans/growth/versions', {
      ...base,
      priceByPeriod: { '1': 550_000 },
      expectedVersion: 1,
    });
    expect(v2.statusCode).toBe(201);
    expect(AdminPlanDto.parse(v2.json()).version).toBe(2);
    const stale = await hx.call(admin.auth, 'POST', '/admin/plans/growth/versions', {
      ...base,
      expectedVersion: 1,
    });
    expect(stale.statusCode).toBe(409);

    const archived = await hx.call(admin.auth, 'POST', '/admin/plans/growth/archive', {
      archived: true,
      reason: REASON,
    });
    expect(archived.statusCode).toBe(200);
    expect(AdminPlanDto.parse(archived.json()).archived).toBe(true);

    const audit = AdminAuditList.parse(
      (await hx.call(admin.auth, 'GET', '/admin/audit?targetType=plan&targetId=growth')).json(),
    );
    expect(audit.data.map((e) => e.action)).toEqual([
      'billing.plan.archived',
      'billing.plan.published',
      'billing.plan.created',
    ]);
    expect(audit.data[0]).toMatchObject({ actorName: 'Rapiz Ops', reason: REASON });
  });

  it('rejects an invalid request with 400', async () => {
    const res = await hx.call(admin.auth, 'POST', '/admin/plans', {
      code: 'Bad Code',
      reason: REASON,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('accounts', () => {
  let customer: TestUser;
  let accountId: string;

  it('starts the signup trial when the setting is on', async () => {
    await putSettings({ trialEnabled: true, trialPlanCode: 'sales_pro', trialDays: 14 });
    customer = await hx.user('lan@shop.vn', 'Lan');
    accountId = await accountOf(customer.ownWorkspace);
    const sub = await subscription(accountId);
    expect(sub).toMatchObject({ planCode: 'sales_pro', status: 'trialing' });
    const days =
      ((sub?.currentPeriodEnd?.getTime() ?? 0) - (sub?.currentPeriodStart.getTime() ?? 0)) /
      86_400_000;
    expect(Math.round(days)).toBe(14);
    const [event] = await subscriptionEvents(accountId);
    expect(event).toMatchObject({ reason: 'signup_trial', status: 'trialing', mrrVnd: 0 });
  });

  it('lists accounts with owner, subscription and business count, and filters them', async () => {
    const byEmail = AdminAccountList.parse(
      (await hx.call(admin.auth, 'GET', '/admin/accounts?q=lan%40shop')).json(),
    );
    expect(byEmail.data).toHaveLength(1);
    expect(byEmail.data[0]).toMatchObject({
      id: accountId,
      owner: { email: 'lan@shop.vn' },
      subscription: { status: 'trialing', plan: { code: 'sales_pro' } },
      businessCount: 1,
    });
    const trialing = AdminAccountList.parse(
      (await hx.call(admin.auth, 'GET', '/admin/accounts?subscriptionStatus=trialing')).json(),
    );
    expect(trialing.data.map((a) => a.id)).toEqual([accountId]);
    const free = AdminAccountList.parse(
      (await hx.call(admin.auth, 'GET', '/admin/accounts?planCode=free&limit=100')).json(),
    );
    expect(free.data.map((a) => a.id)).not.toContain(accountId);
    expect(free.data.map((a) => a.owner?.email)).toContain('root@rapiz.vn');

    const page1 = AdminAccountList.parse(
      (await hx.call(admin.auth, 'GET', '/admin/accounts?limit=1')).json(),
    );
    expect(page1.page.nextCursor).not.toBeNull();
    const page2 = AdminAccountList.parse(
      (
        await hx.call(admin.auth, 'GET', `/admin/accounts?limit=1&cursor=${page1.page.nextCursor}`)
      ).json(),
    );
    expect(page2.data[0]?.id).not.toBe(page1.data[0]?.id);
  });

  it('reads an ended trial as the after-trial plan, then the lifecycle job writes it', async () => {
    await hx.owner.db
      .update(schema.accountSubscriptions)
      .set({ currentPeriodEnd: new Date(Date.now() - 3_600_000) })
      .where(eq(schema.accountSubscriptions.accountId, accountId));
    const before = await detail(accountId);
    expect(before.subscription).toMatchObject({
      status: 'trialing',
      effectivePlan: { code: 'free' },
    });

    await runner.tick(new Date());
    expect(await subscription(accountId)).toMatchObject({ planCode: 'free', status: 'active' });
    const [event] = await subscriptionEvents(accountId);
    expect(event).toMatchObject({ reason: 'expiry', planCode: 'free', status: 'active' });
    const snapshots = await hx.owner.db
      .select({ id: schema.outboxEvents.id })
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.type, 'billing.usage.snapshot.v1'));
    expect(snapshots.length).toBeGreaterThan(0);
  });

  it('sets a plan with a version check, audit in every business and an event with MRR', async () => {
    const version = (await subscription(accountId))?.version ?? 0;
    const body = {
      planCode: 'sales_pro',
      periodMonths: 3,
      status: 'active',
      expectedVersion: version,
      reason: REASON,
    };
    const res = await hx.call(admin.auth, 'POST', `/admin/accounts/${accountId}/plan`, body);
    expect(res.statusCode).toBe(200);
    expect(AdminSubscriptionDto.parse(res.json())).toMatchObject({
      plan: { code: 'sales_pro' },
      status: 'active',
      periodMonths: 3,
      version: version + 1,
    });
    expect(
      (await hx.call(admin.auth, 'POST', `/admin/accounts/${accountId}/plan`, body)).statusCode,
    ).toBe(409);
    expect(
      (
        await hx.call(admin.auth, 'POST', `/admin/accounts/${accountId}/plan`, {
          ...body,
          periodMonths: null,
          expectedVersion: version + 1,
        })
      ).statusCode,
    ).toBe(400);

    const [event] = await subscriptionEvents(accountId);
    expect(event).toMatchObject({ reason: 'admin', planCode: 'sales_pro', mrrVnd: 1_624_000 });
    const audit = await hx.owner.db
      .select({ action: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.workspaceId, customer.ownWorkspace),
          eq(schema.auditEvents.action, 'billing.plan_set'),
        ),
      );
    expect(audit.length).toBeGreaterThan(0);
    expect((await detail(accountId)).audit.map((e) => e.action)).toContain(
      'billing.subscription.set',
    );
  });

  it('grants and removes entitlement overrides', async () => {
    const put = await hx.call(
      admin.auth,
      'PUT',
      `/admin/accounts/${accountId}/overrides/members.max`,
      {
        value: 9,
        expiresAt: null,
        reason: REASON,
      },
    );
    expect(put.statusCode).toBe(200);
    expect((await detail(accountId)).overrides.map((o) => [o.key, o.value])).toEqual([
      ['members.max', 9],
    ]);
    const unknown = await hx.call(
      admin.auth,
      'PUT',
      `/admin/accounts/${accountId}/overrides/nope.key`,
      {
        value: 1,
        expiresAt: null,
        reason: REASON,
      },
    );
    expect(unknown.statusCode).toBe(400);
    const del = await hx.call(
      admin.auth,
      'DELETE',
      `/admin/accounts/${accountId}/overrides/members.max`,
      {
        reason: REASON,
      },
    );
    expect(del.statusCode).toBe(204);
    expect((await detail(accountId)).overrides).toEqual([]);
  });

  it('suspends an account: the bot stops replying, the dashboard stays open', async () => {
    const url = `/admin/accounts/${accountId}/status`;
    expect(
      (await hx.call(admin.auth, 'POST', url, { status: 'suspended', reason: REASON })).statusCode,
    ).toBe(204);
    expect(
      (await hx.call(admin.auth, 'POST', url, { status: 'suspended', reason: REASON })).statusCode,
    ).toBe(409);
    const outcome = await billing.reserveReply(workspaceId(customer.ownWorkspace), {
      idempotencyKey: 'bot:suspended-1',
      conversationId: null,
      botId: null,
    });
    expect(outcome).toMatchObject({ allowed: false, reason: 'account_suspended' });
    expect((await hx.call(customer.h, 'GET', '/billing/usage')).statusCode).toBe(200);
    const status = await hx.owner.db
      .select({ type: schema.outboxEvents.type })
      .from(schema.outboxEvents)
      .where(
        and(
          eq(schema.outboxEvents.type, 'account.account.status_changed.v1'),
          eq(schema.outboxEvents.aggregateId, accountId),
        ),
      );
    expect(status).toHaveLength(1);
    expect(
      (await hx.call(admin.auth, 'POST', url, { status: 'active', reason: REASON })).statusCode,
    ).toBe(204);
    expect((await detail(accountId)).status).toBe('active');
  });

  it('confirms a VietQR payment: the paid period starts where the current one ends', async () => {
    await putSettings({
      bankBin: '970436',
      bankAccountNo: '0123456789',
      bankAccountName: 'RAPIZ JSC',
    });
    const before = await subscription(accountId);
    const created = await hx.call(admin.auth, 'POST', `/admin/accounts/${accountId}/payments`, {
      planCode: 'sales_pro',
      periodMonths: 3,
      reason: REASON,
    });
    expect(created.statusCode).toBe(201);
    const payment = AdminPaymentDto.parse(created.json());
    expect(payment).toMatchObject({
      status: 'pending',
      amountVnd: 1_624_000 * 3,
      accountName: expect.any(String),
    });
    expect(payment.code).toMatch(/^RPZ[0-9A-Z]{6}$/);
    expect(payment.qrUrl).toContain('img.vietqr.io');

    const pending = AdminPaymentList.parse(
      (await hx.call(admin.auth, 'GET', '/admin/payments?status=pending')).json(),
    );
    expect(pending.data.map((p) => p.id)).toContain(payment.id);

    const confirm = await hx.call(admin.auth, 'POST', `/admin/payments/${payment.id}/confirm`, {
      bankReference: 'FT123',
      reason: REASON,
    });
    expect(confirm.statusCode).toBe(200);
    expect(AdminPaymentDto.parse(confirm.json())).toMatchObject({
      status: 'confirmed',
      bankReference: 'FT123',
    });
    const after = await subscription(accountId);
    expect(after?.currentPeriodStart.getTime()).toBe(before?.currentPeriodEnd?.getTime());
    expect(after?.status).toBe('active');
    const [event] = await subscriptionEvents(accountId);
    expect(event?.reason).toBe('payment');

    const again = await hx.call(admin.auth, 'POST', `/admin/payments/${payment.id}/confirm`, {
      bankReference: null,
      reason: REASON,
    });
    expect(again.statusCode).toBe(409);
    expect(
      (
        await hx.call(admin.auth, 'POST', `/admin/payments/${crypto.randomUUID()}/cancel`, {
          reason: REASON,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('starts no trial when the setting is off', async () => {
    await putSettings({ trialEnabled: false });
    const other = await hx.user('minh@shop.vn', 'Minh');
    expect(await subscription(await accountOf(other.ownWorkspace))).toBeUndefined();
  });
});
