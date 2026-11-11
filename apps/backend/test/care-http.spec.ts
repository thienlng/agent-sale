import fastifyCookie from '@fastify/cookie';
import {
  AiDoneResponse,
  AuthResponse,
  AutonomySettingsResponse,
  BootstrapResponse,
  BulkApproveCareMessagesResponse,
  CareMessageDto,
  CareSettingsResponse,
  ImpactResponse,
  TodayCountsResponse,
  TodayResponse,
} from '@agent-sales/contracts';
import { newId, type WorkspaceId, workspaceId } from '@agent-sales/shared';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureEnv } from '../src/common/config.js';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter.js';
import { createLogger } from '../src/common/logger.js';
import { BILLING_FACADE } from '../src/modules/billing/api/index.js';
import { BRAIN_STORE } from '../src/modules/brain/domain/ports/brain.store.js';
import { MemoryBrainStore } from '../src/modules/brain/__tests__/factories/memory-brain-store.js';
import { blankSignal } from '../src/modules/brain/domain/signal.js';
import { CARE_STORE } from '../src/modules/care/domain/ports/care.store.js';
import { MemoryCareStore } from '../src/modules/care/__tests__/factories/memory-care-store.js';
import {
  CONVERSATION_FACADE,
  type ConversationFacade,
} from '../src/modules/conversation/api/index.js';
import { CRM_FACADE, type CrmFacade } from '../src/modules/crm/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../src/modules/workspace/api/index.js';
import { signUpVerified } from './support/signup.js';

/** The care agent's HTTP routes (ADR-031) on in-memory stores; no database, no Meta call. */
let app: NestFastifyApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});
/** 10:00 in Asia/Ho_Chi_Minh: outside the quiet hours (only `Date` is faked). */
const DAYTIME = new Date('2026-11-11T03:00:00.000Z');

const CONV = '0190f5c2-0000-7000-8000-00000000e001';

async function setup() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(DAYTIME);
  configureEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' });
  const brainStore = new MemoryBrainStore();
  const careStore = new MemoryCareStore();
  const owners = new Map<string, string>();
  const at = new Date(Date.now() - 60 * 60_000).toISOString();
  const sends: { ws: string; id: string; text: string }[] = [];
  const conversations = {
    todayCandidates: (ws: WorkspaceId, q: { ids: readonly string[]; awaitingBefore: Date }) =>
      Promise.resolve(
        [...owners.entries()]
          .filter(([id, owner]) => owner === ws && q.ids.includes(id))
          .map(([id]) => ({
            id,
            provider: 'facebook',
            status: 'open',
            contactId: null,
            customerName: 'Khách',
            customerAvatarUrl: null,
            assigneeId: null,
            awaitingSince: null,
            lastInboundAt: at,
            followUpAt: null,
            followUpNote: '',
            lastHumanReplyAt: null,
          })),
      ),
    commitCareMessage: (ws: WorkspaceId, id: string, input: { text: string }) => {
      sends.push({ ws, id, text: input.text });
      return Promise.resolve({
        id: newId(),
        conversationId: id,
        direction: 'outbound',
        sender: 'bot',
        text: input.text,
        attachments: [],
        status: 'sent',
        externalId: 'm1',
        failureCode: null,
        createdAt: new Date().toISOString(),
        source: 'care',
      });
    },
    followUpFacts: (ws: WorkspaceId, id: string) =>
      Promise.resolve(
        owners.get(id) === ws
          ? {
              id,
              provider: 'facebook',
              status: 'open',
              mode: 'bot',
              assigneeId: null,
              lastInboundAt: at,
              lastMessageSender: 'bot',
              lastHumanAt: null,
            }
          : null,
      ),
    aiTouches: (_ws: WorkspaceId, points: readonly unknown[]) =>
      Promise.resolve(points.map(() => ({ firstBotAt: null, staffAfter: false }))),
  } as unknown as ConversationFacade;
  const billing = { entitlements: () => Promise.resolve({ limits: {} }) };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BRAIN_STORE)
    .useValue(brainStore)
    .overrideProvider(CARE_STORE)
    .useValue(careStore)
    .overrideProvider(CONVERSATION_FACADE)
    .useValue(conversations)
    .overrideProvider(BILLING_FACADE)
    .useValue(billing)
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
    const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
      http.inject({ method, url: `/api/v1${url}`, headers, ...(payload ? { payload } : {}) });
    return { ws, call };
  };
  const workspaces = nest.get<WorkspaceFacade>(WORKSPACE_FACADE, { strict: false });
  const realMembership = workspaces.findMembership.bind(workspaces);
  /** Every request after this runs as a member with `role` (the guard reads the membership). */
  const actAs = (role: string) => {
    vi.spyOn(workspaces, 'findMembership').mockImplementation(async (...args) => {
      const m = await realMembership(...args);
      return m ? { ...m, role } : null;
    });
  };
  /** A draft of the care agent for `conv` in `ws`, open for `hours` more. */
  const draft = async (ws: string, conv = CONV, hours = 10) => {
    const id = newId();
    // The Brain still judges the customer `price_asked` (the follow-up applies).
    await brainStore.saveSignal(workspaceId(ws), {
      ...blankSignal(conv, null, new Date()),
      stage: 'price_asked',
    });
    await careStore.insertMessage(workspaceId(ws), {
      id,
      conversationId: conv,
      enrollmentId: null,
      anchorAt: new Date(at),
      template: 'silent',
      step: 0,
      level: 'suggest',
      text: 'Dạ áo vẫn còn ạ',
      status: 'draft',
      skipReason: null,
      windowClosesAt: new Date(Date.now() + hours * 3_600_000),
      model: 'fake',
      inputTokens: 1,
      outputTokens: 1,
      createdAt: new Date(),
    });
    return id;
  };
  return { careStore, owners, sends, signup, actAs, draft };
}

