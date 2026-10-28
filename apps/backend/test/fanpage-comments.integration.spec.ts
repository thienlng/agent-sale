import {
  AuthResponse,
  BootstrapResponse,
  FanpageCommentPage,
  FanpageSettings,
} from '@agent-sales/contracts';
import { createDb, ensureLoginRoles, migrate, schema, sql, withCredentials } from '@agent-sales/db';
import { workspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import { FANPAGE_FACADE, type FanpageFacade } from '../src/modules/channel/api/index.js';

/** T-106 comment reads and actions over HTTP on a real Postgres: permissions and tenancy. */
let pg: TestPostgres;
let app: NestFastifyApplication;
let owner: ReturnType<typeof createDb>;
let pages: FanpageFacade;

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
  pages = app.get<FanpageFacade>(FANPAGE_FACADE, { strict: false });
});

afterAll(async () => {
  await app?.close();
  await owner?.close();
  await pg?.stop();
});

type Headers = Record<string, string>;
const call = (h: Headers, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({ method, url: `/api/v1${url}`, headers: h, ...(payload ? { payload } : {}) });

let signups = 0;
async function shop(email: string, pageId: string) {
  const signup = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      remoteAddress: `10.3.0.${++signups}`,
      payload: {
        name: 'Lan',
        email,
        password: 'a long enough password',
        workspaceName: 'Shop',
        industry: 'fashion',
      },
    });
  const { accessToken } = AuthResponse.parse(signup.json());
  const authorization = `Bearer ${accessToken}`;
  const boot = BootstrapResponse.parse((await call({ authorization }, 'GET', '/bootstrap')).json());
  const ws = boot.memberships[0]?.workspaceId ?? '';
  const channelId = crypto.randomUUID();
  await owner.db.insert(schema.channelConnections).values({
    id: channelId,
    workspaceId: ws,
    provider: 'facebook',
    externalId: pageId,
    name: 'Page',
    // Never a usable token: any Facebook lookup reports that the Page must be reconnected.
    status: 'reauth_required',
    tokenSealed: 'sealed',
  });
  return {
    userId: boot.user.id,
    ws,
    channelId,
    pageId,
    h: { authorization, 'x-workspace-id': ws } as Headers,
    in: (id: string): Headers => ({ authorization, 'x-workspace-id': id }),
  };
}
async function member(ws: string, role: string) {
  const other = await shop(`${role}-${++signups}@shop.vn`, `${900 + signups}`);
  await owner.db.insert(schema.members).values({
    id: crypto.randomUUID(),
    workspaceId: ws,
    userId: other.userId,
    role,
    status: 'active',
  });
  return other;
}
async function received(s: { ws: string; channelId: string; pageId: string }, n: number) {
  return pages.receive(workspaceId(s.ws), s.channelId, {
    kind: 'facebook',
    type: 'comment',
    assetExternalId: s.pageId,
    senderExternalId: '555',
    externalEventId: `event-${n}`,
    occurredAt: new Date(),
    text: `Giá bao nhiêu ${n}`,
    comment: { postId: `${s.pageId}_10`, commentId: `10_${n}`, parentId: null, operation: 'add' },
    raw: {},
  });
}
const activity = async (channelId: string) =>
  (
    await owner.db.execute<{ at: string }>(
      sql`select updated_at::text as at from fanpage_comments where connection_id=${channelId} order by comment_id`,
    )
  ).map((r) => r.at);

