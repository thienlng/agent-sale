import {
  AuthResponse,
  BootstrapResponse,
  ContactDto,
  ContactHistoryList,
  ContactListResponse,
} from '@agent-sales/contracts';
import { ensureLoginRoles, migrate, withCredentials } from '@agent-sales/db';
import { workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../../app.module.js';
import { createHttpApp } from '../../../bootstrap.js';
import { CRM_FACADE, type CrmFacade } from '../api/index.js';
import { signUpVerified } from '../../../../test/support/signup.js';

/** Website lead capture by phone and by email on a real Postgres: one visitor, one customer. */
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
const http = () => app.getHttpAdapter().getInstance();
const crm = () => app.get<CrmFacade>(CRM_FACADE, { strict: false });

let signups = 0;
async function shop(email: string): Promise<{ h: Headers; ws: WorkspaceId }> {
  const signup = await signUpVerified(
    app,
    {
      name: 'Chủ shop',
      email,
      password: 'a long enough password',
      workspaceName: 'Shop',
      industry: 'saas',
    },
    { remoteAddress: `10.6.0.${++signups}` },
  );
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

const get = async (h: Headers, id: string) =>
  ContactDto.parse(
    (await http().inject({ method: 'GET', url: `/api/v1/contacts/${id}`, headers: h })).json(),
  );
const total = async (h: Headers) =>
  ContactListResponse.parse(
    (
      await http().inject({
        method: 'POST',
        url: '/api/v1/contacts/query',
        headers: h,
        payload: { pageSize: 100 },
      })
    ).json(),
  ).total;
const history = async (h: Headers, id: string) =>
  ContactHistoryList.parse(
    (
      await http().inject({ method: 'GET', url: `/api/v1/contacts/${id}/history`, headers: h })
    ).json(),
  ).data;

const byEmail = (email: string, contactId?: string) => ({
  email,
  sourceKey: 'website' as const,
  displayName: 'Khách website lan',
  firstUrl: 'https://rapiz.io/bang-gia/',
  ...(contactId ? { contactId } : {}),
});
const byPhone = (phoneE164: string, contactId?: string) => ({
  phoneE164,
  sourceKey: 'website' as const,
  displayName: 'Khách website 0001',
  firstUrl: 'https://rapiz.io/bang-gia/',
  ...(contactId ? { contactId } : {}),
});

describe('website lead capture by email', () => {
  it('creates one customer per email, also under concurrent captures', async () => {
    const a = await shop('lead-email@shop.vn');
    const results = await Promise.all(
      Array.from({ length: 4 }, () => crm().upsertLeadByEmail(a.ws, byEmail('Lan@Shop.vn'))),
    );
    expect(new Set(results.map((r) => r.contactId)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const c = await get(a.h, results[0]?.contactId ?? '');
    expect(c).toMatchObject({ name: 'Khách website lan', email: 'lan@shop.vn', phone: null });
    // A saas business's new lead starts at the pipeline's first status.
    expect(c.statusId).not.toBeNull();
    expect(await total(a.h)).toBe(1);
  });

  it('adds the email to the customer the visitor became by phone', async () => {
    const a = await shop('lead-phone-email@shop.vn');
    const phone = await crm().upsertLeadByPhone(a.ws, byPhone('+84912000001'));
    const mail = await crm().upsertLeadByEmail(a.ws, byEmail('lan@shop.vn', phone.contactId));
    expect(mail).toEqual({ contactId: phone.contactId, created: false });
    expect(await get(a.h, phone.contactId)).toMatchObject({
      phone: '+84912000001',
      email: 'lan@shop.vn',
    });
    const updated = (await history(a.h, phone.contactId)).filter(
      (h) => h.type === 'contact.updated',
    );
    expect(updated).toHaveLength(1);
    expect(updated[0]?.changes).toMatchObject({ email: { from: null, to: 'lan@shop.vn' } });
    expect(await total(a.h)).toBe(1);
  });

  it('adds the phone to the customer the visitor became by email', async () => {
    const a = await shop('lead-email-phone@shop.vn');
    const mail = await crm().upsertLeadByEmail(a.ws, byEmail('lan@shop.vn'));
    const phone = await crm().upsertLeadByPhone(a.ws, byPhone('+84912000002', mail.contactId));
    expect(phone).toEqual({ contactId: mail.contactId, created: false });
    const c = await get(a.h, mail.contactId);
    expect(c).toMatchObject({ phone: '+84912000002', email: 'lan@shop.vn' });
    expect(await total(a.h)).toBe(1);
  });

  it('keeps an existing customer of the phone instead of merging into the visitor', async () => {
    const a = await shop('lead-existing-phone@shop.vn');
    const known = await crm().upsertLeadByPhone(a.ws, byPhone('+84912000003'));
    const mail = await crm().upsertLeadByEmail(a.ws, byEmail('khac@shop.vn'));
    const phone = await crm().upsertLeadByPhone(a.ws, byPhone('+84912000003', mail.contactId));
    expect(phone).toEqual({ contactId: known.contactId, created: false });
    expect((await get(a.h, mail.contactId)).phone).toBeNull();
  });

  it('finds the customer by email without a visitor link and never overwrites an email', async () => {
    const a = await shop('lead-email-found@shop.vn');
    const first = await crm().upsertLeadByEmail(a.ws, byEmail('lan@shop.vn'));
    expect(await crm().upsertLeadByEmail(a.ws, byEmail('LAN@shop.vn'))).toEqual({
      contactId: first.contactId,
      created: false,
    });
    await crm().upsertLeadByEmail(a.ws, byEmail('moi@shop.vn', first.contactId));
    expect((await get(a.h, first.contactId)).email).toBe('lan@shop.vn');
  });
});
