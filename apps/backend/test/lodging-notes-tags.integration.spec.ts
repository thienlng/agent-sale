import {
  AuthResponse,
  BookingDetail,
  BookingList,
  BootstrapResponse,
  CalendarDto,
  NightNoteResult,
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
import { newId, workspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import { addNights, localToday } from '../src/modules/lodging/domain/nights.js';
import { signUpVerified } from './support/signup.js';

/** Calendar polish (T-160): night notes, the property's internal note and booking tags over HTTP. */
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
      email: `lodging-notes-${n}@example.test`,
      password: 'a long synthetic password',
      workspaceName: 'Test lodging business',
      industry,
    },
    { remoteAddress: `10.87.0.${n}` },
  );
  expect(r.statusCode).toBe(201);
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

async function villa(h: Headers, code = 'A17', internalNote = ''): Promise<PropertyDto> {
  const p = await ok(
    await call(h, 'POST', '/lodging/properties', {
      code,
      name: 'SKY VILLA ' + code,
      sellMode: 'whole',
      standardAdults: 20,
      standardChildren: 4,
      ...(internalNote ? { internalNote } : {}),
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
        { name: 'P1', capacityAdults: 2 },
        { name: 'P2', capacityAdults: 2 },
      ],
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

const putNote = (h: Headers, propertyId: string, body: object) =>
  call(h, 'PUT', `/lodging/properties/${propertyId}/notes`, body);

async function calendar(h: Headers, from: number, to: number): Promise<CalendarDto> {
  return ok(
    await call(h, 'GET', `/lodging/calendar?from=${night(from)}&to=${night(to)}`),
    CalendarDto,
  );
}

describe('lodging night notes', () => {
  it('upserts a property note and a room note per night, shows them on the calendar, deletes on empty text', async () => {
    const o = await signup();
    const p = await homestay(o.headers);
    const room = p.units[0]?.id ?? '';

    const first = await ok(
      await putNote(o.headers, p.id, { unitId: null, night: night(3), text: 'Sửa điện chiều' }),
      NightNoteResult,
    );
    expect(first.note).toMatchObject({ unitId: null, night: night(3), text: 'Sửa điện chiều' });
    const again = await ok(
      await putNote(o.headers, p.id, { unitId: null, night: night(3), text: '  Sửa nước  ' }),
      NightNoteResult,
    );
    // Same (property, whole, night): the same row is updated, not a second one.
    expect(again.note).toMatchObject({ id: first.note?.id, text: 'Sửa nước' });
    await ok(
      await putNote(o.headers, p.id, { unitId: room, night: night(3), text: 'Khách quen P1' }),
      NightNoteResult,
    );

    const cal = await calendar(o.headers, 1, 6);
    const notes = cal.properties.find((x) => x.id === p.id)?.notes ?? [];
    expect(notes).toHaveLength(2);
    expect(notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ unitId: null, night: night(3), text: 'Sửa nước' }),
        expect.objectContaining({ unitId: room, night: night(3), text: 'Khách quen P1' }),
      ]),
    );
    // Outside the window: not returned.
    expect((await calendar(o.headers, 4, 6)).properties[0]?.notes).toEqual([]);

    const deleted = await ok(
      await putNote(o.headers, p.id, { unitId: null, night: night(3), text: '   ' }),
      NightNoteResult,
    );
    expect(deleted.note).toBeNull();
    const after = (await calendar(o.headers, 1, 6)).properties[0]?.notes ?? [];
    expect(after.map((n) => n.unitId)).toEqual([room]);
    // Deleting a note that does not exist is fine too.
    expect(
      (await putNote(o.headers, p.id, { unitId: null, night: night(9), text: '' })).statusCode,
    ).toBe(200);
  });

  it('validates the text length, the room and the property', async () => {
    const o = await signup();
    const p = await villa(o.headers);
    const long = await putNote(o.headers, p.id, {
      unitId: null,
      night: night(1),
      text: 'x'.repeat(301),
    });
    expect(long.statusCode).toBe(400);
    // A whole property's notes target the property itself, never its internal unit.
    const wholeUnit = await putNote(o.headers, p.id, {
      unitId: p.units[0]?.id,
      night: night(1),
      text: 'x',
    });
    expect(wholeUnit.statusCode, wholeUnit.body).toBe(400);
    const other = await homestay(o.headers, 'HS9');
    const foreignRoom = await putNote(o.headers, p.id, {
      unitId: other.units[0]?.id,
      night: night(1),
      text: 'x',
    });
    expect(foreignRoom.statusCode).toBe(400);
    expect(
      (await putNote(o.headers, newId(), { unitId: null, night: night(1), text: 'x' })).statusCode,
    ).toBe(404);
  });

  it('needs orders.manage to write; analysts read notes on the calendar', async () => {
    const o = await signup();
    const p = await villa(o.headers);
    await ok(
      await putNote(o.headers, p.id, { unitId: null, night: night(2), text: 'Ghi chú' }),
      NightNoteResult,
    );
    const analyst = await member(o.ws, 'analyst');
    expect(
      (await putNote(analyst, p.id, { unitId: null, night: night(2), text: 'Khác' })).statusCode,
    ).toBe(403);
    const cal = await calendar(analyst, 1, 4);
    expect(cal.properties[0]?.notes.map((n) => n.text)).toEqual(['Ghi chú']);
  });

  it('keeps notes inside their workspace (HTTP 404 and forced RLS)', async () => {
    const a = await signup();
    const b = await signup();
    const p = await villa(a.headers);
    await ok(
      await putNote(a.headers, p.id, { unitId: null, night: night(2), text: 'Bí mật' }),
      NightNoteResult,
    );
    expect(
      (await putNote(b.headers, p.id, { unitId: null, night: night(2), text: 'x' })).statusCode,
    ).toBe(404);
    const rows = await withTenant(tenant.db, workspaceId(b.ws), (tx) =>
      tx
        .select()
        .from(schema.lodgingNightNotes)
        .where(eq(schema.lodgingNightNotes.propertyId, p.id)),
    );
    expect(rows).toEqual([]);
    const own = await withTenant(tenant.db, workspaceId(a.ws), (tx) =>
      tx
        .select()
        .from(schema.lodgingNightNotes)
        .where(eq(schema.lodgingNightNotes.propertyId, p.id)),
    );
    expect(own.map((r) => r.text)).toEqual(['Bí mật']);
    await expect(
      withTenant(tenant.db, workspaceId(b.ws), (tx) =>
        tx.insert(schema.lodgingNightNotes).values({
          id: newId(),
          workspaceId: a.ws,
          propertyId: p.id,
          unitId: null,
          night: night(5),
          text: 'x',
        }),
      ),
    ).rejects.toBeDefined();
  });
});

