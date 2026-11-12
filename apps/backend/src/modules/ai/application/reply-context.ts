import {
  type ChatMessage,
  PROMPTS_DIR,
  type PromptRef,
  PromptRegistry,
} from '@agent-sales/ai-core';
import type { PlaygroundRequest, ProductDto, WebsitePageContext } from '@agent-sales/contracts';
import { escapeTags, normalizeVnPhone } from '@agent-sales/shared';

import type { BotActionView, PendingAction } from '../../action/api/index.js';
import type { BotView } from '../../bot/api/index.js';
import { knowledgeBlock, type KnowledgeSource } from '../domain/grounding.js';
import { navTargets } from '../domain/page-nav.js';
import type { ConversationSummaryValue } from '../domain/ports/conversation-summary.repository.js';
import { productDetails } from '../domain/product-view.js';
import { replyStyle } from '../domain/reply-style.js';
import { safeJson } from './action-tools.js';
import { COMPRESS_AT_TURNS, compressHistory, summaryMessage } from './context-compression.js';

/** Added to the last user message once the customer has left a phone number. */
export const PHONE_KNOWN_LINE =
  'The customer already left their phone number; do not ask for it again.';
export const EMAIL_KNOWN_LINE =
  'The customer already left their email address; do not ask for it again.';

/** Added to the last user message when older turns holding the customer's phone were folded away. */
export const earlierPhonesLine = (phones: readonly string[]): string =>
  `Phone numbers the customer wrote in earlier messages (now summarized): ${phones.join(', ')}.`;
const MAX_EARLIER_PHONES = 3;

export const SHOP_TIME_ZONE = 'Asia/Ho_Chi_Minh';
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

const RENDERER = new PromptRegistry(PROMPTS_DIR);

/**
 * The bot's system prompt: the prompt template filled with the bot's settings and style. Byte-stable
 * per bot (everything per turn rides on the last user message); turn traces store its sha256 and
 * the trace reader recomputes it to tell whether the instructions changed since.
 */
export function renderBotSystemPrompt(
  bot: BotView,
  workspace: { name: string },
  template: string,
): string {
  return RENDERER.render(template, {
    'bot.name': bot.name,
    // The shop's own name beats the account's workspace name (the profile's display name first).
    'workspace.name':
      bot.profile.fields.displayName || bot.placeholders['store.name'] || workspace.name,
    'bot.language': bot.language === 'en' ? 'English' : 'Vietnamese',
    'bot.selfPronoun': bot.selfPronoun,
    'bot.customerPronoun': bot.customerPronoun,
    'bot.style': replyStyle(bot),
    'bot.mission': bot.mission || '(not described yet)',
  });
}

/** The prompt refs of a stored `ai_runs.prompt_version` (`sales-agent@15+fanpage-context@2`); null if malformed. */
export function promptRefsOf(promptVersion: string): PromptRef[] | null {
  const refs = promptVersion.split('+').map((part) => {
    const m = /^([a-z0-9-]+)@(\d+)$/.exec(part);
    return m?.[1] && m[2] ? { name: m[1], version: Number(m[2]) } : null;
  });
  return refs.length && refs.every((r) => r !== null) ? (refs as PromptRef[]) : null;
}

/** The reply template of the given prompts, as the reply path joins them. */
export async function loadReplyTemplate(
  prompts: PromptRegistry,
  refs: readonly PromptRef[],
): Promise<string> {
  const texts = await Promise.all(refs.map((ref) => prompts.load(ref)));
  return texts.filter(Boolean).join('\n\n');
}

/** Products already discussed in this conversation: their details, so follow-ups need no tool call. */
export function focusBlock(products: readonly ProductDto[]): string {
  if (!products.length) return '';
  return `<focus_products>\n${safeJson(products.map(productDetails))}\n</focus_products>`;
}

/**
 * The website page the visitor wrote from (untrusted: reported by their browser). The URL loses
 * its query and fragment, which can carry the visitor's own data (tokens, emails in links).
 * `navigation` lists the places `suggest_next` may link to, by id (`here`: a section of this page).
 */
export function visitorPageBlock(page: WebsitePageContext): string {
  let path: string;
  try {
    const url = new URL(page.url);
    path = `${url.origin}${url.pathname}`;
  } catch {
    path = '';
  }
  const navigation = navTargets(page).map((t) => ({
    id: t.id,
    label: t.label,
    path: t.path,
    ...(t.here ? { here: true } : {}),
  }));
  return `<visitor_page>\n${safeJson({
    url: path,
    title: page.title,
    onScreen: page.sections,
    ...(navigation.length ? { navigation } : {}),
  })}\n</visitor_page>`;
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
  /** Phones the customer wrote in turns no longer in the history (`earlierPhones`). */
  earlierPhones?: readonly string[];
  /** A website visitor left an email (no line when absent). */
  emailKnown?: boolean;
  now: Date;
}

