import { type ChatMessage, PROMPTS_DIR, PromptRegistry } from '@agent-sales/ai-core';
import type { PlaygroundRequest, PlaygroundResponse } from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { recordAiRun } from '../../../common/metrics.js';
import { BOT_FACADE, type BotFacade, type BotView } from '../../bot/api/index.js';
import { CATALOG_FACADE, type CatalogFacade } from '../../commerce/api/index.js';
import { KNOWLEDGE_FACADE, type KnowledgeFacade } from '../../knowledge/api/index.js';
import { TRAINING_FACADE, type TrainingFacade } from '../../knowledge/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import type { AiFacade } from '../api/ai.facade.js';
import {
  buildAllowlist,
  imagesBlock,
  libraryImages,
  productImages,
  resolveImageIds,
} from '../domain/image-allowlist.js';
import { knowledgeBlock, type KnowledgeSource, toSources } from '../domain/grounding.js';
import { ModelReply, parseModelReply, salvageProse } from '../domain/model-reply.js';
import { AI_RUN_REPOSITORY, type AiRunRepository } from '../domain/ports/ai-run.repository.js';
import { decide } from './decide-reply.js';
import { LlmRuntime } from './llm-runtime.js';

/** Last thing the model reads: general questions ("what do you sell?") tempt it into plain prose. */
const JSON_REMINDER = 'Reply with the JSON object only, as described above.';
const FORMAT_REMINDER =
  'Reminder: your previous reply was not a JSON object. Reply again with only the JSON object described above, even for a general question.';
const PROMPT = { name: 'sales-agent', version: 7 } as const;
const POST_PROMPT = { name: 'fanpage-context', version: 1 } as const;
const PROMPT_VERSION = `${PROMPT.name}@${PROMPT.version}`;
const MAX_SOURCES = 5;

