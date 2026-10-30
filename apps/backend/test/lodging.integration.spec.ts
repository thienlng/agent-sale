import { AuthResponse, BootstrapResponse, ProductDto } from '@agent-sales/contracts';
import {
  createDb,
  ensureLoginRoles,
  migrate,
  schema,
  withCredentials,
  withTenant,
  eq,
} from '@agent-sales/db';
import { newId, userId, workspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../src/modules/workspace/api/index.js';

let pg: TestPostgres, app: NestFastifyApplication;
beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  app = (
    await createHttpApp(AppModule, {
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      DATABASE_URL: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
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
  await pg?.stop();
});
type Headers = Record<string, string>;
const call = (
  h: Headers,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  path: string,
  payload?: object,
) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({ method, url: '/api/v1' + path, headers: h, ...(payload ? { payload } : {}) });
let number = 0;
async function owner(industry = 'hotel') {
  const n = ++number;
  const r = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      remoteAddress: `10.77.0.${n}`,
      payload: {
        name: 'Test owner',
        email: `stay-owner-${n}@example.test`,
        password: 'a long synthetic password',
        workspaceName: 'Test lodging business',
        industry,
      },
    });
  expect(r.statusCode).toBe(201);
  const auth = AuthResponse.parse(r.json());
  const bootstrap = BootstrapResponse.parse(
    (await call({ authorization: `Bearer ${auth.accessToken}` }, 'GET', '/bootstrap')).json(),
  );
  return {
    userId: auth.user.id,
    headers: {
      authorization: `Bearer ${auth.accessToken}`,
      'x-workspace-id': bootstrap.memberships[0]?.workspaceId ?? '',
    },
  };
}
const accommodation = {
  rentalType: 'entire_property',
  bedrooms: 1,
  standardAdults: 2,
  standardChildren: 1,
  childAgeBelow: 6,
  maxGuests: null,
  roomLayout: [{ name: 'Room', beds: 'One bed' }],
  amenities: [],
  rateBasis: 'unconfirmed',
  rates: [{ days: [1, 2, 3, 4, 5, 6, 7], amount: 100000 }],
  gallery: [],
};
async function property(h: Headers) {
  const r = await call(h, 'POST', '/products', {
    code: 'PROPERTY',
    name: 'Synthetic whole property',
    accommodation,
    variants: [{ sku: 'PROPERTY-WHOLE', price: 100000 }],
  });
  expect(r.statusCode).toBe(201);
  return ProductDto.parse(r.json());
}
const request = (propertyId: string, checkIn = '2027-01-01', checkOut = '2027-01-03') => ({
  propertyId,
  clientRequestId: newId(),
  dates: { checkIn, checkOut },
  party: { adults: 2, children: 1, childAges: [5] },
  guestName: 'Synthetic guest',
  guestPhone: '0000000000',
  note: '',
});
const confirm = {
  status: 'confirmed',
  version: 1,
  availabilityVerified: true,
  termsAndGuestsVerified: true,
  agreedTotal: 200000,
};

