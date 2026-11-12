import type {
  AgentLoopResult,
  GenerateRequest,
  GenerateResponse,
  RunnableTool,
  ToolDefinition,
  Usage,
} from '@agent-sales/ai-core';
import type { AiOutcome, ProductDto } from '@agent-sales/contracts';
import { newId } from '@agent-sales/shared';

import type { BotView } from '../../bot/api/index.js';
import type { MessageSink, ReplyOptions } from '../api/reply-options.js';
import { defaultFallbackMessage, defaultHandoffMessage } from '../domain/default-messages.js';
import { correctionNote, type ReplyCheck } from '../domain/reply-guard.js';
import { normalizeReplyText, withoutSentLines } from '../domain/reply-text.js';
import { type ActionToolContext, playgroundConversationId, runActionTool } from './action-tools.js';
import { CALCULATE_TOOL, calculateTool } from './calculator.js';
import { customerSelfPronoun, phonesIn } from './reply-context.js';
import { type HoldToolContext, holdTools } from './hold-tools.js';
import { type OrderToolContext, orderTools } from './order-tools.js';
import { type RequestToolContext, requestTools } from './request-tools.js';
import { CATALOG_TOOLS, type CatalogToolContext, catalogRunnableTools } from './catalog-tools.js';
import {
  type ImageAllowlist,
  type OutputState,
  outputTools,
  type SentMessage,
} from './output-tools.js';
import { type WebsiteToolContext, websiteTools } from './website-tools.js';

/** A model's tool set for the loop: definitions for the request, executors for the runner. */
export interface ToolSet {
  definitions: ToolDefinition[];
  runnable: RunnableTool[];
}

export function mergeToolSets(...sets: ToolSet[]): ToolSet {
  return {
    definitions: sets.flatMap((s) => s.definitions),
    runnable: sets.flatMap((s) => s.runnable),
  };
}

/** Executors for the given tool definitions (action tools: writes, run one by one). */
export function writeTools(
  definitions: readonly ToolDefinition[],
  run: (name: string, input: unknown) => Promise<{ content: string; trusted?: string }>,
): RunnableTool[] {
  return definitions.map((d) => ({
    name: d.name,
    readOnly: false,
    schema: d.input,
    run: (input) => run(d.name, input),
  }));
}

/**
 * The tools of one turn, in the order the model sees them: catalog (read-only), `calculate` (read-only, always), `send_message`
 * (not for comment replies) and `handoff`, the order tools or the lodging hold tools, the request tool (saas, education, spa), then the owner's actions. Products whose details the
 * catalog returns make their pictures sendable.
 */
export function turnTools(opts: {
  catalog?: Omit<CatalogToolContext, 'onProducts' | 'onListed'>;
  allowlist: ImageAllowlist;
  /** Products whose details the model received (besides making their pictures sendable). */
  onProducts?(products: readonly ProductDto[]): void;
  /** Every product the model saw a row of (website: the products it may show as cards). */
  onListed?(products: readonly ProductDto[]): void;
  output: OutputState;
  sink?: MessageSink;
  sendMessage: boolean;
  /** The pre-send guard every `send_message` text passes (docs/06 §3.3). */
  check?: (text: string) => ReplyCheck;
  actions: { definitions: ToolDefinition[]; context: ActionToolContext } | null;
  /** Present only for a bot that takes orders, in a private conversation (or the playground). */
  orders?: OrderToolContext | null;
  /** Present only for a hotel bot (availability always; holds with its order-taking switch). */
  holds?: HoldToolContext | null;
  /** Present only for a bot of a request industry: saas, education, spa (ADR-020). */
  requests?: RequestToolContext | null;
  /** Attachment URLs already sent in this conversation (album paging). */
  sentMediaUrls?: readonly string[];
  /** Present only for a website visitor's turn: product cards and suggested next steps. */
  website?: Omit<WebsiteToolContext, 'allowlist' | 'state' | 'sink'> | null;
}): ToolSet {
  const { catalog, allowlist, actions } = opts;
  return mergeToolSets(
    catalog
      ? {
          definitions: CATALOG_TOOLS,
          runnable: catalogRunnableTools({
            ...catalog,
            onProducts: (products) => {
              allowlist.addProducts(products);
              opts.onProducts?.(products);
            },
            ...(opts.onListed ? { onListed: opts.onListed } : {}),
          }),
        }
      : { definitions: [], runnable: [] },
    { definitions: [CALCULATE_TOOL], runnable: [calculateTool] },
    outputTools({
      ...(opts.sink ? { sink: opts.sink } : {}),
      allowlist,
      state: opts.output,
      sendMessage: opts.sendMessage,
      ...(opts.check ? { check: opts.check } : {}),
      ...(opts.sentMediaUrls ? { sentMediaUrls: opts.sentMediaUrls } : {}),
    }),
    opts.website
      ? websiteTools({
          ...opts.website,
          allowlist,
          state: opts.output,
          ...(opts.sink ? { sink: opts.sink } : {}),
        })
      : { definitions: [], runnable: [] },
    opts.orders ? orderTools(opts.orders) : { definitions: [], runnable: [] },
    opts.holds ? holdTools(opts.holds) : { definitions: [], runnable: [] },
    opts.requests ? requestTools(opts.requests) : { definitions: [], runnable: [] },
    actions
      ? {
          definitions: actions.definitions,
          runnable: writeTools(actions.definitions, (name, input) =>
            runActionTool(actions.context, { id: name, name, input }),
          ),
        }
      : { definitions: [], runnable: [] },
  );
}

