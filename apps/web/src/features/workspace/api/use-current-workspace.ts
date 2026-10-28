import { WorkspaceDto } from '@agent-sales/contracts';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';

export const workspaceKeys = {
  current: (workspaceId: string) => ['ws', workspaceId, 'workspace'] as const,
};

/** Feature hook: data access for the workspace feature lives in features/<module>/api. */
export function useCurrentWorkspace() {
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: workspaceKeys.current(workspaceId),
    queryFn: ({ signal }) => api('/workspaces/current', WorkspaceDto, { workspaceId, signal }),
    enabled: Boolean(workspaceId),
  });
}
