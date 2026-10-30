import { sql } from 'drizzle-orm';

import type { Database } from './client.js';
import { withSystem } from './tenant.js';

export interface AccountSubscriptionBackfillReport {
  dryRun: boolean;
  /** Paid workspace subscriptions (active, trialing or past due) of linked businesses, before. */
  paidWorkspaceSubscriptions: number;
  /** Accounts that own at least one of them. */
  accountsWithPaidBusinesses: number;
  /** Copied now: one subscription per account, from the chosen business. */
  copied: { accountId: string; workspaceId: string; planCode: string; planVersion: number }[];
  /** Accounts that already had an account subscription (never overwritten). */
  alreadyCopied: number;
  /** Several paid businesses: the others stay as they are, for an operator to settle by hand. */
  conflicts: { accountId: string; chosenWorkspaceId: string; otherWorkspaceIds: string[] }[];
  /** After: accounts with paid businesses and still no account subscription (expected 0). */
  accountsLeftWithoutSubscription: number;
}

class DryRunRollback extends Error {}

type Row = Record<string, unknown>;

/**
 * ADR-012 §5 / T-091: copies each account's paid workspace subscription to the account. With
 * several paid businesses, the most expensive plan wins (highest monthly price, then the latest
 * period end, an open-ended period counting as latest); the others are reported and left alone.
 * No money moves and workspace subscriptions are never changed, so financial history stays as
 * it was. Idempotent; `dryRun` runs the same work and rolls it back. Runs as app_system.
 */
export async function backfillAccountSubscriptions(
  db: Database,
  opts: { dryRun: boolean },
): Promise<AccountSubscriptionBackfillReport> {
  let report: AccountSubscriptionBackfillReport | undefined;
  try {
    await withSystem(db, async (tx) => {
      const rows = async (q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as Row[];
      const candidates = await rows(sql`
        select w.account_id, s.workspace_id, s.plan_code, s.plan_version,
          exists (select 1 from account_subscriptions a where a.account_id = w.account_id) as has_account_sub,
          row_number() over (
            partition by w.account_id
            order by (select coalesce(max(v::text::numeric), 0) from jsonb_each(p.price_by_period) as e(k, v)) desc,
                     s.current_period_end desc nulls first, s.workspace_id
          ) as rank
        from subscriptions s
        join workspaces w on w.id = s.workspace_id
        join plans p on p.code = s.plan_code and p.version = s.plan_version
        where w.account_id is not null and s.plan_code <> 'free'
          and s.status in ('active', 'trialing', 'past_due')
        order by w.account_id, rank`);

      const r: AccountSubscriptionBackfillReport = {
        dryRun: opts.dryRun,
        paidWorkspaceSubscriptions: candidates.length,
        accountsWithPaidBusinesses: new Set(candidates.map((c) => String(c['account_id']))).size,
        copied: [],
        alreadyCopied: 0,
        conflicts: [],
        accountsLeftWithoutSubscription: 0,
      };
      const byAccount = new Map<string, Row[]>();
      for (const c of candidates) {
        const list = byAccount.get(String(c['account_id'])) ?? [];
        list.push(c);
        byAccount.set(String(c['account_id']), list);
      }
      for (const [accountId, [chosen, ...others]] of byAccount) {
        if (!chosen) continue;
        if (others.length)
          r.conflicts.push({
            accountId,
            chosenWorkspaceId: String(chosen['workspace_id']),
            otherWorkspaceIds: others.map((o) => String(o['workspace_id'])),
          });
        if (chosen['has_account_sub']) {
          r.alreadyCopied++;
          continue;
        }
        const workspaceId = String(chosen['workspace_id']);
        await tx.execute(sql`
          insert into account_subscriptions (account_id, plan_code, plan_version, period_months,
            status, current_period_start, current_period_end, cycle_anchor, source_workspace_id)
          select ${accountId}::uuid, s.plan_code, s.plan_version, s.period_months, s.status,
            s.current_period_start, s.current_period_end, s.current_period_start, s.workspace_id
          from subscriptions s where s.workspace_id = ${workspaceId}::uuid
          on conflict (account_id) do nothing`);
        r.copied.push({
          accountId,
          workspaceId,
          planCode: String(chosen['plan_code']),
          planVersion: Number(chosen['plan_version']),
        });
      }
      const [left] = await rows(sql`
        select count(distinct w.account_id)::int as n
        from subscriptions s join workspaces w on w.id = s.workspace_id
        where w.account_id is not null and s.plan_code <> 'free'
          and s.status in ('active', 'trialing', 'past_due')
          and not exists (select 1 from account_subscriptions a where a.account_id = w.account_id)`);
      r.accountsLeftWithoutSubscription = Number(left?.['n'] ?? 0);

      report = r;
      if (opts.dryRun) throw new DryRunRollback();
    });
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
  }
  if (!report) throw new Error('account subscription backfill produced no report');
  return report;
}
