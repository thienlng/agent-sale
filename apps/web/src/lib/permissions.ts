import { type Capability, roleCan } from '@agent-sales/contracts';

import { useSession } from './session';

/** The signed-in member's role in the current workspace. */
export function useRole(): string | undefined {
  const session = useSession();
  return session?.memberships.find((m) => m.workspaceId === session.workspaceId)?.role;
}

/**
 * Whether the member's role allows an action (same table as the server,
 * `ROLE_CAPABILITIES`). The UI hides what the server would refuse anyway.
 */
export function useCan(capability: Capability): boolean {
  return roleCan(useRole(), capability);
}
