import { PROMPTS_DIR, PromptRegistry } from '@agent-sales/ai-core';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { AI_LLM_GATEWAY, isAiNotConfiguredError, type LlmGatewayPort } from '../../ai/api/index.js';
import { BOT_FACADE, type BotFacade, type BotView } from '../../bot/api/index.js';
import { CONVERSATION_FACADE, type ConversationFacade } from '../../conversation/api/index.js';
import type { MessageTemplate } from '../domain/care.js';
import {
  buildWriterInput,
  CARE_WRITER_MAX_OUTPUT_TOKENS,
  CARE_WRITER_MESSAGES,
  CARE_WRITER_PROMPT,
  CARE_WRITER_TIER,
  CARE_WRITER_TIMEOUT_MS,
  CareWriterWireSchema,
  careUngroundedFigures,
  parseWriterOutput,
  type WriterPersona,
} from '../domain/care-writer.js';

const registry = new PromptRegistry(PROMPTS_DIR);
const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

/** The cost of the call that wrote (or skipped) a message. */
export interface WriterCost {
  model: string | null;
  inputTokens: number;
  outputTokens: number;
}

export type WriteResult =
  /** `ungrounded`: figures no trusted text vouches for; the message must be approved first. */
  | ({ kind: 'send'; text: string; ungrounded: string[] } & WriterCost)
  | ({ kind: 'skip'; reason: string } & WriterCost)
  /** The model failed, timed out or answered twice with something unusable. */
  | { kind: 'failed' }
  /** No model is configured for the business. */
  | { kind: 'disabled' };

/**
 * Writes one follow-up (spec §4): one tier-`basic` call from the step's goal, the owner's
 * instruction, the bot's persona and facts, the Brain's note and the last 20 messages; the
 * answer is the message (≤ 600 characters) or a skip. One retry on an unusable answer.
 */
@Injectable()
export class CareWriter {
  readonly #log = new Logger(CareWriter.name);

  constructor(
    @Inject(CONVERSATION_FACADE) private readonly conversations: ConversationFacade,
    @Inject(BOT_FACADE) private readonly bots: BotFacade,
    @Inject(AI_LLM_GATEWAY) private readonly gateway: LlmGatewayPort,
  ) {}

  async write(
    ws: WorkspaceId,
    input: {
      conversationId: string;
      template: MessageTemplate;
      step: number;
      instruction: string;
      note: string | null;
    },
  ): Promise<WriteResult> {
    const ctx = await this.conversations.signalContext(ws, input.conversationId, null);
    if (!ctx) return { kind: 'failed' };
    const bot = await this.#bot(ws, input.conversationId);
    const facts = bot
      ? Object.entries(bot.profile.fields)
          .filter(([, v]) => v.trim())
          .map(([label, value]) => ({ label, value }))
      : [];
    const messages = ctx.messages.slice(-CARE_WRITER_MESSAGES);
    const user = buildWriterInput({
      template: input.template,
      step: input.step,
      instruction: input.instruction,
      persona: bot ? persona(bot) : null,
      facts,
      note: input.note,
      messages,
    });
    const system = await registry.load(CARE_WRITER_PROMPT);
    for (let attempt = 1; attempt <= 2; attempt++) {
      let res;
      try {
        res = await this.gateway.generate({
          workspaceId: ws,
          tier: CARE_WRITER_TIER,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          responseFormat: CareWriterWireSchema,
          maxOutputTokens: CARE_WRITER_MAX_OUTPUT_TOKENS,
          timeoutMs: CARE_WRITER_TIMEOUT_MS,
          signal: AbortSignal.timeout(CARE_WRITER_TIMEOUT_MS),
        });
      } catch (e) {
        if (isAiNotConfiguredError(e)) return { kind: 'disabled' };
        this.#log.warn(`care message of ${input.conversationId} failed (${errorClass(e)})`);
        return { kind: 'failed' };
      }
      const out = parseWriterOutput(res.text);
      if (!out) continue;
      const cost: WriterCost = {
        model: res.model.slice(0, 120) || null,
        inputTokens: res.usage.inputTokens + res.usage.cachedInputTokens,
        outputTokens: res.usage.outputTokens,
      };
      return out.kind === 'send'
        ? {
            kind: 'send',
            text: out.text,
            ungrounded: careUngroundedFigures(out.text, {
              instruction: input.instruction,
              facts,
              messages,
            }),
            ...cost,
          }
        : { kind: 'skip', reason: out.reason, ...cost };
    }
    return { kind: 'failed' };
  }

  /** The bot answering the conversation (persona and facts); null without one. */
  async #bot(ws: WorkspaceId, conversationId: string): Promise<BotView | null> {
    try {
      const { conversation } = await this.conversations.get(ws, conversationId);
      return conversation.botId ? await this.bots.getBot(ws, conversation.botId) : null;
    } catch {
      return null;
    }
  }
}

function persona(b: BotView): WriterPersona {
  return {
    selfPronoun: b.selfPronoun,
    customerPronoun: b.customerPronoun,
    tone: b.tone === 'formal' ? 'formal' : 'friendly',
    allowEmoji: b.allowEmoji,
    language: b.language === 'en' ? 'en' : 'vi',
  };
}
