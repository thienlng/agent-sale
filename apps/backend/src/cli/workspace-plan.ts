/* eslint-disable no-console -- CLI entrypoint */
import { createDb, eq, schema, sql, withSystem, writeAudit } from '@agent-sales/db';
import { workspaceId } from '@agent-sales/shared';

/**
 * `pnpm --filter @agent-sales/backend workspace-plan set <owner-email> <plan-code> [months]`
 * `pnpm --filter @agent-sales/backend workspace-plan show <owner-email>`
 *
 * The operator's way to put the workspaces a user owns on a plan until payment
 * approval exists (docs/08 §6, T-059). Uses DATABASE_SYSTEM_URL; the change is
 * audited in each workspace. A business under an account also puts its account on the plan:
 * the account's subscription is what entitlements and the AI-message allowance use (T-091).
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
    const accountsSet = new Set<string>();
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
      const [plan] = await tx
        .select()
        .from(schema.plans)
        .where(eq(schema.plans.code, planCode as string))
        .orderBy(sql`${schema.plans.version} desc`)
        .limit(1);
      if (!plan) {
        console.error(`unknown plan ${planCode}`);
        process.exitCode = 1;
        return;
      }
      const period = months ? Number(months) : null;
      if (period !== null && ![1, 3, 6, 12].includes(period)) {
        console.error('months must be 1, 3, 6 or 12');
        process.exitCode = 1;
        return;
      }
      const end = period ? new Date(new Date().setMonth(new Date().getMonth() + period)) : null;
      await tx
        .insert(schema.subscriptions)
        .values({
          workspaceId: w.id,
          planCode: plan.code,
          planVersion: plan.version,
          periodMonths: period,
          currentPeriodEnd: end,
        })
        .onConflictDoUpdate({
          target: schema.subscriptions.workspaceId,
          set: {
            planCode: plan.code,
            planVersion: plan.version,
            periodMonths: period,
            status: 'active',
            currentPeriodStart: new Date(),
            currentPeriodEnd: end,
            version: sql`${schema.subscriptions.version} + 1`,
            updatedAt: new Date(),
          },
        });
      await writeAudit(tx, {
        workspaceId: workspaceId(w.id),
        actorUserId: null,
        actorName: 'operator (CLI)',
        action: 'billing.plan_set',
        targetType: 'subscription',
        targetId: w.id,
        data: { plan: plan.code, months: period },
      });
      if (w.accountId && !accountsSet.has(w.accountId)) {
        accountsSet.add(w.accountId);
        const now = new Date();
        await tx
          .insert(schema.accountSubscriptions)
          .values({
            accountId: w.accountId,
            planCode: plan.code,
            planVersion: plan.version,
            periodMonths: period,
            currentPeriodStart: now,
            currentPeriodEnd: end,
            cycleAnchor: now,
            sourceWorkspaceId: w.id,
          })
          .onConflictDoUpdate({
            target: schema.accountSubscriptions.accountId,
            set: {
              planCode: plan.code,
              planVersion: plan.version,
              periodMonths: period,
              status: 'active',
              currentPeriodStart: now,
              currentPeriodEnd: end,
              cycleAnchor: now,
              version: sql`${schema.accountSubscriptions.version} + 1`,
              updatedAt: now,
            },
          });
        console.log(`account ${w.accountId}: now on ${plan.code} v${plan.version}`);
      }
      console.log(`${w.name}: now on ${plan.code} v${plan.version}`);
    }
  });
} finally {
  await close();
}
