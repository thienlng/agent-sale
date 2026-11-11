import {
  AuthResponse,
  BootstrapResponse,
  ContactDto,
  TaskDto,
  TaskList,
} from '@agent-sales/contracts';
import {
  and,
  createDb,
  ensureLoginRoles,
  eq,
  migrate,
  schema,
  withCredentials,
} from '@agent-sales/db';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import { CRM_TASK_RUNNER, type CrmTaskRunner } from '../src/modules/crm/api/index.js';
import { signUpVerified } from './support/signup.js';

/** CRM tasks (CRM-04) over HTTP on a real Postgres: visibility, versions, due reminders. */
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

type Method = 'GET' | 'POST' | 'PATCH';
type Headers = Record<string, string>;
const call = (h: Headers, method: Method, url: string, payload?: object) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({ method, url: `/api/v1${url}`, headers: h, ...(payload ? { payload } : {}) });

let signups = 0;
async function shop(email: string, name: string) {
  const signup = await signUpVerified(
    app,
    { name, email, password: 'a long enough password', workspaceName: 'Shop', industry: 'fashion' },
    { remoteAddress: `10.3.0.${++signups}` },
  );
  const { accessToken } = AuthResponse.parse(signup.json());
  const authorization = `Bearer ${accessToken}`;
  const boot = BootstrapResponse.parse((await call({ authorization }, 'GET', '/bootstrap')).json());
  const workspaceId = boot.memberships[0]?.workspaceId ?? '';
  return {
    userId: boot.user.id,
    workspaceId,
    h: { authorization, 'x-workspace-id': workspaceId } as Headers,
    in: (ws: string): Headers => ({ authorization, 'x-workspace-id': ws }),
  };
}

async function addMember(workspaceId: string, userId: string, role = 'sales') {
  await owner.db
    .insert(schema.members)
    .values({ id: crypto.randomUUID(), workspaceId, userId, role, status: 'active' });
}

const create = async (h: Headers, body: object) => {
  const r = await call(h, 'POST', '/tasks', body);
  expect(r.statusCode, r.body).toBe(201);
  return TaskDto.parse(r.json());
};
const list = async (h: Headers, q = '') => {
  const r = await call(h, 'GET', `/tasks${q}`);
  expect(r.statusCode, r.body).toBe(200);
  return TaskList.parse(r.json());
};
const ids = (l: TaskList) => l.data.map((t) => t.id);

