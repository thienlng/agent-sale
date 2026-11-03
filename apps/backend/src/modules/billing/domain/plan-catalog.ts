import { PlanCodeInUseError, PlanRuleError } from './billing.errors.js';
import { FREE_PLAN } from './entitlements.js';

/** A plan version as the catalog editor sees it (migration 0053, ADR-021 §6). */
export interface CatalogPlan {
  code: string;
  version: number;
  name: string;
  description: string;
  isPublic: boolean;
  sortOrder: number;
  archivedAt: Date | null;
  /**
   * Monthly price in VND when the customer pays for N months, keyed by N (`"1"`, `"3"`, `"6"`,
   * `"12"`). Longer commitments are cheaper per month (seed 0015). A payment is price × months.
   */
  priceByPeriod: Record<string, number>;
  entitlements: Record<string, unknown>;
  createdAt: Date;
}

export interface PlanBody {
  name: string;
  description: string;
  isPublic: boolean;
  sortOrder: number;
  priceByPeriod: Record<string, number>;
  entitlements: Record<string, unknown>;
}

/** The free plan is the fallback of every account (no subscription, after a trial, after suspension). */
export function assertPlanBody(code: string, body: PlanBody): void {
  if (code === FREE_PLAN.code && Object.keys(body.priceByPeriod).length > 0) {
    throw new PlanRuleError('The free plan has no prices');
  }
  if (code === FREE_PLAN.code && !body.isPublic) {
    throw new PlanRuleError('The free plan stays public');
  }
}

/**
 * Archiving hides a plan from new sales. The free plan and the plans the billing settings point
 * to (trial, after-trial) cannot be archived: new accounts would land on a hidden plan.
 */
export function assertArchivable(
  code: string,
  settings: { trialPlanCode: string | null; afterTrialPlanCode: string },
): void {
  if (code === FREE_PLAN.code) throw new PlanCodeInUseError(code, 'the free plan');
  if (code === settings.trialPlanCode) throw new PlanCodeInUseError(code, 'the trial plan');
  if (code === settings.afterTrialPlanCode) {
    throw new PlanCodeInUseError(code, 'the plan after the trial');
  }
}

/** Monthly price for a period, or null when the plan does not sell that period. */
export function monthlyPrice(plan: Pick<CatalogPlan, 'priceByPeriod'>, months: number | null) {
  if (months === null) return null;
  const price = plan.priceByPeriod[String(months)];
  return typeof price === 'number' && price > 0 ? price : null;
}

/**
 * Monthly recurring revenue of a subscription in VND: the monthly price of its period; 0 on trial,
 * on the free plan, without a period, and once it stopped paying (suspended, canceled).
 */
export function mrrVnd(
  plan: Pick<CatalogPlan, 'priceByPeriod'>,
  sub: { status: string; periodMonths: number | null },
): number {
  if (sub.status !== 'active' && sub.status !== 'past_due') return 0;
  return monthlyPrice(plan, sub.periodMonths) ?? 0;
}

/** Calendar months, clamped to the last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

export const DAY_MS = 86_400_000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}
