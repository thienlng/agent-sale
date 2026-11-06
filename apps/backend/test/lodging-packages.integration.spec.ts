import {
  AuthResponse,
  AvailabilityDto,
  BookingDetail,
  BootstrapResponse,
  CalendarDto,
  PropertyDto,
  PropertyList,
  QuoteDto,
} from '@agent-sales/contracts';
import {
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
import { addNights, isoWeekday, localToday } from '../src/modules/lodging/domain/nights.js';
import { signUpVerified } from './support/signup.js';

/** T-193 over HTTP: unit details, bedroom packages in rates, bookings, calendar, availability. */
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
type Reply = { statusCode: number; body: string; json: () => unknown };
const call = (h: Headers, method: Method, path: string, payload?: object) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({ method, url: '/api/v1' + path, headers: h, ...(payload ? { payload } : {}) });

let signups = 0;
async function signup() {
  const n = ++signups;
  const r = await signUpVerified(
    app,
    {
      name: 'Test owner',
      email: `lodging-packages-${n}@example.test`,
      password: 'a long synthetic password',
      workspaceName: 'Test lodging business',
      industry: 'hotel',
    },
    { remoteAddress: `10.91.0.${n}` },
  );
  expect(r.statusCode).toBe(201);
  const auth = AuthResponse.parse(r.json());
  const authorization = `Bearer ${auth.accessToken}`;
  const boot = BootstrapResponse.parse((await call({ authorization }, 'GET', '/bootstrap')).json());
  const ws = boot.memberships[0]?.workspaceId ?? '';
  return { ws, headers: { authorization, 'x-workspace-id': ws } };
}

async function ok<T>(r: Reply, parse: { parse: (v: unknown) => T }, status = 200): Promise<T> {
  expect(r.statusCode, r.body).toBe(status);
  return parse.parse(r.json());
}
function refused(r: Reply, details: object = {}) {
  expect(r.statusCode, r.body).toBe(400);
  expect(r.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED', details } });
}

const NO_SURCHARGES = { extraAdult: null, extraChild: null };
const today = localToday(new Date());
const night = (n: number) => addNights(today, n);
/** Days from today to the next Friday at least 7 days ahead. */
const friday = (() => {
  let n = 7;
  while (isoWeekday(night(n)) !== 5) n += 1;
  return n;
})();

/** "Aura Villa 6PN" packages and prices (T-193 spec); 4PN is not sold on Saturday. */
const auraPackages = [
  { key: 'k6', unitId: null, name: '6PN', bedrooms: 6, standardAdults: 12, maxGuests: 16 },
  { key: 'k5', unitId: null, name: '5PN', bedrooms: 5, standardAdults: 10, maxGuests: 12 },
  { key: 'k4', unitId: null, name: '4PN', bedrooms: 4, standardAdults: 8, maxGuests: 10 },
];
const auraWeekday = (target: string | null = null) => {
  type Week = [number, number, number | null, number];
  const rows = (key: string, [monThu, fri, sat, sun]: Week) =>
    (
      [
        [[1, 2, 3, 4], monThu],
        [[5], fri],
        [[6], sat],
        [[7], sun],
      ] as const
    ).flatMap(([weekdays, sell]) =>
      sell === null
        ? []
        : [
            {
              unitId: target,
              weekdays: [...weekdays],
              sell,
              cost: sell - 1_000_000,
              packageKey: key,
            },
          ],
    );
  return [
    ...rows('k6', [10_000_000, 12_000_000, 18_000_000, 12_000_000]),
    ...rows('k5', [9_000_000, 11_000_000, 16_000_000, 11_000_000]),
    ...rows('k4', [8_000_000, 10_000_000, null, 10_000_000]),
  ];
};

async function auraVilla(h: Headers, code = 'AURA'): Promise<PropertyDto> {
  const p = await ok(
    await call(h, 'POST', '/lodging/properties', {
      code,
      name: 'Aura Villa ' + code,
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
      weekday: auraWeekday(),
      surcharges: NO_SURCHARGES,
      packages: auraPackages,
    }),
    PropertyDto,
  );
}

async function homestay(h: Headers, code = 'HS1'): Promise<PropertyDto> {
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
  return ok(
    await call(h, 'PUT', `/lodging/properties/${p.id}/units`, {
      version: p.version,
      units: [
        { name: 'B1', capacityAdults: 2 },
        { name: 'B2', capacityAdults: 2 },
      ],
    }),
    PropertyDto,
  );
}

const packageId = (p: PropertyDto, name: string) =>
  p.packages.find((pk) => pk.name === name)?.id ?? '';

const stay = (propertyId: string, over: object = {}) => ({
  kind: 'stay',
  clientRequestId: newId(),
  propertyId,
  whole: true,
  unitIds: [],
  checkIn: night(friday),
  checkOut: night(friday + 2),
  status: 'confirmed',
  party: { adults: 6, childAges: [] },
  guestName: 'Synthetic guest',
  guestPhone: '0900000000',
  source: 'phone',
  ...over,
});

const bookingUnitPackages = (bookingId: string) =>
  owner.db
    .select({
      unitId: schema.lodgingBookingUnits.unitId,
      packageId: schema.lodgingBookingUnits.packageId,
    })
    .from(schema.lodgingBookingUnits)
    .where(eq(schema.lodgingBookingUnits.bookingId, bookingId));

describe('lodging rates with bedroom packages over HTTP (T-193)', () => {
  it('stores packages with their rates, returns them and prices the list by the full package', async () => {
    const o = await signup();
    const p = await auraVilla(o.headers);
    expect(p.packages.map((pk) => [pk.name, pk.bedrooms, pk.sortOrder, pk.unitId])).toEqual([
      ['6PN', 6, 0, null],
      ['5PN', 5, 1, null],
      ['4PN', 4, 2, null],
    ]);
    expect(p.packages[2]).toMatchObject({ standardAdults: 8, standardChildren: 0, maxGuests: 10 });
    const pk4 = packageId(p, '4PN');
    expect(
      p.rates
        .filter((r) => r.packageId === pk4)
        .flatMap((r) => r.weekdays)
        .sort(),
    ).toEqual([1, 2, 3, 4, 5, 7]);
    expect(p.rates.every((r) => p.packages.some((pk) => pk.id === r.packageId))).toBe(true);

    const got = await ok(await call(o.headers, 'GET', `/lodging/properties/${p.id}`), PropertyDto);
    expect(got.packages).toEqual(p.packages);
    expect(got.rates).toHaveLength(p.rates.length);

    const list = await ok(await call(o.headers, 'GET', '/lodging/properties'), PropertyList);
    expect(list.data[0]?.packages).toEqual(p.packages);
    expect(list.data[0]?.weekdaySell).toEqual([
      10_000_000, 10_000_000, 10_000_000, 10_000_000, 12_000_000, 18_000_000, 12_000_000,
    ]);
  });

  it('keeps package ids it is given, swaps names and drops the missing ones with their rates', async () => {
    const o = await signup();
    const p = await auraVilla(o.headers);
    const [pk6, pk5, pk4] = ['6PN', '5PN', '4PN'].map((n) => packageId(p, n));
    // 5PN and 4PN swap names (and bedrooms); 6PN is removed, so 5 bedrooms become the full one.
    const saved = await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${p.id}/rates`, {
        version: p.version,
        weekday: [
          {
            unitId: null,
            weekdays: [1, 2, 3, 4, 5, 6, 7],
            sell: 9_000_000,
            cost: 1,
            packageKey: 'a',
          },
          { unitId: null, weekdays: [1, 2, 3], sell: 8_000_000, cost: 1, packageKey: 'b' },
        ],
        surcharges: NO_SURCHARGES,
        packages: [
          { id: pk5, key: 'a', unitId: null, name: '4PN', bedrooms: 5, standardAdults: 10 },
          { id: pk4, key: 'b', unitId: null, name: '5PN', bedrooms: 4, standardAdults: 8 },
        ],
      }),
      PropertyDto,
    );
    expect(saved.packages.map((pk) => [pk.id, pk.name])).toEqual([
      [pk5, '4PN'],
      [pk4, '5PN'],
    ]);
    expect(saved.rates.some((r) => r.packageId === pk6)).toBe(false);
    expect(saved.rates.filter((r) => r.packageId === pk4)).toHaveLength(1);

    // Dropping every package returns the target to plain rates.
    const plain = await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${p.id}/rates`, {
        version: saved.version,
        weekday: [{ unitId: null, weekdays: [1, 2, 3, 4, 5, 6, 7], sell: 5_000_000, cost: 1 }],
        surcharges: NO_SURCHARGES,
      }),
      PropertyDto,
    );
    expect(plain.packages).toEqual([]);
    expect(plain.rates.map((r) => r.packageId)).toEqual([null]);
  });

  it('refuses rates and packages that do not fit their targets', async () => {
    const o = await signup();
    const p = await auraVilla(o.headers);
    const hs = await homestay(o.headers);
    const [b1, b2] = hs.units.map((u) => u.id);
    const put = (target: PropertyDto, body: object) =>
      call(o.headers, 'PUT', `/lodging/properties/${target.id}/rates`, {
        version: target.version,
        surcharges: NO_SURCHARGES,
        ...body,
      });
    const all = [1, 2, 3, 4, 5, 6, 7];
    const roomPackage = { key: 'r', unitId: b1, name: '2PN', bedrooms: 2, standardAdults: 4 };

    // A rate of a target without packages (B2) names a package (B1's full one).
    refused(
      await put(hs, {
        packages: [roomPackage],
        weekday: [
          { unitId: b1, weekdays: all, sell: 1, cost: 1, packageKey: 'r' },
          { unitId: b2, weekdays: all, sell: 1, cost: 1, packageKey: 'r' },
        ],
      }),
      { unitId: b2 },
    );
    // A non-full package rate on a target without packages: the key is unknown there.
    refused(
      await put(hs, {
        weekday: [
          { unitId: b1, weekdays: all, sell: 1, cost: 1 },
          { unitId: b2, weekdays: all, sell: 1, cost: 1, packageKey: 'small' },
        ],
      }),
      { packageKey: 'small' },
    );
    // A package-less rate on a target with packages.
    refused(
      await put(hs, {
        packages: [roomPackage],
        weekday: [
          { unitId: b1, weekdays: all, sell: 1, cost: 1 },
          { unitId: b2, weekdays: all, sell: 1, cost: 1 },
        ],
      }),
      { unitId: b1 },
    );
    // The full package must price every weekday.
    refused(
      await put(p, {
        packages: auraPackages,
        weekday: auraWeekday().filter((r) => !(r.packageKey === 'k6' && r.weekdays.includes(6))),
      }),
      { unitId: null, weekdays: [1, 2, 3, 4, 5, 7] },
    );
    // A package of a unit of another property (the database does not check that).
    const other = await homestay(o.headers, 'HS2');
    const foreign = other.units[0]?.id;
    refused(
      await put(hs, {
        packages: [{ ...roomPackage, unitId: foreign }],
        weekday: [
          { unitId: b1, weekdays: all, sell: 1, cost: 1 },
          { unitId: b2, weekdays: all, sell: 1, cost: 1 },
          { unitId: foreign, weekdays: all, sell: 1, cost: 1, packageKey: 'r' },
        ],
      }),
      { unitId: foreign },
    );
    // A package id of another property, a key used twice, equal bedrooms.
    refused(
      await put(hs, {
        packages: [{ ...roomPackage, id: packageId(p, '6PN') }],
        weekday: [{ unitId: b1, weekdays: all, sell: 1, cost: 1, packageKey: 'r' }],
      }),
      { packageId: packageId(p, '6PN') },
    );
    refused(
      await put(p, {
        packages: [...auraPackages, { ...auraPackages[0], name: '7PN', bedrooms: 7 }],
        weekday: auraWeekday(),
      }),
      { key: 'k6' },
    );
    refused(
      await put(p, {
        packages: [...auraPackages, { ...auraPackages[0], key: 'k7', name: '6PN bis' }],
        weekday: auraWeekday(),
      }),
      { bedrooms: 6 },
    );
    // A kept package id cannot move to another target (here: whole property → a room).
    const retarget = await put(hs, {
      packages: [{ ...roomPackage, id: packageId(p, '6PN') }],
      weekday: [{ unitId: b1, weekdays: all, sell: 1, cost: 1, packageKey: 'r' }],
    });
    expect(retarget.statusCode).toBe(400);
    const roomPriced = await ok(
      await put(hs, {
        packages: [roomPackage],
        weekday: [
          { unitId: b1, weekdays: all, sell: 1, cost: 1, packageKey: 'r' },
          { unitId: b2, weekdays: all, sell: 1, cost: 1 },
        ],
      }),
      PropertyDto,
    );
    const b1Package = packageId(roomPriced, '2PN');
    refused(
      await put(roomPriced, {
        packages: [{ ...roomPackage, id: b1Package, unitId: b2 }],
        weekday: [
          { unitId: b1, weekdays: all, sell: 1, cost: 1 },
          { unitId: b2, weekdays: all, sell: 1, cost: 1, packageKey: 'r' },
        ],
      }),
      { packageId: b1Package, unitId: b2 },
    );
    // Nothing changed.
    const still = await ok(
      await call(o.headers, 'GET', `/lodging/properties/${p.id}`),
      PropertyDto,
    );
    expect(still.version).toBe(p.version);
  });

  it('prices room packages per room and keeps a deactivated room’s packages', async () => {
    const o = await signup();
    const hs = await homestay(o.headers);
    const [b1, b2] = hs.units.map((u) => u.id);
    const all = [1, 2, 3, 4, 5, 6, 7];
    const priced = await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${hs.id}/rates`, {
        version: hs.version,
        surcharges: NO_SURCHARGES,
        packages: [
          { key: 'big', unitId: b1, name: '2PN', bedrooms: 2, standardAdults: 4 },
          { key: 'small', unitId: b1, name: '1PN', bedrooms: 1, standardAdults: 2 },
        ],
        weekday: [
          { unitId: b1, weekdays: all, sell: 2_000_000, cost: 1, packageKey: 'big' },
          { unitId: b1, weekdays: [1, 2, 3, 4], sell: 1_000_000, cost: 1, packageKey: 'small' },
          { unitId: b2, weekdays: all, sell: 1_500_000, cost: 1 },
        ],
      }),
      PropertyDto,
    );
    expect(priced.packages.map((pk) => [pk.unitId, pk.name])).toEqual([
      [b1, '2PN'],
      [b1, '1PN'],
    ]);
    const list = await ok(await call(o.headers, 'GET', '/lodging/properties'), PropertyList);
    expect(list.data[0]?.weekdaySell[0]).toBe(3_500_000);

    const units = priced.units.map((u) => ({
      id: u.id,
      name: u.name,
      capacityAdults: u.capacityAdults,
      active: u.id !== b1,
    }));
    const deactivated = await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${hs.id}/units`, {
        version: priced.version,
        units,
      }),
      PropertyDto,
    );
    expect(deactivated.packages).toHaveLength(2);
    // The inactive room's packages may come back without its rates; they are kept.
    const keptInactive = await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${hs.id}/rates`, {
        version: deactivated.version,
        surcharges: NO_SURCHARGES,
        packages: deactivated.packages.map(({ sortOrder: _s, ...pk }) => ({ ...pk, key: pk.id })),
        weekday: [{ unitId: b2, weekdays: all, sell: 1_500_000, cost: 1 }],
      }),
      PropertyDto,
    );
    expect(keptInactive.packages.map((pk) => pk.id)).toEqual(
      deactivated.packages.map((pk) => pk.id),
    );
    expect(keptInactive.rates.map((r) => r.unitId)).toEqual([b2]);
    // A new package needs an active room.
    refused(
      await call(o.headers, 'PUT', `/lodging/properties/${hs.id}/rates`, {
        version: keptInactive.version,
        surcharges: NO_SURCHARGES,
        packages: [{ key: 'n', unitId: b1, name: '3PN', bedrooms: 3, standardAdults: 6 }],
        weekday: [
          { unitId: b1, weekdays: all, sell: 2_000_000, cost: 1, packageKey: 'n' },
          { unitId: b2, weekdays: all, sell: 1_500_000, cost: 1 },
        ],
      }),
      { unitId: b1 },
    );
  });

  it('takes a package on date-range prices of the same target only', async () => {
    const o = await signup();
    const p = await auraVilla(o.headers);
    const tet = {
      unitId: null,
      dateFrom: night(30),
      dateTo: night(32),
      label: 'Tết',
      sell: 25_000_000,
      cost: 20_000_000,
    };
    refused(
      await call(o.headers, 'POST', `/lodging/properties/${p.id}/overrides`, {
        ...tet,
        version: p.version,
      }),
      { unitId: null, packageId: null },
    );
    refused(
      await call(o.headers, 'POST', `/lodging/properties/${p.id}/overrides`, {
        ...tet,
        version: p.version,
        packageId: newId(),
      }),
    );
    const pk5 = packageId(p, '5PN');
    const withOverride = await ok(
      await call(o.headers, 'POST', `/lodging/properties/${p.id}/overrides`, {
        ...tet,
        version: p.version,
        packageId: pk5,
      }),
      PropertyDto,
      201,
    );
    const override = withOverride.rates.find((r) => r.kind === 'override');
    expect(override).toMatchObject({ packageId: pk5, label: 'Tết' });
    // The same dates on another package do not overlap.
    const second = await ok(
      await call(o.headers, 'POST', `/lodging/properties/${p.id}/overrides`, {
        ...tet,
        version: withOverride.version,
        packageId: packageId(p, '6PN'),
      }),
      PropertyDto,
      201,
    );
    refused(
      await call(o.headers, 'PATCH', `/lodging/properties/${p.id}/overrides/${override?.id}`, {
        version: second.version,
        packageId: null,
      }),
    );

    // Removing 5PN deletes its date-range price (cascade); the 6PN one stays.
    const pkgs = second.packages.filter((pk) => pk.id !== pk5);
    const after = await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${p.id}/rates`, {
        version: second.version,
        surcharges: NO_SURCHARGES,
        packages: pkgs.map((pk) => ({ ...pk, key: pk.id, sortOrder: undefined })),
        weekday: second.rates
          .filter((r) => r.kind === 'weekday' && r.packageId !== pk5)
          .map((r) => ({
            unitId: r.unitId,
            weekdays: r.weekdays,
            sell: r.sell,
            cost: r.cost,
            packageKey: r.packageId,
          })),
      }),
      PropertyDto,
    );
    expect(after.rates.filter((r) => r.kind === 'override').map((r) => r.packageId)).toEqual([
      packageId(p, '6PN'),
    ]);
  });
});

