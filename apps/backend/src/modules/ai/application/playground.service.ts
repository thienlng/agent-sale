import {
  type ChatMessage,
  type GenerateRequest,
  type GenerateResponse,
  PROMPTS_DIR,
  PromptRegistry,
} from '@agent-sales/ai-core';
import type { PlaygroundRequest, PlaygroundResponse } from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { recordAiRun } from '../../../common/metrics.js';
import { ACTION_FACADE, type ActionFacade } from '../../action/api/index.js';
import { BOT_FACADE, type BotFacade, type BotView } from '../../bot/api/index.js';
import { CATALOG_FACADE, type CatalogFacade } from '../../commerce/api/index.js';
import { KNOWLEDGE_FACADE, type KnowledgeFacade } from '../../knowledge/api/index.js';
import { renderBusinessProfile } from '../domain/business-profile.js';
import { catalogProductContext, catalogOverviewContext } from '../domain/catalog-context.js';
import { replyStyle } from '../domain/reply-style.js';
import { situationsText } from '../domain/situations.js';
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
import {
  ModelReply,
  type ParsedModelReply,
  parseModelReply,
  salvageProse,
} from '../domain/model-reply.js';
import { AI_RUN_REPOSITORY, type AiRunRepository } from '../domain/ports/ai-run.repository.js';
import {
  type ActionCall,
  idempotencyKey,
  playgroundConversationId,
  runActionLoop,
} from './action-loop.js';
import { actionsBlock } from './actions-block.js';
import { decide, fallbackDecision } from './decide-reply.js';
import { LlmRuntime } from './llm-runtime.js';

/** Last thing the model reads: general questions ("what do you sell?") tempt it into plain prose. */
const JSON_REMINDER = 'Reply with the JSON object only, as described above.';
const FORMAT_REMINDER =
  'Reminder: your previous reply was not a JSON object. Reply again with only the JSON object described above, even for a general question.';
const PROMPT_V8 = { name: 'sales-agent', version: 8 } as const;
const PROMPT_V9 = { name: 'sales-agent', version: 9 } as const;
const PROMPT_V10 = { name: 'sales-agent', version: 10 } as const;
/** Optional DI token: the sales-agent prompt version both the playground and live replies use (default 8). */
export const PROMPT_VERSION_OPTION = Symbol('PROMPT_VERSION_OPTION');
const POST_PROMPT = { name: 'fanpage-context', version: 1 } as const;
const MAX_SOURCES = 5;

const STYLE: Record<BotView['creativity'], string> = {
  strict: 'Stay close to the wording of the knowledge entries.',
  balanced: 'Rephrase the knowledge naturally, keeping every fact exact.',
  creative: 'Be lively and persuasive, but every fact must still come from the knowledge.',
};

