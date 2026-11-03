import {
  AuthResponse,
  AvailabilityDto,
  BookingDetail,
  BookingList,
  BootstrapResponse,
  CalendarDto,
  PropertyDto,
  QuoteDto,
} from '@agent-sales/contracts';
import {
  and,
  createDb,
  ensureLoginRoles,
  eq,
  migrate,
  schema,
  withCredentials,
  type Database,
} from '@agent-sales/db';
import { newId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import { addNights, localToday } from '../src/modules/lodging/domain/nights.js';
import { signUpVerified } from './support/signup.js';

/** T-160 lodging v2 HTTP: bookings, holds, calendar, availability and quote. */
let pg: TestPostgres;
let app: NestFastifyApplication;
let owner: { db: Database; close: () => Promise<void> };
let tenant: { db: Database; close: () => Promise<void> };

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  const tenantUrl = withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password);
  owner = createDb({ url: pg.ownerUrl, max: 1 });
  tenant = createDb({ url: tenantUrl, max: 2 });
  app = (
    await createHttpApp(AppModule, {
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      S3_ENDPOINT: 'http://127.0.0.1:9',
      S3_BUCKET: 'rapiz-test',
      S3_PUBLIC_URL: 'https://media.rapiz.test',
      S3_ACCESS_KEY: 'test',
      S3_SECRET_KEY: 'test',
      DATABASE_URL: tenantUrl,
      DATABASE_SYSTEM_URL: withCredentials(
        pg.ownerUrl,
        pg.systemLogin.user,
        pg.systemLogin.password,
      ),
    })
  ).app;
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app?.close();
  await tenant?.close();
  await owner?.close();
  await pg?.stop();
});

type Headers = Record<string, string>;
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const call = (h: Headers, method: Method, path: string, payload?: object) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({ method, url: '/api/v1' + path, headers: h, ...(payload ? { payload } : {}) });

let signups = 0;
async function signup(industry = 'hotel') {
  const n = ++signups;
  const r = await signUpVerified(
    app,
    {
      name: 'Test owner',
      email: `lodging-bookings-${n}@example.test`,
      password: 'a long synthetic password',
      workspaceName: 'Test lodging business',
      industry,
    },
    { remoteAddress: `10.89.0.${n}` },
  );
  expect(r.statusCode).toBe(201);
  const auth = AuthResponse.parse(r.json());
  const authorization = `Bearer ${auth.accessToken}`;
  const boot = BootstrapResponse.parse((await call({ authorization }, 'GET', '/bootstrap')).json());
  const ws = boot.memberships[0]?.workspaceId ?? '';
  return { ws, headers: { authorization, 'x-workspace-id': ws } };
}

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const NO_SURCHARGES = { extraAdult: null, extraChild: null };
const today = localToday(new Date());
const night = (n: number) => addNights(today, n);

async function ok<T>(
  r: { statusCode: number; body: string; json: () => unknown },
  parse: { parse: (v: unknown) => T },
  status = 200,
): Promise<T> {
  expect(r.statusCode, r.body).toBe(status);
  return parse.parse(r.json());
}

/** A17-like whole villa: standard 20 adults, 9,000,000 every night. */
async function villa(h: Headers, code = 'A17'): Promise<PropertyDto> {
  const p = await ok(
    await call(h, 'POST', '/lodging/properties', {
      code,
      name: 'SKY VILLA ' + code,
      sellMode: 'whole',
      standardAdults: 20,
      standardChildren: 4,
      maxGuests: 26,
    }),
    PropertyDto,
    201,
  );
  return ok(
    await call(h, 'PUT', `/lodging/properties/${p.id}/rates`, {
      version: p.version,
      weekday: [{ unitId: null, weekdays: ALL_DAYS, sell: 9_000_000, cost: 8_000_000 }],
      surcharges: NO_SURCHARGES,
    }),
    PropertyDto,
  );
}

/** Homestay sold by room: P1 (2 adults, 1,000,000) and P2 (2 adults, 1,200,000). */
async function homestay(h: Headers, code = 'HS1', priced = true): Promise<PropertyDto> {
  const p = await ok(
    await call(h, 'POST', '/lodging/properties', {
      code,
      name: 'Homestay ' + code,
      sellMode: 'rooms',
      standardAdults: 4,
      standardChildren: 0,
    }),
    PropertyDto,
    201,
  );
  const withRooms = await ok(
    await call(h, 'PUT', `/lodging/properties/${p.id}/units`, {
      version: p.version,
      units: [
        { name: 'P1', capacityAdults: 2 },
        { name: 'P2', capacityAdults: 2 },
      ],
    }),
    PropertyDto,
  );
  if (!priced) return withRooms;
  const [p1, p2] = withRooms.units;
  return ok(
    await call(h, 'PUT', `/lodging/properties/${p.id}/rates`, {
      version: withRooms.version,
      weekday: [
        { unitId: p1?.id, weekdays: ALL_DAYS, sell: 1_000_000, cost: 800_000 },
        { unitId: p2?.id, weekdays: ALL_DAYS, sell: 1_200_000, cost: 900_000 },
      ],
      surcharges: NO_SURCHARGES,
    }),
    PropertyDto,
  );
}

