import {
  AuthResponse,
  BookingDetail,
  BookingList,
  BookingReviewCount,
  BootstrapResponse,
  BotDto,
  PropertyDto,
} from '@agent-sales/contracts';
import {
  createDb,
  ensureLoginRoles,
  eq,
  migrate,
  schema,
  withCredentials,
  withTenant,
  type Database,
} from '@agent-sales/db';
import { newId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import { LODGING_BOT_FACADE, type LodgingBotFacade } from '../src/modules/lodging/api/index.js';
import { addNights, isoWeekday, localToday } from '../src/modules/lodging/domain/nights.js';
import { signUpVerified } from './support/signup.js';

/** Bot availability, hold drafts and the review state of bot holds (T-161) on a real Postgres. */
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
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT';
const call = (h: Headers, method: Method, path: string, payload?: object) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({ method, url: '/api/v1' + path, headers: h, ...(payload ? { payload } : {}) });
const facade = () => app.get<LodgingBotFacade>(LODGING_BOT_FACADE, { strict: false });

let signups = 0;
async function hotel() {
  const n = ++signups;
  const r = await signUpVerified(
    app,
    {
      name: 'Test owner',
      email: `lodging-bot-holds-${n}@example.test`,
      password: 'a long synthetic password',
      workspaceName: 'Test lodging business',
      industry: 'hotel',
    },
    { remoteAddress: `10.88.0.${n}` },
  );
  expect(r.statusCode).toBe(201);
  const auth = AuthResponse.parse(r.json());
  const authorization = `Bearer ${auth.accessToken}`;
  const boot = BootstrapResponse.parse((await call({ authorization }, 'GET', '/bootstrap')).json());
  const id = boot.memberships[0]?.workspaceId ?? '';
  const headers = { authorization, 'x-workspace-id': id };
  const bot = BotDto.parse(
    (await call(headers, 'POST', '/bots', { name: 'Bot Lan', industry: 'hotel' })).json(),
  );
  return { ws: workspaceId(id), headers, botId: bot.id };
}

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
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

async function villa(h: Headers, code: string, sell: number): Promise<PropertyDto> {
  const p = await ok(
    await call(h, 'POST', '/lodging/properties', {
      code,
      name: 'SKY VILLA ' + code,
      sellMode: 'whole',
      standardAdults: 10,
      standardChildren: 2,
      maxGuests: 14,
      internalNote: 'SECRET-OWNER-NOTE',
    }),
    PropertyDto,
    201,
  );
  return setRate(h, p, sell);
}

async function setRate(h: Headers, p: PropertyDto, sell: number): Promise<PropertyDto> {
  return ok(
    await call(h, 'PUT', `/lodging/properties/${p.id}/rates`, {
      version: p.version,
      weekday: [{ unitId: null, weekdays: ALL_DAYS, sell, cost: 4_321_000 }],
      surcharges: { extraAdult: { sell: 300_000, cost: 111_000 }, extraChild: null },
    }),
    PropertyDto,
  );
}

const staffStay = (propertyId: string, from: number, to: number) => ({
  kind: 'stay',
  clientRequestId: newId(),
  propertyId,
  whole: true,
  unitIds: [],
  checkIn: night(from),
  checkOut: night(to),
  status: 'confirmed',
  party: { adults: 2, childAges: [] },
  guestName: 'Synthetic guest',
  guestPhone: '0900000000',
  source: 'phone',
});

const party = { adults: 4, childAges: [] as number[] };
const holdInput = (
  botId: string,
  propertyId: string,
  conversationId: string,
  over: Record<string, unknown> = {},
) => ({
  botId,
  conversationId,
  contactId: null,
  channel: 'facebook',
  propertyId,
  whole: true,
  checkIn: night(3),
  checkOut: night(5),
  ...party,
  guestName: 'Anh Nam',
  guestPhone: '0912 345 678',
  ...over,
});

const noSecrets = (value: unknown) => {
  const text = JSON.stringify(value);
  expect(text).not.toContain('SECRET-OWNER-NOTE');
  expect(text).not.toContain('4321000');
  expect(text).not.toContain('111000');
  expect(text).not.toMatch(/cost/i);
};

describe('checkAvailabilityForBot', () => {
  it('quotes the free properties the bot sells with Vietnamese weekday labels, no costs', async () => {
    const o = await hotel();
    const a = await villa(o.headers, 'A17', 9_000_000);
    const b = await villa(o.headers, 'B02', 7_000_000);
    const r = await facade().checkAvailabilityForBot(o.ws, {
      botId: o.botId,
      checkIn: night(3),
      checkOut: night(5),
      ...party,
    });
    noSecrets(r);
    expect(r.nights).toBe(2);
    expect(r.problems).toEqual([]);
    expect(r.requestedFull).toBe(false);
    expect(r.checkInWeekdayLabel).toMatch(/^(Thứ (Hai|Ba|Tư|Năm|Sáu|Bảy)|Chủ Nhật)$/);
    expect(r.options.map((x) => x.propertyId)).toEqual([b.id, a.id]);
    expect(r.options[1]).toMatchObject({
      code: 'A17',
      name: 'SKY VILLA A17',
      whole: true,
      fits: true,
      overStandard: false,
      totalSell: 18_000_000,
      surcharges: [],
    });
    expect(r.options[1]?.nightly.map((n) => n.date)).toEqual([night(3), night(4)]);

    // Over the standard party: surcharge in sell prices only.
    const big = await facade().checkAvailabilityForBot(o.ws, {
      botId: o.botId,
      propertyId: a.id,
      checkIn: night(3),
      checkOut: night(4),
      adults: 12,
      childAges: [],
    });
    noSecrets(big);
    expect(big.options[0]).toMatchObject({
      fits: true,
      totalSell: 9_600_000,
      surcharges: [{ kind: 'extra_adult', persons: 2, nights: 1, sell: 600_000 }],
    });
  });

  it('follows the bot selection and offers alternatives when the requested property is full', async () => {
    const o = await hotel();
    const a = await villa(o.headers, 'A17', 9_000_000);
    const b = await villa(o.headers, 'B02', 7_000_000);
    const c = await villa(o.headers, 'C03', 8_000_000);
    await ok(
      await call(o.headers, 'POST', '/lodging/bookings', staffStay(a.id, 3, 4)),
      BookingDetail,
      201,
    );
    const full = await facade().checkAvailabilityForBot(o.ws, {
      botId: o.botId,
      propertyId: a.id,
      checkIn: night(3),
      checkOut: night(5),
      ...party,
    });
    expect(full.requestedFull).toBe(true);
    expect(full.options.map((x) => x.code)).toEqual(['B02', 'C03']);

    const free = await facade().checkAvailabilityForBot(o.ws, {
      botId: o.botId,
      propertyId: b.id,
      checkIn: night(3),
      checkOut: night(5),
      ...party,
    });
    expect(free.requestedFull).toBe(false);
    expect(free.options.map((x) => x.code)).toEqual(['B02']);

    // The bot sells only C03 now: B02 is not sold, A17 is not offered.
    await call(o.headers, 'PUT', `/lodging/bots/${o.botId}/properties`, { propertyIds: [c.id] });
    const scoped = await facade().checkAvailabilityForBot(o.ws, {
      botId: o.botId,
      propertyId: b.id,
      checkIn: night(3),
      checkOut: night(5),
      ...party,
    });
    expect(scoped.problems).toEqual(['not_sold']);
    expect(scoped.options.map((x) => x.code)).toEqual(['C03']);
  });

  it('reports past dates and stays over 60 nights without reading the calendar', async () => {
    const o = await hotel();
    const past = await facade().checkAvailabilityForBot(o.ws, {
      botId: o.botId,
      checkIn: night(-1),
      checkOut: night(1),
      ...party,
    });
    expect(past).toMatchObject({ problems: ['past_date'], options: [] });
    const long = await facade().checkAvailabilityForBot(o.ws, {
      botId: o.botId,
      checkIn: night(1),
      checkOut: night(62),
      ...party,
    });
    expect(long).toMatchObject({ problems: ['too_long'], options: [] });
  });

  it('answers invalid dates and an invalid party as problems, never throws', async () => {
    const o = await hotel();
    const ask = { botId: o.botId, checkIn: night(3), checkOut: night(5), ...party };
    expect(
      await facade().checkAvailabilityForBot(o.ws, {
        ...ask,
        checkIn: 'thứ 6',
        checkOut: night(3),
      }),
    ).toMatchObject({ problems: ['invalid_dates'], options: [], nights: 0 });
    expect(
      await facade().checkAvailabilityForBot(o.ws, { ...ask, checkOut: night(3) }),
    ).toMatchObject({ problems: ['invalid_dates'] });
    expect(
      await facade().checkAvailabilityForBot(o.ws, { ...ask, adults: 0, childAges: [] }),
    ).toMatchObject({ problems: ['invalid_party'] });
    expect(await facade().checkAvailabilityForBot(o.ws, { ...ask, childAges: [40] })).toMatchObject(
      { problems: ['invalid_party'] },
    );
    const a = await villa(o.headers, 'A17', 9_000_000);
    expect(
      await facade().prepareBotHold(
        o.ws,
        holdInput(o.botId, a.id, newId(), { checkIn: '2026-02-30', adults: -1 }),
      ),
    ).toMatchObject({ status: 'problems', problems: ['invalid_dates', 'invalid_party'] });
  });

  it('checks the bot belongs to the workspace', async () => {
    const o = await hotel();
    await expect(
      facade().checkAvailabilityForBot(o.ws, {
        botId: newId(),
        checkIn: night(3),
        checkOut: night(5),
        ...party,
      }),
    ).rejects.toThrow();
  });

  it('returns options that break a minimum stay with their minimum, and prepare says min_nights', async () => {
    const o = await hotel();
    const a = await villa(o.headers, 'A17', 9_000_000);
    const r = await call(o.headers, 'POST', `/lodging/properties/${a.id}/overrides`, {
      version: a.version,
      unitId: null,
      dateFrom: night(3),
      dateTo: night(4),
      label: 'Lễ',
      sell: 12_000_000,
      cost: 10_000_000,
      minNights: 2,
    });
    expect(r.statusCode).toBe(201);
    const one = await facade().checkAvailabilityForBot(o.ws, {
      botId: o.botId,
      propertyId: a.id,
      checkIn: night(3),
      checkOut: night(4),
      ...party,
    });
    expect(one.requestedFull).toBe(false);
    expect(one.options[0]).toMatchObject({ code: 'A17', minNights: 2, problems: ['min_nights'] });
    const two = await facade().checkAvailabilityForBot(o.ws, {
      botId: o.botId,
      propertyId: a.id,
      checkIn: night(3),
      checkOut: night(5),
      ...party,
    });
    expect(two.options[0]).toMatchObject({ minNights: null, problems: [] });
    const prepared = await facade().prepareBotHold(
      o.ws,
      holdInput(o.botId, a.id, newId(), { checkIn: night(3), checkOut: night(4) }),
    );
    expect(prepared).toMatchObject({ status: 'problems', problems: ['min_nights'] });
  });
});

describe('bot holds', () => {
  it('reports what is missing or wrong', async () => {
    const o = await hotel();
    const a = await villa(o.headers, 'A17', 9_000_000);
    const r = await facade().prepareBotHold(
      o.ws,
      holdInput(o.botId, a.id, newId(), { guestName: '  ', guestPhone: '123', adults: 15 }),
    );
    expect(r.status).toBe('problems');
    if (r.status !== 'problems') return;
    expect(r.problems).toEqual(['missing_name', 'invalid_phone', 'over_max']);
    const r2 = await facade().prepareBotHold(
      o.ws,
      holdInput(o.botId, a.id, newId(), { guestPhone: '', checkIn: night(-2), checkOut: night(1) }),
    );
    expect(r2).toMatchObject({ status: 'problems', problems: ['missing_phone', 'past_date'] });
    const r3 = await facade().prepareBotHold(o.ws, holdInput(o.botId, newId(), newId()));
    expect(r3).toMatchObject({ status: 'problems', problems: ['not_sold'] });
  });

  it('a prepare that finds problems drops the earlier draft of the conversation', async () => {
    const o = await hotel();
    const a = await villa(o.headers, 'A17', 9_000_000);
    const conversationId = newId();
    await facade().prepareBotHold(o.ws, holdInput(o.botId, a.id, conversationId));
    expect((await facade().hasBotHoldDraft(o.ws, conversationId)).pending).toBe(true);
    const again = await facade().prepareBotHold(
      o.ws,
      holdInput(o.botId, a.id, conversationId, { guestPhone: '123' }),
    );
    expect(again).toMatchObject({ status: 'problems', problems: ['invalid_phone'] });
    expect((await facade().hasBotHoldDraft(o.ws, conversationId)).pending).toBe(false);
    expect(await facade().confirmBotHold(o.ws, { conversationId })).toMatchObject({
      status: 'no_draft',
    });
  });

  it('holds chosen rooms of a rooms property and takes only their nights', async () => {
    const o = await hotel();
    const created = await ok(
      await call(o.headers, 'POST', '/lodging/properties', {
        code: 'HS1',
        name: 'Homestay HS1',
        sellMode: 'rooms',
        standardAdults: 4,
        standardChildren: 0,
      }),
      PropertyDto,
      201,
    );
    const withRooms = await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${created.id}/units`, {
        version: created.version,
        units: [
          { name: 'P1', capacityAdults: 2 },
          { name: 'P2', capacityAdults: 2 },
          { name: 'P3', capacityAdults: 2 },
        ],
      }),
      PropertyDto,
    );
    const [p1, p2, p3] = withRooms.units;
    const hs = await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${created.id}/rates`, {
        version: withRooms.version,
        weekday: withRooms.units.map((u) => ({
          unitId: u.id,
          weekdays: ALL_DAYS,
          sell: 500_000,
          cost: 300_000,
        })),
        surcharges: { extraAdult: null, extraChild: null },
      }),
      PropertyDto,
    );
    const avail = await facade().checkAvailabilityForBot(o.ws, {
      botId: o.botId,
      propertyId: hs.id,
      checkIn: night(3),
      checkOut: night(5),
      adults: 2,
      childAges: [],
    });
    const rooms = avail.options.find((x) => !x.whole);
    expect(rooms?.unitIds).toHaveLength(1);
    const conversationId = newId();
    const ready = await facade().prepareBotHold(
      o.ws,
      holdInput(o.botId, hs.id, conversationId, {
        whole: false,
        unitIds: [p1!.id, p2!.id],
        adults: 4,
      }),
    );
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') return;
    expect(ready.summary.split('\n')[0]).toBe('Giữ chỗ Homestay HS1 · phòng P1, P2');
    expect(ready.summary).toContain('Tổng: 2.000.000đ');
    const held = await facade().confirmBotHold(o.ws, { conversationId });
    expect(held.status).toBe('held');
    const nights = await owner.db
      .select()
      .from(schema.lodgingUnitNights)
      .where(eq(schema.lodgingUnitNights.workspaceId, o.ws));
    expect(new Set(nights.map((n) => n.unitId))).toEqual(new Set([p1!.id, p2!.id]));
    expect(nights).toHaveLength(4);
    // P3 is still free for the same nights; the whole house is not.
    const after = await facade().checkAvailabilityForBot(o.ws, {
      botId: o.botId,
      propertyId: hs.id,
      checkIn: night(3),
      checkOut: night(5),
      adults: 2,
      childAges: [],
    });
    expect(after.options.map((x) => [x.whole, x.unitIds])).toEqual([[false, [p3!.id]]]);
  });

  it('prepares a summary, confirms it into a bot hold and counts it for review', async () => {
    const o = await hotel();
    const a = await villa(o.headers, 'A17', 9_000_000);
    const conversationId = newId();
    const contactId = newId();
    const ready = await facade().prepareBotHold(
      o.ws,
      holdInput(o.botId, a.id, conversationId, { contactId, note: 'Đến muộn' }),
    );
    expect(ready).toMatchObject({ status: 'ready', holdMinutes: 120 });
    if (ready.status !== 'ready') return;
    expect(ready.summary).toContain('Giữ chỗ SKY VILLA A17');
    expect(ready.summary).toContain('Tổng: 18.000.000đ');
    expect(ready.summary).toContain('SĐT: 0912 345 678');
    noSecrets(ready);
    // Preparing never takes the nights.
    const quiet = await facade().checkAvailabilityForBot(o.ws, {
      botId: o.botId,
      propertyId: a.id,
      checkIn: night(3),
      checkOut: night(5),
      ...party,
    });
    expect(quiet.requestedFull).toBe(false);
    const pending = await facade().hasBotHoldDraft(o.ws, conversationId);
    expect(pending.pending).toBe(true);
    expect(pending.storedAt).toBeInstanceOf(Date);

    const held = await facade().confirmBotHold(o.ws, { conversationId });
    expect(held.status).toBe('held');
    if (held.status !== 'held') return;
    expect(held.code).toMatch(/^BK-/);
    const minutes = (Date.parse(held.holdExpiresAt) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(118);
    expect(minutes).toBeLessThanOrEqual(120);
    expect(await facade().hasBotHoldDraft(o.ws, conversationId)).toEqual({
      pending: false,
      storedAt: null,
    });
    // A retried confirm replays the same hold instead of losing it.
    expect(await facade().confirmBotHold(o.ws, { conversationId })).toEqual(held);

    const list = await ok(
      await call(o.headers, 'GET', '/lodging/bookings?view=holds&source=bot'),
      BookingList,
    );
    expect(list.data).toHaveLength(1);
    const booking = list.data[0]!;
    expect(booking).toMatchObject({
      code: held.code,
      status: 'hold',
      source: 'bot',
      conversationId,
      contactId,
      guestName: 'Anh Nam',
      guestPhone: '0912345678',
      note: 'Đến muộn',
      totalSell: 18_000_000,
      reviewedAt: null,
    });
    const staffOnly = await ok(
      await call(o.headers, 'GET', '/lodging/bookings?view=holds&source=phone'),
      BookingList,
    );
    expect(staffOnly.data).toEqual([]);
    const detail = await ok(
      await call(o.headers, 'GET', `/lodging/bookings/${booking.id}`),
      BookingDetail,
    );
    expect(detail.history[0]).toMatchObject({
      actorName: 'Bot Lan',
      action: 'lodging.booking.created',
    });
    const outbox = await owner.db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.aggregateId, booking.id));
    expect(outbox[0]?.payload).toMatchObject({ type: 'lodging.booking.created.v1', source: 'bot' });
    expect(JSON.stringify(outbox)).not.toContain('Anh Nam');

    expect(
      await ok(await call(o.headers, 'GET', '/lodging/bookings/review-count'), BookingReviewCount),
    ).toEqual({ pending: 1 });
    // Any staff action reviews it.
    const confirmed = await ok(
      await call(o.headers, 'POST', `/lodging/bookings/${booking.id}/status`, {
        version: booking.version,
        action: 'confirm',
      }),
      BookingDetail,
    );
    expect(confirmed.reviewedAt).not.toBeNull();
    expect(
      await ok(await call(o.headers, 'GET', '/lodging/bookings/review-count'), BookingReviewCount),
    ).toEqual({ pending: 0 });
    const [row] = await owner.db
      .select()
      .from(schema.lodgingBookings)
      .where(eq(schema.lodgingBookings.id, booking.id));
    expect(row?.reviewedBy).not.toBeNull();
  });

  it('an edit by staff reviews a bot hold too', async () => {
    const o = await hotel();
    const a = await villa(o.headers, 'A17', 9_000_000);
    const conversationId = newId();
    await facade().prepareBotHold(o.ws, holdInput(o.botId, a.id, conversationId));
    const held = await facade().confirmBotHold(o.ws, { conversationId });
    expect(held.status).toBe('held');
    const list = await ok(
      await call(o.headers, 'GET', '/lodging/bookings?source=bot'),
      BookingList,
    );
    const b = list.data[0]!;
    const edited = await ok(
      await call(o.headers, 'PATCH', `/lodging/bookings/${b.id}`, {
        version: b.version,
        note: 'Gọi rồi',
      }),
      BookingDetail,
    );
    expect(edited.reviewedAt).not.toBeNull();
    expect(edited.status).toBe('hold');
  });

  it('answers not_available with alternatives when someone took the nights meanwhile', async () => {
    const o = await hotel();
    const a = await villa(o.headers, 'A17', 9_000_000);
    await villa(o.headers, 'B02', 7_000_000);
    const conversationId = newId();
    expect(
      (await facade().prepareBotHold(o.ws, holdInput(o.botId, a.id, conversationId))).status,
    ).toBe('ready');
    await ok(
      await call(o.headers, 'POST', '/lodging/bookings', staffStay(a.id, 4, 5)),
      BookingDetail,
      201,
    );
    const r = await facade().confirmBotHold(o.ws, { conversationId });
    expect(r.status).toBe('not_available');
    if (r.status === 'held') return;
    expect(r.alternatives.map((x) => x.code)).toEqual(['B02']);
    noSecrets(r);
    expect((await facade().hasBotHoldDraft(o.ws, conversationId)).pending).toBe(false);

    // Prepare also says so up front.
    const again = await facade().prepareBotHold(o.ws, holdInput(o.botId, a.id, newId()));
    expect(again).toMatchObject({ status: 'problems', problems: ['not_available'] });
    if (again.status === 'problems') expect(again.alternatives.map((x) => x.code)).toEqual(['B02']);
  });

  it('answers price_changed when the rate moved between prepare and confirm', async () => {
    const o = await hotel();
    const a = await villa(o.headers, 'A17', 9_000_000);
    const conversationId = newId();
    await facade().prepareBotHold(o.ws, holdInput(o.botId, a.id, conversationId));
    await setRate(o.headers, a, 9_500_000);
    const r = await facade().confirmBotHold(o.ws, { conversationId });
    expect(r.status).toBe('price_changed');
    if (r.status === 'held') return;
    expect(r.alternatives[0]).toMatchObject({ code: 'A17', totalSell: 19_000_000 });
    expect((await facade().hasBotHoldDraft(o.ws, conversationId)).pending).toBe(false);
  });

  it('answers expired for a draft older than 30 minutes, and cancel drops a draft', async () => {
    const o = await hotel();
    const a = await villa(o.headers, 'A17', 9_000_000);
    const conversationId = newId();
    await facade().prepareBotHold(o.ws, holdInput(o.botId, a.id, conversationId));
    await owner.db
      .update(schema.lodgingBotHoldDrafts)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.lodgingBotHoldDrafts.conversationId, conversationId));
    const expired = await facade().confirmBotHold(o.ws, { conversationId });
    expect(expired.status).toBe('expired');
    // The drafted property is offered again when it is still free.
    if (expired.status !== 'held') expect(expired.alternatives[0]?.code).toBe('A17');
    expect((await facade().hasBotHoldDraft(o.ws, conversationId)).pending).toBe(false);

    const other = newId();
    await facade().prepareBotHold(o.ws, holdInput(o.botId, a.id, other));
    expect((await facade().hasBotHoldDraft(o.ws, other)).pending).toBe(true);
    await facade().cancelBotHoldDraft(o.ws, { conversationId: other });
    expect((await facade().hasBotHoldDraft(o.ws, other)).pending).toBe(false);
    expect(await facade().confirmBotHold(o.ws, { conversationId: other })).toMatchObject({
      status: 'no_draft',
    });
  });

  it('replays held only while the booking is still a hold, else answers expired', async () => {
    const o = await hotel();
    const a = await villa(o.headers, 'A17', 9_000_000);
    const conversationId = newId();
    await facade().prepareBotHold(o.ws, holdInput(o.botId, a.id, conversationId));
    const held = await facade().confirmBotHold(o.ws, { conversationId });
    expect(held.status).toBe('held');
    const [b] = (
      await ok(await call(o.headers, 'GET', '/lodging/bookings?source=bot'), BookingList)
    ).data;
    await ok(
      await call(o.headers, 'POST', `/lodging/bookings/${b!.id}/status`, {
        version: b!.version,
        action: 'cancel',
      }),
      BookingDetail,
    );
    const again = await facade().confirmBotHold(o.ws, { conversationId });
    // Cancelled by staff: not replayed; the freed property is offered again, as for expired.
    expect(again.status).toBe('expired');
    if (again.status !== 'held') expect(again.alternatives[0]?.code).toBe('A17');
  });

  it('drops the expired draft and the expired tombstone of the conversation it touches', async () => {
    const o = await hotel();
    const a = await villa(o.headers, 'A17', 9_000_000);
    const rows = (conversationId: string) =>
      owner.db
        .select()
        .from(schema.lodgingBotHoldDrafts)
        .where(eq(schema.lodgingBotHoldDrafts.conversationId, conversationId));
    const age = (conversationId: string) =>
      owner.db
        .update(schema.lodgingBotHoldDrafts)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.lodgingBotHoldDrafts.conversationId, conversationId));

    // A confirmed draft (tombstone) older than the TTL: gone after the pending check.
    const confirmed = newId();
    await facade().prepareBotHold(o.ws, holdInput(o.botId, a.id, confirmed));
    expect((await facade().confirmBotHold(o.ws, { conversationId: confirmed })).status).toBe(
      'held',
    );
    expect(await rows(confirmed)).toHaveLength(1);
    await age(confirmed);
    expect(await facade().hasBotHoldDraft(o.ws, confirmed)).toEqual({
      pending: false,
      storedAt: null,
    });
    expect(await rows(confirmed)).toEqual([]);

    // A draft never confirmed, expired: gone too.
    const open = newId();
    await facade().prepareBotHold(
      o.ws,
      holdInput(o.botId, a.id, open, { checkIn: night(10), checkOut: night(12) }),
    );
    await age(open);
    expect((await facade().hasBotHoldDraft(o.ws, open)).pending).toBe(false);
    expect(await rows(open)).toEqual([]);

    // An expired tombstone is not replayed by a late confirm: expired, and the row is gone.
    const late = newId();
    await facade().prepareBotHold(
      o.ws,
      holdInput(o.botId, a.id, late, { checkIn: night(20), checkOut: night(22) }),
    );
    expect((await facade().confirmBotHold(o.ws, { conversationId: late })).status).toBe('held');
    await age(late);
    expect((await facade().confirmBotHold(o.ws, { conversationId: late })).status).toBe('expired');
    expect(await rows(late)).toEqual([]);
  });

  it('keeps drafts inside their workspace (forced RLS)', async () => {
    const a = await hotel();
    const b = await hotel();
    const p = await villa(a.headers, 'A17', 9_000_000);
    const conversationId = newId();
    await facade().prepareBotHold(a.ws, holdInput(a.botId, p.id, conversationId));
    expect((await facade().hasBotHoldDraft(b.ws as WorkspaceId, conversationId)).pending).toBe(
      false,
    );
    expect(await facade().confirmBotHold(b.ws, { conversationId })).toMatchObject({
      status: 'no_draft',
    });
    const seen = await withTenant(tenant.db, b.ws, (tx) =>
      tx.select().from(schema.lodgingBotHoldDrafts),
    );
    expect(seen).toEqual([]);
    const own = await withTenant(tenant.db, a.ws, (tx) =>
      tx.select().from(schema.lodgingBotHoldDrafts),
    );
    expect(own.map((r) => r.conversationId)).toEqual([conversationId]);
  });
});

