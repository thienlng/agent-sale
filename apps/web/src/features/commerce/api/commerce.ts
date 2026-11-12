import {
  type AdjustStockRequest,
  type ApproveOrderRequest,
  BotProductsDto,
  type ChangeOrderStatusRequest,
  type CreateOrderRequest,
  OrderDto,
  type OrderListQuery,
  OrderListResponse,
  OrderOverviewResponse,
  OrderReviewCountResponse,
  OrderSettingsDto,
  ProductDto,
  ProductListResponse,
  type UpdateOrderRequest,
  type UpdateProductBotSettingsRequest,
  type UpsertProductRequest,
  type UpsertWarehouseRequest,
  type UploadProductImageRequest,
  UploadProductImageResponse,
  VariantSearchResponse,
  WarehouseDto,
  WarehouseList,
} from '@agent-sales/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import type { TFunction } from 'i18next';

import { api, ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/query-keys';
import { withQuery } from '@/lib/url';
import { useWorkspaceId } from '@/lib/use-workspace';

// ─── Warehouses ───────────────────────────────────────────────────────────────

export function useWarehouses() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.warehouses(ws),
    queryFn: async () => (await api('/warehouses', WarehouseList)).data,
    enabled: Boolean(ws),
  });
}

export function useSaveWarehouse() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: UpsertWarehouseRequest }) =>
      id
        ? api(`/warehouses/${id}`, WarehouseDto, { method: 'PATCH', body })
        : api('/warehouses', WarehouseDto, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.warehouses(ws) }),
  });
}

export function useDeleteWarehouse() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/warehouses/${id}`, z.null(), { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.warehouses(ws) }),
  });
}

// ─── Products ─────────────────────────────────────────────────────────────────

export function useProducts(query: {
  q?: string;
  status: 'active' | 'archived';
  page: number;
  /** `kiotviet`: only products synced from KiotViet; `rapiz`: only products managed here. */
  source?: 'kiotviet' | 'rapiz';
  /** Defaults to 20 (the catalog screen); the bot products table lets the user pick. */
  pageSize?: number;
}) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [...queryKeys.products(ws), query],
    queryFn: () =>
      api(
        withQuery('/products', { ...query, pageSize: query.pageSize ?? 20 }),
        ProductListResponse,
      ),
    placeholderData: keepPreviousData,
    enabled: Boolean(ws),
  });
}

export function useProduct(id: string | undefined) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.product(ws, id ?? ''),
    queryFn: () => api(`/products/${id}`, ProductDto),
    enabled: Boolean(ws && id),
  });
}

export function useSaveProduct() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: UpsertProductRequest }) =>
      id
        ? api(`/products/${id}`, ProductDto, { method: 'PUT', body })
        : api('/products', ProductDto, { method: 'POST', body }),
    onSuccess: (p) => {
      qc.setQueryData(queryKeys.product(ws, p.id), p);
      void qc.invalidateQueries({ queryKey: queryKeys.products(ws) });
      void qc.invalidateQueries({ queryKey: queryKeys.variants(ws) });
    },
  });
}

/**
 * Hard delete of a product no order uses; 409 `details.reason` is `product_in_orders` (archive
 * it instead) or `product_synced` (a KiotViet product).
 */
export function useDeleteProduct() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/products/${id}`, z.null(), { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: queryKeys.product(ws, id) });
      void qc.invalidateQueries({ queryKey: queryKeys.products(ws) });
      void qc.invalidateQueries({ queryKey: queryKeys.variants(ws) });
    },
  });
}

/** The stored product as a full PUT body with only its status changed (archive in one click). */
export function withStatus(p: ProductDto, status: 'active' | 'archived'): UpsertProductRequest {
  return {
    code: p.code,
    name: p.name,
    description: p.description,
    category: p.category,
    visibleToBot: p.visibleToBot,
    botInstructions: p.botInstructions,
    imageUrls: p.imageUrls,
    status,
    variants: p.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      name: v.name,
      price: v.price,
      cost: v.cost,
      weightGram: v.weightGram,
    })),
  };
}

/**
 * Saves only the bot's fields. A KiotViet-linked product saves through this, never the full PUT:
 * its other fields are read-only and may not pass the form's rules (e.g. a code with a space).
 */
export function useSaveProductBotSettings(productId: string) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProductBotSettingsRequest) =>
      api(`/products/${productId}/bot-settings`, ProductDto, { method: 'PATCH', body }),
    onSuccess: (p) => {
      qc.setQueryData(queryKeys.product(ws, p.id), p);
      void qc.invalidateQueries({ queryKey: queryKeys.products(ws) });
    },
  });
}