describe('lodging HTTP and PostgreSQL isolation', () => {
  it('validates requests, replays idempotently, keeps price unbound and enforces tenant and capability boundaries', async () => {
    const a = await owner(),
      b = await owner();
    const p = await property(a.headers);
    const body = request(p.id);
    const created = await call(a.headers, 'POST', '/stay-requests', body);
    expect(created.statusCode).toBe(201);
    const row = created.json();
    expect(row.status).toBe('requested');
    expect(row.quote.baseTotal).toBeNull();
    expect(row.quote.internalAvailability).toBe('unverified');
    expect((await call(a.headers, 'POST', '/stay-requests', body)).json().id).toBe(row.id);
    expect(
      (await call(a.headers, 'POST', '/stay-requests', { ...body, guestName: 'Changed guest' }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await call(a.headers, 'POST', '/stay-requests', {
          ...body,
          clientRequestId: newId(),
          dates: { checkIn: '2027-02-30', checkOut: '2027-03-02' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(a.headers, 'PATCH', `/stay-requests/${row.id}/status`, {
          status: 'confirmed',
          version: 1,
        })
      ).statusCode,
    ).toBe(400);
    expect((await call(b.headers, 'GET', `/stay-requests/${row.id}`)).statusCode).toBe(404);
    expect(
      (
        await call(b.headers, 'POST', '/stay-requests/quote', {
          propertyId: p.id,
          dates: body.dates,
          party: body.party,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await call(b.headers, 'POST', '/stay-requests', { ...body, clientRequestId: newId() }))
        .statusCode,
    ).toBe(404);
    const workspaces = app.get<WorkspaceFacade>(WORKSPACE_FACADE);
    await workspaces.joinMember(
      workspaceId(a.headers['x-workspace-id'] ?? ''),
      userId(b.userId),
      'analyst',
      { seatLimit: null, actor: { userId: a.userId, name: 'Test owner' } },
    );
    const analyst = { ...b.headers, 'x-workspace-id': a.headers['x-workspace-id'] ?? '' };
    expect((await call(analyst, 'GET', '/stay-requests')).statusCode).toBe(200);
    expect(
      (await call(analyst, 'POST', '/stay-requests', { ...body, clientRequestId: newId() }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call(analyst, 'PATCH', `/stay-requests/${row.id}/status`, confirm)).statusCode,
    ).toBe(403);
    expect((await call({}, 'GET', '/stay-requests')).statusCode).toBe(401);
  });
  it('serializes simultaneous confirmations, allows adjacency and releases occupancy on cancellation', async () => {
    const a = await owner();
    const p = await property(a.headers);
    const first = (await call(a.headers, 'POST', '/stay-requests', request(p.id))).json();
    const second = (await call(a.headers, 'POST', '/stay-requests', request(p.id))).json();
    const results = await Promise.all(
      [first, second].map((r) =>
        call(a.headers, 'PATCH', `/stay-requests/${r.id}/status`, confirm),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const winner = results.find((r) => r.statusCode === 200)?.json();
    expect(winner).toBeDefined();
    const adjacent = (
      await call(a.headers, 'POST', '/stay-requests', request(p.id, '2027-01-03', '2027-01-04'))
    ).json();
    expect(
      (await call(a.headers, 'PATCH', `/stay-requests/${adjacent.id}/status`, confirm)).statusCode,
    ).toBe(200);
    expect(
      (
        await call(a.headers, 'PATCH', `/stay-requests/${winner.id}/status`, {
          status: 'cancelled',
          version: 2,
        })
      ).statusCode,
    ).toBe(200);
    const loser = winner.id === first.id ? second : first;
    expect(
      (await call(a.headers, 'PATCH', `/stay-requests/${loser.id}/status`, confirm)).statusCode,
    ).toBe(200);
    expect(
      (
        await call(a.headers, 'PATCH', `/stay-requests/${loser.id}/status`, {
          status: 'cancelled',
          version: 1,
        })
      ).statusCode,
    ).toBe(409);
  });
  it('excludes accommodations from retail inventory, variant pickers and direct retail orders', async () => {
    const a = await owner(),
      p = await property(a.headers);
    const w = (
      await call(a.headers, 'POST', '/warehouses', { name: 'Synthetic warehouse' })
    ).json();
    const variant = p.variants[0];
    expect(variant).toBeDefined();
    expect(
      (
        await call(a.headers, 'POST', `/products/${p.id}/stock`, {
          variantId: variant?.id,
          warehouseId: w.id,
          onHand: 10,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await call(a.headers, 'GET', `/product-variants?warehouseId=${w.id}`)).json().data,
    ).toEqual([]);
    const r = await call(a.headers, 'POST', '/orders', {
      source: 'store',
      warehouseId: w.id,
      customer: { name: 'Synthetic guest', phone: '0000000000' },
      recipient: {
        name: 'Synthetic guest',
        phone: '0000000000',
        address: 'Synthetic test location',
      },
      items: [{ variantId: variant?.id, qty: 1 }],
    });
    expect(r.statusCode).toBe(400);
    const retail = await owner('retail');
    expect((await call(retail.headers, 'GET', '/stay-requests')).statusCode).toBe(404);
    expect(
      (
        await call(retail.headers, 'POST', '/products', {
          code: 'BAD',
          name: 'Wrong industry',
          accommodation,
          variants: [{ sku: 'BAD', price: 1 }],
        })
      ).statusCode,
    ).toBe(404);
  });
  it('enforces RLS and the confirmed-overlap constraint independently of HTTP service checks', async () => {
    const a = await owner(),
      b = await owner();
    const p = await property(a.headers);
    const r1 = (await call(a.headers, 'POST', '/stay-requests', request(p.id))).json();
    const r2 = (await call(a.headers, 'POST', '/stay-requests', request(p.id))).json();
    const { db, close } = createDb({
      url: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
      max: 2,
    });
    try {
      expect(
        await withTenant(db, workspaceId(b.headers['x-workspace-id'] ?? ''), (tx) =>
          tx.select().from(schema.stayRequests).where(eq(schema.stayRequests.id, r1.id)),
        ),
      ).toEqual([]);
      await withTenant(db, workspaceId(a.headers['x-workspace-id'] ?? ''), (tx) =>
        tx
          .update(schema.stayRequests)
          .set({ status: 'confirmed', agreedTotal: 200000 })
          .where(eq(schema.stayRequests.id, r1.id)),
      );
      await expect(
        withTenant(db, workspaceId(a.headers['x-workspace-id'] ?? ''), (tx) =>
          tx
            .update(schema.stayRequests)
            .set({ status: 'confirmed', agreedTotal: 200000 })
            .where(eq(schema.stayRequests.id, r2.id)),
        ),
      ).rejects.toMatchObject({ cause: { code: '23P01' } });
      const [sourceRow] = await withTenant(
        db,
        workspaceId(a.headers['x-workspace-id'] ?? ''),
        (tx) => tx.select().from(schema.stayRequests).where(eq(schema.stayRequests.id, r2.id)),
      );
      expect(sourceRow).toBeDefined();
      if (!sourceRow) throw new Error('Expected synthetic stay row');
      await expect(
        withTenant(db, workspaceId(b.headers['x-workspace-id'] ?? ''), (tx) =>
          tx.insert(schema.stayRequests).values({
            ...sourceRow,
            id: newId(),
            clientRequestId: newId(),
            workspaceId: b.headers['x-workspace-id'] ?? '',
          }),
        ),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
    } finally {
      await close();
    }
  });
});
