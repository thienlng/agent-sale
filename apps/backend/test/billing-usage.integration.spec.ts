import {
  BotDto,
  ChannelConnectionDto,
  ConversationListResponse,
  EntitlementsDto,
  MessageUsageDto,
  WidgetPollResponse,
  WidgetSendResponse,
  WorkspaceDto,
} from '@agent-sales/contracts';
import { eq, schema, sql } from '@agent-sales/db';
import { workspaceId } from '@agent-sales/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AI_FACADE, type AiFacade } from '../src/modules/ai/api/index.js';
import { BILLING_FACADE, type BillingFacade } from '../src/modules/billing/api/index.js';
import {
  CONVERSATION_RUNNER,
  type ConversationRunner,
} from '../src/modules/conversation/api/index.js';
import { startHarness, type Harness, type TestUser } from './support/harness.js';

/**
 * One AI-message allowance per account (T-091, ADR-012 §5): every business of the account draws
 * from it, a delivered reply counts once, and an exhausted allowance hands the customer to staff.
 */
const ORIGIN = 'https://shop.test';
const REPLY = 'Dạ shop còn áo thun ạ.';
let hx: Harness;
let owner: TestUser;
let accountId: string;
let runner: ConversationRunner;
let billing: BillingFacade;
let ai: AiFacade;
const businesses: { ws: string; siteKey: string }[] = [];

