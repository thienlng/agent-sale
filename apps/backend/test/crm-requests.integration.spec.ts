import { AuthResponse, BootstrapResponse } from '@agent-sales/contracts';
import { createDb, ensureLoginRoles, migrate, schema, withCredentials, eq } from '@agent-sales/db';
import { newId, userId, workspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import { CRM_FACADE, type CrmFacade, websiteLeadName } from '../src/modules/crm/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../src/modules/workspace/api/index.js';
import { signUpVerified } from './support/signup.js';

let pg: TestPostgres, app: NestFastifyApplication, crm: CrmFacade;
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
  crm = app.get<CrmFacade>(CRM_FACADE);
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

let n = 0;
async function owner(industry: string) {
  const i = ++n;
  const r = await signUpVerified(
    app,
    {
      name: 'Test owner',
      email: `request-owner-${i}@example.test`,
      password: 'a long synthetic password',
      workspaceName: 'Synthetic business',
      industry,
    },
    { remoteAddress: `10.79.0.${i}` },
  );
  expect(r.statusCode).toBe(201);
  const auth = AuthResponse.parse(r.json());
  const boot = BootstrapResponse.parse(
    (await call({ authorization: `Bearer ${auth.accessToken}` }, 'GET', '/bootstrap')).json(),
  );
  const ws = boot.memberships[0]?.workspaceId ?? '';
  return {
    userId: auth.user.id,
    ws: workspaceId(ws),
    token: auth.accessToken,
    headers: { authorization: `Bearer ${auth.accessToken}`, 'x-workspace-id': ws } as Headers,
  };
}
type Owner = Awaited<ReturnType<typeof owner>>;
/** `b` joins `a`'s business with `role`; returns b's headers there. */
async function join(a: Owner, b: Owner, role: string): Promise<Headers> {
  await app
    .get<WorkspaceFacade>(WORKSPACE_FACADE)
    .joinMember(a.ws, userId(b.userId), role as 'analyst', {
      seatLimit: null,
      actor: { userId: a.userId, name: 'Test owner' },
    });
  return { authorization: `Bearer ${b.token}`, 'x-workspace-id': a.ws };
}

async function statuses(h: Headers) {
  return (await call(h, 'GET', '/crm/statuses')).json().data as Array<{
    id: string;
    key: string | null;
  }>;
}
async function statusKey(h: Headers, contactId: string): Promise<string | null> {
  const all = await statuses(h);
  const { statusId } = (await call(h, 'GET', `/contacts/${contactId}`)).json();
  return all.find((o) => o.id === statusId)?.key ?? null;
}
async function setStatus(h: Headers, contactId: string, key: string) {
  const id = (await statuses(h)).find((s) => s.key === key)?.id;
  const { version } = (await call(h, 'GET', `/contacts/${contactId}`)).json();
  const r = await call(h, 'PATCH', `/contacts/${contactId}`, {
    statusId: id,
    expectedVersion: version,
  });
  expect(r.statusCode, r.body).toBe(200);
}
async function contact(h: Headers, phone: string, extra: object = {}) {
  const r = await call(h, 'POST', '/contacts', { name: 'Synthetic customer', phone, ...extra });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id as string;
}
const notes = async (h: Headers, id: string) =>
  (await call(h, 'GET', `/contacts/${id}/notes`)).json().data as Array<{
    body: string;
    authorName: string;
  }>;
const requestHistory = async (h: Headers, id: string) =>
  ((await call(h, 'GET', `/contacts/${id}/history`)).json().data as Array<{ type: string }>)
    .map((e) => e.type)
    .filter((t) => t.startsWith('contact.request_'));
const record = (ws: Owner['ws'], kind: string, details: object, preview = false) =>
  crm.recordBotRequest(ws, { kind: kind as 'trial', details, preview });
const contactIdOf = (r: Awaited<ReturnType<CrmFacade['recordBotRequest']>>) =>
  r.outcome === 'recorded' || r.outcome === 'updated' ? r.contactId : '';

/** A YYYY-MM-DD `days` after today in Vietnam. */
const vnDate = (days: number) =>
  new Date(Date.now() + 7 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);

describe('saas requests (ported from saas.integration.spec.ts)', () => {
  it('finds or creates the customer by phone, moves it forward and leaves one note', async () => {
    const a = await owner('saas');
    const details = { name: 'Synthetic lead', phone: '+84 983 456 721', need: 'Quản lý bán hàng' };
    const first = await record(a.ws, 'trial', details);
    expect(first).toEqual({
      outcome: 'recorded',
      contactId: expect.any(String),
      phoneE164: '+84983456721',
      created: true,
      missing: [],
      dateLabel: null,
    });
    const contactId = contactIdOf(first);
    expect(await statusKey(a.headers, contactId)).toBe('requested');
    // A retried call within 24 h is an update that writes nothing new.
    const again = await record(a.ws, 'trial', details);
    expect(again).toMatchObject({ outcome: 'updated', contactId, created: false });
    const list = await notes(a.headers, contactId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      authorName: 'Bot AI',
      body: 'Xin dùng thử (bot ghi nhận)\nTên: Synthetic lead\nNhu cầu: Quản lý bán hàng',
    });
    expect(await requestHistory(a.headers, contactId)).toEqual(['contact.request_recorded']);

    // A paying customer asking for a demo stays paying; the note still lands.
    const paying = await contact(a.headers, '0983456799');
    await setStatus(a.headers, paying, 'paying');
    const demo = await record(a.ws, 'demo', { name: 'Synthetic customer', phone: '0983456799' });
    expect(demo).toMatchObject({ outcome: 'recorded', contactId: paying, created: false });
    expect(await statusKey(a.headers, paying)).toBe('paying');
    expect((await notes(a.headers, paying))[0]?.body).toBe(
      'Xin demo (bot ghi nhận)\nTên: Synthetic customer',
    );
  });

  it('answers invalid arguments instead of throwing, and previews without writing', async () => {
    const a = await owner('saas');
    expect(await record(a.ws, 'demo', { name: 'Lan' })).toEqual({
      outcome: 'invalid',
      problems: ['missing:phone'],
    });
    expect(await record(a.ws, 'demo', { phone: '0983456721' })).toEqual({
      outcome: 'invalid',
      problems: ['missing:name'],
    });
    expect(await record(a.ws, 'demo', { name: 'Lan', phone: '12' })).toEqual({
      outcome: 'invalid',
      problems: ['phone: not a phone number'],
    });
    expect(await record(a.ws, 'trial', { name: 'Lan', phone: '0983456721' }, true)).toEqual({
      outcome: 'preview',
      missing: [],
      dateLabel: null,
    });
    const listed = await call(a.headers, 'POST', '/contacts/query', {});
    expect(listed.json().total).toBe(0);
  });
});

