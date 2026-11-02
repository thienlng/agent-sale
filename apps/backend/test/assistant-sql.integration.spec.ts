import type { GenerateRequest, GenerateResponse } from '@agent-sales/ai-core';
import {
  AssistantThreadDto,
  AuthResponse,
  BootstrapResponse,
  CreatedInvitation,
  SendAssistantMessageResponse,
} from '@agent-sales/contracts';
import {
  createDb,
  ensureLoginRoles,
  migrate,
  schema,
  sql,
  withCredentials,
  eq,
} from '@agent-sales/db';
import { newId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import { AI_LLM_GATEWAY, type LlmGatewayPort } from '../src/modules/ai/api/index.js';
import { SQL_VIEWS } from '../src/modules/assistant/application/sql/sql-views.js';
import {
  ASSISTANT_SQL_RUNNER,
  type SqlRunner,
} from '../src/modules/assistant/domain/ports/sql-runner.port.js';

/**
 * The owner assistant's read-only SQL lane end to end (T-171): a fake model finds `sql_query`
 * through tool_search and runs it through tool_call on the real `assistant_sql` views, on the
 * assistant's own login. Owner A has two businesses, owner B one; each has orders.
 */
let pg: TestPostgres;
let app: NestFastifyApplication;
let owner: ReturnType<typeof createDb>;

const baseEnv = () => ({
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  DATABASE_URL: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
  DATABASE_SYSTEM_URL: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
});

async function boot(env: NodeJS.ProcessEnv): Promise<NestFastifyApplication> {
  const booted = await createHttpApp(AppModule, env);
  await booted.app.init();
  await booted.app.getHttpAdapter().getInstance().ready();
  return booted.app;
}

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, {
    tenant: pg.tenantLogin,
    system: pg.systemLogin,
    assistantSql: pg.assistantSqlLogin,
  });
  owner = createDb({ url: pg.ownerUrl, max: 2 });
  app = await boot({
    ...baseEnv(),
    DATABASE_ASSISTANT_SQL_URL: withCredentials(
      pg.ownerUrl,
      pg.assistantSqlLogin.user,
      pg.assistantSqlLogin.password,
    ),
  });
});

afterAll(async () => {
  await app?.close();
  await owner?.close();
  await pg?.stop();
});

type Method = 'GET' | 'POST';
type Headers = Record<string, string>;
const call = (h: Headers, method: Method, url: string, payload?: object) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({ method, url: `/api/v1${url}`, headers: h, ...(payload ? { payload } : {}) });

let signups = 0;
async function user(email: string, name: string) {
  const signup = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      remoteAddress: `10.171.0.${++signups}`,
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
    ownWorkspace: own,
    auth: { authorization } as Headers,
    h: { authorization, 'x-workspace-id': own } as Headers,
    in: (ws: string): Headers => ({ authorization, 'x-workspace-id': ws }),
  };
}
type User = Awaited<ReturnType<typeof user>>;

/** Orders straight into the table: one per total, `delivered` unless the total is negative. */
async function seedOrders(ws: string, totals: number[]) {
  const warehouse = newId();
  await owner.db.execute(
    sql`insert into warehouses (id, workspace_id, name) values (${warehouse}, ${ws}, 'Kho')`,
  );
  for (const [i, t] of totals.entries()) {
    const status = t < 0 ? 'cancelled' : 'delivered';
    const total = Math.abs(t);
    await owner.db.execute(sql`insert into orders (id, workspace_id, code, status, stock_state,
        source, warehouse_id, customer, recipient, item_qty, subtotal, discount_type,
        discount_value, discount_amount, shipping_fee, shipping_fee_charged, surcharge,
        transfer_amount, total, paid, remaining, cod_amount, cost_total, placed_at, search_text)
      values (${newId()}, ${ws}, ${`O-${i}`}, ${status}, 'shipped', 'manual', ${warehouse},
        ${JSON.stringify({ name: 'Khách', phone: '0912345678' })}::jsonb, '{}'::jsonb, 1,
        ${total}, 'amount', 0, 0, 0, 0, 0, 0, ${total}, 0, ${total}, 0, 0, now(), '')`);
  }
}

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
const toolCall = (id: string, name: string, input: unknown) =>
  answer({ stopReason: 'tool_use', toolCalls: [{ id, name, input }] });