describe('crm tasks on Postgres', () => {
  it('creates, lists mine against all, edits with versions and completes idempotently', async () => {
    const a = await shop('tasks-owner@shop.vn', 'Chủ shop Lan');
    const b = await shop('tasks-sales@shop.vn', 'Sales Minh');
    await addMember(a.workspaceId, b.userId);
    const bh = b.in(a.workspaceId);

    const customer = ContactDto.parse(
      (await call(a.h, 'POST', '/contacts', { name: 'Chị B' })).json(),
    );
    const due = new Date(Date.now() + 3_600_000).toISOString();
    const forB = await create(a.h, {
      title: 'Gọi lại chị B',
      dueAt: due,
      assigneeUserId: b.userId,
      contactId: customer.id,
    });
    expect(forB).toMatchObject({
      status: 'open',
      assigneeUserId: b.userId,
      assigneeName: 'Sales Minh',
      contactId: customer.id,
      source: 'manual',
      version: 1,
      dueAt: due,
    });
    const forA = await create(a.h, { title: 'Gửi báo giá', assigneeUserId: a.userId });
    const unassigned = await create(bh, { title: 'Chuẩn bị quà', source: 'today' });
    expect(unassigned).toMatchObject({ assigneeUserId: null, assigneeName: null, source: 'today' });

    // Mine = assigned to me and unassigned; all = everyone's (contacts.view_all).
    expect(ids(await list(a.h)).sort()).toEqual([forA.id, unassigned.id].sort());
    expect(ids(await list(a.h, '?scope=all')).sort()).toEqual(
      [forA.id, forB.id, unassigned.id].sort(),
    );
    expect(ids(await list(bh)).sort()).toEqual([forB.id, unassigned.id].sort());
    // Open first by due time: the dated task leads.
    expect(ids(await list(bh))[0]).toBe(forB.id);
    expect(ids(await list(a.h, `?scope=all&contactId=${customer.id}`))).toEqual([forB.id]);

    // Paging.
    const page1 = await list(a.h, '?scope=all&limit=2');
    expect(page1.data).toHaveLength(2);
    expect(page1.page.nextCursor).not.toBeNull();
    const page2 = await list(a.h, `?scope=all&limit=2&cursor=${page1.page.nextCursor}`);
    expect(page2.data).toHaveLength(1);
    expect(page2.page.nextCursor).toBeNull();

    // Version-checked edits.
    const edited = await call(a.h, 'PATCH', `/tasks/${forA.id}`, {
      title: 'Gửi báo giá mới',
      version: 1,
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(TaskDto.parse(edited.json())).toMatchObject({ title: 'Gửi báo giá mới', version: 2 });
    const stale = await call(a.h, 'PATCH', `/tasks/${forA.id}`, { title: 'x', version: 1 });
    expect(stale.statusCode).toBe(409);
    const assignBad = await call(a.h, 'PATCH', `/tasks/${forA.id}`, {
      assigneeUserId: crypto.randomUUID(),
      version: 2,
    });
    expect(assignBad.statusCode).toBe(400);

    // Complete twice: same answer, one version step.
    const done = await call(bh, 'POST', `/tasks/${forB.id}/complete`);
    expect(done.statusCode, done.body).toBe(200);
    const doneTask = TaskDto.parse(done.json());
    expect(doneTask).toMatchObject({ status: 'done', version: 2 });
    expect(doneTask.doneAt).not.toBeNull();
    const again = TaskDto.parse((await call(bh, 'POST', `/tasks/${forB.id}/complete`)).json());
    expect(again).toEqual(doneTask);
    expect((await call(bh, 'POST', `/tasks/${forB.id}/cancel`)).statusCode).toBe(409);
    expect(ids(await list(bh, '?status=done'))).toEqual([forB.id]);
    expect(ids(await list(bh, '?status=open'))).toEqual([unassigned.id]);

    // Cancel is idempotent too.
    const cancelled = await call(a.h, 'POST', `/tasks/${unassigned.id}/cancel`);
    expect(TaskDto.parse(cancelled.json())).toMatchObject({ status: 'cancelled', version: 2 });
    expect((await call(a.h, 'POST', `/tasks/${unassigned.id}/cancel`)).statusCode).toBe(200);
  });

  it("a sales member cannot see or touch another member's task", async () => {
    const a = await shop('tasks-owner2@shop.vn', 'Chủ shop Hoa');
    const b = await shop('tasks-sales2@shop.vn', 'Sales Nam');
    await addMember(a.workspaceId, b.userId);
    const bh = b.in(a.workspaceId);
    const ownerTask = await create(a.h, { title: 'Việc của chủ', assigneeUserId: a.userId });

    expect(ids(await list(bh))).not.toContain(ownerTask.id);
    expect((await call(bh, 'GET', '/tasks?scope=all')).statusCode).toBe(403);
    expect((await call(bh, 'POST', `/tasks/${ownerTask.id}/complete`)).statusCode).toBe(404);
    expect((await call(bh, 'POST', `/tasks/${ownerTask.id}/cancel`)).statusCode).toBe(404);
    expect(
      (await call(bh, 'PATCH', `/tasks/${ownerTask.id}`, { title: 'x', version: 1 })).statusCode,
    ).toBe(404);

    // Another business never sees it either (RLS).
    expect((await call(b.h, 'POST', `/tasks/${ownerTask.id}/complete`)).statusCode).toBe(404);
    // A customer of another business cannot be linked.
    const foreign = ContactDto.parse((await call(b.h, 'POST', '/contacts', { name: 'X' })).json());
    expect(
      (await call(a.h, 'POST', '/tasks', { title: 'x', contactId: foreign.id })).statusCode,
    ).toBe(404);
  });

  it('a removed assignee leaves the task with no assignee name', async () => {
    const a = await shop('tasks-owner3@shop.vn', 'Chủ shop Mai');
    const b = await shop('tasks-sales3@shop.vn', 'Sales Tú');
    await addMember(a.workspaceId, b.userId);
    const t = await create(a.h, { title: 'Hỏi lại size', assigneeUserId: b.userId });
    await owner.db
      .update(schema.members)
      .set({ status: 'removed' })
      .where(
        and(eq(schema.members.userId, b.userId), eq(schema.members.workspaceId, a.workspaceId)),
      );
    const [row] = (await list(a.h, '?scope=all')).data.filter((x) => x.id === t.id);
    expect(row).toMatchObject({ assigneeUserId: b.userId, assigneeName: null });
  });

  it('reminds the assignee of a due task once (in-app row, task.due)', async () => {
    const a = await shop('tasks-owner4@shop.vn', 'Chủ shop Đào');
    const t = await create(a.h, {
      title: 'Gọi lại khách',
      assigneeUserId: a.userId,
      dueAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const runner = app.get<CrmTaskRunner>(CRM_TASK_RUNNER, { strict: false });
    expect(await runner.tick()).toBeGreaterThanOrEqual(1);
    expect(await runner.tick()).toBe(0);
    const rows = await owner.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.type, 'task.due'));
    const mine = rows.filter((r) => r.dedupKey?.startsWith(`task:${t.id}:due`));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ type: 'task.due', userId: a.userId });
    const [task] = await owner.db.select().from(schema.tasks).where(eq(schema.tasks.id, t.id));
    expect(task?.remindedAt).not.toBeNull();
  });

  it('reminds again after the due time or the assignee changes', async () => {
    const a = await shop('tasks-owner5@shop.vn', 'Chủ shop Cúc');
    const b = await shop('tasks-sales5@shop.vn', 'Sales Hà');
    await addMember(a.workspaceId, b.userId);
    const t = await create(a.h, {
      title: 'Gửi lại báo giá',
      assigneeUserId: a.userId,
      dueAt: new Date(Date.now() - 120_000).toISOString(),
    });
    const runner = app.get<CrmTaskRunner>(CRM_TASK_RUNNER, { strict: false });
    await runner.tick();
    const reminded = async () =>
      (await owner.db.select().from(schema.tasks).where(eq(schema.tasks.id, t.id)))[0]?.remindedAt;
    const notices = async (userId: string) =>
      (
        await owner.db
          .select()
          .from(schema.notifications)
          .where(eq(schema.notifications.userId, userId))
      ).filter((r) => r.dedupKey?.startsWith(`task:${t.id}:due`));
    expect(await reminded()).not.toBeNull();
    expect(await notices(a.userId)).toHaveLength(1);

    // A title edit keeps the reminder done.
    const v2 = await call(a.h, 'PATCH', `/tasks/${t.id}`, { title: 'Gửi báo giá', version: 1 });
    expect(v2.statusCode, v2.body).toBe(200);
    expect(await reminded()).not.toBeNull();

    // A new due time (passed again) reminds the assignee once more.
    const moved = await call(a.h, 'PATCH', `/tasks/${t.id}`, {
      dueAt: new Date(Date.now() - 60_000).toISOString(),
      version: 2,
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(await reminded()).toBeNull();
    await runner.tick();
    expect(await notices(a.userId)).toHaveLength(2);

    // A new assignee is reminded too.
    const handed = await call(a.h, 'PATCH', `/tasks/${t.id}`, {
      assigneeUserId: b.userId,
      version: 3,
    });
    expect(handed.statusCode, handed.body).toBe(200);
    expect(await reminded()).toBeNull();
    await runner.tick();
    expect(await notices(b.userId)).toHaveLength(1);
  });

  it("does not show sales an unassigned task of another rep's customer", async () => {
    const a = await shop('tasks-owner6@shop.vn', 'Chủ shop Lê');
    const b = await shop('tasks-sales6@shop.vn', 'Sales Bình');
    const c = await shop('tasks-sales7@shop.vn', 'Sales Chi');
    await addMember(a.workspaceId, b.userId);
    await addMember(a.workspaceId, c.userId);
    const bh = b.in(a.workspaceId);
    const contact = async (body: object) => {
      const r = await call(a.h, 'POST', '/contacts', body);
      expect(r.statusCode, r.body).toBe(201);
      return ContactDto.parse(r.json());
    };
    const ofC = await contact({ name: 'Khách của Chi', salesUserId: c.userId });
    const ofB = await contact({ name: 'Khách của Bình', careUserId: b.userId });
    const free = await contact({ name: 'Khách chưa ai nhận' });
    const hidden = await create(a.h, { title: 'Gọi khách của Chi', contactId: ofC.id });
    const own = await create(a.h, { title: 'Gọi khách của Bình', contactId: ofB.id });
    const open = await create(a.h, { title: 'Gọi khách mới', contactId: free.id });
    const plain = await create(a.h, { title: 'Dọn kho' });
    const mineOfC = await create(a.h, {
      title: 'Bình giúp Chi',
      contactId: ofC.id,
      assigneeUserId: b.userId,
    });

    const seen = ids(await list(bh));
    expect(seen.sort()).toEqual([own.id, open.id, plain.id, mineOfC.id].sort());
    expect(seen).not.toContain(hidden.id);
    expect((await call(bh, 'POST', `/tasks/${hidden.id}/complete`)).statusCode).toBe(404);
    // The owner (contacts.view_all) still sees every unassigned task.
    expect(ids(await list(a.h))).toEqual(expect.arrayContaining([hidden.id, own.id, open.id]));
  });
});
