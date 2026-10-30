import {
  ContactSaasSubscription,
  type PutSaasSubscription,
  SaasSubscriptionDto,
  SaasSubscriptionList,
  SaasSummary,
} from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useWorkspaceId } from '@/lib/use-workspace';

/** Subscriptions of the given customers (one list page), keyed by customer id. */
export function useSubscriptionsOf(contactIds: readonly string[], enabled: boolean) {
  const ws = useWorkspaceId();
  const ids = [...contactIds].sort().join(',');
  return useQuery({
    queryKey: ['ws', ws, 'saas-subscriptions', 'of', ids],
    queryFn: async ({ signal }) => {
      const list = await api(`/saas-subscriptions?contactIds=${ids}`, SaasSubscriptionList, {
        workspaceId: ws,
        signal,
      });
      return new Map(list.data.map((s) => [s.contactId, s]));
    },
    enabled: Boolean(ws) && enabled && ids !== '',
  });
}

/** Trials ending in the next 7 days, soonest first. */
export function useTrialsEndingSoon(enabled: boolean) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['ws', ws, 'saas-subscriptions', 'ending-soon'],
    queryFn: ({ signal }) =>
      api('/saas-subscriptions?endingSoon=true', SaasSubscriptionList, {
        workspaceId: ws,
        signal,
      }),
    enabled: Boolean(ws) && enabled,
  });
}

export function useSaasSummary(enabled: boolean) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['ws', ws, 'saas-subscriptions', 'summary'],
    queryFn: ({ signal }) =>
      api('/saas-subscriptions/summary', SaasSummary, { workspaceId: ws, signal }),
    enabled: Boolean(ws) && enabled,
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

/** Saving a plan also moves the customer's status (ADR-014), so customers reload too. */
export function usePutContactSubscription(contactId: string) {
  const ws = useWorkspaceId(),
    qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PutSaasSubscription) =>
      api(`/contacts/${contactId}/saas-subscription`, SaasSubscriptionDto, {
        method: 'PUT',
        body,
        workspaceId: ws,
      }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['ws', ws, 'saas-subscriptions'] }),
        qc.invalidateQueries({ queryKey: queryKeys.contacts(ws) }),
      ]),
  });
}
