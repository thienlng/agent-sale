import { useSession } from '@/lib/session';

/** The name of one of the user's businesses, or null when it is not theirs (any more). */
export function useBusinessName(businessId: string): string | null {
  const session = useSession();
  return session?.memberships.find((m) => m.workspaceId === businessId)?.workspaceName ?? null;
}

/**
 * The businesses of the current business's account, for a schedule's business picker. The
 * server checks the owner is an active member of the one chosen.
 */
export function useAccountBusinesses(): { id: string; name: string }[] {
  const session = useSession();
  const accountId = session?.memberships.find(
    (m) => m.workspaceId === session.workspaceId,
  )?.accountId;
  return (session?.memberships ?? [])
    .filter((m) => accountId && m.accountId === accountId)
    .map((m) => ({ id: m.workspaceId, name: m.workspaceName }));
}