describe('package-less overrides when a target gets packages (T-193)', () => {
  it('moves them onto the full package in the same write', async () => {
    const o = await signup();
    const p = await ok(
      await call(o.headers, 'POST', '/lodging/properties', {
        code: 'MOVE',
        name: 'Villa MOVE',
        sellMode: 'whole',
        standardAdults: 12,
        standardChildren: 0,
      }),
      PropertyDto,
      201,
    );
    const plain = await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${p.id}/rates`, {
        version: p.version,
        weekday: [{ unitId: null, weekdays: [1, 2, 3, 4, 5, 6, 7], sell: 9_000_000, cost: 1 }],
        surcharges: NO_SURCHARGES,
      }),
      PropertyDto,
    );
    const withTet = await ok(
      await call(o.headers, 'POST', `/lodging/properties/${p.id}/overrides`, {
        version: plain.version,
        unitId: null,
        dateFrom: night(30),
        dateTo: night(32),
        label: 'Tết',
        sell: 25_000_000,
        cost: 20_000_000,
      }),
      PropertyDto,
      201,
    );
    const tetId = withTet.rates.find((r) => r.kind === 'override')?.id;
    const packaged = await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${p.id}/rates`, {
        version: withTet.version,
        weekday: auraWeekday(),
        surcharges: NO_SURCHARGES,
        packages: auraPackages,
      }),
      PropertyDto,
    );
    const tet = packaged.rates.find((r) => r.id === tetId);
    expect(tet).toMatchObject({
      kind: 'override',
      label: 'Tết',
      packageId: packageId(packaged, '6PN'),
    });
    const q = await ok(
      await call(o.headers, 'POST', '/lodging/quote', {
        propertyId: p.id,
        whole: true,
        packageIds: [packageId(packaged, '6PN')],
        checkIn: night(30),
        checkOut: night(31),
        party: { adults: 6, childAges: [] },
      }),
      QuoteDto,
    );
    expect(q.totalSell).toBe(25_000_000);
  });
});

