import {
  defaultOrderPolicy,
  FULFILMENT_ORDER_STATUSES,
  OPTIONAL_ORDER_STATUSES,
  type OrderSettingsDto,
  OrderSource,
  type OrderSourcePolicy,
} from '@agent-sales/contracts';
import { newId } from '@agent-sales/shared';

import {
  OrderFieldsRequiredError,
  StatusDisabledError,
  VariantNotFoundError,
} from '../domain/commerce.errors.js';
import { missingFields, type OrderPeople } from '../domain/order-policy.js';
import type { OrderStatus } from '../domain/order-stock.js';
import type { CommerceTx, OrderItemRecord, OrderRecord } from './ports/commerce-store.js';

/** Order rules shared by the order use cases: settings, source policies, line snapshots. */
const OPTIONAL: ReadonlySet<string> = new Set(OPTIONAL_ORDER_STATUSES);
const FULFILMENT: ReadonlySet<string> = new Set(FULFILMENT_ORDER_STATUSES);
const DEFAULT_SETTINGS = {
  extraStatuses: ['awaiting_print', 'printed'],
  requireNoteStatuses: [],
  policies: [],
  version: 0,
};

export type OrderLine = { variantId: string; qty: number; unitPrice?: number | undefined };

/** Stored order settings with every source's policy filled in (defaults where unset). */
export async function loadSettings(tx: CommerceTx): Promise<OrderSettingsDto> {
  const s = (await tx.settings.get()) ?? DEFAULT_SETTINGS;
  const stored = new Map(s.policies.map((p) => [p.source, p]));
  return {
    ...(s as Pick<OrderSettingsDto, 'extraStatuses' | 'requireNoteStatuses'>),
    policies: OrderSource.options.map(
      (source) =>
        (stored.get(source) as OrderSourcePolicy | undefined) ?? defaultOrderPolicy(source),
    ),
    version: s.version,
  };
}

/** Settings as saved: no duplicates, every source in a fixed order (missing ones get defaults). */
export function normalizeSettings(s: OrderSettingsDto): Omit<OrderSettingsDto, 'version'> {
  const bySource = new Map(s.policies.map((p) => [p.source, p]));
  return {
    extraStatuses: [...new Set(s.extraStatuses)],
    requireNoteStatuses: [...new Set(s.requireNoteStatuses)],
    policies: OrderSource.options.map((source) => {
      const p = bySource.get(source) ?? defaultOrderPolicy(source);
      return { source, create: [...new Set(p.create)], confirm: [...new Set(p.confirm)] };
    }),
  };
}

export function peopleOf(o: Pick<OrderRecord, 'customer' | 'recipient'>): OrderPeople {
  return { customer: o.customer, recipient: o.recipient };
}

/**
 * The source's `create` fields always; its `confirm` fields too when the order
 * is (or is being put) in a fulfilment status.
 */
export function assertPolicy(
  settings: OrderSettingsDto,
  source: string,
  people: OrderPeople,
  status: OrderStatus,
): void {
  const policy =
    settings.policies.find((p) => p.source === source) ??
    defaultOrderPolicy(source as OrderSourcePolicy['source']);
  const forCreate = missingFields(people, policy.create);
  if (forCreate.length) throw new OrderFieldsRequiredError('create', source, forCreate);
  if (!FULFILMENT.has(status)) return;
  const forConfirm = missingFields(people, policy.confirm);
  if (forConfirm.length) throw new OrderFieldsRequiredError('confirm', source, forConfirm);
}

/**
 * Order lines with their snapshot: a variant already on the order keeps its
 * names, cost and price; a new one must still be on sale and takes the catalog's.
 */
export async function orderLines(
  tx: CommerceTx,
  lines: OrderLine[],
  current: OrderItemRecord[] = [],
): Promise<OrderItemRecord[]> {
  const kept = new Map(current.map((i) => [i.variantId, i]));
  const added = [...new Set(lines.map((l) => l.variantId).filter((id) => !kept.has(id)))];
  const variants = new Map(
    (added.length ? await tx.products.variantsByIds(added) : [])
      // Archived variants and products no longer on sale cannot be ordered.
      .filter((v) => !v.archived && v.productActive)
      .map((v) => [v.id, v]),
  );
  const missing = added.filter((id) => !variants.has(id));
  if (missing.length) throw new VariantNotFoundError(missing);

  return lines.map((l, position) => {
    const old = kept.get(l.variantId);
    const v = variants.get(l.variantId);
    const snap = old
      ? { ...old, price: old.unitPrice }
      : v
        ? {
            productName: v.productName,
            variantName: v.name,
            sku: v.sku,
            unitCost: v.cost,
            price: v.price,
          }
        : null;
    if (!snap) throw new VariantNotFoundError([l.variantId]);
    const unitPrice = l.unitPrice ?? snap.price;
    return {
      id: newId(),
      variantId: l.variantId,
      productName: snap.productName,
      variantName: snap.variantName,
      sku: snap.sku,
      qty: l.qty,
      unitPrice,
      unitCost: snap.unitCost,
      lineTotal: unitPrice * l.qty,
      position,
    };
  });
}

export function assertStatusAllowed(settings: OrderSettingsDto, status: OrderStatus): void {
  if (OPTIONAL.has(status) && !(settings.extraStatuses as string[]).includes(status)) {
    throw new StatusDisabledError(status);
  }
}
