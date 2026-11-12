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
import { CareGuard } from '../src/modules/care/application/care-guard.js';
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
  /** Runs while the model "writes" (a race lands here). */
  onCall: (() => Promise<void>) | null = null;
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    this.calls.push(request);
    await this.onCall?.();
    const text =
      this.replies.shift() ??
      JSON.stringify({
        action: 'send',
        text: 'Dạ áo khoác size M vẫn còn ạ, anh cần em giữ không?',
        reason: '',
      });
    return {
      text,
      toolCalls: [],
      stopReason: 'end',
      usage: { inputTokens: 900, outputTokens: 60, cachedInputTokens: 0 },
      provider: 'fake',
      model: 'fake-basic',
      latencyMs: 5,
    };
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
          ? [
              {
                conversationId: id,
                stage: 'new',
                optOut: false,
                note: null,
                mood: 'neutral',
                evaluatedUntil: T0.toISOString(),
                ...s,
              },
            ]
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
  const enroller = new CareEnroller(events, store, settings, conversations, brain, commerce);
  const guard = new CareGuard(settings, conversations, brain, commerce);
  const step = new CareStep(store, settings, writer, sender, guard, brain);
  const approvals = new ApprovalService(
    store,
    sender,
    guard,
    conversations,
    brain,
    fakeIdentity() as never,
  );
  const runner = new CareRunnerImpl(store, enroller, step, approvals);
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

function customer(
  id: string,
  text = 'Áo khoác này giá bao nhiêu?',
  psid = 'psid-1',
): NormalizedEvent {
  return {
    kind: 'facebook',
    assetExternalId: 'page',
    externalEventId: id,
    externalMessageId: id,
    senderExternalId: psid,
    type: 'message',
    occurredAt: new Date(),
    text,
    raw: {},
  };
}

