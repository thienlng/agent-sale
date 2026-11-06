import { createHash } from 'node:crypto';

import type { BotAvailabilityOption, ConfirmBotHoldResult } from '../api/lodging.facade.js';
import { weekdayLabel } from '../domain/hold-summary.js';
import { foldVietnamese } from '@agent-sales/shared';

import type { Quote } from '../domain/quote.js';
import { packagesOf, priceNight, type DomainPackage, type RateRule } from '../domain/rates.js';
import type { FreeOption, StayAsk } from './availability.js';
import type {
  BookingRecord,
  BotHoldDraftRecord,
  LodgingTx,
  PackageRecord,
  PropertyRecord,
  UnitRecord,
} from './ports/lodging-store.js';

/** Pure helpers of the bot hold use cases (`bot-hold.service.ts`, T-161). */

export const BOT_HOLD_DRAFT_TTL_MS = 30 * 60 * 1000;
export const MAX_NAME = 200;
export const MAX_NOTE = 2000;
/** Conversation channels with an inbox conversation to open; others (test chat) link nothing. */
export const CUSTOMER_CHANNELS: ReadonlySet<string> = new Set([
  'facebook',
  'instagram',
  'website',
  'zalo',
]);
/** RFC 4122 namespace of bot hold request ids (uuid v5 of the draft id). */
const HOLD_NAMESPACE = '6f1c2a54-8a0e-4c39-9b8e-3d4f5a6b7c8d';

export type FailCode = 'expired' | 'not_available' | 'price_changed';

/** Why a draft cannot become its hold; thrown so the confirming transaction rolls back. */
export class HoldNotConfirmable extends Error {
  readonly code: FailCode;
  readonly draft: BotHoldDraftRecord;
  constructor(code: FailCode, draft: BotHoldDraftRecord) {
    super(code);
    this.code = code;
    this.draft = draft;
  }
}

/** The properties a bot sells, with their units, rates and packages (one query each). */
export interface SoldContext {
  sold: PropertyRecord[];
  units: UnitRecord[];
  ratesOf: Awaited<ReturnType<LodgingTx['ratesByProperty']>>;
  packages: PackageRecord[];
}

/** The packages of one property. */
export const packagesOfProperty = (ctx: SoldContext, propertyId: string): PackageRecord[] =>
  ctx.packages.filter((pk) => pk.propertyId === propertyId);

export const tidy = (text: string | undefined, max: number) =>
  (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Deterministic uuid v5 of `name` in HOLD_NAMESPACE: a retried confirm replays the same hold. */
export function holdRequestId(draftId: string): string {
  const ns = Buffer.from(HOLD_NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(ns).update(draftId).digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * sha256 of what the customer agreed to: selection, party, guest, note, the sell prices, the
 * quote warnings (a new min-stay rule or maximum also needs a new summary) and the packages.
 */
type Agreed = Pick<
  BotHoldDraftRecord,
  | 'propertyId'
  | 'whole'
  | 'checkIn'
  | 'checkOut'
  | 'adults'
  | 'childAges'
  | 'guestName'
  | 'guestPhone'
  | 'note'
>;

export function quoteHash(d: Agreed, resolved: string[], q: Quote): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        d.propertyId,
        d.whole,
        [...resolved].sort(),
        d.checkIn,
        d.checkOut,
        d.adults,
        d.childAges,
        d.guestName,
        d.guestPhone,
        d.note,
        q.nights.map((n) => [n.date, n.sell]),
        q.surcharges.map((s) => [s.kind, s.persons, s.nights, s.sell]),
        q.totalSell,
        q.warnings,
        // Appended only when set: a package-less draft keeps its pre-T-193 hash.
        ...(q.packages.length ? [q.packages.map((p) => [p.target, p.packageId])] : []),
      ]),
    )
    .digest('hex');
}

const packageKey = (name: string) => foldVietnamese(name).trim().toLowerCase();

/**
 * The package ids of the names the customer chose (T-193), matched case- and accent-insensitively
 * against the packages of the targets `quote` (the automatic quote) prices; `unitId` null = the
 * whole property. A later choice for the same target wins. An unknown name, or a target the stay
 * does not price with packages, answers every valid name instead ('Bungalow 1: 2PN' for a room).
 * A stay priced without any package ignores the asked names (a stale or invented package must not
 * block a hold that has nothing to choose).
 */
