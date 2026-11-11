import type { GenerateRequest, GenerateResponse } from '@agent-sales/ai-core';
import type { NormalizedEvent } from '@agent-sales/channels';
import type { AutonomyLevel, ConversationSignalDto } from '@agent-sales/contracts';
import { newId, workspaceId } from '@agent-sales/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BotFacade, BotView } from '../src/modules/bot/api/index.js';
import type { BrainFacade } from '../src/modules/brain/api/index.js';
import type { ChannelFacade } from '../src/modules/channel/api/index.js';
import type { CommerceFacade, ConversationOrder } from '../src/modules/commerce/api/index.js';
import { ApprovalService } from '../src/modules/care/application/approval.service.js';
import { CareEnroller } from '../src/modules/care/application/care-enroller.js';
import { CareRunnerImpl } from '../src/modules/care/application/care-runner.js';
import { CareSender } from '../src/modules/care/application/care-sender.js';
import { CareSettingsService } from '../src/modules/care/application/care-settings.service.js';
import { CareStep } from '../src/modules/care/application/care-step.js';
import { CareWriter } from '../src/modules/care/application/care-writer.service.js';
import { ImpactQuery } from '../src/modules/care/application/impact.query.js';
import {
  MemoryCareEvents,
  MemoryCareStore,
} from '../src/modules/care/__tests__/factories/memory-care-store.js';
import { ConversationFacadeImpl } from '../src/modules/conversation/application/conversation.facade.impl.js';
import { MemoryConversationStore } from '../src/modules/conversation/__tests__/factories/memory-conversation-store.js';
import { fakeCrm, fakeIdentity, fakeTeam } from '../src/modules/conversation/__tests__/fakes.js';

/**
 * The care agent end to end on in-memory stores (spec 2026-11-11 care §8): the real conversation
 * facade with a fake channel (never Meta), a scripted model, a Brain stand-in. Enrolled → draft
 * in "Chờ duyệt" → approved → sent as a care bot message → the customer replies → the cycle
 * stops; an order within 7 days → attributed.
 */
const ws = workspaceId('018d0000-0000-7000-8000-00000000c001');
const channelId = '018d0000-0000-7000-8000-00000000c003';
const botId = '018d0000-0000-7000-8000-00000000c004';
const owner = '018d0000-0000-7000-8000-00000000c005';
const H = 3_600_000;
/** 10:00 in Asia/Ho_Chi_Minh. */
const T0 = new Date('2026-11-11T03:00:00.000Z');
const at = (h: number) => new Date(T0.getTime() + h * H);

class ScriptedModel {
  calls: GenerateRequest[] = [];
  replies: string[] = [];
  generate(request: GenerateRequest): Promise<GenerateResponse> {
    this.calls.push(request);
    const text =
      this.replies.shift() ??
      JSON.stringify({
        action: 'send',
        text: 'Dạ áo khoác size M vẫn còn ạ, anh cần em giữ không?',
        reason: '',
      });
    return Promise.resolve({
      text,
      toolCalls: [],
      stopReason: 'end',
      usage: { inputTokens: 900, outputTokens: 60, cachedInputTokens: 0 },
      provider: 'fake',
      model: 'fake-basic',
      latencyMs: 5,
    });
  }
}

