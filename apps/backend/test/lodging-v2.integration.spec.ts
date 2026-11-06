import {
  createDb,
  ensureLoginRoles,
  migrate,
  sql,
  withCredentials,
  type Database,
} from '@agent-sales/db';
import { newId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  BookingRecord,
  PropertyRecord,
  UnitRecord,
} from '../src/modules/lodging/application/ports/lodging-store.js';
import { unitDetails } from '../src/modules/lodging/__tests__/factories/units.js';
import { LodgingError } from '../src/modules/lodging/domain/lodging.errors.js';
import { DrizzleLodgingStore } from '../src/modules/lodging/infrastructure/persistence/lodging.drizzle-store.js';

/**
 * T-160 lodging v2 store: tenant-scoped persistence with one row per occupied unit-night.
 * Store-level cases against a real PostgreSQL (Testcontainers), as app_tenant under RLS.
 */
let pg: TestPostgres;
let owner: { db: Database; close: () => Promise<void> };
let tenant: { db: Database; close: () => Promise<void> };
let store: DrizzleLodgingStore;

const user = newId();
const ws = workspaceId(newId());
const otherWs = workspaceId(newId());
const NOW = '2026-11-01T00:00:00.000Z';

function property(over: Partial<PropertyRecord> = {}): PropertyRecord {
  return {
    id: newId(),
    code: 'A17',
    name: 'SKY VILLA A17',
    area: 'Sân golf Tam Đảo',
    address: '',
    description: 'Villa',
    sellMode: 'whole',
    status: 'active',
    standardAdults: 24,
    standardChildren: 8,
    maxGuests: null,
    childFreeBelow: 6,
    childAdultFrom: 12,
    amenities: ['Bể bơi'],
    layout: [{ name: 'Phòng 1', beds: '1 giường đôi', note: '' }],
    policies: {
      checkInTime: '14:00',
      checkOutTime: '12:00',
      deposit: '50%',
      cancellation: '',
      houseRules: '',
      other: '',
    },
    gallery: [
      {
        id: 'pool',
        name: 'Hồ bơi',
        items: [{ kind: 'image', url: 'https://media.rapiz.test/a17/0.jpg', caption: 'Hồ bơi' }],
      },
    ],
    galleryCover: '',
    internalNote: '',
    surcharges: { extraAdult: { sell: 300_000, cost: 200_000 }, extraChild: null },
    sortOrder: 0,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function unit(propertyId: string, over: Partial<UnitRecord> = {}): UnitRecord {
  return {
    ...unitDetails(),
    id: newId(),
    propertyId,
    kind: 'whole',
    name: 'SKY VILLA A17',
    beds: '',
    capacityAdults: 24,
    capacityChildren: 8,
    active: true,
    sortOrder: 0,
    ...over,
  };
}

function booking(propertyId: string, unitIds: string[], over: Partial<BookingRecord> = {}) {
  const b: BookingRecord = {
    id: newId(),
    code: 'BK-X',
    propertyId,
    kind: 'stay',
    whole: true,
    unitIds,
    unitPackages: {},
    status: 'confirmed',
    checkIn: '2027-01-08',
    checkOut: '2027-01-10',
    adults: 20,
    childAges: [4, 9],
    guestName: 'Anh Nam',
    guestPhone: '0900000001',
    contactId: null,
    conversationId: null,
    source: 'phone',
    holdExpiresAt: null,
    quote: {
      nights: [{ date: '2027-01-08', weekday: 5, label: '', sell: 13_000_000, cost: 12_000_000 }],
      surcharges: [],
      totalSell: 13_000_000,
      totalCost: 12_000_000,
      warnings: [],
      packages: [],
    },
    adjustment: 0,
    adjustmentReason: '',
    totalSell: 26_000_000,
    totalCost: 24_000_000,
    note: '',
    tags: [],
    blockReason: '',
    reviewedAt: null,
    reviewedBy: null,
    clientRequestId: newId(),
    fingerprint: 'fp',
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
  return b;
}

/** A property with its whole unit, created in `w`. */
async function seedProperty(w: WorkspaceId, over: Partial<PropertyRecord> = {}) {
  const p = property(over);
  const u = unit(p.id, { name: p.name });
  await store.run(w, async (tx) => {
    await tx.insertProperty(p);
    await tx.replaceUnits(p.id, [u]);
  });
  return { p, u };
}

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  owner = createDb({ url: pg.ownerUrl, max: 1 });
  tenant = createDb({
    url: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
    max: 4,
  });
  store = new DrizzleLodgingStore(tenant.db);
  await owner.db.execute(
    sql`insert into users (id, email, name) values (${user}, 'villa@example.test', 'Chủ villa')`,
  );
  for (const w of [ws, otherWs])
    await owner.db
      .execute(sql`insert into workspaces (id, workspace_id, name, industry, owner_user_id)
      values (${w}, ${w}, 'Villas', 'hotel', ${user})`);
});
afterAll(async () => {
  await tenant?.close();
  await owner?.close();
  await pg?.stop();
});

describe('DrizzleLodgingStore', () => {
  it('round-trips a property with units, rates and surcharges, and isolates tenants', async () => {
    const { p, u } = await seedProperty(ws, { code: 'RT1' });
    const rateIds = [newId(), newId()];
    await store.run(ws, async (tx) => {
      await tx.replaceWeekdayRates(p.id, [
        {
          id: rateIds[0]!,
          unitId: null,
          kind: 'weekday',
          weekdays: [1, 2, 3, 4, 5],
          dateFrom: null,
          dateTo: null,
          label: '',
          sell: 12_000_000,
          cost: 11_000_000,
          minNights: null,
          packageId: null,
        },
        {
          id: rateIds[1]!,
          unitId: null,
          kind: 'weekday',
          weekdays: [6, 7],
          dateFrom: null,
          dateTo: null,
          label: '',
          sell: 14_000_000,
          cost: 13_000_000,
          minNights: null,
          packageId: null,
        },
      ]);
      await tx.insertOverride(p.id, {
        id: newId(),
        unitId: u.id,
        kind: 'override',
        weekdays: [],
        dateFrom: '2027-02-10',
        dateTo: '2027-02-14',
        label: 'Tết',
        sell: 20_000_000,
        cost: 18_000_000,
        minNights: 2,
        packageId: null,
      });
    });
    const got = await store.run(ws, async (tx) => ({
      p: await tx.property(p.id),
      units: await tx.units([p.id]),
      rates: await tx.rates([p.id]),
      all: await tx.properties({ ids: [p.id] }),
    }));
    expect(got.p).toEqual(p);
    expect(got.all).toEqual([p]);
    expect(got.units).toEqual([u]);
    expect(got.rates).toHaveLength(3);
    expect(got.rates.find((r) => r.kind === 'override')).toMatchObject({
      unitId: u.id,
      dateFrom: '2027-02-10',
      dateTo: '2027-02-14',
      minNights: 2,
      packageId: null,
      sell: 20_000_000,
    });
    const { p: bare } = await seedProperty(ws, { code: 'RT2' });
    const grouped = await store.run(ws, (tx) => tx.ratesByProperty([p.id, bare.id]));
    expect([...grouped.keys()]).toEqual([p.id, bare.id]);
    expect(grouped.get(p.id)).toEqual(got.rates);
    expect(grouped.get(bare.id)).toEqual([]);

    const other = await store.run(otherWs, async (tx) => ({
      all: await tx.properties(),
      one: await tx.property(p.id),
      rates: await tx.ratesByProperty([p.id]),
    }));
    expect(other.all).toHaveLength(0);
    expect(other.one).toBeNull();
    expect(other.rates.get(p.id)).toEqual([]);
  });

  it('updates a property and replaces weekday rates without touching overrides', async () => {
    const { p } = await seedProperty(ws, { code: 'UP1' });
    const overrideId = newId();
    const weekday = (weekdays: number[], sell: number) => ({
      id: newId(),
      unitId: null,
      kind: 'weekday' as const,
      weekdays,
      dateFrom: null,
      dateTo: null,
      label: '',
      sell,
      cost: sell,
      minNights: null,
      packageId: null,
    });
    await store.run(ws, async (tx) => {
      await tx.replaceWeekdayRates(p.id, [weekday([1, 2, 3, 4, 5, 6, 7], 1)]);
      await tx.insertOverride(p.id, {
        ...weekday([], 5),
        id: overrideId,
        kind: 'override',
        dateFrom: '2027-03-01',
        dateTo: '2027-03-02',
        label: 'Lễ',
      });
      await tx.replaceWeekdayRates(p.id, [weekday([1, 2, 3, 4, 5, 6, 7], 2)]);
      await tx.updateOverride(p.id, {
        ...weekday([], 7),
        id: overrideId,
        kind: 'override',
        dateFrom: '2027-03-01',
        dateTo: '2027-03-03',
        label: 'Lễ 2',
      });
      await tx.updateProperty({
        ...p,
        name: 'Renamed',
        surcharges: { extraAdult: null, extraChild: { sell: 1, cost: 1 } },
        version: 2,
        updatedAt: '2026-11-02T00:00:00.000Z',
      });
    });
    const after = await store.run(ws, async (tx) => ({
      p: await tx.property(p.id, true),
      rates: await tx.rates([p.id]),
      deleted: await tx.deleteOverride(p.id, overrideId),
      deletedAgain: await tx.deleteOverride(p.id, overrideId),
    }));
    expect(after.p).toMatchObject({
      name: 'Renamed',
      version: 2,
      surcharges: { extraAdult: null, extraChild: { sell: 1, cost: 1 } },
      updatedAt: '2026-11-02T00:00:00.000Z',
    });
    expect(after.rates.map((r) => [r.kind, r.sell, r.label])).toEqual(
      expect.arrayContaining([
        ['weekday', 2, ''],
        ['override', 7, 'Lễ 2'],
      ]),
    );
    expect(after.rates).toHaveLength(2);
    expect(after.deleted).toBe(true);
    expect(after.deletedAgain).toBe(false);
  });

  it('issues booking codes BK-0001, BK-0002 per workspace', async () => {
    const codes = await store.run(otherWs, async (tx) => [
      await tx.nextBookingCode(),
      await tx.nextBookingCode(),
    ]);
    expect(codes).toEqual(['BK-0001', 'BK-0002']);
    expect(await store.run(otherWs, (tx) => tx.settings())).toEqual({ holdMinutes: 120 });
    await store.run(otherWs, (tx) => tx.updateSettings({ holdMinutes: 60 }));
    expect(await store.run(otherWs, (tx) => tx.settings())).toEqual({ holdMinutes: 60 });
    expect(await store.run(otherWs, (tx) => tx.nextBookingCode())).toBe('BK-0003');
  });

  it('round-trips a booking with its units and nights', async () => {
    const { p, u } = await seedProperty(ws, { code: 'BK1' });
    const b = booking(p.id, [u.id], { code: 'BK-RT' });
    await store.run(ws, async (tx) => {
      await tx.insertBooking(b);
      await tx.takeNights(b.id, [u.id], ['2027-01-08', '2027-01-09']);
    });
    const got = await store.run(ws, async (tx) => ({
      byId: await tx.findBooking(b.id, true),
      byRequest: await tx.findBookingByRequest(b.clientRequestId),
      taken: await tx.takenNights([u.id], '2027-01-01', '2027-01-31'),
      range: await tx.bookingsInRange([p.id], '2027-01-09', '2027-01-12'),
      outside: await tx.bookingsInRange([p.id], '2027-01-10', '2027-01-12'),
    }));
    expect(got.byId).toEqual(b);
    expect(got.byRequest).toEqual(b);
    expect(got.taken).toEqual([
      { unitId: u.id, night: '2027-01-08', bookingId: b.id, code: 'BK-RT' },
      { unitId: u.id, night: '2027-01-09', bookingId: b.id, code: 'BK-RT' },
    ]);
    expect(got.range.map((r) => r.id)).toEqual([b.id]);
    expect(got.outside).toEqual([]);

    await store.run(ws, async (tx) => {
      await tx.updateBooking({ ...b, status: 'cancelled', version: 2 });
      await tx.releaseNights(b.id);
    });
    const after = await store.run(ws, async (tx) => ({
      b: await tx.findBooking(b.id),
      taken: await tx.takenNights([u.id], '2027-01-01', '2027-01-31'),
      range: await tx.bookingsInRange([p.id], '2027-01-01', '2027-01-31'),
    }));
    expect(after.b).toMatchObject({ status: 'cancelled', version: 2 });
    expect(after.taken).toEqual([]);
    expect(after.range).toEqual([]);
  });

  it('lets exactly one of two concurrent bookings take the same unit-night', async () => {
    const { p, u } = await seedProperty(ws, { code: 'RACE' });
    const a = booking(p.id, [u.id], { code: 'BK-A' });
    const b = booking(p.id, [u.id], { code: 'BK-B' });
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>((r) => (release = r));
    const attempt = (bk: BookingRecord) =>
      store.run(ws, async (tx) => {
        await tx.insertBooking(bk);
        if (++arrived === 2) release();
        await barrier;
        await tx.takeNights(bk.id, [u.id], ['2027-05-01', '2027-05-02']);
        return bk.code;
      });
    const results = await Promise.allSettled([attempt(a), attempt(b)]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    const winner = (won[0] as PromiseFulfilledResult<string>).value;
    const error = (lost[0] as PromiseRejectedResult).reason as LodgingError;
    expect(error).toBeInstanceOf(LodgingError);
    expect(error.code).toBe('NIGHTS_TAKEN');
    expect(error.details).toMatchObject({ codes: [winner] });

    const taken = await store.run(ws, (tx) => tx.takenNights([u.id], '2027-05-01', '2027-05-03'));
    expect(taken.map((t) => t.code)).toEqual([winner, winner]);
  });

  it('sums the revenue stays checking in on the given nights (scheduled reports)', async () => {
    const { p, u } = await seedProperty(ws, { code: 'REV1' });
    const at = (checkIn: string, checkOut: string, over: Partial<BookingRecord> = {}) =>
      booking(p.id, [u.id], { code: `BK-${checkIn}`, checkIn, checkOut, ...over });
    const rows = [
      at('2028-05-02', '2028-05-04'),
      at('2028-05-05', '2028-05-06', {
        status: 'checked_out',
        totalSell: 15_000_000,
        totalCost: 13_000_000,
      }),
      at('2028-05-03', '2028-05-04', { status: 'cancelled' }),
      at('2028-05-06', '2028-05-07', {
        status: 'hold',
        holdExpiresAt: '2028-05-01T00:00:00.000Z',
      }),
      // A block is not a stay.
      at('2028-05-04', '2028-05-05', { kind: 'block', status: 'active', blockReason: 'Sửa chữa' }),
      // Checks in after the range.
      at('2028-05-08', '2028-05-09'),
    ];
    await store.run(ws, async (tx) => {
      for (const b of rows) await tx.insertBooking(b);
    });
    expect(await store.run(ws, (tx) => tx.stayTotals('2028-05-01', '2028-05-07'))).toEqual({
      bookings: 2,
      nights: 3,
      revenue: 41_000_000,
      cost: 37_000_000,
    });
    // Another business sees none of them.
    expect(await store.run(otherWs, (tx) => tx.stayTotals('2028-05-01', '2028-05-07'))).toEqual({
      bookings: 0,
      nights: 0,
      revenue: 0,
      cost: 0,
    });
  });

  it('refuses to delete a unit that holds nights with CONFLICT', async () => {
    const { p, u } = await seedProperty(ws, { code: 'DEL', sellMode: 'rooms' });
    const b = booking(p.id, [u.id], { code: 'BK-DEL' });
    await store.run(ws, async (tx) => {
      await tx.insertBooking(b);
      await tx.takeNights(b.id, [u.id], ['2027-06-01']);
    });
    const room = unit(p.id, { kind: 'room', name: 'Phòng 2' });
    await expect(store.run(ws, (tx) => tx.replaceUnits(p.id, [room]))).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const units = await store.run(ws, (tx) => tx.units([p.id]));
    expect(units.map((x) => x.id)).toEqual([u.id]);

    // A unit without nights is deleted; a kept unit is updated in place.
    // Its room rates go with it (lodging_rates_unit_fk cascades).
    await store.run(ws, async (tx) => {
      await tx.replaceUnits(p.id, [{ ...u, name: 'Đổi tên' }, room]);
      await tx.insertOverride(p.id, {
        id: newId(),
        unitId: room.id,
        kind: 'override',
        weekdays: [],
        dateFrom: '2027-06-10',
        dateTo: '2027-06-10',
        label: 'Phòng 2',
        sell: 1,
        cost: 1,
        minNights: null,
        packageId: null,
      });
    });
    await store.run(ws, (tx) => tx.replaceUnits(p.id, [{ ...u, name: 'Đổi tên' }]));
    const kept = await store.run(ws, async (tx) => ({
      units: await tx.units([p.id]),
      rates: await tx.rates([p.id]),
    }));
    expect(kept).toEqual({ units: [{ ...u, name: 'Đổi tên' }], rates: [] });
  });

  it('expires overdue holds and frees their nights', async () => {
    const { p, u } = await seedProperty(ws, { code: 'EXP' });
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const overdue = booking(p.id, [u.id], {
      code: 'BK-OLD',
      status: 'hold',
      holdExpiresAt: past,
    });
    const fresh = booking(p.id, [u.id], {
      code: 'BK-NEW',
      status: 'hold',
      holdExpiresAt: future,
      checkIn: '2027-07-05',
      checkOut: '2027-07-06',
    });
    await store.run(ws, async (tx) => {
      await tx.insertBooking(overdue);
      await tx.takeNights(overdue.id, [u.id], ['2027-07-01']);
      await tx.insertBooking(fresh);
      await tx.takeNights(fresh.id, [u.id], ['2027-07-05']);
    });
    const expired = await store.run(ws, (tx) => tx.expireOverdueHolds(new Date()));
    expect(expired.map((e) => [e.id, e.status, e.version])).toEqual([[overdue.id, 'expired', 2]]);
    const taken = await store.run(ws, (tx) => tx.takenNights([u.id], '2027-07-01', '2027-07-31'));
    expect(taken.map((t) => t.code)).toEqual(['BK-NEW']);
    expect(await store.run(otherWs, (tx) => tx.expireOverdueHolds(new Date()))).toEqual([]);
  });

  it('lists bookings by view, filter and search', async () => {
    const w = workspaceId(newId());
    await owner.db
      .execute(sql`insert into workspaces (id, workspace_id, name, industry, owner_user_id)
      values (${w}, ${w}, 'List', 'hotel', ${user})`);
    const { p, u } = await seedProperty(w, { code: 'LST' });
    const conversation = newId();
    const today = '2027-08-10';
    const mk = (code: string, over: Partial<BookingRecord>) =>
      booking(p.id, [u.id], { code, ...over });
    const rows = [
      mk('BK-IN', {
        checkIn: today,
        checkOut: '2027-08-12',
        createdAt: '2026-11-01T00:00:01.000Z',
      }),
      mk('BK-OUT', {
        status: 'checked_in',
        checkIn: '2027-08-08',
        checkOut: today,
        createdAt: '2026-11-01T00:00:02.000Z',
      }),
      mk('BK-H2', {
        status: 'hold',
        holdExpiresAt: '2030-01-02T00:00:00.000Z',
        checkIn: '2027-08-20',
        checkOut: '2027-08-21',
        createdAt: '2026-11-01T00:00:03.000Z',
      }),
      mk('BK-H1', {
        status: 'hold',
        holdExpiresAt: '2030-01-01T00:00:00.000Z',
        checkIn: '2027-08-15',
        checkOut: '2027-08-16',
        guestName: 'Chị Lan',
        guestPhone: '0912345678',
        conversationId: conversation,
        createdAt: '2026-11-01T00:00:04.000Z',
      }),
      mk('BK-PAST', {
        checkIn: '2027-08-01',
        checkOut: '2027-08-03',
        createdAt: '2026-11-01T00:00:05.000Z',
      }),
      mk('BK-CXL', {
        status: 'cancelled',
        checkIn: today,
        checkOut: '2027-08-11',
        createdAt: '2026-11-01T00:00:06.000Z',
      }),
      mk('BK-BLK', {
        kind: 'block',
        status: 'active',
        blockReason: 'Sửa chữa',
        checkIn: '2027-09-01',
        checkOut: '2027-09-02',
        createdAt: '2026-11-01T00:00:07.000Z',
      }),
    ];
    await store.run(w, async (tx) => {
      for (const r of rows) await tx.insertBooking(r);
    });
    const list = (q: Record<string, unknown>) =>
      store.run(w, async (tx) =>
        (
          await tx.listBookings({ view: 'all', offset: 0, ...q, today } as Parameters<
            typeof tx.listBookings
          >[0])
        ).map((b) => b.code),
      );
    expect(await list({ view: 'today' })).toEqual(expect.arrayContaining(['BK-IN', 'BK-OUT']));
    expect(await list({ view: 'today' })).toHaveLength(2);
    expect(await list({ view: 'holds' })).toEqual(['BK-H1', 'BK-H2']);
    expect(await list({ view: 'upcoming' })).toEqual(['BK-OUT', 'BK-IN', 'BK-H1', 'BK-H2']);
    expect(await list({ view: 'all' })).toEqual([
      'BK-BLK',
      'BK-CXL',
      'BK-PAST',
      'BK-H1',
      'BK-H2',
      'BK-OUT',
      'BK-IN',
    ]);
    expect(await list({ status: 'cancelled' })).toEqual(['BK-CXL']);
    expect(await list({ q: 'lan' })).toEqual(['BK-H1']);
    expect(await list({ q: '0912' })).toEqual(['BK-H1']);
    expect(await list({ q: 'bk-pa' })).toEqual(['BK-PAST']);
    expect(await list({ q: '%' })).toEqual([]);
    expect(await list({ conversationId: conversation })).toEqual(['BK-H1']);
    expect(await list({ propertyId: newId() })).toEqual([]);
    expect(await list({ offset: 6 })).toEqual(['BK-IN']);
  });

  it('writes audit history and outbox events in the same transaction', async () => {
    const { p, u } = await seedProperty(ws, { code: 'AUD' });
    const b = booking(p.id, [u.id], { code: 'BK-AUD' });
    await store.run(ws, async (tx) => {
      await tx.insertBooking(b);
      await tx.audit(user, 'lodging_booking', b.id, 'lodging.booking.created', { status: 'hold' });
      await tx.publish({
        name: 'lodging.booking.created.v1',
        payload: { bookingId: b.id, code: b.code },
      });
    });
    await store.run(ws, (tx) =>
      tx.audit(null, 'lodging_booking', b.id, 'lodging.booking.expired', {}),
    );
    const history = await store.run(ws, (tx) => tx.history(b.id));
    expect(history.map((h) => [h.action, h.actorName, h.data])).toEqual([
      ['lodging.booking.created', null, { status: 'hold' }],
      ['lodging.booking.expired', null, {}],
    ]);
    expect(history[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await store.run(otherWs, (tx) => tx.history(b.id))).toEqual([]);
    const events = (await owner.db.execute(
      sql`select type, aggregate_type, aggregate_id, payload from outbox_events
          where aggregate_id = ${b.id}`,
    )) as unknown as Record<string, unknown>[];
    expect(events).toEqual([
      {
        type: 'lodging.booking.created.v1',
        aggregate_type: 'lodging_booking',
        aggregate_id: b.id,
        payload: { type: 'lodging.booking.created.v1', bookingId: b.id, code: 'BK-AUD' },
      },
    ]);

    // Nothing is written when the transaction fails.
    await expect(
      store.run(ws, async (tx) => {
        await tx.publish({ name: 'lodging.booking.cancelled.v1', payload: { bookingId: b.id } });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const [count] = (await owner.db.execute(
      sql`select count(*)::int as n from outbox_events where aggregate_id = ${b.id}`,
    )) as unknown as { n: number }[];
    expect(count!.n).toBe(1);
  });

  it('stores bot property selections (null when none) and serializes request keys', async () => {
    const { p } = await seedProperty(ws, { code: 'BOT' });
    const bot = newId();
    expect(await store.run(ws, (tx) => tx.botPropertyIds(bot))).toBeNull();
    await store.run(ws, (tx) => tx.setBotProperties(bot, [p.id]));
    expect(await store.run(ws, (tx) => tx.botPropertyIds(bot))).toEqual([p.id]);
    await store.run(ws, (tx) => tx.setBotProperties(bot, []));
    expect(await store.run(ws, (tx) => tx.botPropertyIds(bot))).toBeNull();
    await store.run(ws, (tx) => tx.lockRequestKey(newId()));
  });
});