export function pickPackages(
  quote: Quote,
  packages: DomainPackage[],
  asked: { unitId: string | null; name: string }[],
  unitNames: ReadonlyMap<string, string>,
): { ids: string[] } | { valid: string[] } {
  const targets = quote.packages.map((pk) => pk.target);
  if (targets.length === 0) return { ids: [] };
  const byTarget = new Map<string | null, string>();
  for (const a of asked) {
    const target = a.unitId ?? null;
    const found = targets.includes(target)
      ? packagesOf(packages, target).find((pk) => packageKey(pk.name) === packageKey(a.name))
      : undefined;
    if (!found) {
      return {
        valid: targets.flatMap((t) =>
          packagesOf(packages, t)
            .sort((x, y) => x.bedrooms - y.bedrooms)
            .map((pk) => (t === null ? pk.name : `${unitNames.get(t) ?? ''}: ${pk.name}`)),
        ),
      };
    }
    byTarget.set(target, found.id);
  }
  return { ids: [...byTarget.values()] };
}

/** A readable party: 0–1000 adults, child ages 0–17, at least one guest. */
export function validParty(adults: number, childAges: unknown): boolean {
  const okAdults = Number.isInteger(adults) && adults >= 0 && adults <= 1000;
  const okKids =
    Array.isArray(childAges) &&
    childAges.length <= 1000 &&
    childAges.every((a) => Number.isInteger(a) && a >= 0 && a <= 17);
  return okAdults && okKids && adults + (childAges as number[]).length >= 1;
}

/**
 * The longest minimum stay of the date-range prices the option uses on the asked nights (whole
 * target and its rooms, each with the package the quote picked), or null when the stay is long
 * enough.
 */
export function requiredNights(o: FreeOption, rates: RateRule[]): number | null {
  if (!o.quote.warnings.includes('min_nights')) return null;
  const targets: (string | null)[] = [null, ...o.unitIds];
  const packageOf = (t: string | null) =>
    o.quote.packages.find((pk) => pk.target === t)?.packageId ?? null;
  let most = 0;
  for (const n of o.quote.nights) {
    for (const t of targets) {
      most = Math.max(most, priceNight(rates, t, n.date, packageOf(t))?.minNights ?? 0);
    }
  }
  return most || null;
}

/** The bot view of a free option: sell prices only, Vietnamese weekday labels. */
export function toBotOption(o: FreeOption, rates: RateRule[]): BotAvailabilityOption {
  const names = new Map(o.units.map((u) => [u.id, u.name]));
  const minNights = requiredNights(o, rates);
  const warnings = o.quote.warnings;
  return {
    propertyId: o.property.id,
    code: o.property.code,
    name: o.property.name,
    whole: o.whole,
    unitIds: o.property.sellMode === 'rooms' ? o.unitIds : [],
    unitNames: o.property.sellMode === 'rooms' ? o.unitIds.map((id) => names.get(id) ?? '') : [],
    fits: o.fits,
    // Above the maximum the option is not offered at all: never "fits with staff approval".
    overStandard: warnings.includes('over_standard') && !warnings.includes('over_max'),
    minNights,
    problems: o.quote.warnings.includes('min_nights') ? ['min_nights'] : [],
    totalSell: o.quote.totalSell,
    package: o.packages.length === 1 ? (o.packages[0]?.name ?? null) : null,
    alternatives: o.alternatives.map((a) => ({
      package: a.name,
      bedrooms: a.bedrooms,
      totalSell: a.totalSell,
      fits: a.fits,
    })),
    nightly: o.quote.nights.map((n) => ({
      date: n.date,
      weekdayLabel: weekdayLabel(n.date),
      label: n.label,
      sell: n.sell,
    })),
    surcharges: o.quote.surcharges.map((s) => ({
      kind: s.kind,
      persons: s.persons,
      nights: s.nights,
      sell: s.sell,
    })),
  };
}

/** NIGHTS_TAKEN while confirming: the transaction is aborted; remembers the draft. */
export class NightsTakenOnConfirm extends Error {
  readonly draft: BotHoldDraftRecord;
  constructor(draft: BotHoldDraftRecord) {
    super('NIGHTS_TAKEN');
    this.draft = draft;
  }
}

export function stayOf(s: StayAsk): StayAsk {
  return { checkIn: s.checkIn, checkOut: s.checkOut, adults: s.adults, childAges: s.childAges };
}

export function held(b: BookingRecord): ConfirmBotHoldResult {
  return { status: 'held', code: b.code, holdExpiresAt: b.holdExpiresAt ?? '' };
}