/** The customer asked a price at T0, the bot answered, the Brain judged `price_asked`. */
async function pricedConversation(h: ReturnType<typeof setup>, psid = 'psid-1'): Promise<string> {
  vi.setSystemTime(T0);
  const c = await h.conversations.receive(ws, channelId, customer(`in-1-${psid}`, undefined, psid));
  h.events.push({
    workspaceId: ws,
    type: 'conversation.message.received.v1',
    aggregateId: c.id,
    payload: { messageId: `in-1-${psid}`, type: 'message', occurredAt: T0.toISOString() },
    createdAt: T0,
  });
  vi.setSystemTime(at(0.01));
  await h.conversations.commitBotReply(ws, c.id, {
    revision: c.revision,
    text: 'Dạ áo khoác 450k ạ',
    idempotencyKey: `bot:in-1-${psid}`,
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
    ).rejects.toMatchObject({ code: 'CARE_DRAFT_DECIDED' });

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
    ).rejects.toMatchObject({ code: 'CARE_WINDOW_CLOSED' });
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

  it('turns an automatic send with an invented price into a draft the owner approves', async () => {
    const h = setup();
    h.autonomy.level = 'auto';
    h.model.replies.push(
      JSON.stringify({ action: 'send', text: 'Dạ áo khoác hôm nay chỉ còn 199k ạ', reason: '' }),
    );
    await pricedConversation(h);
    vi.setSystemTime(at(2));
    await h.runner.tick(at(2));
    expect(h.store.messages[0]).toMatchObject({ status: 'draft', level: 'auto' });
    // Only the bot's own answer went out; the follow-up waits for approval.
    expect(h.channels.deliver).toHaveBeenCalledTimes(1);
  });

  it('sends automatically when the price comes from what the shop already said', async () => {
    const h = setup();
    h.autonomy.level = 'auto';
    h.model.replies.push(
      JSON.stringify({ action: 'send', text: 'Dạ áo khoác 450k vẫn còn size M ạ', reason: '' }),
    );
    await pricedConversation(h);
    vi.setSystemTime(at(2));
    await h.runner.tick(at(2));
    expect(h.store.messages[0]).toMatchObject({ status: 'sent' });
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

describe('enrollment', () => {
  it('starts no cycle from a judgement that did not read the last customer message', async () => {
    const h = setup();
    vi.setSystemTime(T0);
    const c = await h.conversations.receive(ws, channelId, customer('in-x'));
    h.signals.set(c.id, { stage: 'price_asked', evaluatedUntil: at(-1).toISOString() });
    h.events.push({
      workspaceId: ws,
      type: 'brain.signals.updated.v1',
      aggregateId: c.id,
      payload: {
        conversationId: c.id,
        stage: 'price_asked',
        optOut: false,
        version: 1,
        occurredAt: T0.toISOString(),
      },
      createdAt: T0,
    });
    await h.runner.tick(at(0.5));
    expect(h.store.enrollments).toEqual([]);
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

const view = { userId: owner, viewAll: true };
/** The draft of the first conversation, written at +2 h (12:00 local). */
async function drafted(h: ReturnType<typeof setup>, psid = 'psid-1') {
  const conv = await pricedConversation(h, psid);
  vi.setSystemTime(at(2));
  await h.runner.tick(at(2));
  const draft = h.store.messages.find((m) => m.conversationId === conv && m.status === 'draft');
  return { conv, id: draft?.id ?? '' };
}
const usedToday = (h: ReturnType<typeof setup>) => h.settings.settings(ws, at(2));

describe('races: nothing goes out after the customer wrote again', () => {
  it('worker: a customer message during the model call wins; the bot can still answer it', async () => {
    const h = setup();
    h.autonomy.level = 'act_and_report';
    const conv = await pricedConversation(h);
    vi.setSystemTime(at(2));
    h.model.onCall = async () => {
      await h.conversations.receive(ws, channelId, customer('in-race', 'Còn size L không?'));
    };
    await h.runner.tick(at(2));
    expect(h.channels.deliver).toHaveBeenCalledTimes(1); // the bot's first answer only
    expect(h.store.messages[0]).toMatchObject({
      status: 'expired',
      skipReason: 'customer_replied',
    });
    expect(h.store.enrollments[0]).toMatchObject({
      status: 'stopped',
      stopReason: 'customer_replied',
    });
    const { conversation } = await h.conversations.get(ws, conv);
    expect(conversation.awaitingSince).not.toBeNull(); // still on Today's "unanswered"
    // The bot's in-flight answer to the new message is not fenced off by the follow-up.
    expect(
      await h.conversations.commitBotReply(ws, conv, {
        revision: conversation.revision,
        text: 'Dạ còn size L ạ',
        idempotencyKey: 'bot:in-race',
      }),
    ).toMatchObject({ status: 'sent' });
    // The daily reservation was given back.
    expect((await usedToday(h)).usage.used).toBe(0);
  });

  it('approval: a customer message with no enroller pass expires the draft (409)', async () => {
    const h = setup();
    const { conv, id } = await drafted(h);
    vi.setSystemTime(at(2.5));
    await h.conversations.receive(ws, channelId, customer('in-2', 'Ok để em nghĩ'));
    // No outbox pass ran: only the approval's own checks stand between the draft and a send.
    await expect(h.approvals.approve(ws, view, id, undefined, at(2.5))).rejects.toMatchObject({
      code: 'CARE_CUSTOMER_REPLIED',
    });
    expect(h.channels.deliver).toHaveBeenCalledTimes(1);
    expect(h.store.messages.find((m) => m.id === id)?.status).toBe('expired');
    expect((await h.conversations.get(ws, conv)).conversation.awaitingSince).not.toBeNull();
  });

  it('approval: a customer message between the checks and the send is refused in the reservation', async () => {
    const h = setup();
    const { id } = await drafted(h);
    vi.setSystemTime(at(2.5));
    // Lands after the approval read the facts, right before the send reserves the message.
    const commit = h.conversations.commitCareMessage.bind(h.conversations);
    vi.spyOn(h.conversations, 'commitCareMessage').mockImplementationOnce(async (...args) => {
      await h.conversations.receive(ws, channelId, customer('in-late', 'Thôi khỏi'));
      return commit(...args);
    });
    await expect(h.approvals.approve(ws, view, id, undefined, at(2.5))).rejects.toMatchObject({
      code: 'CARE_CUSTOMER_REPLIED',
    });
    expect(h.channels.deliver).toHaveBeenCalledTimes(1);
    expect(h.store.messages.find((m) => m.id === id)).toMatchObject({
      status: 'expired',
      skipReason: 'customer_replied',
    });
  });

  it('approval: an order or opt-out read fresh expires the draft', async () => {
    const h = setup();
    const { conv, id } = await drafted(h);
    h.orders.push({
      orderId: 'o1',
      conversationId: conv,
      createdAt: at(2.2),
      total: 1,
      status: 'new',
    });
    await expect(h.approvals.approve(ws, view, id, undefined, at(2.5))).rejects.toMatchObject({
      code: 'CARE_STOPPED',
      details: { stopReason: 'ordered' },
    });
    expect(h.channels.deliver).toHaveBeenCalledTimes(1);
  });
});

describe('takeover and hand-off', () => {
  it('refuses to approve while a person holds the conversation and expires the draft', async () => {
    const h = setup();
    const { conv, id } = await drafted(h);
    await h.conversations.update(ws, conv, { mode: 'human' }, owner);
    await expect(h.approvals.approve(ws, view, id, undefined, at(2.5))).rejects.toMatchObject({
      code: 'CARE_TAKEN_OVER',
    });
    expect(h.store.messages.find((m) => m.id === id)?.status).toBe('expired');
    expect(h.channels.deliver).toHaveBeenCalledTimes(1);
  });

  it('a hand-off event expires the open drafts and stops the cycle', async () => {
    const h = setup();
    const { conv, id } = await drafted(h);
    await h.conversations.handOff(ws, conv, owner);
    h.events.push({
      workspaceId: ws,
      type: 'conversation.control.updated.v1',
      aggregateId: conv,
      payload: { mode: 'human', status: 'open', actorId: owner, revision: 9 },
      createdAt: at(2.2),
    });
    await h.runner.tick(at(2.2));
    expect(h.store.messages.find((m) => m.id === id)?.status).toBe('expired');
    expect(h.store.enrollments[0]).toMatchObject({ status: 'stopped', stopReason: 'taken_over' });
  });
});

describe('a step is sent once', () => {
  it('a re-run of a step that already sent (crash before advance) writes and sends nothing', async () => {
    const h = setup();
    h.autonomy.level = 'auto';
    await pricedConversation(h);
    vi.setSystemTime(at(2));
    await h.runner.tick(at(2));
    expect(h.channels.deliver).toHaveBeenCalledTimes(2);
    // As if `advance` never happened and the lease ran out.
    Object.assign(h.store.enrollments[0] ?? {}, { step: 0, nextAt: at(2), leaseUntil: null });
    vi.setSystemTime(at(3));
    await h.runner.tick(at(3));
    expect(h.model.calls).toHaveLength(1);
    expect(h.channels.deliver).toHaveBeenCalledTimes(2);
    expect(h.store.messages).toHaveLength(1);
    expect(h.store.enrollments[0]).toMatchObject({ step: 1, status: 'active' });
  });

  it('a doubled run that loses the insert race sends nothing and gives the reservation back', async () => {
    const h = setup();
    h.autonomy.level = 'auto';
    await pricedConversation(h);
    vi.setSystemTime(at(2));
    const job = h.store.enrollments[0];
    h.store.beforeInsert = () => {
      h.store.beforeInsert = null;
      // The other run wrote the step first.
      h.store.messages.push({
        ...(h.store.messages[0] as (typeof h.store.messages)[number]),
        id: newId(),
        workspaceId: ws,
        conversationId: job?.conversationId ?? '',
        enrollmentId: job?.id ?? null,
        anchorAt: job?.anchorAt ?? T0,
        step: 0,
        status: 'sending',
        template: 'silent',
        level: 'auto',
        text: 'x',
        skipReason: null,
        windowClosesAt: null,
        scheduledFor: null,
        sentMessageId: null,
        sentAt: null,
        decidedBy: null,
        decidedAt: null,
        createdAt: at(2),
        updatedAt: at(2),
      });
    };
    await h.runner.tick(at(2));
    expect(h.channels.deliver).toHaveBeenCalledTimes(1);
    expect((await usedToday(h)).usage.used).toBe(0);
    // The send in flight counts toward the per-conversation limit.
    expect(await h.store.sentTimes(ws, job?.conversationId ?? '', at(0))).toHaveLength(1);
  });

  it('gives the daily reservation back when the channel refuses the send', async () => {
    const h = setup();
    h.autonomy.level = 'auto';
    await pricedConversation(h);
    vi.mocked(h.channels.deliver).mockResolvedValueOnce({
      externalId: null,
      status: 'failed',
      failureCode: 'meta_error',
    } as never);
    vi.setSystemTime(at(2));
    await h.runner.tick(at(2));
    expect(h.store.messages[0]?.status).toBe('failed');
    expect((await usedToday(h)).usage.used).toBe(0);
  });
});

describe('approvals in the quiet hours and the limit', () => {
  it('schedules an approval at 23:00 for 08:00 and sends it then', async () => {
    const h = setup();
    const { id } = await drafted(h);
    vi.setSystemTime(at(13)); // 23:00 local
    const dto = await h.approvals.approve(ws, view, id, 'Dạ áo vẫn còn ạ', at(13));
    expect(dto).toMatchObject({ status: 'scheduled', scheduledFor: at(22).toISOString() });
    const queue = await h.approvals.approvals(ws, view, at(13), 20);
    expect(queue.count).toBe(0);
    expect(queue.items).toMatchObject([{ careMessageId: id, scheduledFor: at(22).toISOString() }]);
    await h.runner.tick(at(13));
    expect(h.channels.deliver).toHaveBeenCalledTimes(1);
    vi.setSystemTime(at(22));
    await h.runner.tick(at(22));
    expect(h.store.messages.find((m) => m.id === id)).toMatchObject({
      status: 'sent',
      text: 'Dạ áo vẫn còn ạ',
      decidedBy: owner,
    });
  });

  it('expires a scheduled approval when the customer wrote before 08:00', async () => {
    const h = setup();
    const { id } = await drafted(h);
    await h.approvals.approve(ws, view, id, undefined, at(13));
    vi.setSystemTime(at(15));
    await h.conversations.receive(ws, channelId, customer('in-night', 'Mai em ghé'));
    vi.setSystemTime(at(22));
    await h.runner.tick(at(22));
    expect(h.store.messages.find((m) => m.id === id)?.status).toBe('expired');
    expect(h.channels.deliver).toHaveBeenCalledTimes(1);
  });

  it('applies the 2-per-24 h limit to approvals (the draft stays)', async () => {
    const h = setup();
    const { conv, id } = await drafted(h);
    for (const at0 of [at(1), at(1.5)])
      h.store.messages.push({
        ...(h.store.messages[0] as (typeof h.store.messages)[number]),
        id: newId(),
        conversationId: conv,
        enrollmentId: null,
        status: 'sent',
        sentAt: at0,
      });
    await expect(h.approvals.approve(ws, view, id, undefined, at(2.5))).rejects.toMatchObject({
      code: 'CARE_LIMIT_REACHED',
    });
    expect(h.store.messages.find((m) => m.id === id)?.status).toBe('draft');
  });

  it('"Gửi tất cả" sends the first few and queues the rest for the worker', async () => {
    const h = setup();
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push((await drafted(h, `psid-${i}`)).id);
    const r = await h.approvals.approveAll(ws, view, undefined, at(2.5));
    expect(r).toMatchObject({ sent: 5, scheduled: 2, notSent: 0 });
    vi.setSystemTime(at(2.6));
    await h.runner.tick(at(2.6));
    expect(h.store.messages.filter((m) => ids.includes(m.id) && m.status === 'sent')).toHaveLength(
      7,
    );
  });
});

describe('housekeeping', () => {
  it('closes after-sales check-ins once they leave Today', async () => {
    const h = setup();
    const conv = await pricedConversation(h);
    await h.store.enroll(ws, {
      conversationId: conv,
      template: 'after_sale',
      anchorAt: at(-100),
      nextAt: at(-24),
    });
    await h.runner.tick(at(5 * 24));
    expect(h.store.enrollments.find((e) => e.template === 'after_sale')?.status).toBe('active');
    await h.runner.tick(at(7 * 24));
    expect(h.store.enrollments.find((e) => e.template === 'after_sale')?.status).toBe('done');
  });

  it('counts a customer who answered two follow-ups once', async () => {
    const h = setup();
    h.autonomy.level = 'auto';
    const conv = await pricedConversation(h);
    vi.setSystemTime(at(2));
    await h.runner.tick(at(2));
    vi.setSystemTime(at(22));
    await h.runner.tick(at(22));
    expect(h.store.messages.filter((m) => m.status === 'sent')).toHaveLength(2);
    vi.setSystemTime(at(23));
    await h.conversations.receive(ws, channelId, customer('in-back', 'Cho em 1 cái'));
    const r = await h.impact.impact(ws, '7d', at(23.5));
    expect(r).toMatchObject({ followUpsSent: 2, repliesReceived: 1 });
    expect(conv).toBeTruthy();
  });
});
