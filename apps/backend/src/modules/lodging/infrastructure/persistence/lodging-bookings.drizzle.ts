import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  lte,
  or,
  schema,
  sql,
  writeAudit,
  writeOutbox,
  type SQL,
  type TenantTx,
} from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type {
  BookingRecord,
  LodgingTx,
  TakenNight,
} from '../../application/ports/lodging-store.js';
import { OCCUPYING } from '../../domain/booking-status.js';
import { LodgingError } from '../../domain/lodging.errors.js';
import { addNights } from '../../domain/nights.js';
import { bookingValues, pgCode, toBooking } from './lodging.rows.js';

const U = schema.lodgingUnits;
const B = schema.lodgingBookings;
const BU = schema.lodgingBookingUnits;
const N = schema.lodgingUnitNights;
const A = schema.auditEvents;

type BookingStatusColumn = (typeof B.$inferSelect)['status'];
const statuses = (list: readonly string[]) => list as BookingStatusColumn[];
/** Stay statuses shown in the "today" view (arrivals and departures). */
const TODAY_STATUSES = statuses(['confirmed', 'checked_in', 'checked_out']);
/** Stay statuses still ahead of or in the house, for the "upcoming" view. */
const UPCOMING_STATUSES = statuses(['hold', 'confirmed', 'checked_in']);
const PAGE_PROBE = 101;

/** `column ILIKE %q%` with the user's text taken literally (\\, % and _ escaped). */
function containsInsensitive(column: unknown, q: string): SQL {
  const literal = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  return sql`${column} ilike ${`%${literal}%`} escape '\\'`;
}

export type BookingPort = Pick<
  LodgingTx,
  | 'findBooking'
  | 'findBookingByRequest'
  | 'listBookings'
  | 'bookingsInRange'
  | 'insertBooking'
  | 'updateBooking'
  | 'takeNights'
  | 'releaseNights'
  | 'takenNights'
  | 'expireOverdueHolds'
  | 'history'
  | 'audit'
  | 'publish'
>;