const ZERO: Usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

/**
 * Wraps the model call so every call of the turn (summarizer included) is metered, even when a
 * later call throws and the agent loop never returns its own totals.
 */
export function meteredGenerate(generate: (req: GenerateRequest) => Promise<GenerateResponse>) {
  const meter = {
    usage: { ...ZERO },
    latencyMs: 0,
    calls: 0,
    last: null as GenerateResponse | null,
    generate: async (req: GenerateRequest): Promise<GenerateResponse> => {
      const res = await generate(req);
      meter.calls += 1;
      meter.latencyMs += res.latencyMs;
      meter.usage = {
        inputTokens: meter.usage.inputTokens + res.usage.inputTokens,
        outputTokens: meter.usage.outputTokens + res.usage.outputTokens,
        cachedInputTokens: meter.usage.cachedInputTokens + res.usage.cachedInputTokens,
      };
      meter.last = res;
      return res;
    },
  };
  return meter;
}

export interface ReplyDecision {
  outcome: AiOutcome;
  guardrail: string | null;
  /** The last message of the turn (sent by the caller, not the sink); null when there is none. */
  final: string | null;
}

export const fallbackText = (bot: BotView): string =>
  bot.fallbackMessage.trim() || defaultFallbackMessage(bot);
const handoffText = (bot: BotView): string =>
  bot.handoffMessage.trim() || defaultHandoffMessage(bot);

// An order recipient's details: a phone sent with these is for the order, not a call-back.
const ADDRESS_WORDS =
  /(?<!\p{L})(địa chỉ|dia chi|đường|duong|phường|phuong|quận|quan|ngõ|ngo|ngách|số nhà|tp|thành phố|huyện|xã)(?!\p{L})/iu;

/**
 * VL-B9 / LM-14: a phone number the customer gives in their newest message, for the first time in
 * the conversation, is read back before the shop's hand-over message (the model often hands off
 * bare). Once only (TM2-1: it was repeated on every later hand-off and even answered "số tài
 * khoản bên em là gì?"), never for an order recipient's phone sent with an address, and not when
 * the turn's texts already repeat it.
 */
export function phoneReadBack(
  customerTexts: readonly string[],
  said: readonly string[],
  english = false,
): string {
  const last = customerTexts.at(-1) ?? '';
  const phone = phonesIn(last).at(-1);
  if (!phone || ADDRESS_WORDS.test(last)) return '';
  const digits = (t: string) => t.replace(/\D/g, '');
  const tail = digits(phone).slice(-9);
  if (customerTexts.slice(0, -1).some((t) => digits(t).includes(tail))) return '';
  if (said.some((t) => digits(t).includes(tail))) return '';
  return english ? `Noted, your number is ${phone}.` : `Dạ em đã ghi nhận số ${phone} ạ.`;
}

const VIETNAMESE_LETTERS =
  /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/iu;
const ENGLISH_WORDS =
  /\b(the|you|your|my|is|are|please|can|want|call|number|hello|hi|thanks?|what|how|order|with|and)\b/giu;

/** The customer's newest message reads as English: no Vietnamese letters, several English words. */
export function writesEnglish(text: string | undefined): boolean {
  if (!text || VIETNAMESE_LETTERS.test(text)) return false;
  return (text.match(ENGLISH_WORDS) ?? []).length >= 2;
}

/**
 * MS2-2: the shop's hand-over message is an owner setting in Vietnamese; a customer writing English
 * reads this generic English line instead (the model's lead-in already follows their language).
 */
export const ENGLISH_HANDOFF = 'A member of our staff will get back to you here shortly.';

const ASKS_PHONE = /(số điện thoại|sđt|sdt|phone|number)/iu;

