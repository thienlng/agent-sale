import { and, eq, schema, sql } from '@agent-sales/db';
import { userId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CONTACT_SYNC_FACADE,
  CRM_FACADE,
  type ContactSyncFacade,
  type CrmFacade,
} from '../src/modules/crm/api/index.js';
import { BILLING_ADMIN_FACADE, type BillingAdminFacade } from '../src/modules/billing/api/index.js';
import { SAAS_RUNNER, type SaasRunner } from '../src/modules/saas/api/index.js';
import { HqSyncHandler } from '../src/modules/saas/application/event-handlers/hq-sync.handler.js';
import { HqContext } from '../src/modules/saas/application/hq-context.js';
import { HqReconcileService } from '../src/modules/saas/application/hq-reconcile.service.js';
import {
  PLATFORM_DIRECTORY,
  type PlatformDirectory,
} from '../src/modules/saas/application/ports/platform-directory.js';
import { SAAS_STORE, type SaasStore } from '../src/modules/saas/application/ports/saas-store.js';
import {
  SAAS_SYSTEM_STORE,
  type SaasSystemStore,
} from '../src/modules/saas/application/ports/saas-system-store.js';
import { SaasSubscriptionService } from '../src/modules/saas/application/saas-subscription.service.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../src/modules/workspace/api/index.js';
import { type Harness, type Headers, startHarness } from './support/harness.js';

/**
 * Rapiz HQ (ADR-021, spec §5–§6) on a real Postgres: the outbox consumer (adoption, idempotency,
 * ordering, dead letters), read-only linked rows, the plan catalog and history, the backfill and
 * the local reminders.
 */
const count = () => sql<number>`count(*)`;
let t: Harness;
let hq: WorkspaceId;
let h: Headers;
let sync: HqSyncHandler;
let reconcile: HqReconcileService;

beforeAll(async () => {
  t = await startHarness();
  const boss = await t.user('hq-boss@rapiz.test', 'Rapiz boss');
  const ws = await t.app.get<WorkspaceFacade>(WORKSPACE_FACADE).createWorkspace({
    name: 'Rapiz',
    industry: 'saas',
    ownerUserId: userId(boss.userId),
  });
  hq = workspaceId(ws.id);
  h = boss.in(hq);
  // The module reads RAPIZ_HQ_WORKSPACE_ID at boot; the tests point a handler at their HQ.
  const context = new HqContext(hq, t.app.get<WorkspaceFacade>(WORKSPACE_FACADE));
  const store = t.app.get<SaasStore>(SAAS_STORE);
  const subscriptions = t.app.get(SaasSubscriptionService);
  const contacts = t.app.get<ContactSyncFacade>(CONTACT_SYNC_FACADE);
  sync = new HqSyncHandler(
    context,
    t.app.get<SaasSystemStore>(SAAS_SYSTEM_STORE),
    store,
    contacts,
    t.app.get<CrmFacade>(CRM_FACADE),
    subscriptions,
  );
  reconcile = new HqReconcileService(
    context,
    t.app.get<PlatformDirectory>(PLATFORM_DIRECTORY),
    store,
    contacts,
    subscriptions,
  );
});
afterAll(async () => {
  await t?.stop();
});

const iso = (daysFromNow: number) => new Date(Date.now() + daysFromNow * 86_400_000).toISOString();
let clock = Date.now() - 86_400_000;
/** Strictly increasing event times. */
const at = () => new Date((clock += 1000)).toISOString();

async function emit(type: string, payload: Record<string, unknown>) {
  await t.owner.db.insert(schema.outboxEvents).values({
    workspaceId: null,
    type,
    aggregateType: type.split('.')[1] ?? 'account',
    aggregateId: String(payload['accountId']),
    payload,
  });
}
const created = (accountId: string, o: { phone?: string | null; email: string; name?: string }) =>
  emit('account.account.created.v1', {
    accountId,
    ownerUserId: crypto.randomUUID(),
    name: 'Synthetic shop',
    ownerName: o.name ?? 'Synthetic owner',
    ownerEmail: o.email,
    ownerPhone: o.phone ?? null,
    workspaceId: null,
    industry: 'fashion',
    occurredAt: at(),
  });
const changed = (accountId: string, o: Record<string, unknown> = {}, occurredAt = at()) =>
  emit('billing.subscription.changed.v1', {
    accountId,
    planCode: 'sales_pro',
    planVersion: 1,
    planName: 'Sales Pro',
    periodMonths: 12,
    status: 'active',
    periodStart: iso(-1),
    periodEnd: iso(364),
    mrrVnd: 974_000,
    reason: 'payment',
    occurredAt,
    ...o,
  });

