import type { GenerateRequest, GenerateResponse } from '@agent-sales/ai-core';
import { workspaceId, type WorkspaceId } from '@agent-sales/shared';

import type { TaskDto } from '@agent-sales/contracts';

import { BrainFacadeImpl } from '../../application/brain.facade.impl.js';
import { Briefing } from '../../application/briefing.js';
import { ReplyDraftService } from '../../application/reply-draft.service.js';
import { TodayQuery } from '../../application/today.query.js';
import { TodayExtensions } from '../../application/today-extensions.js';
import { AutonomyService } from '../../application/autonomy.service.js';
import type { TodayFacts } from '../../domain/today.js';
import { ComplaintAlert } from '../../application/complaint-alert.js';
import { SettingsService } from '../../application/settings.service.js';
import { SignalEvaluator } from '../../application/signal-evaluator.js';
import { SignalRunner } from '../../application/signal-runner.js';
import { SignalScheduler } from '../../application/signal-scheduler.js';
import { UsageService } from '../../application/usage.service.js';
import { MemoryBrainStore, MemoryMessageEvents } from './memory-brain-store.js';

// Other modules' facade types, taken from the constructors (tests reach other modules only
// through what this module's own code already depends on).
type EvaluatorDeps = ConstructorParameters<typeof SignalEvaluator>;
type ConversationFacade = EvaluatorDeps[1];
type CrmFacade = EvaluatorDeps[2];
type AiFacade = EvaluatorDeps[3];
type LlmGatewayPort = EvaluatorDeps[4];
type BillingFacade = ConstructorParameters<typeof UsageService>[1];
type AlertDeps = ConstructorParameters<typeof ComplaintAlert>;
type NotificationFacade = AlertDeps[0];
type WorkspaceFacade = AlertDeps[1];
type AccountFacade = AlertDeps[2];
type NotifyInput = Parameters<NotificationFacade['notify']>[0];
type IdentityFacade = ConstructorParameters<typeof TodayQuery>[3];
type BotFacade = ConstructorParameters<typeof ReplyDraftService>[2];
type TodayDeps = ConstructorParameters<typeof TodayQuery>;
type CommerceFacade = NonNullable<TodayDeps[7]>;
type LodgingFacade = NonNullable<TodayDeps[8]>;
export type SignalContext = NonNullable<Awaited<ReturnType<ConversationFacade['signalContext']>>>;
type SignalContextMessage = SignalContext['messages'][number];

export const WS = workspaceId('0190f5c2-0000-7000-8000-0000000000a1');
export const OTHER_WS = workspaceId('0190f5c2-0000-7000-8000-0000000000a2');
export const CONV = '0190f5c2-0000-7000-8000-00000000c001';
export const OWNER = '0190f5c2-0000-7000-8000-0000000000b1';
export const SALES = '0190f5c2-0000-7000-8000-0000000000b2';
export const ACCOUNT = '0190f5c2-0000-7000-8000-0000000000ac';

/** A valid model answer; override fields per test. */
export function answer(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    stage: 'price_asked',
    intent: 'Hỏi giá áo khoác',
    mood: 'neutral',
    needsHuman: false,
    needsHumanReason: null,
    followUpAt: null,
    followUpReason: null,
    note: 'Khách hỏi giá áo khoác size M.',
    optOut: false,
    ...over,
  });
}

/** Scripted gateway: each call takes the next reply (a text, or an error to throw). */
export class FakeGateway implements LlmGatewayPort {
  calls: GenerateRequest[] = [];
  constructor(public replies: (string | Error)[] = []) {}
  generate(request: GenerateRequest): Promise<GenerateResponse> {
    this.calls.push(request);
    const next = this.replies.shift() ?? answer();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({
      text: next,
      toolCalls: [],
      stopReason: 'end',
      usage: { inputTokens: 1200, outputTokens: 180, cachedInputTokens: 0 },
      provider: 'fake',
      model: 'fake-basic',
      latencyMs: 5,
    });
  }
}

export interface Conversation {
  ws: WorkspaceId;
  messages: SignalContextMessage[];
  facts: SignalContext['facts'];
}

