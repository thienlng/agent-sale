import { createHash } from 'node:crypto';

import type {
  BookingDetail,
  BookingList,
  BookingListQuery,
  BookingReviewCount,
  BookingStatusRequest,
  CreateBookingRequest,
  UpdateBookingRequest,
} from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { LodgingEventType } from '../api/lodging.events.js';
import { nextStatus, type Action } from '../domain/booking-status.js';
import { LodgingError } from '../domain/lodging.errors.js';
import { localToday, nightsBetween } from '../domain/nights.js';
import { resolveUnits } from '../domain/quote.js';
import {
  bookingPackageIds,
  expireHolds,
  quoteSelection,
  unitPackagesOf,
  loadContext,
  keptTotals,
  manualTotalForEdit,
  normalizeTags,
  assertEditable,
  blockRecord,
  reviewedBy,
  sameSet,
  shortenStay,
  publishStatus,
  toBookingDtos,
  totals,
  type Actor,
  type BookingBase,
  type PropertyContext,
} from './booking-support.js';
import { LodgingAccess } from './lodging-access.js';
import {
  LODGING_STORE,
  type BookingRecord,
  type LodgingStore,
  type LodgingTx,
} from './ports/lodging-store.js';

const PAGE = 100;
const MINUTE_MS = 60_000;
/** Statuses whose nights are given back to the calendar. */
const RELEASING = new Set(['cancelled', 'expired', 'no_show', 'removed']);
const STATUS_EVENTS: Partial<Record<Action, LodgingEventType>> = {
  confirm: 'lodging.booking.confirmed.v1',
  cancel: 'lodging.booking.cancelled.v1',
  check_in: 'lodging.booking.checked_in.v1',
  check_out: 'lodging.booking.checked_out.v1',
};
const AUDIT_ACTIONS: Record<Action, string> = {
  confirm: 'lodging.booking.confirmed',
  cancel: 'lodging.booking.cancelled',
  check_in: 'lodging.booking.checked_in',
  check_out: 'lodging.booking.checked_out',
  no_show: 'lodging.booking.no_show',
  extend_hold: 'lodging.booking.hold_extended',
  remove_block: 'lodging.booking.block_removed',
};
/** A hold that has expired (maybe lazily, in this very request) says so before any version check. */
function assertNotExpired(b: BookingRecord): void {
  if (b.status === 'expired') {
    throw new LodgingError('CONFLICT', 'The hold has expired', { reason: 'HOLD_EXPIRED' });
  }
}

function assertVersion(b: BookingRecord, version: number): void {
  if (b.version !== version) {
    throw new LodgingError('STALE_VERSION', 'The booking changed; reload before saving', {
      version: b.version,
    });
  }
}

/** Holds, confirmed stays, blocks and their status moves (spec §3.5). */
@Injectable()
export class BookingService {
  constructor(
    @Inject(LODGING_STORE) private readonly store: LodgingStore,
    @Inject(LodgingAccess) private readonly access: LodgingAccess,
  ) {}

  async list(ws: WorkspaceId, query: BookingListQuery): Promise<BookingList> {
    await this.access.assertHotel(ws);
    return this.store.run(ws, async (tx) => {
      const now = new Date();
      await expireHolds(tx, now);
      const rows = await tx.listBookings({ ...query, today: localToday(now) });
      return {
        data: await toBookingDtos(tx, rows.slice(0, PAGE)),
        nextOffset: rows.length > PAGE ? query.offset + PAGE : null,
      };
    });
  }

  async get(ws: WorkspaceId, id: string): Promise<BookingDetail> {
    await this.access.assertHotel(ws);
    return this.store.run(ws, async (tx) => {
      await expireHolds(tx, new Date());
      return this.detail(tx, await this.find(tx, id));
    });
  }

  /**
   * Creates a hold, a confirmed stay or a block and takes its unit-nights. Idempotent by
   * `clientRequestId`: the same payload replays the booking, a different one is a conflict.
   */
  async create(ws: WorkspaceId, input: CreateBookingRequest, actor: Actor): Promise<BookingDetail> {
    await this.access.assertHotel(ws);
    return this.store.run(ws, async (tx) => {
      const now = new Date();
      await expireHolds(tx, now);
      return this.detail(tx, await this.createIn(tx, input, actor, now));
    });
  }

