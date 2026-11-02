import {
  type EntitlementKey,
  type EntitlementKind,
  ENTITLEMENT_KEYS,
  PlanEntitlements,
} from '@agent-sales/contracts';

export const ENTITLEMENT_ENTRIES = Object.entries(ENTITLEMENT_KEYS) as Array<
  [EntitlementKey, EntitlementKind]
>;

/** The empty value of each kind: what a new plan starts from. */
export function emptyValue(kind: EntitlementKind): unknown {
  switch (kind) {
    case 'limit':
      return 0;
    case 'flag':
      return false;
    case 'models':
      return ['smart'];
    case 'allowance':
      return { amount: 0, periodDays: 30 };
  }
}

/** Every key of the catalog, filled from a stored plan (keys it lacks start empty). */
export function completeEntitlements(
  stored: Record<string, unknown> = {},
): Record<string, unknown> {
  return Object.fromEntries(
    ENTITLEMENT_ENTRIES.map(([key, kind]) => [key, key in stored ? stored[key] : emptyValue(kind)]),
  );
}

/** Keys whose value is not valid, so the editor can mark them. */
export function invalidEntitlementKeys(value: Record<string, unknown>): Set<string> {
  const parsed = PlanEntitlements.safeParse(value);
  if (parsed.success) return new Set();
  return new Set(parsed.error.issues.map((i) => String(i.path[0])));
}

/** A short "5 · 20 · 20.000" style summary of the limits that matter most in a table. */
export const SUMMARY_KEYS: readonly EntitlementKey[] = [
  'members.max',
  'channels.max',
  'contacts.max',
  'ai.included_messages',
];
