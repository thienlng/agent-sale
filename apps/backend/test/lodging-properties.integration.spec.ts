import {
  AuthResponse,
  BootstrapResponse,
  BotDto,
  BotPropertiesDto,
  LodgingSettings,
  PropertyDto,
  PropertyList,
} from '@agent-sales/contracts';
import {
  createDb,
  ensureLoginRoles,
  migrate,
  schema,
  withCredentials,
  type Database,
} from '@agent-sales/db';
import { newId, workspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import type { BookingRecord } from '../src/modules/lodging/application/ports/lodging-store.js';
import { addNights, localToday } from '../src/modules/lodging/domain/nights.js';
import { DrizzleLodgingStore } from '../src/modules/lodging/infrastructure/persistence/lodging.drizzle-store.js';

/** T-160 lodging v2 HTTP: properties, rooms, rates, overrides, settings and bot properties. */
let pg: TestPostgres;
let app: NestFastifyApplication;
let owner: { db: Database; close: () => Promise<void> };
let tenant: { db: Database; close: () => Promise<void> };
let store: DrizzleLodgingStore;

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  const tenantUrl = withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password);
  owner = createDb({ url: pg.ownerUrl, max: 1 });
  tenant = createDb({ url: tenantUrl, max: 2 });
  store = new DrizzleLodgingStore(tenant.db);
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
  const r = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      remoteAddress: `10.88.0.${n}`,
      payload: {
        name: 'Test owner',
        email: `lodging-props-${n}@example.test`,
        password: 'a long synthetic password',
        workspaceName: 'Test lodging business',
        industry,
      },
    });
  expect(r.statusCode, r.body).toBe(201);
  const auth = AuthResponse.parse(r.json());
  const authorization = `Bearer ${auth.accessToken}`;
  const boot = BootstrapResponse.parse((await call({ authorization }, 'GET', '/bootstrap')).json());
  const ws = boot.memberships[0]?.workspaceId ?? '';
  return {
    userId: auth.user.id,
    ws,
    headers: { authorization, 'x-workspace-id': ws },
    in: (other: string) => ({ authorization, 'x-workspace-id': other }),
  };
}

async function member(ws: string, role: string) {
  const other = await signup();
  await owner.db.insert(schema.members).values({
    id: newId(),
    workspaceId: ws,
    userId: other.userId,
    role,
    status: 'active',
  });
  return other.in(ws);
}

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

async function create(h: Headers, body: object): Promise<PropertyDto> {
  const r = await call(h, 'POST', '/lodging/properties', body);
  expect(r.statusCode, r.body).toBe(201);
  return PropertyDto.parse(r.json());
}
const villa = (code = 'A17') => ({
  code,
  name: 'SKY VILLA ' + code,
  sellMode: 'whole',
  standardAdults: 20,
  standardChildren: 4,
});
const homestay = (code = 'HS1') => ({
  code,
  name: 'Homestay ' + code,
  sellMode: 'rooms',
  standardAdults: 2,
  standardChildren: 0,
});
const ok = async (r: { statusCode: number; body: string; json: () => unknown }, status = 200) => {
  expect(r.statusCode, r.body).toBe(status);
  return PropertyDto.parse(r.json());
};