/**
 * MS2-1: staff can only call back a customer whose phone they have. A hand-off in a conversation
 * where the customer never wrote a phone (and the contact has none) asks for it, in the
 * customer's language and with their pronoun, unless the lead-in already asks.
 */
export function phoneAsk(
  customerTexts: readonly string[],
  said: readonly string[],
  phoneKnown: boolean,
  english = false,
): string {
  if (phoneKnown || customerTexts.some((t) => phonesIn(t).length > 0)) return '';
  if (said.some((t) => ASKS_PHONE.test(t))) return '';
  if (english) return 'Could you leave your phone number so our staff can call you back?';
  const pronoun = customerSelfPronoun(customerTexts);
  const who =
    pronoun && pronoun !== 'em' ? pronoun.charAt(0).toUpperCase() + pronoun.slice(1) : 'Anh/chị';
  return `${who} để lại số điện thoại để nhân viên gọi tư vấn ạ.`;
}

/**
 * EV-4 (examiner: tinymind-pronoun-*): the customer called themselves "anh" / "chị" / … and the
 * turn never addresses them: the final answer's closing "ạ" becomes "{pronoun} ạ", the way a shop
 * assistant would write it. "em" customers are left alone (no pronoun is the safe choice).
 */
export function withCustomerPronoun(
  text: string,
  customerTexts: readonly string[],
  sent: readonly { text: string }[] = [],
): string {
  const pronoun = customerSelfPronoun(customerTexts);
  if (!pronoun || pronoun === 'em') return text;
  const word = new RegExp(`(?<!\\p{L})${pronoun}(?!\\p{L})`, 'iu');
  if ([text, ...sent.map((m) => m.text)].some((t) => word.test(t))) return text;
  return text.replace(/(?<!\p{L})ạ([.!]?)\s*$/u, `${pronoun} ạ$1`);
}

/** Why the turn cannot end with the model's text, or null when it can. */
function forcedGuardrail(loop: AgentLoopResult, actionFallback: string | null | undefined) {
  if (loop.outcome === 'limit') return 'tool_loop_limit';
  if (loop.outcome === 'invalid_tools') return 'invalid_tools';
  if (loop.outcome === 'budget') return 'budget';
  if (actionFallback) return actionFallback;
  if (loop.res?.stopReason === 'max_tokens') return 'output_truncated';
  return null;
}

/**
 * The outcome of a turn (spec §7): `handoff` if the handoff tool ran (or the provider refused);
 * `answered` if anything reached the customer; otherwise `fallback` with the bot's fallback message.
 * Fallback text is never model text. An interrupted turn sends no final message: the caller re-runs.
 */
