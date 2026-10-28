import { newId } from '@agent-sales/shared';
import { sql } from 'drizzle-orm';

import type { Database } from './client.js';
import { withSystem } from './tenant.js';

export interface AccountBackfillReport {
  dryRun: boolean;
  accountsCreated: number;
  workspacesLinked: number;
  /** Never guessed: left without an account until an operator fixes them. */
  workspacesSkipped: {
    workspaceId: string;
    reason: 'owner_not_active_member' | 'owner_has_several_accounts';
  }[];
  /** Channels bound to a missing, deleted or other workspace's bot: unbound, never re-pointed. */
  channelsUnbound: { workspaceId: string; channelId: string; botId: string }[];
  conversationsAttributed: number;
  /** Past facts get the channel's current bot: an approximation for pages already rebound. */
  factsAttributed: { workspaceId: string; facts: number }[];
  /** Accounts owning several businesses with a paid subscription: T-091 resolves them by hand. */
  subscriptionConflicts: { accountId: string; workspaceIds: string[] }[];
}

class DryRunRollback extends Error {}

type Row = Record<string, unknown>;

/**
 * ADR-012 §8 step 2: gives every workspace an account and attributes conversations and facts
 * to bots. Idempotent: rows that already have a value are left alone, so it can run again
 * after an operator fixed what the previous report listed. With `dryRun` the same work runs
 * in a transaction that is rolled back, so the report is exact. Runs as app_system.
 */
export async function backfillAccounts(
  db: Database,
  opts: { dryRun: boolean },
): Promise<AccountBackfillReport> {
  let report: AccountBackfillReport | undefined;
  try {
    await withSystem(db, async (tx) => {
      const rows = async (q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as Row[];
      const r: AccountBackfillReport = {
        dryRun: opts.dryRun,
        accountsCreated: 0,
        workspacesLinked: 0,
        workspacesSkipped: [],
        channelsUnbound: [],
        conversationsAttributed: 0,
        factsAttributed: [],
        subscriptionConflicts: [],
      };

      // 1. One account per owner user. The owner must still be the active owner member.
      const pending = await rows(sql`
        select w.id, w.owner_user_id, u.name as owner_name,
          exists (select 1 from members m where m.workspace_id = w.id and m.user_id = w.owner_user_id
                  and m.role = 'owner' and m.status = 'active') as owner_active
        from workspaces w join users u on u.id = w.owner_user_id
        where w.account_id is null
        order by w.created_at, w.id`);
      const accountOf = new Map<string, string | null>();
      for (const w of pending) {
        const workspace = String(w['id']);
        const owner = String(w['owner_user_id']);
        if (!w['owner_active']) {
          r.workspacesSkipped.push({ workspaceId: workspace, reason: 'owner_not_active_member' });
          continue;
        }
        if (!accountOf.has(owner)) {
          const owned = await rows(sql`
            select account_id from account_members
            where user_id = ${owner} and role = 'owner' and status = 'active'`);
          if (owned.length > 1) accountOf.set(owner, null);
          else if (owned.length === 1) accountOf.set(owner, String(owned[0]?.['account_id']));
          else {
            const id = newId();
            await tx.execute(sql`
              insert into accounts (id, name, created_by_user_id)
              values (${id}, ${String(w['owner_name'])}, ${owner})`);
            await tx.execute(sql`
              insert into account_members (account_id, user_id, role) values (${id}, ${owner}, 'owner')`);
            r.accountsCreated += 1;
            accountOf.set(owner, id);
          }
        }
        const account = accountOf.get(owner);
        if (!account) {
          r.workspacesSkipped.push({
            workspaceId: workspace,
            reason: 'owner_has_several_accounts',
          });
          continue;
        }
        await tx.execute(
          sql`update workspaces set account_id = ${account} where id = ${workspace}`,
        );
        r.workspacesLinked += 1;
      }

      // 2. Channels whose bot is missing, deleted or of another workspace lose the binding.
      const broken = await rows(sql`
        select c.workspace_id, c.id, c.bot_id from channel_connections c
        where c.bot_id is not null
          and not exists (select 1 from bots b where b.workspace_id = c.workspace_id
                          and b.id = c.bot_id and b.deleted_at is null)
        order by c.workspace_id, c.id`);
      for (const c of broken) {
        await tx.execute(
          sql`update channel_connections set bot_id = null where id = ${String(c['id'])}`,
        );
        r.channelsUnbound.push({
          workspaceId: String(c['workspace_id']),
          channelId: String(c['id']),
          botId: String(c['bot_id']),
        });
      }

      // 3. Attribution from the channel's current bot (channels are consistent after step 2).
      const conv = await rows(sql`
        update conversations v set bot_id = c.bot_id
        from channel_connections c
        where v.bot_id is null and c.id = v.channel_id and c.workspace_id = v.workspace_id
          and c.bot_id is not null
        returning v.id`);
      r.conversationsAttributed = conv.length;
      const facts = await rows(sql`
        with done as (
          update analytics_facts f set bot_id = c.bot_id
          from channel_connections c
          where f.bot_id is null and f.channel_id is not null and c.id = f.channel_id
            and c.workspace_id = f.workspace_id and c.bot_id is not null
          returning f.workspace_id)
        select workspace_id, count(*)::int as n from done group by workspace_id order by workspace_id`);
      r.factsAttributed = facts.map((f) => ({
        workspaceId: String(f['workspace_id']),
        facts: Number(f['n']),
      }));

      // 4. Several paid businesses under one account: reported for T-091, no money changes.
      const conflicts = await rows(sql`
        select w.account_id, array_agg(w.id::text order by w.id) as workspace_ids
        from subscriptions s join workspaces w on w.id = s.workspace_id
        where w.account_id is not null and s.status = 'active' and s.plan_code <> 'free'
        group by w.account_id having count(*) > 1
        order by w.account_id`);
      r.subscriptionConflicts = conflicts.map((c) => ({
        accountId: String(c['account_id']),
        workspaceIds: c['workspace_ids'] as string[],
      }));

      report = r;
      if (opts.dryRun) throw new DryRunRollback();
    });
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
  }
  if (!report) throw new Error('account backfill produced no report');
  return report;
}