function setup(dailyLimit?: number) {
  const conversationStore = new MemoryConversationStore();
  const channels = {
    getConnection: vi.fn(async () => ({
      id: channelId,
      provider: 'facebook' as const,
      externalId: 'page',
      name: 'Page',
      status: 'connected' as const,
      botId,
      expiresAt: null,
      createdAt: new Date().toISOString(),
    })),
    deliver: vi.fn(async () => ({
      externalId: 'm-out',
      status: 'sent' as const,
      failureCode: null,
    })),
  } as unknown as ChannelFacade;
  const bot = {
    id: botId,
    isActive: true,
    humanTakeoverMinutes: 5,
    selfPronoun: 'em',
    customerPronoun: 'anh',
    tone: 'friendly',
    allowEmoji: false,
    language: 'vi',
    profile: { fields: { 'Giờ mở cửa': '8h-22h' }, notes: '' },
  } as unknown as BotView;
  const bots: BotFacade = { getBot: async () => bot };
  const conversations = new ConversationFacadeImpl(
    conversationStore,
    channels,
    bots,
    fakeTeam(),
    fakeIdentity({ [owner]: 'Chủ shop' }),
    fakeCrm() as never,
  );
  const signals = new Map<string, Partial<ConversationSignalDto>>();
  const autonomy = { level: 'suggest' as AutonomyLevel };
  const brain = {
    signalsFor: async (_ws: unknown, ids: readonly string[]) =>
      ids.flatMap((id) => {
        const s = signals.get(id);
        return s
          ? [{ conversationId: id, stage: 'new', optOut: false, note: null, mood: 'neutral', ...s }]
          : [];
      }),
    levelFor: async () => autonomy.level,
  } as unknown as BrainFacade;
  const orders: ConversationOrder[] = [];
  const commerce = {
    latestOrderTimes: async (_ws: unknown, ids: readonly string[]) =>
      orders
        .filter((o) => ids.includes(o.conversationId))
        .map((o) => ({ conversationId: o.conversationId, at: o.createdAt })),
    conversationOrders: async (
      _ws: unknown,
      q: { since: Date; until: Date; orderIds?: readonly string[] },
    ) =>
      orders.filter(
        (o) =>
          o.createdAt >= q.since &&
          o.createdAt < q.until &&
          (!q.orderIds || q.orderIds.includes(o.orderId)),
      ),
  } as unknown as CommerceFacade;
  const billing = {
    entitlements: async () => ({
      limits: dailyLimit === undefined ? {} : { 'care.messages.daily': dailyLimit },
    }),
  } as never;
  const model = new ScriptedModel();
  const store = new MemoryCareStore();
  const events = new MemoryCareEvents();
  const settings = new CareSettingsService(store, billing);
  const writer = new CareWriter(conversations, bots, model);
  const sender = new CareSender(store, conversations);
  const enroller = new CareEnroller(events, store, settings, conversations, commerce);
  const step = new CareStep(store, settings, writer, sender, conversations, brain, commerce);
  const runner = new CareRunnerImpl(store, enroller, step);
  const approvals = new ApprovalService(
    store,
    sender,
    conversations,
    brain,
    fakeIdentity() as never,
  );
  const impact = new ImpactQuery(store, conversations, commerce);
  return {
    conversations,
    conversationStore,
    channels,
    signals,
    autonomy,
    orders,
    model,
    store,
    events,
    runner,
    approvals,
    impact,
    settings,
  };
}

function customer(id: string, text = 'Áo khoác này giá bao nhiêu?'): NormalizedEvent {
  return {
    kind: 'facebook',
    assetExternalId: 'page',
    externalEventId: id,
    externalMessageId: id,
    senderExternalId: 'psid-1',
    type: 'message',
    occurredAt: new Date(),
    text,
    raw: {},
  };
}