function booking(
  propertyId: string,
  unitIds: string[],
  checkIn: string,
  checkOut: string,
  over: Partial<BookingRecord> = {},
): BookingRecord {
  const now = new Date().toISOString();
  return {
    id: newId(),
    code: `BK-${newId().slice(-6)}`,
    propertyId,
    kind: 'stay',
    whole: true,
    unitIds,
    status: 'confirmed',
    checkIn,
    checkOut,
    adults: 2,
    childAges: [],
    guestName: 'Synthetic guest',
    guestPhone: '0000000000',
    contactId: null,
    conversationId: null,
    source: 'phone',
    holdExpiresAt: null,
    quote: null,
    adjustment: 0,
    adjustmentReason: '',
    totalSell: null,
    totalCost: null,
    note: '',
    tags: [],
    blockReason: '',
    clientRequestId: newId(),
    fingerprint: 'fp',
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}
async function seedBooking(ws: string, b: BookingRecord) {
  const nights: string[] = [];
  for (let n = b.checkIn; n < b.checkOut; n = addNights(n, 1)) nights.push(n);
  await store.run(workspaceId(ws), async (tx) => {
    await tx.insertBooking(b);
    await tx.takeNights(b.id, b.unitIds, nights);
  });
}

describe('lodging v2 properties over HTTP', () => {
  it('answers 404 for a non-hotel business', async () => {
    const shop = await signup('fashion');
    const r = await call(shop.headers, 'GET', '/lodging/properties');
    expect(r.statusCode, r.body).toBe(404);
    expect(r.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('creates a whole property with its single whole unit and lists it as free today', async () => {
    const o = await signup();
    const p = await create(o.headers, villa());
    expect(p.version).toBe(1);
    expect(p.units).toHaveLength(1);
    expect(p.units[0]).toMatchObject({
      kind: 'whole',
      name: 'SKY VILLA A17',
      capacityAdults: 20,
      capacityChildren: 4,
      active: true,
    });
    expect(p.rates).toEqual([]);
    expect(p.policies.checkInTime).toBe('');

    const list = PropertyList.parse((await call(o.headers, 'GET', '/lodging/properties')).json());
    expect(list.data.map((x) => [x.code, x.today])).toEqual([['A17', 'free']]);
    expect((await call(o.headers, 'GET', `/lodging/properties/${p.id}`)).statusCode).toBe(200);
    expect((await call(o.headers, 'POST', '/lodging/properties', villa())).statusCode).toBe(409);
    // Another business cannot read it.
    const other = await signup();
    expect((await call(other.headers, 'GET', `/lodging/properties/${p.id}`)).statusCode).toBe(404);
  });

  it('validates weekday coverage of rates and stores surcharges', async () => {
    const o = await signup();
    const p = await create(o.headers, villa());
    const missingSunday = await call(o.headers, 'PUT', `/lodging/properties/${p.id}/rates`, {
      version: 1,
      weekday: [{ unitId: null, weekdays: [1, 2, 3, 4, 5, 6], sell: 10_000_000, cost: 9_000_000 }],
      surcharges: { extraAdult: null, extraChild: null },
    });
    expect(missingSunday.statusCode, missingSunday.body).toBe(400);
    expect(missingSunday.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    const roomTarget = await call(o.headers, 'PUT', `/lodging/properties/${p.id}/rates`, {
      version: 1,
      weekday: [{ unitId: p.units[0]?.id, weekdays: ALL_DAYS, sell: 1, cost: 1 }],
      surcharges: { extraAdult: null, extraChild: null },
    });
    expect(roomTarget.statusCode, roomTarget.body).toBe(400);

    const saved = await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${p.id}/rates`, {
        version: 1,
        weekday: [
          { unitId: null, weekdays: [1, 2, 3, 4, 7], sell: 10_000_000, cost: 9_000_000 },
          { unitId: null, weekdays: [5, 6], sell: 13_000_000, cost: 12_000_000 },
        ],
        surcharges: { extraAdult: { sell: 300_000, cost: 200_000 }, extraChild: null },
      }),
    );
    expect(saved.version).toBe(2);
    expect(saved.rates.filter((r) => r.kind === 'weekday')).toHaveLength(2);
    expect(saved.surcharges).toEqual({
      extraAdult: { sell: 300_000, cost: 200_000 },
      extraChild: null,
    });

    const stale = await call(o.headers, 'PUT', `/lodging/properties/${p.id}/rates`, {
      version: 1,
      weekday: [{ unitId: null, weekdays: ALL_DAYS, sell: 1, cost: 1 }],
      surcharges: { extraAdult: null, extraChild: null },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: { code: 'CONFLICT', details: { reason: 'STALE_VERSION' } },
    });
  });

  it('refuses overlapping overrides and edits, keeps and deletes them by version', async () => {
    const o = await signup();
    const p = await create(o.headers, villa());
    const tet = { unitId: null, label: 'Tết', sell: 20_000_000, cost: 18_000_000, minNights: 2 };
    const first = await ok(
      await call(o.headers, 'POST', `/lodging/properties/${p.id}/overrides`, {
        ...tet,
        version: 1,
        dateFrom: '2027-02-05',
        dateTo: '2027-02-10',
      }),
      201,
    );
    expect(first.version).toBe(2);
    const overlap = await call(o.headers, 'POST', `/lodging/properties/${p.id}/overrides`, {
      ...tet,
      version: 2,
      dateFrom: '2027-02-10',
      dateTo: '2027-02-12',
    });
    expect(overlap.statusCode, overlap.body).toBe(400);
    const foreignUnit = await call(o.headers, 'POST', `/lodging/properties/${p.id}/overrides`, {
      ...tet,
      unitId: newId(),
      version: 2,
      dateFrom: '2027-03-01',
      dateTo: '2027-03-02',
    });
    expect(foreignUnit.statusCode, foreignUnit.body).toBe(400);

    const rateId = first.rates[0]?.id ?? '';
    const edited = await ok(
      await call(o.headers, 'PATCH', `/lodging/properties/${p.id}/overrides/${rateId}`, {
        version: 2,
        sell: 21_000_000,
      }),
    );
    expect(edited.rates[0]).toMatchObject({ sell: 21_000_000, minNights: 2, label: 'Tết' });
    expect(
      (
        await call(o.headers, 'PATCH', `/lodging/properties/${p.id}/overrides/${newId()}`, {
          version: 3,
          sell: 1,
        })
      ).statusCode,
    ).toBe(404);
    const gone = await ok(
      await call(o.headers, 'DELETE', `/lodging/properties/${p.id}/overrides/${rateId}?version=3`),
    );
    expect(gone.rates).toEqual([]);
    expect(gone.version).toBe(4);
  });

  it('lets an analyst read but not write', async () => {
    const o = await signup();
    await create(o.headers, villa());
    const analyst = await member(o.ws, 'analyst');
    expect((await call(analyst, 'GET', '/lodging/properties')).statusCode).toBe(200);
    expect((await call(analyst, 'POST', '/lodging/properties', villa('B1'))).statusCode).toBe(403);
    expect(
      (await call(analyst, 'PATCH', '/lodging/settings', { holdMinutes: 60 })).statusCode,
    ).toBe(403);
  });

  it('re-validates the merged property on PATCH and keeps the whole unit in sync', async () => {
    const o = await signup();
    const p = await create(o.headers, villa());
    const bad = await call(o.headers, 'PATCH', `/lodging/properties/${p.id}`, {
      version: 1,
      patch: { childFreeBelow: 13 },
    });
    expect(bad.statusCode, bad.body).toBe(400);
    const next = await ok(
      await call(o.headers, 'PATCH', `/lodging/properties/${p.id}`, {
        version: 1,
        patch: { name: 'Villa A17 mới', standardAdults: 22, policies: { checkInTime: '14:00' } },
      }),
    );
    expect(next.version).toBe(2);
    expect(next.childAdultFrom).toBe(12);
    expect(next.policies).toMatchObject({ checkInTime: '14:00', checkOutTime: '' });
    expect(next.units).toEqual([
      expect.objectContaining({ kind: 'whole', name: 'Villa A17 mới', capacityAdults: 22 }),
    ]);
  });

  it('refuses a sell-mode change while a future booking exists', async () => {
    const o = await signup();
    const p = await create(o.headers, villa());
    const today = localToday(new Date());
    await seedBooking(
      o.ws,
      booking(p.id, [p.units[0]?.id ?? ''], addNights(today, 5), addNights(today, 7)),
    );
    const r = await call(o.headers, 'PATCH', `/lodging/properties/${p.id}`, {
      version: 1,
      patch: { sellMode: 'rooms' },
    });
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json()).toMatchObject({ error: { code: 'CONFLICT' } });

    const q = await create(o.headers, villa('B2'));
    const rooms = await ok(
      await call(o.headers, 'PATCH', `/lodging/properties/${q.id}`, {
        version: 1,
        patch: { sellMode: 'rooms' },
      }),
    );
    expect(rooms.units).toEqual([]);
    const back = await ok(
      await call(o.headers, 'PATCH', `/lodging/properties/${q.id}`, {
        version: 2,
        patch: { sellMode: 'whole' },
      }),
    );
    expect(back.units).toEqual([
      expect.objectContaining({ id: q.units[0]?.id, kind: 'whole', active: true }),
    ]);
  });

  it('manages rooms of a rooms property and requires rates for every active room', async () => {
    const o = await signup();
    const p = await create(o.headers, homestay());
    expect(p.units).toEqual([]);
    const villaP = await create(o.headers, villa('W1'));
    const notRooms = await call(o.headers, 'PUT', `/lodging/properties/${villaP.id}/units`, {
      version: 1,
      units: [{ name: 'P1', capacityAdults: 2 }],
    });
    expect(notRooms.statusCode, notRooms.body).toBe(409);

    const withRooms = await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${p.id}/units`, {
        version: 1,
        units: [
          { name: 'P1', capacityAdults: 2 },
          { name: 'P2', capacityAdults: 3, capacityChildren: 1 },
        ],
      }),
    );
    expect(withRooms.units.map((u) => [u.name, u.kind, u.sortOrder])).toEqual([
      ['P1', 'room', 0],
      ['P2', 'room', 1],
    ]);
    const [p1, p2] = withRooms.units;

    const foreign = await call(o.headers, 'PUT', `/lodging/properties/${p.id}/units`, {
      version: 2,
      units: [{ id: villaP.units[0]?.id, name: 'Stolen', capacityAdults: 2 }],
    });
    expect(foreign.statusCode, foreign.body).toBe(400);

    const onlyP1 = await call(o.headers, 'PUT', `/lodging/properties/${p.id}/rates`, {
      version: 2,
      weekday: [{ unitId: p1?.id, weekdays: ALL_DAYS, sell: 1_000_000, cost: 800_000 }],
      surcharges: { extraAdult: null, extraChild: null },
    });
    expect(onlyP1.statusCode, onlyP1.body).toBe(400);
    const otherProperty = await call(o.headers, 'PUT', `/lodging/properties/${p.id}/rates`, {
      version: 2,
      weekday: [
        { unitId: p1?.id, weekdays: ALL_DAYS, sell: 1, cost: 1 },
        { unitId: p2?.id, weekdays: ALL_DAYS, sell: 1, cost: 1 },
        { unitId: villaP.units[0]?.id, weekdays: ALL_DAYS, sell: 1, cost: 1 },
      ],
      surcharges: { extraAdult: null, extraChild: null },
    });
    expect(otherProperty.statusCode, otherProperty.body).toBe(400);
    const priced = await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${p.id}/rates`, {
        version: 2,
        weekday: [
          { unitId: p1?.id, weekdays: ALL_DAYS, sell: 1_000_000, cost: 800_000 },
          { unitId: p2?.id, weekdays: ALL_DAYS, sell: 1_200_000, cost: 900_000 },
        ],
        surcharges: { extraAdult: null, extraChild: null },
      }),
    );
    expect(priced.version).toBe(3);

    // A room holding nights cannot be removed, only deactivated.
    const today = localToday(new Date());
    await seedBooking(
      o.ws,
      booking(p.id, [p2?.id ?? ''], addNights(today, 1), addNights(today, 2), { whole: false }),
    );
    const remove = await call(o.headers, 'PUT', `/lodging/properties/${p.id}/units`, {
      version: 3,
      units: [{ id: p1?.id, name: 'P1', capacityAdults: 2 }],
    });
    expect(remove.statusCode, remove.body).toBe(409);
    const deactivated = await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${p.id}/units`, {
        version: 3,
        units: [
          { id: p1?.id, name: 'P1', capacityAdults: 2 },
          { id: p2?.id, name: 'P2', capacityAdults: 3, active: false },
          { name: 'P3', capacityAdults: 2 },
        ],
      }),
    );
    expect(deactivated.units.map((u) => [u.name, u.active])).toEqual([
      ['P1', true],
      ['P2', false],
      ['P3', true],
    ]);
  });

  it('shows today as occupied, partial or hold in the list', async () => {
    const o = await signup();
    const today = localToday(new Date());
    const w = await create(o.headers, villa());
    await seedBooking(o.ws, booking(w.id, [w.units[0]?.id ?? ''], today, addNights(today, 1)));
    const h = await create(o.headers, villa('H1'));
    await seedBooking(
      o.ws,
      booking(h.id, [h.units[0]?.id ?? ''], addNights(today, -1), addNights(today, 2), {
        status: 'hold',
        holdExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    );
    const r = await create(o.headers, homestay());
    const rooms = await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${r.id}/units`, {
        version: 1,
        units: [
          { name: 'P1', capacityAdults: 2 },
          { name: 'P2', capacityAdults: 2 },
        ],
      }),
    );
    await seedBooking(
      o.ws,
      booking(r.id, [rooms.units[0]?.id ?? ''], today, addNights(today, 1), { whole: false }),
    );
    const list = PropertyList.parse((await call(o.headers, 'GET', '/lodging/properties')).json());
    expect(Object.fromEntries(list.data.map((x) => [x.code, x.today]))).toEqual({
      A17: 'occupied',
      H1: 'hold',
      HS1: 'partial',
    });
  });

  it('reads and updates settings and the properties a bot sells', async () => {
    const o = await signup();
    expect(
      LodgingSettings.parse((await call(o.headers, 'GET', '/lodging/settings')).json()),
    ).toEqual({ holdMinutes: 120 });
    const patched = await call(o.headers, 'PATCH', '/lodging/settings', { holdMinutes: 60 });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(LodgingSettings.parse(patched.json())).toEqual({ holdMinutes: 60 });

    const a = await create(o.headers, villa('A1'));
    const b = await create(o.headers, villa('B1'));
    const bot = await call(o.headers, 'POST', '/bots', { name: 'Bot', industry: 'hotel' });
    expect(bot.statusCode, bot.body).toBe(201);
    const botId = BotDto.parse(bot.json()).id;
    const read = async () => {
      const r = await call(o.headers, 'GET', `/lodging/bots/${botId}/properties`);
      expect(r.statusCode, r.body).toBe(200);
      return BotPropertiesDto.parse(r.json()).propertyIds.sort();
    };
    expect(await read()).toEqual([a.id, b.id].sort());
    const put = await call(o.headers, 'PUT', `/lodging/bots/${botId}/properties`, {
      propertyIds: [b.id],
    });
    expect(put.statusCode, put.body).toBe(200);
    expect(await read()).toEqual([b.id]);
    // Spec §3.7: a new property is sold by every bot, including bots with an explicit list.
    const c = await create(o.headers, villa('C1'));
    expect(await read()).toEqual([b.id, c.id].sort());
    expect(
      (
        await call(o.headers, 'PUT', `/lodging/bots/${botId}/properties`, {
          propertyIds: [newId()],
        })
      ).statusCode,
    ).toBe(400);
    expect((await call(o.headers, 'GET', `/lodging/bots/${newId()}/properties`)).statusCode).toBe(
      404,
    );
  });
});
