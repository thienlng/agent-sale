/* eslint-disable no-console -- CLI entrypoint */
import { createDb, eq, schema, sql, withSystem } from '@agent-sales/db';

import { DrizzleBillingAdminStore } from '../modules/billing/infrastructure/persistence/billing-admin.drizzle-store.js';
import { addMonths } from '../modules/billing/domain/plan-catalog.js';

/**
 * `pnpm --filter @agent-sales/backend workspace-plan set <owner-email> <plan-code> [months]`
 * `pnpm --filter @agent-sales/backend workspace-plan show <owner-email>`
 *
 * Scripted twin of "set plan" in /admin (ADR-021 §6): puts the accounts of the workspaces a user
 * owns on the latest version of a plan. Uses DATABASE_SYSTEM_URL and the same write path as the
 * admin (event `billing.subscription.changed.v1` with reason `cli`, platform audit, `billing.plan_set`
 * audit in each business). The account's subscription is what entitlements and the AI-message
 * allowance use (T-091).
 */
const [action, email, planCode, months] = process.argv.slice(2);
const url = process.env['DATABASE_SYSTEM_URL'];
if ((action !== 'set' && action !== 'show') || !email || (action === 'set' && !planCode) || !url) {
  console.error(
    'usage: workspace-plan set <owner-email> <plan-code> [months] | show <owner-email>   (needs DATABASE_SYSTEM_URL)',
  );
  process.exit(1);
}

const { db, close } = createDb({ url, max: 1 });
const accountsSet = new Set<string>();
try {
  await withSystem(db, async (tx) => {
    const owned = await tx
      .select({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        accountId: schema.workspaces.accountId,
      })
      .from(schema.workspaces)
      .innerJoin(schema.users, eq(schema.users.id, schema.workspaces.ownerUserId))
      .where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`);
    if (!owned.length) {
      console.error(`no workspace owned by ${email}`);
      process.exitCode = 1;
      return;
    }
    for (const w of owned) {
      if (action === 'show') {
        const [sub] = await tx
          .select()
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.workspaceId, w.id));
        const [account] = w.accountId
          ? await tx
              .select()
              .from(schema.accountSubscriptions)
              .where(eq(schema.accountSubscriptions.accountId, w.accountId))
          : [];
        console.log(
          `${w.name} (${w.id}): ${sub ? `${sub.planCode} v${sub.planVersion}, ${sub.status}` : 'free (no subscription)'}` +
            (account
              ? `; account ${w.accountId}: ${account.planCode} v${account.planVersion}, ${account.status} (in effect)`
              : ''),
        );
        continue;
      }
      if (!w.accountId) {
        console.error(`${w.name}: no account yet, run account-backfill first`);
        process.exitCode = 1;
        continue;
      }
      accountsSet.add(w.accountId);
    }
  });
  if (action === 'set' && process.exitCode !== 1) {
    const admin = new DrizzleBillingAdminStore(db);
    const plan = await admin.latestPlan(planCode as string);
    const period = months ? Number(months) : null;
    if (!plan) {
      console.error(`unknown plan ${planCode}`);
      process.exitCode = 1;
    } else if (period !== null && ![1, 3, 6, 12].includes(period)) {
      console.error('months must be 1, 3, 6 or 12');
      process.exitCode = 1;
    } else {
      // The same write path as /admin: the subscription event, the platform audit and the
      // `billing.plan_set` audit in every business of the account.
      for (const accountId of accountsSet) {
        const now = new Date();
        await admin.changeSubscription({
          accountId,
          expectedVersion: 'any',
          next: () => ({
            planCode: plan.code,
            planVersion: plan.version,
            periodMonths: period,
            status: 'active',
            currentPeriodStart: now,
            currentPeriodEnd: period ? addMonths(now, period) : null,
            cycleAnchor: now,
          }),
          reason: 'cli',
          action: { actorUserId: null, actorName: 'operator (CLI)', reason: 'workspace-plan CLI' },
          auditAction: 'billing.subscription.set',
        });
        console.log(`account ${accountId}: now on ${plan.code} v${plan.version}`);
      }
    }
  }
} finally {
  await close();
}
