import { type ChatMessage, PROMPTS_DIR, PromptRegistry } from '@agent-sales/ai-core';
import type { AiOutcome, PlaygroundRequest, PlaygroundResponse } from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { recordAiRun } from '../../../common/metrics.js';
import { BOT_FACADE, type BotFacade, type BotView } from '../../bot/api/index.js';
import { KNOWLEDGE_FACADE, type KnowledgeFacade } from '../../knowledge/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import type { AiFacade } from '../api/ai.facade.js';
import {
  knowledgeBlock,
  type KnowledgeSource,
  toSources,
  ungroundedFigures,
} from '../domain/grounding.js';
import { AI_RUN_REPOSITORY, type AiRunRepository } from '../domain/ports/ai-run.repository.js';
import { LlmRuntime } from './llm-runtime.js';

const PROMPT = { name: 'sales-agent', version: 2 } as const;
const PROMPT_VERSION = `${PROMPT.name}@${PROMPT.version}`;
const MAX_SOURCES = 5;

/** What the model must return (structured output); validated again here. */
export const ModelReply = z.object({
  outcome: z.enum(['answer', 'unknown', 'handoff']),
  reply: z.string(),
  sources: z.array(z.string()),
});

const STYLE: Record<BotView['creativity'], string> = {
  strict: 'Stay close to the wording of the knowledge entries.',
  balanced: 'Rephrase the knowledge naturally, keeping every fact exact.',
  creative: 'Be lively and persuasive, but every fact must still come from the knowledge.',
};

interface Decision {
  outcome: AiOutcome;
  reply: string;
  guardrail: string | null;
  used: ReadonlySet<string>;
}

/**
 * The bot's reply pipeline, single turn, for the dashboard playground:
 * retrieve FAQs → grounded LLM call (structured output) → guardrails
 * (number grounding, fallback/handoff messages) → ai_runs metering.
 * Runs in the api process for now because the playground is request/response;
 * channel conversations will run the same pipeline in the agent process (M3).
 */
@Injectable()
export class PlaygroundService implements AiFacade {
  readonly #prompts = new PromptRegistry(PROMPTS_DIR);

  constructor(
    @Inject(BOT_FACADE) private readonly bots: BotFacade,
    @Inject(KNOWLEDGE_FACADE) private readonly knowledge: KnowledgeFacade,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(LlmRuntime) private readonly llm: LlmRuntime,
    @Inject(AI_RUN_REPOSITORY) private readonly runs: AiRunRepository,
  ) {}

  async playground(
    ws: WorkspaceId,
    botId: string,
    input: PlaygroundRequest,
  ): Promise<PlaygroundResponse> {
    const bot = await this.bots.getBot(ws, botId);
    const workspace = await this.workspaces.getById(ws);
    const customerTexts = input.messages.filter((m) => m.role === 'customer').map((m) => m.content);

    // The last two customer messages: short follow-ups ("còn size 42 ko") need the earlier one.
    const query = customerTexts.slice(-2).join('\n');
    const hits = await this.knowledge.searchFaqs(ws, botId, query, MAX_SOURCES);
    const sources = toSources(hits, bot.placeholders);

    const system = this.#prompts.render(await this.#prompts.load(PROMPT), {
      'bot.name': bot.name,
      'workspace.name': workspace.name,
      'bot.language': bot.language === 'en' ? 'English' : 'Vietnamese',
      'bot.selfPronoun': bot.selfPronoun,
      'bot.customerPronoun': bot.customerPronoun,
      'bot.style': STYLE[bot.creativity],
      'bot.mission': bot.mission || '(not described yet)',
    });

    const res = await this.llm.generate({
      workspaceId: ws,
      tier: bot.modelTier,
      messages: [{ role: 'system', content: system }, ...conversation(input, sources)],
      responseFormat: ModelReply,
      maxOutputTokens: 2_000,
    });

    const decision = decide(res.stopReason, res.text, bot, sources, customerTexts);
    const run = {
      id: newId(),
      botId,
      conversationId: null,
      tier: bot.modelTier,
      provider: res.provider,
      model: res.model,
      promptVersion: PROMPT_VERSION,
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
      cachedTokens: res.usage.cachedInputTokens,
      latencyMs: res.latencyMs,
      retrieved: sources.map((s) => ({
        faqId: s.faqId,
        score: s.score,
        used: decision.used.has(s.key),
      })),
      outcome: decision.outcome,
      guardrail: decision.guardrail,
      isTest: true,
      createdAt: new Date(),
    };
    await this.runs.record(ws, run);
    recordAiRun(run);

    return {
      runId: run.id,
      reply: decision.reply,
      outcome: decision.outcome,
      guardrail: decision.guardrail,
      sources: sources.map((s) => ({
        faqId: s.faqId,
        question: s.question,
        score: s.score,
        used: decision.used.has(s.key),
      })),
      usage: res.usage,
      provider: res.provider,
      model: res.model,
      latencyMs: res.latencyMs,
    };
  }
}

/**
 * The test conversation as chat turns. Customer text is wrapped as data; the
 * knowledge block rides on the last customer turn so the cached prefix
 * (system prompt + earlier turns) stays stable.
 */
function conversation(input: PlaygroundRequest, sources: KnowledgeSource[]): ChatMessage[] {
  const firstCustomer = input.messages.findIndex((m) => m.role === 'customer');
  const turns = input.messages.slice(firstCustomer);
  return turns.map((m, i): ChatMessage => {
    if (m.role === 'bot') return { role: 'assistant', content: m.content };
    const customer = `<customer>\n${m.content}\n</customer>`;
    return {
      role: 'user',
      content: i === turns.length - 1 ? `${knowledgeBlock(sources)}\n\n${customer}` : customer,
    };
  });
}

function decide(
  stopReason: string,
  text: string,
  bot: BotView,
  sources: KnowledgeSource[],
  customerTexts: string[],
): Decision {
  const fallback = (guardrail: string | null, modelReply = ''): Decision => ({
    outcome: 'fallback',
    reply: bot.fallbackMessage || modelReply,
    guardrail,
    used: new Set(),
  });
  if (stopReason === 'refusal') {
    return {
      outcome: 'handoff',
      reply: bot.handoffMessage,
      guardrail: 'provider_refusal',
      used: new Set(),
    };
  }
  if (stopReason === 'max_tokens') return fallback('output_truncated');

  let parsed: z.infer<typeof ModelReply>;
  try {
    parsed = ModelReply.parse(JSON.parse(text));
  } catch {
    return fallback('invalid_output');
  }
  if (parsed.outcome === 'handoff') {
    return {
      outcome: 'handoff',
      reply: bot.handoffMessage || parsed.reply,
      guardrail: null,
      used: new Set(),
    };
  }
  if (parsed.outcome === 'unknown' || !parsed.reply.trim()) return fallback(null, parsed.reply);

  const trusted = [
    ...sources.flatMap((s) => [s.question, s.answer]),
    ...customerTexts,
    bot.mission,
    bot.greeting,
    ...Object.values(bot.placeholders),
  ];
  const ungrounded = ungroundedFigures(parsed.reply, trusted);
  if (ungrounded.length) return fallback(`ungrounded_figure:${ungrounded.join(',')}`);

  const known = new Set(sources.map((s) => s.key));
  return {
    outcome: 'answered',
    reply: parsed.reply.trim(),
    guardrail: null,
    used: new Set(parsed.sources.filter((k) => known.has(k))),
  };
}
