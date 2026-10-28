import type { MembershipDto } from '@agent-sales/contracts';

export interface BusinessGroup {
  /** Null for businesses not yet placed under an account (before the backfill). */
  accountId: string | null;
  accountName: string | null;
  businesses: MembershipDto[];
}

/**
 * Businesses grouped by the account that owns them (ADR-012), in first-seen order, so the
 * picker and the avatar menu show the same structure. A member sees the owner's account name.
 */
export function groupByAccount(memberships: readonly MembershipDto[]): BusinessGroup[] {
  const groups = new Map<string | null, BusinessGroup>();
  for (const m of memberships) {
    const group = groups.get(m.accountId) ?? {
      accountId: m.accountId,
      accountName: m.accountName,
      businesses: [],
    };
    group.businesses.push(m);
    groups.set(m.accountId, group);
  }
  return [...groups.values()];
}
