import {
  AuthResponse,
  BootstrapResponse,
  ContactDto,
  ContactHistoryList,
  ContactListResponse,
  CrmOptionList,
} from '@agent-sales/contracts';
import {
  and,
  type Database,
  eq,
  migrate,
  schema,
  withCredentials,
  withTenant,
} from '@agent-sales/db';
import { ensureLoginRoles } from '@agent-sales/db';
import { workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../../app.module.js';
import { createHttpApp } from '../../../bootstrap.js';
import { DB_TENANT } from '../../../common/db/db.module.js';
import {
  CONTACT_SYNC_FACADE,
  ContactAlreadyLinkedError,
  ContactExternalLinkConflictError,
  type ContactSyncFacade,
  CRM_FACADE,
  type CrmFacade,
  type ExternalContactInput,
} from '../api/index.js';

/** Customer sync with a PMS on a real Postgres: match, link, overwrite, unlink, push claim, RLS. */
let pg: TestPostgres;
let app: NestFastifyApplication;

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  const booted = await createHttpApp(AppModule, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
    DATABASE_SYSTEM_URL: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
  });
  app = booted.app;
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  await pg?.stop();
});

type Headers = Record<string, string>;
type Method = 'GET' | 'POST' | 'PATCH';
const http = () => app.getHttpAdapter().getInstance();
const call = (h: Headers, method: Method, url: string, payload?: object) =>
  http().inject({ method, url: `/api/v1${url}`, headers: h, ...(payload ? { payload } : {}) });
const sync = () => app.get<ContactSyncFacade>(CONTACT_SYNC_FACADE, { strict: false });
const crm = () => app.get<CrmFacade>(CRM_FACADE, { strict: false });
const db = () => app.get<Database>(DB_TENANT, { strict: false });

let signups = 0;
async function shop(email: string): Promise<{ h: Headers; ws: WorkspaceId }> {
  const signup = await http().inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    remoteAddress: `10.5.0.${++signups}`,
    payload: {
      name: 'Chủ shop',
      email,
      password: 'a long enough password',
      workspaceName: 'Shop',
      industry: 'fashion',
    },
  });
  const { accessToken } = AuthResponse.parse(signup.json());
  const authorization = `Bearer ${accessToken}`;
  const boot = BootstrapResponse.parse(
    (
      await http().inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { authorization } })
    ).json(),
  );
  const id = boot.memberships[0]?.workspaceId ?? '';
  return { h: { authorization, 'x-workspace-id': id }, ws: workspaceId(id) };
}

const contact = async (h: Headers, body: object) => {
  const r = await call(h, 'POST', '/contacts', body);
  expect(r.statusCode, r.body).toBe(201);
  return ContactDto.parse(r.json());
};
const get = async (h: Headers, id: string) =>
  ContactDto.parse((await call(h, 'GET', `/contacts/${id}`)).json());
const all = async (h: Headers) =>
  ContactListResponse.parse((await call(h, 'POST', '/contacts/query', { pageSize: 100 })).json());
const history = async (h: Headers, id: string) =>
  ContactHistoryList.parse((await call(h, 'GET', `/contacts/${id}/history`)).json()).data;
const outbox = (ws: WorkspaceId, type: string, contactId: string) =>
  withTenant(db(), ws, (tx) =>
    tx
      .select()
      .from(schema.outboxEvents)
      .where(
        and(eq(schema.outboxEvents.type, type), eq(schema.outboxEvents.aggregateId, contactId)),
      ),
  );

const kv = (over: Partial<ExternalContactInput> = {}): ExternalContactInput => ({
  externalId: '9001',
  name: 'Trần Thị B',
  phone: '0912000001',
  email: null,
  address: '1 Hàng Bài',
  birthday: null,
  gender: 'female',
  ...over,
});

