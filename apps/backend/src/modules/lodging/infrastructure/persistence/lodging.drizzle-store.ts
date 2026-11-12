import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  notInArray,
  schema,
  sql,
  withTenant,
  type Database,
  type TenantTx,
} from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type { LodgingStore, LodgingTx } from '../../application/ports/lodging-store.js';
import { LodgingError } from '../../domain/lodging.errors.js';
import type { RateRule } from '../../domain/rates.js';
import { botHoldPort } from './lodging-bot-holds.drizzle.js';
import { bookingPort } from './lodging-bookings.drizzle.js';
import {
  packageValues,
  pgCode,
  propertyValues,
  rateValues,
  toPackage,
  toProperty,
  toRate,
  toUnit,
  unitValues,
} from './lodging.rows.js';

const P = schema.lodgingProperties;
const U = schema.lodgingUnits;
const R = schema.lodgingRates;
const PK = schema.lodgingPackages;
const S = schema.lodgingSettings;
const BP = schema.lodgingBotProperties;
const NN = schema.lodgingNightNotes;
const B = schema.lodgingBookings;

const toNote = (r: typeof NN.$inferSelect) => ({
  id: r.id,
  propertyId: r.propertyId,
  unitId: r.unitId,
  night: r.night,
  text: r.text,
});

/** Drizzle adapter for the lodging port; every call runs in one tenant transaction (RLS). */
export class DrizzleLodgingStore implements LodgingStore {
  constructor(private readonly db: Database) {}

  run<T>(ws: WorkspaceId, fn: (tx: LodgingTx) => Promise<T>): Promise<T> {
    return withTenant(this.db, ws, (tx) => fn(lodgingTx(tx, ws)));
  }
}

/** A duplicate property code (23505) → CONFLICT; the transaction is aborted, so callers rethrow. */
async function uniqueCode(write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (e) {
    if (pgCode(e) === '23505') {
      throw new LodgingError('CONFLICT', 'Another property already uses this code');
    }
    throw e;
  }
}