const STYLE: Record<BotView['creativity'], string> = {
  strict: 'Stay close to the wording of the knowledge entries.',
  balanced: 'Rephrase the knowledge naturally, keeping every fact exact.',
  creative: 'Be lively and persuasive, but every fact must still come from the knowledge.',
};

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
  readonly #logger = new Logger(PlaygroundService.name);

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
    context: { conversationId: string | null; isTest: boolean },
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
    const post = input.postContext;
    const query = [post?.text.slice(0, 2000), ...customerTexts.slice(-2)]
      .filter(Boolean)
      .join('\n');
    const hits = await this.knowledge.searchFaqs(ws, botId, query, MAX_SOURCES);
    const sources = toSources(hits, bot.placeholders);
    const scenarios = this.training
      ? (await this.training.list(ws, botId))
          .filter((item) => item.kind === 'scenario')
          .slice(0, 20)
      : [];
    const media = this.training
      ? (await this.training.list(ws, botId)).filter((item) => item.kind === 'media')
      : [];
    const guidance = scenarios
      .map((item) =>
        [item.title, item.trigger ? `Khi: ${item.trigger}` : '', item.content]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n\n')
      .slice(0, 20_000);
    // Variant names like "Size 41" match most products, so a follow-up ("size 41 thì sao?") only
    // finds the product being discussed through the bot's own last reply, which names it.
    const lastBotReply = input.messages.findLast((m) => m.role === 'bot')?.content.slice(0, 400);
    const productQuery = lastBotReply ? `${query}\n${lastBotReply}` : query;
    const products = this.catalog ? await this.catalog.getBotProducts(ws, productQuery, 5) : [];
    // The pictures the bot may send this turn. The model only gets ids and labels, never URLs.
    const allowed = buildAllowlist(productImages(products), libraryImages(media, query));
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
    // A short list of everything on sale, so general questions ("what do you sell?", "something
    // under 500k") can be answered even when no product name matched the customer's words.
    const overview = this.catalog ? await this.catalog.listBotCatalog(ws, 15) : [];
    const overviewContext = overview.map((product) => ({
      name: product.name,
      fromVnd: product.priceMin,
      toVnd: product.priceMax,
      inStock: product.available > 0,
    }));
    const contextData = [
      post
        ? `<originating_post>\n${JSON.stringify({ text: post.text, media: post.media, parentText: post.parentText }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')}\n</originating_post>`
        : '',
      guidance,
      overview.length
        ? `<catalog_overview>\n${JSON.stringify(overviewContext)}\n</catalog_overview>`
        : '',
      products.length ? `<catalog>\n${JSON.stringify(productContext)}\n</catalog>` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const postRules = post ? await this.#prompts.load(POST_PROMPT) : '';
    const template = [await this.#prompts.load(PROMPT), postRules].filter(Boolean).join('\n\n');
    const system = this.#prompts.render(template, {
      'bot.name': bot.name,
      // The shop's own name (a bot setting) beats the account's workspace name.
      'workspace.name': bot.placeholders['store.name'] || workspace.name,
      'bot.language': bot.language === 'en' ? 'English' : 'Vietnamese',
      'bot.selfPronoun': bot.selfPronoun,
      'bot.customerPronoun': bot.customerPronoun,
      'bot.style': STYLE[bot.creativity],
      'bot.mission': bot.mission || '(not described yet)',
    });

    const request = {
      workspaceId: ws,
      tier: bot.modelTier,
      messages: [
        { role: 'system' as const, content: system },
        ...conversation(input, sources, contextData, imagesBlock(allowed)),
      ],
      responseFormat: ModelReply,
      maxOutputTokens: 2_000,
      // Only the Hermes provider accepts images; any other provider throws, so a customer image
      // is never silently dropped (the caller decides how to degrade).
      ...(input.images?.length ? { images: input.images } : {}),
    };
    let res = await this.llm.generate(request);
    let output = parseModelReply(res.text);
    // One malformed output is usually a one-off: retry once before giving up on the question.
    if (!output.ok && res.stopReason === 'end') {
      this.#logger.warn(`AI output rejected (${output.reason}), retrying once`);
      // The second attempt reminds the model of the output format (the first reply was prose).
      const [system, ...rest] = request.messages;
      const retry = await this.llm.generate({
        ...request,
        messages: system
          ? [{ ...system, content: `${system.content}\n\n${FORMAT_REMINDER}` }, ...rest]
          : request.messages,
      });
      res = {
        ...retry,
        latencyMs: res.latencyMs + retry.latencyMs,
        usage: {
          inputTokens: res.usage.inputTokens + retry.usage.inputTokens,
          outputTokens: res.usage.outputTokens + retry.usage.outputTokens,
          cachedInputTokens: res.usage.cachedInputTokens + retry.usage.cachedInputTokens,
        },
      };
      output = parseModelReply(retry.text);
      // Still prose after the reminder: keep a short, grounded, non-leaking answer rather than
      // telling the customer "I have no information" about something the model did answer.
      if (!output.ok && output.reason === 'not_json' && retry.stopReason === 'end') {
        const salvaged = salvageProse(retry.text, system?.content ?? '');
        if (salvaged) output = { ok: true, value: salvaged };
      }
    }

    const decision = decide(
      res.stopReason,
      output,
      bot,
      sources,
      customerTexts,
      [
        guidance,
        JSON.stringify(overviewContext),
        JSON.stringify(productContext),
        post ? JSON.stringify({ text: post.text, media: post.media }) : '',
      ].join('\n'),
    );
    const run = {
      id: newId(),
      botId,
      conversationId: context.conversationId,
      tier: bot.modelTier,
      provider: res.provider,
      model: res.model,
      promptVersion: post
        ? `${PROMPT_VERSION}+${POST_PROMPT.name}@${POST_PROMPT.version}`
        : PROMPT_VERSION,
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

    // Pictures follow only a grounded answer, and only ids from this turn's allowlist.
    const images =
      decision.outcome === 'answered' && output.ok
        ? resolveImageIds(output.value.imageIds, allowed)
        : [];

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
      images,
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
  images: string,
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
          ? `${knowledgeBlock(sources)}\n\n<shop_situations>\n${guidance}\n</shop_situations>\n\n${images ? `${images}\n\n` : ''}${customer}\n\n${JSON_REMINDER}`
          : customer,
    };
  });
}
