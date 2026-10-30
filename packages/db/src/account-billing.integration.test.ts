import { newId, workspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { backfillAccountSubscriptions } from './account-subscription-backfill.js';
import { createDb, type Database } from './client.js';
import { ensureLoginRoles, migrate, withCredentials } from './migrate.js';
import { withTenant } from './tenant.js';

/**
 * Migration 0031 and the subscription backfill (T-091, ADR-012 §5): each account gets the paid
 * plan of its businesses, conflicts are reported, workspace subscriptions are never changed.
 */
let pg: TestPostgres;
let owner: { db: Database; close: () => Promise<void> };
let system: { db: Database; close: () => Promise<void> };
let tenant: { db: Database; close: () => Promise<void> };

const user = newId();
const [accX, accY, accZ] = [newId(), newId(), newId()];
// X: B1 on Smart and B2 on Pro (two paid businesses). Y: B3 on Smart. Z: B4 free, B5 canceled.
const [b1, b2, b3, b4, b5] = [newId(), newId(), newId(), newId(), newId()];

const exec = (q: ReturnType<typeof sql>) => owner.db.execute(q);
const rows = async <T>(q: ReturnType<typeof sql>) => (await exec(q)) as unknown as T[];
const workspaceSubs = () =>
  rows(sql`select workspace_id, plan_code, status, current_period_end from subscriptions
    order by workspace_id`);

beforeAll(async () => {
  pg = await startTestPostgres();
  owner = createDb({ url: pg.ownerUrl, max: 1 });
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  system = createDb({
    url: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
    max: 1,
  });
  tenant = createDb({
    url: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
    max: 1,
  });
  await exec(sql`insert into users (id, email, name) values (${user}, 'lan@example.test', 'Lan')`);
  for (const acc of [accX, accY, accZ])
    await exec(
      sql`insert into accounts (id, name, created_by_user_id) values (${acc}, 'Lan', ${user})`,
    );
  for (const [ws, acc] of [
    [b1, accX],
    [b2, accX],
    [b3, accY],
    [b4, accZ],
    [b5, accZ],
  ] as const)
    await exec(sql`insert into workspaces (id, workspace_id, name, industry, owner_user_id, account_id)
      values (${ws}, ${ws}, 'Shop', 'retail', ${user}, ${acc})`);
  for (const [ws, plan, status, end] of [
    [b1, 'sales_smart', 'active', '2027-03-01T00:00:00Z'],
    [b2, 'sales_pro', 'active', '2026-12-01T00:00:00Z'],
    [b3, 'sales_smart', 'past_due', '2026-11-15T00:00:00Z'],
    [b4, 'free', 'active', null],
    [b5, 'sales_neo', 'canceled', '2026-09-01T00:00:00Z'],
  ] as const)
    await exec(sql`insert into subscriptions (workspace_id, plan_code, plan_version, status,
        current_period_start, current_period_end)
      values (${ws}, ${plan}, 1, ${status}, '2026-10-01T03:00:00Z', ${end})`);
});

afterAll(async () => {
  await tenant?.close();
  await system?.close();
  await owner?.close();
  await pg?.stop();
});

describe('account subscription backfill (0031)', () => {
  it('reports without writing in a dry run', async () => {
    const report = await backfillAccountSubscriptions(system.db, { dryRun: true });
    expect(report).toMatchObject({
      dryRun: true,
      paidWorkspaceSubscriptions: 3,
      accountsWithPaidBusinesses: 2,
      accountsLeftWithoutSubscription: 0,
    });
    expect(await rows(sql`select * from account_subscriptions`)).toEqual([]);
  });

  it('copies the most expensive paid plan to each account and reports the others', async () => {
    const before = await workspaceSubs();
    const report = await backfillAccountSubscriptions(system.db, { dryRun: false });
    expect(report.copied).toEqual(
      expect.arrayContaining([
        { accountId: accX, workspaceId: b2, planCode: 'sales_pro', planVersion: 1 },
        { accountId: accY, workspaceId: b3, planCode: 'sales_smart', planVersion: 1 },
      ]),
    );
    expect(report.copied).toHaveLength(2);
    expect(report.conflicts).toEqual([
      { accountId: accX, chosenWorkspaceId: b2, otherWorkspaceIds: [b1] },
    ]);
    expect(report.accountsLeftWithoutSubscription).toBe(0);
    const copied = await rows<Record<string, unknown>>(sql`
      select account_id, plan_code, status, cycle_anchor::text, source_workspace_id
      from account_subscriptions order by plan_code`);
    expect(copied).toEqual([
      {
        account_id: accX,
        plan_code: 'sales_pro',
        status: 'active',
        cycle_anchor: '2026-10-01 03:00:00+00',
        source_workspace_id: b2,
      },
      {
        account_id: accY,
        plan_code: 'sales_smart',
        status: 'past_due',
        cycle_anchor: '2026-10-01 03:00:00+00',
        source_workspace_id: b3,
      },
    ]);
    // Financial history: the workspace subscriptions are exactly as they were.
    expect(await workspaceSubs()).toEqual(before);
  });

  it('is idempotent and never overwrites an account subscription', async () => {
    await exec(
      sql`update account_subscriptions set plan_code = 'sales_neo' where account_id = ${accX}`,
    );
    const report = await backfillAccountSubscriptions(system.db, { dryRun: false });
    expect(report).toMatchObject({ copied: [], alreadyCopied: 2 });
    expect(
      await rows(sql`select plan_code from account_subscriptions where account_id = ${accX}`),
    ).toEqual([{ plan_code: 'sales_neo' }]);
  });

  it('keeps account billing and the message meter away from the tenant role', async () => {
    for (const table of ['account_subscriptions', 'account_entitlement_overrides', 'message_usage'])
      await expect(
        withTenant(tenant.db, workspaceId(b1), (tx) =>
          tx.execute(sql.raw(`select * from ${table}`)),
        ),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
  });

  it('keys the meter by business and outbound idempotency key', async () => {
    const insert = () =>
      exec(sql`insert into message_usage (account_id, workspace_id, idempotency_key, cycle_start, status)
        values (${accX}, ${b1}, 'bot:e1', '2026-10-01T03:00:00Z', 'reserved')`);
    await insert();
    await expect(insert()).rejects.toMatchObject({ cause: { code: '23505' } });
  });
});