function lodgingTx(tx: TenantTx, ws: WorkspaceId): LodgingTx {
  return {
    ...bookingPort(tx, ws),
    ...botHoldPort(tx, ws),
    async properties(filter = {}) {
      if (filter.ids?.length === 0) return [];
      const rows = await tx
        .select()
        .from(P)
        .where(
          and(
            eq(P.workspaceId, ws),
            filter.ids ? inArray(P.id, filter.ids) : undefined,
            filter.activeOnly ? eq(P.status, 'active') : undefined,
          ),
        )
        .orderBy(asc(P.sortOrder), asc(P.code));
      return rows.map(toProperty);
    },

    async property(id, lock) {
      const q = tx
        .select()
        .from(P)
        .where(and(eq(P.workspaceId, ws), eq(P.id, id)))
        .limit(1);
      // NO KEY UPDATE: FOR UPDATE would wait on the FK KEY SHARE locks of concurrent booking inserts.
      const [r] = await (lock ? q.for('no key update') : q);
      return r ? toProperty(r) : null;
    },

    async insertProperty(p) {
      await uniqueCode(() => tx.insert(P).values(propertyValues(ws, p)));
    },

    async updateProperty(p) {
      const { id: _id, workspaceId: _ws, createdAt: _created, ...set } = propertyValues(ws, p);
      await uniqueCode(() =>
        tx
          .update(P)
          .set(set)
          .where(and(eq(P.workspaceId, ws), eq(P.id, p.id))),
      );
    },

    async propertyHasBookings(propertyId) {
      const [r] = await tx
        .select({ x: sql`1` })
        .from(B)
        .where(and(eq(B.workspaceId, ws), eq(B.propertyId, propertyId)))
        .limit(1);
      return Boolean(r);
    },

    async deleteProperty(propertyId) {
      try {
        await tx.delete(P).where(and(eq(P.workspaceId, ws), eq(P.id, propertyId)));
      } catch (e) {
        if (pgCode(e) === '23503') {
          throw new LodgingError('CONFLICT', 'The property has bookings', {
            reason: 'property_has_bookings',
          });
        }
        throw e;
      }
    },

    async units(propertyIds) {
      if (propertyIds.length === 0) return [];
      const rows = await tx
        .select()
        .from(U)
        .where(and(eq(U.workspaceId, ws), inArray(U.propertyId, propertyIds)))
        .orderBy(asc(U.sortOrder), asc(U.id));
      return rows.map(toUnit);
    },

    async replaceUnits(propertyId, units) {
      const keep = units.map((u) => u.id);
      try {
        await tx
          .delete(U)
          .where(
            and(
              eq(U.workspaceId, ws),
              eq(U.propertyId, propertyId),
              keep.length > 0 ? notInArray(U.id, keep) : undefined,
            ),
          );
      } catch (e) {
        if (pgCode(e) === '23503') {
          throw new LodgingError(
            'CONFLICT',
            'A room with bookings cannot be deleted; deactivate it instead',
            { propertyId },
          );
        }
        throw e;
      }
      for (const u of units) {
        const { id: _id, workspaceId: _ws, propertyId: _p, ...set } = unitValues(ws, propertyId, u);
        await tx
          .insert(U)
          .values(unitValues(ws, propertyId, u))
          .onConflictDoUpdate({
            target: U.id,
            set,
            setWhere: sql`${U.workspaceId} = ${ws} and ${U.propertyId} = ${propertyId}`,
          });
      }
    },

    async packages(propertyIds) {
      if (propertyIds.length === 0) return [];
      const rows = await tx
        .select()
        .from(PK)
        .where(and(eq(PK.workspaceId, ws), inArray(PK.propertyId, propertyIds)))
        .orderBy(asc(PK.sortOrder), asc(PK.id));
      return rows.map(toPackage);
    },

    async replacePackages(propertyId, packages) {
      const keep = packages.map((p) => p.id);
      const own = and(eq(PK.workspaceId, ws), eq(PK.propertyId, propertyId));
      await tx.delete(PK).where(and(own, keep.length > 0 ? notInArray(PK.id, keep) : undefined));
      if (keep.length === 0) return;
      // Kept packages may swap names; park them under their (unique) id first so the
      // case-insensitive name index never sees two equal names mid-statement.
      await tx
        .update(PK)
        .set({ name: sql`${PK.id}::text` })
        .where(and(own, inArray(PK.id, keep)));
      for (const p of packages) {
        const {
          id: _id,
          workspaceId: _ws,
          propertyId: _p,
          ...set
        } = packageValues(ws, propertyId, p);
        await tx
          .insert(PK)
          .values(packageValues(ws, propertyId, p))
          .onConflictDoUpdate({
            target: PK.id,
            set,
            setWhere: sql`${PK.workspaceId} = ${ws} and ${PK.propertyId} = ${propertyId}`,
          });
      }
    },

    async rates(propertyIds) {
      if (propertyIds.length === 0) return [];
      const rows = await tx
        .select()
        .from(R)
        .where(and(eq(R.workspaceId, ws), inArray(R.propertyId, propertyIds)))
        .orderBy(asc(R.kind), asc(R.dateFrom), asc(R.id));
      return rows.map(toRate);
    },

    async ratesByProperty(propertyIds) {
      const byProperty = new Map<string, RateRule[]>(propertyIds.map((id) => [id, []]));
      if (propertyIds.length === 0) return byProperty;
      const rows = await tx
        .select()
        .from(R)
        .where(and(eq(R.workspaceId, ws), inArray(R.propertyId, propertyIds)))
        .orderBy(asc(R.kind), asc(R.dateFrom), asc(R.id));
      for (const row of rows) byProperty.get(row.propertyId)?.push(toRate(row));
      return byProperty;
    },

    async replaceWeekdayRates(propertyId, rules) {
      await tx
        .delete(R)
        .where(and(eq(R.workspaceId, ws), eq(R.propertyId, propertyId), eq(R.kind, 'weekday')));
      if (rules.length > 0)
        await tx.insert(R).values(rules.map((r) => rateValues(ws, propertyId, r)));
    },

    async insertOverride(propertyId, r) {
      await tx.insert(R).values(rateValues(ws, propertyId, { ...r, kind: 'override' }));
    },

    async updateOverride(propertyId, r) {
      const {
        id: _id,
        workspaceId: _ws,
        propertyId: _p,
        ...set
      } = rateValues(ws, propertyId, {
        ...r,
        kind: 'override',
      });
      await tx
        .update(R)
        .set(set)
        .where(
          and(
            eq(R.workspaceId, ws),
            eq(R.propertyId, propertyId),
            eq(R.id, r.id),
            eq(R.kind, 'override'),
          ),
        );
    },

    async deleteOverride(propertyId, rateId) {
      const gone = await tx
        .delete(R)
        .where(
          and(
            eq(R.workspaceId, ws),
            eq(R.propertyId, propertyId),
            eq(R.id, rateId),
            eq(R.kind, 'override'),
          ),
        )
        .returning({ id: R.id });
      return gone.length > 0;
    },

    async settings() {
      const [r] = await tx
        .select({ holdMinutes: S.holdMinutes })
        .from(S)
        .where(eq(S.workspaceId, ws))
        .limit(1);
      return { holdMinutes: r?.holdMinutes ?? 120 };
    },

    async updateSettings(s) {
      await tx
        .insert(S)
        .values({ workspaceId: ws, holdMinutes: s.holdMinutes })
        .onConflictDoUpdate({ target: S.workspaceId, set: { holdMinutes: s.holdMinutes } });
    },

    async nextBookingCode() {
      const [r] = await tx
        .insert(S)
        .values({ workspaceId: ws, bookingSeq: 1 })
        .onConflictDoUpdate({
          target: S.workspaceId,
          set: { bookingSeq: sql`${S.bookingSeq} + 1` },
        })
        .returning({ seq: S.bookingSeq });
      if (!r) throw new Error('lodging_settings upsert returned no row');
      return `BK-${String(r.seq).padStart(4, '0')}`;
    },

    async lockRequestKey(key) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${ws}:lodging:${key}`}, 0))`,
      );
    },

    async botPropertyIds(botId) {
      const rows = await tx
        .select({ propertyId: BP.propertyId })
        .from(BP)
        .where(and(eq(BP.workspaceId, ws), eq(BP.botId, botId)))
        .orderBy(asc(BP.propertyId));
      return rows.length > 0 ? rows.map((r) => r.propertyId) : null;
    },

    async setBotProperties(botId, propertyIds) {
      await tx.delete(BP).where(and(eq(BP.workspaceId, ws), eq(BP.botId, botId)));
      if (propertyIds.length > 0) {
        await tx
          .insert(BP)
          .values(
            [...new Set(propertyIds)].map((propertyId) => ({ workspaceId: ws, botId, propertyId })),
          );
      }
    },

    async nightNotes(propertyIds, from, to) {
      if (propertyIds.length === 0) return [];
      const rows = await tx
        .select()
        .from(NN)
        .where(
          and(
            eq(NN.workspaceId, ws),
            inArray(NN.propertyId, propertyIds),
            gte(NN.night, from),
            lt(NN.night, to),
          ),
        )
        .orderBy(asc(NN.night), asc(NN.id));
      return rows.map(toNote);
    },

    async upsertNightNote(note, updatedBy) {
      const now = new Date();
      const [row] = await tx
        .insert(NN)
        .values({
          id: note.id,
          workspaceId: ws,
          propertyId: note.propertyId,
          unitId: note.unitId,
          night: note.night,
          text: note.text,
          updatedBy,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [NN.workspaceId, NN.propertyId, NN.unitId, NN.night],
          set: { text: note.text, updatedBy, updatedAt: now },
        })
        .returning();
      if (!row) throw new Error('lodging_night_notes upsert returned no row');
      return toNote(row);
    },

    async deleteNightNote(propertyId, unitId, night) {
      await tx
        .delete(NN)
        .where(
          and(
            eq(NN.workspaceId, ws),
            eq(NN.propertyId, propertyId),
            unitId === null ? isNull(NN.unitId) : eq(NN.unitId, unitId),
            eq(NN.night, night),
          ),
        );
    },

    async addPropertyToBots(propertyId) {
      await tx.execute(sql`
        insert into ${BP} (workspace_id, bot_id, property_id)
        select distinct workspace_id, bot_id, ${propertyId}::uuid from ${BP}
        where workspace_id = ${ws}
        on conflict do nothing`);
    },
  };
}
