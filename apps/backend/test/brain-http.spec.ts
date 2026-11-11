import fastifyCookie from '@fastify/cookie';
import {
  AuthResponse,
  BootstrapResponse,
  BrainSettingsDto,
  BrainUsageDto,
  ConversationSignalResponse,
  EvaluateSignalsResponse,
  ReplyDraftResponse,
  TodayResponse,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureEnv } from '../src/common/config.js';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter.js';
import { createLogger } from '../src/common/logger.js';
import { AI_LLM_GATEWAY } from '../src/modules/ai/api/index.js';
import { BILLING_FACADE } from '../src/modules/billing/api/index.js';
import { BRAIN_STORE } from '../src/modules/brain/domain/ports/brain.store.js';
import { FakeGateway } from '../src/modules/brain/__tests__/factories/brain-harness.js';
import { MemoryBrainStore } from '../src/modules/brain/__tests__/factories/memory-brain-store.js';
import {
  CONVERSATION_FACADE,
  type ConversationFacade,
  type SignalContext,
} from '../src/modules/conversation/api/index.js';
import { CRM_FACADE, type CrmFacade } from '../src/modules/crm/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../src/modules/workspace/api/index.js';
import { signUpVerified } from './support/signup.js';

let app: NestFastifyApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

const CONV = '0190f5c2-0000-7000-8000-00000000c001';

async function setup() {
  configureEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' });
  const store = new MemoryBrainStore();
  const gateway = new FakeGateway();
  let limit: number | null = 200;
  /** Conversations by id → owning workspace; the brain only reads them through the facade. */
  const owners = new Map<string, string>();
  /** The customer's one message, an hour ago. */
  const at = new Date(Date.now() - 60 * 60_000).toISOString();
  const conversations = {
    signalContext: (ws: WorkspaceId, id: string, after: Date | null) => {
      if (owners.get(id) !== ws) return Promise.resolve(null);
      const messages =
        after && Date.parse(at) <= after.getTime()
          ? []
          : [{ sender: 'customer' as const, text: 'Shop ơi giá bao nhiêu?', at }];
      const ctx: SignalContext = {
        messages,
        facts: {
          status: 'open',
          contactId: null,
          assigneeId: null,
          customerName: 'Khách',
          awaitingSince: at,
          lastInboundAt: at,
          lastMessageSender: 'customer',
          isTest: false,
        },
      };
      return Promise.resolve(ctx);
    },
    todayCandidates: (ws: WorkspaceId, q: { ids: readonly string[]; awaitingBefore: Date }) =>
      Promise.resolve(
        [...owners.entries()]
          .filter(
            ([id, owner]) =>
              owner === ws && (q.ids.includes(id) || Date.parse(at) <= q.awaitingBefore.getTime()),
          )
          .map(([id]) => ({
            id,
            provider: 'facebook',
            status: 'open',
            contactId: null,
            customerName: 'Khách',
            customerAvatarUrl: null,
            assigneeId: null,
            awaitingSince: at,
            lastInboundAt: at,
            followUpAt: null,
            followUpNote: '',
            lastHumanReplyAt: null,
          })),
      ),
    get: (ws: WorkspaceId, id: string) =>
      owners.get(id) === ws
        ? Promise.resolve({ conversation: { id, botId: null }, messages: [] })
        : Promise.reject(new Error('NOT_FOUND')),
  } as unknown as ConversationFacade;
  const billing = {
    entitlements: () => Promise.resolve({ limits: { 'brain.evaluations.daily': limit } }),
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BRAIN_STORE)
    .useValue(store)
    .overrideProvider(CONVERSATION_FACADE)
    .useValue(conversations)
    .overrideProvider(BILLING_FACADE)
    .useValue(billing)
    .overrideProvider(AI_LLM_GATEWAY)
    .useValue(gateway)
    .compile();
  const nest = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: false,
  });
  app = nest;
  await app.register(fastifyCookie);
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpExceptionFilter(createLogger('silent')));
  await app.init();
  const http = app.getHttpAdapter().getInstance();
  await http.ready();
  // Tasks need a database; without one Today reads none.
  const crm = nest.get<CrmFacade>(CRM_FACADE, { strict: false });
  vi.spyOn(crm, 'countOpenTasks').mockResolvedValue(0);
  vi.spyOn(crm, 'listOpenTasks').mockResolvedValue([]);

  const signup = async (email: string) => {
    const res = await signUpVerified(nest, {
      name: 'Owner',
      email,
      password: 'correct horse battery',
      workspaceName: 'Shop',
      industry: 'retail',
    });
    expect(res.statusCode).toBe(201);
    const auth = AuthResponse.parse(res.json());
    const boot = BootstrapResponse.parse(
      (
        await http.inject({
          method: 'GET',
          url: '/api/v1/bootstrap',
          headers: { authorization: `Bearer ${auth.accessToken}` },
        })
      ).json(),
    );
    const ws = boot.memberships[0]?.workspaceId ?? '';
    const headers = { authorization: `Bearer ${auth.accessToken}`, 'x-workspace-id': ws };
    const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: object) =>
      http.inject({ method, url: `/api/v1${url}`, headers, ...(payload ? { payload } : {}) });
    return { ws, call };
  };

  /** Every request after this runs as a member with `role` (the guard reads the membership). */
  const actAs = (role: string) => {
    const workspaces = nest.get<WorkspaceFacade>(WORKSPACE_FACADE, { strict: false });
    const real = workspaces.findMembership.bind(workspaces);
    vi.spyOn(workspaces, 'findMembership').mockImplementation(async (...args) => {
      const m = await real(...args);
      return m ? { ...m, role } : null;
    });
  };

  return {
    store,
    gateway,
    owners,
    signup,
    actAs,
    setLimit: (l: number | null) => {
      limit = l;
    },
  };
}

