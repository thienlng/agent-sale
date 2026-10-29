import { type UpdateWorkspaceProfileRequest, WorkspaceProfileDto } from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, apiBlob } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { reloadSession } from '@/lib/session';
import { useWorkspaceId } from '@/lib/use-workspace';

import { workspaceKeys } from './use-current-workspace';

export function useProfile() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.profile(ws),
    queryFn: () => api('/workspace/profile', WorkspaceProfileDto),
    enabled: Boolean(ws),
  });
}

/** Edits and logo changes; the answer is the new profile, so the cache is set from it. */
export function useProfileMutations() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const set = (p: WorkspaceProfileDto) => qc.setQueryData(queryKeys.profile(ws), p);
  return {
    update: useMutation({
      mutationFn: (body: UpdateWorkspaceProfileRequest) =>
        api('/workspace/profile', WorkspaceProfileDto, { method: 'PATCH', body }),
      onSuccess: (p) => {
        set(p);
        // The name is shown by the business selector (session memberships) and the current
        // business query; refresh both so no label keeps the old name.
        void qc.invalidateQueries({ queryKey: workspaceKeys.current(ws) });
        void reloadSession().catch(() => undefined);
      },
      // A stale save: load what is there now so the user can redo the edit on top of it.
      onError: () => void qc.invalidateQueries({ queryKey: queryKeys.profile(ws) }),
    }),
    uploadLogo: useMutation({
      mutationFn: (file: File) =>
        api('/workspace/logo', WorkspaceProfileDto, {
          method: 'PUT',
          raw: { data: file, contentType: file.type },
        }),
      onSuccess: set,
    }),
    removeLogo: useMutation({
      mutationFn: () => api('/workspace/logo', WorkspaceProfileDto, { method: 'DELETE' }),
      onSuccess: set,
    }),
  };
}

/** An object URL of the logo (the route needs the access token), refreshed when it changes. */
export function useLogoUrl(logoVersion: string | null) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.logo(ws, logoVersion),
    queryFn: async () => {
      const blob = await apiBlob('/workspace/logo');
      return blob ? URL.createObjectURL(blob) : null;
    },
    enabled: Boolean(ws) && logoVersion !== null,
    staleTime: Infinity,
    gcTime: 60_000,
  });
}