export function conversation(over: Partial<SignalContext['facts']> = {}): Conversation {
  return {
    ws: WS,
    messages: [],
    facts: {
      status: 'open',
      contactId: null,
      assigneeId: null,
      customerName: 'Chị Lan',
      awaitingSince: null,
      lastInboundAt: null,
      lastMessageSender: 'customer',
      isTest: false,
      ...over,
    },
  };
}

/** The application services wired to fakes, the way `brain.module.ts` wires them. */
export function brainHarness(opts: { limit?: number | null | 'missing' } = {}) {
  const store = new MemoryBrainStore();
  const events = new MemoryMessageEvents();
  const gateway = new FakeGateway();
  const conversations = new Map<string, Conversation>();
  const summaries = new Map<string, string>();
  const notified: NotifyInput[] = [];
  let limit: number | null | 'missing' = opts.limit === undefined ? 200 : opts.limit;
  /** Conversation facts Today reads, by id (`todayCandidates`). */
  const facts = new Map<string, TodayFacts & { ws: WorkspaceId; botId?: string | null }>();
  /** Open tasks (already scoped by the fake CRM like the real one: mine + unassigned). */
  const tasks: TaskDto[] = [];
  const members = [
    { userId: OWNER, role: 'owner', status: 'active', joinedAt: new Date(0) },
    { userId: SALES, role: 'sales', status: 'active', joinedAt: new Date(0) },
  ];
  const workspaceIds: WorkspaceId[] = [WS];
  /** Newest order / stay booking per conversation (`latestOrderTimes`, `latestBookingTimes`). */
  const orders = new Map<string, Date>();
  const bookings = new Map<string, Date>();
  const times = (m: Map<string, Date>, ids: readonly string[]) =>
    Promise.resolve(
      ids.flatMap((id) => {
        const at = m.get(id);
        return at ? [{ conversationId: id, at }] : [];
      }),
    );
  const commerce = {
    latestOrderTimes: (_ws: WorkspaceId, ids: readonly string[]) => times(orders, ids),
  } as unknown as CommerceFacade;
  const lodging = {
    latestBookingTimes: (_ws: WorkspaceId, ids: readonly string[]) => times(bookings, ids),
  } as unknown as LodgingFacade;

  const conversationFacade = {
    signalContext: (ws: WorkspaceId, id: string, after: Date | null) => {
      const c = conversations.get(id);
      if (!c || c.ws !== ws) return Promise.resolve(null);
      const since = after?.getTime() ?? Number.NEGATIVE_INFINITY;
      return Promise.resolve({
        messages: c.messages.filter((m) => Date.parse(m.at) > since),
        facts: c.facts,
      });
    },
    todayCandidates: (
      ws: WorkspaceId,
      q: { ids: readonly string[]; awaitingBefore: Date; followUpBefore: Date; limit: number },
    ) =>
      Promise.resolve(
        [...facts.values()]
          .filter((f) => f.ws === ws)
          .filter(
            (f) =>
              q.ids.includes(f.id) ||
              (f.status === 'open' &&
                f.awaitingSince !== null &&
                Date.parse(f.awaitingSince) <= q.awaitingBefore.getTime()) ||
              (f.status !== 'spam' &&
                f.followUpAt !== null &&
                Date.parse(f.followUpAt) <= q.followUpBefore.getTime()),
          )
          .slice(0, q.limit)
          .map(({ ws: _ws, botId: _bot, ...f }) => f),
      ),
    get: (ws: WorkspaceId, id: string) => {
      const f = facts.get(id);
      if (!f || f.ws !== ws) return Promise.reject(new Error('NOT_FOUND'));
      return Promise.resolve({ conversation: { id, botId: f.botId ?? null }, messages: [] });
    },
  } as unknown as ConversationFacade;
  const visibleTask = (t: TaskDto, userId?: string) =>
    t.status === 'open' &&
    (userId === undefined || t.assigneeUserId === null || t.assigneeUserId === userId);
  const crm = {
    getContact: () => Promise.resolve({ phone: '0901234567' }),
    countOpenTasks: (_ws: WorkspaceId, q: { userId?: string; dueBefore: Date }) =>
      Promise.resolve(
        tasks.filter(
          (t) =>
            visibleTask(t, q.userId) &&
            t.dueAt !== null &&
            Date.parse(t.dueAt) < q.dueBefore.getTime(),
        ).length,
      ),
    listOpenTasks: (_ws: WorkspaceId, q: { userId?: string; limit: number }) =>
      Promise.resolve(
        tasks
          .filter((t) => visibleTask(t, q.userId))
          .sort(
            (a, b) =>
              (a.dueAt ? Date.parse(a.dueAt) : Infinity) -
              (b.dueAt ? Date.parse(b.dueAt) : Infinity),
          )
          .slice(0, q.limit),
      ),
  } as unknown as CrmFacade;
  const identity = {
    displayName: (id: string) =>
      Promise.resolve(id === OWNER ? 'Chủ shop' : id === SALES ? 'Bán hàng' : null),
  } as unknown as IdentityFacade;
  const bots = {
    getBot: () =>
      Promise.resolve({
        name: 'Bot Lan',
        selfPronoun: 'em',
        customerPronoun: 'chị',
        tone: 'friendly',
        allowEmoji: false,
        replyLength: 'short',
        language: 'vi',
      }),
  } as unknown as BotFacade;
  const ai = {
    conversationSummary: (_ws: WorkspaceId, id: string) => {
      const summary = summaries.get(id);
      return Promise.resolve(summary ? { summary, coveredUntil: new Date(0).toISOString() } : null);
    },
  } as unknown as AiFacade;
  const billing = {
    entitlements: () =>
      Promise.resolve({
        limits: limit === 'missing' ? {} : { 'brain.evaluations.daily': limit },
      }),
  } as unknown as BillingFacade;
  const notifications = {
    recipientLocale: () => Promise.resolve('vi' as const),
    notify: (i: NotifyInput) => {
      notified.push(i);
      return Promise.resolve({ id: String(notified.length), deduped: false });
    },
  } as unknown as NotificationFacade;
  const workspaces = {
    accountOf: () => Promise.resolve(ACCOUNT),
    getById: () => Promise.resolve({ name: 'Shop Lan' }),
    listMembers: () => Promise.resolve(members),
    listActiveIds: (q: { afterId: WorkspaceId | null; limit: number }) =>
      Promise.resolve(
        workspaceIds.filter((id) => q.afterId === null || id > q.afterId).slice(0, q.limit),
      ),
  } as unknown as WorkspaceFacade;
  const accounts = {
    listForUser: (userId: string) =>
      Promise.resolve(userId === OWNER ? [{ accountId: ACCOUNT, name: 'A', role: 'owner' }] : []),
  } as unknown as AccountFacade;

  const settings = new SettingsService(store);
  const usage = new UsageService(store, billing);
  const alert = new ComplaintAlert(notifications, workspaces, accounts);
  const evaluator = new SignalEvaluator(
    store,
    conversationFacade,
    crm,
    ai,
    gateway,
    usage,
    settings,
    alert,
  );
  const scheduler = new SignalScheduler(events, store, settings);
  const extensions = new TodayExtensions();
  const today = new TodayQuery(
    store,
    conversationFacade,
    crm,
    identity,
    settings,
    usage,
    evaluator,
    commerce,
    lodging,
    extensions,
  );
  const briefing = new Briefing(store, workspaces, notifications, today, extensions);
  const runner = new SignalRunner(store, scheduler, evaluator, briefing);
  const drafts = new ReplyDraftService(store, conversationFacade, bots, gateway, usage);
  const autonomy = new AutonomyService(store);
  const facade = new BrainFacadeImpl(
    store,
    conversationFacade,
    evaluator,
    usage,
    settings,
    autonomy,
  );
  return {
    store,
    events,
    gateway,
    conversations,
    summaries,
    notified,
    settings,
    usage,
    evaluator,
    scheduler,
    runner,
    facade,
    conversationFacade,
    today,
    extensions,
    autonomy,
    briefing,
    drafts,
    facts,
    tasks,
    members,
    workspaceIds,
    orders,
    bookings,
    setLimit: (l: number | null | 'missing') => {
      limit = l;
    },
  };
}
