import type { NormalizedEvent } from '@agent-sales/channels';
import { workspaceId } from '@agent-sales/shared';
import { vi } from 'vitest';
import { ConversationFacadeImpl } from '../../application/conversation.facade.impl.js';
import { MetaInboxProcessor } from '../../application/jobs/meta-inbox.processor.js';
import type { ReplyPacing } from '../../application/jobs/reply-delivery.js';
import { fakeBilling, fakeCrm, fakeIdentity, fakeTeam } from '../fakes.js';
import { MemoryConversationStore } from './memory-conversation-store.js';

/** Shared setup of the Meta processor delivery and interrupt specs (spec §7). */

// Other modules' facade types, taken from the processor's own signature (test helpers may not
// import other modules).
type Deps = ConstructorParameters<typeof MetaInboxProcessor>;
type ChannelFacade = Deps[0];
type AiFacade = Deps[2];
type BotFacade = Deps[3];
type BillingFacade = Deps[4];
type BotView = Awaited<ReturnType<BotFacade['getBot']>>;
type PendingMetaEvent = Parameters<MetaInboxProcessor['process']>[0];
type ReplyOptions = Parameters<AiFacade['reply']>[3];
export type ReplyResult = Awaited<ReturnType<AiFacade['reply']>>;

export const ws = workspaceId('018d0000-0000-7000-8000-000000000001');
export const channelId = '018d0000-0000-7000-8000-000000000003';
export const botId = '018d0000-0000-7000-8000-000000000004';
export const staff = '018d0000-0000-7000-8000-000000000005';
export const pics = [
  { id: 'i1', url: 'https://img.example.com/1.jpg', label: 'one' },
  { id: 'i2', url: 'https://img.example.com/2.jpg', label: 'two' },
];
let seq = 0;

export function job(id: string, text: string, at = Date.now()): PendingMetaEvent {
  const event: NormalizedEvent = {
    kind: 'facebook',
    assetExternalId: 'page',
    externalEventId: id,
    externalMessageId: id,
    senderExternalId: 'customer',
    type: 'message',
    occurredAt: new Date(at),
    text,
    raw: {},
  };
  return {
    id: `dj-${++seq}`,
    claimToken: 't',
    workspaceId: ws,
    connectionId: channelId,
    attempt: 1,
    event,
  };
}

export type Reply = (
  ...args: [unknown, unknown, { messages: { role: string; content: string }[] }, ReplyOptions]
) => Promise<Partial<ReplyResult>>;

export function answer(final: string, extra: Partial<ReplyResult> = {}): Partial<ReplyResult> {
  return {
    reply: final,
    outcome: 'answered',
    images: [],
    messages: final ? [{ text: final, images: [], via: 'final' }] : [],
    ...extra,
  };
}

export function setup(pacing?: ReplyPacing) {
  const bot = {
    id: botId,
    isActive: true,
    silenceOnExternalReply: true,
    handoffMessage: 'Staff will help you',
    fallbackMessage: 'Shop will get back to you',
    language: 'vi',
    selfPronoun: 'em',
    customerPronoun: 'anh/chị',
  } as BotView;
  let sent = 0;
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
      externalId: `sent${++sent}`,
      status: 'sent' as const,
      failureCode: null,
    })),
    fetchCustomerProfile: vi.fn(async () => null),
    claimEvents: vi.fn(async () => [] as PendingMetaEvent[]),
    renewEvent: async () => true,
    completeEvent: vi.fn(async () => undefined),
    releaseEvent: vi.fn(async () => undefined),
    deadLetterEvent: vi.fn(async () => undefined),
    deadLetterExhaustedEvents: vi.fn(async () => [] as string[]),
    presence: vi.fn(async () => undefined),
    requeueEvent: vi.fn(async () => undefined),
    hasNewerCustomerEvent: vi.fn(async () => false),
    unbindBot: vi.fn(async () => 0),
  } as unknown as ChannelFacade & { claimEvents: ReturnType<typeof vi.fn> };
  const bots: BotFacade = { getBot: async () => bot };
  const inbox = new ConversationFacadeImpl(
    new MemoryConversationStore(),
    channels,
    bots,
    fakeTeam(),
    fakeIdentity(),
    fakeCrm() as never,
  );
  const ai = { reply: vi.fn<Reply>(async () => answer('ok')) };
  const billing = fakeBilling();
  const sleeps: number[] = [];
  let clock = 0;
  const recorder: ReplyPacing = {
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  };
  const processor = new MetaInboxProcessor(
    channels,
    inbox,
    ai as unknown as AiFacade,
    bots,
    billing as unknown as BillingFacade,
    { fetch: async () => null },
    false,
    undefined,
    pacing ?? recorder,
  );
  const keys = () => vi.mocked(channels.deliver).mock.calls.map((c) => c[4]);
  const texts = () => vi.mocked(channels.deliver).mock.calls.map((c) => c[3].text);
  const conversationId = async () => (await inbox.list(ws, { limit: 10 } as never)).data[0]!.id;
  const takeOver = async () => {
    await inbox.update(ws, await conversationId(), { mode: 'human' }, staff);
  };
  const run = async (...jobs: PendingMetaEvent[]) => {
    vi.mocked(channels.claimEvents).mockResolvedValueOnce(jobs);
    await processor.tick();
  };
  return {
    billing,
    channels,
    inbox,
    ai,
    processor,
    sleeps,
    keys,
    texts,
    takeOver,
    run,
    conversationId,
  };
}
