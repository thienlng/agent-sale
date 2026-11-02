import { sql, withSystem, type Database } from '@agent-sales/db';

import type {
  PlatformAccount,
  PlatformDirectory,
} from '../application/ports/platform-directory.js';

type Row = {
  account_id: string;
  status: string;
  created_at: Date | string;
  owner_name: string;
  owner_email: string;
  owner_phone: string | null;
  plan_code: string | null;
  plan_name: string | null;
  period_months: number | null;
  sub_status: string | null;
  period_start: Date | string | null;
  period_end: Date | string | null;
  monthly_price: string | null;
  sub_updated_at: Date | string | null;
};

const iso = (v: Date | string | null) => (v === null ? null : new Date(v).toISOString());
const SUB_STATUSES = ['trialing', 'active', 'past_due', 'suspended', 'canceled'] as const;
type SubStatus = (typeof SUB_STATUSES)[number];

/**
 * Read-only `app_system` view of platform accounts for the HQ backfill and reconcile. A documented,
 * temporary exception to "never query another module's tables" (see `PlatformDirectory`): it only
 * selects, and goes away when the account and billing admin facades exist.
 *
 * MRR follows billing's catalog: `plans.price_by_period` is keyed by period months and holds the
 * monthly price for that commitment (the seeded catalog, migration 0015), so MRR is that value for
 * paying states and 0 otherwise.
 */
export class DrizzlePlatformDirectory implements PlatformDirectory {
  constructor(private readonly systemDb: Database) {}

  listAccounts(afterId: string | null, limit: number): Promise<PlatformAccount[]> {
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx.execute<Row>(sql`
        select a.id as account_id, a.status, a.created_at,
               u.name as owner_name, u.email as owner_email, u.phone as owner_phone,
               s.plan_code, p.name as plan_name, s.period_months, s.status as sub_status,
               s.current_period_start as period_start, s.current_period_end as period_end,
               p.price_by_period ->> s.period_months::text as monthly_price,
               s.updated_at as sub_updated_at
        from accounts a
        join users u on u.id = coalesce(
          (select m.user_id from account_members m
            where m.account_id = a.id and m.role = 'owner' and m.removed_at is null
            order by m.created_at limit 1),
          a.created_by_user_id)
        left join account_subscriptions s on s.account_id = a.id
        left join plans p on p.code = s.plan_code and p.version = s.plan_version
        where ${afterId === null ? sql`true` : sql`a.id > ${afterId}::uuid`}
        order by a.id
        limit ${limit}`);
      return rows.map((r): PlatformAccount => {
        const status = (SUB_STATUSES as readonly string[]).includes(r.sub_status ?? '')
          ? (r.sub_status as SubStatus)
          : 'active';
        const paying = status === 'active' || status === 'past_due';
        return {
          accountId: r.account_id,
          ownerName: r.owner_name,
          ownerEmail: r.owner_email,
          ownerPhone: r.owner_phone,
          status: r.status === 'suspended' ? 'suspended' : 'active',
          createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
          subscription: r.plan_code
            ? {
                planCode: r.plan_code,
                planName: r.plan_name ?? r.plan_code,
                periodMonths: r.period_months,
                status,
                periodStart: iso(r.period_start),
                periodEnd: iso(r.period_end),
                mrrVnd:
                  paying && r.monthly_price ? Math.max(0, Math.round(Number(r.monthly_price))) : 0,
                updatedAt: iso(r.sub_updated_at) ?? new Date(0).toISOString(),
              }
            : null,
        };
      });
    });
  }
}