describe('bot holds with bedroom packages (T-193)', () => {
  /** A Saturday at least a week ahead: 4PN is not sold on Saturdays. */
  const saturday = (() => {
    let n = 7;
    while (isoWeekday(night(n)) !== 6) n += 1;
    return n;
  })();
  const sixGuests = { adults: 6, childAges: [] as number[] };
  const packages = [
    { key: 'k6', unitId: null, name: '6PN', bedrooms: 6, standardAdults: 12, maxGuests: 16 },
    { key: 'k5', unitId: null, name: '5PN', bedrooms: 5, standardAdults: 10, maxGuests: 12 },
    { key: 'k4', unitId: null, name: '4PN', bedrooms: 4, standardAdults: 8, maxGuests: 10 },
  ];
  const week = (key: string, sell: number, saturdaySell: number | null) => [
    { unitId: null, weekdays: [1, 2, 3, 4, 5, 7], sell, cost: 1_000_000, packageKey: key },
    ...(saturdaySell === null
      ? []
      : [{ unitId: null, weekdays: [6], sell: saturdaySell, cost: 1_000_000, packageKey: key }]),
  ];

  async function aura(h: Headers): Promise<PropertyDto> {
    const p = await ok(
      await call(h, 'POST', '/lodging/properties', {
        code: 'AURA',
        name: 'Aura Villa',
        sellMode: 'whole',
        standardAdults: 12,
        standardChildren: 0,
        maxGuests: 20,
      }),
      PropertyDto,
      201,
    );
    return ok(
      await call(h, 'PUT', `/lodging/properties/${p.id}/rates`, {
        version: p.version,
        weekday: [
          ...week('k6', 12_000_000, 18_000_000),
          ...week('k5', 11_000_000, 16_000_000),
          ...week('k4', 10_000_000, null),
        ],
        surcharges: { extraAdult: null, extraChild: null },
        packages,
      }),
      PropertyDto,
    );
  }

  const stay = (botId: string, propertyId: string, conversationId: string, over = {}) =>
    holdInput(botId, propertyId, conversationId, {
      checkIn: night(saturday),
      checkOut: night(saturday + 1),
      ...sixGuests,
      ...over,
    });

  it('quotes the auto package with the alternatives, and holds exactly that package', async () => {
    const o = await hotel();
    const p = await aura(o.headers);
    const check = await facade().checkAvailabilityForBot(o.ws, {
      botId: o.botId,
      propertyId: p.id,
      checkIn: night(saturday),
      checkOut: night(saturday + 1),
      ...sixGuests,
    });
    expect(check.options[0]).toMatchObject({
      code: 'AURA',
      package: '5PN',
      totalSell: 16_000_000,
      alternatives: [
        { package: '4PN', bedrooms: 4, totalSell: null, fits: true },
        { package: '6PN', bedrooms: 6, totalSell: 18_000_000, fits: true },
      ],
    });
    noSecrets(check);

    const conversationId = newId();
    const ready = await facade().prepareBotHold(o.ws, stay(o.botId, p.id, conversationId));
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') return;
    expect(ready.summary.split('\n')[0]).toBe('Giữ chỗ Aura Villa · Nguyên căn · gói 5PN');
    expect(ready.summary).toContain('Tổng: 16.000.000đ');
    const [draft] = await owner.db
      .select()
      .from(schema.lodgingBotHoldDrafts)
      .where(eq(schema.lodgingBotHoldDrafts.conversationId, conversationId));
    const p5 = p.packages.find((k) => k.name === '5PN')!.id;
    expect(draft?.packageIds).toEqual([p5]);

    const held = await facade().confirmBotHold(o.ws, { conversationId });
    expect(held.status).toBe('held');
    const list = await ok(
      await call(o.headers, 'GET', '/lodging/bookings?view=holds&source=bot'),
      BookingList,
    );
    expect(list.data[0]).toMatchObject({ packageIds: [p5], totalSell: 16_000_000 });
  });

  it('holds the package the customer chose by name, case-insensitively', async () => {
    const o = await hotel();
    const p = await aura(o.headers);
    const conversationId = newId();
    const ready = await facade().prepareBotHold(
      o.ws,
      stay(o.botId, p.id, conversationId, { packages: [{ unitId: null, name: ' 6pn ' }] }),
    );
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') return;
    expect(ready.summary.split('\n')[0]).toBe('Giữ chỗ Aura Villa · Nguyên căn · gói 6PN');
    expect(ready.summary).toContain('Tổng: 18.000.000đ');
    // Confirm books the chosen package, not the auto pick (5PN).
    expect((await facade().confirmBotHold(o.ws, { conversationId })).status).toBe('held');
    const list = await ok(
      await call(o.headers, 'GET', '/lodging/bookings?view=holds&source=bot'),
      BookingList,
    );
    const p6 = p.packages.find((k) => k.name === '6PN')!.id;
    expect(list.data[0]).toMatchObject({ packageIds: [p6], totalSell: 18_000_000 });
  });

  it('answers unknown_package with the valid names, and package_unavailable on an unsold night', async () => {
    const o = await hotel();
    const p = await aura(o.headers);
    const unknown = await facade().prepareBotHold(
      o.ws,
      stay(o.botId, p.id, newId(), { packages: [{ unitId: null, name: '7PN' }] }),
    );
    expect(unknown).toEqual({
      status: 'problems',
      problems: ['unknown_package'],
      alternatives: [],
      validPackages: ['4PN', '5PN', '6PN'],
    });
    const unsold = await facade().prepareBotHold(
      o.ws,
      stay(o.botId, p.id, newId(), { packages: [{ unitId: null, name: '4PN' }] }),
    );
    expect(unsold).toMatchObject({ status: 'problems', problems: ['package_unavailable'] });
  });

  it('answers price_changed when a package of the summary was removed', async () => {
    const o = await hotel();
    const p = await aura(o.headers);
    const conversationId = newId();
    await facade().prepareBotHold(o.ws, stay(o.botId, p.id, conversationId));
    await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${p.id}/rates`, {
        version: p.version,
        weekday: [...week('k6', 12_000_000, 18_000_000), ...week('k4', 10_000_000, null)],
        surcharges: { extraAdult: null, extraChild: null },
        packages: [packages[0], packages[2]].map((k) => ({
          ...k,
          id: p.packages.find((x) => x.name === k!.name)!.id,
        })),
      }),
      PropertyDto,
    );
    const r = await facade().confirmBotHold(o.ws, { conversationId });
    expect(r.status).toBe('price_changed');
  });
});