  /**
   * The create path inside the caller's transaction (staff create and the bot hold confirm):
   * replays an earlier booking of the same `clientRequestId` and payload, else inserts the
   * booking, takes its unit-nights (NIGHTS_TAKEN aborts the transaction), audits and publishes
   * `lodging.booking.created.v1`. The caller runs `expireHolds` first.
   */
  async createIn(
    tx: LodgingTx,
    input: CreateBookingRequest,
    actor: Actor,
    now: Date,
  ): Promise<BookingRecord> {
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    await tx.lockRequestKey(input.clientRequestId);
    const existing = await tx.findBookingByRequest(input.clientRequestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new LodgingError('CONFLICT', 'This request key was used for a different booking');
      }
      return existing;
    }
    const ctx = await loadContext(tx, input.propertyId);
    if (ctx.property.status !== 'active') {
      throw new LodgingError('CONFLICT', 'The property is paused');
    }
    const nights = nightsBetween(input.checkIn, input.checkOut);
    const unitIds = resolveUnits(ctx.property, ctx.units, input);
    const base: BookingBase = {
      id: newId(),
      code: await tx.nextBookingCode(),
      propertyId: ctx.property.id,
      whole: input.whole,
      unitIds,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      clientRequestId: input.clientRequestId,
      fingerprint,
      reviewedAt: null,
      reviewedBy: null,
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const b: BookingRecord =
      input.kind === 'block'
        ? blockRecord(base, input.blockReason)
        : await this.newStay(tx, ctx, input, base, now);
    await tx.insertBooking(b);
    await tx.takeNights(b.id, unitIds, nights);
    await tx.audit(
      actor.id,
      'lodging_booking',
      b.id,
      'lodging.booking.created',
      { kind: b.kind, status: b.status, checkIn: b.checkIn, checkOut: b.checkOut },
      actor.name,
    );
    await tx.publish({
      name: 'lodging.booking.created.v1',
      payload: {
        bookingId: b.id,
        code: b.code,
        propertyId: b.propertyId,
        status: b.status,
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        source: b.source,
      },
    });
    return b;
  }

  /** Bot holds waiting for staff (source `bot`, status `hold`, not reviewed yet). */
  async reviewCount(ws: WorkspaceId): Promise<BookingReviewCount> {
    await this.access.assertHotel(ws);
    return this.store.run(ws, async (tx) => {
      await expireHolds(tx, new Date());
      return { pending: await tx.countBotHoldsToReview() };
    });
  }

  /**
   * Edits a booking. Holds, confirmed stays and active blocks change freely; a checked-in stay
   * only moves its check-out and corrects its price. Only a change of dates, units, packages or
   * party re-prices the stay. `packageIds` omitted = keep the stored packages (re-priced: kept
   * while the units stay and they still fit, see `quoteKeepingPackages`, else auto-picked);
   * `[]` = pick automatically, so a client sends `packageIds` only when staff changed them; any other edit keeps the stored quote and nights. Units and nights are
   * re-taken in the same transaction, so a conflict leaves the old nights in place.
   */
  async update(
    ws: WorkspaceId,
    id: string,
    req: UpdateBookingRequest,
    actor: Actor,
  ): Promise<BookingDetail> {
    await this.access.assertHotel(ws);
    return this.store.run(ws, async (tx) => {
      const now = new Date();
      await expireHolds(tx, now);
      const b = await this.find(tx, id, true);
      assertNotExpired(b);
      assertVersion(b, req.version);
      const inHouse = b.status === 'checked_in';
      assertEditable(b, req);
      const ctx = await loadContext(tx, b.propertyId);
      const checkIn = req.checkIn ?? b.checkIn;
      const checkOut = req.checkOut ?? b.checkOut;
      const nights = nightsBetween(checkIn, checkOut);
      const whole = req.whole ?? b.whole;
      const party = req.party ?? { adults: b.adults, childAges: b.childAges };
      const datesChanged = checkIn !== b.checkIn || checkOut !== b.checkOut;
      const unitsChanged =
        !inHouse &&
        (whole !== b.whole ||
          (!whole && req.unitIds !== undefined && !sameSet(req.unitIds, b.unitIds)));
      const storedPackages = bookingPackageIds(b);
      const packagesChanged =
        b.kind === 'stay' &&
        req.packageIds !== undefined &&
        !sameSet(req.packageIds, storedPackages);
      const partyChanged =
        party.adults !== b.adults ||
        party.childAges.length !== b.childAges.length ||
        party.childAges.some((age, i) => age !== b.childAges[i]);
      // Only a change of dates or units re-takes nights (and re-resolves a whole rental's rooms).
      const retake = datesChanged || unitsChanged;
      const unitIds =
        retake && !inHouse
          ? resolveUnits(ctx.property, ctx.units, { whole, unitIds: req.unitIds ?? b.unitIds })
          : b.unitIds;
      let next: BookingRecord = {
        ...b,
        checkIn,
        checkOut,
        whole,
        unitIds,
        note: req.note ?? b.note,
        ...reviewedBy(b, actor, now),
        version: b.version + 1,
        updatedAt: now.toISOString(),
      };
      if (b.kind === 'stay') {
        const adjustment = req.adjustment ?? b.adjustment;
        next = {
          ...next,
          adults: party.adults,
          childAges: party.childAges,
          guestName: req.guestName ?? b.guestName,
          guestPhone: req.guestPhone ?? b.guestPhone,
          tags: req.tags ? normalizeTags(req.tags) : b.tags,
          adjustment,
          adjustmentReason: req.adjustmentReason ?? b.adjustmentReason,
        };
        if (retake || partyChanged || packagesChanged) {
          // The stay itself changed: price it at today's rates (or the manual price staff chose).
          const stay = {
            whole,
            unitIds,
            checkIn,
            checkOut,
            adults: party.adults,
            childAges: party.childAges,
          };
          const kept = unitsChanged ? [] : storedPackages;
          const quote = quoteSelection(ctx, stay, req.packageIds, kept);
          const manual = manualTotalForEdit(b, req.manualTotalSell);
          next = {
            ...next,
            quote,
            unitPackages: unitPackagesOf(quote, whole, unitIds),
            ...totals(quote, manual, adjustment),
          };
        } else {
          // Same stay: keep the agreed quote; only a new adjustment or manual price moves the total.
          next = { ...next, ...keptTotals(b, req.manualTotalSell, adjustment) };
        }
      }
      if (retake) {
        await tx.releaseNights(b.id);
        await tx.takeNights(b.id, unitIds, nights);
      }
      await tx.updateBooking(next);
      await tx.audit(
        actor.id,
        'lodging_booking',
        b.id,
        'lodging.booking.updated',
        {
          fields: Object.keys(req).filter((k) => k !== 'version'),
          previous: {
            checkIn: b.checkIn,
            checkOut: b.checkOut,
            unitIds: b.unitIds,
            packageIds: storedPackages,
            totalSell: b.totalSell,
            quote: b.quote,
          },
        },
        actor.name,
      );
      return this.detail(tx, next);
    });
  }