let addresses = 0;
const nextIp = () => `10.9.${Math.floor(addresses / 250)}.${(addresses++ % 250) + 1}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function tick() {
  await sleep(900);
  await runner.tick();
}

async function send(siteKey: string, text: string, token?: string) {
  const res = await hx.app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: `/api/v1/webchat/v1/sites/${siteKey}/messages`,
      remoteAddress: nextIp(),
      headers: { origin: ORIGIN, ...(token ? { authorization: `Visitor ${token}` } : {}) },
      payload: {
        clientMessageId: crypto.randomUUID(),
        text,
        page: { url: `${ORIGIN}/`, title: 'Shop' },
      },
    });
  expect(res.statusCode).toBe(202);
  return WidgetSendResponse.parse(res.json()).visitorToken;
}

async function poll(siteKey: string, token: string) {
  const res = await hx.app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'GET',
      url: `/api/v1/webchat/v1/sites/${siteKey}/messages`,
      remoteAddress: nextIp(),
      headers: { origin: ORIGIN, authorization: `Visitor ${token}` },
    });
  return WidgetPollResponse.parse(res.json()).messages.map((m) => [m.role, m.text]);
}

const usage = async (ws: string) =>
  MessageUsageDto.parse((await hx.call(owner.in(ws), 'GET', '/billing/usage')).json());

async function setAllowance(account: string, amount: number) {
  await hx.owner.db.execute(sql`
    insert into account_entitlement_overrides (account_id, key, value, reason)
    values (${account}, 'ai.included_messages', ${JSON.stringify({ amount, periodDays: 30 })}::jsonb, 'test')
    on conflict (account_id, key) do update set value = excluded.value`);
}

async function businessWithSite(ws: string) {
  const h = owner.in(ws);
  const bot = BotDto.parse(
    (await hx.call(h, 'POST', '/bots', { name: 'Bot web', industry: 'fashion' })).json(),
  );
  if (!bot.isActive) await hx.call(h, 'PATCH', `/bots/${bot.id}`, { isActive: true });
  const created = await hx.call(h, 'POST', '/channels/website', {
    name: 'Site',
    domains: ['shop.test'],
    botId: bot.id,
  });
  expect(created.statusCode).toBe(201);
  businesses.push({ ws, siteKey: ChannelConnectionDto.parse(created.json()).externalId });
}

beforeAll(async () => {
  hx = await startHarness();
  owner = await hx.user('meter-owner@shop.vn', 'Chủ shop');
  const second = await hx.call(owner.auth, 'POST', '/workspaces', {
    name: 'Shop thứ hai',
    industry: 'fashion',
  });
  expect(second.statusCode).toBe(201);
  const ws2 = WorkspaceDto.parse(second.json()).id;
  const [row] = await hx.owner.db
    .select({ accountId: schema.workspaces.accountId })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, owner.ownWorkspace));
  accountId = row?.accountId ?? '';
  expect(accountId).not.toBe('');
  await businessWithSite(owner.ownWorkspace);
  await businessWithSite(ws2);
  await setAllowance(accountId, 2);

  runner = hx.app.get<ConversationRunner>(CONVERSATION_RUNNER, { strict: false });
  billing = hx.app.get<BillingFacade>(BILLING_FACADE, { strict: false });
  ai = hx.app.get<AiFacade>(AI_FACADE, { strict: false });
  vi.spyOn(ai, 'reply').mockImplementation(async () => ({
    runId: crypto.randomUUID(),
    reply: REPLY,
    outcome: 'answered' as const,
    guardrail: null,
    sources: [],
    images: [],
    usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
    provider: 'fake',
    model: 'fake',
    latencyMs: 1,
  }));
});
afterAll(async () => {
  vi.restoreAllMocks();
  await hx?.stop();
});

describe('account message allowance', () => {
  const tokens: string[] = [];

  it('counts a delivered reply of each business against the one account allowance', async () => {
    const [a, b] = businesses as [(typeof businesses)[0], (typeof businesses)[0]];
    expect(await usage(a.ws)).toMatchObject({ metered: true, used: 0, limit: 2, exhausted: false });

    tokens.push(await send(a.siteKey, 'Shop còn áo thun không?'));
    await tick();
    expect(await poll(a.siteKey, tokens[0] ?? '')).toContainEqual(['agent', REPLY]);
    expect(await usage(b.ws)).toMatchObject({ used: 1, exhausted: false });

    tokens.push(await send(b.siteKey, 'Còn size M không?'));
    await tick();
    expect(await poll(b.siteKey, tokens[1] ?? '')).toContainEqual(['agent', REPLY]);
    const both = await usage(a.ws);
    expect(both).toMatchObject({ used: 2, limit: 2, exhausted: true });
    expect(new Date(both.cycleEnd).getTime()).toBeGreaterThan(Date.now());

    const rows = await hx.owner.db.select().from(schema.messageUsage);
    expect(rows.map((r) => r.status)).toEqual(['captured', 'captured']);
    expect(new Set(rows.map((r) => r.workspaceId))).toEqual(new Set(businesses.map((x) => x.ws)));
  });

  it('never counts a retried reply twice', async () => {
    const [row] = await hx.owner.db.select().from(schema.messageUsage).limit(1);
    const ws = workspaceId(row?.workspaceId ?? '');
    const again = await billing.reserveReply(ws, {
      idempotencyKey: row?.idempotencyKey ?? '',
      conversationId: row?.conversationId ?? null,
      botId: row?.botId ?? null,
    });
    expect(again).toEqual({ allowed: true, metered: true });
    await billing.captureReply(ws, row?.idempotencyKey ?? '');
    expect(await usage(ws)).toMatchObject({ used: 2 });
  });

  it('hands the customer to staff without asking the AI once the allowance is spent', async () => {
    const a = businesses[0] as (typeof businesses)[0];
    const calls = vi.mocked(ai.reply).mock.calls.length;
    await send(a.siteKey, 'Có giao hàng không?', tokens[0]);
    await tick();
    expect(vi.mocked(ai.reply).mock.calls.length).toBe(calls);
    const messages = await poll(a.siteKey, tokens[0] ?? '');
    expect(messages.at(-1)?.[0]).toBe('agent');
    expect(messages.at(-1)?.[1]).toMatch(/chuyển cho nhân viên/);
    const list = ConversationListResponse.parse(
      (await hx.call(owner.in(a.ws), 'GET', '/conversations')).json(),
    );
    expect(list.data[0]).toMatchObject({ mode: 'human' });
    expect(await usage(a.ws)).toMatchObject({ used: 2, exhausted: true });
  });

  it('starts every cycle afresh: replies of an earlier cycle do not count', async () => {
    const a = businesses[0] as (typeof businesses)[0];
    await hx.owner.db
      .update(schema.messageUsage)
      .set({ cycleStart: new Date('2026-01-01T00:00:00+07:00') });
    expect(await usage(a.ws)).toMatchObject({ used: 0, exhausted: false });
  });

  it('never lets concurrent replies of the account exceed the allowance', async () => {
    await hx.owner.db.delete(schema.messageUsage);
    await setAllowance(accountId, 3);
    const outcomes = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        billing.reserveReply(workspaceId(businesses[i % 2]?.ws ?? ''), {
          idempotencyKey: `bot:race-${i}`,
          conversationId: null,
          botId: null,
        }),
      ),
    );
    expect(outcomes.filter((o) => o.allowed)).toHaveLength(3);
    expect(outcomes.filter((o) => !o.allowed)).toHaveLength(9);
  });

  it('keeps resolving the seat limit from the account plan', async () => {
    const res = await hx.call(owner.h, 'GET', '/billing/entitlements');
    expect(EntitlementsDto.parse(res.json()).limits['members.max']).toBe(1);
  });

  it('keeps the meter of one account away from another', async () => {
    const stranger = await hx.user('meter-stranger@shop.vn', 'Người lạ');
    const res = await hx.call(stranger.in(businesses[0]?.ws ?? ''), 'GET', '/billing/usage');
    expect(res.statusCode).toBe(404);
    const own = MessageUsageDto.parse((await hx.call(stranger.h, 'GET', '/billing/usage')).json());
    expect(own).toMatchObject({ used: 0, limit: 1000 });
  });

  it('gives every business of an account one plan and cycle before the account has its own', async () => {
    // A paid and a free business, no account subscription yet (before the backfill, or a plan
    // set on a business): both must count against the paid business's allowance and cycle.
    const mixed = await hx.user('meter-mixed@shop.vn', 'Chủ hai shop');
    const created = await hx.call(mixed.auth, 'POST', '/workspaces', {
      name: 'Shop miễn phí',
      industry: 'fashion',
    });
    expect(created.statusCode).toBe(201);
    const paid = mixed.ownWorkspace;
    const free = WorkspaceDto.parse(created.json()).id;
    await hx.owner.db.execute(sql`
      insert into subscriptions (workspace_id, plan_code, plan_version, current_period_start)
      values (${paid}, 'sales_smart', 1, now() - interval '5 days')`);
    const read = async (ws: string) =>
      MessageUsageDto.parse((await hx.call(mixed.in(ws), 'GET', '/billing/usage')).json());

    const [p0, f0] = [await read(paid), await read(free)];
    expect(f0.limit).toBe(p0.limit);
    expect(f0.cycleStart).toBe(p0.cycleStart);

    const key = `test:${crypto.randomUUID()}`;
    await billing.reserveReply(workspaceId(free), {
      idempotencyKey: key,
      conversationId: null,
      botId: null,
    });
    await billing.captureReply(workspaceId(free), key);
    expect((await read(paid)).used).toBe(p0.used + 1);
    expect((await read(free)).used).toBe(p0.used + 1);
  });
});
