import { type ChatMessage, PROMPTS_DIR, PromptRegistry } from '@agent-sales/ai-core';
import type { AiOutcome, PlaygroundRequest, PlaygroundResponse } from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';

import { recordAiRun } from '../../../common/metrics.js';
import { BOT_FACADE, type BotFacade, type BotView } from '../../bot/api/index.js';
import { CATALOG_FACADE, type CatalogFacade } from '../../commerce/api/index.js';
import { KNOWLEDGE_FACADE, type KnowledgeFacade } from '../../knowledge/api/index.js';
import { TRAINING_FACADE, type TrainingFacade } from '../../knowledge/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import type { AiFacade } from '../api/ai.facade.js';
import { defaultFallbackMessage, defaultHandoffMessage } from '../domain/default-messages.js';
import {
  knowledgeBlock,
  type KnowledgeSource,
  toSources,
  ungroundedFigures,
} from '../domain/grounding.js';
import { AI_RUN_REPOSITORY, type AiRunRepository } from '../domain/ports/ai-run.repository.js';
import { LlmRuntime } from './llm-runtime.js';

const PROMPT = { name: 'sales-agent', version: 4 } as const;
const PROMPT_VERSION = `${PROMPT.name}@${PROMPT.version}`;
const MAX_SOURCES = 5;
const MAX_HANDOFF_LEAD = 200;

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
    @Inject(TRAINING_FACADE) @Optional() private readonly training?: TrainingFacade,
    @Inject(CATALOG_FACADE) @Optional() private readonly catalog?: CatalogFacade,
  ) {}

  async playground(
    ws: WorkspaceId,
    botId: string,
    input: PlaygroundRequest,
  ): Promise<PlaygroundResponse> {
    return this.generateReply(ws, botId, input, { conversationId: null, isTest: true });
  }

  async reply(
    ws: WorkspaceId,
    botId: string,
    input: PlaygroundRequest,
    context: { conversationId: string; isTest: boolean },
  ): Promise<PlaygroundResponse> {
    return this.generateReply(ws, botId, input, context);
  }

  private async generateReply(
    ws: WorkspaceId,
    botId: string,
    input: PlaygroundRequest,
    context: { conversationId: string | null; isTest: boolean },
  ): Promise<PlaygroundResponse> {
    const bot = await this.bots.getBot(ws, botId);
    const workspace = await this.workspaces.getById(ws);
    const customerTexts = input.messages.filter((m) => m.role === 'customer').map((m) => m.content);

    // The last two customer messages: short follow-ups ("còn size 42 ko") need the earlier one.
    const query = customerTexts.slice(-2).join('\n');
    const hits = await this.knowledge.searchFaqs(ws, botId, query, MAX_SOURCES);
    const sources = toSources(hits, bot.placeholders);
    const scenarios = this.training
      ? (await this.training.list(ws, botId))
          .filter((item) => item.kind === 'scenario')
          .slice(0, 20)
      : [];
    const guidance = scenarios
      .map((item) =>
        [item.title, item.trigger ? `Khi: ${item.trigger}` : '', item.content]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n\n')
      .slice(0, 20_000);
    const products = this.catalog ? await this.catalog.getBotProducts(ws, query, 5) : [];
    const productContext = products.map((product) => ({
      id: product.id,
      code: product.code,
      name: product.name,
      description: product.description,
      instructions: product.botInstructions,
      variants: product.variants.map((variant) => ({
        sku: variant.sku,
        name: variant.name,
        priceVnd: variant.price,
        available: variant.stock.reduce((sum, stock) => sum + stock.available, 0),
      })),
    }));
    const contextData = [
      guidance,
      products.length ? `<catalog>\n${JSON.stringify(productContext)}\n</catalog>` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

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
      messages: [{ role: 'system', content: system }, ...conversation(input, sources, contextData)],
      responseFormat: ModelReply,
      maxOutputTokens: 2_000,
    });

    const decision = decide(res.stopReason, res.text, bot, sources, customerTexts, contextData);
    const run = {
      id: newId(),
      botId,
      conversationId: context.conversationId,
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
      isTest: context.isTest,
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
function conversation(
  input: PlaygroundRequest,
  sources: KnowledgeSource[],
  guidance: string,
): ChatMessage[] {
  const firstCustomer = input.messages.findIndex((m) => m.role === 'customer');
  const turns = input.messages.slice(firstCustomer);
  return turns.map((m, i): ChatMessage => {
    if (m.role === 'bot') return { role: 'assistant', content: m.content };
    const customer = `<customer>\n${m.content}\n</customer>`;
    return {
      role: 'user',
      content:
        i === turns.length - 1
          ? `${knowledgeBlock(sources)}\n\n<shop_situations>\n${guidance}\n</shop_situations>\n\n${customer}`
          : customer,
    };
  });
}

function decide(
  stopReason: string,
  text: string,
  bot: BotView,
  sources: KnowledgeSource[],
  customerTexts: string[],
  guidance: string,
): Decision {
  // Fallback never sends model text and handoff only a vetted lead-in: an empty setting uses the built-in message.
  const fallback = (guardrail: string | null): Decision => ({
    outcome: 'fallback',
    reply: bot.fallbackMessage.trim() || defaultFallbackMessage(bot),
    guardrail,
    used: new Set(),
  });
  // The shop's own hand-over message always goes out. The model may add one brief sentence
  // before it (an apology, a confirmed phone number); it is dropped when it is long or
  // carries a figure that is neither grounded nor given by the customer.
  const handoff = (guardrail: string | null, lead = ''): Decision => ({
    outcome: 'handoff',
    reply: [lead, bot.handoffMessage.trim() || defaultHandoffMessage(bot)]
      .filter(Boolean)
      .join(' '),
    guardrail,
    used: new Set(),
  });
  if (stopReason === 'refusal') return handoff('provider_refusal');
  if (stopReason === 'max_tokens') return fallback('output_truncated');

  let parsed: z.infer<typeof ModelReply>;
  try {
    parsed = ModelReply.parse(JSON.parse(text));
  } catch {
    return fallback('invalid_output');
  }
  const trusted = [
    ...sources.flatMap((s) => [s.question, s.answer]),
    bot.mission,
    bot.greeting,
    guidance,
    ...Object.values(bot.placeholders),
  ];
  if (parsed.outcome === 'handoff') {
    const lead = parsed.reply.trim();
    const safe =
      lead.length <= MAX_HANDOFF_LEAD && !ungroundedFigures(lead, trusted, customerTexts).length;
    return handoff(null, safe ? lead : '');
  }
  if (parsed.outcome === 'unknown' || !parsed.reply.trim()) return fallback(null);

  const ungrounded = ungroundedFigures(parsed.reply, trusted, customerTexts);
  if (ungrounded.length) return fallback(`ungrounded_figure:${ungrounded.join(',')}`);

  const known = new Set(sources.map((s) => s.key));
  return {
    outcome: 'answered',
    reply: parsed.reply.trim(),
    guardrail: null,
    used: new Set(parsed.sources.filter((k) => known.has(k))),
  };
}
