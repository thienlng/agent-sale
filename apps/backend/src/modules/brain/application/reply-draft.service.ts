import { PROMPTS_DIR, PromptRegistry } from '@agent-sales/ai-core';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { AI_LLM_GATEWAY, isAiNotConfiguredError, type LlmGatewayPort } from '../../ai/api/index.js';
import { BOT_FACADE, type BotFacade, type BotView } from '../../bot/api/index.js';
import { CONVERSATION_FACADE, type ConversationFacade } from '../../conversation/api/index.js';
import {
  BrainCapReachedError,
  NothingToDraftError,
  ReplyDraftFailedError,
  SignalConversationNotFoundError,
} from '../domain/brain.errors.js';
import { BRAIN_STORE, type BrainStore } from '../domain/ports/brain.store.js';
import {
  buildReplyDraftInput,
  REPLY_DRAFT_MAX_CHARS,
  REPLY_DRAFT_MAX_OUTPUT_TOKENS,
  REPLY_DRAFT_MESSAGES,
  REPLY_DRAFT_PROMPT,
  REPLY_DRAFT_TIER,
  REPLY_DRAFT_TIMEOUT_MS,
} from '../domain/reply-draft.js';
import { visibleTo, type TodayViewer } from '../domain/today.js';
import { UsageService } from './usage.service.js';

const registry = new PromptRegistry(PROMPTS_DIR);
const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);
const isTimeout = (e: unknown): boolean =>
  e instanceof Error &&
  (e.name === 'TimeoutError' || (e as Error & { kind?: unknown }).kind === 'timeout');

/**
 * "Soạn trả lời" (spec §5): one tier-`basic` call, only when a member clicks, from the signals'
 * note, the last 20 messages and the bot's persona when the conversation has a bot. The draft is
 * returned, never sent. It takes one evaluation of the day (given back when the call fails).
 */
@Injectable()
export class ReplyDraftService {
  readonly #log = new Logger(ReplyDraftService.name);

  constructor(
    @Inject(BRAIN_STORE) private readonly store: BrainStore,
    @Inject(CONVERSATION_FACADE) private readonly conversations: ConversationFacade,
    @Inject(BOT_FACADE) private readonly bots: BotFacade,
    @Inject(AI_LLM_GATEWAY) private readonly gateway: LlmGatewayPort,
    @Inject(UsageService) private readonly usage: UsageService,
  ) {}

  async draft(
    ws: WorkspaceId,
    viewer: TodayViewer,
    conversationId: string,
    now = new Date(),
  ): Promise<{ text: string }> {
    const [facts] = await this.conversations.todayCandidates(ws, {
      ids: [conversationId],
      awaitingBefore: new Date(0),
      followUpBefore: new Date(0),
      limit: 1,
    });
    if (!facts || facts.id !== conversationId || !visibleTo(facts, viewer)) {
      throw new SignalConversationNotFoundError(conversationId);
    }
    const ctx = await this.conversations.signalContext(ws, conversationId, null);
    if (!ctx) throw new SignalConversationNotFoundError(conversationId);
    const messages = ctx.messages.slice(-REPLY_DRAFT_MESSAGES);
    if (!messages.length) throw new NothingToDraftError();
    const [signal, bot] = await Promise.all([
      this.store.getSignal(ws, conversationId),
      this.#bot(ws, conversationId),
    ]);

    const reservation = await this.usage.reserve(ws, now);
    if (!reservation) throw new BrainCapReachedError();
    const user = buildReplyDraftInput({ note: signal?.note ?? null, messages, bot });
    let res;
    try {
      res = await this.gateway.generate({
        workspaceId: ws,
        tier: REPLY_DRAFT_TIER,
        messages: [
          { role: 'system', content: await registry.load(REPLY_DRAFT_PROMPT) },
          { role: 'user', content: user },
        ],
        maxOutputTokens: REPLY_DRAFT_MAX_OUTPUT_TOKENS,
        timeoutMs: REPLY_DRAFT_TIMEOUT_MS,
        signal: AbortSignal.timeout(REPLY_DRAFT_TIMEOUT_MS),
      });
    } catch (e) {
      await this.usage.release(ws, reservation);
      if (isAiNotConfiguredError(e)) throw new ReplyDraftFailedError('disabled');
      this.#log.warn(`reply draft of ${conversationId} failed (${errorClass(e)})`);
      throw new ReplyDraftFailedError(isTimeout(e) ? 'timeout' : 'error');
    }
    await this.store
      .recordRun(ws, {
        conversationId,
        trigger: 'manual',
        tier: REPLY_DRAFT_TIER,
        model: res.model.slice(0, 120) || null,
        inputTokens: res.usage.inputTokens + res.usage.cachedInputTokens,
        outputTokens: res.usage.outputTokens,
        outcome: 'ok',
      })
      .catch((e: unknown) => {
        this.#log.warn(`reply draft run of ${conversationId} not saved (${errorClass(e)})`);
      });
    const text = cleanDraft(res.text);
    if (!text) throw new ReplyDraftFailedError('empty');
    return { text };
  }

  /** The bot answering the conversation, for its persona; null without one. */
  async #bot(ws: WorkspaceId, conversationId: string): Promise<BotView | null> {
    try {
      const { conversation } = await this.conversations.get(ws, conversationId);
      return conversation.botId ? await this.bots.getBot(ws, conversation.botId) : null;
    } catch {
      return null;
    }
  }
}

/** The model's text as a reply: no surrounding quotes or fences, at most 2 000 characters. */
export function cleanDraft(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '');
  text = text.replace(/^["“](.*)["”]$/s, '$1').trim();
  return text.slice(0, REPLY_DRAFT_MAX_CHARS).trim();
}
