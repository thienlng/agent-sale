import { type GalleryFolder, type GalleryItem, Policies } from '@agent-sales/contracts';
import type { schema } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import { toMediaPath } from '../../../../common/storage/media-url.js';
import type { Quote } from '../../domain/quote.js';
import type { RateRule } from '../../domain/rates.js';
import type {
  BookingRecord,
  PropertyRecord,
  UnitRecord,
} from '../../application/ports/lodging-store.js';

type PropertyRow = typeof schema.lodgingProperties.$inferSelect;
type UnitRow = typeof schema.lodgingUnits.$inferSelect;
type RateRow = typeof schema.lodgingRates.$inferSelect;
type BookingRow = typeof schema.lodgingBookings.$inferSelect;

/** Postgres SQLSTATE of a driver error (drizzle wraps it in `cause`). */
export const pgCode = (e: unknown): string | undefined =>
  (e as { cause?: { code?: string }; code?: string }).cause?.code ?? (e as { code?: string }).code;

const price = (sell: number | null, cost: number | null) =>
  sell === null || cost === null ? null : { sell, cost };

/** Id and name of the folder a flat (pre-0066) gallery reads as; migration 0066 uses this name. */
export const LEGACY_FOLDER_ID = 'legacy';
export const LEGACY_FOLDER_NAME = 'Ảnh chung';
const KINDS = new Set<string>(['image', 'video', 'link']);
const rec = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Rapiz photos and videos are host-relative `/media/…` paths; older rows name a former host. */
function toItem(raw: unknown): GalleryItem[] {
  const r = rec(raw);
  const kind = text(r['kind']);
  const url = text(r['url']);
  if (!KINDS.has(kind) || !url) return [];
  return [
    {
      kind,
      url: kind === 'link' ? url : toMediaPath(url),
      caption: text(r['caption']),
    } as GalleryItem,
  ];
}

/**
 * The stored gallery as folders. A flat `[{url, caption}]` list (a row written before 0066, or by
 * a later run of `lodging_copy_accommodations()`) reads as one "Ảnh chung" folder.
 */
export function toGallery(raw: unknown): GalleryFolder[] {
  if (!Array.isArray(raw)) return [];
  if (!raw.some((f) => 'items' in rec(f))) {
    const items = raw.flatMap((g) => toItem({ ...rec(g), kind: 'image' }));
    return items.length ? [{ id: LEGACY_FOLDER_ID, name: LEGACY_FOLDER_NAME, items }] : [];
  }
  return raw.flatMap((f) => {
    const r = rec(f);
    const id = text(r['id']);
    const name = text(r['name']);
    if (!id || !name) return [];
    return [{ id, name, items: (Array.isArray(r['items']) ? r['items'] : []).flatMap(toItem) }];
  });
}

