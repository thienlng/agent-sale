import { z } from 'zod';

import type { RouteInvoker } from '../domain/ports/route-invoker.port.js';

/** The only route whose proposal may carry the new variants' counted stock (AS-12, AS2-7). */
export const PRODUCT_CREATE_KEY = 'POST /products';

/** `tool_call.stock` of a product create: counted stock per new variant, by SKU. */
export const InitialStock = z
  .array(
    z.object({
      sku: z.string().trim().min(1).max(64),
      onHand: z.number().int().min(0).max(1_000_000),
    }),
  )
  .min(1)
  .max(100);
export type InitialStock = z.infer<typeof InitialStock>;

/** SKUs of `stock` that are not variants of the product body (case-insensitive). */
export function unknownStockSkus(body: unknown, stock: InitialStock): string[] {
  const variants = (body as { variants?: { sku?: unknown }[] } | null)?.variants ?? [];
  const skus = new Set(
    variants.flatMap((v) => (typeof v.sku === 'string' ? [v.sku.toLowerCase()] : [])),
  );
  return stock.filter((s) => !skus.has(s.sku.toLowerCase())).map((s) => s.sku);
}

/** The product body as the card shows it: each variant with the stock it will get. */
export function withStockShown(body: unknown, stock: InitialStock): unknown {
  const b = body as { variants?: Record<string, unknown>[] } | null;
  if (!b || !Array.isArray(b.variants)) return body;
  const bySku = new Map(stock.map((s) => [s.sku.toLowerCase(), s.onHand]));
  return {
    ...b,
    variants: b.variants.map((v) => {
      const n = typeof v['sku'] === 'string' ? bySku.get(v['sku'].toLowerCase()) : undefined;
      return n === undefined ? v : { ...v, stock: n };
    }),
  };
}

const ok2xx = (status: number) => status >= 200 && status < 300;

/**
 * Sets the counted stock of a product just created (its `ProductDto` with variant ids) in the
 * business's default warehouse, as the product import does. `ok`, or why not: `no_warehouse`
 * (none is default) or `stock_failed` (a variant was not found or a write failed).
 */
export async function setInitialStock(
  invoker: RouteInvoker,
  i: {
    businessId: string;
    authorization: string;
    created: unknown;
    stock: InitialStock;
  },
): Promise<'ok' | 'no_warehouse' | 'stock_failed'> {
  const product = i.created as { id?: unknown; variants?: { id?: unknown; sku?: unknown }[] };
  if (typeof product?.id !== 'string') return 'stock_failed';
  let warehouseId: string | null;
  try {
    const res = await invoker.invoke({
      method: 'get',
      path: '/warehouses',
      businessId: i.businessId,
      authorization: i.authorization,
    });
    const found = ok2xx(res.status)
      ? (res.body as { data?: { id?: unknown; isDefault?: unknown }[] } | null)?.data?.find(
          (w) => w.isDefault === true,
        )
      : undefined;
    warehouseId = typeof found?.id === 'string' ? found.id : null;
  } catch {
    return 'stock_failed';
  }
  if (!warehouseId) return 'no_warehouse';
  const ids = new Map<string, string>();
  for (const v of product.variants ?? []) {
    if (typeof v.sku === 'string' && typeof v.id === 'string') ids.set(v.sku.toLowerCase(), v.id);
  }
  let failed = false;
  for (const s of i.stock) {
    const variantId = ids.get(s.sku.toLowerCase());
    if (!variantId) {
      failed = true;
      continue;
    }
    try {
      const out = await invoker.invoke({
        method: 'post',
        path: `/products/${product.id}/stock`,
        body: { variantId, warehouseId, onHand: s.onHand },
        businessId: i.businessId,
        authorization: i.authorization,
      });
      if (!ok2xx(out.status)) failed = true;
    } catch {
      failed = true;
    }
  }
  return failed ? 'stock_failed' : 'ok';
}
