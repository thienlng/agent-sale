import {
  AuthResponse,
  BootstrapResponse,
  ContactDto,
  ContactHistoryList,
  ContactListResponse,
  ContactNoteDto,
  CrmOptionList,
  SavedViewDto,
  SavedViewList,
  TagAssignmentDto,
  TagDto,
} from '@agent-sales/contracts';
import { createDb, ensureLoginRoles, eq, migrate, schema, withCredentials } from '@agent-sales/db';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';

/** Customers, sources/statuses, tags and saved views on a real Postgres (RLS, SQL filters). */
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
/** A new user owning a new shop. */
async function shop(email: string, name = 'Chủ shop Lan') {
  const signup = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      remoteAddress: `10.1.0.${++signups}`,
      payload: {
        name,
        email,
        password: 'a long enough password',
        workspaceName: 'Shop',
        industry: 'fashion',
      },
    });
  const { accessToken } = AuthResponse.parse(signup.json());
  const authorization = `Bearer ${accessToken}`;
  const boot = BootstrapResponse.parse((await call({ authorization }, 'GET', '/bootstrap')).json());
  const workspaceId = boot.memberships[0]?.workspaceId ?? '';
  return {
    userId: boot.user.id,
    workspaceId,
    h: { authorization, 'x-workspace-id': workspaceId } as Headers,
    /** This user acting in another workspace (after being added as a member). */
    in: (ws: string): Headers => ({ authorization, 'x-workspace-id': ws }),
  };
}

async function addMember(workspaceId: string, userId: string, status = 'active') {
  await owner.db.insert(schema.members).values({
    id: crypto.randomUUID(),
    workspaceId,
    userId,
    role: 'member',
    status,
  });
}

const contact = async (h: Headers, body: object) => {
  const r = await call(h, 'POST', '/contacts', body);
  expect(r.statusCode, r.body).toBe(201);
  return ContactDto.parse(r.json());
};
const query = async (h: Headers, body: object = {}) => {
  const r = await call(h, 'POST', '/contacts/query', body);
  expect(r.statusCode, r.body).toBe(200);
  return ContactListResponse.parse(r.json());
};
const options = async (h: Headers, kind: 'sources' | 'statuses') =>
  CrmOptionList.parse((await call(h, 'GET', `/crm/${kind}`)).json()).data;
const history = async (h: Headers, id: string, q = '') =>
  ContactHistoryList.parse((await call(h, 'GET', `/contacts/${id}/history${q}`)).json()).data;
const outbox = (type: string) =>
  owner.db.select().from(schema.outboxEvents).where(eq(schema.outboxEvents.type, type));