export function toProperty(r: PropertyRow): PropertyRecord {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    area: r.area,
    address: r.address,
    description: r.description,
    sellMode: r.sellMode,
    status: r.status,
    standardAdults: r.standardAdults,
    standardChildren: r.standardChildren,
    maxGuests: r.maxGuests,
    childFreeBelow: r.childFreeBelow,
    childAdultFrom: r.childAdultFrom,
    amenities: r.amenities,
    layout: r.layout.map((l) => ({ name: l.name, beds: l.beds ?? '', note: l.note ?? '' })),
    // Rows copied by 0041 carry only some policy keys; the contract fills the rest with ''.
    policies: Policies.parse(r.policies),
    gallery: toGallery(r.gallery),
    galleryCover: r.galleryCover ? toMediaPath(r.galleryCover) : '',
    internalNote: r.internalNote,
    surcharges: {
      extraAdult: price(r.extraAdultSell, r.extraAdultCost),
      extraChild: price(r.extraChildSell, r.extraChildCost),
    },
    sortOrder: r.sortOrder,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function propertyValues(ws: WorkspaceId, p: PropertyRecord) {
  return {
    id: p.id,
    workspaceId: ws,
    code: p.code,
    name: p.name,
    area: p.area,
    address: p.address,
    description: p.description,
    sellMode: p.sellMode,
    status: p.status,
    standardAdults: p.standardAdults,
    standardChildren: p.standardChildren,
    maxGuests: p.maxGuests,
    childFreeBelow: p.childFreeBelow,
    childAdultFrom: p.childAdultFrom,
    amenities: p.amenities,
    layout: p.layout,
    policies: { ...p.policies },
    gallery: p.gallery.map((f) => ({
      id: f.id,
      name: f.name,
      items: f.items.map((i) => ({
        kind: i.kind,
        url: i.kind === 'link' ? i.url : toMediaPath(i.url),
        caption: i.caption,
      })),
    })),
    galleryCover: p.galleryCover ? toMediaPath(p.galleryCover) : '',
    internalNote: p.internalNote,
    extraAdultSell: p.surcharges.extraAdult?.sell ?? null,
    extraAdultCost: p.surcharges.extraAdult?.cost ?? null,
    extraChildSell: p.surcharges.extraChild?.sell ?? null,
    extraChildCost: p.surcharges.extraChild?.cost ?? null,
    sortOrder: p.sortOrder,
    version: p.version,
    createdAt: new Date(p.createdAt),
    updatedAt: new Date(p.updatedAt),
  };
}

export function toUnit(r: UnitRow): UnitRecord {
  return {
    id: r.id,
    propertyId: r.propertyId,
    kind: r.kind,
    name: r.name,
    beds: r.beds,
    capacityAdults: r.capacityAdults,
    capacityChildren: r.capacityChildren,
    active: r.active,
    sortOrder: r.sortOrder,
  };
}

export function unitValues(ws: WorkspaceId, propertyId: string, u: UnitRecord) {
  return {
    id: u.id,
    workspaceId: ws,
    propertyId,
    kind: u.kind,
    name: u.name,
    beds: u.beds,
    capacityAdults: u.capacityAdults,
    capacityChildren: u.capacityChildren,
    active: u.active,
    sortOrder: u.sortOrder,
  };
}

export function toRate(r: RateRow): RateRule {
  return {
    id: r.id,
    unitId: r.unitId,
    kind: r.kind,
    weekdays: r.weekdays,
    dateFrom: r.dateFrom,
    dateTo: r.dateTo,
    label: r.label,
    sell: r.sell,
    cost: r.cost,
    minNights: r.minNights,
  };
}

export function rateValues(ws: WorkspaceId, propertyId: string, r: RateRule) {
  return {
    id: r.id,
    workspaceId: ws,
    propertyId,
    unitId: r.unitId,
    kind: r.kind,
    weekdays: r.weekdays,
    dateFrom: r.dateFrom,
    dateTo: r.dateTo,
    label: r.label,
    sell: r.sell,
    cost: r.cost,
    minNights: r.minNights,
  };
}

export function toBooking(r: BookingRow, unitIds: string[]): BookingRecord {
  return {
    id: r.id,
    code: r.code,
    propertyId: r.propertyId,
    kind: r.kind,
    whole: r.whole,
    unitIds,
    status: r.status,
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    adults: r.adults,
    childAges: r.childAges,
    guestName: r.guestName,
    guestPhone: r.guestPhone,
    contactId: r.contactId,
    conversationId: r.conversationId,
    source: r.source,
    holdExpiresAt: r.holdExpiresAt?.toISOString() ?? null,
    quote: (r.quote as unknown as Quote | null) ?? null,
    adjustment: r.adjustment,
    adjustmentReason: r.adjustmentReason,
    totalSell: r.totalSell,
    totalCost: r.totalCost,
    note: r.note,
    tags: r.tags,
    blockReason: r.blockReason,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    reviewedBy: r.reviewedBy,
    clientRequestId: r.clientRequestId,
    fingerprint: r.fingerprint,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Column values of a booking; `id`, `workspaceId` and `createdAt` only matter on insert. */
export function bookingValues(ws: WorkspaceId, b: BookingRecord) {
  return {
    id: b.id,
    workspaceId: ws,
    propertyId: b.propertyId,
    code: b.code,
    kind: b.kind,
    whole: b.whole,
    status: b.status as BookingRow['status'],
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    adults: b.adults,
    childAges: b.childAges,
    guestName: b.guestName,
    guestPhone: b.guestPhone,
    contactId: b.contactId,
    conversationId: b.conversationId,
    source: b.source as BookingRow['source'],
    holdExpiresAt: b.holdExpiresAt === null ? null : new Date(b.holdExpiresAt),
    quote: b.quote as unknown as Record<string, unknown> | null,
    adjustment: b.adjustment,
    adjustmentReason: b.adjustmentReason,
    totalSell: b.totalSell,
    totalCost: b.totalCost,
    note: b.note,
    tags: b.tags,
    blockReason: b.blockReason,
    reviewedAt: b.reviewedAt === null ? null : new Date(b.reviewedAt),
    reviewedBy: b.reviewedBy,
    clientRequestId: b.clientRequestId,
    fingerprint: b.fingerprint,
    version: b.version,
    createdAt: new Date(b.createdAt),
    updatedAt: new Date(b.updatedAt),
  };
}