describe('fanpage comments over HTTP', () => {
  it('pages stored comments and reads detail without bumping activity', async () => {
    const a = await shop('comments-read@shop.vn', '111');
    for (let n = 1; n <= 5; n++) await received(a, n);
    const before = await activity(a.channelId);
    const first = await call(a.h, 'GET', `/channels/${a.channelId}/fanpage/comments?limit=2`);
    expect(first.statusCode, first.body).toBe(200);
    const page = FanpageCommentPage.parse(first.json());
    expect(page.data).toHaveLength(2);
    const next = FanpageCommentPage.parse(
      (
        await call(
          a.h,
          'GET',
          `/channels/${a.channelId}/fanpage/comments?limit=2&cursor=${page.nextCursor}`,
        )
      ).json(),
    );
    expect(next.data.map((c) => c.commentId)).not.toContain(page.data[0]?.commentId);
    const legacy = await call(a.h, 'GET', `/channels/${a.channelId}/fanpage/comments`);
    expect(FanpageCommentPage.parse(legacy.json()).data).toHaveLength(5);
    const detail = await call(a.h, 'GET', `/channels/${a.channelId}/fanpage/comments/10_3`);
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json()).toMatchObject({ data: { commentId: '10_3', needsReview: false } });
    const source = await call(a.h, 'GET', `/channels/${a.channelId}/fanpage/comments/10_3/source`);
    expect(source.statusCode, source.body).toBe(200);
    expect(source.json()).toEqual({ status: 'unavailable', reason: 'reconnect' });
    const posts = await call(a.h, 'GET', `/channels/${a.channelId}/fanpage/comment-posts`);
    expect(posts.json()).toMatchObject({
      data: [{ postId: '111_10', comments: 5 }],
      nextCursor: null,
    });
    expect(await activity(a.channelId)).toEqual(before);
  });

  it('rejects foreign workspaces, foreign pages and view-only members, including direct actions', async () => {
    const a = await shop('comments-owner@shop.vn', '222');
    const b = await shop('comments-other@shop.vn', '333');
    await received(a, 1);
    await received(b, 2);
    const analyst = await member(a.ws, 'analyst');
    const action = { kind: 'hide', requestId: crypto.randomUUID() };
    // B's member cannot read A's page through A's workspace header or their own.
    expect(
      (await call(b.in(a.ws), 'GET', `/channels/${a.channelId}/fanpage/comments`)).statusCode,
    ).toBe(404);
    for (const path of ['comments', 'comments/10_1', 'comments/10_1/source', 'comment-posts'])
      expect(
        (await call(b.h, 'GET', `/channels/${a.channelId}/fanpage/${path}`)).statusCode,
        path,
      ).toBe(404);
    expect(
      (await call(b.h, 'POST', `/channels/${a.channelId}/fanpage/comments/10_1/actions`, action))
        .statusCode,
    ).toBe(404);
    // A's own page does not expose B's comment id.
    expect(
      (await call(a.h, 'GET', `/channels/${a.channelId}/fanpage/comments/10_2`)).statusCode,
    ).toBe(404);
    // A cursor issued for A's page is not accepted for B's page.
    for (let n = 3; n <= 4; n++) await received(a, n);
    const cursor = FanpageCommentPage.parse(
      (await call(a.h, 'GET', `/channels/${a.channelId}/fanpage/comments?limit=1`)).json(),
    ).nextCursor;
    expect(
      (await call(b.h, 'GET', `/channels/${b.channelId}/fanpage/comments?limit=1&cursor=${cursor}`))
        .statusCode,
    ).toBe(400);
    // An analyst can read but cannot reply or moderate, even by calling the route directly.
    const analystHeaders = analyst.in(a.ws);
    expect(
      (await call(analystHeaders, 'GET', `/channels/${a.channelId}/fanpage/comments/10_1`))
        .statusCode,
    ).toBe(200);
    for (const body of [
      action,
      { kind: 'public_reply', text: 'Hi', requestId: crypto.randomUUID() },
      { kind: 'private_reply', text: 'Hi', requestId: crypto.randomUUID() },
    ])
      expect(
        (
          await call(
            analystHeaders,
            'POST',
            `/channels/${a.channelId}/fanpage/comments/10_1/actions`,
            body,
          )
        ).statusCode,
      ).toBe(403);
    const sales = await member(a.ws, 'sales');
    // Sales may act; the source check then refuses because the Page needs reconnecting.
    expect(
      (
        await call(
          sales.in(a.ws),
          'POST',
          `/channels/${a.channelId}/fanpage/comments/10_1/actions`,
          action,
        )
      ).statusCode,
    ).toBe(503);
    const stored = await call(a.h, 'GET', `/channels/${a.channelId}/fanpage/comments/10_1`);
    expect(stored.json()).toMatchObject({ data: { actions: [] } });
  });
});

describe('fanpage automation settings authorization', () => {
  const settings = { ...FanpageSettings.parse({}), publicReplies: true };

  it.each(['owner', 'admin'])('lets %s save automation settings', async (role) => {
    const a = await shop(`settings-${role}@settings.test`, `7${++signups}`);
    const headers = role === 'owner' ? a.h : (await member(a.ws, role)).in(a.ws);
    const saved = await call(
      headers,
      'PATCH',
      `/channels/${a.channelId}/fanpage/settings`,
      settings,
    );
    expect(saved.statusCode, saved.body).toBe(200);
    expect(
      FanpageSettings.parse(
        (await call(a.h, 'GET', `/channels/${a.channelId}/fanpage/settings`)).json(),
      ),
    ).toEqual(settings);
  });

  it.each(['analyst', 'sales'])(
    'lets %s read but rejects settings changes without modifying stored state',
    async (role) => {
      const a = await shop(`settings-${role}@settings.test`, `7${++signups}`);
      const viewer = await member(a.ws, role);
      const path = `/channels/${a.channelId}/fanpage/settings`;
      expect((await call(a.h, 'PATCH', path, settings)).statusCode).toBe(200);
      expect((await call(viewer.in(a.ws), 'GET', path)).statusCode).toBe(200);
      expect(
        (await call(viewer.in(a.ws), 'PATCH', path, FanpageSettings.parse({}))).statusCode,
      ).toBe(403);
      expect(FanpageSettings.parse((await call(a.h, 'GET', path)).json())).toEqual(settings);
    },
  );

  it('rejects foreign workspace headers and foreign channel IDs without changing settings', async () => {
    const a = await shop('settings-a@settings.test', `7${++signups}`);
    const b = await shop('settings-b@settings.test', `7${++signups}`);
    const path = `/channels/${a.channelId}/fanpage/settings`;
    for (const headers of [b.h, b.in(a.ws)]) {
      expect((await call(headers, 'PATCH', path, settings)).statusCode).toBe(404);
    }
    expect(FanpageSettings.parse((await call(a.h, 'GET', path)).json())).toEqual(
      FanpageSettings.parse({}),
    );
  });
});
