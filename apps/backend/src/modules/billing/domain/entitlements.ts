import type { EntitlementsDto } from '@agent-sales/contracts';

/** A plan version as stored: entitlement key → value (see migration 0015). */
export interface PlanRecord {
  code: string;
  version: number;
  name: string;
  entitlements: Record<string, unknown>;
}

export interface SubscriptionRecord {
  planCode: string;
  planVersion: number;
  status: EntitlementsDto['status'];
  currentPeriodEnd: Date | null;
}

export interface OverrideRecord {
  key: string;
  value: unknown;
  expiresAt: Date | null;
}

/** What a workspace without a subscription row gets (the free plan, version 1). */
export const FREE_PLAN = { code: 'free', version: 1 } as const;

const isLimitKey = (key: string) => key.endsWith('.max') || key.endsWith('.bytes');

/**
 * Effective entitlements = plan values, replaced key by key by overrides that
 * have not expired. Limits: a number, `null` for unlimited. Anything the plan
 * does not define is 0 / off.
 */
export function resolveEntitlements(
  plan: PlanRecord,
  subscription: SubscriptionRecord | null,
  overrides: readonly OverrideRecord[],
  now: Date = new Date(),
): EntitlementsDto {
  const values: Record<string, unknown> = { ...plan.entitlements };
  for (const o of overrides) {
    if (!o.expiresAt || o.expiresAt.getTime() > now.getTime()) values[o.key] = o.value;
  }
  const limits: Record<string, number | null> = {};
  const features: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(values)) {
    if (isLimitKey(key) && (value === null || typeof value === 'number')) {
      limits[key] = value === null ? null : Math.max(0, Math.trunc(value));
    } else if (key.startsWith('feature.')) {
      features[key] = value === true;
    }
  }
  const models = values['ai.models.allowed'];
  const included = values['ai.included_messages'] as
    { amount?: unknown; periodDays?: unknown } | undefined;
  return {
    plan: { code: plan.code, name: plan.name, version: plan.version },
    status: subscription?.status ?? 'active',
    periodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
    limits,
    features,
    aiModels: Array.isArray(models) ? models.filter((m): m is string => typeof m === 'string') : [],
    aiIncludedMessages:
      included && typeof included.amount === 'number' && typeof included.periodDays === 'number'
        ? { amount: included.amount, periodDays: included.periodDays }
        : null,
  };
}

/** `null` = unlimited; a key that is not a defined limit is 0. */
export function limitOf(e: EntitlementsDto, key: string): number | null {
  return key in e.limits ? (e.limits[key] ?? null) : 0;
}