/** Bookings, unit-nights, audit trail and outbox of one tenant transaction. */
export function bookingPort(tx: TenantTx, ws: WorkspaceId): BookingPort {
  /** Booking rows with their unit ids (ordered like the units on the calendar). */
  async function hydrate(rows: (typeof B.$inferSelect)[]): Promise<BookingRecord[]> {
    if (rows.length === 0) return [];
    const links = await tx
      .select({ bookingId: BU.bookingId, unitId: BU.unitId })
      .from(BU)
      .innerJoin(U, and(eq(U.workspaceId, BU.workspaceId), eq(U.id, BU.unitId)))
      .where(
        and(
          eq(BU.workspaceId, ws),
          inArray(
            BU.bookingId,
            rows.map((r) => r.id),
          ),
        ),
      )
      .orderBy(asc(U.sortOrder), asc(U.id));
    const byBooking = new Map<string, string[]>();
    for (const l of links)
      byBooking.set(l.bookingId, [...(byBooking.get(l.bookingId) ?? []), l.unitId]);
    return rows.map((r) => toBooking(r, byBooking.get(r.id) ?? []));
  }

  async function linkUnits(bookingId: string, unitIds: string[]): Promise<void> {
    if (unitIds.length === 0) return;
    await tx
      .insert(BU)
      .values(unitIds.map((unitId) => ({ workspaceId: ws, bookingId, unitId })))
      .onConflictDoNothing();
  }

  const bookings: BookingPort = {
    async findBooking(id, lock) {
      const q = tx
        .select()
        .from(B)
        .where(and(eq(B.workspaceId, ws), eq(B.id, id)))
        .limit(1);
      const rows = await (lock ? q.for('update') : q);
      return (await hydrate(rows))[0] ?? null;
    },

    async findBookingByRequest(clientRequestId) {
      const rows = await tx
        .select()
        .from(B)
        .where(and(eq(B.workspaceId, ws), eq(B.clientRequestId, clientRequestId)))
        .limit(1);
      return (await hydrate(rows))[0] ?? null;
    },

    async listBookings(q) {
      const view: Record<typeof q.view, { where: SQL | undefined; order: SQL[] }> = {
        today: {
          where: and(
            or(eq(B.checkIn, q.today), eq(B.checkOut, q.today)),
            inArray(B.status, TODAY_STATUSES),
          ),
          order: [asc(B.checkIn), asc(B.createdAt), asc(B.id)],
        },
        holds: {
          where: eq(B.status, 'hold'),
          order: [asc(B.holdExpiresAt), asc(B.id)],
        },
        upcoming: {
          where: and(inArray(B.status, UPCOMING_STATUSES), gte(B.checkOut, q.today)),
          order: [asc(B.checkIn), asc(B.createdAt), asc(B.id)],
        },
        all: { where: undefined, order: [desc(B.createdAt), desc(B.id)] },
      };
      const term = q.q?.trim();
      const rows = await tx
        .select()
        .from(B)
        .where(
          and(
            eq(B.workspaceId, ws),
            view[q.view].where,
            q.propertyId ? eq(B.propertyId, q.propertyId) : undefined,
            q.status ? eq(B.status, q.status) : undefined,
            q.conversationId ? eq(B.conversationId, q.conversationId) : undefined,
            term
              ? or(
                  containsInsensitive(B.code, term),
                  containsInsensitive(B.guestName, term),
                  containsInsensitive(B.guestPhone, term),
                )
              : undefined,
          ),
        )
        .orderBy(...view[q.view].order)
        .limit(PAGE_PROBE)
        .offset(q.offset);
      return hydrate(rows);
    },

    async bookingsInRange(propertyIds, from, to) {
      if (propertyIds.length === 0) return [];
      const rows = await tx
        .select()
        .from(B)
        .where(
          and(
            eq(B.workspaceId, ws),
            inArray(B.propertyId, propertyIds),
            inArray(B.status, statuses(OCCUPYING)),
            lt(B.checkIn, to),
            gt(B.checkOut, from),
          ),
        )
        .orderBy(asc(B.checkIn), asc(B.id));
      return hydrate(rows);
    },

    async insertBooking(b) {
      await tx.insert(B).values(bookingValues(ws, b));
      await linkUnits(b.id, b.unitIds);
    },

    async updateBooking(b) {
      const {
        id: _id,
        workspaceId: _ws,
        createdAt: _created,
        clientRequestId: _key,
        ...set
      } = bookingValues(ws, b);
      await tx
        .update(B)
        .set(set)
        .where(and(eq(B.workspaceId, ws), eq(B.id, b.id)));
      await tx.delete(BU).where(and(eq(BU.workspaceId, ws), eq(BU.bookingId, b.id)));
      await linkUnits(b.id, b.unitIds);
    },

    async takeNights(bookingId, unitIds, nights) {
      const sorted = [...nights].sort();
      const first = sorted[0];
      const last = sorted.at(-1);
      if (unitIds.length === 0 || first === undefined || last === undefined) return;
      // Serialize writers per unit (sorted to avoid deadlocks). NO KEY UPDATE does not block
      // the KEY SHARE locks taken by foreign-key checks of concurrent booking inserts.
      await tx
        .select({ id: U.id })
        .from(U)
        .where(and(eq(U.workspaceId, ws), inArray(U.id, unitIds)))
        .orderBy(asc(U.id))
        .for('no key update');
      const wanted = new Set(nights);
      const taken = (await bookings.takenNights(unitIds, first, addNights(last, 1))).filter((t) =>
        wanted.has(t.night),
      );
      if (taken.length > 0) {
        throw new LodgingError('NIGHTS_TAKEN', 'Some of these nights are already taken', {
          codes: [...new Set(taken.map((t) => t.code))].sort(),
        });
      }
      try {
        await tx
          .insert(N)
          .values(
            unitIds.flatMap((unitId) =>
              nights.map((night) => ({ workspaceId: ws, unitId, night, bookingId })),
            ),
          );
      } catch (e) {
        // A writer that did not take the unit lock raced us; Postgres aborted the transaction,
        // so the occupying codes cannot be read here.
        if (pgCode(e) === '23505') {
          throw new LodgingError('NIGHTS_TAKEN', 'Some of these nights are already taken', {
            codes: [],
          });
        }
        throw e;
      }
    },

    async releaseNights(bookingId) {
      await tx.delete(N).where(and(eq(N.workspaceId, ws), eq(N.bookingId, bookingId)));
    },

    async takenNights(unitIds, from, to): Promise<TakenNight[]> {
      if (unitIds.length === 0) return [];
      return tx
        .select({ unitId: N.unitId, night: N.night, bookingId: N.bookingId, code: B.code })
        .from(N)
        .innerJoin(B, and(eq(B.workspaceId, N.workspaceId), eq(B.id, N.bookingId)))
        .where(
          and(
            eq(N.workspaceId, ws),
            inArray(N.unitId, unitIds),
            gte(N.night, from),
            lt(N.night, to),
          ),
        )
        .orderBy(asc(N.unitId), asc(N.night));
    },

    async expireOverdueHolds(now) {
      const rows = await tx
        .update(B)
        .set({ status: 'expired', version: sql`${B.version} + 1`, updatedAt: now })
        .where(and(eq(B.workspaceId, ws), eq(B.status, 'hold'), lte(B.holdExpiresAt, now)))
        .returning();
      if (rows.length === 0) return [];
      await tx.delete(N).where(
        and(
          eq(N.workspaceId, ws),
          inArray(
            N.bookingId,
            rows.map((r) => r.id),
          ),
        ),
      );
      return hydrate(rows.sort((a, b) => a.code.localeCompare(b.code)));
    },

    async history(bookingId) {
      const rows = await tx
        .select({ at: A.createdAt, actorName: A.actorName, action: A.action, data: A.data })
        .from(A)
        .where(
          and(
            eq(A.workspaceId, ws),
            eq(A.targetType, 'lodging_booking'),
            eq(A.targetId, bookingId),
          ),
        )
        .orderBy(asc(A.createdAt), asc(A.id));
      return rows.map((r) => ({ ...r, at: r.at.toISOString() }));
    },

    async audit(actorId, targetType, id, action, data) {
      await writeAudit(tx, {
        workspaceId: ws,
        actorUserId: actorId,
        actorName: null,
        action,
        targetType,
        targetId: id,
        data,
      });
    },

    async publish(event) {
      const aggregateId = event.payload.bookingId;
      if (typeof aggregateId !== 'string') {
        throw new Error(`lodging event ${event.name} needs payload.bookingId`);
      }
      await writeOutbox(tx, {
        workspaceId: ws,
        type: event.name,
        aggregateType: 'lodging_booking',
        aggregateId,
        payload: { type: event.name, ...event.payload },
      });
    },
  };
  return bookings;
}
