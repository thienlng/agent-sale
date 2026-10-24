import {
  type CreateLlmProviderRequest,
  LlmProviderDto,
  LlmProviderList,
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

export function useSaveTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tier, route }: { tier: string; route: PutLlmTierRouteRequest }) =>
      api(`/admin/llm/tiers/${tier}`, LlmTierRouteDto, { ...global, method: 'PUT', body: route }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.llmTiers }),
  });
}
