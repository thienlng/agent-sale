import { SAAS_PERIOD_MONTHS, type SaasBillingPeriod, type SaasStage } from '@agent-sales/contracts';

/** Usage at or above this share of the allowance flags an upsell (spec §5.5 S4). */
export const UPSELL_RATIO = 0.8;

export interface Usage {
  used: number;
  limit: number;
  at: string;
}

export function isUpsell(usage: Usage | null): boolean {
  return !!usage && usage.limit > 0 && usage.used >= usage.limit * UPSELL_RATIO;
}

/**
 * MRR of a catalog plan for a billing period: the period price spread over its months, rounded to
 * whole VND. Null when the plan has no price for that period.
 */
export function planMrr(
  prices: Readonly<Record<string, number>>,
  period: SaasBillingPeriod,
): number | null {
  const price = prices[period];
  return price === undefined ? null : Math.round(price / SAAS_PERIOD_MONTHS[period]);
}

/** The facts a history row records; a change of any of them adds a row (spec §6.2). */
export interface HistoryFacts {
  stage: SaasStage;
  planName: string;
  mrr: number;
}

export function historyChanged(before: HistoryFacts | null, after: HistoryFacts): boolean {
  return (
    !before ||
    before.stage !== after.stage ||
    before.planName !== after.planName ||
    before.mrr !== after.mrr
  );
}

/** Calendar days from `from` to `to` (yyyy-mm-dd). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