/** Added to the system prompt once a website visitor has left a phone number. */
export const PHONE_KNOWN_LINE =
  'The customer already left their phone number; do not ask for it again.';

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
  readonly #prompt: typeof PROMPT_V8 | typeof PROMPT_V9;
  readonly #automaticLodgingPrompt: boolean;

  constructor(
    @Inject(BOT_FACADE) private readonly bots: BotFacade,
    @Inject(KNOWLEDGE_FACADE) private readonly knowledge: KnowledgeFacade,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(LlmRuntime) private readonly llm: LlmRuntime,
    @Inject(AI_RUN_REPOSITORY) private readonly runs: AiRunRepository,
    @Inject(TRAINING_FACADE) @Optional() private readonly training?: TrainingFacade,
    @Inject(CATALOG_FACADE) @Optional() private readonly catalog?: CatalogFacade,
    @Inject(ACTION_FACADE) @Optional() private readonly actions?: ActionFacade,
    @Inject(PROMPT_VERSION_OPTION) @Optional() promptVersion?: 8 | 9,
  ) {
    this.#prompt = promptVersion === 8 ? PROMPT_V8 : PROMPT_V9;
    this.#automaticLodgingPrompt = promptVersion === undefined;
  }

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
    const prompt =
      bot.industry === 'hotel' && this.#automaticLodgingPrompt ? PROMPT_V10 : this.#prompt;
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
      ? (await this.training.list(ws, botId)).filter((item) => item.kind === 'scenario')
      : [];
    const media = this.training
      ? (await this.training.list(ws, botId)).filter((item) => item.kind === 'media')
      : [];
    const guidance = situationsText(scenarios);
    // Variant names like "Size 41" match most products, so a follow-up ("size 41 thì sao?") only
    // finds the product being discussed through the bot's own last reply, which names it.
    const lastBotReply = input.messages.findLast((m) => m.role === 'bot')?.content.slice(0, 400);
    const productQuery = lastBotReply ? `${query}\n${lastBotReply}` : query;
    const scope = { botId, catalogMode: bot.catalogMode };
    const products = this.catalog
      ? await this.catalog.getBotProducts(ws, scope, productQuery, 5)
      : [];
    // The pictures the bot may send this turn. The model only gets ids and labels, never URLs.
    const allowed = buildAllowlist(
      productImages(products, query),
      libraryImages(media, query),
      products.some((p) => p.accommodation) ? query : '',
    );
    const productContext = products.map(catalogProductContext);
    // A short list of everything on sale, so general questions ("what do you sell?", "something
    // under 500k") can be answered even when no product name matched the customer's words.
    const overview = this.catalog ? await this.catalog.listBotCatalog(ws, scope, 15) : [];
    const overviewContext = overview.map(catalogOverviewContext);
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
    // Figures the reply may state: the shop's own post, guidance and catalog. The parent comment is
    // the customer's words, so a price in it is context, never a grounded source.
    const groundingData = [
      post ? JSON.stringify({ text: post.text, media: post.media }) : '',
      guidance,
      JSON.stringify(overviewContext),
      JSON.stringify(productContext),
    ].join('\n');

    // The playground has no conversation: a stable id per bot lets confirmations work in the test chat.
    const actionConversationId = context.conversationId ?? playgroundConversationId(botId);
    const actionViews = this.actions ? await this.actions.listForBot(ws, botId) : [];
    const pendingAction =
      this.actions && actionViews.length
        ? await this.actions.getPending(ws, actionConversationId)
        : null;
    const actionsBlockText = actionViews.length ? actionsBlock(actionViews, pendingAction) : '';

    const postRules = post ? await this.#prompts.load(POST_PROMPT) : '';
    const v9 = prompt.version >= 9;
    const template = [await this.#prompts.load(prompt), postRules].filter(Boolean).join('\n\n');
    const system = this.#prompts.render(template, {
      'bot.name': bot.name,
      // The shop's own name beats the account's workspace name (@9: the profile's display name first).
      'workspace.name':
        (v9 ? bot.profile.fields.displayName : undefined) ||
        bot.placeholders['store.name'] ||
        workspace.name,
      'bot.language': bot.language === 'en' ? 'English' : 'Vietnamese',
      'bot.selfPronoun': bot.selfPronoun,
      'bot.customerPronoun': bot.customerPronoun,
      'bot.style': v9 ? replyStyle(bot) : STYLE[bot.creativity],
      'bot.mission': bot.mission || '(not described yet)',
    });

    const request = {
      workspaceId: ws,
      tier: bot.modelTier,
      messages: [
        {
          role: 'system' as const,
          content: input.phoneKnown ? `${system}\n\n${PHONE_KNOWN_LINE}` : system,
        },
        ...conversation(
          input,
          sources,
          contextData,
          [imagesBlock(allowed), actionsBlockText].filter(Boolean).join('\n\n'),
          v9 ? renderBusinessProfile(bot) : '',
        ),
      ],
      responseFormat: ModelReply,
      maxOutputTokens: 2_000,
      // Only the Hermes provider accepts images; any other provider throws, so a customer image
      // is never silently dropped (the caller decides how to degrade).
      ...(input.images?.length ? { images: input.images } : {}),
    };
    // Tokens and latency add up over every model call of the turn: one ai_run per customer turn.
    const total = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, latencyMs: 0 };
    const complete = async (followUp: ChatMessage[]) => {
      const turn = await this.completeTurn({
        ...request,
        messages: [...request.messages, ...followUp],
      });
      total.inputTokens += turn.res.usage.inputTokens;
      total.outputTokens += turn.res.usage.outputTokens;
      total.cachedInputTokens += turn.res.usage.cachedInputTokens;
      total.latencyMs += turn.res.latencyMs;
      return turn;
    };
    let last = await complete([]);
    let calls: ActionCall[] = [];
    let actionResults: string[] = [];
    let readback: string[] = [];
    let askedConfirmation = false;
    let forced: { guardrail: string | null } | null = null;
    if (this.actions && actionViews.length) {
      let current = last;
      const loop = await runActionLoop({
        facade: this.actions,
        ws,
        botId,
        conversationId: actionConversationId,
        isTest: context.isTest,
        actions: actionViews,
        first: { text: last.res.text, output: last.output },
        reminder: JSON_REMINDER,
        customerTexts,
        keyFor: (actionId, args) => idempotencyKey(actionConversationId, actionId, args),
        ask: async (followUp) => {
          current = await complete(followUp);
          return { text: current.res.text, output: current.output };
        },
      });
      calls = loop.calls;
      if (loop.kind === 'fallback') forced = { guardrail: loop.guardrail };
      else {
        actionResults = loop.results;
        readback = loop.readback;
        askedConfirmation = loop.askedConfirmation;
        // A confirmation question or a cancel answers with the model's own reply, not a new turn.
        last = { res: current.res, output: loop.turn.output };
      }
    }
    const res: GenerateResponse = {
      ...last.res,
      latencyMs: total.latencyMs,
      usage: {
        inputTokens: total.inputTokens,
        outputTokens: total.outputTokens,
        cachedInputTokens: total.cachedInputTokens,
      },
    };
    const output = last.output;

    const decision = forced
      ? fallbackDecision(bot, forced.guardrail)
      : decide(
          res.stopReason,
          output,
          bot,
          sources,
          [...customerTexts, ...readback],
          groundingData,
          actionResults,
        );
    // A question the guardrails replaced never reached the customer: their "ok" must not confirm it.
    if (this.actions && askedConfirmation && decision.outcome !== 'answered') {
      await this.actions.clearPending(ws, actionConversationId);
    }
    const promptVersion = `${prompt.name}@${prompt.version}`;
    const run = {
      id: newId(),
      botId,
      conversationId: context.conversationId,
      tier: bot.modelTier,
      provider: res.provider,
      model: res.model,
      promptVersion: post
        ? `${promptVersion}+${POST_PROMPT.name}@${POST_PROMPT.version}`
        : promptVersion,
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
      productIds: [],
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
      ...(calls.length ? { actions: calls } : {}),
    };
  }

  /** One model call with the format retry and the prose salvage of the original single-turn pipeline. */
  private async completeTurn(
    request: GenerateRequest,
  ): Promise<{ res: GenerateResponse; output: ParsedModelReply }> {
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
    return { res, output };
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
  profile: string,
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
          ? `${profile ? `${profile}\n\n` : ''}${knowledgeBlock(sources)}\n\n<shop_situations>\n${guidance}\n</shop_situations>\n\n${images ? `${images}\n\n` : ''}${customer}\n\n${JSON_REMINDER}`
          : customer,
    };
  });
}