describe('education requests', () => {
  it('merges an update over the earlier details: course and day stay (QA retest M5)', async () => {
    const a = await owner('education');
    const date = vnDate(4);
    const first = await record(a.ws, 'trial', {
      name: 'Chị Thu',
      phone: '0983456790',
      course: 'Starters 6-7 tuổi',
      branch: 'online',
      preferredDate: date,
    });
    const id = contactIdOf(first);
    // A new conversation repeats only the name, the phone and what changed.
    const upd = await record(a.ws, 'trial', {
      name: 'Chị Thu',
      phone: '0983456790',
      studentAge: '7',
    });
    expect(upd).toMatchObject({ outcome: 'updated', contactId: id });
    expect(upd.outcome === 'updated' && upd.dateLabel).toMatch(/^(Thứ|Chủ)/);
    const [latest] = (await call(a.headers, 'GET', `/contacts/${id}/requests`)).json().data;
    expect(latest).toMatchObject({
      update: true,
      details: {
        course: 'Starters 6-7 tuổi',
        branch: 'online',
        studentAge: '7',
        preferredDate: date,
      },
    });
    expect(latest.dateLabel).toMatch(/^(Thứ|Chủ)/);
    expect((await notes(a.headers, id))[0]?.body).toContain('Starters 6-7 tuổi');

    // A new time replaces the old day and time together; the course stays.
    await record(a.ws, 'trial', {
      name: 'Chị Thu',
      phone: '0983456790',
      preferredTime: 'sáng chủ nhật',
    });
    const [moved] = (await call(a.headers, 'GET', `/contacts/${id}/requests`)).json().data;
    expect(moved.details).toMatchObject({
      course: 'Starters 6-7 tuổi',
      preferredTime: 'sáng chủ nhật',
    });
    expect(moved.details).not.toHaveProperty('preferredDate');
    expect(moved.dateLabel).toBeNull();
  });

  it('records a placement test, updates it within 24 h and keeps confirmed statuses', async () => {
    const a = await owner('education');
    const res = await record(a.ws, 'placement_test', {
      name: 'Chị Hoa',
      phone: '0983456701',
      course: 'IELTS',
    });
    expect(res).toMatchObject({
      outcome: 'recorded',
      created: true,
      missing: ['studentAge', 'branch', 'preferredTime'],
      dateLabel: null,
    });
    const id = contactIdOf(res);
    expect(await statusKey(a.headers, id)).toBe('test_requested');
    expect(await requestHistory(a.headers, id)).toEqual(['contact.request_recorded']);
    expect(await notes(a.headers, id)).toHaveLength(1);

    // The customer adds details: an update with its own entry and note.
    const date = vnDate(3);
    const upd = await record(a.ws, 'placement_test', {
      name: 'Chị Hoa',
      phone: '0983456701',
      course: 'IELTS',
      studentAge: '15',
      branch: 'online',
      preferredDate: date,
    });
    expect(upd).toMatchObject({ outcome: 'updated', contactId: id, created: false, missing: [] });
    expect(upd.outcome === 'updated' && upd.dateLabel).toMatch(/^(Thứ|Chủ)/);
    expect(await requestHistory(a.headers, id)).toEqual([
      'contact.request_updated',
      'contact.request_recorded',
    ]);
    // The update rewrites the bot's own note of this request instead of adding one (LM-4); the
    // history keeps both versions.
    const list = await notes(a.headers, id);
    expect(list).toHaveLength(1);
    expect(list[0]?.body.startsWith('Cập nhật: Đăng ký kiểm tra trình độ (bot ghi nhận)')).toBe(
      true,
    );

    // One card per request: the update is folded into it, with its first time (LM-4).
    const requests = (await call(a.headers, 'GET', `/contacts/${id}/requests`)).json().data;
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      contactId: id,
      kind: 'placement_test',
      update: true,
      updates: 1,
      firstRecordedAt: expect.any(String),
      details: { name: 'Chị Hoa', course: 'IELTS', studentAge: '15', branch: 'online' },
    });
    expect(requests[0].details).not.toHaveProperty('phone');

    // An enrolled student stays enrolled; a lost one comes back to test_requested.
    const enrolled = await contact(a.headers, '0983456702');
    await setStatus(a.headers, enrolled, 'enrolled');
    await record(a.ws, 'trial', { name: 'Anh Nam', phone: '0983456702' });
    expect(await statusKey(a.headers, enrolled)).toBe('enrolled');
    const lost = await contact(a.headers, '0983456703');
    await setStatus(a.headers, lost, 'lost');
    await record(a.ws, 'trial', { name: 'Anh Tú', phone: '0983456703' });
    expect(await statusKey(a.headers, lost)).toBe('test_requested');

    // An entry older than 24 h makes the next one a new request.
    const { db, close } = createDb({ url: pg.ownerUrl, max: 1 });
    try {
      await db
        .update(schema.contactHistory)
        .set({ createdAt: new Date(Date.now() - 25 * 3_600_000) })
        .where(eq(schema.contactHistory.contactId, lost));
    } finally {
      await close();
    }
    expect(
      await record(a.ws, 'trial', { name: 'Anh Tú', phone: '0983456703', goal: 'giao tiếp' }),
    ).toMatchObject({ outcome: 'recorded' });

    expect(await record(a.ws, 'appointment', { name: 'X', phone: '0983456704' })).toEqual({
      outcome: 'invalid',
      problems: ['kind_not_offered'],
    });
  });

  it('fills an empty course from a goal that names a seen catalog course (T-187)', async () => {
    const a = await owner('education');
    const res = await crm.recordBotRequest(a.ws, {
      kind: 'trial',
      details: { name: 'Chị Mai', phone: '0983456709', goal: 'Cho bé học khoá Starters' },
      preview: false,
      catalogNames: ['Khóa học Starters', 'Khóa học Movers'],
    });
    const id = contactIdOf(res);
    const [request] = (await call(a.headers, 'GET', `/contacts/${id}/requests`)).json().data;
    expect(request.details).toMatchObject({
      course: 'Khóa học Starters',
      goal: 'Cho bé học khoá Starters',
    });
  });

  it('starts a website lead at the new status and folds its rename into one entry (QA B5, B8)', async () => {
    const a = await owner('spa');
    const phone = '+84983456711';
    const { contactId } = await crm.upsertLeadByPhone(a.ws, {
      phoneE164: phone,
      sourceKey: 'website',
      displayName: websiteLeadName(phone),
      firstUrl: 'https://spa.example.vn/dat-lich',
    });
    expect(await statusKey(a.headers, contactId)).toBe('new_lead');
    const res = await record(a.ws, 'appointment', {
      name: 'Chị Lan',
      phone,
      service: 'Gội đầu dưỡng sinh',
      preferredTime: 'chiều thứ Bảy',
    });
    expect(contactIdOf(res)).toBe(contactId);
    const history = (await call(a.headers, 'GET', `/contacts/${contactId}/history`)).json()
      .data as Array<{ type: string; changes: Record<string, unknown> }>;
    const updates = history.filter((e) => e.type === 'contact.updated');
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0]!.changes).sort()).toEqual(['lead', 'name']);
    expect(await statusKey(a.headers, contactId)).toBe('booking_requested');
  });

  it('skips a retried call even when staff wrote a note in between (review minor 2)', async () => {
    const a = await owner('spa');
    const details = {
      name: 'Chị Ngọc',
      phone: '0983456712',
      service: 'Massage body đá nóng',
      preferredTime: 'sáng mai',
    };
    const id = contactIdOf(await record(a.ws, 'appointment', details));
    const note = await call(a.headers, 'POST', `/contacts/${id}/notes`, {
      body: 'Đã gọi, chưa nghe máy',
    });
    expect(note.statusCode, note.body).toBe(201);
    await record(a.ws, 'appointment', details);
    expect(await requestHistory(a.headers, id)).toEqual(['contact.request_recorded']);
    expect(await notes(a.headers, id)).toHaveLength(2);
    // A real change is still an update.
    await record(a.ws, 'appointment', { ...details, preferredTime: 'chiều mai' });
    expect(await requestHistory(a.headers, id)).toEqual([
      'contact.request_updated',
      'contact.request_recorded',
    ]);
  });

  it('counts only the asked request kinds for a bookings alert (QA B7)', async () => {
    const a = await owner('spa');
    await record(a.ws, 'appointment', {
      name: 'Chị A',
      phone: '0983456713',
      service: 'Gội đầu',
      preferredTime: 'tối nay',
    });
    await record(a.ws, 'consultation', { name: 'Chị B', phone: '0983456714' });
    const since = new Date(Date.now() - 60_000);
    const until = new Date(Date.now() + 60_000);
    expect((await crm.requestsRecorded(a.ws, { since, until })).count).toBe(2);
    const bookings = await crm.requestsRecorded(a.ws, { since, until, kinds: ['appointment'] });
    expect(bookings).toMatchObject({ count: 1, byKind: [{ kind: 'appointment', count: 1 }] });
  });

  it('summarises customers per status and the open requests', async () => {
    const a = await owner('education');
    const open = contactIdOf(
      await record(a.ws, 'placement_test', { name: 'Open', phone: '0983456711' }),
    );
    const moved = contactIdOf(await record(a.ws, 'trial', { name: 'Moved', phone: '0983456712' }));
    await setStatus(a.headers, moved, 'test_scheduled');
    // An update is not a new request.
    await record(a.ws, 'placement_test', { name: 'Open', phone: '0983456711', goal: 'IELTS 6.5' });

    const r = await call(a.headers, 'GET', '/crm/requests/summary');
    expect(r.statusCode, r.body).toBe(200);
    const summary = r.json();
    const count = (key: string) =>
      summary.statuses.find((s: { key: string }) => s.key === key)?.count;
    expect(count('test_requested')).toBe(1);
    expect(count('test_scheduled')).toBe(1);
    expect(count('enrolled')).toBe(0);
    expect(summary.open).toEqual([
      expect.objectContaining({
        contactId: open,
        contactName: 'Open',
        statusKey: 'test_requested',
        update: true,
      }),
    ]);
    expect(summary.recorded7d).toBe(2);

    const since = new Date(Date.now() - 3_600_000);
    const until = new Date(Date.now() + 3_600_000);
    expect(await crm.requestsRecorded(a.ws, { since, until })).toEqual({
      count: 2,
      byKind: expect.arrayContaining([
        { kind: 'placement_test', count: 1 },
        { kind: 'trial', count: 1 },
      ]),
      byStatus: expect.arrayContaining([
        { key: 'test_requested', name: 'Đăng ký test / học thử', count: 1 },
        { key: 'test_scheduled', name: 'Đã hẹn test / học thử', count: 1 },
      ]),
    });
  });
});