describe('HTTP: autonomy levels', () => {
  it('defaults to suggest, validates, saves per business and is the owner’s call', async () => {
    const t = await setup();
    const a = await t.signup('care-auto-a@example.test');
    const b = await t.signup('care-auto-b@example.test');
    const read = async (c: typeof a) =>
      AutonomySettingsResponse.parse((await c.call('GET', '/brain/autonomy')).json()).actions[0]
        ?.level;
    expect(await read(a)).toBe('suggest');
    for (const bad of [
      { actions: [{ action: 'care.send_message', level: 'max' }] },
      { actions: [{ action: 'crm.move', level: 'auto' }] },
      { actions: [] },
    ]) {
      expect((await a.call('PUT', '/brain/autonomy', bad)).statusCode).toBe(400);
    }
    const put = await a.call('PUT', '/brain/autonomy', {
      actions: [{ action: 'care.send_message', level: 'act_and_report' }],
    });
    expect(put.statusCode).toBe(200);
    expect(await read(a)).toBe('act_and_report');
    expect(await read(b)).toBe('suggest');
    t.actAs('sales');
    expect((await a.call('GET', '/brain/autonomy')).statusCode).toBe(200);
    expect(
      (
        await a.call('PUT', '/brain/autonomy', {
          actions: [{ action: 'care.send_message', level: 'auto' }],
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('HTTP: care settings', () => {
  it('returns the defaults and the usage, saves a template, validates and guards', async () => {
    const t = await setup();
    const a = await t.signup('care-settings@example.test');
    const s = CareSettingsResponse.parse((await a.call('GET', '/care/settings')).json());
    expect(s.templates.map((x) => [x.key, x.enabled])).toEqual([
      ['silent', true],
      ['ready', true],
      ['after_sale', true],
    ]);
    expect(s).toMatchObject({
      quietHours: { from: 21, to: 8 },
      maxPerConversationPerDay: 2,
      usage: { used: 0, limit: 100 },
    });
    const put = await a.call('PUT', '/care/templates/after_sale', {
      enabled: true,
      instruction: 'Hỏi thăm nhẹ nhàng',
      afterSaleDays: 5,
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ key: 'after_sale', afterSaleDays: 5 });
    expect(
      (
        await a.call('PUT', '/care/templates/silent', {
          enabled: true,
          instruction: 'x'.repeat(501),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await a.call('PUT', '/care/templates/nope', { enabled: true, instruction: '' })).statusCode,
    ).toBe(404);
    t.actAs('care');
    expect(
      (await a.call('PUT', '/care/templates/silent', { enabled: false, instruction: '' }))
        .statusCode,
    ).toBe(403);
  });
});

describe('HTTP: Chờ duyệt', () => {
  it('lists the drafts on Today, sends one, refuses it twice and keeps other businesses out', async () => {
    const t = await setup();
    const a = await t.signup('care-approve-a@example.test');
    const b = await t.signup('care-approve-b@example.test');
    t.owners.set(CONV, a.ws);
    const id = await t.draft(a.ws);

    const today = TodayResponse.parse((await a.call('GET', '/today')).json());
    const approval = today.queues.find((q) => q.key === 'approval');
    expect(approval).toMatchObject({
      count: 1,
      items: [{ careMessageId: id, conversationId: CONV }],
    });
    const counts = TodayCountsResponse.parse((await a.call('GET', '/today/counts')).json());
    expect(counts.counts.approval).toBe(1);
    expect(counts.total).toBeGreaterThanOrEqual(1);

    // Another business sees nothing of it and cannot act on it.
    expect((await b.call('POST', `/today/approval/${id}/approve`, {})).statusCode).toBe(404);
    expect((await b.call('POST', `/today/approval/${id}/reject`)).statusCode).toBe(404);
    expect(
      TodayResponse.parse((await b.call('GET', '/today')).json()).queues.find(
        (q) => q.key === 'approval',
      )?.count,
    ).toBe(0);
    expect((await a.call('POST', '/today/approval/not-a-uuid/approve', {})).statusCode).toBe(400);
    expect(
      (await a.call('POST', `/today/approval/${id}/approve`, { text: 'x'.repeat(2001) }))
        .statusCode,
    ).toBe(400);

    const sent = await a.call('POST', `/today/approval/${id}/approve`, { text: 'Dạ còn ạ' });
    expect(sent.statusCode).toBe(200);
    expect(CareMessageDto.parse(sent.json())).toMatchObject({ status: 'sent', text: 'Dạ còn ạ' });
    expect(t.sends).toEqual([{ ws: a.ws, id: CONV, text: 'Dạ còn ạ' }]);
    const again = await a.call('POST', `/today/approval/${id}/approve`, {});
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { details: { reason: 'CARE_DRAFT_DECIDED' } } });
    expect(t.careStore.audits.map((x) => x.action)).toContain('care.message.sent');
  });

  it('refuses an expired draft, rejects, sends all, and needs contacts.edit', async () => {
    const t = await setup();
    const a = await t.signup('care-bulk@example.test');
    t.owners.set(CONV, a.ws);
    const old = await t.draft(a.ws, CONV, -1);
    expect((await a.call('POST', `/today/approval/${old}/approve`, {})).statusCode).toBe(409);
    const one = await t.draft(a.ws);
    const rejected = await a.call('POST', `/today/approval/${one}/reject`);
    expect(CareMessageDto.parse(rejected.json()).status).toBe('rejected');
    const two = await t.draft(a.ws);
    const all = BulkApproveCareMessagesResponse.parse(
      (await a.call('POST', '/today/approval/approve-all', {})).json(),
    );
    expect(all).toMatchObject({
      sent: 1,
      scheduled: 0,
      notSent: 0,
      results: [{ id: two, status: 'sent' }],
    });
    const done = AiDoneResponse.parse((await a.call('GET', '/today/ai-done')).json());
    expect(done.count).toBe(0); // approved drafts are not "AI đã làm"
    t.actAs('analyst');
    const three = await t.draft(a.ws);
    expect((await a.call('POST', `/today/approval/${three}/approve`, {})).statusCode).toBe(403);
    expect((await a.call('POST', '/today/approval/approve-all', {})).statusCode).toBe(403);
    expect((await a.call('GET', '/today/ai-done')).statusCode).toBe(200);
  });
});

describe('HTTP: Rapiz đã mang lại', () => {
  it('answers the figures per range, validates and is for roles that see every customer', async () => {
    const t = await setup();
    const a = await t.signup('care-impact@example.test');
    const r = await a.call('GET', '/brain/impact?range=7d');
    expect(r.statusCode).toBe(200);
    expect(ImpactResponse.parse(r.json())).toMatchObject({
      range: '7d',
      followUpsSent: 0,
      ai: { orders: 0, revenue: 0 },
    });
    expect(ImpactResponse.parse((await a.call('GET', '/brain/impact')).json()).range).toBe('30d');
    expect((await a.call('GET', '/brain/impact?range=1y')).statusCode).toBe(400);
    t.actAs('sales');
    expect((await a.call('GET', '/brain/impact?range=today')).statusCode).toBe(403);
    t.actAs('analyst');
    expect((await a.call('GET', '/brain/impact?range=today')).statusCode).toBe(200);
  });
});

describe('HTTP: approvals at night', () => {
  it('schedules an approval in the quiet hours for 08:00 and shows it on Today', async () => {
    const t = await setup();
    vi.setSystemTime(new Date('2026-11-11T16:00:00.000Z')); // 23:00 local
    const a = await t.signup('care-night@example.test');
    t.owners.set(CONV, a.ws);
    const id = await t.draft(a.ws, CONV, 20);
    const r = await a.call('POST', `/today/approval/${id}/approve`, {});
    expect(r.statusCode).toBe(200);
    expect(CareMessageDto.parse(r.json())).toMatchObject({
      status: 'scheduled',
      scheduledFor: '2026-11-12T01:00:00.000Z',
    });
    expect(t.sends).toEqual([]);
    const approval = TodayResponse.parse((await a.call('GET', '/today')).json()).queues.find(
      (q) => q.key === 'approval',
    );
    expect(approval).toMatchObject({
      count: 0,
      items: [{ careMessageId: id, scheduledFor: '2026-11-12T01:00:00.000Z' }],
    });
  });
});