describe('HTTP: conversation signals', () => {
  it('evaluates under the cap and answers capped over it', async () => {
    const t = await setup();
    const a = await t.signup('brain-cap@example.test');
    t.owners.set(CONV, a.ws);
    t.setLimit(1);

    const before = await a.call('GET', `/conversations/${CONV}/signals`);
    expect(before.statusCode).toBe(200);
    expect(ConversationSignalResponse.parse(before.json()).signal).toBeNull();

    const first = await a.call('POST', `/conversations/${CONV}/signals/evaluate`);
    expect(first.statusCode).toBe(200);
    const ok = EvaluateSignalsResponse.parse(first.json());
    expect(ok.status).toBe('ok');
    expect(ok.signal?.stage).toBe('price_asked');

    // Nothing new since: no call, no evaluation used.
    const again = EvaluateSignalsResponse.parse(
      (await a.call('POST', `/conversations/${CONV}/signals/evaluate`)).json(),
    );
    expect(again.status).toBe('nothing_new');

    // A fresh signal (new messages) but the day is used up.
    t.store.signals.clear();
    const capped = EvaluateSignalsResponse.parse(
      (await a.call('POST', `/conversations/${CONV}/signals/evaluate`)).json(),
    );
    expect(capped.status).toBe('capped');
    expect(t.gateway.calls).toHaveLength(1);

    const usage = BrainUsageDto.parse((await a.call('GET', '/brain/usage')).json());
    expect(usage).toMatchObject({ used: 1, limit: 1 });
  });

  it('locks a stage set by hand and keeps it through evaluations', async () => {
    const t = await setup();
    const a = await t.signup('brain-stage@example.test');
    t.owners.set(CONV, a.ws);

    const set = await a.call('PATCH', `/conversations/${CONV}/signals`, { stage: 'won' });
    expect(set.statusCode).toBe(200);
    expect(ConversationSignalResponse.parse(set.json()).signal).toMatchObject({
      stage: 'won',
      stageLocked: true,
    });
    const ev = EvaluateSignalsResponse.parse(
      (await a.call('POST', `/conversations/${CONV}/signals/evaluate`)).json(),
    );
    expect(ev.signal).toMatchObject({ stage: 'won', stageLocked: true, mood: 'neutral' });

    expect((await a.call('PATCH', `/conversations/${CONV}/signals`, {})).statusCode).toBe(400);
    expect(
      (await a.call('PATCH', `/conversations/${CONV}/signals`, { stage: 'maybe' })).statusCode,
    ).toBe(400);
    // A stage set by hand is always locked: asking for it unlocked is refused.
    expect(
      (
        await a.call('PATCH', `/conversations/${CONV}/signals`, {
          stage: 'won',
          stageLocked: false,
        })
      ).statusCode,
    ).toBe(400);
  });

  it('keeps other businesses out (404) and checks permissions', async () => {
    const t = await setup();
    const a = await t.signup('brain-a@example.test');
    const b = await t.signup('brain-b@example.test');
    t.owners.set(CONV, a.ws);

    expect((await b.call('GET', `/conversations/${CONV}/signals`)).statusCode).toBe(404);
    expect((await b.call('POST', `/conversations/${CONV}/signals/evaluate`)).statusCode).toBe(404);
    expect(
      (await b.call('PATCH', `/conversations/${CONV}/signals`, { stage: 'won' })).statusCode,
    ).toBe(404);
    expect(t.gateway.calls).toHaveLength(0);
    expect((await a.call('GET', '/conversations/not-a-uuid/signals')).statusCode).toBe(400);

    // An analyst reads but may not evaluate, set stages or change settings.
    t.actAs('analyst');
    expect((await a.call('GET', `/conversations/${CONV}/signals`)).statusCode).toBe(200);
    expect((await a.call('POST', `/conversations/${CONV}/signals/evaluate`)).statusCode).toBe(403);
    expect(
      (await a.call('PATCH', `/conversations/${CONV}/signals`, { stage: 'won' })).statusCode,
    ).toBe(403);
    expect((await a.call('GET', '/brain/settings')).statusCode).toBe(200);
    expect(
      (
        await a.call('PUT', '/brain/settings', {
          mode: 'manual',
          idleMinutes: 60,
          briefingEnabled: true,
          briefingHour: 8,
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('HTTP: brain settings', () => {
  it('returns the defaults, validates and saves per business', async () => {
    const t = await setup();
    const a = await t.signup('brain-settings-a@example.test');
    const b = await t.signup('brain-settings-b@example.test');

    expect(BrainSettingsDto.parse((await a.call('GET', '/brain/settings')).json())).toEqual({
      mode: 'auto',
      idleMinutes: 45,
      briefingEnabled: true,
      briefingHour: 8,
    });
    const body = { mode: 'manual', idleMinutes: 90, briefingEnabled: false, briefingHour: 7 };
    for (const bad of [
      { ...body, idleMinutes: 29 },
      { ...body, idleMinutes: 121 },
      { ...body, briefingHour: 24 },
      { ...body, briefingHour: -1 },
      { ...body, mode: 'sometimes' },
    ]) {
      expect((await a.call('PUT', '/brain/settings', bad)).statusCode).toBe(400);
    }
    const saved = await a.call('PUT', '/brain/settings', body);
    expect(saved.statusCode).toBe(200);
    expect(BrainSettingsDto.parse((await a.call('GET', '/brain/settings')).json())).toEqual(body);
    // Another business keeps its own defaults.
    expect(BrainSettingsDto.parse((await b.call('GET', '/brain/settings')).json()).mode).toBe(
      'auto',
    );
  });
});

describe('HTTP: Today', () => {
  it('lists the queues, dismisses an item and drafts a reply', async () => {
    const t = await setup();
    const a = await t.signup('brain-today@example.test');
    const b = await t.signup('brain-today-b@example.test');
    t.owners.set(CONV, a.ws);

    const first = await a.call('GET', '/today');
    expect(first.statusCode).toBe(200);
    const today = TodayResponse.parse(first.json());
    expect(today.queues.map((q) => q.key)).toEqual([
      'attention',
      'unanswered',
      'ready',
      'price_silent',
      'follow_up',
      'tasks',
    ]);
    expect(today.queues[1]?.items[0]).toMatchObject({ conversationId: CONV });

    expect((await b.call('POST', `/today/items/${CONV}/dismiss`)).statusCode).toBe(404);
    expect((await a.call('POST', `/today/items/${CONV}/dismiss`)).statusCode).toBe(204);
    const after = TodayResponse.parse((await a.call('GET', '/today')).json());
    expect(after.queues[1]?.count).toBe(0);

    t.gateway.replies = ['Dạ shop gửi giá ngay ạ.'];
    const draft = await a.call('POST', `/conversations/${CONV}/reply-draft`);
    expect(draft.statusCode).toBe(200);
    expect(ReplyDraftResponse.parse(draft.json()).text).toBe('Dạ shop gửi giá ngay ạ.');
    expect((await b.call('POST', `/conversations/${CONV}/reply-draft`)).statusCode).toBe(404);

    t.actAs('analyst');
    expect((await a.call('GET', '/today')).statusCode).toBe(200);
    expect((await a.call('POST', `/conversations/${CONV}/reply-draft`)).statusCode).toBe(403);
    expect((await a.call('POST', '/today/refresh')).statusCode).toBe(403);
  });
});
