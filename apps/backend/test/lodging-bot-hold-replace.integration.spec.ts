import {
  AuthResponse,
  BookingDetail,
  BookingList,
  BootstrapResponse,
  BotDto,
  PropertyDto,
} from '@agent-sales/contracts';
import {
  createDb,
  ensureLoginRoles,
  migrate,
  withCredentials,
  type Database,
} from '@agent-sales/db';
import { newId, workspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import { LODGING_BOT_FACADE, type LodgingBotFacade } from '../src/modules/lodging/api/index.js';
import { addNights, localToday } from '../src/modules/lodging/domain/nights.js';
import { signUpVerified } from './support/signup.js';

/** A bot hold that replaces an earlier one of the conversation (VL2-4, VL2-5) on a real Postgres. */
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
      email: `lodging-bot-hold-replace-${n}@example.test`,
      password: 'a long synthetic password',
      workspaceName: 'Test lodging business',
      industry: 'hotel',
    },
    { remoteAddress: `10.89.0.${n}` },
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
  expect(text).not.toMatch(/cost/i);
};

describe('replacing an earlier bot hold of the conversation (VL2-4)', () => {
  it('replaces the hold of the same property and guest, keeps another property, lists both', async () => {
    const o = await hotel();
    const a = await villa(o.headers, 'A17', 9_000_000);
    const b = await villa(o.headers, 'B05', 7_000_000);
    const conversationId = newId();
    const place = async (propertyId: string, over: Record<string, unknown>, earlier: string[]) => {
      const prepared = await facade().prepareBotHold(
        o.ws,
        holdInput(o.botId, propertyId, conversationId, { ...over, earlierHolds: earlier }),
      );
      expect(prepared.status, JSON.stringify(prepared)).toBe('ready');
      const held = await facade().confirmBotHold(o.ws, { conversationId, earlierHolds: earlier });
      if (held.status !== 'held') throw new Error(JSON.stringify(held));
      return { prepared, held };
    };
    const first = await place(a.id, {}, []);
    // Overlapping new dates of the same villa: its own nights do not block the replacement.
    const second = await place(a.id, { checkIn: night(4), checkOut: night(6) }, [first.held.code]);
    expect(second.prepared).toMatchObject({ replaces: first.held.code });
    if (second.prepared.status === 'ready')
      expect(second.prepared.summary).toContain(`Thay cho giữ chỗ ${first.held.code}`);
    expect(second.held.replaced).toBe(first.held.code);
    // Another villa for the same group is a second hold, not a replacement (VL2-5).
    const third = await place(b.id, {}, [first.held.code, second.held.code]);
    expect(third.held.replaced).toBeUndefined();

    const list = await ok(await call(o.headers, 'GET', '/lodging/bookings?view=all'), BookingList);
    const byCode = new Map(list.data.map((x) => [x.code, x]));
    expect(byCode.get(first.held.code)?.status).toBe('cancelled');
    expect(byCode.get(second.held.code)?.status).toBe('hold');
    expect(byCode.get(third.held.code)?.status).toBe('hold');
    const detail = await ok(
      await call(o.headers, 'GET', `/lodging/bookings/${byCode.get(second.held.code)?.id}`),
      BookingDetail,
    );
    expect(detail.note).toContain(`Thay cho ${first.held.code}`);

    const holds = await facade().botConversationHolds(o.ws, {
      conversationId,
      channel: 'facebook',
      codes: [first.held.code, second.held.code, third.held.code, 'BK-9999'],
    });
    expect(holds.map((h) => [h.code, h.propertyCode, h.status])).toEqual([
      [first.held.code, 'A17', 'cancelled'],
      [second.held.code, 'A17', 'hold'],
      [third.held.code, 'B05', 'hold'],
    ]);
    noSecrets(holds);
    // Another conversation cannot see or replace these holds.
    expect(
      await facade().botConversationHolds(o.ws, {
        conversationId: newId(),
        channel: 'facebook',
        codes: [second.held.code],
      }),
    ).toEqual([]);
  });
});