describe('crm on Postgres', () => {
  it('creates, edits with versions, notes and audits a customer (CRM-01: C01–C06)', async () => {
    const a = await shop('crm-profile@shop.vn');

    // Name only is enough; nothing at all, a bad email or an unusable phone is not.
    const created = await contact(a.h, { name: 'BA CRM 20261024 KHONG LIEN HE' });
    expect(created).toMatchObject({ phone: null, email: null, version: 1, profileNote: '' });
    expect((await query(a.h)).total).toBe(1);
    expect((await call(a.h, 'POST', '/contacts', {})).statusCode).toBe(400);
    expect((await call(a.h, 'POST', '/contacts', { name: 'x', email: 'nope' })).statusCode).toBe(
      400,
    );
    const badPhone = await call(a.h, 'POST', '/contacts', { name: 'x', phone: '0123456789' });
    expect(badPhone.statusCode).toBe(400);
    expect(badPhone.json()).toMatchObject({
      error: { details: { fields: { phone: expect.any(String) } } },
    });

    // A retried create returns the first contact.
    const requestId = crypto.randomUUID();
    const first = await contact(a.h, { name: 'Khách retry', clientRequestId: requestId });
    const again = await call(a.h, 'POST', '/contacts', {
      name: 'Khách retry',
      clientRequestId: requestId,
    });
    expect(ContactDto.parse(again.json()).id).toBe(first.id);
    // Two identical submissions racing: one customer, both answers name it.
    const raceId = crypto.randomUUID();
    const [r1, r2] = await Promise.all([
      call(a.h, 'POST', '/contacts', { name: 'Khách double click', clientRequestId: raceId }),
      call(a.h, 'POST', '/contacts', { name: 'Khách double click', clientRequestId: raceId }),
    ]);
    expect([r1.statusCode, r2.statusCode].every((c) => c === 201)).toBe(true);
    expect(ContactDto.parse(r1.json()).id).toBe(ContactDto.parse(r2.json()).id);
    expect((await query(a.h, { q: 'double click' })).total).toBe(1);

    // Address, Hotline source and Trial status: profile and list agree.
    const hotline = (await options(a.h, 'sources')).find((s) => s.key === 'hotline');
    const trial = (await options(a.h, 'statuses')).find((s) => s.key === 'trial');
    const edited = await call(a.h, 'PATCH', `/contacts/${created.id}`, {
      address: '12 Lê Lợi, Quận 1',
      sourceId: hotline?.id,
      statusId: trial?.id,
      phone: '0901 234 567',
      expectedVersion: 1,
    });
    expect(edited.statusCode, edited.body).toBe(200);
    const profile = ContactDto.parse(edited.json());
    expect(profile).toMatchObject({
      version: 2,
      sourceId: hotline?.id,
      firstSourceId: hotline?.id,
      statusId: trial?.id,
      phoneNormalized: '+84901234567',
    });
    expect(profile.addressProvidedAt).not.toBeNull();
    const listed = (await query(a.h, { q: 'khong lien he' })).data[0];
    expect(listed).toMatchObject({
      id: created.id,
      statusId: trial?.id,
      address: '12 Lê Lợi, Quận 1',
    });

    // Renaming keeps the provided-at timestamps.
    const renamed = ContactDto.parse(
      (
        await call(a.h, 'PATCH', `/contacts/${created.id}`, {
          name: 'BA CRM đổi tên',
          expectedVersion: 2,
        })
      ).json(),
    );
    expect(renamed.phoneProvidedAt).toBe(profile.phoneProvidedAt);
    expect(renamed.addressProvidedAt).toBe(profile.addressProvidedAt);

    // Two edits from the same version: the second conflicts and loses nothing.
    const [x, y] = await Promise.all([
      call(a.h, 'PATCH', `/contacts/${created.id}`, { profileNote: 'Một', expectedVersion: 3 }),
      call(a.h, 'PATCH', `/contacts/${created.id}`, { profileNote: 'Hai', expectedVersion: 3 }),
    ]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    const winner = (x.statusCode === 200 ? x : y).json() as { profileNote: string };
    const now = ContactDto.parse((await call(a.h, 'GET', `/contacts/${created.id}`)).json());
    expect(now).toMatchObject({ version: 4, profileNote: winner.profileNote });

    // A note is separate from the profile note, with author and time; edits keep the old body.
    const noteRes = await call(a.h, 'POST', `/contacts/${created.id}/notes`, {
      body: 'Gọi lại chiều mai',
    });
    expect(noteRes.statusCode).toBe(201);
    const note = ContactNoteDto.parse(noteRes.json());
    expect(note.authorName).toBe('Chủ shop Lan');
    const editedNote = await call(a.h, 'PATCH', `/contacts/${created.id}/notes/${note.id}`, {
      body: 'Gọi lại sáng mai',
      expectedVersion: 1,
    });
    expect(ContactNoteDto.parse(editedNote.json())).toMatchObject({ version: 2 });
    const staleNote = await call(a.h, 'PATCH', `/contacts/${created.id}/notes/${note.id}`, {
      body: 'x',
      expectedVersion: 1,
    });
    expect(staleNote.statusCode).toBe(409);
    expect(
      ContactDto.parse((await call(a.h, 'GET', `/contacts/${created.id}`)).json()).profileNote,
    ).toBe(winner.profileNote);

    const timeline = await history(a.h, created.id, '?order=asc');
    expect(timeline.map((e) => e.type)).toEqual([
      'contact.created',
      'contact.updated',
      'contact.status_changed',
      'contact.updated',
      'contact.updated',
      'note.added',
      'note.edited',
    ]);
    expect(timeline[2]?.changes).toEqual({ statusId: { from: null, to: trial?.id } });
    expect(timeline.at(-1)?.changes).toEqual({
      body: { from: 'Gọi lại chiều mai', to: 'Gọi lại sáng mai' },
    });
    expect(timeline.every((e) => e.actorName === 'Chủ shop Lan')).toBe(true);
    expect((await history(a.h, created.id, '?type=note.added')).length).toBe(1);
    expect((await outbox('crm.contact.status_changed.v1')).length).toBeGreaterThanOrEqual(1);

    // Another shop sees nothing of it (C20).
    const b = await shop('crm-other@shop.vn');
    for (const path of ['', '/notes', '/history', '/tags']) {
      expect((await call(b.h, 'GET', `/contacts/${created.id}${path}`)).statusCode).toBe(404);
    }
    expect((await query(b.h)).total).toBe(0);
    expect(
      (await call(b.h, 'PATCH', `/contacts/${created.id}`, { name: 'x', expectedVersion: 4 }))
        .statusCode,
    ).toBe(404);
  });

  it('keeps sources and statuses stable, archives instead of deleting, assigns only members (CRM-03)', async () => {
    const a = await shop('crm-pipeline@shop.vn');
    const seller = await shop('crm-seller@shop.vn', 'Nhân viên Sales');
    const gone = await shop('crm-gone@shop.vn', 'Đã nghỉ');
    await addMember(a.workspaceId, seller.userId);
    await addMember(a.workspaceId, gone.userId, 'removed');

    const sources = await options(a.h, 'sources');
    const statuses = await options(a.h, 'statuses');
    expect(sources).toHaveLength(7);
    expect(statuses.map((s) => s.key)).toEqual([
      'new_data',
      'call',
      'qualified',
      'browsing',
      'zalo_care',
      'trial',
      'won',
      'closed',
    ]);
    // Defaults are seeded once.
    expect(await options(a.h, 'sources')).toHaveLength(7);

    const assignees = (await call(a.h, 'GET', '/crm/assignees')).json() as {
      data: Array<{ name: string }>;
    };
    expect(assignees.data.map((m) => m.name).sort()).toEqual(['Chủ shop Lan', 'Nhân viên Sales']);

    const custom = (
      await call(a.h, 'POST', '/crm/sources', { name: 'Hội chợ', color: '#AA00AA' })
    ).json() as {
      id: string;
      color: string;
    };
    expect(custom.color).toBe('#aa00aa');
    const c = await contact(a.h, {
      name: 'Khách hội chợ',
      sourceId: custom.id,
      statusId: statuses[0]?.id,
    });

    // Sales and CSKH can differ; a removed member cannot be assigned.
    const assigned = await call(a.h, 'PATCH', `/contacts/${c.id}`, {
      salesUserId: seller.userId,
      careUserId: a.userId,
      expectedVersion: 1,
    });
    expect(ContactDto.parse(assigned.json())).toMatchObject({
      salesUserId: seller.userId,
      careUserId: a.userId,
    });
    const refused = await call(a.h, 'PATCH', `/contacts/${c.id}`, {
      careUserId: gone.userId,
      expectedVersion: 2,
    });
    expect(refused.statusCode).toBe(400);
    expect((await history(a.h, c.id, '?type=contact.assigned'))[0]?.changes).toMatchObject({
      salesUserId: { from: null, to: seller.userId },
    });
    expect((await outbox('crm.contact.assigned.v1')).length).toBeGreaterThanOrEqual(2);

    // The seller, as a member, sees the shop's customers.
    expect((await query(seller.in(a.workspaceId))).total).toBe(1);

    // Archive the source in use: the customer keeps it, new customers cannot pick it.
    const archived = await call(a.h, 'PATCH', `/crm/sources/${custom.id}`, { archived: true });
    expect(archived.json()).toMatchObject({ archived: true });
    expect(ContactDto.parse((await call(a.h, 'GET', `/contacts/${c.id}`)).json()).sourceId).toBe(
      custom.id,
    );
    expect(
      (await call(a.h, 'POST', '/contacts', { name: 'Mới', sourceId: custom.id })).statusCode,
    ).toBe(400);
    expect(
      (await call(a.h, 'PATCH', `/contacts/${c.id}`, { name: 'Đổi tên', expectedVersion: 2 }))
        .statusCode,
    ).toBe(200);

    // Reorder: every status exactly once.
    const reversed = statuses.map((s) => s.id).reverse();
    const reordered = await call(a.h, 'PUT', '/crm/statuses/order', { ids: reversed });
    expect(CrmOptionList.parse(reordered.json()).data.map((s) => s.id)).toEqual(reversed);
    expect(
      (await call(a.h, 'PUT', '/crm/statuses/order', { ids: reversed.slice(1) })).statusCode,
    ).toBe(400);
  });

  it('assigns tags idempotently, validates attribute values, keeps archived options readable (CRM-04)', async () => {
    const a = await shop('crm-tags@shop.vn');
    const c = await contact(a.h, { name: 'Khách VIP' });

    const tagsRes = (await call(a.h, 'GET', '/crm/tags')).json() as { data: TagDto[] };
    expect(
      tagsRes.data
        .filter((t) => t.isSystem)
        .map((t) => t.name)
        .sort(),
    ).toEqual(['Event', 'Ticket', 'VIP']);

    const label = TagDto.parse(
      (
        await call(a.h, 'POST', '/crm/tags', { name: 'BA-LAB-20261024', type: 'classification' })
      ).json(),
    );
    expect(
      (await call(a.h, 'POST', '/crm/tags', { name: 'ba-lab-20261024', type: 'classification' }))
        .statusCode,
    ).toBe(409);

    // Add twice → one assignment, one history entry, one event; remove twice → removed once.
    const add1 = await call(a.h, 'POST', `/contacts/${c.id}/tags`, { tagId: label.id });
    const add2 = await call(a.h, 'POST', `/contacts/${c.id}/tags`, { tagId: label.id });
    expect([add1.statusCode, add2.statusCode]).toEqual([201, 200]);
    const assignment = TagAssignmentDto.parse(add1.json());
    expect(TagAssignmentDto.parse(add2.json()).id).toBe(assignment.id);
    expect(assignment.scope).toBe('contact');
    const counted = ((await call(a.h, 'GET', '/crm/tags')).json() as { data: TagDto[] }).data;
    expect(counted.find((x) => x.id === label.id)?.activeCount).toBe(1);
    expect(counted.find((x) => x.name === 'VIP')?.activeCount).toBe(0);
    expect(
      ContactDto.parse((await call(a.h, 'GET', `/contacts/${c.id}`)).json()).tags.map(
        (t) => t.tagId,
      ),
    ).toEqual([label.id]);
    const r1 = await call(a.h, 'POST', `/tag-assignments/${assignment.id}/remove`, {
      reason: 'nhầm',
    });
    const r2 = await call(a.h, 'POST', `/tag-assignments/${assignment.id}/remove`, {});
    expect([r1.statusCode, r2.statusCode]).toEqual([200, 200]);
    expect(TagAssignmentDto.parse(r2.json()).removedAt).toBe(
      TagAssignmentDto.parse(r1.json()).removedAt,
    );
    const tagHistory = (await history(a.h, c.id)).filter((e) => e.type.startsWith('tag.'));
    expect(tagHistory.map((e) => e.type)).toEqual(['tag.removed', 'tag.added']);
    const events = await outbox('crm.tag.assigned.v1');
    expect(
      events.filter((e) => (e.payload as { assignmentId: string }).assignmentId === assignment.id),
    ).toHaveLength(1);

    // Attribute tag: required and typed values are checked on the server.
    const order = TagDto.parse(
      (
        await call(a.h, 'POST', '/crm/tags', {
          name: 'Đơn sỉ',
          type: 'attribute',
          fields: [
            { key: 'qty', label: 'Số lượng', type: 'number', required: true },
            {
              key: 'tier',
              label: 'Hạng',
              type: 'select',
              options: [
                { id: 'a', label: 'A' },
                { id: 'b', label: 'B' },
              ],
            },
          ],
        })
      ).json(),
    );
    expect(
      (await call(a.h, 'POST', `/contacts/${c.id}/tags`, { tagId: order.id, values: {} }))
        .statusCode,
    ).toBe(400);
    const wrong = await call(a.h, 'POST', `/contacts/${c.id}/tags`, {
      tagId: order.id,
      values: { qty: 'ten' },
    });
    expect(wrong.json()).toMatchObject({ error: { details: { fields: { qty: 'number' } } } });
    const filled = TagAssignmentDto.parse(
      (
        await call(a.h, 'POST', `/contacts/${c.id}/tags`, {
          tagId: order.id,
          values: { qty: 10, tier: 'b' },
        })
      ).json(),
    );
    expect(filled.values).toEqual({ qty: 10, tier: 'b' });

    // Archiving option b keeps it on the existing assignment; fields cannot be dropped.
    const archivedOption = await call(a.h, 'PATCH', `/crm/tags/${order.id}`, {
      fields: [
        { key: 'qty', label: 'Số lượng', type: 'number', required: true },
        {
          key: 'tier',
          label: 'Hạng',
          type: 'select',
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B', archived: true },
          ],
        },
      ],
      expectedVersion: 1,
    });
    expect(TagDto.parse(archivedOption.json())).toMatchObject({ schemaVersion: 2, version: 2 });
    expect(
      (await call(a.h, 'PATCH', `/crm/tags/${order.id}`, { fields: [], expectedVersion: 2 }))
        .statusCode,
    ).toBe(400);
    const kept = await call(a.h, 'PATCH', `/tag-assignments/${filled.id}`, {
      values: { qty: 12, tier: 'b' },
      expectedVersion: 1,
    });
    expect(TagAssignmentDto.parse(kept.json())).toMatchObject({
      values: { qty: 12, tier: 'b' },
      schemaVersion: 2,
    });
    const other = await contact(a.h, { name: 'Khách khác' });
    expect(
      (
        await call(a.h, 'POST', `/contacts/${other.id}/tags`, {
          tagId: order.id,
          values: { qty: 1, tier: 'b' },
        })
      ).statusCode,
    ).toBe(400);

    // An archived tag stays readable on history but cannot be added.
    await call(a.h, 'PATCH', `/crm/tags/${label.id}`, { archived: true, expectedVersion: 1 });
    expect(
      (await call(a.h, 'POST', `/contacts/${other.id}/tags`, { tagId: label.id })).statusCode,
    ).toBe(400);
    const all = (await call(a.h, 'GET', `/contacts/${c.id}/tags`)).json() as {
      data: TagAssignmentDto[];
    };
    expect(all.data.find((t) => t.tagId === label.id)?.removedAt).not.toBeNull();
  });

  it('filters with typed rules, all/any, empties and duplicate phones; one compiler for rows and totals (CRM-02)', async () => {
    const a = await shop('crm-filter@shop.vn');
    const statuses = await options(a.h, 'statuses');
    const trial = statuses.find((s) => s.key === 'trial')?.id ?? '';
    const p1 = await contact(a.h, {
      name: 'BA CRM một',
      phone: '0901234567',
      email: 'mot@shop.vn',
      statusId: trial,
    });
    const p2 = await contact(a.h, { name: 'BA CRM hai', phone: '+84 901 234 567' });
    const p3 = await contact(a.h, { name: 'Người khác', email: 'khac@shop.vn' });
    const p4 = await contact(a.h, { name: 'Không số', statusId: trial });
    const vip = ((await call(a.h, 'GET', '/crm/tags')).json() as { data: TagDto[] }).data.find(
      (t) => t.name === 'VIP',
    );
    await call(a.h, 'POST', `/contacts/${p3.id}/tags`, { tagId: vip?.id });

    const ids = async (filter: object, extra: object = {}) =>
      (await query(a.h, { filter, ...extra, pageSize: 100 })).data.map((c) => c.id).sort();
    const sorted = (...xs: Array<{ id: string }>) => xs.map((x) => x.id).sort();

    expect(await ids({ rules: [{ field: 'name', op: 'contains', value: 'BA CRM' }] })).toEqual(
      sorted(p1, p2),
    );
    const both = [
      { field: 'name', op: 'contains', value: 'BA CRM' },
      { field: 'statusId', op: 'in', value: [trial] },
    ];
    expect(await ids({ match: 'all', rules: both })).toEqual(sorted(p1));
    expect(await ids({ match: 'any', rules: both })).toEqual(sorted(p1, p2, p4));
    // Empty values match is_empty and the negative operators, never the positive ones.
    expect(await ids({ rules: [{ field: 'email', op: 'is_empty' }] })).toEqual(sorted(p2, p4));
    expect(await ids({ rules: [{ field: 'email', op: 'neq', value: 'mot@shop.vn' }] })).toEqual(
      sorted(p2, p3, p4),
    );
    expect(await ids({ rules: [{ field: 'name', op: 'not_contains', value: 'BA CRM' }] })).toEqual(
      sorted(p3, p4),
    );
    expect(await ids({ rules: [{ field: 'statusId', op: 'not_in', value: [trial] }] })).toEqual(
      sorted(p2, p3),
    );
    // Phone equality and duplicates use the normalized number; empty phones never group.
    expect(await ids({ rules: [{ field: 'phone', op: 'eq', value: '84901234567' }] })).toEqual(
      sorted(p1, p2),
    );
    expect(await ids({ duplicatesOnly: true })).toEqual(sorted(p1, p2));
    expect(await ids({ rules: [{ field: 'tagId', op: 'has_any', value: [vip?.id] }] })).toEqual(
      sorted(p3),
    );
    expect(
      await ids({ rules: [{ field: 'tagId', op: 'has_none', value: [vip?.id] }] }),
    ).toHaveLength(3);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(
      new Date(),
    );
    expect(
      await ids({
        rules: [{ field: 'createdAt', op: 'between', value: { from: today, to: today } }],
      }),
    ).toHaveLength(4);
    expect(await ids({ rules: [{ field: 'createdAt', op: 'before', value: today }] })).toEqual([]);

    // Unsupported operators and values are rejected, not ignored.
    expect(
      (
        await call(a.h, 'POST', '/contacts/query', {
          filter: { rules: [{ field: 'name', op: 'in', value: ['x'] }] },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(a.h, 'POST', '/contacts/query', {
          filter: { rules: [{ field: 'statusId', op: 'in', value: ['nope'] }] },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(a.h, 'POST', '/contacts/query', {
          filter: { rules: [{ field: 'name', op: 'contains' }] },
        })
      ).statusCode,
    ).toBe(400);

    // Pages and the total come from the same query; the id breaks ties.
    const page1 = await query(a.h, { pageSize: 3, sort: [{ field: 'name', dir: 'asc' }] });
    const page2 = await query(a.h, { pageSize: 3, page: 2, sort: [{ field: 'name', dir: 'asc' }] });
    expect(page1.total).toBe(4);
    expect(page2.total).toBe(4);
    expect([...page1.data, ...page2.data].map((c) => c.id).sort()).toEqual(sorted(p1, p2, p3, p4));
    expect(page1.data.map((c) => c.name)).toEqual(['BA CRM hai', 'BA CRM một', 'Không số']);
  });

  it('keeps private views private and lets only owners change views (CRM-02 views)', async () => {
    const a = await shop('crm-views@shop.vn');
    const member = await shop('crm-views-member@shop.vn', 'Thành viên');
    await addMember(a.workspaceId, member.userId);
    const asMember = member.in(a.workspaceId);
    const filter = { match: 'all', rules: [{ field: 'name', op: 'contains', value: 'VIP' }] };

    const mine = SavedViewDto.parse(
      (
        await call(a.h, 'POST', '/saved-views', {
          name: 'Khách VIP của tôi',
          filter,
          columns: ['name', 'phone'],
        })
      ).json(),
    );
    expect(mine).toMatchObject({
      visibility: 'private',
      isOwner: true,
      columns: ['name', 'phone'],
    });
    const shared = SavedViewDto.parse(
      (
        await call(a.h, 'POST', '/saved-views', { name: 'Cả shop', visibility: 'shared', filter })
      ).json(),
    );

    const seen = SavedViewList.parse((await call(asMember, 'GET', '/saved-views')).json()).data;
    expect(seen.map((v) => v.id)).toEqual([shared.id]);
    expect(seen[0]?.isOwner).toBe(false);
    expect(
      (await call(asMember, 'PATCH', `/saved-views/${mine.id}`, { name: 'x', expectedVersion: 1 }))
        .statusCode,
    ).toBe(404);
    expect((await call(asMember, 'DELETE', `/saved-views/${mine.id}`)).statusCode).toBe(404);
    expect(
      (
        await call(asMember, 'PATCH', `/saved-views/${shared.id}`, {
          name: 'x',
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(403);

    const renamed = await call(a.h, 'PATCH', `/saved-views/${mine.id}`, {
      name: 'VIP',
      expectedVersion: 1,
    });
    expect(SavedViewDto.parse(renamed.json())).toMatchObject({
      name: 'VIP',
      version: 2,
      columns: ['name', 'phone'],
    });
    expect(
      (await call(a.h, 'PATCH', `/saved-views/${mine.id}`, { name: 'y', expectedVersion: 1 }))
        .statusCode,
    ).toBe(409);
    expect((await call(a.h, 'DELETE', `/saved-views/${mine.id}`)).statusCode).toBe(204);
    expect(
      SavedViewList.parse((await call(a.h, 'GET', '/saved-views')).json()).data.map((v) => v.id),
    ).toEqual([shared.id]);
  });
});
