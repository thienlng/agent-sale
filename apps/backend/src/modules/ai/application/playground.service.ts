import {
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
import { BOT_FACADE, type BotFacade } from '../../bot/api/index.js';
import { CATALOG_FACADE, type CatalogFacade } from '../../commerce/api/index.js';
import {
  KNOWLEDGE_FACADE,
  type KnowledgeFacade,
  TRAINING_FACADE,
  type TrainingFacade,
} from '../../knowledge/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import type { AiFacade } from '../api/ai.facade.js';
import { renderBusinessProfile } from '../domain/business-profile.js';
import { toSources } from '../domain/grounding.js';
import {
  buildAllowlist,
  imagesBlock,
  libraryImages,
  productIdOfImage,
  productImages,
  selectImages,
} from '../domain/image-allowlist.js';
import { FinalReply, type ParsedModelReply } from '../domain/model-reply.js';
import { AI_RUN_REPOSITORY, type AiRunRepository } from '../domain/ports/ai-run.repository.js';
import { productDetails } from '../domain/product-view.js';
import { replyStyle } from '../domain/reply-style.js';
import { situationsText } from '../domain/situations.js';
import {
  actionTools,
  idempotencyKey,
  newActionToolState,
  playgroundConversationId,
  runActionTool,
  safeJson,
} from './action-tools.js';
import { CATALOG_TOOLS, runCatalogTool } from './catalog-tools.js';
import { decide, fallbackDecision } from './decide-reply.js';
import { LlmRuntime } from './llm-runtime.js';
import {
  completeFinal,
  conversation,
  focusBlock,
  PHONE_KNOWN_LINE,
  pendingBlock,
} from './reply-context.js';
import { runToolLoop, type ToolLoopResult } from './tool-loop.js';

export { PHONE_KNOWN_LINE };

const PROMPT_RETAIL = { name: 'sales-agent', version: 11 } as const;
const PROMPT_LODGING = { name: 'sales-agent', version: 12 } as const;
/** Optional DI token: forces the sales-agent prompt for every bot (default: 12 for hotel bots, 11 otherwise). */
export const PROMPT_VERSION_OPTION = Symbol('PROMPT_VERSION_OPTION');
const POST_PROMPT = { name: 'fanpage-context', version: 1 } as const;
const MAX_SOURCES = 5;
const FOCUS_RUNS = 3;
const FOCUS_PRODUCTS = 3;
/** The playground has no conversation: only recent runs count as "the product being discussed". */
const PLAYGROUND_FOCUS_WINDOW_MS = 30 * 60_000;
/** Products fetched after the loop to extend the image allowlist (those the tools returned). */
const MAX_TOOL_IMAGE_PRODUCTS = 12;
const ALLOWLIST_CAP = 60;

/**
 * The bot's reply pipeline, single customer turn: retrieve FAQs and focus products → tool loop
 * (catalog and action tools, grounded structured final reply) → guardrails (number grounding,
 * fallback/handoff messages) → ai_runs metering. Serves the dashboard playground, Messenger
 * replies and fanpage comment replies.
 */
@Injectable()
export class PlaygroundService implements AiFacade {
  readonly #prompts = new PromptRegistry(PROMPTS_DIR);
  readonly #logger = new Logger(PlaygroundService.name);
  readonly #forcedPrompt: typeof PROMPT_RETAIL | typeof PROMPT_LODGING | undefined;

  constructor(
    @Inject(BOT_FACADE) private readonly bots: BotFacade,
    @Inject(KNOWLEDGE_FACADE) private readonly knowledge: KnowledgeFacade,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(LlmRuntime) private readonly llm: LlmRuntime,
    @Inject(AI_RUN_REPOSITORY) private readonly runs: AiRunRepository,
    @Inject(TRAINING_FACADE) @Optional() private readonly training?: TrainingFacade,
    @Inject(CATALOG_FACADE) @Optional() private readonly catalog?: CatalogFacade,
    @Inject(ACTION_FACADE) @Optional() private readonly actions?: ActionFacade,
    @Inject(PROMPT_VERSION_OPTION) @Optional() promptVersion?: 11 | 12,
  ) {
    this.#forcedPrompt =
      promptVersion === 11 ? PROMPT_RETAIL : promptVersion === 12 ? PROMPT_LODGING : undefined;
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
      this.#forcedPrompt ?? (bot.industry === 'hotel' ? PROMPT_LODGING : PROMPT_RETAIL);
    const workspace = await this.workspaces.getById(ws);
    const customerTexts = input.messages.filter((m) => m.role === 'customer').map((m) => m.content);

    // The last two customer messages: short follow-ups ("còn size 42 ko") need the earlier one.
    const post = input.postContext;
    const query = [post?.text.slice(0, 2000), ...customerTexts.slice(-2)]
      .filter(Boolean)
      .join('\n');
    const hits = await this.knowledge.searchFaqs(ws, botId, query, MAX_SOURCES);
    const sources = toSources(hits, bot.placeholders);
    const trainingItems = this.training ? await this.training.list(ws, botId) : [];
    const guidance = situationsText(trainingItems.filter((item) => item.kind === 'scenario'));
    const media = trainingItems.filter((item) => item.kind === 'media');
    const scope = { botId, catalogMode: bot.catalogMode };

    // Products already discussed (the last runs of this conversation) need no new search.
    // A comment reply has no conversation to remember, so it never shares one across customers.
    const conversationKey = context.conversationId ?? playgroundConversationId(botId);
    const remembers = context.conversationId !== null || context.isTest;
    const focusIds =
      this.catalog && remembers
        ? await this.runs.recentProductIds(ws, conversationKey, {
            runs: FOCUS_RUNS,
            limit: FOCUS_PRODUCTS,
            ...(context.conversationId === null
              ? { since: new Date(Date.now() - PLAYGROUND_FOCUS_WINDOW_MS) }
              : {}),
          })
        : [];
    const focus =
      this.catalog && focusIds.length
        ? await this.catalog.getBotProductsByIds(ws, scope, focusIds)
        : [];
    const focusText = focusBlock(focus);
    // The pictures the bot may send before any tool ran. The model only gets ids and labels, never URLs.
    const libraryMatches = libraryImages(media, query);
    const initialAllowed = buildAllowlist(
      productImages(focus),
      libraryMatches,
      focus.some((p) => p.accommodation) ? query : '',
    );

    const situations = [
      post
        ? `<originating_post>\n${JSON.stringify({ text: post.text, media: post.media, parentText: post.parentText }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')}\n</originating_post>`
        : '',
      guidance,
    ]
      .filter(Boolean)
      .join('\n\n');
    // Figures the reply may state: the shop's own post, guidance and focus products. The parent
    // comment is the customer's words, so a price in it is context, never a grounded source.
    const groundingData = [
      post ? JSON.stringify({ text: post.text, media: post.media }) : '',
      guidance,
      focus.length ? safeJson(focus.map(productDetails)) : '',
    ].join('\n');

    const actionViews = this.actions ? await this.actions.listForBot(ws, botId) : [];
    const storedPending =
      this.actions && actionViews.length
        ? await this.actions.getPending(ws, conversationKey)
        : null;
    // A pending call whose action was disabled meanwhile cannot be confirmed.
    const waiting = storedPending
      ? actionViews.find((a) => a.id === storedPending.actionId)
      : undefined;
    const pending = storedPending && waiting ? storedPending : null;
    const { definitions, byName } = actionTools(actionViews, pending);
    const tools = [...(this.catalog ? CATALOG_TOOLS : []), ...definitions];

    const postRules = post ? await this.#prompts.load(POST_PROMPT) : '';
    const template = [await this.#prompts.load(prompt), postRules].filter(Boolean).join('\n\n');
    const system = this.#prompts.render(template, {
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
    const systemContent = input.phoneKnown ? `${system}\n\n${PHONE_KNOWN_LINE}` : system;

    const base: GenerateRequest = {
      workspaceId: ws,
      tier: bot.modelTier,
      messages: [
        { role: 'system', content: systemContent },
        ...conversation(input, {
          profile: renderBusinessProfile(bot),
          sources,
          situations,
          focus: focusText,
          pending: pending && waiting ? pendingBlock(waiting, pending) : '',
          images: imagesBlock(initialAllowed),
        }),
      ],
      responseFormat: FinalReply,
      maxOutputTokens: 2_000,
      ...(tools.length ? { tools } : {}),
      // Only the Hermes provider accepts images; any other provider throws, so a customer image
      // is never silently dropped (the caller decides how to degrade).
      ...(input.images?.length ? { images: input.images } : {}),
    };

    const state = newActionToolState();
    const actionContext = this.actions
      ? {
          facade: this.actions,
          ws,
          botId,
          conversationId: conversationKey,
          isTest: context.isTest,
          customerTexts,
          byName,
          keyFor: (actionId: string, args: Parameters<typeof idempotencyKey>[2]) =>
            idempotencyKey(conversationKey, actionId, args),
          state,
          // Only a call stored before this turn can be confirmed by it.
          confirmable: pending !== null,
        }
      : null;
    const catalog = this.catalog;
    const catalogToolNames = new Set(CATALOG_TOOLS.map((t) => t.name));
    let loop: ToolLoopResult;
    let final: { res: GenerateResponse; output: ParsedModelReply };
    try {
      loop = await runToolLoop({
        base,
        generate: (req) => this.llm.generate(req),
        onError: (call, error) =>
          // The tool name and the error class only: a DB error message can embed customer words.
          this.#logger.warn(
            `Tool ${call.name} failed: ${error instanceof Error ? error.name : 'unknown error'}`,
          ),
        execute: async (call) => {
          if (catalog && catalogToolNames.has(call.name))
            return runCatalogTool({ ws, scope, catalog }, call);
          if (actionContext) return runActionTool(actionContext, call);
          return { content: '{"error":"unknown_tool"}', trusted: '' };
        },
      });
      final = loop.limitHit
        ? { res: loop.res, output: { ok: false, reason: 'empty' } }
        : await completeFinal({
            base,
            loop,
            generate: (req) => this.llm.generate(req),
            warn: (message) => this.#logger.warn(message),
          });
    } catch (error) {
      // The confirmation question never reached the customer: their "ok" must not confirm it.
      if (this.actions && state.askedConfirmation)
        await this.actions.clearPending(ws, conversationKey);
      throw error;
    }
    const { res, output } = final;

    const customerVisible = [...customerTexts, ...state.readback];
    const forced = loop.limitHit ? 'tool_loop_limit' : state.fallback;
    const decision =
      forced !== undefined
        ? fallbackDecision(bot, forced)
        : decide(res.stopReason, output, bot, sources, customerVisible, groundingData, [
            ...loop.trusted,
            ...state.results,
          ]);
    // A question the guardrails replaced (or an empty one) never reached the customer: their "ok"
    // must not confirm it.
    if (
      this.actions &&
      state.askedConfirmation &&
      (decision.outcome !== 'answered' || !decision.reply.trim())
    ) {
      await this.actions.clearPending(ws, conversationKey);
    }

    // Pictures follow only a grounded answer, and only ids of products the model saw this turn
    // (focus products, tool results) or of the image library.
    let sentImages: ReturnType<typeof selectImages> = [];
    if (decision.outcome === 'answered' && output.ok && output.value.imageIds.length) {
      const seen = new Set(focus.map((p) => p.id));
      const fetchIds = loop.productIds
        .filter((id) => !seen.has(id))
        .slice(-MAX_TOOL_IMAGE_PRODUCTS);
      const fetched =
        catalog && fetchIds.length ? await catalog.getBotProductsByIds(ws, scope, fetchIds) : [];
      const allowed = buildAllowlist(
        productImages([...focus, ...fetched]),
        libraryMatches,
        [...focus, ...fetched].some((p) => p.accommodation) ? query : '',
        ALLOWLIST_CAP,
      );
      sentImages = selectImages(output.value.imageIds, allowed);
    }

    const promptVersion = `${prompt.name}@${prompt.version}`;
    const run = {
      id: newId(),
      botId,
      // A playground run is remembered under its stable id; a comment reply under none.
      conversationId: context.conversationId ?? (context.isTest ? conversationKey : null),
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
      productIds: [
        ...new Set([
          ...loop.productIds,
          ...sentImages.flatMap((image) => productIdOfImage(image.id) ?? []),
        ]),
      ],
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
      images: sentImages.map(({ url, label }) => ({ url, label })),
      usage: res.usage,
      provider: res.provider,
      model: res.model,
      latencyMs: res.latencyMs,
      ...(state.calls.length ? { actions: state.calls } : {}),
    };
  }
}
