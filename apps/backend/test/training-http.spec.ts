import {
  AuthResponse,
  BootstrapResponse,
  BotDto,
  TrainingHistoryList,
  TrainingItemDto,
  TrainingItemList,
  FaqListResponse,
} from '@agent-sales/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { STARTER_RULES } from '../src/modules/knowledge/domain/starter-rules.js';
import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';

let current: NestFastifyApplication | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

async function setup() {
  const booted = await createHttpApp(AppModule, { NODE_ENV: 'test', LOG_LEVEL: 'error' });
  current = booted.app;
  await current.init();
  await current.getHttpAdapter().getInstance().ready();
  return current.getHttpAdapter().getInstance();
}

// The HTTP guard and real facade are exercised together with deterministic in-memory persistence.
describe('HTTP: bot training', () => {
  it('validates CRUD, authentication, workspace membership, bot ownership and change history', async () => {
    const http = await setup();
    const signup = async (email: string) => {
      const response = await http.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: {
          name: 'Training Owner',
          email,
          password: 'correct horse battery',
          workspaceName: 'Training Shop',
          industry: 'retail',
        },
      });
      expect(response.statusCode).toBe(201);
      const auth = AuthResponse.parse(response.json());
      const bootstrap = await http.inject({
        method: 'GET',
        url: '/api/v1/bootstrap',
        headers: { authorization: `Bearer ${auth.accessToken}` },
      });
      const data = BootstrapResponse.parse(bootstrap.json());
      return {
        authorization: `Bearer ${auth.accessToken}`,
        'x-workspace-id': data.memberships[0]?.workspaceId ?? '',
      };
    };
    const headers = await signup('training@example.test');
    const other = await signup('other-training@example.test');
    const createdBot = await http.inject({
      method: 'POST',
      url: '/api/v1/bots',
      headers,
      payload: { name: 'Training Bot', industry: 'retail' },
    });
    const bot = BotDto.parse(createdBot.json());
    const url = `/api/v1/bots/${bot.id}/training-items`;
    const payload = { kind: 'scenario', title: 'Returns', content: 'Ask for the order number.' };
    expect((await http.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect(
      (await http.inject({ method: 'POST', url, headers, payload: { ...payload, title: '' } }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await http.inject({
          method: 'POST',
          url,
          headers,
          payload: { ...payload, mediaUrl: 'http://example.test/private' },
        })
      ).statusCode,
    ).toBe(400);
    const created = await http.inject({ method: 'POST', url, headers, payload });
    expect(created.statusCode).toBe(201);
    const item = TrainingItemDto.parse(created.json());
    expect(
      TrainingItemList.parse((await http.inject({ method: 'GET', url, headers })).json()).data,
    ).toHaveLength(STARTER_RULES.length + 1); // a new bot starts with the starter pack
    expect(
      (await http.inject({ method: 'PATCH', url: `${url}/${item.id}`, headers, payload: {} }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await http.inject({
          method: 'PATCH',
          url: `${url}/${item.id}`,
          headers,
          payload: { title: 'Updated returns' },
        })
      ).statusCode,
    ).toBe(200);
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE'] as const) {
      const response = await http.inject({
        method,
        url: method === 'PATCH' || method === 'DELETE' ? `${url}/${item.id}` : url,
        headers: other,
        ...(method === 'POST'
          ? { payload }
          : method === 'PATCH'
            ? { payload: { title: 'Leak' } }
            : {}),
      });
      expect(response.statusCode).toBe(404);
    }
    expect(
      (
        await http.inject({
          method: 'GET',
          url,
          headers: { ...other, 'x-workspace-id': headers['x-workspace-id'] },
        })
      ).statusCode,
    ).toBe(404);
    const historyUrl = `/api/v1/bots/${bot.id}/training-history`;
    expect((await http.inject({ method: 'GET', url: historyUrl, headers: other })).statusCode).toBe(
      404,
    );
    expect(
      (await http.inject({ method: 'DELETE', url: `${url}/${item.id}`, headers })).statusCode,
    ).toBe(204);
    const history = TrainingHistoryList.parse(
      (await http.inject({ method: 'GET', url: historyUrl, headers })).json(),
    );
    expect(history.data.slice(0, 3).map((entry) => entry.action)).toEqual([
      'deleted',
      'updated',
      'created',
    ]);
    const updatedBot = await http.inject({
      method: 'PATCH',
      url: `/api/v1/bots/${bot.id}`,
      headers,
      payload: {
        settings: {
          autoResumeAfterManual: false,
          humanTakeoverMinutes: 12,
          silenceOnExternalReply: false,
        },
      },
    });
    expect(updatedBot.statusCode).toBe(200);
    expect(BotDto.parse(updatedBot.json()).settings).toMatchObject({
      autoResumeAfterManual: false,
      humanTakeoverMinutes: 12,
      silenceOnExternalReply: false,
    });
    const faqCreated = await http.inject({
      method: 'POST',
      url: `/api/v1/bots/${bot.id}/faqs`,
      headers,
      payload: { question: 'How long is delivery?', answer: 'Two business days.' },
    });
    expect(faqCreated.statusCode).toBe(201);
    const expandedHistory = TrainingHistoryList.parse(
      (await http.inject({ method: 'GET', url: historyUrl, headers })).json(),
    );
    expect(expandedHistory.data.slice(0, 2).map((entry) => entry.kind)).toEqual([
      'faq',
      'settings',
    ]);
    const importUrl = `/api/v1/bots/${bot.id}/faqs/import`;
    const importPayload = {
      items: [
        { question: 'Imported delivery question?', answer: 'Two days.' },
        { question: 'Imported return policy?', answer: 'Ask for the order number.' },
      ],
    };
    expect(
      (await http.inject({ method: 'POST', url: importUrl, payload: importPayload })).statusCode,
    ).toBe(401);
    expect(
      (
        await http.inject({
          method: 'POST',
          url: importUrl,
          headers: other,
          payload: importPayload,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await http.inject({ method: 'POST', url: importUrl, headers, payload: { items: [] } }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await http.inject({
          method: 'POST',
          url: importUrl,
          headers,
          payload: { items: Array.from({ length: 101 }, () => importPayload.items[0]) },
        })
      ).statusCode,
    ).toBe(400);
    const imported = await http.inject({
      method: 'POST',
      url: importUrl,
      headers,
      payload: importPayload,
    });
    expect(imported.statusCode).toBe(201);
    expect(FaqListResponse.parse(imported.json()).data.map((faq) => faq.source)).toEqual([
      'import',
      'import',
    ]);
    const beforeBad = FaqListResponse.parse(
      (await http.inject({ method: 'GET', url: `/api/v1/bots/${bot.id}/faqs`, headers })).json(),
    ).data.length;
    expect(
      (
        await http.inject({
          method: 'POST',
          url: importUrl,
          headers,
          payload: { items: [importPayload.items[0], { question: 'x', answer: '' }] },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      FaqListResponse.parse(
        (await http.inject({ method: 'GET', url: `/api/v1/bots/${bot.id}/faqs`, headers })).json(),
      ).data,
    ).toHaveLength(beforeBad);

    expect(
      (await http.inject({ method: 'DELETE', url: `${url}/${item.id}`, headers })).statusCode,
    ).toBe(404);
  });
});

describe('HTTP: starter rules', () => {
  it('seeds idempotently, hides the bot from other workspaces and needs authentication', async () => {
    const http = await setup();
    const signup = async (email: string) => {
      const auth = AuthResponse.parse(
        (
          await http.inject({
            method: 'POST',
            url: '/api/v1/auth/signup',
            payload: {
              name: 'Starter Owner',
              email,
              password: 'correct horse battery',
              workspaceName: 'Starter Shop',
              industry: 'retail',
            },
          })
        ).json(),
      );
      const bootstrap = BootstrapResponse.parse(
        (
          await http.inject({
            method: 'GET',
            url: '/api/v1/bootstrap',
            headers: { authorization: `Bearer ${auth.accessToken}` },
          })
        ).json(),
      );
      return {
        authorization: `Bearer ${auth.accessToken}`,
        'x-workspace-id': bootstrap.memberships[0]?.workspaceId ?? '',
      };
    };
    const headers = await signup('starter@example.test');
    const other = await signup('other-starter@example.test');
    const bot = BotDto.parse(
      (
        await http.inject({
          method: 'POST',
          url: '/api/v1/bots',
          headers,
          payload: { name: 'Starter Bot', industry: 'retail' },
        })
      ).json(),
    );
    const items = `/api/v1/bots/${bot.id}/training-items`;
    const url = `${items}/starter-rules`;
    expect((await http.inject({ method: 'POST', url })).statusCode).toBe(401);
    expect((await http.inject({ method: 'POST', url, headers: other })).statusCode).toBe(404);

    const list = async () =>
      TrainingItemList.parse((await http.inject({ method: 'GET', url: items, headers })).json());
    const seeded = await list();
    expect(seeded.data).toHaveLength(STARTER_RULES.length);
    expect(seeded.data.every((i) => i.enabled)).toBe(true);
    // Nothing is missing, so nothing is created.
    const again = await http.inject({ method: 'POST', url, headers });
    expect(again.statusCode).toBe(201);
    expect(TrainingItemList.parse(again.json()).data).toEqual([]);

    const gone = seeded.data.find((i) => i.section === 'after_order');
    await http.inject({ method: 'DELETE', url: `${items}/${gone?.id}`, headers });
    const restored = await http.inject({ method: 'POST', url, headers });
    expect(TrainingItemList.parse(restored.json()).data.map((i) => i.title)).toEqual([gone?.title]);
    expect((await list()).data).toHaveLength(STARTER_RULES.length);
  });
});
