import { useSession } from './session';

/** The workspace the dashboard acts on. Routes under /app only render with a session. */
export function useWorkspaceId(): string {
  return useSession()?.workspaceId ?? '';
}