const contactOf = async (accountId: string) => {
  const [row] = await t.owner.db
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.workspaceId, hq), eq(schema.contacts.externalId, accountId)));
  return row;
};
const subscriptionOf = async (contactId: string) =>
  (await t.call(h, 'GET', `/contacts/${contactId}/saas-subscription`)).json().subscription;
const notes = async (contactId: string) =>
  (await t.call(h, 'GET', `/contacts/${contactId}/notes`)).json().data as Array<{
    body: string;
    authorName: string;
  }>;
const history = async (contactId: string) =>
  (await t.call(h, 'GET', `/contacts/${contactId}/saas-subscription/history`)).json().data;
const newContact = async (body: object) => {
  const r = await t.call(h, 'POST', '/contacts', { name: 'Staff entered', ...body });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { id: string; version: number };
};
const statusKey = async (contactId: string) => {
  const statuses = (await t.call(h, 'GET', '/crm/statuses')).json().data as Array<{
    id: string;
    key: string | null;
  }>;
  const { statusId } = (await t.call(h, 'GET', `/contacts/${contactId}`)).json();
  return statuses.find((s) => s.id === statusId)?.key ?? null;
};
const replayFromStart = () =>
  t.owner.db
    .update(schema.saasHqCheckpoints)
    .set({ horizon: 0 })
    .where(eq(schema.saasHqCheckpoints.consumer, 'saas.hq_sync'));
const rows = async (table: typeof schema.contacts | typeof schema.saasSubscriptions) =>
  Number(
    (await t.owner.db.select({ n: count() }).from(table).where(eq(table.workspaceId, hq)))[0]?.n,
  );

