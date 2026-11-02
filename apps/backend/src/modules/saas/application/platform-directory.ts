import { Inject, Injectable } from '@nestjs/common';

import { ACCOUNT_FACADE, type AccountFacade } from '../../account/api/index.js';
import { BILLING_ADMIN_FACADE, type BillingAdminFacade } from '../../billing/api/index.js';
import { IDENTITY_ADMIN_FACADE, type IdentityAdminFacade } from '../../identity/api/index.js';
import type { PlatformAccount, PlatformDirectory } from './ports/platform-directory.js';

/**
 * Monthly recurring revenue as billing computes it for `billing.subscription.changed.v1`: the
 * monthly price of the period (`price_by_period` is keyed by months and holds the monthly price)
 * while active or past due; 0 on trial, on the free plan and once it stopped paying.
 */
function mrr(
  prices: Readonly<Record<string, number>> | undefined,
  status: string,
  months: number | null,
): number {
  if (status !== 'active' && status !== 'past_due') return 0;
  const price = months === null ? undefined : prices?.[String(months)];
  return typeof price === 'number' && price > 0 ? price : 0;
}

/** Platform accounts for the HQ backfill and reconcile, through the platform admin facades. */
@Injectable()
export class FacadePlatformDirectory implements PlatformDirectory {
  constructor(
    @Inject(ACCOUNT_FACADE) private readonly accounts: AccountFacade,
    @Inject(BILLING_ADMIN_FACADE) private readonly billing: BillingAdminFacade,
    @Inject(IDENTITY_ADMIN_FACADE) private readonly identity: IdentityAdminFacade,
  ) {}

  async listAccounts(cursor: string | null, limit: number) {
    const page = await this.accounts.listForAdmin({ limit, cursor: cursor ?? undefined });
    const ids = page.data.map((a) => a.id);
    const ownerIds = page.data.flatMap((a) => (a.ownerUserId ? [a.ownerUserId] : []));
    const [subs, owners, plans] = await Promise.all([
      this.billing.subscriptionsOf(ids),
      this.identity.usersByIds(ownerIds),
      this.billing.listPlans(),
    ]);
    const ownerById = new Map(owners.map((u) => [u.id, u]));
    const priceOf = new Map(plans.map((p) => [`${p.code}@${p.version}`, p.priceByPeriod]));
    const data = page.data.map((a): PlatformAccount => {
      const owner = a.ownerUserId ? ownerById.get(a.ownerUserId) : undefined;
      const s = subs.get(a.id);
      return {
        accountId: a.id,
        ownerName: owner?.name ?? '',
        ownerEmail: owner?.email ?? '',
        ownerPhone: owner?.phone ?? null,
        status: a.status === 'suspended' ? 'suspended' : 'active',
        createdAt: a.createdAt.toISOString(),
        subscription: s
          ? {
              planCode: s.plan.code,
              planName: s.plan.name,
              periodMonths: s.periodMonths,
              status: s.status,
              periodStart: s.periodStart,
              periodEnd: s.periodEnd,
              mrrVnd: mrr(
                priceOf.get(`${s.plan.code}@${s.plan.version}`),
                s.status,
                s.periodMonths,
              ),
              since: s.periodStart,
            }
          : null,
      };
    });
    return { data, nextCursor: page.nextCursor };
  }
}
