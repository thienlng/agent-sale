/* eslint-disable no-console -- CLI entrypoint */
import { createDb, eq, schema, sql, withSystem, writeAudit } from '@agent-sales/db';
import { workspaceId } from '@agent-sales/shared';

/**
 * `pnpm --filter @agent-sales/backend workspace-plan set <owner-email> <plan-code> [months]`
 * `pnpm --filter @agent-sales/backend workspace-plan show <owner-email>`
 *
 * The operator's way to put the workspaces a user owns on a plan until payment
 * approval exists (docs/08 §6, T-059). Uses DATABASE_SYSTEM_URL; the change is
 * audited in each workspace.
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
      .select({ id: schema.workspaces.id, name: schema.workspaces.name })
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
        console.log(
          `${w.name} (${w.id}): ${sub ? `${sub.planCode} v${sub.planVersion}, ${sub.status}` : 'free (no subscription)'}`,
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
      console.log(`${w.name}: now on ${plan.code} v${plan.version}`);
    }
  });
} finally {
  await close();
}