/** Products selected for a bot; only used when the bot's catalogMode is 'selected' (T-080). */
export function useBotProducts(botId: string) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.botProducts(ws, botId),
    queryFn: () => api(`/bots/${botId}/products`, BotProductsDto),
    enabled: Boolean(ws && botId),
  });
}

/** Optimistic: the checkbox flips at once and is rolled back when the save fails. */
export function useSetBotProducts(botId: string) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const key = queryKeys.botProducts(ws, botId);
  return useMutation({
    scope: { id: `bot-products:${ws}:${botId}` },
    mutationFn: (productIds: string[]) =>
      api(`/bots/${botId}/products`, BotProductsDto, { method: 'PUT', body: { productIds } }),
    onMutate: async (productIds) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BotProductsDto>(key);
      qc.setQueryData<BotProductsDto>(key, { productIds });
      return { previous };
    },
    onError: (_e, _ids, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSuccess: (data) => qc.setQueryData(key, data),
  });
}

export function useAdjustStock(productId: string) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdjustStockRequest) =>
      api(`/products/${productId}/stock`, ProductDto, { method: 'POST', body }),
    onSuccess: (p) => {
      qc.setQueryData(queryKeys.product(ws, p.id), p);
      void qc.invalidateQueries({ queryKey: queryKeys.products(ws) });
      void qc.invalidateQueries({ queryKey: queryKeys.variants(ws) });
    },
  });
}

export function useVariantSearch(query: { q: string; warehouseId: string; inStock: boolean }) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [...queryKeys.variants(ws), query],
    queryFn: async () =>
      (await api(withQuery('/product-variants', query), VariantSearchResponse)).data,
    placeholderData: keepPreviousData,
    enabled: Boolean(ws && query.warehouseId),
    staleTime: 10_000,
  });
}

// ─── Orders ───────────────────────────────────────────────────────────────────

/** How often an order list or page re-reads while a KiotViet push is pending. */
export const PUSH_POLL_MS = 3000;

export function useOrders(query: OrderListQuery) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [...queryKeys.orders(ws), 'list', query],
    queryFn: () => api(withQuery('/orders', query), OrderListResponse),
    placeholderData: keepPreviousData,
    enabled: Boolean(ws),
    // A KiotViet push takes seconds: follow it until it is pushed or failed.
    refetchInterval: (q) =>
      q.state.data?.data.some((o) => o.external?.state === 'pending') ? PUSH_POLL_MS : false,
  });
}

export function useOrder(id: string) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.order(ws, id),
    queryFn: () => api(`/orders/${id}`, OrderDto),
    enabled: Boolean(ws),
    refetchInterval: (q) => (q.state.data?.external?.state === 'pending' ? PUSH_POLL_MS : false),
  });
}

export function useOrderOverview(range: { from: string; to: string }) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [...queryKeys.orders(ws), 'overview', range],
    queryFn: () => api(withQuery('/orders/overview', range), OrderOverviewResponse),
    placeholderData: keepPreviousData,
    enabled: Boolean(ws),
  });
}

/** Any order change refreshes lists, the overview and stock figures. */
function useOrderChanged() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return (order: OrderDto) => {
    qc.setQueryData(queryKeys.order(ws, order.id), order);
    void qc.invalidateQueries({ queryKey: queryKeys.orders(ws) });
    void qc.invalidateQueries({ queryKey: queryKeys.products(ws) });
    void qc.invalidateQueries({ queryKey: queryKeys.variants(ws) });
  };
}

export function useCreateOrder() {
  const changed = useOrderChanged();
  return useMutation({
    mutationFn: (body: CreateOrderRequest) => api('/orders', OrderDto, { method: 'POST', body }),
    onSuccess: changed,
  });
}

export function useUpdateOrder(id: string) {
  const changed = useOrderChanged();
  return useMutation({
    mutationFn: (body: UpdateOrderRequest) =>
      api(`/orders/${id}`, OrderDto, { method: 'PATCH', body }),
    onSuccess: changed,
  });
}

export function useChangeOrderStatus(id: string) {
  const changed = useOrderChanged();
  return useMutation({
    mutationFn: (body: ChangeOrderStatusRequest) =>
      api(`/orders/${id}/status`, OrderDto, { method: 'POST', body }),
    onSuccess: changed,
  });
}

// ─── Bot order review ─────────────────────────────────────────────────────────

const reviewCountKey = (ws: string) => [...queryKeys.orders(ws), 'review-count'] as const;

/** How many bot orders wait for review (the toolbar chip); refreshed with every order change. */
export function useOrderReviewCount() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: reviewCountKey(ws),
    queryFn: () => api('/orders/review-count', OrderReviewCountResponse),
    enabled: Boolean(ws),
  });
}

