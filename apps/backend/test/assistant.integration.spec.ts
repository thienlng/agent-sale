import {
  PRUNED_TOOL_TEXT,
  type GenerateRequest,
  type GenerateResponse,
} from '@agent-sales/ai-core';
import {
  AssistantMemoryDto,
  AssistantMessageList,
  AssistantProposalDto,
  AssistantProposalList,
  AssistantRunDto,
  AssistantThreadDto,
  AssistantThreadList,
  AuthResponse,
  BootstrapResponse,
  CreatedInvitation,
  ProductListResponse,
  SendAssistantMessageResponse,
} from '@agent-sales/contracts';
import { createDb, ensureLoginRoles, eq, migrate, schema, withCredentials } from '@agent-sales/db';
import { newId, userId, workspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import { AI_LLM_GATEWAY, type LlmGatewayPort } from '../src/modules/ai/api/index.js';
import {
  AssistantNotFoundError,
  AssistantRunIdTakenError,
} from '../src/modules/assistant/domain/assistant.errors.js';
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

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
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
    expect(stored).toMatchObject({ ownerUserId: lan.userId, promptVersion: 'assistant@2' });
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
      businessIds: [workspaceId(hoa.ownWorkspace)],
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
      businessIds: [workspaceId(dung.ownWorkspace)],
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
    // Hoa's run id cannot be reused by another owner of the account, nor by another account
    // (where RLS hides the row and only the primary key collides): 409, never a 500.
    for (const s of [sameAccount, otherAccount]) {
      const own = await repo.createThread(s, {
        id: newId(),
        title: '',
        systemPrompt: 'p',
        promptVersion: 'assistant@1',
      });
      await expect(
        repo.startRun(s, {
          id: runId,
          threadId: own.id,
          tier: 'pro',
          promptVersion: 'assistant@1',
        }),
      ).rejects.toBeInstanceOf(AssistantRunIdTakenError);
    }
    expect((await repo.listMessages(scope, thread.id)).map((m) => m.content)).not.toContain(
      'injected',
    );
    expect((await repo.getThread(scope, thread.id))?.title).toBe('Sản phẩm');
    expect((await repo.getRun(scope, runId))?.status).toBe('done');
  });
});