describe('Rapiz HQ sync consumer', () => {
  it('adopts a staff-entered customer by phone, then by email, else creates a linked one', async () => {
    const byPhone = await newContact({ phone: '0912 000 001' });
    const byEmail = await newContact({ email: 'Owner2@Shop.test' });
    const [a1, a2, a3] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    await created(a1, { phone: '+84912000001', email: 'owner1@shop.test', name: 'Platform name' });
    await created(a2, { email: 'owner2@shop.test' });
    await created(a3, { phone: '0912000003', email: 'owner3@shop.test' });
    expect(await sync.tick()).toBeGreaterThanOrEqual(3);

    expect((await contactOf(a1))?.id).toBe(byPhone.id);
    // Rapiz owns phone and email only: the name staff typed stays.
    expect((await contactOf(a1))?.name).toBe('Staff entered');
    expect((await contactOf(a1))?.externalSource).toBe('rapiz');
    expect((await contactOf(a2))?.id).toBe(byEmail.id);
    const fresh = await contactOf(a3);
    expect(fresh).toMatchObject({ name: 'Synthetic owner', emailNormalized: 'owner3@shop.test' });
  });

  it('upserts the subscription per account, ignores stale events and is idempotent on replay', async () => {
    const account = crypto.randomUUID();
    await created(account, { phone: '0912000010', email: 'owner10@shop.test' });
    const old = at();
    await changed(account, { status: 'trialing', mrrVnd: 0, planCode: 'sales_pro' });
    await sync.tick();
    const contact = await contactOf(account);
    const contactId = contact?.id ?? '';
    expect(await subscriptionOf(contactId)).toMatchObject({
      stage: 'trial',
      externalRef: account,
      linked: { source: 'rapiz' },
      mrr: 0,
    });

    await changed(account); // paid
    await changed(account, { status: 'past_due' }, old); // older than both: ignored
    await sync.tick();
    const paid = await subscriptionOf(contactId);
    expect(paid).toMatchObject({
      stage: 'active',
      planName: 'Sales Pro',
      billingPeriod: 'yearly',
      mrr: 974_000,
    });
    expect(await statusKey(contactId)).toBe('paying');
    const hist = await history(contactId);
    expect(hist.map((e: { toStage: string; source: string }) => [e.toStage, e.source])).toEqual([
      ['active', 'sync'],
      ['trial', 'sync'],
    ]);

    // Replaying the whole outbox changes nothing.
    const before = {
      contacts: await rows(schema.contacts),
      subs: await rows(schema.saasSubscriptions),
      notes: (await notes(contactId)).length,
    };
    await replayFromStart();
    await sync.tick();
    expect(await subscriptionOf(contactId)).toMatchObject({
      version: paid.version,
      stage: 'active',
    });
    expect(await history(contactId)).toHaveLength(2);
    expect({
      contacts: await rows(schema.contacts),
      subs: await rows(schema.saasSubscriptions),
      notes: (await notes(contactId)).length,
    }).toEqual(before);
  });

  it('turns reminders, suspensions and usage over 80% into follow-ups, once each', async () => {
    const account = crypto.randomUUID();
    await created(account, { phone: '0912000020', email: 'owner20@shop.test' });
    await changed(account);
    const due = iso(3);
    const reminder = {
      accountId: account,
      kind: 'renewal_due',
      daysLeft: 3,
      dueAt: due,
      occurredAt: at(),
    };
    await emit('billing.subscription.reminder.v1', reminder);
    await emit('billing.subscription.reminder.v1', { ...reminder, occurredAt: at() });
    await emit('account.account.status_changed.v1', {
      accountId: account,
      status: 'suspended',
      occurredAt: at(),
    });
    const usage = { accountId: account, limit: 100, cycleStart: iso(-10), cycleEnd: iso(20) };
    await emit('billing.usage.snapshot.v1', { ...usage, used: 50, occurredAt: at() });
    await emit('billing.usage.snapshot.v1', { ...usage, used: 85, occurredAt: at() });
    await emit('billing.usage.snapshot.v1', { ...usage, used: 90, occurredAt: at() });
    await sync.tick();

    const contactId = (await contactOf(account))?.id ?? '';
    const bodies = (await notes(contactId)).map((n) => n.body);
    expect(bodies.filter((b) => b.startsWith('Việc cần làm: Sắp đến hạn gia hạn'))).toHaveLength(1);
    expect(bodies.filter((b) => b.startsWith('Cơ hội nâng cấp'))).toHaveLength(1);
    expect(bodies).toContain('Tài khoản Rapiz bị tạm khóa.');
    expect((await notes(contactId)).every((n) => n.authorName === 'Rapiz')).toBe(true);
    expect(await subscriptionOf(contactId)).toMatchObject({
      upsell: true,
      usage: { used: 90, limit: 100 },
    });
  });

  it('skips events of accounts it never saw and dead-letters unreadable payloads', async () => {
    const stranger = crypto.randomUUID();
    await changed(stranger);
    await emit('billing.subscription.changed.v1', { accountId: stranger, planCode: 42 });
    const subs = await rows(schema.saasSubscriptions);
    await sync.tick();
    expect(await rows(schema.saasSubscriptions)).toBe(subs);
    const dead = await t.owner.db.select().from(schema.saasHqDeadLetters);
    expect(dead.map((d) => d.error)).toContain('INVALID_PAYLOAD');
    // The position moved on: nothing is read twice.
    expect(await sync.tick()).toBe(0);
  });
});

describe('read-only linked rows', () => {
  it('rejects staff edits of synced fields, keeps the name, seats and note editable', async () => {
    const account = crypto.randomUUID();
    await created(account, { phone: '0912000030', email: 'owner30@shop.test' });
    await changed(account);
    await sync.tick();
    const contactId = (await contactOf(account))?.id ?? '';
    const sub = await subscriptionOf(contactId);
    const body = Object.fromEntries(
      Object.entries(sub).filter(
        ([k]) =>
          ![
            'id',
            'linked',
            'usage',
            'upsell',
            'contactId',
            'contactName',
            'createdAt',
            'updatedAt',
          ].includes(k),
      ),
    );
    const path = `/contacts/${contactId}/saas-subscription`;

    const mrr = await t.call(h, 'PUT', path, { ...body, mrr: 1 });
    expect(mrr.statusCode).toBe(400);
    expect(mrr.body).toContain('LINKED_READ_ONLY');
    const ok = await t.call(h, 'PUT', path, { ...body, seats: 3, note: 'VIP' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ seats: 3, note: 'VIP', mrr: 974_000 });

    const contact = (await t.call(h, 'GET', `/contacts/${contactId}`)).json();
    const phone = await t.call(h, 'PATCH', `/contacts/${contactId}`, {
      phone: '0912999999',
      expectedVersion: contact.version,
    });
    expect(phone.statusCode).toBe(400);
    expect(phone.body).toContain('LINKED_READ_ONLY');
    const email = await t.call(h, 'PATCH', `/contacts/${contactId}`, {
      email: 'other@shop.test',
      expectedVersion: contact.version,
    });
    expect(email.statusCode).toBe(400);
    const name = await t.call(h, 'PATCH', `/contacts/${contactId}`, {
      name: 'Renamed by staff',
      expectedVersion: contact.version,
    });
    expect(name.statusCode, name.body).toBe(200);
    expect(name.json().external).toMatchObject({ source: 'rapiz' });
  });
});

