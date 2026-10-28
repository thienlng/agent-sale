import { type CreateWorkspaceRequest, WorkspaceDto } from '@agent-sales/contracts';
import { useMutation } from '@tanstack/react-query';

import { api } from '@/lib/api-client';

/** Creates a business under one of the user's accounts; the caller then switches to it. */
export function useCreateBusiness() {
  return useMutation({
    mutationFn: (body: CreateWorkspaceRequest) =>
      api('/workspaces', WorkspaceDto, { method: 'POST', body, workspaceScoped: false }),
  });
}