  /** One status move (spec §3.5 machine); leaving the calendar frees the nights. */
  async changeStatus(
    ws: WorkspaceId,
    id: string,
    req: BookingStatusRequest,
    actor: Actor,
  ): Promise<BookingDetail> {
    await this.access.assertHotel(ws);
    return this.store.run(ws, async (tx) => {
      const now = new Date();
      await expireHolds(tx, now);
      const b = await this.find(tx, id, true);
      assertNotExpired(b);
      assertVersion(b, req.version);
      const status = nextStatus(b.kind, b.status, req.action, localToday(now), b.checkIn);
      let holdExpiresAt = b.holdExpiresAt;
      if (req.action === 'extend_hold') {
        const minutes = req.holdMinutes ?? (await tx.settings()).holdMinutes;
        holdExpiresAt = new Date(now.getTime() + minutes * MINUTE_MS).toISOString();
      } else if (req.action === 'confirm') {
        holdExpiresAt = null;
      }
      let next: BookingRecord = {
        ...b,
        status,
        holdExpiresAt,
        ...reviewedBy(b, actor, now),
        version: b.version + 1,
        updatedAt: now.toISOString(),
      };
      const early = req.action === 'check_out' ? await shortenStay(tx, next, now) : null;
      if (early) next = early;
      if (RELEASING.has(status)) await tx.releaseNights(b.id);
      await tx.updateBooking(next);
      await tx.audit(
        actor.id,
        'lodging_booking',
        b.id,
        AUDIT_ACTIONS[req.action],
        {
          from: b.status,
          to: status,
          ...(req.reason ? { reason: req.reason } : {}),
          ...(req.action === 'extend_hold' ? { holdExpiresAt } : {}),
          ...(early ? { checkOut: { from: b.checkOut, to: early.checkOut } } : {}),
        },
        actor.name,
      );
      const event = STATUS_EVENTS[req.action];
      if (event) await publishStatus(tx, event, next);
      return this.detail(tx, next);
    });
  }

  private async newStay(
    tx: LodgingTx,
    ctx: PropertyContext,
    input: Extract<CreateBookingRequest, { kind: 'stay' }>,
    base: BookingBase,
    now: Date,
  ): Promise<BookingRecord> {
    const { whole, checkIn, checkOut, party } = input;
    const stay = { whole, unitIds: base.unitIds, checkIn, checkOut, ...party };
    const quote = quoteSelection(ctx, stay, input.packageIds, []);
    const holdMinutes = input.status === 'hold' ? (await tx.settings()).holdMinutes : null;
    return {
      ...base,
      unitPackages: unitPackagesOf(quote, input.whole, base.unitIds),
      kind: 'stay',
      status: input.status,
      adults: input.party.adults,
      childAges: input.party.childAges,
      guestName: input.guestName,
      guestPhone: input.guestPhone,
      contactId: input.contactId,
      conversationId: input.conversationId,
      source: input.source,
      holdExpiresAt:
        holdMinutes === null
          ? null
          : new Date(now.getTime() + holdMinutes * MINUTE_MS).toISOString(),
      quote,
      adjustment: input.adjustment,
      adjustmentReason: input.adjustmentReason,
      ...totals(quote, input.manualTotalSell, input.adjustment),
      note: input.note,
      tags: normalizeTags(input.tags),
      blockReason: '',
    };
  }

  private async find(tx: LodgingTx, id: string, lock = false): Promise<BookingRecord> {
    const b = await tx.findBooking(id, lock);
    if (!b) throw new LodgingError('NOT_FOUND', 'Booking not found');
    return b;
  }

  private async detail(tx: LodgingTx, b: BookingRecord): Promise<BookingDetail> {
    const [dto] = await toBookingDtos(tx, [b]);
    if (!dto) throw new LodgingError('NOT_FOUND', 'Booking not found');
    return { ...dto, history: await tx.history(b.id) };
  }
}
