import {
  AcceptedInvitation,
  AssignmentPolicyDto,
  AuditList,
  AuthResponse,
  BootstrapResponse,
  ContactDto,
  ContactHistoryList,
  ContactListResponse,
  CreatedInvitation,
  EntitlementsDto,
  CrmOptionList,
  InvitationPreview,
  MemberList,
  RemovalPreview,
} from '@agent-sales/contracts';
import {
  createDb,
  ensureLoginRoles,
  eq,
  migrate,
  schema,
  sql,
  withCredentials,
} from '@agent-sales/db';
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
  // Free has one seat; most tests need a team, so every shop starts with plenty.
  await setSeats(own, 50);
  return {
    userId: boot.user.id,
    ownWorkspace: own,
    auth: { authorization } as Headers,
    h: { authorization, 'x-workspace-id': own } as Headers,
    in: (ws: string): Headers => ({ authorization, 'x-workspace-id': ws }),
  };
}

/** Sets the member seat limit of a workspace (an entitlement override, as an operator would). */
async function setSeats(workspaceId: string, seats: number | null) {
  await owner.db
    .insert(schema.workspaceEntitlementOverrides)
    .values({ workspaceId, key: 'members.max', value: seats, reason: 'test' })
    .onConflictDoUpdate({
      target: [
        schema.workspaceEntitlementOverrides.workspaceId,
        schema.workspaceEntitlementOverrides.key,
      ],
      set: { value: seats },
    });
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
    // Removing the owner fails before anything moves: their customers stay theirs.
    const kept = ContactDto.parse(
      (
        await call(lan.h, 'POST', '/contacts', { name: 'Khách chủ', salesUserId: lan.userId })
      ).json(),
    );
    for (const h of [asAdmin, lan.h]) {
      const out = await call(h, 'POST', `/members/${lan.userId}/remove`, {
        reassign: { mode: 'unassign' },
      });
      expect(out.statusCode, out.body).toBe(409);
    }
    expect(
      ContactDto.parse((await call(lan.h, 'GET', `/contacts/${kept.id}`)).json()).salesUserId,
    ).toBe(lan.userId);
    // An admin cannot revoke the owner's admin invitation either.
    const ownerInv = CreatedInvitation.parse(
      (await call(lan.h, 'POST', '/invitations', { email: 'y2@team.vn', role: 'admin' })).json(),
    );
    const revoke = `/invitations/${ownerInv.invitation.id}/revoke`;
    expect((await call(asAdmin, 'POST', revoke)).statusCode).toBe(403);
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

    const transferred = created
      .map((response) => ContactDto.parse(response.json()))
      .find((contact) => contact.salesUserId === chi.userId);
    if (!transferred) throw new Error('Expected a contact assigned to the member being removed');

    // A removed member is skipped.
    // (Chi owns customers, so their hand-over has to be named.)
    const removed = await call(lan.h, 'POST', `/members/${chi.userId}/remove`, {
      reassign: { mode: 'transfer', toUserId: binh.userId },
    });
    expect(removed.statusCode).toBe(200);
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
    const history = ContactHistoryList.parse(
      (await call(lan.h, 'GET', `/contacts/${transferred.id}/history`)).json(),
    );
    expect(history.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'contact.created',
          data: expect.objectContaining({ autoAssigned: true }),
        }),
        expect.objectContaining({
          type: 'contact.assigned',
          data: expect.objectContaining({ reason: 'member_removed' }),
          changes: { salesUserId: { from: chi.userId, to: binh.userId } },
        }),
      ]),
    );
  });

  it('keeps seats: waiting invitations reserve them and the last seat goes to one joiner (ADM-01)', async () => {
    const lan = await user('lan5@team.vn', 'Chủ shop');
    const a = await user('a5@team.vn', 'Sales A');
    const c = await user('c5@team.vn', 'Sales C');
    const d = await user('d5@team.vn', 'Sales D');
    await setSeats(lan.ownWorkspace, 3); // the owner and two more

    const invite = (email: string) => call(lan.h, 'POST', '/invitations', { email, role: 'sales' });
    const tokenOf = (r: { json(): unknown }) => CreatedInvitation.parse(r.json());
    const first = tokenOf(await invite('a5@team.vn'));
    const second = tokenOf(await invite('b5@team.vn'));
    // The owner and two waiting invitations fill three seats: no further link.
    const full = await invite('c5@team.vn');
    expect(full.statusCode).toBe(402);
    expect(full.json()).toMatchObject({
      error: { code: 'QUOTA_EXCEEDED', details: { limit: 3, members: 1, pending: 2 } },
    });
    expect(MemberList.parse((await call(lan.h, 'GET', '/members')).json()).seats).toEqual({
      used: 1,
      pending: 2,
      limit: 3,
    });
    // Re-inviting the same address replaces its link and needs no extra seat.
    const renewed = await invite('a5@team.vn');
    expect(renewed.statusCode).toBe(201);
    // Revoking a waiting invitation frees its seat.
    await call(lan.h, 'POST', `/invitations/${second.invitation.id}/revoke`);
    expect((await invite('c5@team.vn')).statusCode).toBe(201);
    expect(first.invitation.id).not.toBe(tokenOf(renewed).invitation.id);

    // One seat left (plan shrinks to 3 with the owner and A in): C and D race for it.
    expect(
      (await call(a.auth, 'POST', '/invitation-links/accept', { token: tokenOf(renewed).token }))
        .statusCode,
    ).toBe(200);
    await setSeats(lan.ownWorkspace, 5);
    const cLink = tokenOf(await invite('c5@team.vn')).token;
    const dLink = tokenOf(await invite('d5@team.vn')).token;
    await setSeats(lan.ownWorkspace, 3);
    const [rc, rd] = await Promise.all([
      call(c.auth, 'POST', '/invitation-links/accept', { token: cLink }),
      call(d.auth, 'POST', '/invitation-links/accept', { token: dLink }),
    ]);
    expect([rc.statusCode, rd.statusCode].sort()).toEqual([200, 402]);
    const members = MemberList.parse((await call(lan.h, 'GET', '/members')).json());
    expect(members.seats.used).toBe(3);

    // The refused joiner keeps a working link: once a seat opens it succeeds.
    await setSeats(lan.ownWorkspace, 4);
    const loser = rc.statusCode === 402 ? { u: c, token: cLink } : { u: d, token: dLink };
    expect(
      (await call(loser.u.auth, 'POST', '/invitation-links/accept', { token: loser.token }))
        .statusCode,
    ).toBe(200);
  });

  it('resends a link (the old one dies) and records who did what in the audit trail (ADM-01, T-054)', async () => {
    const lan = await user('lan6@team.vn', 'Chủ shop');
    const mai = await user('mai6@team.vn', 'Sales Mai');
    const inv = CreatedInvitation.parse(
      (await call(lan.h, 'POST', '/invitations', { email: 'mai6@team.vn', role: 'sales' })).json(),
    );
    const resent = CreatedInvitation.parse(
      (await call(lan.h, 'POST', `/invitations/${inv.invitation.id}/resend`)).json(),
    );
    expect(resent.token).not.toBe(inv.token);
    expect(resent.invitation.email).toBe('mai6@team.vn');
    expect(
      (await call(mai.auth, 'POST', '/invitation-links/accept', { token: inv.token })).statusCode,
    ).toBe(409);
    expect(
      (await call(mai.auth, 'POST', '/invitation-links/accept', { token: resent.token }))
        .statusCode,
    ).toBe(200);
    // An accepted invitation cannot be resent.
    expect(
      (await call(lan.h, 'POST', `/invitations/${resent.invitation.id}/resend`)).statusCode,
    ).toBe(409);

    await call(lan.h, 'PATCH', `/members/${mai.userId}`, { role: 'care' });
    const trail = AuditList.parse((await call(lan.h, 'GET', '/audit-events')).json());
    expect(trail.data.map((e) => e.action)).toEqual([
      'member.role_changed',
      'member.joined',
      'member.invitation_resent',
      'member.invited',
    ]);
    const changed = trail.data[0];
    expect(changed).toMatchObject({
      actorName: 'Chủ shop',
      targetId: mai.userId,
      data: { role: { from: 'sales', to: 'care' } },
    });
    // No emails or tokens in the trail.
    expect(JSON.stringify(trail)).not.toContain('mai6@team.vn');
    expect(JSON.stringify(trail)).not.toContain(inv.token);
    // Filters and who may read.
    const onlyMembers = AuditList.parse(
      (await call(lan.h, 'GET', '/audit-events?action=member.role_changed')).json(),
    );
    expect(onlyMembers.data).toHaveLength(1);
    const page = AuditList.parse((await call(lan.h, 'GET', '/audit-events?limit=2')).json());
    expect(page.data).toHaveLength(2);
    expect(page.next).not.toBeNull();
    const rest = AuditList.parse(
      (
        await call(
          lan.h,
          'GET',
          `/audit-events?limit=50&before=${encodeURIComponent(page.next?.before ?? '')}&beforeId=${page.next?.beforeId}`,
        )
      ).json(),
    );
    expect(rest.data.length + 2).toBe(trail.data.length);
    expect((await call(mai.in(lan.ownWorkspace), 'GET', '/audit-events')).statusCode).toBe(403);
    // Another shop sees none of it.
    const other = await user('other6@team.vn', 'Shop khác');
    expect(AuditList.parse((await call(other.h, 'GET', '/audit-events')).json()).data).toEqual([]);
  });

  it('removing a member with customers needs an explicit hand-over and previews it first (ADM-01)', async () => {
    const lan = await user('lan7@team.vn', 'Chủ shop');
    const binh = await user('binh7@team.vn', 'Sales Bình');
    const chi = await user('chi7@team.vn', 'Sales Chi');
    const an = await user('an7@team.vn', 'Phân tích An');
    await join(lan, binh, 'binh7@team.vn', 'sales');
    await join(lan, chi, 'chi7@team.vn', 'sales');
    await join(lan, an, 'an7@team.vn', 'analyst');
    const make = async (name: string, extra: object) =>
      ContactDto.parse((await call(lan.h, 'POST', '/contacts', { name, ...extra })).json());
    const c1 = await make('Khách 1', { salesUserId: binh.userId });
    const c2 = await make('Khách 2', { salesUserId: binh.userId, careUserId: binh.userId });
    await make('Khách 3', { salesUserId: chi.userId });

    const preview = RemovalPreview.parse(
      (await call(lan.h, 'GET', `/members/${binh.userId}/removal-preview`)).json(),
    );
    expect(preview).toEqual({ sales: 2, care: 1, requiresReassignment: true });
    // Silently dropping the customers is not an option.
    const bare = await call(lan.h, 'POST', `/members/${binh.userId}/remove`, {});
    expect(bare.statusCode).toBe(400);
    expect(bare.json()).toMatchObject({
      error: { details: { reassignmentRequired: true, sales: 2, care: 1 } },
    });
    // An analyst cannot take customers over; neither can the leaver themselves.
    const bad = { reassign: { mode: 'transfer', toUserId: an.userId } };
    expect((await call(lan.h, 'POST', `/members/${binh.userId}/remove`, bad)).statusCode).toBe(400);
    expect(
      (
        await call(lan.h, 'POST', `/members/${binh.userId}/remove`, {
          reassign: { mode: 'transfer', toUserId: binh.userId },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await call(binh.in(lan.ownWorkspace), 'GET', `/members/${chi.userId}/removal-preview`))
        .statusCode,
    ).toBe(403);

    const done = await call(lan.h, 'POST', `/members/${binh.userId}/remove`, {
      reassign: { mode: 'transfer', toUserId: chi.userId },
    });
    expect(done.statusCode, done.body).toBe(200);
    const moved = ContactDto.parse((await call(lan.h, 'GET', `/contacts/${c2.id}`)).json());
    expect(moved).toMatchObject({ salesUserId: chi.userId, careUserId: chi.userId });
    const hist = ContactHistoryList.parse(
      (await call(lan.h, 'GET', `/contacts/${c1.id}/history?type=contact.assigned`)).json(),
    );
    expect(hist.data[0]).toMatchObject({
      changes: { salesUserId: { from: binh.userId, to: chi.userId } },
    });
    expect(
      await owner.db
        .select()
        .from(schema.outboxEvents)
        .where(eq(schema.outboxEvents.type, 'crm.contact.assigned.v1'))
        .then((r) => r.length),
    ).toBeGreaterThanOrEqual(3);

    // Nobody takes them: unassigned, ready to be picked up.
    const dan = await user('dan7@team.vn', 'Sales Dân');
    await join(lan, dan, 'dan7@team.vn', 'sales');
    const mine = await make('Khách của Dân', { salesUserId: dan.userId });
    await call(lan.h, 'POST', `/members/${dan.userId}/remove`, { reassign: { mode: 'unassign' } });
    expect(
      ContactDto.parse((await call(lan.h, 'GET', `/contacts/${mine.id}`)).json()).salesUserId,
    ).toBeNull();
    // A member with no customers needs no hand-over.
    const eva = await user('eva7@team.vn', 'Sales Eva');
    await join(lan, eva, 'eva7@team.vn', 'sales');
    expect((await call(lan.h, 'POST', `/members/${eva.userId}/remove`, {})).statusCode).toBe(200);
  });

  it('a downgrade takes effect on the very next request', async () => {
    const lan = await user('lan8@team.vn', 'Chủ shop');
    const adm = await user('adm8@team.vn', 'Quản lý');
    await join(lan, adm, 'adm8@team.vn', 'admin');
    const asAdm = adm.in(lan.ownWorkspace);
    expect((await call(asAdm, 'POST', '/crm/sources', { name: 'Nguồn mới' })).statusCode).toBe(201);
    await call(lan.h, 'PATCH', `/members/${adm.userId}`, { role: 'analyst' });
    expect((await call(asAdm, 'POST', '/crm/sources', { name: 'Nguồn nữa' })).statusCode).toBe(403);
    expect((await call(asAdm, 'GET', '/audit-events')).statusCode).toBe(403);
    await call(lan.h, 'POST', `/members/${adm.userId}/remove`, {});
    expect(
      (await call(asAdm, 'GET', '/contacts/00000000-0000-4000-8000-000000000000')).statusCode,
    ).toBe(404);
  });

  it('shows what the plan allows and honours overrides and plan changes (T-053)', async () => {
    const lan = await user('lan9@team.vn', 'Chủ shop');
    await owner.db
      .delete(schema.workspaceEntitlementOverrides)
      .where(eq(schema.workspaceEntitlementOverrides.workspaceId, lan.ownWorkspace));
    const free = EntitlementsDto.parse((await call(lan.h, 'GET', '/billing/entitlements')).json());
    expect(free).toMatchObject({ plan: { code: 'free' }, status: 'active', aiModels: ['smart'] });
    expect(free.limits['members.max']).toBe(1);
    expect(free.features['feature.lazada']).toBe(false);

    await owner.db.insert(schema.subscriptions).values({
      workspaceId: lan.ownWorkspace,
      planCode: 'sales_neo',
      planVersion: 1,
      periodMonths: 3,
    });
    const neo = EntitlementsDto.parse((await call(lan.h, 'GET', '/billing/entitlements')).json());
    expect(neo.plan.code).toBe('sales_neo');
    expect(neo.limits['contacts.max']).toBeNull(); // unlimited
    expect(neo.aiModels).toEqual(['smart', 'pro', 'neo']);
    await setSeats(lan.ownWorkspace, 99);
    expect(
      EntitlementsDto.parse((await call(lan.h, 'GET', '/billing/entitlements')).json()).limits[
        'members.max'
      ],
    ).toBe(99);
    // Entitlements are per workspace.
    const other = await user('other9@team.vn', 'Shop khác');
    expect(
      EntitlementsDto.parse((await call(other.h, 'GET', '/billing/entitlements')).json()).plan.code,
    ).toBe('free');
  });

  it('archived customers count for the hand-over too, and move with the rest', async () => {
    const lan = await user('lan18@team.vn', 'Chủ shop');
    const binh = await user('binh18@team.vn', 'Sales Bình');
    await join(lan, binh, 'binh18@team.vn', 'sales');
    const made = ContactDto.parse(
      (
        await call(lan.h, 'POST', '/contacts', { name: 'Khách cũ', salesUserId: binh.userId })
      ).json(),
    );
    await owner.db
      .update(schema.contacts)
      .set({ archivedAt: new Date() })
      .where(eq(schema.contacts.id, made.id));
    const preview = RemovalPreview.parse(
      (await call(lan.h, 'GET', `/members/${binh.userId}/removal-preview`)).json(),
    );
    expect(preview).toMatchObject({ sales: 1, requiresReassignment: true });
    const out = await call(lan.h, 'POST', `/members/${binh.userId}/remove`, {
      reassign: { mode: 'unassign' },
    });
    expect(out.statusCode, out.body).toBe(200);
    const [row] = await owner.db
      .select({ sales: schema.contacts.salesUserId })
      .from(schema.contacts)
      .where(eq(schema.contacts.id, made.id));
    expect(row?.sales).toBeNull();
  });

  it('a workspace can read its plan rows but never write them (tenant role is read-only)', async () => {
    const lan = await user('lan19@team.vn', 'Chủ shop');
    await setSeats(lan.ownWorkspace, 3);
    const attempt = (stmt: ReturnType<typeof sql>) =>
      owner.db.transaction(async (tx) => {
        await tx.execute(sql`set local role app_tenant`);
        await tx.execute(sql`select set_config('app.workspace_id', ${lan.ownWorkspace}, true)`);
        await tx.execute(stmt);
      });
    await expect(
      attempt(
        sql`insert into workspace_entitlement_overrides (workspace_id, key, value) values (${lan.ownWorkspace}, 'members.max', '999'::jsonb)`,
      ),
    ).rejects.toThrow();
    await expect(
      attempt(sql`update workspace_entitlement_overrides set value = '999'::jsonb`),
    ).rejects.toThrow();
    await expect(
      attempt(sql`select * from workspace_entitlement_overrides`),
    ).resolves.toBeUndefined();
  });
});