describe('spa requests', () => {
  it('requires a day or time, refuses a past date and moves per the spa rules', async () => {
    const a = await owner('spa');
    const base = { name: 'Chị Mai', phone: '0983456721', service: 'Chăm sóc da' };
    expect(await record(a.ws, 'appointment', base)).toEqual({
      outcome: 'invalid',
      problems: ['missing:preferredDate'],
    });
    expect(await record(a.ws, 'appointment', { ...base, preferredDate: '2020-01-01' })).toEqual({
      outcome: 'invalid',
      problems: ['past_date'],
    });
    // Preview validates and writes nothing.
    const date = vnDate(2);
    const preview = await record(a.ws, 'appointment', { ...base, preferredDate: date }, true);
    expect(preview).toMatchObject({ outcome: 'preview', missing: ['branch', 'preferredTime'] });
    expect((await call(a.headers, 'POST', '/contacts/query', {})).json().total).toBe(0);

    const res = await record(a.ws, 'appointment', { ...base, preferredTime: '2h chiều' });
    expect(res).toMatchObject({ outcome: 'recorded', missing: ['branch'] });
    expect(await statusKey(a.headers, contactIdOf(res))).toBe('booking_requested');

    const visited = await contact(a.headers, '0983456722');
    await setStatus(a.headers, visited, 'visited');
    await record(a.ws, 'appointment', { ...base, phone: '0983456722', preferredTime: 'tối' });
    expect(await statusKey(a.headers, visited)).toBe('booking_requested');
    const booked = await contact(a.headers, '0983456723');
    await setStatus(a.headers, booked, 'booked');
    await record(a.ws, 'appointment', { ...base, phone: '0983456723', preferredTime: 'tối' });
    expect(await statusKey(a.headers, booked)).toBe('booked');

    expect(await record(a.ws, 'placement_test', base)).toEqual({
      outcome: 'invalid',
      problems: ['kind_not_offered'],
    });
  });
});