/**
 * Approves a bot order, or reverts the approval (`approve:false`, the undo). Optimistic: list
 * rows, the detail and the pending count flip at once and are restored when the call fails.
 */
export function useApproveOrder() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const changed = useOrderChanged();
  return useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      api(`/orders/${id}/approve`, OrderDto, {
        method: 'POST',
        body: { approve } satisfies ApproveOrderRequest,
      }),
    onMutate: async ({ id, approve }) => {
      await qc.cancelQueries({ queryKey: queryKeys.orders(ws) });
      const snapshot = qc.getQueriesData({ queryKey: queryKeys.orders(ws) });
      const reviewState = approve ? ('approved' as const) : ('pending' as const);
      qc.setQueriesData<OrderListResponse>(
        { queryKey: [...queryKeys.orders(ws), 'list'] },
        (old) =>
          old && {
            ...old,
            data: old.data.map((o) => (o.id === id ? { ...o, reviewState } : o)),
          },
      );
      qc.setQueryData<OrderDto>(queryKeys.order(ws, id), (old) => old && { ...old, reviewState });
      qc.setQueryData<OrderReviewCountResponse>(
        reviewCountKey(ws),
        (old) => old && { pending: Math.max(0, old.pending + (approve ? -1 : 1)) },
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx) =>
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSuccess: changed,
  });
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export function useOrderSettings() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: queryKeys.orderSettings(ws),
    queryFn: () => api('/order-settings', OrderSettingsDto),
    enabled: Boolean(ws),
    staleTime: 60_000,
  });
}

/**
 * Saves the whole settings object with the version it was loaded at. A CONFLICT
 * means someone saved in between: the latest settings are fetched again.
 */
export function useSaveOrderSettings() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OrderSettingsDto) =>
      api('/order-settings', OrderSettingsDto, { method: 'PUT', body }),
    onSuccess: (s) => qc.setQueryData(queryKeys.orderSettings(ws), s),
    onError: (err) => {
      if (err instanceof ApiClientError && err.code === 'CONFLICT') {
        void qc.invalidateQueries({ queryKey: queryKeys.orderSettings(ws) });
      }
    },
  });
}

/** The toast for a failed settings save (stale version or anything else). */
export function settingsErrorMessage(t: TFunction, err: unknown): string {
  return err instanceof ApiClientError && err.code === 'CONFLICT'
    ? t('orderSettings.stale')
    : errorMessage(t, err);
}

/**
 * Moves several orders to one status, one request each (every order keeps its
 * own stock and history rules). Resolves with how many succeeded.
 */
export function useBulkChangeStatus() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, body }: { ids: string[]; body: ChangeOrderStatusRequest }) => {
      let ok = 0;
      for (const id of ids) {
        try {
          await api(`/orders/${id}/status`, OrderDto, { method: 'POST', body });
          ok += 1;
        } catch {
          // Counted as failed; e.g. cancelling an order whose goods already left.
        }
      }
      return { ok, total: ids.length };
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.orders(ws) });
      void qc.invalidateQueries({ queryKey: queryKeys.products(ws) });
      void qc.invalidateQueries({ queryKey: queryKeys.variants(ws) });
    },
  });
}

/** Every order matching the filter (100 per request, up to 5,000) for the CSV export. */
export async function fetchAllOrders(query: Omit<OrderListQuery, 'page' | 'pageSize'>) {
  const rows = [];
  for (let page = 1; page <= 50; page += 1) {
    const res = await api(
      withQuery('/orders', { ...query, page, pageSize: 100 }),
      OrderListResponse,
    );
    rows.push(...res.data);
    if (page * 100 >= res.total) break;
  }
  return rows;
}

/** Upload one (already resized) product or gallery picture to Rapiz storage; resolves to its URL. */
export function useUploadProductImage() {
  return useMutation({
    mutationFn: async (body: UploadProductImageRequest) =>
      (await api('/products/images', UploadProductImageResponse, { method: 'POST', body })).url,
  });
}

/** i18n key for a failed picture upload, chosen by the server's `details.reason`. */
export function imageUploadErrorKey(error: unknown) {
  const reason = error instanceof ApiClientError ? error.details?.reason : undefined;
  if (reason === 'INVALID_IMAGE') return 'products.form.imageInvalid' as const;
  if (reason === 'PAYLOAD_TOO_LARGE' || (error instanceof ApiClientError && error.status === 413))
    return 'products.form.imageTooLarge' as const;
  if (reason === 'MEDIA_STORAGE_UNAVAILABLE')
    return 'products.form.imageStorageUnavailable' as const;
  return 'products.form.imageUploadFailed' as const;
}