describe('assistant chat turns on Postgres', () => {
  it('answers the owner, traces the run, replays a retried turn and refuses staff', async () => {
    const tu = await user('tu@assistant.vn', 'Tu');
    const thread = AssistantThreadDto.parse(
      (await call(tu.h, 'POST', '/assistant/threads', {})).json(),
    );
    const turnId = newId();
    const body = {
      turnId,
      text: 'Xin chào em',
      pageContext: { route: '/app/products', targets: ['products.import'] },
    };
    const sent = await call(tu.h, 'POST', `/assistant/threads/${thread.id}/messages`, body);
    expect(sent.statusCode, sent.body).toBe(200);
    const turn = SendAssistantMessageResponse.parse(sent.json());
    // The development fake model answers on the `pro` tier when no route is configured.
    expect(turn.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Xin chào em'],
      ['assistant', 'Dạ em chưa có thông tin này ạ.'],
    ]);
    expect(turn.messages.every((m) => m.runId === turnId)).toBe(true);
    expect(turn.run).toMatchObject({ id: turnId, status: 'done', outcome: 'done', rounds: 1 });

    const run = await call(tu.h, 'GET', `/assistant/runs/${turnId}`);
    expect(run.statusCode, run.body).toBe(200);
    expect(AssistantRunDto.parse(run.json())).toMatchObject({
      status: 'done',
      steps: [{ idx: 0, kind: 'model_call', toolName: null }],
    });
    const [stored] = await owner.db
      .select()
      .from(schema.assistantRuns)
      .where(eq(schema.assistantRuns.id, turnId));
    expect(stored).toMatchObject({ tier: 'pro', promptVersion: 'assistant@2', status: 'done' });
    expect(stored?.finishedAt).toBeInstanceOf(Date);

    // A retried turn returns the first answer; the thread took its title from the first text.
    const again = await call(tu.h, 'POST', `/assistant/threads/${thread.id}/messages`, body);
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toEqual(sent.json());
    const listed = AssistantMessageList.parse(
      (await call(tu.h, 'GET', `/assistant/threads/${thread.id}/messages`)).json(),
    );
    expect(listed.data).toHaveLength(2);
    const threads = AssistantThreadList.parse(
      (await call(tu.h, 'GET', '/assistant/threads')).json(),
    );
    expect(threads.data.find((t) => t.id === thread.id)?.title).toBe('Xin chào em');

    // Busy while another run of the owner is running: 409 assistant_busy.
    const repo = app.get<AssistantRepository>(ASSISTANT_REPOSITORY);
    const scope: OwnerScope = {
      accountId: await accountOf(tu.ownWorkspace),
      ownerUserId: userId(tu.userId),
      businessId: workspaceId(tu.ownWorkspace),
      businessIds: [workspaceId(tu.ownWorkspace)],
    };
    const stuck = newId();
    await repo.startRun(scope, {
      id: stuck,
      threadId: thread.id,
      tier: 'pro',
      promptVersion: 'assistant@1',
    });
    const busy = await call(tu.h, 'POST', `/assistant/threads/${thread.id}/messages`, {
      turnId: newId(),
      text: 'Còn đó không?',
    });
    expect(busy.statusCode, busy.body).toBe(409);
    expect(busy.json().error).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'assistant_busy' },
    });
    await repo.finishRun(scope, stuck, { status: 'failed' });

    // Another account reusing the turn id on its own thread: 409, not a 500.
    const vy = await user('vy@assistant.vn', 'Vy');
    const vyThread = AssistantThreadDto.parse(
      (await call(vy.h, 'POST', '/assistant/threads', {})).json(),
    );
    const reused = await call(vy.h, 'POST', `/assistant/threads/${vyThread.id}/messages`, body);
    expect(reused.statusCode, reused.body).toBe(409);
    expect(
      (
        await call(vy.h, 'POST', `/assistant/threads/${thread.id}/messages`, {
          turnId: newId(),
          text: 'x',
        })
      ).statusCode,
    ).toBe(404);

    // Staff of the business are refused.
    const yen = await user('yen@assistant.vn', 'Yen');
    await invite(tu, yen, 'yen@assistant.vn', 'admin');
    expect(
      (
        await call(yen.in(tu.ownWorkspace), 'POST', `/assistant/threads/${thread.id}/messages`, {
          turnId: newId(),
          text: 'x',
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('assistant memory, proposals and compaction on Postgres (1b)', () => {
  const repo = () => app.get<AssistantRepository>(ASSISTANT_REPOSITORY);
  const message = (role: 'user' | 'assistant' | 'tool', content: string) => ({
    id: newId(),
    role,
    content,
    toolCalls: null,
    toolCallId: role === 'tool' ? 'call_1' : null,
    toolName: role === 'tool' ? 'session_search' : null,
    pageContext: null,
    uiActions: [],
    runId: null,
  });
  const entry = (text: string) => ({
    id: newId(),
    text,
    origin: 'owner' as const,
    createdAt: new Date().toISOString(),
  });
  async function ownerScope(email: string, name: string) {
    const u = await user(email, name);
    const scope: OwnerScope = {
      accountId: await accountOf(u.ownWorkspace),
      ownerUserId: userId(u.userId),
      businessId: workspaceId(u.ownWorkspace),
      businessIds: [workspaceId(u.ownWorkspace)],
    };
    const thread = await repo().createThread(scope, {
      id: newId(),
      title: '',
      systemPrompt: 'p1',
      promptVersion: 'assistant@1',
    });
    return { scope, thread };
  }

  it('upserts memory per owner; another account sees none of it', async () => {
    const a = await ownerScope('mem-a@assistant.vn', 'MemA');
    const b = await ownerScope('mem-b@assistant.vn', 'MemB');
    await repo().saveMemoryStore(a.scope, 'notes', [entry('Thích báo cáo ngắn')]);
    const saved = await repo().saveMemoryStore(a.scope, 'notes', [entry('Báo cáo sáng thứ Hai')]);
    await repo().saveMemoryStore(a.scope, `business:${a.scope.businessId}`, [entry('Thời trang')]);
    await repo().saveMemoryStore(b.scope, 'notes', [entry('B')]);

    expect(saved.entries.map((e) => e.text)).toEqual(['Báo cáo sáng thứ Hai']);
    const mine = await repo().getMemory(a.scope);
    expect(mine.map((m) => m.store)).toEqual([`business:${a.scope.businessId}`, 'notes']);
    expect(mine[1]?.entries[0]).toMatchObject({ text: 'Báo cáo sáng thứ Hai', origin: 'owner' });
    expect((await repo().getMemory(b.scope)).map((m) => m.entries[0]?.text)).toEqual(['B']);
    // Same owner id under the other account: RLS and the explicit filter both hide A's rows.
    expect(await repo().getMemory({ ...b.scope, ownerUserId: a.scope.ownerUserId })).toEqual([]);
    await expect(repo().saveMemoryStore(a.scope, 'secrets', [])).rejects.toThrow();
  });

  it('serves GET and DELETE /assistant/memory to the owner and refuses staff', async () => {
    const ha = await user('mem-http@assistant.vn', 'MemHttp');
    const scope: OwnerScope = {
      accountId: await accountOf(ha.ownWorkspace),
      ownerUserId: userId(ha.userId),
      businessId: workspaceId(ha.ownWorkspace),
      businessIds: [workspaceId(ha.ownWorkspace)],
    };
    const keep = entry('Báo cáo sáng thứ Hai');
    const drop = entry('Thích báo cáo ngắn');
    await repo().saveMemoryStore(scope, 'notes', [drop, keep]);

    const got = await call(ha.h, 'GET', '/assistant/memory');
    expect(got.statusCode, got.body).toBe(200);
    const memory = AssistantMemoryDto.parse(got.json());
    expect(memory.stores.map((st) => [st.store, st.label])).toEqual([
      ['owner_profile', 'owner_profile'],
      ['notes', 'notes'],
      [`business:${ha.ownWorkspace}`, 'Shop MemHttp'],
    ]);
    expect(memory.stores[1]?.entries.map((e) => e.id)).toEqual([drop.id, keep.id]);

    const deleted = await call(ha.h, 'DELETE', `/assistant/memory/notes/entries/${drop.id}`);
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(AssistantMemoryDto.parse(deleted.json()).stores[1]?.entries.map((e) => e.text)).toEqual([
      'Báo cáo sáng thứ Hai',
    ]);
    expect(
      (await call(ha.h, 'DELETE', `/assistant/memory/notes/entries/${drop.id}`)).statusCode,
    ).toBe(404);

    const staff = await user('mem-staff@assistant.vn', 'MemStaff');
    await invite(ha, staff, 'mem-staff@assistant.vn', 'admin');
    const asStaff = staff.in(ha.ownWorkspace);
    expect((await call(asStaff, 'GET', '/assistant/memory')).statusCode).toBe(403);
    expect(
      (await call(asStaff, 'DELETE', `/assistant/memory/notes/entries/${keep.id}`)).statusCode,
    ).toBe(403);
  });

  it('lets exactly one of two concurrent approvals win and expires stale proposals', async () => {
    const { scope, thread } = await ownerScope('prop@assistant.vn', 'Prop');
    const draft = (expiresAt: Date) => ({
      id: newId(),
      threadId: thread.id,
      runId: null,
      businessId: scope.businessId,
      routeKey: 'PATCH /products/{productId}',
      path: '/products/p1',
      query: null,
      body: { price: 120_000 },
      summary: 'Đổi giá áo thun thành 120.000đ',
      preview: { before: { price: 100_000 } },
      expiresAt,
    });
    const p = await repo().createProposal(scope, draft(new Date(Date.now() + 86_400_000)));
    expect(p).toMatchObject({ status: 'pending', body: { price: 120_000 }, errorCode: null });

    const results = await Promise.all([
      repo().transitionProposal(scope, p.id, ['pending'], 'executing'),
      repo().transitionProposal(scope, p.id, ['pending'], 'executing'),
    ]);
    expect(results.filter((x) => x !== null)).toHaveLength(1);
    const decidedAt = new Date();
    expect(
      await repo().transitionProposal(scope, p.id, ['executing'], 'failed', {
        errorCode: 'VALIDATION',
        decidedAt,
      }),
    ).toMatchObject({ status: 'failed', errorCode: 'VALIDATION', decidedAt });

    const stale = await repo().createProposal(scope, draft(new Date(Date.now() - 1000)));
    expect(await repo().expireProposals(scope, new Date())).toBe(1);
    expect((await repo().getProposal(scope, stale.id))?.status).toBe('expired');
    expect((await repo().listProposals(scope, thread.id)).map((x) => x.id)).toEqual([
      p.id,
      stale.id,
    ]);

    const other = await ownerScope('prop-other@assistant.vn', 'PropOther');
    expect(await repo().getProposal(other.scope, p.id)).toBeNull();
    expect(
      await repo().transitionProposal(other.scope, stale.id, ['expired'], 'pending'),
    ).toBeNull();
    await expect(repo().listProposals(other.scope, thread.id)).rejects.toBeInstanceOf(
      AssistantNotFoundError,
    );
    await expect(
      repo().createProposal(other.scope, draft(new Date(Date.now() + 1000))),
    ).rejects.toBeInstanceOf(AssistantNotFoundError);
  });

  it('applies a compaction: the summary sorts before the tail, tool output is pruned', async () => {
    const { scope, thread } = await ownerScope('compact@assistant.vn', 'Compact');
    const rows = await repo().appendMessages(scope, thread.id, [
      message('user', 'head 1'),
      message('assistant', 'head 2'),
      message('user', 'mid 3'),
      message('tool', 'x'.repeat(500)),
      message('assistant', 'mid 5'),
      message('user', 'tail 6'),
      message('tool', 'y'.repeat(500)),
      message('assistant', 'tail 8'),
    ]);
    const id = (i: number) => rows[i]?.id ?? '';
    const summary = await repo().applyCompaction(scope, thread.id, {
      deactivateIds: [id(2), id(3), id(4)],
      prunedToolIds: [id(6)],
      summary: message('user', 'REFERENCE ONLY — tóm tắt'),
      savedPct: 40,
      systemPrompt: 'p2',
    });
    expect(summary).toMatchObject({ seq: 9, isSummary: true });

    const active = await repo().listMessages(scope, thread.id, { activeOnly: true });
    expect(active.map((m) => m.content)).toEqual([
      'head 1',
      'head 2',
      'REFERENCE ONLY — tóm tắt',
      'tail 6',
      PRUNED_TOOL_TEXT,
      'tail 8',
    ]);
    // Compacted rows stay in the thread and in search.
    expect((await repo().listMessages(scope, thread.id)).map((m) => m.seq)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect((await repo().searchMessages(scope, 'mid 3', 5)).map((h) => h.messageId)).toContain(
      id(2),
    );
    expect(await repo().getThread(scope, thread.id)).toMatchObject({
      systemPrompt: 'p2',
      cacheRootId: thread.id,
      compactionSavedPcts: [40],
    });

    // The thread's next message still gets seq = max + 1 and sorts last.
    const [next] = await repo().appendMessages(scope, thread.id, [message('user', 'after')]);
    expect(next?.seq).toBe(10);
    const after = await repo().listMessages(scope, thread.id, { activeOnly: true });
    expect(after.at(-1)?.content).toBe('after');

    await expect(
      repo().applyCompaction(scope, thread.id, {
        deactivateIds: [id(2)],
        prunedToolIds: [],
        summary: message('user', 'stale'),
        savedPct: 1,
        systemPrompt: 'p3',
      }),
    ).rejects.toThrow('stale');
    await repo().applyCompaction(scope, thread.id, {
      deactivateIds: [summary.id, id(5)],
      prunedToolIds: [],
      summary: message('user', 'second'),
      savedPct: 8,
      systemPrompt: 'p3',
    });
    // The second summary folds the first (high seq, low sort_seq) and still sorts before the tail.
    const contents = async () =>
      (await repo().listMessages(scope, thread.id, { activeOnly: true })).map((m) => m.content);
    expect(await contents()).toEqual([
      'head 1',
      'head 2',
      'second',
      PRUNED_TOOL_TEXT,
      'tail 8',
      'after',
    ]);
    await repo().applyCompaction(scope, thread.id, {
      deactivateIds: [id(6)],
      prunedToolIds: [],
      summary: message('user', 'third'),
      savedPct: 9,
      systemPrompt: 'p4',
    });
    expect(await contents()).toEqual(['head 1', 'head 2', 'second', 'third', 'tail 8', 'after']);
    const at = new Date();
    await repo().markCompactionFailed(scope, thread.id, at);
    expect(await repo().getThread(scope, thread.id)).toMatchObject({
      compactionSavedPcts: [8, 9],
      compactionFailedAt: at,
      cacheRootId: thread.id,
    });

    // The trigger reads the last finished chat run; compaction runs are recorded beside it.
    expect(await repo().getLastChatRun(scope, thread.id)).toBeNull();
    const chatRun = newId();
    await repo().startRun(scope, {
      id: chatRun,
      threadId: thread.id,
      tier: 'pro',
      promptVersion: 'assistant@2',
    });
    await repo().finishRun(scope, chatRun, {
      status: 'done',
      inputTokens: 900,
      cachedTokens: 100,
      rounds: 2,
    });
    const compactionRun = newId();
    await repo().recordRun(scope, {
      id: compactionRun,
      threadId: thread.id,
      kind: 'compaction',
      tier: 'basic',
      promptVersion: 'assistant@2',
      status: 'done',
      provider: 'fake',
      model: 'fake-basic',
      inputTokens: 500,
      cachedTokens: 0,
      outputTokens: 80,
      latencyMs: 12,
      rounds: 1,
      outcome: 'done',
      guardrail: null,
    });
    expect(await repo().getLastChatRun(scope, thread.id)).toMatchObject({
      id: chatRun,
      kind: 'chat',
      inputTokens: 900,
      cachedTokens: 100,
      rounds: 2,
    });
    const recorded = await repo().getRun(scope, compactionRun);
    expect(recorded).toMatchObject({ kind: 'compaction', tier: 'basic', status: 'done' });
    expect(recorded?.finishedAt).toBeInstanceOf(Date);

    const other = await ownerScope('compact-other@assistant.vn', 'CompactOther');
    await expect(
      repo().applyCompaction(other.scope, thread.id, {
        deactivateIds: [id(7)],
        prunedToolIds: [],
        summary: message('user', 'x'),
        savedPct: 1,
        systemPrompt: 'stolen',
      }),
    ).rejects.toBeInstanceOf(AssistantNotFoundError);
    await expect(repo().markCompactionFailed(other.scope, thread.id, at)).rejects.toBeInstanceOf(
      AssistantNotFoundError,
    );
    await expect(repo().getLastChatRun(other.scope, thread.id)).rejects.toBeInstanceOf(
      AssistantNotFoundError,
    );
  });
});

describe('assistant route tools and proposals on Postgres (1b)', () => {
  const answer = (over: Partial<GenerateResponse>): GenerateResponse => ({
    text: '',
    toolCalls: [],
    stopReason: 'end',
    usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
    provider: 'fake',
    model: 'fake-pro',
    latencyMs: 1,
    ...over,
  });
  const toolCall = (id: string, input: unknown) =>
    answer({ stopReason: 'tool_use', toolCalls: [{ id, name: 'tool_call', input }] });
  const product = (code: string, name: string) => ({
    code,
    name,
    variants: [{ sku: `${code}-M`, price: 150_000 }],
  });

  /** One turn where the (fake) model answers from `script`, in order. */
  async function turn(u: User, threadId: string, text: string, script: GenerateResponse[]) {
    const gateway = app.get<LlmGatewayPort>(AI_LLM_GATEWAY, { strict: false });
    const queue = [...script];
    const spy = vi
      .spyOn(gateway, 'generate')
      .mockImplementation((_r: GenerateRequest) =>
        Promise.resolve(queue.shift() ?? answer({ text: 'Dạ xong ạ' })),
      );
    try {
      const res = await call(u.h, 'POST', `/assistant/threads/${threadId}/messages`, {
        turnId: newId(),
        text,
        pageContext: { route: '/app/products' },
      });
      expect(res.statusCode, res.body).toBe(200);
      return SendAssistantMessageResponse.parse(res.json());
    } finally {
      spy.mockRestore();
    }
  }

  it('reads through real auth, proposes a write, and runs it only on approval', async () => {
    const mai = await user('route-tools@assistant.vn', 'Mai');
    const created = await call(mai.h, 'POST', '/products', product('AO-1', 'Áo thun trắng'));
    expect(created.statusCode, created.body).toBe(201);
    const thread = AssistantThreadDto.parse(
      (await call(mai.h, 'POST', '/assistant/threads', {})).json(),
    );

    const out = await turn(mai, thread.id, 'Shop có áo gì?', [
      toolCall('c1', { key: 'GET /products', query: { q: 'Áo' } }),
      answer({ text: 'Dạ shop có Áo thun trắng ạ' }),
    ]);
    expect(out.messages.at(-1)?.content).toBe('Dạ shop có Áo thun trắng ạ');
    const repo = app.get<AssistantRepository>(ASSISTANT_REPOSITORY);
    const scope: OwnerScope = {
      accountId: await accountOf(mai.ownWorkspace),
      ownerUserId: userId(mai.userId),
      businessId: workspaceId(mai.ownWorkspace),
      businessIds: [workspaceId(mai.ownWorkspace)],
    };
    const toolRows = (await repo.listMessages(scope, thread.id)).filter((m) => m.role === 'tool');
    expect(toolRows).toHaveLength(1);
    const read = JSON.parse(toolRows[0]?.content ?? '{}') as { status: number; body: unknown };
    expect(read.status).toBe(200);
    expect(ProductListResponse.parse(read.body).data.map((p) => p.name)).toEqual(['Áo thun trắng']);

    // A write only makes a pending proposal; nothing changed yet.
    await turn(mai, thread.id, 'Thêm áo khoác', [
      toolCall('c2', {
        key: 'POST /products',
        body: product('AK-1', 'Áo khoác gió'),
        summary: 'Thêm sản phẩm Áo khoác gió giá 150.000đ',
      }),
      answer({ text: 'Dạ anh/chị bấm Áp dụng giúp em nhé' }),
    ]);
    const listed = await call(mai.h, 'GET', `/assistant/threads/${thread.id}/proposals`);
    expect(listed.statusCode, listed.body).toBe(200);
    const [pending] = AssistantProposalList.parse(listed.json()).items;
    expect(pending).toMatchObject({
      status: 'pending',
      routeKey: 'POST /products',
      businessId: mai.ownWorkspace,
      summary: 'Thêm sản phẩm Áo khoác gió giá 150.000đ',
    });
    const names = async () =>
      ProductListResponse.parse((await call(mai.h, 'GET', '/products')).json()).data.map(
        (p) => p.name,
      );
    expect(await names()).toEqual(['Áo thun trắng']);
    // The bearer token is stored nowhere.
    const [row] = await owner.db
      .select()
      .from(schema.assistantProposals)
      .where(eq(schema.assistantProposals.id, pending?.id ?? ''));
    expect(JSON.stringify(row)).not.toContain(mai.h.authorization?.slice(7) ?? 'x');

    const approved = await call(mai.h, 'POST', `/assistant/proposals/${pending?.id}/approve`);
    expect(approved.statusCode, approved.body).toBe(200);
    expect(AssistantProposalDto.parse(approved.json())).toMatchObject({
      status: 'done',
      errorCode: null,
    });
    expect((await names()).sort()).toEqual(['Áo khoác gió', 'Áo thun trắng']);
    const again = await call(mai.h, 'POST', `/assistant/proposals/${pending?.id}/approve`);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toMatchObject({ details: { reason: 'proposal_not_pending' } });
    const visible = AssistantMessageList.parse(
      (await call(mai.h, 'GET', `/assistant/threads/${thread.id}/messages`)).json(),
    );
    expect(visible.data.at(-1)).toMatchObject({
      role: 'event',
      content: 'Đã áp dụng: Thêm sản phẩm Áo khoác gió giá 150.000đ',
    });
  });

  it('runs an approved proposal on its own business, not on the business the request names', async () => {
    const vy = await user('route-two-shops@assistant.vn', 'Vy');
    const second = await call(vy.auth, 'POST', '/workspaces', {
      name: 'Shop Vy thứ hai',
      industry: 'fashion',
    });
    expect(second.statusCode, second.body).toBe(201);
    const shopB = (second.json() as { id: string }).id;
    expect(await accountOf(shopB)).toBe(await accountOf(vy.ownWorkspace));

    // The thread and both requests below name business A; the proposal is for business B.
    const thread = AssistantThreadDto.parse(
      (await call(vy.h, 'POST', '/assistant/threads', {})).json(),
    );
    const proposeIn = async (code: string, name: string) => {
      await turn(vy, thread.id, `Thêm ${name} cho shop thứ hai`, [
        toolCall(`c-${code}`, {
          key: 'POST /products',
          businessId: shopB,
          body: product(code, name),
          summary: `Thêm ${name} vào Shop Vy thứ hai`,
        }),
        answer({ text: 'Dạ anh/chị bấm Áp dụng giúp em nhé' }),
      ]);
      const items = AssistantProposalList.parse(
        (await call(vy.h, 'GET', `/assistant/threads/${thread.id}/proposals`)).json(),
      ).items;
      const p = items.find((x) => x.summary.includes(name));
      expect(p).toMatchObject({ status: 'pending', businessId: shopB });
      return p?.id ?? '';
    };
    const names = async (ws: string) =>
      ProductListResponse.parse((await call(vy.in(ws), 'GET', '/products')).json()).data.map(
        (p) => p.name,
      );

    const toApprove = await proposeIn('B-1', 'Váy hoa');
    const approved = await call(vy.h, 'POST', `/assistant/proposals/${toApprove}/approve`);
    expect(approved.statusCode, approved.body).toBe(200);
    expect(AssistantProposalDto.parse(approved.json()).status).toBe('done');
    expect(await names(shopB)).toEqual(['Váy hoa']);
    expect(await names(vy.ownWorkspace)).toEqual([]);

    const toReject = await proposeIn('B-2', 'Áo len');
    const rejected = await call(vy.h, 'POST', `/assistant/proposals/${toReject}/reject`);
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(await names(shopB)).toEqual(['Váy hoa']);
    expect(await names(vy.ownWorkspace)).toEqual([]);
  });

  it('rejects a proposal, and refuses staff on every proposal route', async () => {
    const hoa = await user('route-reject@assistant.vn', 'Hoa');
    const thread = AssistantThreadDto.parse(
      (await call(hoa.h, 'POST', '/assistant/threads', {})).json(),
    );
    await turn(hoa, thread.id, 'Thêm quần', [
      toolCall('c1', {
        key: 'POST /products',
        body: product('Q-1', 'Quần jean'),
        summary: 'Thêm sản phẩm Quần jean',
      }),
    ]);
    const [proposal] = AssistantProposalList.parse(
      (await call(hoa.h, 'GET', `/assistant/threads/${thread.id}/proposals`)).json(),
    ).items;
    expect(proposal?.status).toBe('pending');

    const staff = await user('route-staff@assistant.vn', 'Staff');
    await invite(hoa, staff, 'route-staff@assistant.vn', 'admin');
    const asStaff = staff.in(hoa.ownWorkspace);
    expect(
      (await call(asStaff, 'GET', `/assistant/threads/${thread.id}/proposals`)).statusCode,
    ).toBe(403);
    expect(
      (await call(asStaff, 'POST', `/assistant/proposals/${proposal?.id}/approve`)).statusCode,
    ).toBe(403);
    expect(
      (await call(asStaff, 'POST', `/assistant/proposals/${proposal?.id}/reject`)).statusCode,
    ).toBe(403);

    const rejected = await call(hoa.h, 'POST', `/assistant/proposals/${proposal?.id}/reject`);
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(AssistantProposalDto.parse(rejected.json()).status).toBe('rejected');
    expect(
      (await call(hoa.h, 'POST', `/assistant/proposals/${proposal?.id}/approve`)).statusCode,
    ).toBe(409);
    expect(ProductListResponse.parse((await call(hoa.h, 'GET', '/products')).json()).data).toEqual(
      [],
    );
    const visible = AssistantMessageList.parse(
      (await call(hoa.h, 'GET', `/assistant/threads/${thread.id}/messages`)).json(),
    );
    expect(visible.data.at(-1)).toMatchObject({
      role: 'event',
      content: 'Anh/chị đã bỏ: Thêm sản phẩm Quần jean',
    });
    // Another account never sees the proposal.
    const other = await user('route-other@assistant.vn', 'Other');
    expect(
      (await call(other.h, 'POST', `/assistant/proposals/${proposal?.id}/approve`)).statusCode,
    ).toBe(404);
  });
});
