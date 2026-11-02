import {
  AdminAccountDetail,
  AdminAccountList,
  type AdminAccountListQuery,
  AdminAuditList,
  AdminOverrideDto,
  AdminPaymentDto,
  AdminPaymentList,
  type AdminPaymentListQuery,
  AdminPlanDto,
  AdminPlanList,
  AdminSubscriptionDto,
  type ArchivePlanRequest,
  BillingSettingsDto,
  type ConfirmPaymentRequest,
  type CreatePaymentRequest,
  type CreatePlanRequest,
  type ExtendTrialRequest,
  type PublishPlanVersionRequest,
  type PutBillingSettingsRequest,
  type PutOverrideRequest,
  type SetAccountPlanRequest,
  type SetAccountStatusRequest,
} from '@agent-sales/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { withQuery } from '@/lib/url';

/** Platform back-office calls (ADR-021 §6): global, never sent with a workspace header. */
const global = { workspaceScoped: false } as const;

export type AccountFilters = Omit<AdminAccountListQuery, 'cursor' | 'limit'>;

export function useAdminPlans() {
  return useQuery({
    queryKey: queryKeys.adminPlans,
    queryFn: async () => (await api('/admin/plans', AdminPlanList, global)).data,
  });
}

/** Writes that change a plan refresh the catalog (subscriber counts, versions). */
export function useSavePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      input: { create: CreatePlanRequest } | { code: string; publish: PublishPlanVersionRequest },
    ) =>
      'create' in input
        ? api('/admin/plans', AdminPlanDto, { ...global, method: 'POST', body: input.create })
        : api(`/admin/plans/${encodeURIComponent(input.code)}/versions`, AdminPlanDto, {
            ...global,
            method: 'POST',
            body: input.publish,
          }),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.adminPlans }),
  });
}

export function useArchivePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, body }: { code: string; body: ArchivePlanRequest }) =>
      api(`/admin/plans/${encodeURIComponent(code)}/archive`, AdminPlanDto, {
        ...global,
        method: 'POST',
        body,
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.adminPlans }),
  });
}

export function useBillingSettings() {
  return useQuery({
    queryKey: queryKeys.adminBillingSettings,
    queryFn: () => api('/admin/billing-settings', BillingSettingsDto, global),
  });
}

export function useSaveBillingSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PutBillingSettingsRequest) =>
      api('/admin/billing-settings', BillingSettingsDto, { ...global, method: 'PUT', body }),
    onSuccess: (saved) => qc.setQueryData(queryKeys.adminBillingSettings, saved),
    onError: () => qc.invalidateQueries({ queryKey: queryKeys.adminBillingSettings }),
  });
}

export function useAdminAccounts(filters: AccountFilters) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.adminAccounts, 'list', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api(
        withQuery('/admin/accounts', { ...filters, limit: 50, cursor: pageParam }),
        AdminAccountList,
        global,
      ),
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
}

export function useAdminAccount(accountId: string) {
  return useQuery({
    queryKey: queryKeys.adminAccount(accountId),
    queryFn: () => api(`/admin/accounts/${accountId}`, AdminAccountDetail, global),
    retry: (count, err) => (err as { status?: number }).status !== 404 && count < 2,
  });
}

/** Any account action: refresh the account, the lists and payments whatever the outcome (409 too). */
function useAccountMutation<I, O>(accountId: string, fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.adminAccount(accountId) }),
        qc.invalidateQueries({ queryKey: [...queryKeys.adminAccounts, 'list'] }),
        qc.invalidateQueries({ queryKey: queryKeys.adminPayments }),
      ]);
    },
  });
}

const base = (accountId: string) => `/admin/accounts/${accountId}`;

export function useSetAccountPlan(accountId: string) {
  return useAccountMutation(accountId, (body: SetAccountPlanRequest) =>
    api(`${base(accountId)}/plan`, AdminSubscriptionDto, { ...global, method: 'POST', body }),
  );
}

export function useExtendTrial(accountId: string) {
  return useAccountMutation(accountId, (body: ExtendTrialRequest) =>
    api(`${base(accountId)}/trial`, AdminSubscriptionDto, { ...global, method: 'POST', body }),
  );
}

export function usePutOverride(accountId: string) {
  return useAccountMutation(accountId, ({ key, body }: { key: string; body: PutOverrideRequest }) =>
    api(`${base(accountId)}/overrides/${encodeURIComponent(key)}`, AdminOverrideDto, {
      ...global,
      method: 'PUT',
      body,
    }),
  );
}

export function useDeleteOverride(accountId: string) {
  return useAccountMutation(accountId, ({ key, reason }: { key: string; reason: string }) =>
    api(`${base(accountId)}/overrides/${encodeURIComponent(key)}`, z.null(), {
      ...global,
      method: 'DELETE',
      body: { reason },
    }),
  );
}

export function useSetAccountStatus(accountId: string) {
  return useAccountMutation(accountId, (body: SetAccountStatusRequest) =>
    api(`${base(accountId)}/status`, z.null(), { ...global, method: 'POST', body }),
  );
}

export function useCreatePayment(accountId: string) {
  return useAccountMutation(accountId, (body: CreatePaymentRequest) =>
    api(`${base(accountId)}/payments`, AdminPaymentDto, { ...global, method: 'POST', body }),
  );
}

export function useAdminPayments(filters: Omit<AdminPaymentListQuery, 'cursor' | 'limit'>) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.adminPayments, filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api(
        withQuery('/admin/payments', { ...filters, limit: 50, cursor: pageParam }),
        AdminPaymentList,
        global,
      ),
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
}

/** Confirm or cancel a payment; refreshes its account and the payment list. */
export function usePaymentAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      input:
        | { paymentId: string; confirm: ConfirmPaymentRequest }
        | { paymentId: string; cancel: { reason: string } },
    ) =>
      'confirm' in input
        ? api(`/admin/payments/${input.paymentId}/confirm`, AdminPaymentDto, {
            ...global,
            method: 'POST',
            body: input.confirm,
          })
        : api(`/admin/payments/${input.paymentId}/cancel`, AdminPaymentDto, {
            ...global,
            method: 'POST',
            body: input.cancel,
          }),
    onSettled: async (payment) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.adminPayments }),
        payment
          ? qc.invalidateQueries({ queryKey: queryKeys.adminAccount(payment.accountId) })
          : qc.invalidateQueries({ queryKey: queryKeys.adminAccounts }),
      ]);
    },
  });
}

export function useAdminAudit(target: { targetType?: string; targetId?: string }) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.adminAudit, target],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api(
        withQuery('/admin/audit', { ...target, limit: 50, cursor: pageParam }),
        AdminAuditList,
        global,
      ),
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
}
