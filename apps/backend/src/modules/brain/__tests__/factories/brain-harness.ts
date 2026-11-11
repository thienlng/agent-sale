import type { GenerateRequest, GenerateResponse } from '@agent-sales/ai-core';
import { workspaceId, type WorkspaceId } from '@agent-sales/shared';

import { BrainFacadeImpl } from '../../application/brain.facade.impl.js';
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
  } as unknown as ConversationFacade;
  const crm = {
    getContact: () => Promise.resolve({ phone: '0901234567' }),
  } as unknown as CrmFacade;
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
    listMembers: () =>
      Promise.resolve([
        { userId: OWNER, role: 'owner', status: 'active', joinedAt: new Date(0) },
        { userId: SALES, role: 'sales', status: 'active', joinedAt: new Date(0) },
      ]),
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
  const runner = new SignalRunner(store, scheduler, evaluator);
  const facade = new BrainFacadeImpl(store, conversationFacade, evaluator, usage, settings);
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
    setLimit: (l: number | null | 'missing') => {
      limit = l;
    },
  };
}