describe('plan catalog, history and churn (spec §6.1–6.4)', () => {
  it('computes MRR from the plan, records history and keeps the churn reason on a cancellation', async () => {
    const plan = await t.call(h, 'POST', '/saas-plans', {
      name: 'Growth',
      prices: { monthly: 1_200_000, yearly: 12_000_000 },
    });
    expect(plan.statusCode, plan.body).toBe(201);
    const planId = plan.json().id as string;
    expect(
      (await t.call(h, 'POST', '/saas-plans', { name: 'Growth', prices: { monthly: 1 } }))
        .statusCode,
    ).toBe(409);

    const c = await newContact({ phone: '0912000040' });
    const path = `/contacts/${c.id}/saas-subscription`;
    const put = await t.call(h, 'PUT', path, {
      version: null,
      planName: 'ignored',
      planId,
      stage: 'active',
      billingPeriod: 'yearly',
      startedOn: '2026-11-01',
      renewsOn: '2027-11-01',
    });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json()).toMatchObject({ planName: 'Growth', mrr: 1_000_000, planId });
    const noPrice = await t.call(h, 'PUT', path, {
      ...put.json(),
      version: 1,
      billingPeriod: 'quarterly',
    });
    expect(noPrice.statusCode).toBe(400);

    const cancel = await t.call(h, 'PUT', path, {
      version: 1,
      planName: 'Growth',
      planId,
      stage: 'canceled',
      billingPeriod: 'yearly',
      canceledOn: '2026-11-02',
      churnReason: 'price',
      churnNote: 'Too expensive',
    });
    expect(cancel.statusCode, cancel.body).toBe(200);
    expect(cancel.json()).toMatchObject({ churnReason: 'price', churnNote: 'Too expensive' });
    const hist = await history(c.id);
    expect(hist[0]).toMatchObject({
      fromStage: 'active',
      toStage: 'canceled',
      churnReason: 'price',
      source: 'staff',
    });
    expect(hist).toHaveLength(2);

    // An archived plan stays on its subscriptions but takes no new one.
    const archived = await t.call(h, 'PATCH', `/saas-plans/${planId}`, {
      archived: true,
      expectedVersion: 1,
    });
    expect(archived.json()).toMatchObject({ archived: true, version: 2 });
    const other = await newContact({ phone: '0912000041' });
    const refused = await t.call(h, 'PUT', `/contacts/${other.id}/saas-subscription`, {
      version: null,
      planName: 'Growth',
      planId,
      stage: 'active',
      billingPeriod: 'monthly',
    });
    expect(refused.statusCode).toBe(400);
  });

  it('seeds the demo_scheduled and free_plan statuses and maps the free stage to free_plan', async () => {
    const keys = (
      (await t.call(h, 'GET', '/crm/statuses')).json().data as Array<{ key: string }>
    ).map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['demo_scheduled', 'free_plan']));
    const c = await newContact({ phone: '0912000050' });
    await t.call(h, 'PUT', `/contacts/${c.id}/saas-subscription`, {
      version: null,
      planName: 'Free',
      stage: 'free',
      billingPeriod: 'monthly',
    });
    expect(await statusKey(c.id)).toBe('free_plan');
    expect((await t.call(h, 'GET', '/saas-subscriptions/summary')).json().stages.free).toBe(1);
  });
});

