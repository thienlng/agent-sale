import {
  ContactSaasSubscription,
  type CreateSaasRequest,
  type PutSaasSubscription,
  SaasRequestDto,
  SaasRequestList,
  type SaasRequestStatus,
  SaasSubscriptionDto,
  SaasSubscriptionList,
  type SaasStage,
  SaasSummary,
  type UpdateSaasRequest,
} from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';

const query = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) s.set(k, String(v));
  return s.toString();
};

export function useSaasRequests(filter: { status?: SaasRequestStatus; offset: number }) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['ws', ws, 'saas-requests', filter],
    queryFn: ({ signal }) =>
      api(`/saas-requests?${query(filter)}`, SaasRequestList, { workspaceId: ws, signal }),
    enabled: Boolean(ws),
  });
}

/** Requests, subscriptions and the summary move together (a new request bumps the count). */
function useInvalidateSaas() {
  const ws = useWorkspaceId(),
    qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['ws', ws, 'saas-requests'] }),
      qc.invalidateQueries({ queryKey: ['ws', ws, 'saas-subscriptions'] }),
    ]);
}

export function useCreateSaasRequest() {
  const ws = useWorkspaceId(),
    invalidate = useInvalidateSaas();
  return useMutation({
    mutationFn: (body: CreateSaasRequest) =>
      api('/saas-requests', SaasRequestDto, { method: 'POST', body, workspaceId: ws }),
    onSuccess: invalidate,
  });
}

export function useUpdateSaasRequest() {
  const ws = useWorkspaceId(),
    invalidate = useInvalidateSaas();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateSaasRequest }) =>
      api(`/saas-requests/${id}`, SaasRequestDto, { method: 'PATCH', body, workspaceId: ws }),
    onSuccess: invalidate,
  });
}

export function useSaasSubscriptions(filter: { stage?: SaasStage; offset: number }) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['ws', ws, 'saas-subscriptions', 'list', filter],
    queryFn: ({ signal }) =>
      api(`/saas-subscriptions?${query(filter)}`, SaasSubscriptionList, {
        workspaceId: ws,
        signal,
      }),
    enabled: Boolean(ws),
  });
}

export function useSaasSummary() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['ws', ws, 'saas-subscriptions', 'summary'],
    queryFn: ({ signal }) =>
      api('/saas-subscriptions/summary', SaasSummary, { workspaceId: ws, signal }),
    enabled: Boolean(ws),
  });
}

export function useContactSubscription(contactId: string) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['ws', ws, 'saas-subscriptions', 'contact', contactId],
    queryFn: ({ signal }) =>
      api(`/contacts/${contactId}/saas-subscription`, ContactSaasSubscription, {
        workspaceId: ws,
        signal,
      }),
    enabled: Boolean(ws),
  });
}

export function usePutContactSubscription(contactId: string) {
  const ws = useWorkspaceId(),
    invalidate = useInvalidateSaas();
  return useMutation({
    mutationFn: (body: PutSaasSubscription) =>
      api(`/contacts/${contactId}/saas-subscription`, SaasSubscriptionDto, {
        method: 'PUT',
        body,
        workspaceId: ws,
      }),
    onSuccess: invalidate,
  });
}