/** The customer asked a price at T0, the bot answered, the Brain judged `price_asked`. */
async function pricedConversation(h: ReturnType<typeof setup>): Promise<string> {
  vi.setSystemTime(T0);
  const c = await h.conversations.receive(ws, channelId, customer('in-1'));
  h.events.push({
    workspaceId: ws,
    type: 'conversation.message.received.v1',
    aggregateId: c.id,
    payload: { messageId: 'in-1', type: 'message', occurredAt: T0.toISOString() },
    createdAt: T0,
  });
  vi.setSystemTime(at(0.01));
  await h.conversations.commitBotReply(ws, c.id, {
    revision: c.revision,
    text: 'Dạ áo khoác 450k ạ',
    idempotencyKey: 'bot:in-1',
  });
  vi.setSystemTime(at(0.8));
  h.signals.set(c.id, { stage: 'price_asked', note: 'Khách hỏi giá áo khoác size M, 450k.' });
  h.events.push({
    workspaceId: ws,
    type: 'brain.signals.updated.v1',
    aggregateId: c.id,
    payload: {
      conversationId: c.id,
      stage: 'price_asked',
      optOut: false,
      version: 1,
      occurredAt: at(0.8).toISOString(),
    },
    createdAt: at(0.8),
  });
  await h.runner.tick(at(0.8));
  return c.id;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe('care agent flow (suggest)', () => {
  it('drafts at +2 h, a person approves, it goes out as a care message; a reply stops the cycle', async () => {
    const h = setup();
    const conv = await pricedConversation(h);
    expect(h.store.enrollments).toMatchObject([
      { conversationId: conv, template: 'silent', status: 'active', nextAt: at(2) },
    ]);
    // Not due yet.
    expect(await h.runner.tick(at(1.5))).toBe(0);
    vi.setSystemTime(at(2));
    expect(await h.runner.tick(at(2))).toBe(1);
    expect(h.model.calls).toHaveLength(1);
    expect(h.model.calls[0]?.tier).toBe('basic');
    const user = h.model.calls[0]?.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(user).toContain('Khách hỏi giá áo khoác');
    expect(user).toContain('Giờ mở cửa: 8h-22h');
    expect(h.channels.deliver).toHaveBeenCalledTimes(1); // only the bot reply so far

    const view = { userId: owner, viewAll: true };
    const queue = await h.approvals.approvals(ws, view, at(2), 20);
    expect(queue.count).toBe(1);
    const item = queue.items[0];
    expect(item).toMatchObject({
      conversationId: conv,
      template: 'silent',
      stage: 'price_asked',
      windowClosesAt: at(24).toISOString(),
    });
    // The next step waits until +21 h, which is 07:00 local: moved to 08:00 (+22 h).
    expect(h.store.enrollments[0]).toMatchObject({ step: 1, nextAt: at(22) });

    vi.setSystemTime(at(2.5));
    const sent = await h.approvals.approve(ws, view, item?.careMessageId ?? '', 'Dạ áo vẫn còn ạ');
    expect(sent).toMatchObject({ status: 'sent', text: 'Dạ áo vẫn còn ạ', decidedBy: owner });
    expect(h.channels.deliver).toHaveBeenCalledTimes(2);
    const { messages, conversation } = await h.conversations.get(ws, conv);
    expect(messages.at(-1)).toMatchObject({
      sender: 'bot',
      source: 'care',
      text: 'Dạ áo vẫn còn ạ',
    });
    expect(conversation.mode).toBe('bot');
    await expect(
      h.approvals.approve(ws, view, item?.careMessageId ?? '', undefined),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // The customer answers: the cycle stops, the +21 h step never runs.
    vi.setSystemTime(at(3));
    await h.conversations.receive(ws, channelId, customer('in-2', 'Ok shop'));
    h.events.push({
      workspaceId: ws,
      type: 'conversation.message.received.v1',
      aggregateId: conv,
      payload: { messageId: 'in-2', type: 'message', occurredAt: at(3).toISOString() },
      createdAt: at(3),
    });
    await h.runner.tick(at(3));
    expect(h.store.enrollments[0]).toMatchObject({
      status: 'stopped',
      stopReason: 'customer_replied',
    });
    vi.setSystemTime(at(21));
    expect(await h.runner.tick(at(21))).toBe(0);
    expect(h.model.calls).toHaveLength(1);
  });

  it('expires the draft when the window closes and refuses to send it', async () => {
    const h = setup();
    await pricedConversation(h);
    vi.setSystemTime(at(2));
    await h.runner.tick(at(2));
    const view = { userId: owner, viewAll: true };
    const [item] = (await h.approvals.approvals(ws, view, at(2), 20)).items;
    vi.setSystemTime(at(24));
    expect((await h.approvals.approvals(ws, view, at(24), 20)).count).toBe(0);
    await expect(
      h.approvals.approve(ws, view, item?.careMessageId ?? '', undefined),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(h.channels.deliver).toHaveBeenCalledTimes(1);
  });

  it('never enrolls or messages a customer who opted out, and stops on a member message', async () => {
    const h = setup();
    const conv = await pricedConversation(h);
    h.signals.set(conv, { stage: 'price_asked', optOut: true });
    vi.setSystemTime(at(2));
    await h.runner.tick(at(2));
    expect(h.store.enrollments[0]).toMatchObject({ status: 'stopped', stopReason: 'opted_out' });
    expect(h.model.calls).toHaveLength(0);

    const h2 = setup();
    const conv2 = await pricedConversation(h2);
    vi.setSystemTime(at(1));
    await h2.conversations.send(ws, conv2, { text: 'Em chào anh', idempotencyKey: newId() }, owner);
    vi.setSystemTime(at(2));
    await h2.runner.tick(at(2));
    expect(h2.store.enrollments[0]).toMatchObject({
      status: 'stopped',
      stopReason: 'member_message',
    });
    expect(h2.model.calls).toHaveLength(0);
  });
});

describe('care agent flow (act and report)', () => {
  it('sends at the step time, lists it in "AI đã làm", and keeps quiet hours', async () => {
    const h = setup();
    h.autonomy.level = 'act_and_report';
    const conv = await pricedConversation(h);
    vi.setSystemTime(at(2));
    await h.runner.tick(at(2));
    expect(h.channels.deliver).toHaveBeenCalledTimes(2);
    const [msg] = h.store.messages;
    expect(msg).toMatchObject({ status: 'sent', level: 'act_and_report', conversationId: conv });
    const done = await h.approvals.aiDone(ws, { userId: owner, viewAll: true }, at(2.5));
    expect(done.items).toMatchObject([{ conversationId: conv, repliedAt: null }]);
    // +21 h is 07:00 local the next day: moved to 08:00, still inside the window (closes 10:00).
    vi.setSystemTime(at(21));
    await h.runner.tick(at(21));
    expect(h.store.enrollments[0]).toMatchObject({ step: 1, nextAt: at(22) });
    vi.setSystemTime(at(22));
    await h.runner.tick(at(22));
    expect(h.channels.deliver).toHaveBeenCalledTimes(3);
    expect(h.store.enrollments[0]).toMatchObject({ status: 'done' });
  });

  it('waits for the next day when the daily cap is used up, inside the window only', async () => {
    const h = setup(0);
    h.autonomy.level = 'auto';
    await pricedConversation(h);
    vi.setSystemTime(at(2));
    await h.runner.tick(at(2));
    expect(h.model.calls).toHaveLength(0);
    // Local midnight is quiet: the step moves to 08:00, still before the window closes.
    expect(h.store.enrollments[0]).toMatchObject({ status: 'active', step: 0, nextAt: at(22) });
    vi.setSystemTime(at(22));
    await h.runner.tick(at(22));
    expect(h.store.enrollments[0]).toMatchObject({ status: 'stopped', stopReason: 'capped' });
  });

  it('skips when the model says so', async () => {
    const h = setup();
    h.autonomy.level = 'auto';
    h.model.replies.push(JSON.stringify({ action: 'skip', text: '', reason: 'customer said no' }));
    await pricedConversation(h);
    vi.setSystemTime(at(2));
    await h.runner.tick(at(2));
    expect(h.store.messages[0]).toMatchObject({
      status: 'skipped',
      skipReason: 'customer said no',
    });
    expect(h.channels.deliver).toHaveBeenCalledTimes(1);
  });
});

describe('attribution', () => {
  it('attributes an order within 7 days of the AI touch, and to AI + staff after a member message', async () => {
    const h = setup();
    h.autonomy.level = 'auto';
    const conv = await pricedConversation(h);
    vi.setSystemTime(at(2));
    await h.runner.tick(at(2));
    h.orders.push({
      orderId: 'o1',
      conversationId: conv,
      createdAt: at(5),
      total: 450_000,
      status: 'new',
    });
    const r = await h.impact.impact(ws, '7d', at(6));
    expect(r).toMatchObject({
      followUpsSent: 1,
      repliesReceived: 0,
      ai: { orders: 1, revenue: 450_000 },
      aiStaff: { orders: 0, revenue: 0 },
    });
    vi.setSystemTime(at(6));
    await h.conversations.send(
      ws,
      conv,
      { text: 'Shop xác nhận đơn ạ', idempotencyKey: newId() },
      owner,
    );
    h.orders.push({
      orderId: 'o2',
      conversationId: conv,
      createdAt: at(7),
      total: 200_000,
      status: 'new',
    });
    const r2 = await h.impact.impact(ws, '7d', at(8));
    expect(r2.ai).toEqual({ orders: 1, revenue: 450_000 });
    expect(r2.aiStaff).toEqual({ orders: 1, revenue: 200_000 });
    // 8 days later the touch is too old for a new order.
    h.orders.push({
      orderId: 'o3',
      conversationId: conv,
      createdAt: at(8 * 24),
      total: 1,
      status: 'new',
    });
    const r3 = await h.impact.impact(ws, 'today', at(8 * 24 + 1));
    expect(r3.ai.orders + r3.aiStaff.orders).toBe(0);
  });
});
