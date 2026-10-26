import {
  type CreateLlmProviderRequest,
  HermesLoginStatus,
  type DiscoverLlmModelsRequest,
  DiscoverLlmModelsResponse,
  LlmProviderDto,
  LlmProviderList,
  LlmProviderModelList,
  LlmTierRouteDto,
  LlmTierRouteList,
  type PutLlmTierRouteRequest,
  TestLlmProviderResponse,
  type UpdateLlmProviderRequest,
} from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

const global = { workspaceScoped: false } as const;

export function useLlmProviders() {
  return useQuery({
    queryKey: queryKeys.llmProviders,
    queryFn: async () => (await api('/admin/llm/providers', LlmProviderList, global)).data,
  });
}

export function useLlmTiers() {
  return useQuery({
    queryKey: queryKeys.llmTiers,
    queryFn: async () => (await api('/admin/llm/tiers', LlmTierRouteList, global)).data,
  });
}

export function useSaveProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      input:
        { id: string; change: UpdateLlmProviderRequest } | { create: CreateLlmProviderRequest },
    ) =>
      'create' in input
        ? api('/admin/llm/providers', LlmProviderDto, {
            ...global,
            method: 'POST',
            body: input.create,
          })
        : api(`/admin/llm/providers/${input.id}`, LlmProviderDto, {
            ...global,
            method: 'PATCH',
            body: input.change,
          }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.llmProviders }),
  });
}

export function useDeleteProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/admin/llm/providers/${id}`, z.null(), { ...global, method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.llmProviders }),
  });
}

export function useTestProvider() {
  return useMutation({
    mutationFn: ({ id, model }: { id: string; model: string }) =>
      api(`/admin/llm/providers/${id}/test`, TestLlmProviderResponse, {
        ...global,
        method: 'POST',
        body: { model },
      }),
  });
}

/** Checks the connection and lists models; works on a draft that is not saved yet. */
export function useDiscoverModels() {
  return useMutation({
    mutationFn: (input: DiscoverLlmModelsRequest) =>
      api('/admin/llm/providers/models', DiscoverLlmModelsResponse, {
        ...global,
        method: 'POST',
        body: input,
      }),
  });
}

export function useSaveTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tier, route }: { tier: string; route: PutLlmTierRouteRequest }) =>
      api(`/admin/llm/tiers/${tier}`, LlmTierRouteDto, { ...global, method: 'PUT', body: route }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.llmTiers }),
  });
}

const loginPath = (id: string) => `/admin/llm/providers/${id}/hermes-login`;

/** ChatGPT sign-in state; polls every 3 s only while a device-code login is pending. */
export function useHermesLogin(providerId: string) {
  return useQuery({
    queryKey: queryKeys.hermesLogin(providerId),
    queryFn: () => api(loginPath(providerId), HermesLoginStatus, global),
    refetchInterval: (query) => (query.state.data?.state === 'pending' ? 3_000 : false),
  });
}

export function useHermesLoginAction(providerId: string) {
  const qc = useQueryClient();
  const set = (status: HermesLoginStatus) =>
    qc.setQueryData(queryKeys.hermesLogin(providerId), status);
  return {
    start: useMutation({
      mutationFn: () =>
        api(loginPath(providerId), HermesLoginStatus, { ...global, method: 'POST' }),
      onSuccess: set,
    }),
    logout: useMutation({
      mutationFn: () =>
        api(loginPath(providerId), HermesLoginStatus, { ...global, method: 'DELETE' }),
      onSuccess: set,
    }),
  };
}

/** Short model list of a provider (5-minute cache; `refetch` bypasses nothing but re-asks the API). */
export function useProviderModels(providerId: string | null) {
  return useQuery({
    queryKey: queryKeys.providerModels(providerId ?? ''),
    queryFn: () => api(`/admin/llm/providers/${providerId}/models`, LlmProviderModelList, global),
    enabled: Boolean(providerId),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
