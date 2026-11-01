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
import { addNights, localToday } from '../src/modules/lodging/domain/nights.js';

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
  const r = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      remoteAddress: `10.88.0.${n}`,
      payload: {
        name: 'Test owner',
        email: `lodging-bot-holds-${n}@example.test`,
        password: 'a long synthetic password',
        workspaceName: 'Test lodging business',
        industry: 'hotel',
      },
    });
  expect(r.statusCode, r.body).toBe(201);
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
    // A second confirm finds nothing to confirm.
    expect(await facade().confirmBotHold(o.ws, { conversationId })).toMatchObject({
      status: 'no_draft',
    });

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
    expect((await facade().hasBotHoldDraft(o.ws, conversationId)).pending).toBe(false);
    expect(await facade().confirmBotHold(o.ws, { conversationId })).toMatchObject({
      status: 'expired',
    });

    const other = newId();
    await facade().prepareBotHold(o.ws, holdInput(o.botId, a.id, other));
    expect((await facade().hasBotHoldDraft(o.ws, other)).pending).toBe(true);
    await facade().cancelBotHoldDraft(o.ws, { conversationId: other });
    expect((await facade().hasBotHoldDraft(o.ws, other)).pending).toBe(false);
    expect(await facade().confirmBotHold(o.ws, { conversationId: other })).toMatchObject({
      status: 'no_draft',
    });
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