describe('lodging unit details over HTTP (T-193)', () => {
  it('stores and returns the new unit fields, and checks each unit gallery', async () => {
    const o = await signup();
    const hs = await homestay(o.headers);
    const photo = `/media/products/${o.ws}/01890000-0000-7000-8000-0000000000aa.jpg`;
    const bungalow = {
      id: hs.units[0]?.id,
      name: 'Bungalow đồi',
      capacityAdults: 2,
      capacityChildren: 1,
      category: 'bungalow',
      view: 'View đồi thông',
      areaM2: 35,
      description: 'Bungalow gỗ',
      amenities: ['Bồn tắm', 'Ban công'],
      maxGuests: 4,
      gallery: [{ id: 'f1', name: 'Ảnh', items: [{ kind: 'image', url: photo, caption: '' }] }],
      galleryCover: photo,
    };
    const saved = await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${hs.id}/units`, {
        version: hs.version,
        units: [bungalow, { id: hs.units[1]?.id, name: 'B2', capacityAdults: 2 }],
      }),
      PropertyDto,
    );
    expect(saved.units[0]).toMatchObject({
      category: 'bungalow',
      view: 'View đồi thông',
      areaM2: 35,
      description: 'Bungalow gỗ',
      amenities: ['Bồn tắm', 'Ban công'],
      maxGuests: 4,
      galleryCover: photo,
    });
    expect(saved.units[0]?.gallery[0]?.items[0]?.url).toBe(photo);
    expect(saved.units[1]).toMatchObject({
      category: 'room',
      view: '',
      areaM2: null,
      amenities: [],
      maxGuests: null,
      gallery: [],
      galleryCover: '',
    });
    const got = await ok(await call(o.headers, 'GET', `/lodging/properties/${hs.id}`), PropertyDto);
    expect(got.units).toEqual(saved.units);

    const foreign = `/media/products/${newId()}/01890000-0000-7000-8000-0000000000aa.jpg`;
    const r = await call(o.headers, 'PUT', `/lodging/properties/${hs.id}/units`, {
      version: saved.version,
      units: [
        { name: 'B1', capacityAdults: 2 },
        {
          ...bungalow,
          gallery: [
            {
              id: 'f1',
              name: 'Ảnh',
              items: [{ kind: 'link', url: 'https://youtu.be/x', caption: '' }],
            },
            { id: 'f2', name: 'Khác', items: [{ kind: 'image', url: foreign, caption: '' }] },
          ],
          galleryCover: '',
        },
      ],
    });
    refused(r, { reason: 'IMAGE_NOT_UPLOADED', field: 'units[1].gallery[1].items[0].url' });
  });
});

describe('lodging bookings with bedroom packages over HTTP (T-193)', () => {
  it('auto-picks, stores and shows the package; an edit of the package re-quotes', async () => {
    const o = await signup();
    const p = await auraVilla(o.headers);
    const [pk6, pk5] = ['6PN', '5PN'].map((n) => packageId(p, n));

    const q = await ok(
      await call(o.headers, 'POST', '/lodging/quote', {
        propertyId: p.id,
        whole: true,
        checkIn: night(friday),
        checkOut: night(friday + 2),
        party: { adults: 6, childAges: [] },
      }),
      QuoteDto,
    );
    expect(q.packages).toEqual([{ target: null, packageId: pk5, name: '5PN' }]);
    expect(q.totalSell).toBe(27_000_000);

    const avail = await ok(
      await call(o.headers, 'POST', '/lodging/availability', {
        checkIn: night(friday),
        checkOut: night(friday + 2),
        party: { adults: 6, childAges: [] },
      }),
      AvailabilityDto,
    );
    expect(avail.options[0]?.packages).toEqual(q.packages);
    expect(avail.options[0]?.alternatives.map((a) => [a.name, a.totalSell])).toEqual([
      ['4PN', null],
      ['6PN', 30_000_000],
    ]);

    const b = await ok(
      await call(o.headers, 'POST', '/lodging/bookings', stay(p.id)),
      BookingDetail,
      201,
    );
    expect(b).toMatchObject({ packageIds: [pk5], packageNames: ['5PN'], totalSell: 27_000_000 });
    expect(b.quote?.packages).toEqual(q.packages);
    expect(await bookingUnitPackages(b.id)).toEqual([{ unitId: p.units[0]?.id, packageId: pk5 }]);

    const cal = await ok(
      await call(
        o.headers,
        'GET',
        `/lodging/calendar?from=${night(friday)}&to=${night(friday + 2)}`,
      ),
      CalendarDto,
    );
    expect(cal.properties[0]?.wholePrices.map((n) => n.sell)).toEqual([12_000_000, 18_000_000]);
    expect(cal.properties[0]?.rows[0]?.segments[0]?.packageNames).toEqual(['5PN']);

    // A note edit keeps the package; a package edit re-quotes.
    const noted = await ok(
      await call(o.headers, 'PATCH', `/lodging/bookings/${b.id}`, {
        version: b.version,
        note: 'x',
      }),
      BookingDetail,
    );
    expect(noted).toMatchObject({ packageIds: [pk5], totalSell: 27_000_000 });
    const bigger = await ok(
      await call(o.headers, 'PATCH', `/lodging/bookings/${b.id}`, {
        version: noted.version,
        packageIds: [pk6],
      }),
      BookingDetail,
    );
    expect(bigger).toMatchObject({
      packageIds: [pk6],
      packageNames: ['6PN'],
      totalSell: 30_000_000,
    });
    expect(await bookingUnitPackages(b.id)).toEqual([{ unitId: p.units[0]?.id, packageId: pk6 }]);

    // A party change keeps the chosen package.
    const more = await ok(
      await call(o.headers, 'PATCH', `/lodging/bookings/${b.id}`, {
        version: bigger.version,
        party: { adults: 8, childAges: [] },
      }),
      BookingDetail,
    );
    expect(more.packageIds).toEqual([pk6]);
  });

  it('needs a new price when a manual-price stay changes package; an unsold night warns', async () => {
    const o = await signup();
    const p = await auraVilla(o.headers);
    const [pk6, pk4] = ['6PN', '4PN'].map((n) => packageId(p, n));
    const b = await ok(
      await call(
        o.headers,
        'POST',
        '/lodging/bookings',
        stay(p.id, { manualTotalSell: 20_000_000, packageIds: [pk6] }),
      ),
      BookingDetail,
      201,
    );
    expect(b).toMatchObject({ packageIds: [pk6], totalSell: 20_000_000 });
    refused(
      await call(o.headers, 'PATCH', `/lodging/bookings/${b.id}`, {
        version: b.version,
        packageIds: [pk4],
      }),
      { field: 'manualTotalSell' },
    );
    // 4PN is not sold on Saturday: the quote warns and a price must be entered.
    const unsold = await call(o.headers, 'PATCH', `/lodging/bookings/${b.id}`, {
      version: b.version,
      packageIds: [pk4],
      manualTotalSell: null,
    });
    refused(unsold, { field: 'manualTotalSell' });
    const priced = await ok(
      await call(o.headers, 'PATCH', `/lodging/bookings/${b.id}`, {
        version: b.version,
        packageIds: [pk4],
        manualTotalSell: 15_000_000,
      }),
      BookingDetail,
    );
    expect(priced).toMatchObject({ packageIds: [pk4], totalSell: 15_000_000 });
    expect(priced.quote?.warnings).toEqual(
      expect.arrayContaining(['missing_rate', 'package_unavailable']),
    );
    // A package of another property is refused.
    const other = await auraVilla(o.headers, 'AURA2');
    refused(
      await call(
        o.headers,
        'POST',
        '/lodging/bookings',
        stay(p.id, {
          packageIds: [packageId(other, '6PN')],
          checkIn: night(friday + 7),
          checkOut: night(friday + 8),
        }),
      ),
    );
  });

  it('stores the whole-property package on every room of a whole rental', async () => {
    const o = await signup();
    const hs = await homestay(o.headers);
    const [b1, b2] = hs.units.map((u) => u.id);
    const all = [1, 2, 3, 4, 5, 6, 7];
    const priced = await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${hs.id}/rates`, {
        version: hs.version,
        surcharges: NO_SURCHARGES,
        packages: [{ key: 'w', unitId: null, name: 'Nguyên căn', bedrooms: 2, standardAdults: 4 }],
        weekday: [
          { unitId: null, weekdays: all, sell: 3_000_000, cost: 1, packageKey: 'w' },
          { unitId: b1, weekdays: all, sell: 1_000_000, cost: 1 },
          { unitId: b2, weekdays: all, sell: 1_200_000, cost: 1 },
        ],
      }),
      PropertyDto,
    );
    const pkw = packageId(priced, 'Nguyên căn');
    const whole = await ok(
      await call(o.headers, 'POST', '/lodging/bookings', stay(hs.id, { party: { adults: 3 } })),
      BookingDetail,
      201,
    );
    expect(whole).toMatchObject({ packageIds: [pkw], packageNames: ['Nguyên căn'] });
    expect(whole.totalSell).toBe(6_000_000);
    const rows = await bookingUnitPackages(whole.id);
    expect(rows.map((r) => r.packageId)).toEqual([pkw, pkw]);
    expect(rows.map((r) => r.unitId).sort()).toEqual([b1, b2].sort());

    // A room stay sells no package.
    const room = await ok(
      await call(
        o.headers,
        'POST',
        '/lodging/bookings',
        stay(hs.id, {
          whole: false,
          unitIds: [b1],
          party: { adults: 2 },
          checkIn: night(friday + 7),
          checkOut: night(friday + 8),
        }),
      ),
      BookingDetail,
      201,
    );
    expect(room).toMatchObject({ packageIds: [], packageNames: [] });
  });

  it('re-picks an auto package that no longer fits when the dates move (review F1)', async () => {
    const o = await signup();
    const p = await auraVilla(o.headers);
    const monday = friday + 3;
    const b = await ok(
      await call(
        o.headers,
        'POST',
        '/lodging/bookings',
        stay(p.id, { checkIn: night(monday), checkOut: night(monday + 2) }),
      ),
      BookingDetail,
      201,
    );
    expect(b).toMatchObject({ packageNames: ['4PN'], totalSell: 16_000_000 });
    // Fri → Sun: 4PN is not sold on Saturday, so the edit picks 5PN again.
    const moved = await ok(
      await call(o.headers, 'PATCH', `/lodging/bookings/${b.id}`, {
        version: b.version,
        checkIn: night(friday + 7),
        checkOut: night(friday + 9),
      }),
      BookingDetail,
    );
    expect(moved).toMatchObject({ packageNames: ['5PN'], totalSell: 27_000_000 });
    // 14 guests do not fit 5PN (max 12): 6PN.
    const grown = await ok(
      await call(o.headers, 'PATCH', `/lodging/bookings/${b.id}`, {
        version: moved.version,
        party: { adults: 14, childAges: [] },
      }),
      BookingDetail,
    );
    expect(grown.packageNames).toEqual(['6PN']);
  });

  it('keeps a booking readable when its package is removed (review F6b)', async () => {
    const o = await signup();
    const p = await auraVilla(o.headers);
    const pk5 = packageId(p, '5PN');
    const b = await ok(
      await call(o.headers, 'POST', '/lodging/bookings', stay(p.id)),
      BookingDetail,
      201,
    );
    expect(b.packageIds).toEqual([pk5]);
    const keep = p.packages.filter((pk) => pk.id !== pk5);
    await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${p.id}/rates`, {
        version: p.version,
        surcharges: NO_SURCHARGES,
        packages: keep.map(({ sortOrder: _s, ...pk }) => ({ ...pk, key: pk.id })),
        weekday: p.rates
          .filter((r) => r.kind === 'weekday' && r.packageId !== pk5)
          .map((r) => ({
            unitId: r.unitId,
            weekdays: r.weekdays,
            sell: r.sell,
            cost: r.cost,
            packageKey: r.packageId,
          })),
      }),
      PropertyDto,
    );
    const after = await ok(
      await call(o.headers, 'GET', `/lodging/bookings/${b.id}`),
      BookingDetail,
    );
    expect(after).toMatchObject({ packageIds: [], packageNames: [], totalSell: 27_000_000 });
    expect(await bookingUnitPackages(b.id)).toEqual([{ unitId: p.units[0]?.id, packageId: null }]);
  });

  it('sells each room its full package in a whole rental without whole packages (review F6d)', async () => {
    const o = await signup();
    const hs = await homestay(o.headers);
    const [b1, b2] = hs.units.map((u) => u.id);
    const withMax = await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${hs.id}/units`, {
        version: hs.version,
        units: [
          { id: b1, name: 'B1', capacityAdults: 2 },
          { id: b2, name: 'B2', capacityAdults: 2, maxGuests: 2 },
        ],
      }),
      PropertyDto,
    );
    const all = [1, 2, 3, 4, 5, 6, 7];
    const priced = await ok(
      await call(o.headers, 'PUT', `/lodging/properties/${hs.id}/rates`, {
        version: withMax.version,
        surcharges: NO_SURCHARGES,
        packages: [
          { key: 'big', unitId: b1, name: '2PN', bedrooms: 2, standardAdults: 3, maxGuests: 3 },
          { key: 'small', unitId: b1, name: '1PN', bedrooms: 1, standardAdults: 2, maxGuests: 2 },
        ],
        weekday: [
          { unitId: b1, weekdays: all, sell: 2_000_000, cost: 1, packageKey: 'big' },
          { unitId: b1, weekdays: all, sell: 1_000_000, cost: 1, packageKey: 'small' },
          { unitId: b2, weekdays: all, sell: 1_500_000, cost: 1 },
        ],
      }),
      PropertyDto,
    );
    const big = packageId(priced, '2PN');
    // Two priced targets: no party look, B1 gets its full package; B2 sells none.
    const whole = await ok(
      await call(o.headers, 'POST', '/lodging/bookings', stay(hs.id, { party: { adults: 2 } })),
      BookingDetail,
      201,
    );
    expect(whole).toMatchObject({ packageIds: [big], packageNames: ['2PN'], totalSell: 7_000_000 });
    const rows = await bookingUnitPackages(whole.id);
    expect(Object.fromEntries(rows.map((r) => [r.unitId, r.packageId]))).toEqual({
      [b1 ?? 'b1']: big,
      [b2 ?? 'b2']: null,
    });
    // Maximum = 2PN max 3 + B2 max 2 = 5.
    const quote = (adults: number) =>
      call(o.headers, 'POST', '/lodging/quote', {
        propertyId: hs.id,
        whole: true,
        checkIn: night(friday + 7),
        checkOut: night(friday + 8),
        party: { adults, childAges: [] },
      });
    expect((await ok(await quote(5), QuoteDto)).warnings).not.toContain('over_max');
    expect((await ok(await quote(6), QuoteDto)).warnings).toContain('over_max');
  });
});
