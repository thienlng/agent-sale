import { type MfaReauthRequest, MfaSetup, MfaStatus, RecoveryCodes } from '@agent-sales/contracts';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

const account = { workspaceScoped: false } as const;

export function useMfaStatus() {
  return useQuery({
    queryKey: queryKeys.mfa,
    queryFn: () => api('/auth/mfa', MfaStatus, account),
  });
}

/** The status changes with every step, so each success refetches it. */
export function useMfaMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.mfa });
  return {
    setup: useMutation({
      mutationFn: (password: string) =>
        api('/auth/mfa/setup', MfaSetup, { ...account, method: 'POST', body: { password } }),
    }),
    enable: useMutation({
      mutationFn: (code: string) =>
        api('/auth/mfa/enable', RecoveryCodes, { ...account, method: 'POST', body: { code } }),
      onSuccess: refresh,
    }),
    disable: useMutation({
      mutationFn: (body: MfaReauthRequest) =>
        api('/auth/mfa/disable', z.null(), { ...account, method: 'POST', body }),
      onSuccess: refresh,
    }),
    regenerate: useMutation({
      mutationFn: (body: MfaReauthRequest) =>
        api('/auth/mfa/recovery-codes', RecoveryCodes, { ...account, method: 'POST', body }),
      onSuccess: refresh,
    }),
  };
}
