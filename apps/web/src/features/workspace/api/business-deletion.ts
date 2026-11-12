import { DeletedBusinessDto, DeletedBusinessList, WorkspaceDto } from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * Business deletion (SET-10, ADR-033). Not workspace-scoped: a deleted business no longer passes
 * the workspace guard, so the routes name it in the path and the server checks the owner.
 */
export function useDeletedBusinesses() {
  return useQuery({
    queryKey: queryKeys.deletedBusinesses(),
    queryFn: () => api('/workspaces/deleted', DeletedBusinessList, { workspaceScoped: false }),
  });
}

export function useDeleteBusiness() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { workspaceId: string; confirmName: string }) =>
      api(`/workspaces/${encodeURIComponent(input.workspaceId)}/deletion`, DeletedBusinessDto, {
        method: 'POST',
        body: { confirmName: input.confirmName },
        workspaceScoped: false,
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.deletedBusinesses() }),
  });
}

export function useRestoreBusiness() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId: string) =>
      api(`/workspaces/${encodeURIComponent(workspaceId)}/restore`, WorkspaceDto, {
        method: 'POST',
        workspaceScoped: false,
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.deletedBusinesses() }),
  });
}
