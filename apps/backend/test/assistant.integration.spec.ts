import {
  AssistantMessageList,
  AssistantThreadDto,
  AssistantThreadList,
  AuthResponse,
  BootstrapResponse,
  CreatedInvitation,
} from '@agent-sales/contracts';
import { createDb, ensureLoginRoles, eq, migrate, schema, withCredentials } from '@agent-sales/db';
import { newId, userId, workspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import { AssistantNotFoundError } from '../src/modules/assistant/domain/assistant.errors.js';
import type { OwnerScope } from '../src/modules/assistant/domain/owner-scope.js';
import {
  ASSISTANT_REPOSITORY,
  type AssistantRepository,
} from '../src/modules/assistant/domain/ports/assistant.repository.js';

/** The owner assistant over HTTP on Postgres: owner-only access and per-owner threads (T-170). */
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
/** A new user with their own business (every signup creates one, under their own account). */
async function user(email: string, name: string) {
  const signup = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      remoteAddress: `10.79.0.${++signups}`,
      payload: {
        name,
        email,
        password: 'a long enough password',
        workspaceName: `Shop ${name}`,
        industry: 'fashion',
      },
    });
  expect(signup.statusCode, signup.body).toBe(201);
  const { accessToken } = AuthResponse.parse(signup.json());
  const authorization = `Bearer ${accessToken}`;
  const boot = BootstrapResponse.parse((await call({ authorization }, 'GET', '/bootstrap')).json());
  const own = boot.memberships[0]?.workspaceId ?? '';
  await owner.db
    .insert(schema.workspaceEntitlementOverrides)
    .values({ workspaceId: own, key: 'members.max', value: 50, reason: 'test' })
    .onConflictDoNothing();
  return {
    userId: boot.user.id,
    ownWorkspace: own,
    auth: { authorization } as Headers,
    h: { authorization, 'x-workspace-id': own } as Headers,
    in: (ws: string): Headers => ({ authorization, 'x-workspace-id': ws }),
  };
}
type User = Awaited<ReturnType<typeof user>>;

/** Owner invites `email` as `role` through the team routes; the invitee accepts. */
async function invite(o: User, invitee: User, email: string, role: string) {
  const inv = await call(o.h, 'POST', '/invitations', { email, role });
  expect(inv.statusCode, inv.body).toBe(201);
  const { token } = CreatedInvitation.parse(inv.json());
  const accepted = await call(invitee.auth, 'POST', '/invitation-links/accept', { token });
  expect(accepted.statusCode, accepted.body).toBe(200);
}

async function accountOf(workspaceId: string): Promise<string> {
  const [row] = await owner.db
    .select({ accountId: schema.workspaces.accountId })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId));
  return row?.accountId ?? '';
}

