import { z } from 'zod';

import type { KvProduct } from '../../domain/kiotviet-mapping.js';

/**
 * Tolerant schemas for KiotViet public API payloads (spec §3). Objects keep unknown fields
 * (`looseObject`, Zod 4's `.passthrough()`), numbers arrive as numbers or numeric strings, and
 * field names the guide does not pin down are accepted in both casings.
 */

const num = z.coerce.number();
const int = z.coerce.number().int();
/** Strings, or numbers as text (`z.coerce.string()` would turn a missing field into "undefined"). */
const text = z.union([z.string(), z.number()]).transform(String);
const flag = z.boolean().optional().catch(undefined);

export const TokenSchema = z.looseObject({
  access_token: z.string().min(1),
  expires_in: num.positive().optional(),
});

const ImageSchema = z.union([
  z.string(),
  z.looseObject({ Image: z.string().optional(), image: z.string().optional() }),
]);

export const KvInventorySchema = z.looseObject({
  branchId: int,
  onHand: num.catch(0),
  reserved: num
    .optional()
    .catch(0)
    .transform((v) => v ?? 0),
});

export const KvProductSchema = z
  .looseObject({
    id: int,
    code: text,
    name: text,
    fullName: text.optional(),
    categoryName: z.string().nullish(),
    allowsSale: flag,
    hasVariants: flag,
    masterProductId: int.nullish(),
    masterUnitId: int.nullish(),
    unit: z.string().nullish(),
    conversionValue: num.nullish(),
    attributes: z
      .array(z.looseObject({ attributeName: text, attributeValue: text }))
      .nullish()
      .transform((v) => v ?? undefined),
    basePrice: num.optional(),
    weight: num.nullish(),
    images: z
      .array(ImageSchema)
      .nullish()
      .transform((v) =>
        (v ?? [])
          .map((i) => (typeof i === 'string' ? i : (i.Image ?? i.image ?? '')))
          .filter(Boolean),
      ),
    description: z.string().nullish(),
    inventories: z
      .array(KvInventorySchema)
      .nullish()
      .transform((v) => v ?? undefined),
  })
  // Absent fields are dropped (not set to undefined) so the result is a plain KvProduct.
  .transform(
    (p) =>
      Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as KvProduct &
        Record<string, unknown>,
  );

const ids = z.array(int).nullish();

/** List envelope: `data` stays raw so one malformed item does not sink the page. */
export const KvListSchema = z
  .looseObject({
    total: int.optional(),
    data: z.array(z.unknown()).nullish(),
    removeId: ids,
    removedIds: ids,
  })
  .transform((v) => ({
    data: v.data ?? [],
    total: v.total ?? (v.data ?? []).length,
    removedIds: [...new Set([...(v.removeId ?? []), ...(v.removedIds ?? [])])],
  }));

export const KvBranchSchema = z
  .looseObject({
    id: int,
    branchName: text.optional(),
    name: text.optional(),
    address: z.string().nullish(),
  })
  .transform((b) => ({ id: b.id, name: b.branchName ?? b.name ?? '', address: b.address ?? null }));

export const KvOnHandSchema = z
  .looseObject({
    productId: int.optional(),
    id: int.optional(),
    inventories: z.array(KvInventorySchema).nullish(),
  })
  .refine((r) => r.productId !== undefined || r.id !== undefined)
  .transform((r) => ({
    productId: (r.productId ?? r.id) as number,
    inventories: (r.inventories ?? []).map((i) => ({
      branchId: i.branchId,
      onHand: i.onHand,
      reserved: i.reserved,
    })),
  }));

export const KvWebhookSchema = z
  .looseObject({
    id: int.optional(),
    Id: int.optional(),
    type: text.optional(),
    Type: text.optional(),
    url: text.optional(),
    Url: text.optional(),
  })
  .refine((w) => w.id !== undefined || w.Id !== undefined)
  .transform((w) => ({
    id: (w.id ?? w.Id) as number,
    type: w.type ?? w.Type ?? '',
    url: w.url ?? w.Url ?? '',
  }));

/** `POST /webhooks` answer: the id as `id` or `Id`, possibly under `data`. */
export const KvWebhookIdSchema = z
  .looseObject({
    id: int.optional(),
    Id: int.optional(),
    data: z.looseObject({ id: int.optional(), Id: int.optional() }).optional(),
  })
  .transform((v) => v.id ?? v.Id ?? v.data?.id ?? v.data?.Id)
  .pipe(z.number().int());

/** An order (`POST /orders` answer, `GET /orders/{id}`, list items), possibly under `data`. */
const KvOrderFields = z.looseObject({
  id: int,
  code: text,
  status: int,
  description: z.string().nullish(),
});

export const KvOrderSchema = z
  .preprocess((raw) => {
    const o = raw as { id?: unknown; data?: unknown } | null;
    return o && typeof o === 'object' && o.id === undefined && o.data ? o.data : raw;
  }, KvOrderFields)
  .transform((o) => ({ id: o.id, code: o.code, status: o.status }));

export const KvOrderSummarySchema = KvOrderFields.transform((o) => ({
  id: o.id,
  code: o.code,
  status: o.status,
  description: o.description ?? null,
}));

const optionalText = text
  .nullish()
  .catch(null)
  .transform((v) => v ?? null);

/** A customer (`GET /customers`, `GET /customers/{id}`); field names to verify (docs "Still to verify"). */
export const KvCustomerSchema = z
  .looseObject({
    id: int,
    code: optionalText,
    name: optionalText,
    contactNumber: optionalText,
    email: optionalText,
    address: optionalText,
    wardName: optionalText,
    locationName: optionalText,
    birthDate: optionalText,
    gender: z.boolean().nullish().catch(null),
  })
  .transform((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    contactNumber: c.contactNumber,
    email: c.email,
    address: c.address,
    wardName: c.wardName,
    locationName: c.locationName,
    birthDate: c.birthDate,
    gender: c.gender ?? null,
  }));

/** `POST /customers` answer: the id, possibly under `data`. */
export const KvCustomerIdSchema = z
  .looseObject({
    id: int.optional(),
    data: z.looseObject({ id: int.optional() }).optional(),
  })
  .transform((v) => v.id ?? v.data?.id)
  .pipe(z.number().int())
  .transform((id) => ({ id }));
