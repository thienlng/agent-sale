import {
  AcceptedInvitation,
  AssignmentPolicyDto,
  AuthResponse,
  BootstrapResponse,
  ContactDto,
  ContactListResponse,
  CreatedInvitation,
  CrmOptionList,
  InvitationPreview,
  MemberList,
} from '@agent-sales/contracts';
import { createDb, ensureLoginRoles, eq, migrate, schema, withCredentials } from '@agent-sales/db';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';

/** Members, invitation links, role capabilities, customer scope and auto-assignment on Postgres. */
let pg: TestPostgres;
let app: NestFastifyApplication;
let owner: ReturnType<typeof createDb>;

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  owner = createDb({ url: pg.ownerUrl, max: 2 });
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
  await owner?.close();
  await pg?.stop();
});

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type Headers = Record<string, string>;
const call = (h: Headers, method: Method, url: string, payload?: object) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({ method, url: `/api/v1${url}`, headers: h, ...(payload ? { payload } : {}) });

let signups = 0;
/** A new user (with their own shop, as every signup creates one). */
async function user(email: string, name: string) {
  const signup = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      remoteAddress: `10.2.0.${++signups}`,
      payload: {
        name,
        email,
        password: 'a long enough password',
        workspaceName: `Shop ${name}`,
        industry: 'fashion',
      },
    });
  const { accessToken } = AuthResponse.parse(signup.json());
  const authorization = `Bearer ${accessToken}`;
  const boot = BootstrapResponse.parse((await call({ authorization }, 'GET', '/bootstrap')).json());
  const own = boot.memberships[0]?.workspaceId ?? '';
  return {
    userId: boot.user.id,
    ownWorkspace: own,
    auth: { authorization } as Headers,
    h: { authorization, 'x-workspace-id': own } as Headers,
    in: (ws: string): Headers => ({ authorization, 'x-workspace-id': ws }),
  };
}

/** Owner invites `email` as `role`; the invitee accepts with their own session. */
async function join(
  o: Awaited<ReturnType<typeof user>>,
  invitee: Awaited<ReturnType<typeof user>>,
  email: string,
  role: string,
) {
  const inv = await call(o.h, 'POST', '/invitations', { email, role });
  expect(inv.statusCode, inv.body).toBe(201);
  const { token } = CreatedInvitation.parse(inv.json());
  const accepted = await call(invitee.auth, 'POST', '/invitation-links/accept', { token });
  expect(accepted.statusCode, accepted.body).toBe(200);
  return token;
}

