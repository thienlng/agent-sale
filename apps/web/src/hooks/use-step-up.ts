import { type StepUpRequest, StepUpStatus } from '@agent-sales/contracts';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

const account = { workspaceScoped: false } as const;

/**
 * The current session's step-up state (docs/09 §2): which proofs the user can give, whether one
 * was given recently enough for sensitive actions, and whether the session passed two-factor.
 */
export function useStepUpStatus(enabled = true) {
  return useQuery({
    queryKey: queryKeys.stepUp,
    queryFn: () => api('/auth/reauth', StepUpStatus, account),
    enabled,
    staleTime: 0,
  });
}

/** Confirm it is you (password, two-factor or emailed code); refreshes the cached state. */
export function useStepUp() {
  const qc = useQueryClient();
  return {
    verify: useMutation({
      mutationFn: (body: StepUpRequest) =>
        api('/auth/reauth', StepUpStatus, { ...account, method: 'POST', body }),
      onSuccess: (status) => qc.setQueryData(queryKeys.stepUp, status),
    }),
    sendCode: useMutation({
      mutationFn: () => api('/auth/reauth/code', z.null(), { ...account, method: 'POST' }),
    }),
  };
}
