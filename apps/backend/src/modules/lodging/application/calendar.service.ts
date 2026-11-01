import type {
  AvailabilityDto,
  AvailabilityRequest,
  CalendarDto,
  QuoteDto,
  QuoteRequest,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { compareFitThenPrice } from '../domain/availability-ranking.js';
import { LodgingError } from '../domain/lodging.errors.js';
import { addNights, localToday, nightsBetween, nightToUtcMs } from '../domain/nights.js';
import { quoteStay, resolveUnits } from '../domain/quote.js';
import { priceNight, type RateRule } from '../domain/rates.js';
import { freeOptions } from './availability.js';
import { expireHolds, loadContext, toQuoteDto } from './booking-support.js';
import { LodgingAccess } from './lodging-access.js';
import {
  LODGING_STORE,
  type BookingRecord,
  type LodgingStore,
  type PropertyRecord,
  type UnitRecord,
} from './ports/lodging-store.js';
import { currentUnits } from './property-support.js';

const DAY_MS = 86_400_000;
export const MAX_CALENDAR_NIGHTS = 62;
const Uuid = z.uuid();

type CalendarProperty = CalendarDto['properties'][number];
type NightPrice = CalendarProperty['wholePrices'][number];
type AvailabilityOption = AvailabilityDto['options'][number];

/** The nights [from, to) of a calendar window: 1 to 62 nights. */
function calendarNights(from: string, to: string): string[] {
  const count = (nightToUtcMs(to) - nightToUtcMs(from)) / DAY_MS;
  if (count < 1 || count > MAX_CALENDAR_NIGHTS) {
    throw new LodgingError(
      'VALIDATION_FAILED',
      `The calendar shows 1 to ${MAX_CALENDAR_NIGHTS} nights`,
      { from, to },
    );
  }
  return Array.from({ length: count }, (_, i) => addNights(from, i));
}

function parseIds(csv: string | undefined): string[] | undefined {
  if (csv === undefined || csv.trim() === '') return undefined;
  const ids = [...new Set(csv.split(',').map((s) => s.trim()))];
  const bad = ids.filter((id) => !Uuid.safeParse(id).success);
  if (bad.length > 0) {
    throw new LodgingError('VALIDATION_FAILED', 'propertyIds must be uuids', { propertyIds: bad });
  }
  return ids;
}

/** Whole-property price of a night: a whole-target rate, else the sum of the rooms (all priced). */
function wholePrice(p: PropertyRecord, rooms: UnitRecord[], rates: RateRule[], night: string) {
  const own = priceNight(rates, null, night);
  if (own) return { night, sell: own.sell, label: own.label };
  if (p.sellMode === 'whole' || rooms.length === 0) return { night, sell: null, label: '' };
  let sell = 0;
  for (const r of rooms) {
    const price = priceNight(rates, r.id, night);
    if (!price) return { night, sell: null, label: '' };
    sell += price.sell;
  }
  return { night, sell, label: '' };
}

/** Fits first, then cheapest; options without a total last. */
const byFitThenPrice = (a: AvailabilityOption, b: AvailabilityOption): number =>
  compareFitThenPrice(
    { fits: a.fits, totalSell: a.quote.totalSell },
    { fits: b.fits, totalSell: b.quote.totalSell },
  );

/** Calendar grid, free-unit search and quotes (spec §3.4–3.5, §4). Reads only. */
@Injectable()
export class CalendarService {
  constructor(
    @Inject(LODGING_STORE) private readonly store: LodgingStore,
    @Inject(LodgingAccess) private readonly access: LodgingAccess,
  ) {}

  /** Quote for one selection; `takenBy` lists the bookings already on those nights. */
  async quote(ws: WorkspaceId, req: QuoteRequest): Promise<QuoteDto> {
    await this.access.assertHotel(ws);
    return this.store.run(ws, async (tx) => {
      await expireHolds(tx, new Date());
      const ctx = await loadContext(tx, req.propertyId);
      const input = {
        whole: req.whole,
        unitIds: req.unitIds,
        checkIn: req.checkIn,
        checkOut: req.checkOut,
        adults: req.party.adults,
        childAges: req.party.childAges,
      };
      const quote = quoteStay(ctx.property, ctx.units, ctx.rates, input);
      const unitIds = resolveUnits(ctx.property, ctx.units, input);
      const taken = await tx.takenNights(unitIds, req.checkIn, req.checkOut);
      return toQuoteDto(quote, [...new Set(taken.map((t) => t.code))].sort());
    });
  }

  /**
   * Properties (active ones, or the requested ids) with one row per bookable unit — the whole
   * unit or each active room — its nightly prices and the bookings on it, clipped to [from, to).
   */
  async calendar(
    ws: WorkspaceId,
    query: { from: string; to: string; propertyIds?: string | undefined },
  ): Promise<CalendarDto> {
    await this.access.assertHotel(ws);
    const nights = calendarNights(query.from, query.to);
    const ids = parseIds(query.propertyIds);
    return this.store.run(ws, async (tx) => {
      const now = new Date();
      await expireHolds(tx, now);
      const props = ids ? await tx.properties({ ids }) : await tx.properties({ activeOnly: true });
      const pids = props.map((p) => p.id);
      const units = await tx.units(pids);
      const bookings = await tx.bookingsInRange(pids, query.from, query.to);
      const ratesOf = await tx.ratesByProperty(pids);
      const notes = await tx.nightNotes(pids, query.from, query.to);
      const properties: CalendarProperty[] = [];
      for (const p of props) {
        const rates = ratesOf.get(p.id) ?? [];
        const rows = currentUnits(p, units).filter((u) => u.active);
        const rooms = rows.filter((u) => u.kind === 'room');
        const own = bookings.filter((b) => b.propertyId === p.id);
        properties.push({
          id: p.id,
          code: p.code,
          name: p.name,
          area: p.area,
          sellMode: p.sellMode,
          standardAdults: p.standardAdults,
          standardChildren: p.standardChildren,
          wholePrices: nights.map((n) => wholePrice(p, rooms, rates, n)),
          rows: rows.map((u) => ({
            unitId: u.id,
            name: u.name,
            kind: u.kind,
            prices: nights.map((n): NightPrice => {
              const price = priceNight(rates, u.kind === 'whole' ? null : u.id, n);
              return { night: n, sell: price?.sell ?? null, label: price?.label ?? '' };
            }),
            segments: own
              .filter((b) => b.unitIds.includes(u.id))
              .map((b) => segment(b, query.from, query.to)),
          })),
          internalNote: p.internalNote,
          notes: notes.filter((n) => n.propertyId === p.id).map(({ propertyId: _p, ...n }) => n),
        });
      }
      return { from: query.from, to: query.to, today: localToday(now), properties };
    });
  }

  /**
   * Free options per active property for the nights (`freeOptions`); fitting ones first, then
   * cheapest.
   */
  async availability(ws: WorkspaceId, req: AvailabilityRequest): Promise<AvailabilityDto> {
    await this.access.assertHotel(ws);
    nightsBetween(req.checkIn, req.checkOut);
    return this.store.run(ws, async (tx) => {
      await expireHolds(tx, new Date());
      const props = await tx.properties({
        activeOnly: true,
        ...(req.propertyIds ? { ids: req.propertyIds } : {}),
      });
      const free = await freeOptions(tx, props, {
        checkIn: req.checkIn,
        checkOut: req.checkOut,
        ...req.party,
      });
      const options: AvailabilityOption[] = free.map((o) => ({
        propertyId: o.property.id,
        whole: o.whole,
        unitIds: o.unitIds,
        fits: o.fits,
        quote: toQuoteDto(o.quote),
      }));
      return { options: options.sort(byFitThenPrice) };
    });
  }
}

function segment(b: BookingRecord, from: string, to: string) {
  return {
    bookingId: b.id,
    code: b.code,
    kind: b.kind,
    status: b.status as CalendarProperty['rows'][number]['segments'][number]['status'],
    from: b.checkIn < from ? from : b.checkIn,
    to: b.checkOut > to ? to : b.checkOut,
    guestName: b.guestName,
    blockReason: b.blockReason,
    holdExpiresAt: b.holdExpiresAt,
    guestPhone: b.guestPhone,
    party: { adults: b.adults, childAges: b.childAges },
    totalSell: b.totalSell,
    tags: b.tags,
    note: b.note,
  };
}