describe('team and access on Postgres', () => {
  it('invites by link, accepts only with the invited email, manages roles (SET-01)', async () => {
    const lan = await user('lan@team.vn', 'Chủ shop Lan');
    const binh = await user('binh@team.vn', 'Sales Bình');
    const mallory = await user('mallory@team.vn', 'Người lạ');

    const inv = await call(lan.h, 'POST', '/invitations', { email: 'BINH@team.vn', role: 'sales' });
    expect(inv.statusCode).toBe(201);
    const created = CreatedInvitation.parse(inv.json());
    expect(created.invitation).toMatchObject({
      email: 'binh@team.vn',
      role: 'sales',
      status: 'pending',
    });
    // Only the hash is stored.
    const [row] = await owner.db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, created.invitation.id));
    expect(row?.tokenHash).not.toContain(created.token);

    // Someone else holding the link can see it is not for them and cannot use it.
    const preview = InvitationPreview.parse(
      (await call(mallory.auth, 'GET', `/invitation-links/${created.token}`)).json(),
    );
    expect(preview).toMatchObject({
      workspaceName: 'Shop Chủ shop Lan',
      role: 'sales',
      emailMatches: false,
      // Only a hint of the invited address.
      email: 'b***@team.vn',
    });
    expect(
      (await call(mallory.auth, 'POST', '/invitation-links/accept', { token: created.token }))
        .statusCode,
    ).toBe(403);

    const accepted = await call(binh.auth, 'POST', '/invitation-links/accept', {
      token: created.token,
    });
    expect(AcceptedInvitation.parse(accepted.json())).toMatchObject({
      workspaceId: lan.ownWorkspace,
      role: 'sales',
    });
    // Accepting again answers the same; the link is used up for anyone else.
    expect(
      (await call(binh.auth, 'POST', '/invitation-links/accept', { token: created.token }))
        .statusCode,
    ).toBe(200);
    expect((await call(binh.auth, 'GET', '/bootstrap')).json()).toMatchObject({
      memberships: expect.arrayContaining([
        expect.objectContaining({ workspaceId: lan.ownWorkspace, role: 'sales' }),
      ]),
    });

    const members = MemberList.parse((await call(lan.h, 'GET', '/members')).json()).data;
    expect(members.map((m) => [m.name, m.role, m.isYou])).toEqual([
      ['Chủ shop Lan', 'owner', true],
      ['Sales Bình', 'sales', false],
    ]);
    // Re-inviting an active member is refused; an unknown link is 404.
    expect(
      (await call(lan.h, 'POST', '/invitations', { email: 'binh@team.vn', role: 'care' }))
        .statusCode,
    ).toBe(409);
    expect((await call(binh.auth, 'GET', `/invitation-links/${'x'.repeat(43)}`)).statusCode).toBe(
      404,
    );

    // Sales cannot manage members; the owner cannot be removed or demoted.
    const asBinh = binh.in(lan.ownWorkspace);
    const seen = MemberList.parse((await call(asBinh, 'GET', '/members')).json()).data;
    expect(seen.find((m) => m.role === 'owner')?.email).toBe('');
    expect(seen.find((m) => m.isYou)?.email).toBe('binh@team.vn');
    expect(
      (await call(asBinh, 'POST', '/invitations', { email: 'x@team.vn', role: 'sales' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call(asBinh, 'PATCH', `/members/${lan.userId}`, { role: 'sales' })).statusCode,
    ).toBe(403);
    expect((await call(lan.h, 'POST', `/members/${lan.userId}/remove`)).statusCode).toBe(409);
    expect(
      (await call(lan.h, 'PATCH', `/members/${lan.userId}`, { role: 'admin' })).statusCode,
    ).toBe(409);

    // Revoked and expired links cannot be used.
    const revokedInv = CreatedInvitation.parse(
      (
        await call(lan.h, 'POST', '/invitations', { email: 'mallory@team.vn', role: 'care' })
      ).json(),
    );
    await call(lan.h, 'POST', `/invitations/${revokedInv.invitation.id}/revoke`);
    expect(
      (await call(mallory.auth, 'POST', '/invitation-links/accept', { token: revokedInv.token }))
        .statusCode,
    ).toBe(409);
    const expiredInv = CreatedInvitation.parse(
      (
        await call(lan.h, 'POST', '/invitations', { email: 'mallory@team.vn', role: 'care' })
      ).json(),
    );
    await owner.db
      .update(schema.invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.invitations.id, expiredInv.invitation.id));
    expect(
      (await call(mallory.auth, 'POST', '/invitation-links/accept', { token: expiredInv.token }))
        .statusCode,
    ).toBe(409);

    // A removed member loses access at once; their work stays.
    const removed = await call(lan.h, 'POST', `/members/${binh.userId}/remove`);
    expect(removed.json()).toMatchObject({ status: 'removed' });
    expect((await call(asBinh, 'GET', '/members')).statusCode).toBe(404);
  });

  it('admins manage sales, CSKH and analysts; only the owner manages admins', async () => {
    const lan = await user('lan2@team.vn', 'Chủ shop');
    const admin = await user('admin2@team.vn', 'Quản lý');
    const other = await user('other2@team.vn', 'Admin khác');
    const sale = await user('sale2@team.vn', 'Sales');
    await join(lan, admin, 'admin2@team.vn', 'admin');
    await join(lan, other, 'other2@team.vn', 'admin');
    const asAdmin = admin.in(lan.ownWorkspace);
    expect(
      (await call(asAdmin, 'POST', '/invitations', { email: 'x2@team.vn', role: 'admin' }))
        .statusCode,
    ).toBe(403);
    const inv = await call(asAdmin, 'POST', '/invitations', {
      email: 'sale2@team.vn',
      role: 'sales',
    });
    const { token } = CreatedInvitation.parse(inv.json());
    await call(sale.auth, 'POST', '/invitation-links/accept', { token });
    expect(
      (await call(asAdmin, 'PATCH', `/members/${sale.userId}`, { role: 'care' })).json(),
    ).toMatchObject({ role: 'care' });
    expect((await call(asAdmin, 'POST', `/members/${other.userId}/remove`)).statusCode).toBe(403);
    expect(
      (await call(asAdmin, 'PATCH', `/members/${sale.userId}`, { role: 'admin' })).statusCode,
    ).toBe(403);
    // Links of a removed admin stop working.
    const pending = CreatedInvitation.parse(
      (
        await call(other.in(lan.ownWorkspace), 'POST', '/invitations', {
          email: 'late2@team.vn',
          role: 'sales',
        })
      ).json(),
    );
    expect((await call(lan.h, 'POST', `/members/${other.userId}/remove`)).statusCode).toBe(200);
    const late = await user('late2@team.vn', 'Đến muộn');
    expect(
      (await call(late.auth, 'POST', '/invitation-links/accept', { token: pending.token }))
        .statusCode,
    ).toBe(409);
  });

  it('roles decide what members may do, and Sales see only their own and unassigned customers', async () => {
    const lan = await user('lan3@team.vn', 'Chủ shop');
    const binh = await user('binh3@team.vn', 'Sales Bình');
    const chi = await user('chi3@team.vn', 'Sales Chi');
    const an = await user('an3@team.vn', 'Phân tích An');
    await join(lan, binh, 'binh3@team.vn', 'sales');
    await join(lan, chi, 'chi3@team.vn', 'sales');
    await join(lan, an, 'an3@team.vn', 'analyst');
    const asBinh = binh.in(lan.ownWorkspace);
    const asAn = an.in(lan.ownWorkspace);

    // Capabilities per role.
    expect(
      (
        await call(asBinh, 'POST', '/products', {
          code: 'X',
          name: 'X',
          variants: [{ sku: 'X', price: 1 }],
        })
      ).statusCode,
    ).toBe(403);
    expect((await call(asBinh, 'POST', '/crm/sources', { name: 'Mới' })).statusCode).toBe(403);
    expect((await call(asBinh, 'POST', '/bots', { name: 'Bot' })).statusCode).toBe(403);
    expect((await call(asBinh, 'GET', '/orders')).statusCode).toBe(200);
    expect((await call(asAn, 'POST', '/contacts', { name: 'x' })).statusCode).toBe(403);
    expect((await call(asAn, 'POST', '/orders', {})).statusCode).toBe(403);
    // Bot training, page connections and the inbox (added by the Meta inbox milestone).
    const someId = '018d0000-0000-7000-8000-0000000000aa';
    expect(
      (
        await call(asBinh, 'POST', `/bots/${someId}/training-items`, {
          kind: 'scenario',
          title: 'x',
          content: 'x',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call(asBinh, 'POST', `/bots/${someId}/training-history/${someId}/restore`)).statusCode,
    ).toBe(403);
    expect((await call(asBinh, 'POST', '/channels/facebook/connect', {})).statusCode).toBe(403);
    expect((await call(asBinh, 'PATCH', `/channels/${someId}`, { botId: null })).statusCode).toBe(
      403,
    );
    expect(
      (await call(asAn, 'POST', `/conversations/${someId}/messages`, { text: 'hi' })).statusCode,
    ).toBe(403);
    expect((await call(asAn, 'PATCH', `/conversations/${someId}`, { note: 'x' })).statusCode).toBe(
      403,
    );
    // Sales may work the inbox: the capability passes and the unknown conversation is a 404.
    expect(
      (await call(asBinh, 'PATCH', `/conversations/${someId}`, { note: 'x' })).statusCode,
    ).toBe(404);
    expect(
      (
        await call(asBinh, 'POST', '/saved-views', {
          name: 'Chung',
          visibility: 'shared',
          filter: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call(asBinh, 'POST', '/saved-views', { name: 'Riêng', filter: {} })).statusCode,
    ).toBe(201);

    const make = async (name: string, salesUserId?: string) =>
      ContactDto.parse(
        (
          await call(lan.h, 'POST', '/contacts', { name, ...(salesUserId ? { salesUserId } : {}) })
        ).json(),
      );
    const mine = await make('Của Bình', binh.userId);
    const theirs = await make('Của Chi', chi.userId);
    const free = await make('Chưa ai nhận');

    const names = async (h: Headers) =>
      ContactListResponse.parse((await call(h, 'POST', '/contacts/query', {})).json())
        .data.map((c) => c.name)
        .sort();
    expect(await names(asBinh)).toEqual(['Chưa ai nhận', 'Của Bình']);
    expect(await names(asAn)).toEqual(['Chưa ai nhận', 'Của Bình', 'Của Chi']);
    for (const path of ['', '/notes', '/history', '/tags']) {
      expect((await call(asBinh, 'GET', `/contacts/${theirs.id}${path}`)).statusCode).toBe(404);
    }
    expect(
      (await call(asBinh, 'POST', `/contacts/${theirs.id}/notes`, { body: 'x' })).statusCode,
    ).toBe(404);

    // Claiming an unassigned customer is fine; handing one to someone else is not.
    const claimed = await call(asBinh, 'PATCH', `/contacts/${free.id}`, {
      salesUserId: binh.userId,
      expectedVersion: 1,
    });
    expect(claimed.statusCode, claimed.body).toBe(200);
    expect(
      (
        await call(asBinh, 'PATCH', `/contacts/${mine.id}`, {
          salesUserId: chi.userId,
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(asBinh, 'PATCH', `/contacts/${mine.id}`, {
          name: 'Của Bình (VIP)',
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(200);
  });

  it('hands new customers of a source to Sales in proportion to weights, also under load (T-033)', async () => {
    const lan = await user('lan4@team.vn', 'Chủ shop');
    const binh = await user('binh4@team.vn', 'Sales Bình');
    const chi = await user('chi4@team.vn', 'Sales Chi');
    await join(lan, binh, 'binh4@team.vn', 'sales');
    await join(lan, chi, 'chi4@team.vn', 'sales');
    const facebook = CrmOptionList.parse(
      (await call(lan.h, 'GET', '/crm/sources')).json(),
    ).data.find((s) => s.key === 'facebook');
    const zalo = CrmOptionList.parse((await call(lan.h, 'GET', '/crm/sources')).json()).data.find(
      (s) => s.key === 'zalo',
    );

    const policies = (await call(lan.h, 'GET', '/crm/assignment-policies')).json() as {
      data: AssignmentPolicyDto[];
    };
    expect(policies.data.find((p) => p.sourceId === facebook?.id)).toMatchObject({
      enabled: false,
      version: 0,
    });
    const put = await call(lan.h, 'PUT', `/crm/assignment-policies/${facebook?.id}`, {
      enabled: true,
      candidates: [
        { userId: binh.userId, weight: 2 },
        { userId: chi.userId, weight: 1 },
      ],
      expectedVersion: 0,
    });
    expect(AssignmentPolicyDto.parse(put.json()).version).toBe(1);
    expect(
      (
        await call(lan.h, 'PUT', `/crm/assignment-policies/${facebook?.id}`, {
          enabled: false,
          candidates: [],
          expectedVersion: 0,
        })
      ).statusCode,
    ).toBe(409);
    const stranger = await user('stranger4@team.vn', 'Người ngoài');
    expect(
      (
        await call(lan.h, 'PUT', `/crm/assignment-policies/${facebook?.id}`, {
          enabled: true,
          candidates: [{ userId: stranger.userId, weight: 1 }],
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(400);
    // Analysts do not sell: they cannot receive customers.
    const analyst = await user('analyst4@team.vn', 'Phân tích');
    await join(lan, analyst, 'analyst4@team.vn', 'analyst');
    expect(
      (
        await call(lan.h, 'PUT', `/crm/assignment-policies/${facebook?.id}`, {
          enabled: true,
          candidates: [{ userId: analyst.userId, weight: 1 }],
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(binh.in(lan.ownWorkspace), 'PUT', `/crm/assignment-policies/${facebook?.id}`, {
          enabled: false,
          candidates: [],
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(403);

    // Six at once: 4 to Bình, 2 to Chi; a given Sales owner or another source is left alone.
    const created = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        call(lan.h, 'POST', '/contacts', { name: `Khách FB ${i}`, sourceId: facebook?.id }),
      ),
    );
    const owners = created.map((r) => ContactDto.parse(r.json()).salesUserId);
    expect(owners.filter((o) => o === binh.userId)).toHaveLength(4);
    expect(owners.filter((o) => o === chi.userId)).toHaveLength(2);
    const given = ContactDto.parse(
      (
        await call(lan.h, 'POST', '/contacts', {
          name: 'Đã có Sales',
          sourceId: facebook?.id,
          salesUserId: lan.userId,
        })
      ).json(),
    );
    expect(given.salesUserId).toBe(lan.userId);
    const other = ContactDto.parse(
      (await call(lan.h, 'POST', '/contacts', { name: 'Từ Zalo', sourceId: zalo?.id })).json(),
    );
    expect(other.salesUserId).toBeNull();

    // A Sales member creating a customer owns it themselves (no hand-off to a colleague).
    const own = await call(chi.in(lan.ownWorkspace), 'POST', '/contacts', {
      name: 'Của Chi tạo',
      sourceId: facebook?.id,
    });
    expect(ContactDto.parse(own.json()).salesUserId).toBe(chi.userId);

    // A removed member is skipped.
    await call(lan.h, 'POST', `/members/${chi.userId}/remove`);
    const after = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        call(lan.h, 'POST', '/contacts', { name: `Sau ${i}`, sourceId: facebook?.id }),
      ),
    );
    expect(after.map((r) => ContactDto.parse(r.json()).salesUserId)).toEqual([
      binh.userId,
      binh.userId,
      binh.userId,
    ]);
    const history = (
      await call(lan.h, 'GET', `/contacts/${ContactDto.parse(created[0]?.json()).id}/history`)
    ).json() as {
      data: Array<{ type: string; data: Record<string, unknown> }>;
    };
    expect(history.data[0]).toMatchObject({
      type: 'contact.created',
      data: { autoAssigned: true },
    });
  });
});
