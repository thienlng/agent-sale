import { BotDto, BotTurnDetail, BotTurnList, PlaygroundResponse } from '@agent-sales/contracts';
import { schema } from '@agent-sales/db';
import { newId } from '@agent-sales/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness, type TestUser } from './support/harness.js';

/** Shop-bot turn traces over HTTP (T-174): recorded by a playground turn, read through the routes. */
let h: Harness;
let shop: TestUser;
let botId: string;
let runId: string;

beforeAll(async () => {
  h = await startHarness();
  shop = await h.user('turns-owner@shop.vn', 'Lan');
  const bot = await h.call(shop.h, 'POST', '/bots', { name: 'Bot', industry: 'fashion' });
  expect(bot.statusCode, bot.body).toBe(201);
  botId = BotDto.parse(bot.json()).id;
  const turn = await h.call(shop.h, 'POST', `/bots/${botId}/playground`, {
    messages: [{ role: 'customer', content: 'áo này giá bao nhiêu' }],
  });
  expect(turn.statusCode, turn.body).toBe(200);
  runId = PlaygroundResponse.parse(turn.json()).runId;
});

afterAll(async () => {
  await h?.stop();
});

describe('GET /bots/{botId}/turns', () => {
  it('lists the playground turn with its trace when tests are included', async () => {
    const hidden = BotTurnList.parse((await h.call(shop.h, 'GET', `/bots/${botId}/turns`)).json());
    expect(hidden.items).toEqual([]);
    const res = await h.call(shop.h, 'GET', `/bots/${botId}/turns?includeTests=true`);
    expect(res.statusCode, res.body).toBe(200);
    const list = BotTurnList.parse(res.json());
    expect(list.items).toEqual([
      expect.objectContaining({
        runId,
        isTest: true,
        hasTrace: true,
        queryExcerpt: 'áo này giá bao nhiêu',
      }),
    ]);
  });

  it('finds the turn by words without accents', async () => {
    const hit = BotTurnList.parse(
      (await h.call(shop.h, 'GET', `/bots/${botId}/turns?includeTests=true&q=gia`)).json(),
    );
    expect(hit.items.map((i) => i.runId)).toEqual([runId]);
    const miss = BotTurnList.parse(
      (await h.call(shop.h, 'GET', `/bots/${botId}/turns?includeTests=true&q=giay`)).json(),
    );
    expect(miss.items).toEqual([]);
  });

  it('returns the detail with its steps', async () => {
    const res = await h.call(shop.h, 'GET', `/bots/${botId}/turns/${runId}`);
    expect(res.statusCode, res.body).toBe(200);
    const detail = BotTurnDetail.parse(res.json());
    expect(detail.steps.length).toBeGreaterThan(0);
    expect(detail.steps[0]?.kind).toBe('model_call');
    expect(detail.offeredTools).toContain('send_message');
    expect(detail.instructionsChangedSince).toBe(false);
    expect(detail.trainingChangedSince).toBe(false);
  });

  it('validates the query', async () => {
    const res = await h.call(shop.h, 'GET', `/bots/${botId}/turns?limit=99`);
    expect(res.statusCode).toBe(400);
    const cursor = await h.call(shop.h, 'GET', `/bots/${botId}/turns?cursor=garbage`);
    expect(cursor.statusCode).toBe(400);
  });

  it('is 404 from another workspace and for an unknown run', async () => {
    const other = await h.user('turns-other@shop.vn', 'Other');
    expect((await h.call(other.h, 'GET', `/bots/${botId}/turns/${runId}`)).statusCode).toBe(404);
    expect((await h.call(other.h, 'GET', `/bots/${botId}/turns`)).statusCode).toBe(404);
    expect((await h.call(shop.h, 'GET', `/bots/${botId}/turns/${newId()}`)).statusCode).toBe(404);
    expect((await h.call(shop.h, 'GET', `/bots/${botId}/turns/not-a-uuid`)).statusCode).toBe(404);
  });

  it('is 403 for a member without bots.manage', async () => {
    const analyst = await h.user('turns-analyst@shop.vn', 'Analyst');
    await h.owner.db.insert(schema.members).values({
      id: newId(),
      workspaceId: shop.ownWorkspace,
      userId: analyst.userId,
      role: 'analyst',
      status: 'active',
    });
    const headers = analyst.in(shop.ownWorkspace);
    expect((await h.call(headers, 'GET', `/bots/${botId}/turns`)).statusCode).toBe(403);
    expect((await h.call(headers, 'GET', `/bots/${botId}/turns/${runId}`)).statusCode).toBe(403);
  });
});