/**
 * The conversation as plain chat turns from the first customer message on. Customer text is
 * wrapped as data, with `<` escaped: a message cannot close `<customer>` and pass a block such as
 * `<shop_situations>` or `<tool_result>` that would look like the shop's own. `times` (when given, aligned with `input.messages`) is cut the same way.
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
        : { role: 'user', content: `<customer>\n${escapeTags(m.content)}\n</customer>` },
    );
  const aligned = times && times.length === input.messages.length;
  return { turns, times: aligned ? times.slice(firstCustomer) : null };
}

/** The Vietnamese mobile numbers in `text` as written ("0987 654 321"), digit-run splits included. */
export function phonesIn(text: string): string[] {
  const out: string[] = [];
  for (const candidate of text.match(/\+?\d(?:[\s.\-()]?\d)+/g) ?? []) {
    if (normalizeVnPhone(candidate)) {
      out.push(candidate.trim());
      continue;
    }
    // "18 người, 0987 654 321" is split by the comma; "mua 2 0912345678" glues a quantity on.
    // Digit groups at even indexes, the separators as written between them.
    const parts = candidate.split(/([\s.\-()]+)/);
    const groups = Math.ceil(parts.length / 2);
    search: for (let from = 0; from < groups; from++)
      for (let to = groups; to > from; to--) {
        const joined = parts.slice(2 * from, 2 * to - 1).join('');
        if ((from > 0 || to < groups) && normalizeVnPhone(joined)) {
          out.push(joined);
          break search;
        }
      }
  }
  return out;
}

/**
 * EV-2: the phone numbers the customer wrote in turns that are no longer sent as they are (folded
 * into the summary, or cut by the summarizer fallback). A summary may drop a number; the customer
 * then asks "what number did I give you?" and the bot must still read it back. At most 3, the
 * first spelling of each number, oldest first; numbers still visible in `kept` are left out.
 */
export function earlierPhones(all: readonly ChatMessage[], kept: readonly ChatMessage[]): string[] {
  const keptSet = new Set(kept);
  const visible = new Set(
    kept.flatMap((t) => (t.role === 'user' ? phonesIn(t.content) : [])).map(normalizeVnPhone),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const turn of all) {
    if (turn.role !== 'user' || keptSet.has(turn)) continue;
    for (const phone of phonesIn(turn.content)) {
      const key = normalizeVnPhone(phone);
      if (!key || visible.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push(phone);
    }
  }
  return out.slice(-MAX_EARLIER_PHONES);
}

const SELF = '(anh|chị|chi|em|cô|chú|bác)';
const VERBS =
  '(hỏi|hoi|muốn|muon|cần|can|lấy|lay|đặt|dat|mua|xem|định|dinh|thấy|thay|ở|đang|dang|có|co|đi|di|tên|ten|chốt|chot|gửi|gui|nhận|nhan|ship|đổi|doi|thích|thich|chọn|chon|là|la)';
const SELF_PATTERNS = [
  // "Anh hỏi bộ…", "chị lấy 2 cái" (a vocative "chị ơi" is the customer calling the shop).
  new RegExp(`(?:^|[.!?,\\n]\\s*)${SELF}\\s+${VERBS}(?![\\p{L}])`, 'giu'),
  // "cho chị xem", "giúp em với"
  new RegExp(
    `(?<![\\p{L}])(?:cho|giúp|giup|giùm|gium)\\s+${SELF}(?![\\p{L}])(?!\\s+(ơi|oi))`,
    'giu',
  ),
];

/**
 * EV-4 / TM2 pronouns: how the customer refers to themselves, from their latest message that says
 * it ("Anh hỏi…" → "anh"); null when no message does. Read from the turns the model receives.
 */
export function customerSelfPronoun(customerTexts: readonly string[]): string | null {
  for (let i = customerTexts.length - 1; i >= 0; i -= 1) {
    const text = customerTexts[i] ?? '';
    for (const pattern of SELF_PATTERNS)
      for (const m of text.matchAll(pattern)) {
        const word = (m[1] ?? '').toLowerCase();
        return word === 'chi' ? 'chị' : word;
      }
  }
  return null;
}

/** The per-turn line that names the customer's pronoun (null pronoun: no line). */
export function customerPronounLine(pronoun: string | null): string {
  if (!pronoun) return '';
  if (pronoun === 'em')
    return 'The customer calls themselves "em": never call them "anh" or "chị"; write without a second-person pronoun.';
  return `The customer calls themselves "${pronoun}": address them as "${pronoun}" at least once in this reply.`;
}

const customerBlock = (content: string): string | null => {
  const m = /<customer>\n([\s\S]*?)\n<\/customer>/.exec(content);
  return m ? (m[1] ?? '') : null;
};

/**
 * Appends the per-turn blocks (profile, knowledge, situations, focus products, pending action,
 * pictures, phone and email lines, current time) to the last user message, so the system prompt and the
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
  const pronoun = customerSelfPronoun(
    turns.flatMap((t) => (t.role === 'user' ? [customerBlock(t.content) ?? ''] : [])),
  );
  const blocks = [
    ctx.profile,
    knowledgeBlock(ctx.sources),
    `<shop_situations>\n${ctx.situations}\n</shop_situations>`,
    ctx.focus,
    ctx.pending,
    ctx.images,
    ctx.phoneKnown ? PHONE_KNOWN_LINE : '',
    customerPronounLine(pronoun),
    ctx.earlierPhones?.length ? earlierPhonesLine(ctx.earlierPhones) : '',
    ctx.emailKnown ? EMAIL_KNOWN_LINE : '',
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
 * otherwise the overflow is summarised for this turn only. A summarizer failure falls back to the
 * stored summary (if any) plus the newest `COMPRESS_AT_TURNS` turns, so a failing summarizer never
 * sends the whole window. `save` is the summary to store (null: nothing new).
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
    const tail = turns.slice(
      Math.max(stored?.coveredUntilIndex ?? 0, turns.length - COMPRESS_AT_TURNS),
    );
    return { turns: stored ? [summaryMessage(stored.summary), ...tail] : tail, save: null };
  }
}