describe('lodging property internal note', () => {
  it('is saved on create and patch, returned to staff and shown on the calendar', async () => {
    const o = await signup();
    const p = await villa(o.headers, 'A17', 'Chủ nhà khó tính');
    expect(p.internalNote).toBe('Chủ nhà khó tính');
    const patched = await ok(
      await call(o.headers, 'PATCH', `/lodging/properties/${p.id}`, {
        version: p.version,
        patch: { internalNote: 'Gọi chủ trước 21h' },
      }),
      PropertyDto,
    );
    expect(patched.internalNote).toBe('Gọi chủ trước 21h');
    const cal = await calendar(o.headers, 1, 3);
    expect(cal.properties[0]?.internalNote).toBe('Gọi chủ trước 21h');
    const tooLong = await call(o.headers, 'PATCH', `/lodging/properties/${p.id}`, {
      version: patched.version,
      patch: { internalNote: 'x'.repeat(2001) },
    });
    expect(tooLong.statusCode).toBe(400);
  });
});

describe('lodging booking tags', () => {
  it('saves trimmed, de-duplicated tags on create and edit and shows them on the calendar', async () => {
    const o = await signup();
    const p = await villa(o.headers);
    const b = await ok(
      await call(
        o.headers,
        'POST',
        '/lodging/bookings',
        stay(p.id, 2, 4, { tags: [' Đã cọc ', 'Khách quen', 'Đã cọc'] }),
      ),
      BookingDetail,
      201,
    );
    expect(b.tags).toEqual(['Đã cọc', 'Khách quen']);
    const seg = (await calendar(o.headers, 1, 5)).properties[0]?.rows[0]?.segments[0];
    expect(seg).toMatchObject({
      bookingId: b.id,
      tags: ['Đã cọc', 'Khách quen'],
      guestPhone: '0900000000',
      party: { adults: 2, childAges: [] },
      totalSell: 18_000_000,
      note: '',
    });

    const edited = await ok(
      await call(o.headers, 'PATCH', `/lodging/bookings/${b.id}`, {
        version: b.version,
        tags: ['Cần xe đón'],
      }),
      BookingDetail,
    );
    expect(edited.tags).toEqual(['Cần xe đón']);
    // A tag edit is a label: it never re-prices the stay.
    expect(edited.totalSell).toBe(b.totalSell);

    const tooMany = await call(o.headers, 'PATCH', `/lodging/bookings/${b.id}`, {
      version: edited.version,
      tags: Array.from({ length: 9 }, (_, i) => `t${i}`),
    });
    expect(tooMany.statusCode).toBe(400);
    const tooLong = await call(o.headers, 'PATCH', `/lodging/bookings/${b.id}`, {
      version: edited.version,
      tags: ['x'.repeat(31)],
    });
    expect(tooLong.statusCode).toBe(400);
  });

  it('a checked-in stay can still change its tags', async () => {
    const o = await signup();
    const p = await villa(o.headers);
    const b = await ok(
      await call(o.headers, 'POST', '/lodging/bookings', stay(p.id, 0, 2, { status: 'confirmed' })),
      BookingDetail,
      201,
    );
    const inHouse = await ok(
      await call(o.headers, 'POST', `/lodging/bookings/${b.id}/status`, {
        version: b.version,
        action: 'check_in',
      }),
      BookingDetail,
    );
    const tagged = await ok(
      await call(o.headers, 'PATCH', `/lodging/bookings/${b.id}`, {
        version: inHouse.version,
        tags: ['Có trẻ nhỏ'],
      }),
      BookingDetail,
    );
    expect(tagged.tags).toEqual(['Có trẻ nhỏ']);
  });

  it('filters the booking list by tag', async () => {
    const o = await signup();
    const p = await villa(o.headers);
    const tagged = await ok(
      await call(
        o.headers,
        'POST',
        '/lodging/bookings',
        stay(p.id, 2, 3, { tags: ['Đoàn công ty'] }),
      ),
      BookingDetail,
      201,
    );
    await ok(
      await call(
        o.headers,
        'POST',
        '/lodging/bookings',
        stay(p.id, 4, 5, { tags: ['Khách quen'] }),
      ),
      BookingDetail,
      201,
    );
    await ok(
      await call(o.headers, 'POST', '/lodging/bookings', stay(p.id, 6, 7)),
      BookingDetail,
      201,
    );
    const list = await ok(
      await call(
        o.headers,
        'GET',
        `/lodging/bookings?view=all&tag=${encodeURIComponent('Đoàn công ty')}`,
      ),
      BookingList,
    );
    expect(list.data.map((x) => x.id)).toEqual([tagged.id]);
    const all = await ok(await call(o.headers, 'GET', '/lodging/bookings?view=all'), BookingList);
    expect(all.data).toHaveLength(3);
  });
});