describe('contact sync facade on Postgres', () => {
  it('links an existing customer by phone, then overwrites PMS fields with history and a version bump', async () => {
    const a = await shop('sync-phone@shop.vn');
    const mine = await contact(a.h, {
      name: 'Chị B',
      phone: '+84912000001',
      email: 'b@shop.vn',
      profileNote: 'khách quen',
    });

    const r = await sync().upsertExternalContact(a.ws, 'kiotviet', kv({ email: null }));
    expect(r).toEqual({ contactId: mine.id, created: false, matchedBy: 'phone' });
    const linked = await get(a.h, mine.id);
    // Adopting keeps what KiotViet does not know (email) and Rapiz-only fields.
    expect(linked).toMatchObject({
      name: 'Trần Thị B',
      email: 'b@shop.vn',
      address: '1 Hàng Bài',
      gender: 'female',
      profileNote: 'khách quen',
      external: { source: 'kiotviet', id: '9001' },
      version: mine.version + 1,
    });
    expect(await sync().externalIdOf(a.ws, 'kiotviet', mine.id)).toBe('9001');
    expect(await sync().linkedContactCount(a.ws, 'kiotviet')).toBe(1);
    expect((await all(a.h)).data.find((c) => c.id === mine.id)?.external).toEqual({
      source: 'kiotviet',
      id: '9001',
    });

    // A later KiotViet change matches by the external id and overwrites name and address.
    const again = await sync().upsertExternalContact(
      a.ws,
      'kiotviet',
      kv({ name: 'Trần Thị Bích', address: '2 Tràng Tiền', email: null }),
    );
    expect(again).toEqual({ contactId: mine.id, created: false, matchedBy: 'external' });
    const updated = await get(a.h, mine.id);
    // Linked: KiotViet is the source of truth, so its empty email clears the Rapiz one.
    expect(updated).toMatchObject({
      name: 'Trần Thị Bích',
      address: '2 Tràng Tiền',
      email: null,
      version: linked.version + 1,
    });
    const entries = await history(a.h, mine.id);
    const last = entries[0];
    expect(last).toMatchObject({ type: 'contact.updated', actorName: null });
    expect(last?.changes).toMatchObject({
      name: { from: 'Trần Thị B', to: 'Trần Thị Bích' },
      address: { from: '1 Hàng Bài', to: '2 Tràng Tiền' },
      email: { from: 'b@shop.vn', to: null },
    });
    expect(
      entries.some((e) => (e.changes['external'] as { to?: unknown })?.to === 'kiotviet'),
    ).toBe(true);
    expect((await outbox(a.ws, 'crm.contact.updated.v1', mine.id)).length).toBeGreaterThanOrEqual(
      2,
    );

    // The same record again changes nothing.
    await sync().upsertExternalContact(
      a.ws,
      'kiotviet',
      kv({ name: 'Trần Thị Bích', address: '2 Tràng Tiền', email: null }),
    );
    expect((await get(a.h, mine.id)).version).toBe(updated.version);

    // A staff edit made on the old version answers 409; one on the new version works.
    const stale = await call(a.h, 'PATCH', `/contacts/${mine.id}`, {
      profileNote: 'x',
      expectedVersion: linked.version,
    });
    expect(stale.statusCode).toBe(409);
    const ok = await call(a.h, 'PATCH', `/contacts/${mine.id}`, {
      profileNote: 'vẫn sửa được',
      expectedVersion: updated.version,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ContactDto.parse(ok.json()).external).toEqual({ source: 'kiotviet', id: '9001' });
  });

  it('creates a customer with the KiotViet source and skips a record without identity', async () => {
    const a = await shop('sync-create@shop.vn');
    const r = await sync().upsertExternalContact(
      a.ws,
      'kiotviet',
      kv({ externalId: '7', phone: '0912000002', birthday: '1991-02-03T00:00:00' }),
    );
    expect(r).toMatchObject({ created: true, matchedBy: 'new' });
    const id = 'contactId' in r ? r.contactId : '';
    const sources = CrmOptionList.parse((await call(a.h, 'GET', '/crm/sources')).json()).data;
    const kiot = sources.find((s) => s.key === 'kiotviet');
    expect(kiot?.name).toBe('KiotViet');
    expect(await get(a.h, id)).toMatchObject({
      sourceId: kiot?.id,
      firstSourceId: kiot?.id,
      phoneNormalized: '+84912000002',
      birthday: '1991-02-03',
      external: { source: 'kiotviet', id: '7' },
    });
    expect((await history(a.h, id))[0]).toMatchObject({ type: 'contact.created', actorName: null });
    const [created] = await outbox(a.ws, 'crm.contact.created.v1', id);
    expect(created?.payload).toMatchObject({ origin: 'import', phoneCaptured: true });

    expect(
      await sync().upsertExternalContact(
        a.ws,
        'kiotviet',
        kv({ externalId: '8', name: ' ', phone: '12', email: 'bad' }),
      ),
    ).toEqual({ skipped: 'no_identity' });
  });

  it('unlinks on a PMS delete and on disconnect, keeping the customer', async () => {
    const a = await shop('sync-unlink@shop.vn');
    const one = await sync().upsertExternalContact(a.ws, 'kiotviet', kv({ externalId: '1' }));
    const two = await sync().upsertExternalContact(
      a.ws,
      'kiotviet',
      kv({ externalId: '2', phone: '0912000003' }),
    );
    const oneId = 'contactId' in one ? one.contactId : '';
    const twoId = 'contactId' in two ? two.contactId : '';

    expect(await sync().unlinkExternalContacts(a.ws, 'kiotviet', ['1', 'unknown'])).toBe(1);
    const kept = await get(a.h, oneId);
    expect(kept).toMatchObject({ name: 'Trần Thị B', external: null });
    expect((await history(a.h, oneId))[0]?.changes).toMatchObject({
      external: { from: 'kiotviet', to: null },
    });
    expect(await sync().externalIdOf(a.ws, 'kiotviet', oneId)).toBeNull();

    expect(await sync().releaseExternalSource(a.ws, 'kiotviet')).toBe(1);
    expect(await get(a.h, twoId)).toMatchObject({ external: null });
    expect(await sync().linkedContactCount(a.ws, 'kiotviet')).toBe(0);
    expect((await all(a.h)).total).toBe(2);
  });

  it('ends with one customer when imports and a lead capture of one phone race', async () => {
    const a = await shop('sync-race@shop.vn');
    const results = await Promise.all([
      ...Array.from({ length: 5 }, () =>
        sync().upsertExternalContact(a.ws, 'kiotviet', kv({ externalId: '55' })),
      ),
      crm().upsertLeadByPhone(a.ws, {
        phoneE164: '+84912000001',
        sourceKey: 'website',
        displayName: 'Khách web',
        firstUrl: null,
      }),
    ]);
    const ids = new Set(results.map((r) => ('contactId' in r ? r.contactId : null)));
    expect(ids.size).toBe(1);
    const list = await all(a.h);
    expect(list.total).toBe(1);
    expect(list.data[0]?.external).toEqual({ source: 'kiotviet', id: '55' });
  });

  it('claims customers to push once, then links, fails, sweeps and releases them', async () => {
    const a = await shop('sync-push@shop.vn');
    const since = new Date(Date.now() - 60_000);
    const p1 = await contact(a.h, { name: 'Khách 1', phone: '0912000011' });
    const p2 = await contact(a.h, { phone: '0912000012', address: '5 Phố Huế' });
    await contact(a.h, { name: 'Không số' });
    await sync().upsertExternalContact(
      a.ws,
      'kiotviet',
      kv({ externalId: '99', phone: '0912000013' }),
    );

    const [x, y] = await Promise.all([
      sync().claimContactsForPush(a.ws, 'kiotviet', since, 10),
      sync().claimContactsForPush(a.ws, 'kiotviet', since, 10),
    ]);
    const claimed = [...x, ...y];
    expect(claimed.map((c) => c.id).sort()).toEqual([p1.id, p2.id].sort());
    expect(claimed.find((c) => c.id === p2.id)).toEqual({
      id: p2.id,
      name: '0912000012',
      phoneE164: '+84912000012',
      email: null,
      address: '5 Phố Huế',
    });
    expect(await sync().claimContactsForPush(a.ws, 'kiotviet', since, 10)).toEqual([]);
    // Created before the connection: never claimed.
    expect(
      await sync().claimContactsForPush(a.ws, 'kiotviet', new Date(Date.now() + 1000), 10),
    ).toEqual([]);

    // Stale sweep: claims older than `olderThan`.
    const later = new Date(Date.now() + 1000);
    expect((await sync().staleContactPushes(a.ws, 'kiotviet', since, later, 10)).sort()).toEqual(
      [p1.id, p2.id].sort(),
    );
    expect(await sync().staleContactPushes(a.ws, 'kiotviet', since, since, 10)).toEqual([]);

    await sync().markContactPushed(a.ws, p1.id, 'kiotviet', '501');
    await sync().markContactPushed(a.ws, p1.id, 'kiotviet', '501');
    await expect(sync().markContactPushed(a.ws, p1.id, 'kiotviet', '502')).rejects.toBeInstanceOf(
      ContactAlreadyLinkedError,
    );
    await expect(sync().markContactPushed(a.ws, p2.id, 'kiotviet', '501')).rejects.toBeInstanceOf(
      ContactExternalLinkConflictError,
    );
    expect((await get(a.h, p1.id)).external).toEqual({ source: 'kiotviet', id: '501' });

    await sync().markContactPushFailed(a.ws, p2.id, 'pms.customer.rejected');
    expect(await sync().staleContactPushes(a.ws, 'kiotviet', since, later, 10)).toEqual([]);
    expect(await sync().claimContactsForPush(a.ws, 'kiotviet', since, 10)).toEqual([]);

    const p3 = await contact(a.h, { name: 'Khách 3', phone: '0912000014' });
    expect(
      (await sync().claimContactsForPush(a.ws, 'kiotviet', since, 10)).map((c) => c.id),
    ).toEqual([p3.id]);
    expect(await sync().releasePendingContactPushes(a.ws, 'kiotviet', since)).toBe(0);
    expect(await sync().releasePendingContactPushes(a.ws, 'kiotviet')).toBe(1);
    expect(
      (await sync().claimContactsForPush(a.ws, 'kiotviet', since, 10)).map((c) => c.id),
    ).toEqual([p3.id]);
  });

  it('keeps every business to its own customers (RLS)', async () => {
    const a = await shop('sync-rls-a@shop.vn');
    const b = await shop('sync-rls-b@shop.vn');
    const r = await sync().upsertExternalContact(a.ws, 'kiotviet', kv({ externalId: '3' }));
    const id = 'contactId' in r ? r.contactId : '';

    expect(await sync().externalIdOf(b.ws, 'kiotviet', id)).toBeNull();
    expect(await sync().linkedContactCount(b.ws, 'kiotviet')).toBe(0);
    expect(await sync().unlinkExternalContacts(b.ws, 'kiotviet', ['3'])).toBe(0);
    // The same KiotViet id and phone in another business is another customer.
    const other = await sync().upsertExternalContact(b.ws, 'kiotviet', kv({ externalId: '3' }));
    expect(other).toMatchObject({ created: true, matchedBy: 'new' });
    expect(await sync().claimContactsForPush(b.ws, 'kiotviet', new Date(0), 10)).toEqual([]);
    await expect(sync().markContactPushed(b.ws, id, 'kiotviet', '4')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await sync().externalIdOf(a.ws, 'kiotviet', id)).toBe('3');
  });
});