describe('backfill and reconcile', () => {
  it('dry-runs without writing, then links every account, then finds nothing to repair', async () => {
    // A platform account with no subscription row (free) and one on a paid plan.
    const [owner] = await t.owner.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, 'hq-boss@rapiz.test'));
    const free = crypto.randomUUID();
    const paid = crypto.randomUUID();
    for (const id of [free, paid]) {
      await t.owner.db
        .insert(schema.accounts)
        .values({ id, name: 'Backfill shop', createdByUserId: owner?.id ?? '' });
      await t.owner.db
        .insert(schema.accountMembers)
        .values({ accountId: id, userId: owner?.id ?? '', role: 'owner' });
    }
    await t.owner.db.insert(schema.accountSubscriptions).values({
      accountId: paid,
      planCode: 'sales_smart',
      planVersion: 1,
      periodMonths: 12,
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 300 * 86_400_000),
    });

    const before = {
      contacts: await rows(schema.contacts),
      subs: await rows(schema.saasSubscriptions),
      links: (await t.owner.db.select({ n: count() }).from(schema.saasHqLinks))[0]?.n,
    };
    const dry = await reconcile.run({ dryRun: true });
    expect(dry.linked).toBeGreaterThanOrEqual(2);
    expect({
      contacts: await rows(schema.contacts),
      subs: await rows(schema.saasSubscriptions),
      links: (await t.owner.db.select({ n: count() }).from(schema.saasHqLinks))[0]?.n,
    }).toEqual(before);

    const real = await reconcile.run({ dryRun: false });
    expect(real.linked).toBe(dry.linked);
    const paidContact = await contactOf(paid);
    expect(await subscriptionOf(paidContact?.id ?? '')).toMatchObject({
      planName: 'Sales Smart',
      stage: 'active',
      billingPeriod: 'yearly',
      mrr: 785_000,
    });
    expect(await subscriptionOf((await contactOf(free))?.id ?? '')).toMatchObject({
      stage: 'free',
      mrr: 0,
    });

    const again = await reconcile.run({ dryRun: false });
    expect(again).toMatchObject({ linked: 0, subscriptionsCreated: 0, subscriptionsUpdated: 0 });
    expect(again.unchanged).toBe(again.accounts - again.skipped);
  });
});

describe('real producers (signup trial, admin plan change)', () => {
  it('mirrors a signup trial into HQ, then the plan an operator sets', async () => {
    const billing = t.app.get<BillingAdminFacade>(BILLING_ADMIN_FACADE);
    const actor = { userId: null, name: 'HQ test' };
    const { version, updatedAt: _updatedAt, ...settings } = await billing.settings();
    await billing.putSettings(
      {
        ...settings,
        hqContactScope: 'owner',
        trialEnabled: true,
        trialPlanCode: 'sales_pro',
        trialDays: 14,
        expectedVersion: version,
        reason: 'HQ end-to-end test',
      },
      actor,
    );
    const user = await t.user('trial-owner@shop.test', 'Chị Trial');
    const [account] = await t.owner.db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(eq(schema.accounts.createdByUserId, user.userId));
    const accountId = account?.id ?? '';
    while ((await sync.tick()) > 0);

    const contact = await contactOf(accountId);
    expect(contact).toMatchObject({ name: 'Chị Trial', email: 'trial-owner@shop.test' });
    expect(await subscriptionOf(contact?.id ?? '')).toMatchObject({
      stage: 'trial',
      mrr: 0,
      externalRef: accountId,
    });

    const current = (await billing.subscriptionsOf([accountId])).get(accountId);
    await billing.setAccountPlan(
      accountId,
      {
        planCode: 'sales_smart',
        periodMonths: 12,
        status: 'active',
        expectedVersion: current?.version ?? null,
        reason: 'HQ end-to-end test',
      },
      actor,
    );
    while ((await sync.tick()) > 0);
    expect(await subscriptionOf(contact?.id ?? '')).toMatchObject({
      planName: 'Sales Smart',
      stage: 'active',
      billingPeriod: 'yearly',
      mrr: 785_000,
    });
    // The reconcile reads the same state through the admin facades: nothing to repair.
    const report = await reconcile.run({ dryRun: false });
    expect(report.subscriptionsUpdated).toBe(0);
  });
});

describe('local reminders (spec §6.5)', () => {
  it('adds one follow-up for an unlinked trial ending within 3 days, once per day', async () => {
    const c = await newContact({ phone: '0912000060' });
    await t.call(h, 'PUT', `/contacts/${c.id}/saas-subscription`, {
      version: null,
      planName: 'Pro',
      stage: 'trial',
      billingPeriod: 'monthly',
      trialEndsOn: iso(2).slice(0, 10),
    });
    const runner = t.app.get<SaasRunner>(SAAS_RUNNER);
    await runner.daily(new Date());
    await runner.daily(new Date());
    const follow = (await notes(c.id)).filter((n) => n.body.startsWith('Việc cần làm'));
    expect(follow).toHaveLength(1);
    // A second day does not repeat the same reminder either.
    await t.owner.db.execute(
      sql`update saas_hq_checkpoints set horizon = horizon - 1 where consumer = 'saas.reminders'`,
    );
    await runner.daily(new Date());
    expect((await notes(c.id)).filter((n) => n.body.startsWith('Việc cần làm'))).toHaveLength(1);
  });
});