describe('request tasks and reschedules (MS-10, MS-21)', () => {
  const tasks = async (h: Headers, contactId: string) =>
    (await call(h, 'GET', `/tasks?scope=all&status=open&contactId=${contactId}`)).json()
      .data as Array<{
      id: string;
      title: string;
      note: string | null;
      source: string;
      dueAt: string | null;
      conversationId: string | null;
    }>;

  it('opens one confirmation task per request, due at the slot, linked to the conversation (LM2-8)', async () => {
    const a = await owner('spa');
    const base = { name: 'Chị Thư', phone: '0987654321', service: 'Phun mày' };
    const conversationId = newId();
    const res = await crm.recordBotRequest(a.ws, {
      kind: 'appointment',
      details: { ...base, preferredDate: vnDate(4), preferredTime: '9h' },
      preview: false,
      conversationId,
    });
    const id = contactIdOf(res);
    const [task, ...more] = await tasks(a.headers, id);
    expect(more).toEqual([]);
    expect(task).toMatchObject({ source: 'bot', conversationId });
    expect(task?.title).toMatch(/^Xác nhận – Đặt lịch: Chị Thư – (Thứ|Chủ).* 9h$/);
    // Due at the slot (09:00 in Vietnam), never overdue at creation.
    expect(task?.dueAt).toBe(new Date(`${vnDate(4)}T02:00:00.000Z`).toISOString());
    // An update of a request not confirmed yet: same task, new slot, the earlier one kept.
    await record(a.ws, 'appointment', {
      ...base,
      preferredDate: vnDate(4),
      preferredTime: '4h chiều',
    });
    const after = await tasks(a.headers, id);
    expect(after).toHaveLength(1);
    expect(after[0]?.title).toMatch(/4h chiều$/);
    expect(after[0]?.dueAt).toBe(new Date(`${vnDate(4)}T09:00:00.000Z`).toISOString());
    expect(after[0]?.note).toMatch(/\nTrước: Chị Thư – .* 9h$/);
    expect(await statusKey(a.headers, id)).toBe('booking_requested');
  });

  it('is due at the end of today without a day', async () => {
    const a = await owner('spa');
    const res = await record(a.ws, 'appointment', {
      name: 'Chị Lan',
      phone: '0987654323',
      service: 'Phun mày',
      preferredTime: 'chiều nay',
    });
    const [task] = await tasks(a.headers, contactIdOf(res));
    const due = Date.parse(task?.dueAt ?? '');
    expect(due).toBeGreaterThan(Date.now());
    expect(due - Date.now()).toBeLessThanOrEqual(24 * 3_600_000);
  });

  it('sends a confirmed appointment back to "requested" with a "Khách đổi lịch" task when the slot moves', async () => {
    const a = await owner('spa');
    const base = { name: 'Chị Thư', phone: '0987654322', service: 'Phun mày' };
    const first = await record(a.ws, 'appointment', { ...base, preferredDate: vnDate(4) });
    const id = contactIdOf(first);
    // Confirming the slot completes the "Xác nhận" task (MS2-8).
    expect(await tasks(a.headers, id)).toHaveLength(1);
    expect(await crm.requestStatus(a.ws, id)).toMatchObject({ confirmed: false });
    await setStatus(a.headers, id, 'booked');
    expect(await tasks(a.headers, id)).toEqual([]);
    // The bot is told the appointment is confirmed (MS2-7).
    expect(await crm.requestStatus(a.ws, id)).toMatchObject({
      kind: 'appointment',
      kindLabel: 'Đặt lịch',
      confirmed: true,
      statusName: 'Đã xác nhận lịch',
    });
    // Same request, same slot (a retried call): stays confirmed, no task.
    await record(a.ws, 'appointment', { ...base, preferredDate: vnDate(4) });
    expect(await statusKey(a.headers, id)).toBe('booked');
    // The customer moves the day: back to requested, a reschedule task, flagged in the history.
    const moved = await record(a.ws, 'appointment', { ...base, preferredDate: vnDate(5) });
    expect(moved).toMatchObject({ outcome: 'updated' });
    expect(await statusKey(a.headers, id)).toBe('booking_requested');
    const open = await tasks(a.headers, id);
    expect(open).toHaveLength(1);
    expect(open[0]?.title).toMatch(/^Khách đổi lịch – Đặt lịch: Chị Thư – /);
  });
});