export function decideReply(input: {
  loop: AgentLoopResult;
  output: OutputState;
  bot: BotView;
  actionFallback: string | null | undefined;
  /** The pre-send guard: a hand-off's model-written lead that fails it is dropped. */
  check?: (text: string) => ReplyCheck;
  /** The conversation's contact already has a phone: a hand-off does not ask for one (MS2-1). */
  phoneKnown?: boolean | undefined;
  /** The customer's messages, oldest first: their latest phone is read back before a hand-off. */
  customerTexts?: readonly string[] | undefined;
}): ReplyDecision {
  const { loop, output, bot } = input;
  const sentAny = output.sent.length > 0;
  if (loop.outcome === 'interrupted') {
    return sentAny
      ? { outcome: 'answered', guardrail: null, final: null }
      : { outcome: 'fallback', guardrail: 'interrupted', final: null };
  }
  if (output.handoff !== null) {
    const english = bot.language === 'vi' && writesEnglish(input.customerTexts?.at(-1));
    // The model's own lead-in, else the handoff's `say` line (TM2-7): either must pass the guard.
    const written =
      normalizeReplyText(loop.res?.text ?? '') || normalizeReplyText(output.handoffSay ?? '');
    const lead = written && input.check && !input.check(written).ok ? '' : written;
    return {
      outcome: 'handoff',
      guardrail: null,
      final: [
        lead,
        bot.language === 'vi'
          ? phoneReadBack(
              input.customerTexts ?? [],
              [lead, ...output.sent.map((m) => m.text)],
              english,
            )
          : '',
        bot.language === 'vi'
          ? phoneAsk(input.customerTexts ?? [], [lead], input.phoneKnown === true, english)
          : '',
        english ? ENGLISH_HANDOFF : handoffText(bot),
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }
  if (loop.res?.stopReason === 'refusal')
    return { outcome: 'handoff', guardrail: 'provider_refusal', final: handoffText(bot) };
  const forced = forcedGuardrail(loop, input.actionFallback);
  const text = forced ? '' : normalizeReplyText(loop.res?.text ?? '');
  // The model repeated what it already sent this turn (EV-5, VL-B8): the customer reads it once.
  const fresh = text
    ? withoutSentLines(
        text,
        output.sent.map((m) => m.text),
      )
    : '';
  if (text && !fresh) return { outcome: 'answered', guardrail: null, final: null };
  if (fresh)
    return {
      outcome: 'answered',
      guardrail: null,
      final: withCustomerPronoun(fresh, input.customerTexts ?? [], output.sent),
    };
  // Cut short after a send (budget, round limit, invalid tools): close with the fallback line so
  // a promise like "em gửi ảnh từng mẫu nhé" is not left hanging.
  if (sentAny)
    return { outcome: 'answered', guardrail: forced, final: forced ? fallbackText(bot) : null };
  return { outcome: 'fallback', guardrail: forced, final: fallbackText(bot) };
}

/**
 * The pre-send guard on the final reply (docs/06 §3.3), for a turn that ends with the model's own
 * text: a reply that quotes the shop's instructions becomes the fallback line; a reply with a
 * figure from nowhere is rewritten once with a correction note (one extra model call, only on
 * failure), then falls back if the rewrite fails too.
 */
export async function guardFinal(input: {
  decision: ReplyDecision;
  check: (text: string) => ReplyCheck;
  /** One rewrite of `draft` given `note`; null when the call fails or returns nothing. */
  rewrite: (draft: string, note: string) => Promise<string | null>;
  bot: BotView;
  sentAny: boolean;
}): Promise<ReplyDecision> {
  const { decision } = input;
  if (decision.outcome !== 'answered' || decision.guardrail !== null || !decision.final)
    return decision;
  const first = input.check(decision.final);
  if (first.ok) return decision;
  const refuse = (guardrail: string): ReplyDecision => ({
    outcome: input.sentAny ? 'answered' : 'fallback',
    guardrail,
    final: fallbackText(input.bot),
  });
  if (first.reason === 'instruction_leak') return refuse('instruction_leak');
  const rewritten = await input.rewrite(decision.final, correctionNote(first));
  if (rewritten && input.check(rewritten).ok) return { ...decision, final: rewritten };
  return refuse(first.reason);
}

/**
 * Every message of the turn in order: the `send_message` ones, then the final one, which carries
 * the suggested next steps of an answered turn (never a fallback or a hand-off's).
 */
export function turnMessages(output: OutputState, decision: ReplyDecision): SentMessage[] {
  const suggestions =
    decision.outcome === 'answered' && !decision.guardrail ? output.suggestions : null;
  return [
    ...output.sent,
    ...(decision.final
      ? [
          {
            text: decision.final,
            images: [],
            ...(suggestions?.length ? { ui: { suggestions } } : {}),
            via: 'final' as const,
          },
        ]
      : []),
  ];
}

/** The ai_runs fields shared by every outcome; usage and latency cover every model call made. */
export function runBase(input: {
  botId: string;
  tier: string;
  options: ReplyOptions;
  promptVersion: string;
  meter: ReturnType<typeof meteredGenerate>;
}) {
  const { botId, options, meter } = input;
  return {
    id: newId(),
    botId,
    // A playground run is remembered under its stable id; a comment reply under none.
    conversationId:
      options.conversationId ??
      (options.isTest ? playgroundConversationId(botId, options.playgroundSession) : null),
    tier: input.tier,
    provider: meter.last?.provider ?? 'none',
    model: meter.last?.model ?? 'none',
    promptVersion: input.promptVersion,
    inputTokens: meter.usage.inputTokens,
    outputTokens: meter.usage.outputTokens,
    cachedTokens: meter.usage.cachedInputTokens,
    latencyMs: meter.latencyMs,
    isTest: options.isTest,
    createdAt: new Date(),
  };
}

/** `PlaygroundResponse.images` holds at most this many pictures (the contract's max). */
const MAX_JOINED_IMAGES = 30;

/** The joined picture view of a turn: unique by URL, within the contract; `messages` keeps them all. */
export function joinedImages(
  images: readonly { url: string; label: string }[],
): { url: string; label: string }[] {
  const byUrl = new Map(images.map(({ url, label }) => [url, { url, label }]));
  return [...byUrl.values()].slice(0, MAX_JOINED_IMAGES);
}

/** Rule 07: the error class only, never the message, which may carry customer data. */
export const errorClass = (error: unknown): string =>
  error instanceof Error ? error.name : 'unknown error';