/** One turn on `on` with a scripted model; returns every request the model received. */
async function turn(
  on: NestFastifyApplication,
  h: Headers,
  threadId: string,
  script: GenerateResponse[],
) {
  const gateway = on.get<LlmGatewayPort>(AI_LLM_GATEWAY, { strict: false });
  const queue = [...script];
  const requests: GenerateRequest[] = [];
  const spy = vi.spyOn(gateway, 'generate').mockImplementation((r: GenerateRequest) => {
    // The messages as sent (the loop appends to its own array afterwards).
    requests.push({ ...r, messages: [...r.messages] });
    return Promise.resolve(queue.shift() ?? answer({ text: 'Dạ xong ạ' }));
  });
  try {
    const res = await on
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/api/v1/assistant/threads/${threadId}/messages`,
        headers: h,
        payload: { turnId: newId(), text: 'Doanh thu tuần này bao nhiêu?' },
      });
    expect(res.statusCode, res.body).toBe(200);
    SendAssistantMessageResponse.parse(res.json());
    return requests;
  } finally {
    spy.mockRestore();
  }
}

/** The tool result the model read in request `i` (the last message). */
const toolResultIn = (requests: GenerateRequest[], i: number): unknown =>
  JSON.parse(requests[i]?.messages.at(-1)?.content ?? 'null');

const REVENUE_SQL =
  'select b.name, sum(o.total) from orders o join businesses b using (business_id) where o.counts_as_revenue group by 1';

describe('assistant SQL lane on Postgres', () => {
  let a: User;
  let a2: string;
  let b: User;
  let thread: string;

  beforeAll(async () => {
    a = await user('owner-a@assistant-sql.vn', 'An');
    const second = await call(a.auth, 'POST', '/workspaces', {
      name: 'Shop An 2',
      industry: 'fashion',
    });
    expect(second.statusCode, second.body).toBe(201);
    a2 = (second.json() as { id: string }).id;
    b = await user('owner-b@assistant-sql.vn', 'Binh');
    await seedOrders(a.ownWorkspace, [200_000, -50_000]);
    await seedOrders(a2, [300_000, 100_000]);
    await seedOrders(b.ownWorkspace, [999_000]);
    thread = AssistantThreadDto.parse(
      (await call(a.h, 'POST', '/assistant/threads', {})).json(),
    ).id;
  });

  it("finds sql_query and reads the owner's own businesses only", async () => {
    const requests = await turn(app, a.h, thread, [
      toolCall('c1', 'tool_search', { query: 'revenue this week' }),
      toolCall('c2', 'tool_call', { key: 'sql_query', body: { sql: REVENUE_SQL } }),
      answer({ text: 'Dạ doanh thu là …' }),
    ]);
    const hits = toolResultIn(requests, 1) as { key: string }[];
    expect(hits.map((h) => h.key)).toContain('sql_query');

    const result = toolResultIn(requests, 2) as {
      ok: boolean;
      columns: string[];
      rows: [string, number][];
      rowCount: number;
    };
    expect(result).toMatchObject({ ok: true, columns: ['name', 'sum'], rowCount: 2 });
    expect([...result.rows].sort((x, y) => x[0].localeCompare(y[0]))).toEqual([
      ['Shop An', 200_000],
      ['Shop An 2', 400_000],
    ]);
    expect(JSON.stringify(requests)).not.toContain('999000');
    expect(JSON.stringify(requests)).not.toContain('Shop Binh');
  });

  it("refuses another owner's business", async () => {
    const requests = await turn(app, a.h, thread, [
      toolCall('c1', 'tool_call', {
        key: 'sql_query',
        body: { sql: REVENUE_SQL, businessIds: [b.ownWorkspace] },
      }),
      answer({ text: 'Dạ' }),
    ]);
    expect(toolResultIn(requests, 1)).toEqual({ ok: false, errorCode: 'unknown_business' });
  });

  it('narrows to the named business', async () => {
    const requests = await turn(app, a.h, thread, [
      toolCall('c1', 'tool_call', {
        key: 'sql_query',
        body: { sql: REVENUE_SQL, businessIds: [a2] },
      }),
      answer({ text: 'Dạ' }),
    ]);
    expect(toolResultIn(requests, 1)).toMatchObject({ ok: true, rows: [['Shop An 2', 400_000]] });
  });

  it('refuses staff of the business (403, unchanged)', async () => {
    const staff = await user('staff@assistant-sql.vn', 'Chi');
    const inv = await call(a.h, 'POST', '/invitations', {
      email: 'staff@assistant-sql.vn',
      role: 'admin',
    });
    expect(inv.statusCode, inv.body).toBe(201);
    const { token } = CreatedInvitation.parse(inv.json());
    const accepted = await call(staff.auth, 'POST', '/invitation-links/accept', { token });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const res = await call(
      staff.in(a.ownWorkspace),
      'POST',
      `/assistant/threads/${thread}/messages`,
      {
        turnId: newId(),
        text: 'Doanh thu?',
      },
    );
    expect(res.statusCode).toBe(403);
  });

  it('describes the views exactly as the database has them', async () => {
    for (const view of SQL_VIEWS) {
      const rows = (await owner.db.execute(sql`select column_name, data_type
        from information_schema.columns
        where table_schema = 'assistant_sql' and table_name = ${view.name}
        order by ordinal_position`)) as unknown as { column_name: string; data_type: string }[];
      expect(
        rows.map((r) => r.column_name),
        view.name,
      ).toEqual(view.columns.map((c) => c.name));
      const short: Record<string, string> = {
        'timestamp with time zone': 'timestamptz',
        'character varying': 'text',
      };
      expect(
        rows.map((r) => `${r.column_name} ${short[r.data_type] ?? r.data_type}`),
        view.name,
      ).toEqual(view.columns.map((c) => `${c.name} ${c.type}`));
    }
  });

  it('runs every example query of the catalog', async () => {
    const runner = app.get<SqlRunner | null>(ASSISTANT_SQL_RUNNER, { strict: false });
    expect(runner).not.toBeNull();
    const [row] = (await owner.db
      .select({ accountId: schema.workspaces.accountId })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, a.ownWorkspace))) as { accountId: string }[];
    for (const example of SQL_VIEWS.flatMap((v) => v.examples)) {
      await expect(
        runner!.run({ accountId: row!.accountId, businessIds: [a.ownWorkspace, a2], sql: example }),
        example,
      ).resolves.toMatchObject({ truncated: false });
    }
  });

  // Last: it boots a second app without the SQL lane (the env is process-wide).
  it('has no SQL tools when DATABASE_ASSISTANT_SQL_URL is unset', async () => {
    await app.close();
    app = await boot(baseEnv());
    expect(app.get(ASSISTANT_SQL_RUNNER, { strict: false })).toBeNull();
    const c = await user('owner-c@assistant-sql.vn', 'Cuc');
    const t = AssistantThreadDto.parse((await call(c.h, 'POST', '/assistant/threads', {})).json());
    const requests = await turn(app, c.h, t.id, [
      toolCall('c1', 'tool_search', { query: 'revenue this week' }),
      toolCall('c2', 'tool_call', { key: 'sql_query', body: { sql: REVENUE_SQL } }),
      answer({ text: 'Dạ' }),
    ]);
    const hits = toolResultIn(requests, 1) as { key: string }[];
    expect(hits.some((h) => h.key.startsWith('sql_'))).toBe(false);
    expect(toolResultIn(requests, 2)).toEqual({ ok: false, errorCode: 'unknown_key' });
  });
});