const stay = (propertyId: string, from: number, to: number, over: object = {}) => ({
  kind: 'stay',
  clientRequestId: newId(),
  propertyId,
  whole: true,
  unitIds: [],
  checkIn: night(from),
  checkOut: night(to),
  status: 'hold',
  party: { adults: 2, childAges: [] },
  guestName: 'Synthetic guest',
  guestPhone: '0900000000',
  source: 'phone',
  ...over,
});

async function book(h: Headers, body: object): Promise<BookingDetail> {
  return ok(await call(h, 'POST', '/lodging/bookings', body), BookingDetail, 201);
}

async function calendar(h: Headers, from: number, to: number): Promise<CalendarDto> {
  return ok(
    await call(h, 'GET', `/lodging/calendar?from=${night(from)}&to=${night(to)}`),
    CalendarDto,
  );
}

const outbox = (ws: string, type: string) =>
  owner.db
    .select()
    .from(schema.outboxEvents)
    .where(and(eq(schema.outboxEvents.workspaceId, ws), eq(schema.outboxEvents.type, type)));

describe('lodging v2 bookings over HTTP', () => {
  it('answers 404 on every booking route for a non-hotel business', async () => {
    const shop = await signup('fashion');
    for (const [method, path] of [
      ['GET', `/lodging/calendar?from=${night(1)}&to=${night(2)}`],
      ['GET', '/lodging/bookings'],
      ['GET', `/lodging/bookings/${newId()}`],
    ] as const) {
      expect((await call(shop.headers, method, path)).statusCode).toBe(404);
    }
  });

  it('a hold takes the nights, shows on the calendar and blocks a second hold', async () => {
    const o = await signup();
    const p = await villa(o.headers);
    const first = await book(o.headers, stay(p.id, 10, 12));
    expect(first).toMatchObject({
      code: 'BK-0001',
      status: 'hold',
      totalSell: 18_000_000,
      totalCost: 16_000_000,
      unitIds: [p.units[0]?.id],
      propertyCode: 'A17',
    });
    expect(first.holdExpiresAt).not.toBeNull();
    const expires = Date.parse(first.holdExpiresAt ?? '');
    expect(expires - Date.now()).toBeGreaterThan(110 * 60_000);
    expect(first.history.map((e) => e.action)).toEqual(['lodging.booking.created']);
    expect(first.history[0]?.actorName).toBe('Test owner');

    const cal = await calendar(o.headers, 9, 13);
    const row = cal.properties[0]?.rows[0];
    expect(row?.segments).toEqual([
      expect.objectContaining({
        bookingId: first.id,
        code: 'BK-0001',
        status: 'hold',
        from: night(10),
        to: night(12),
        holdExpiresAt: first.holdExpiresAt,
      }),
    ]);
    expect(row?.prices.map((x) => x.sell)).toEqual([9_000_000, 9_000_000, 9_000_000, 9_000_000]);
    expect(cal.properties[0]?.wholePrices[0]?.sell).toBe(9_000_000);

    const second = await call(o.headers, 'POST', '/lodging/bookings', stay(p.id, 11, 13));
    expect(second.statusCode, second.body).toBe(409);
    expect(second.json()).toMatchObject({
      error: { code: 'CONFLICT', details: { reason: 'NIGHTS_TAKEN', codes: ['BK-0001'] } },
    });

    const quote = await ok(
      await call(o.headers, 'POST', '/lodging/quote', {
        propertyId: p.id,
        whole: true,
        checkIn: night(11),
        checkOut: night(13),
        party: { adults: 20, childAges: [] },
      }),
      QuoteDto,
    );
    expect(quote).toMatchObject({ totalSell: 18_000_000, takenBy: ['BK-0001'], warnings: [] });

    const created = await outbox(o.ws, 'lodging.booking.created.v1');
    expect(created).toHaveLength(1);
    expect(created[0]?.payload).toMatchObject({ bookingId: first.id, code: 'BK-0001' });
    expect(JSON.stringify(created[0]?.payload)).not.toContain('Synthetic guest');
  });

  it('a whole rental of a rooms property blocks its rooms and vice versa', async () => {
    const o = await signup();
    const p = await homestay(o.headers);
    const [p1, p2] = p.units;
    const whole = await book(o.headers, stay(p.id, 5, 7, { status: 'confirmed' }));
    expect(whole.unitIds).toEqual([p1?.id, p2?.id]);
    expect(whole.totalSell).toBe(4_400_000);
    const room = await call(
      o.headers,
      'POST',
      '/lodging/bookings',
      stay(p.id, 6, 8, { whole: false, unitIds: [p2?.id, p2?.id] }),
    );
    expect(room.statusCode, room.body).toBe(409);
    expect(room.json()).toMatchObject({ error: { details: { codes: [whole.code] } } });

    const roomFirst = await book(
      o.headers,
      stay(p.id, 20, 22, { whole: false, unitIds: [p1?.id, p1?.id] }),
    );
    expect(roomFirst.unitIds).toEqual([p1?.id]);
    expect(roomFirst.totalSell).toBe(2_000_000);
    const wholeLater = await call(o.headers, 'POST', '/lodging/bookings', stay(p.id, 21, 23));
    expect(wholeLater.statusCode).toBe(409);
    expect(wholeLater.json()).toMatchObject({ error: { details: { codes: [roomFirst.code] } } });

    const foreign = await homestay(o.headers, 'HS2');
    const wrongRoom = await call(
      o.headers,
      'POST',
      '/lodging/bookings',
      stay(p.id, 30, 31, { whole: false, unitIds: [foreign.units[0]?.id] }),
    );
    expect(wrongRoom.statusCode).toBe(400);

    const unpriced = await homestay(o.headers, 'HS3', false);
    const noPrice = await call(o.headers, 'POST', '/lodging/bookings', stay(unpriced.id, 1, 2));
    expect(noPrice.statusCode, noPrice.body).toBe(400);
    const manual = await book(
      o.headers,
      stay(unpriced.id, 1, 2, { manualTotalSell: 1_500_000, adjustment: -100_000 }),
    );
    expect(manual).toMatchObject({ totalSell: 1_400_000, totalCost: null });
  });

  it('replays an idempotent create and rejects a reused key with a different payload', async () => {
    const o = await signup();
    const p = await villa(o.headers);
    const body = stay(p.id, 3, 4);
    const a = await book(o.headers, body);
    const replay = await ok(
      await call(o.headers, 'POST', '/lodging/bookings', body),
      BookingDetail,
      201,
    );
    expect(replay.id).toBe(a.id);
    expect(replay.code).toBe(a.code);
    const changed = await call(o.headers, 'POST', '/lodging/bookings', {
      ...body,
      guestName: 'Other synthetic guest',
    });
    expect(changed.statusCode).toBe(409);
    const list = await ok(await call(o.headers, 'GET', '/lodging/bookings?view=all'), BookingList);
    expect(list.data).toHaveLength(1);
  });

  it('an overdue hold expires on the next read and frees its nights', async () => {
    const o = await signup();
    const p = await villa(o.headers);
    const hold = await book(o.headers, stay(p.id, 4, 6));
    await owner.db
      .update(schema.lodgingBookings)
      .set({ holdExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.lodgingBookings.id, hold.id));
    const cal = await calendar(o.headers, 3, 7);
    expect(cal.properties[0]?.rows[0]?.segments).toEqual([]);
    const detail = await ok(
      await call(o.headers, 'GET', `/lodging/bookings/${hold.id}`),
      BookingDetail,
    );
    expect(detail.status).toBe('expired');
    expect(detail.version).toBe(hold.version + 1);
    const expired = await outbox(o.ws, 'lodging.booking.expired.v1');
    expect(expired).toHaveLength(1);
    expect(expired[0]?.payload).toMatchObject({
      bookingId: hold.id,
      code: hold.code,
      propertyId: p.id,
    });
    expect(JSON.stringify(expired[0]?.payload)).not.toContain('Synthetic guest');
    const again = await book(o.headers, stay(p.id, 4, 6));

    // The property list (today status) expires overdue holds as well.
    await owner.db
      .update(schema.lodgingBookings)
      .set({ holdExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.lodgingBookings.id, again.id));
    expect((await call(o.headers, 'GET', '/lodging/properties')).statusCode).toBe(200);
    expect(await outbox(o.ws, 'lodging.booking.expired.v1')).toHaveLength(2);
  });

  it('runs the status machine: confirm, early check-in refused, cancel frees the nights', async () => {
    const o = await signup();
    const p = await villa(o.headers);
    const hold = await book(o.headers, stay(p.id, 8, 10));
    const path = `/lodging/bookings/${hold.id}/status`;
    const extended = await ok(
      await call(o.headers, 'POST', path, { version: 1, action: 'extend_hold', holdMinutes: 600 }),
      BookingDetail,
    );
    expect(Date.parse(extended.holdExpiresAt ?? '') - Date.now()).toBeGreaterThan(590 * 60_000);
    const confirmed = await ok(
      await call(o.headers, 'POST', path, { version: 2, action: 'confirm' }),
      BookingDetail,
    );
    expect(confirmed).toMatchObject({ status: 'confirmed', holdExpiresAt: null, version: 3 });
    const early = await call(o.headers, 'POST', path, { version: 3, action: 'check_in' });
    expect(early.statusCode, early.body).toBe(409);
    const stale = await call(o.headers, 'POST', path, { version: 1, action: 'cancel' });
    expect(stale.json()).toMatchObject({ error: { details: { reason: 'STALE_VERSION' } } });
    const cancelled = await ok(
      await call(o.headers, 'POST', path, { version: 3, action: 'cancel', reason: 'Guest left' }),
      BookingDetail,
    );
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.history.at(-1)).toMatchObject({
      action: 'lodging.booking.cancelled',
      data: expect.objectContaining({ reason: 'Guest left' }),
    });
    await book(o.headers, stay(p.id, 8, 10));
    expect(await outbox(o.ws, 'lodging.booking.confirmed.v1')).toHaveLength(1);
    expect(await outbox(o.ws, 'lodging.booking.cancelled.v1')).toHaveLength(1);
  });

  it('checks in from the check-in date, then only the check-out date can change', async () => {
    const o = await signup();
    const p = await villa(o.headers);
    const b = await book(o.headers, stay(p.id, 0, 2, { status: 'confirmed' }));
    const path = `/lodging/bookings/${b.id}`;
    const inHouse = await ok(
      await call(o.headers, 'POST', `${path}/status`, { version: 1, action: 'check_in' }),
      BookingDetail,
    );
    expect(inHouse.status).toBe('checked_in');
    const moveIn = await call(o.headers, 'PATCH', path, { version: 2, checkIn: night(1) });
    expect(moveIn.statusCode).toBe(409);
    const longer = await ok(
      await call(o.headers, 'PATCH', path, { version: 2, checkOut: night(3) }),
      BookingDetail,
    );
    expect(longer).toMatchObject({ checkOut: night(3), totalSell: 27_000_000 });
    const out = await ok(
      await call(o.headers, 'POST', `${path}/status`, { version: 3, action: 'check_out' }),
      BookingDetail,
    );
    expect(out.status).toBe('checked_out');
    const todays = await ok(
      await call(o.headers, 'GET', '/lodging/bookings?view=today'),
      BookingList,
    );
    expect(todays.data.map((x) => x.id)).toEqual([b.id]);
  });

  it('a manually priced stay needs a price, or explicit null, when its stay changes', async () => {
    const o = await signup();
    const p = await villa(o.headers);
    const b = await book(o.headers, stay(p.id, 20, 22, { manualTotalSell: 15_000_000 }));
    expect(b.totalSell).toBe(15_000_000);
    const path = `/lodging/bookings/${b.id}`;
    const changes = [
      { checkOut: night(23) },
      { checkIn: night(19) },
      { party: { adults: 3, childAges: [] } },
      { whole: true, unitIds: [p.units[0]?.id] },
    ];
    // An unchanged unit selection is not a change; every other edit above needs a price.
    for (const change of changes.slice(0, 3)) {
      const r = await call(o.headers, 'PATCH', path, { version: 1, ...change });
      expect(r.statusCode, JSON.stringify(change)).toBe(400);
      expect(r.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }
    const sameUnits = await ok(
      await call(o.headers, 'PATCH', path, { version: 1, ...changes[3], note: 'late arrival' }),
      BookingDetail,
    );
    expect(sameUnits).toMatchObject({ version: 2, totalSell: 15_000_000, note: 'late arrival' });
    const repriced = await ok(
      await call(o.headers, 'PATCH', path, {
        version: 2,
        checkOut: night(23),
        manualTotalSell: 20_000_000,
      }),
      BookingDetail,
    );
    expect(repriced).toMatchObject({ checkOut: night(23), totalSell: 20_000_000 });
    const automatic = await ok(
      await call(o.headers, 'PATCH', path, {
        version: 3,
        checkIn: night(21),
        manualTotalSell: null,
      }),
      BookingDetail,
    );
    expect(automatic).toMatchObject({ checkIn: night(21), totalSell: 18_000_000 });
    const followsQuote = await ok(
      await call(o.headers, 'PATCH', path, { version: 4, checkOut: night(24) }),
      BookingDetail,
    );
    expect(followsQuote.totalSell).toBe(27_000_000);
  });

  it('a checked-in stay with a manual price keeps it when its check-out moves', async () => {
    const o = await signup();
    const p = await villa(o.headers);
    const b = await book(
      o.headers,
      stay(p.id, 0, 2, { status: 'confirmed', manualTotalSell: 15_000_000 }),
    );
    const path = `/lodging/bookings/${b.id}`;
    await ok(
      await call(o.headers, 'POST', `${path}/status`, { version: 1, action: 'check_in' }),
      BookingDetail,
    );
    const noChoice = await call(o.headers, 'PATCH', path, { version: 2, checkOut: night(3) });
    expect(noChoice.statusCode, noChoice.body).toBe(400);
    expect(noChoice.json()).toMatchObject({ error: { details: { field: 'manualTotalSell' } } });
    const longer = await ok(
      await call(o.headers, 'PATCH', path, {
        version: 2,
        checkOut: night(3),
        manualTotalSell: 21_000_000,
        adjustment: -500_000,
        adjustmentReason: 'Loyal guest',
      }),
      BookingDetail,
    );
    expect(longer).toMatchObject({
      checkOut: night(3),
      totalSell: 20_500_000,
      adjustmentReason: 'Loyal guest',
    });
    const automatic = await ok(
      await call(o.headers, 'PATCH', path, {
        version: 3,
        checkOut: night(2),
        manualTotalSell: null,
      }),
      BookingDetail,
    );
    expect(automatic).toMatchObject({ checkOut: night(2), totalSell: 17_500_000 });
    const guest = await call(o.headers, 'PATCH', path, { version: 4, guestName: 'Someone else' });
    expect(guest.statusCode).toBe(409);
  });

  it('moving dates re-takes the nights atomically; a conflict keeps the old nights', async () => {
    const o = await signup();
    const p = await villa(o.headers);
    const a = await book(o.headers, stay(p.id, 10, 12));
    const other = await book(o.headers, stay(p.id, 14, 16));
    const clash = await call(o.headers, 'PATCH', `/lodging/bookings/${a.id}`, {
      version: 1,
      checkIn: night(13),
      checkOut: night(15),
    });
    expect(clash.statusCode, clash.body).toBe(409);
    expect(clash.json()).toMatchObject({ error: { details: { codes: [other.code] } } });
    let cal = await calendar(o.headers, 9, 17);
    expect(cal.properties[0]?.rows[0]?.segments.map((s) => [s.code, s.from, s.to])).toEqual([
      [a.code, night(10), night(12)],
      [other.code, night(14), night(16)],
    ]);
    const moved = await ok(
      await call(o.headers, 'PATCH', `/lodging/bookings/${a.id}`, {
        version: 1,
        checkIn: night(11),
        checkOut: night(14),
      }),
      BookingDetail,
    );
    expect(moved).toMatchObject({ version: 2, totalSell: 27_000_000 });
    expect(moved.history.at(-1)).toMatchObject({
      action: 'lodging.booking.updated',
      data: expect.objectContaining({
        previous: expect.objectContaining({ checkIn: night(10), checkOut: night(12) }),
      }),
    });
    cal = await calendar(o.headers, 9, 17);
    expect(cal.properties[0]?.rows[0]?.segments.map((s) => [s.code, s.from, s.to])).toEqual([
      [a.code, night(11), night(14)],
      [other.code, night(14), night(16)],
    ]);
  });

  it('an edit that keeps dates, units and party keeps the stored quote and nights', async () => {
    const o = await signup();
    const p = await villa(o.headers);
    const b = await book(o.headers, stay(p.id, 10, 12, { status: 'confirmed' }));
    expect(b.totalSell).toBe(18_000_000);
    const path = `/lodging/bookings/${b.id}`;
    const adjusted = await ok(
      await call(o.headers, 'PATCH', path, {
        version: 1,
        adjustment: -1_000_000,
        adjustmentReason: 'Repeat guest',
      }),
      BookingDetail,
    );
    expect(adjusted).toMatchObject({ totalSell: 17_000_000, adjustment: -1_000_000 });
    expect(adjusted.quote).toEqual(b.quote);

    // Today's rate changes: a note edit keeps the agreed totals.
    const current = await ok(
      await call(o.headers, 'GET', `/lodging/properties/${p.id}`),
      PropertyDto,
    );
    await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${p.id}/rates`, {
        version: current.version,
        weekday: [{ unitId: null, weekdays: ALL_DAYS, sell: 11_000_000, cost: 9_000_000 }],
        surcharges: NO_SURCHARGES,
      }),
      PropertyDto,
    );
    const noted = await ok(
      await call(o.headers, 'PATCH', path, {
        version: 2,
        note: 'Late arrival',
        guestPhone: '0911111111',
      }),
      BookingDetail,
    );
    expect(noted).toMatchObject({
      totalSell: 17_000_000,
      totalCost: 16_000_000,
      note: 'Late arrival',
    });
    expect(noted.quote).toEqual(b.quote);
    const cal = await calendar(o.headers, 9, 13);
    expect(cal.properties[0]?.rows[0]?.segments.map((s) => [s.code, s.from, s.to])).toEqual([
      [b.code, night(10), night(12)],
    ]);
    // A date change re-quotes at today's rate.
    const moved = await ok(
      await call(o.headers, 'PATCH', path, { version: 3, checkOut: night(13) }),
      BookingDetail,
    );
    expect(moved.totalSell).toBe(32_000_000);
  });

  it('a migrated stay without a stored quote keeps its totals on a note edit', async () => {
    const o = await signup();
    const p = await villa(o.headers);
    const b = await book(
      o.headers,
      stay(p.id, 10, 12, { status: 'confirmed', manualTotalSell: 15_000_000 }),
    );
    // T-155 stay requests were copied by migration 0041 without a quote.
    await owner.db
      .update(schema.lodgingBookings)
      .set({ quote: null })
      .where(eq(schema.lodgingBookings.id, b.id));
    const noted = await ok(
      await call(o.headers, 'PATCH', `/lodging/bookings/${b.id}`, {
        version: 1,
        note: 'Migrated',
      }),
      BookingDetail,
    );
    expect(noted).toMatchObject({
      note: 'Migrated',
      quote: null,
      totalSell: b.totalSell,
      totalCost: b.totalCost,
    });
    const adjusted = await ok(
      await call(o.headers, 'PATCH', `/lodging/bookings/${b.id}`, {
        version: 2,
        adjustment: -1_000_000,
      }),
      BookingDetail,
    );
    expect(adjusted).toMatchObject({ quote: null, totalSell: 14_000_000 });
  });

  it('reordered child ages are a party change, like on the web', async () => {
    const o = await signup();
    const p = await villa(o.headers);
    const b = await book(
      o.headers,
      stay(p.id, 10, 12, { manualTotalSell: 15_000_000, party: { adults: 2, childAges: [3, 8] } }),
    );
    const r = await call(o.headers, 'PATCH', `/lodging/bookings/${b.id}`, {
      version: 1,
      party: { adults: 2, childAges: [8, 3] },
    });
    expect(r.statusCode, r.body).toBe(400);
    expect(r.json()).toMatchObject({ error: { details: { field: 'manualTotalSell' } } });
  });

  it('a note edit on a whole stay of a rooms property survives a room change', async () => {
    const o = await signup();
    const p = await homestay(o.headers);
    const b = await book(o.headers, stay(p.id, 5, 7, { status: 'confirmed' }));
    expect(b.unitIds).toHaveLength(2);
    const [p1, p2] = p.units;
    const current = await ok(
      await call(o.headers, 'GET', `/lodging/properties/${p.id}`),
      PropertyDto,
    );
    await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${p.id}/units`, {
        version: current.version,
        units: [
          { id: p1?.id, name: 'P1', capacityAdults: 2 },
          { id: p2?.id, name: 'P2', capacityAdults: 2, active: false },
        ],
      }),
      PropertyDto,
    );
    const noted = await ok(
      await call(o.headers, 'PATCH', `/lodging/bookings/${b.id}`, { version: 1, note: 'VIP' }),
      BookingDetail,
    );
    expect(noted).toMatchObject({ note: 'VIP', unitIds: b.unitIds, totalSell: b.totalSell });
  });

  it('changing the rooms of a stay re-quotes and re-takes the nights', async () => {
    const o = await signup();
    const p = await homestay(o.headers);
    const [p1, p2] = p.units;
    const b = await book(o.headers, stay(p.id, 5, 7, { whole: false, unitIds: [p1?.id] }));
    expect(b.totalSell).toBe(2_000_000);
    const moved = await ok(
      await call(o.headers, 'PATCH', `/lodging/bookings/${b.id}`, {
        version: 1,
        whole: false,
        unitIds: [p2?.id],
      }),
      BookingDetail,
    );
    expect(moved).toMatchObject({ unitIds: [p2?.id], totalSell: 2_400_000 });
    await book(o.headers, stay(p.id, 5, 7, { whole: false, unitIds: [p1?.id] }));
  });

  it('a missing nightly price asks for a manual price on the manualTotalSell field', async () => {
    const o = await signup();
    const unpriced = await homestay(o.headers, 'HS9', false);
    const r = await call(o.headers, 'POST', '/lodging/bookings', stay(unpriced.id, 1, 2));
    expect(r.statusCode, r.body).toBe(400);
    expect(r.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { field: 'manualTotalSell' } },
    });
  });

  it('refuses adding or reactivating a room while a future whole booking holds the property', async () => {
    const o = await signup();
    const p = await homestay(o.headers);
    const [p1, p2] = p.units;
    let current = await ok(
      await call(o.headers, 'GET', `/lodging/properties/${p.id}`),
      PropertyDto,
    );
    current = await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${p.id}/units`, {
        version: current.version,
        units: [
          { id: p1?.id, name: 'P1', capacityAdults: 2 },
          { id: p2?.id, name: 'P2', capacityAdults: 2, active: false },
        ],
      }),
      PropertyDto,
    );
    const whole = await book(o.headers, stay(p.id, 3, 5));
    const units = [
      { id: p1?.id, name: 'P1', capacityAdults: 2 },
      { id: p2?.id, name: 'P2', capacityAdults: 2, active: false },
    ];
    for (const next of [
      [...units, { name: 'P3', capacityAdults: 2 }],
      [units[0], { ...units[1], active: true }],
    ]) {
      const r = await call(o.headers, 'PUT', `/lodging/properties/${p.id}/units`, {
        version: current.version,
        units: next,
      });
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json()).toMatchObject({
        error: { code: 'CONFLICT', details: { codes: [whole.code] } },
      });
    }
    // Renaming a room is still fine.
    await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${p.id}/units`, {
        version: current.version,
        units: [{ ...units[0], name: 'Phòng 1' }, units[1]],
      }),
      PropertyDto,
    );
  });

  it('checking out early shortens the stay, frees later nights and re-prices it', async () => {
    const o = await signup();
    const p = await villa(o.headers);
    const auto = await book(
      o.headers,
      stay(p.id, 0, 3, { status: 'confirmed', adjustment: -1_000_000 }),
    );
    const path = `/lodging/bookings/${auto.id}/status`;
    await ok(
      await call(o.headers, 'POST', path, { version: 1, action: 'check_in' }),
      BookingDetail,
    );
    const out = await ok(
      await call(o.headers, 'POST', path, { version: 2, action: 'check_out' }),
      BookingDetail,
    );
    // Left on the check-in day: one night is kept (check-in + 1).
    expect(out).toMatchObject({ status: 'checked_out', checkOut: night(1), totalSell: 8_000_000 });
    expect(out.history.at(-1)).toMatchObject({
      action: 'lodging.booking.checked_out',
      data: expect.objectContaining({ checkOut: { from: night(3), to: night(1) } }),
    });
    await book(o.headers, stay(p.id, 1, 3));
  });

  it('an early check-out of a manually priced stay keeps the manual total', async () => {
    const o = await signup();
    const p = await villa(o.headers);
    const b = await book(
      o.headers,
      stay(p.id, 0, 4, { status: 'confirmed', manualTotalSell: 30_000_000 }),
    );
    const path = `/lodging/bookings/${b.id}/status`;
    await ok(
      await call(o.headers, 'POST', path, { version: 1, action: 'check_in' }),
      BookingDetail,
    );
    const out = await ok(
      await call(o.headers, 'POST', path, { version: 2, action: 'check_out' }),
      BookingDetail,
    );
    expect(out).toMatchObject({ checkOut: night(1), totalSell: 30_000_000 });
  });

  it('a status move on a hold that just expired says the hold expired', async () => {
    const o = await signup();
    const p = await villa(o.headers);
    const hold = await book(o.headers, stay(p.id, 4, 6));
    await owner.db
      .update(schema.lodgingBookings)
      .set({ holdExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.lodgingBookings.id, hold.id));
    const r = await call(o.headers, 'POST', `/lodging/bookings/${hold.id}/status`, {
      version: hold.version,
      action: 'confirm',
    });
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json()).toMatchObject({
      error: { code: 'CONFLICT', details: { reason: 'HOLD_EXPIRED' } },
    });
    const edit = await call(o.headers, 'PATCH', `/lodging/bookings/${hold.id}`, {
      version: hold.version,
      note: 'x',
    });
    expect(edit.json()).toMatchObject({ error: { details: { reason: 'HOLD_EXPIRED' } } });
  });

  it('bookings of a paused property stay editable; new ones are refused', async () => {
    const o = await signup();
    const p = await villa(o.headers);
    const b = await book(o.headers, stay(p.id, 4, 6));
    const current = await ok(
      await call(o.headers, 'GET', `/lodging/properties/${p.id}`),
      PropertyDto,
    );
    await ok(
      await call(o.headers, 'PATCH', `/lodging/properties/${p.id}`, {
        version: current.version,
        patch: { status: 'paused' },
      }),
      PropertyDto,
    );
    const edited = await ok(
      await call(o.headers, 'PATCH', `/lodging/bookings/${b.id}`, {
        version: 1,
        checkOut: night(7),
      }),
      BookingDetail,
    );
    expect(edited.checkOut).toBe(night(7));
    const created = await call(o.headers, 'POST', '/lodging/bookings', stay(p.id, 10, 11));
    expect(created.statusCode, created.body).toBe(409);
  });

  it('blocks take nights without party or money and can be removed', async () => {
    const o = await signup();
    const p = await villa(o.headers);
    const block = await book(o.headers, {
      kind: 'block',
      clientRequestId: newId(),
      propertyId: p.id,
      whole: true,
      checkIn: night(2),
      checkOut: night(3),
      blockReason: 'Maintenance',
    });
    expect(block).toMatchObject({
      kind: 'block',
      status: 'active',
      totalSell: null,
      source: null,
      quote: null,
      blockReason: 'Maintenance',
    });
    expect((await call(o.headers, 'POST', '/lodging/bookings', stay(p.id, 2, 3))).statusCode).toBe(
      409,
    );
    await ok(
      await call(o.headers, 'POST', `/lodging/bookings/${block.id}/status`, {
        version: 1,
        action: 'remove_block',
      }),
      BookingDetail,
    );
    const hold = await book(o.headers, stay(p.id, 2, 3, { guestName: 'Nguyen Synthetic' }));
    const holds = await ok(
      await call(o.headers, 'GET', '/lodging/bookings?view=holds'),
      BookingList,
    );
    expect(holds.data.map((b) => b.id)).toEqual([hold.id]);
    const found = await ok(
      await call(o.headers, 'GET', '/lodging/bookings?view=all&q=synthetic'),
      BookingList,
    );
    expect(found.data.map((b) => b.id)).toEqual([hold.id]);
    expect(found.nextOffset).toBeNull();
  });

  it('availability for 20 adults returns the free whole villa with its total; full ones are left out', async () => {
    const o = await signup();
    const free = await villa(o.headers, 'A17');
    const taken = await villa(o.headers, 'A18');
    const small = await homestay(o.headers, 'HS1');
    await book(o.headers, stay(taken.id, 5, 6));
    const r = await ok(
      await call(o.headers, 'POST', '/lodging/availability', {
        checkIn: night(5),
        checkOut: night(7),
        party: { adults: 20, childAges: [] },
      }),
      AvailabilityDto,
    );
    expect(r.options[0]).toMatchObject({
      propertyId: free.id,
      whole: true,
      fits: true,
      unitIds: [free.units[0]?.id],
      quote: { totalSell: 18_000_000, takenBy: [] },
    });
    expect(r.options.some((x) => x.propertyId === taken.id)).toBe(false);
    const smallOptions = r.options.filter((x) => x.propertyId === small.id);
    expect(smallOptions.length).toBeGreaterThan(0);
    expect(smallOptions.every((x) => !x.fits)).toBe(true);

    const couple = await ok(
      await call(o.headers, 'POST', '/lodging/availability', {
        checkIn: night(5),
        checkOut: night(7),
        party: { adults: 2, childAges: [] },
        propertyIds: [small.id],
      }),
      AvailabilityDto,
    );
    expect(
      couple.options.map((x) => [x.whole, x.unitIds.length, x.fits, x.quote.totalSell]),
    ).toEqual([
      [false, 1, true, 2_000_000],
      [true, 2, true, 4_400_000],
    ]);
  });

  it('refuses a calendar range over 62 nights', async () => {
    const o = await signup();
    await villa(o.headers);
    const tooLong = await call(
      o.headers,
      'GET',
      `/lodging/calendar?from=${night(0)}&to=${night(63)}`,
    );
    expect(tooLong.statusCode, tooLong.body).toBe(400);
    expect(
      (await call(o.headers, 'GET', `/lodging/calendar?from=${night(3)}&to=${night(3)}`))
        .statusCode,
    ).toBe(400);
    const max = await calendar(o.headers, 0, 62);
    expect(max.properties[0]?.wholePrices).toHaveLength(62);
    expect(max.today).toBe(today);
  });
});