describe('assistant threads on Postgres', () => {
  it('lets the owner create, list, search and update threads; staff are refused', async () => {
    const lan = await user('lan@assistant.vn', 'Lan');
    const created = await call(lan.h, 'POST', '/assistant/threads', { title: 'Giá áo khoác' });
    expect(created.statusCode, created.body).toBe(201);
    const thread = AssistantThreadDto.parse(created.json());
    expect(thread).toMatchObject({ title: 'Giá áo khoác', pinned: false, archived: false });
    expect(thread.businessId).toBe(lan.ownWorkspace);

    // The system prompt is frozen on the thread with the owner and the account's businesses.
    const [stored] = await owner.db
      .select()
      .from(schema.assistantThreads)
      .where(eq(schema.assistantThreads.id, thread.id));
    expect(stored).toMatchObject({ ownerUserId: lan.userId, promptVersion: 'assistant@1' });
    expect(stored?.systemPrompt).toContain('personal assistant of Lan,');
    expect(stored?.systemPrompt).toContain('- Shop Lan (fashion)');
    expect(stored?.systemPrompt).not.toContain('{{');

    const untitled = AssistantThreadDto.parse(
      (await call(lan.h, 'POST', '/assistant/threads', {})).json(),
    );
    const list = AssistantThreadList.parse((await call(lan.h, 'GET', '/assistant/threads')).json());
    expect(list.data.map((t) => t.id).sort()).toEqual([thread.id, untitled.id].sort());

    // Search by title, accent-insensitive.
    const found = AssistantThreadList.parse(
      (await call(lan.h, 'GET', '/assistant/threads?q=gia%20ao')).json(),
    );
    expect(found.data.map((t) => t.id)).toEqual([thread.id]);

    // Pin and rename: pinned threads come first.
    const patched = await call(lan.h, 'PATCH', `/assistant/threads/${untitled.id}`, {
      title: 'Đơn hàng tuần này',
      pinned: true,
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(AssistantThreadDto.parse(patched.json())).toMatchObject({
      title: 'Đơn hàng tuần này',
      pinned: true,
    });
    const ordered = AssistantThreadList.parse(
      (await call(lan.h, 'GET', '/assistant/threads')).json(),
    );
    expect(ordered.data[0]?.id).toBe(untitled.id);

    // Archived threads leave the default list.
    await call(lan.h, 'PATCH', `/assistant/threads/${thread.id}`, { archived: true });
    const active = AssistantThreadList.parse(
      (await call(lan.h, 'GET', '/assistant/threads')).json(),
    );
    expect(active.data.map((t) => t.id)).toEqual([untitled.id]);
    const archived = AssistantThreadList.parse(
      (await call(lan.h, 'GET', '/assistant/threads?archived=true')).json(),
    );
    expect(archived.data.map((t) => t.id)).toEqual([thread.id]);

    const messages = await call(lan.h, 'GET', `/assistant/threads/${thread.id}/messages`);
    expect(messages.statusCode, messages.body).toBe(200);
    expect(AssistantMessageList.parse(messages.json())).toEqual({ data: [] });

    // A staff member (even an admin of the business) is not the account owner.
    const binh = await user('binh@assistant.vn', 'Binh');
    await invite(lan, binh, 'binh@assistant.vn', 'admin');
    const asBinh = binh.in(lan.ownWorkspace);
    expect((await call(asBinh, 'GET', '/assistant/threads')).statusCode).toBe(403);
    expect((await call(asBinh, 'POST', '/assistant/threads', {})).statusCode).toBe(403);
    expect(
      (await call(asBinh, 'PATCH', `/assistant/threads/${thread.id}`, { pinned: true })).statusCode,
    ).toBe(403);
    expect((await call(asBinh, 'GET', `/assistant/threads/${thread.id}/messages`)).statusCode).toBe(
      403,
    );
  });

  it("never shows one owner's threads to another owner, even of the same account", async () => {
    const an = await user('an@assistant.vn', 'An');
    const thread = AssistantThreadDto.parse(
      (await call(an.h, 'POST', '/assistant/threads', { title: 'Riêng của An' })).json(),
    );

    // An owner of another account, using their own business.
    const mallory = await user('mallory@assistant.vn', 'Mallory');
    expect(
      (await call(mallory.h, 'GET', `/assistant/threads/${thread.id}/messages`)).statusCode,
    ).toBe(404);
    expect(
      (await call(mallory.h, 'PATCH', `/assistant/threads/${thread.id}`, { pinned: true }))
        .statusCode,
    ).toBe(404);
    expect(
      AssistantThreadList.parse((await call(mallory.h, 'GET', '/assistant/threads')).json()).data,
    ).toEqual([]);

    // A second owner of the SAME account (joined the business and made account owner).
    const chi = await user('chi@assistant.vn', 'Chi');
    await invite(an, chi, 'chi@assistant.vn', 'admin');
    await owner.db
      .insert(schema.accountMembers)
      .values({ accountId: await accountOf(an.ownWorkspace), userId: chi.userId, role: 'owner' });
    const asChi = chi.in(an.ownWorkspace);
    expect((await call(asChi, 'GET', '/assistant/threads')).statusCode).toBe(200);
    expect(
      AssistantThreadList.parse((await call(asChi, 'GET', '/assistant/threads')).json()).data,
    ).toEqual([]);
    expect((await call(asChi, 'GET', `/assistant/threads/${thread.id}/messages`)).statusCode).toBe(
      404,
    );
    expect(
      (await call(asChi, 'PATCH', `/assistant/threads/${thread.id}`, { title: 'x' })).statusCode,
    ).toBe(404);

    // An unknown run is 404 too.
    expect(
      (await call(an.h, 'GET', '/assistant/runs/0190a0a0-0000-7000-8000-000000000999')).statusCode,
    ).toBe(404);
  });
});

describe('assistant repository on Postgres', () => {
  const message = (role: 'user' | 'assistant' | 'tool', content: string, runId: string | null) => ({
    id: newId(),
    role,
    content,
    toolCalls: null,
    toolCallId: role === 'tool' ? 'call_1' : null,
    toolName: role === 'tool' ? 'session_search' : null,
    pageContext: null,
    uiActions: role === 'assistant' ? [{ type: 'navigate', to: '/app/products' }] : [],
    runId,
  });

  it('keeps messages, runs and search per owner; other owners can neither read nor write', async () => {
    const repo = app.get<AssistantRepository>(ASSISTANT_REPOSITORY);
    const hoa = await user('hoa@assistant.vn', 'Hoa');
    const accountId = await accountOf(hoa.ownWorkspace);
    const scope: OwnerScope = {
      accountId,
      ownerUserId: userId(hoa.userId),
      businessId: workspaceId(hoa.ownWorkspace),
    };
    const thread = AssistantThreadDto.parse(
      (await call(hoa.h, 'POST', '/assistant/threads', { title: 'Sản phẩm' })).json(),
    );

    const runId = newId();
    expect(
      await repo.startRun(scope, {
        id: runId,
        threadId: thread.id,
        tier: 'pro',
        promptVersion: 'assistant@1',
      }),
    ).toBe('started');
    expect(
      await repo.startRun(scope, {
        id: runId,
        threadId: thread.id,
        tier: 'pro',
        promptVersion: 'assistant@1',
      }),
    ).toBe('duplicate');
    expect(
      await repo.startRun(scope, {
        id: newId(),
        threadId: thread.id,
        tier: 'pro',
        promptVersion: 'assistant@1',
      }),
    ).toBe('busy');

    const appended = await repo.appendMessages(scope, thread.id, [
      message('user', 'Có mấy sản phẩm chưa có ảnh?', runId),
      message('tool', '{"hits":[]}', runId),
      message('assistant', 'Dạ em mở trang Sản phẩm rồi ạ', runId),
    ]);
    expect(appended.map((m) => m.seq)).toEqual([1, 2, 3]);
    await repo.addStep(scope, {
      runId,
      idx: 0,
      kind: 'model_call',
      toolName: null,
      ok: true,
      ms: 12,
      errorCode: null,
    });
    await repo.addStep(scope, {
      runId,
      idx: 1,
      kind: 'tool',
      toolName: 'ui_navigate',
      ok: true,
      ms: 1,
      errorCode: null,
    });
    await repo.finishRun(scope, runId, {
      status: 'done',
      outcome: 'done',
      rounds: 2,
      latencyMs: 40,
    });

    // The HTTP view hides tool rows and returns the run with its steps.
    const visible = AssistantMessageList.parse(
      (await call(hoa.h, 'GET', `/assistant/threads/${thread.id}/messages`)).json(),
    );
    expect(visible.data.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(visible.data[1]?.uiActions).toEqual([{ type: 'navigate', to: '/app/products' }]);
    const run = await call(hoa.h, 'GET', `/assistant/runs/${runId}`);
    expect(run.statusCode, run.body).toBe(200);
    expect(run.json()).toMatchObject({
      id: runId,
      status: 'done',
      rounds: 2,
      steps: [
        { idx: 0, kind: 'model_call' },
        { idx: 1, kind: 'tool', toolName: 'ui_navigate' },
      ],
    });
    // Free once the run finished.
    expect(
      await repo.startRun(scope, {
        id: newId(),
        threadId: thread.id,
        tier: 'pro',
        promptVersion: 'assistant@1',
      }),
    ).toBe('started');

    // Accent-insensitive search over user/assistant rows; thread search by message content.
    const hits = await repo.searchMessages(scope, 'san pham chua co anh', 5);
    expect(hits.map((h) => h.messageId)).toEqual([appended[0]!.id]);
    expect(hits[0]).toMatchObject({ threadTitle: 'Sản phẩm', role: 'user' });
    expect((await repo.searchMessages(scope, 'hits', 5)).length).toBe(0);
    const byContent = AssistantThreadList.parse(
      (await call(hoa.h, 'GET', '/assistant/threads?q=chua%20co%20anh')).json(),
    );
    expect(byContent.data.map((t) => t.id)).toEqual([thread.id]);

    // A second owner of the same account, and an owner of another account.
    const dung = await user('dung@assistant.vn', 'Dung');
    await owner.db
      .insert(schema.accountMembers)
      .values({ accountId, userId: dung.userId, role: 'owner' });
    const sameAccount: OwnerScope = { ...scope, ownerUserId: userId(dung.userId) };
    const otherAccount: OwnerScope = {
      accountId: await accountOf(dung.ownWorkspace),
      ownerUserId: userId(dung.userId),
      businessId: workspaceId(dung.ownWorkspace),
    };
    for (const s of [sameAccount, otherAccount]) {
      expect(await repo.getThread(s, thread.id)).toBeNull();
      expect(await repo.getRun(s, runId)).toBeNull();
      expect(await repo.searchMessages(s, 'san pham', 5)).toEqual([]);
      expect(await repo.updateThread(s, thread.id, { title: 'stolen' })).toBeNull();
      await expect(repo.listMessages(s, thread.id)).rejects.toBeInstanceOf(AssistantNotFoundError);
      await expect(
        repo.appendMessages(s, thread.id, [message('user', 'injected', null)]),
      ).rejects.toBeInstanceOf(AssistantNotFoundError);
      await expect(
        repo.startRun(s, {
          id: newId(),
          threadId: thread.id,
          tier: 'pro',
          promptVersion: 'assistant@1',
        }),
      ).rejects.toBeInstanceOf(AssistantNotFoundError);
      await expect(
        repo.addStep(s, {
          runId,
          idx: 9,
          kind: 'tool',
          toolName: null,
          ok: null,
          ms: null,
          errorCode: null,
        }),
      ).rejects.toBeInstanceOf(AssistantNotFoundError);
      await expect(repo.finishRun(s, runId, { status: 'failed' })).rejects.toBeInstanceOf(
        AssistantNotFoundError,
      );
    }
    expect((await repo.listMessages(scope, thread.id)).map((m) => m.content)).not.toContain(
      'injected',
    );
    expect((await repo.getThread(scope, thread.id))?.title).toBe('Sản phẩm');
    expect((await repo.getRun(scope, runId))?.status).toBe('done');
  });
});
