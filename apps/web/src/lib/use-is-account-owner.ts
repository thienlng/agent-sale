import { useSession } from '@/lib/session';

/**
 * Whether the user owns the account that owns the current business (ADR-023): only they may
 * use the owner assistant. The server refuses everyone else; the bubble is simply not shown.
 */
export function useIsAccountOwner(): boolean {
  const session = useSession();
  if (!session?.workspaceId) return false;
  const accountId = session.memberships.find(
    (m) => m.workspaceId === session.workspaceId,
  )?.accountId;
  if (!accountId) return false;
  return session.accounts.some((a) => a.accountId === accountId && a.role === 'owner');
}
