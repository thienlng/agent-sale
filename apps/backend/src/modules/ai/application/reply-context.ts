import type { ChatMessage } from '@agent-sales/ai-core';
import type { PlaygroundRequest, ProductDto } from '@agent-sales/contracts';

import type { BotActionView, PendingAction } from '../../action/api/index.js';
import { knowledgeBlock, type KnowledgeSource } from '../domain/grounding.js';
import type { ConversationSummaryValue } from '../domain/ports/conversation-summary.repository.js';
import { productDetails } from '../domain/product-view.js';
import { safeJson } from './action-tools.js';
import { compressHistory } from './context-compression.js';

/** Added to the last user message once the customer has left a phone number. */
export const PHONE_KNOWN_LINE =
  'The customer already left their phone number; do not ask for it again.';

const SHOP_TIME_ZONE = 'Asia/Ho_Chi_Minh';
/** Products of an interrupted run's tool results whose pictures stay sendable in the re-run. */
const MAX_CARRY_PRODUCTS = 12;
const CARRY_IMAGE_ID = /p:([0-9A-Za-z-]{1,64}):\d+/g;

/** Product ids behind the picture ids an interrupted run's tool results listed (max 12). */
export function carriedProductIds(carry: readonly ChatMessage[]): string[] {
  const ids = carry
    .filter((m) => m.role === 'tool')
    .flatMap((m) => [...m.content.matchAll(CARRY_IMAGE_ID)].map((x) => x[1] ?? ''));
  return [...new Set(ids.filter(Boolean))].slice(0, MAX_CARRY_PRODUCTS);
}

/** Products already discussed in this conversation: their details, so follow-ups need no tool call. */
export function focusBlock(products: readonly ProductDto[]): string {
  if (!products.length) return '';
  return `<focus_products>\n${safeJson(products.map(productDetails))}\n</focus_products>`;
}

/** The call awaiting the customer's answer: the action's name and stored arguments, never an id or URL. */
export function pendingBlock(waiting: BotActionView, pending: PendingAction): string {
  return `<pending_action>\n${safeJson({
    name: waiting.name,
    args: pending.args,
    askedMinutesAgo: Math.max(0, Math.floor((Date.now() - pending.askedAt.getTime()) / 60_000)),
  })}\n</pending_action>`;
}

/** The shop's local date and time; per turn, so it lives in the last user message, never the system prompt. */
export function currentTimeBlock(now: Date): string {
  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone: SHOP_TIME_ZONE,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
  return `<current_time>${text} (${SHOP_TIME_ZONE})</current_time>`;
}

export interface TurnContext {
  profile: string;
  sources: readonly KnowledgeSource[];
  /** Post context and the owner's situations (inside `<shop_situations>`). */
  situations: string;
  focus: string;
  pending: string;
  images: string;
  phoneKnown: boolean;
  now: Date;
}

/**
 * The conversation as plain chat turns from the first customer message on. Customer text is
 * wrapped as data. `times` (when given, aligned with `input.messages`) is cut the same way.
 */
export function historyTurns(
  input: PlaygroundRequest,
  times?: readonly Date[],
): { turns: ChatMessage[]; times: Date[] | null } {
  const firstCustomer = Math.max(
    0,
    input.messages.findIndex((m) => m.role === 'customer'),
  );
  const turns = input.messages
    .slice(firstCustomer)
    .map((m): ChatMessage =>
      m.role === 'bot'
        ? { role: 'assistant', content: m.content }
        : { role: 'user', content: `<customer>\n${m.content}\n</customer>` },
    );
  const aligned = times && times.length === input.messages.length;
  return { turns, times: aligned ? times.slice(firstCustomer) : null };
}

/**
 * Appends the per-turn blocks (profile, knowledge, situations, focus products, pending action,
 * pictures, phone line, current time) to the last user message, so the system prompt and the
 * earlier turns stay byte-stable for prompt caching. Consecutive user messages (a summary followed
 * by a customer turn) are merged: some providers reject two user messages in a row.
 */
export function withTurnContext(turns: readonly ChatMessage[], ctx: TurnContext): ChatMessage[] {
  const merged: ChatMessage[] = [];
  for (const turn of turns) {
    const prev = merged.at(-1);
    if (prev && prev.role === 'user' && turn.role === 'user')
      prev.content = `${prev.content}\n\n${turn.content}`;
    else merged.push({ ...turn });
  }
  const blocks = [
    ctx.profile,
    knowledgeBlock(ctx.sources),
    `<shop_situations>\n${ctx.situations}\n</shop_situations>`,
    ctx.focus,
    ctx.pending,
    ctx.images,
    ctx.phoneKnown ? PHONE_KNOWN_LINE : '',
    currentTimeBlock(ctx.now),
  ].filter(Boolean);
  const lastUser = merged.findLastIndex((m) => m.role === 'user');
  const last = merged[lastUser];
  if (last) last.content = `${blocks.join('\n\n')}\n\n${last.content}`;
  return merged;
}

/**
 * Long histories: older turns are replaced by the conversation summary (Task 4). The stored summary
 * is used only when message times are known (it is keyed by the time of the last covered message);
 * otherwise the overflow is summarised for this turn only. A summarizer failure keeps the full
 * history. `save` is the summary to store (null: nothing new).
 */
export async function compactHistory(
  turns: readonly ChatMessage[],
  opts: {
    times: readonly Date[] | null;
    stored: ConversationSummaryValue | null;
    summarize(text: string, previous: string | null): Promise<string>;
    onError(error: unknown): void;
  },
): Promise<{ turns: ChatMessage[]; save: ConversationSummaryValue | null }> {
  const { times, stored: saved } = opts;
  const stored =
    times && saved
      ? {
          coveredUntilIndex: times.filter((t) => t <= saved.coveredUntil).length,
          summary: saved.summary,
        }
      : null;
  try {
    const out = await compressHistory(turns, { summarize: opts.summarize, stored });
    const next = out.summary;
    const changed =
      next !== null &&
      (stored === null ||
        next.coveredUntilIndex !== stored.coveredUntilIndex ||
        next.summary !== stored.summary);
    const coveredUntil = next && times ? times[next.coveredUntilIndex - 1] : undefined;
    return {
      turns: out.turns,
      save: changed && coveredUntil ? { coveredUntil, summary: next.summary } : null,
    };
  } catch (error) {
    opts.onError(error);
    return { turns: [...turns], save: null };
  }
}