describe('request source (MS-11)', () => {
  it('gives a customer created by a website request the Website source and returns its phone', async () => {
    const a = await owner('spa');
    const res = await crm.recordBotRequest(a.ws, {
      kind: 'appointment',
      details: {
        name: 'Chị Thư',
        phone: '0987654321',
        service: 'Phun mày',
        preferredDate: vnDate(3),
      },
      preview: false,
      channel: 'website',
    });
    expect(res).toMatchObject({ outcome: 'recorded', created: true, phoneE164: '+84987654321' });
    const { sourceId } = (await call(a.headers, 'GET', `/contacts/${contactIdOf(res)}`)).json();
    const sources = (await call(a.headers, 'GET', '/crm/sources')).json().data as Array<{
      id: string;
      key: string | null;
    }>;
    expect(sources.find((o) => o.id === sourceId)?.key).toBe('website');
  });
});

describe('request phones (LM2-7)', () => {
  it('records a request left with a Vietnamese landline', async () => {
    const a = await owner('education');
    const res = await record(a.ws, 'consultation', { name: 'Anh Tùng', phone: '0243 999 8888' });
    expect(res).toMatchObject({ outcome: 'recorded', phoneE164: '+842439998888' });
  });
});

describe('request access', () => {
  it('offers nothing to a retail business: no tool kind and a 404 summary', async () => {
    const a = await owner('fashion');
    expect(await record(a.ws, 'demo', { name: 'Lan', phone: '0983456721' })).toEqual({
      outcome: 'invalid',
      problems: ['kind_not_offered'],
    });
    expect((await call(a.headers, 'GET', '/crm/requests/summary')).statusCode).toBe(404);
  });

  it('keeps requests inside the business and the visibility of the customer', async () => {
    const a = await owner('spa');
    const b = await owner('spa');
    const res = await record(a.ws, 'consultation', { name: 'Chị A', phone: '0983456731' });
    const id = contactIdOf(res);
    expect((await call(a.headers, 'GET', `/contacts/${id}/requests`)).json().data).toHaveLength(1);

    // Business B sees none of A's requests through either route.
    expect((await call(b.headers, 'GET', `/contacts/${id}/requests`)).statusCode).toBe(404);
    const bSummary = (await call(b.headers, 'GET', '/crm/requests/summary')).json();
    expect(bSummary.open).toEqual([]);
    expect(bSummary.recorded7d).toBe(0);
    expect(bSummary.statuses.reduce((s: number, x: { count: number }) => s + x.count, 0)).toBe(0);

    // A Sales member: no summary (contacts.view_all), and a customer owned by someone else is 404.
    const seller = await owner('fashion');
    const sales = await join(a, seller, 'sales');
    expect((await call(sales, 'GET', '/crm/requests/summary')).statusCode).toBe(403);
    expect((await call(sales, 'GET', `/contacts/${id}/requests`)).statusCode).toBe(200);
    const owned = await contact(a.headers, '0983456732', { salesUserId: a.userId });
    await record(a.ws, 'consultation', { name: 'Chị B', phone: '0983456732' });
    expect((await call(sales, 'GET', `/contacts/${owned}/requests`)).statusCode).toBe(404);
    expect((await call(a.headers, 'GET', `/contacts/${owned}/requests`)).statusCode).toBe(200);
  });
});
