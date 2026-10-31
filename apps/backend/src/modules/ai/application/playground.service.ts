import { type GenerateRequest, PROMPTS_DIR, PromptRegistry } from '@agent-sales/ai-core';
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
import type { ReplyOptions, ReplyResult } from '../api/reply-options.js';
import { renderBusinessProfile } from '../domain/business-profile.js';
import { toSources } from '../domain/grounding.js';
import {
  buildAllowlist,
  imagesBlock,
  libraryImages,
  productIdOfImage,
  productImages,
} from '../domain/image-allowlist.js';
import { AI_RUN_REPOSITORY, type AiRunRepository } from '../domain/ports/ai-run.repository.js';
import {
  CONVERSATION_SUMMARY_REPOSITORY,
  type ConversationSummaryRepository,
} from '../domain/ports/conversation-summary.repository.js';
import { replyStyle } from '../domain/reply-style.js';
import { quotedSources } from '../domain/reply-text.js';
import { situationsText } from '../domain/situations.js';
import {
  actionTools,
  idempotencyKey,
  newActionToolState,
  playgroundConversationId,
} from './action-tools.js';
import { type AgentLoopResult, runAgentLoop } from './agent-loop.js';
import { createHistorySummarizer } from './history-summarizer.js';
import { LlmRuntime } from './llm-runtime.js';
import { HANDOFF_TOOL, ImageAllowlist, newOutputState } from './output-tools.js';
import {
  carriedProductIds,
  compactHistory,
  focusBlock,
  historyTurns,
  pendingBlock,
  PHONE_KNOWN_LINE,
  withTurnContext,
} from './reply-context.js';
import { decideReply, meteredGenerate, turnMessages, turnTools } from './reply-pipeline.js';

export { PHONE_KNOWN_LINE };

const PROMPT_RETAIL = { name: 'sales-agent', version: 13 } as const;
const PROMPT_LODGING = { name: 'sales-agent', version: 14 } as const;
/** Optional DI token: forces the sales-agent prompt for every bot (default: 14 for hotel bots, 13 otherwise). */
export const PROMPT_VERSION_OPTION = Symbol('PROMPT_VERSION_OPTION');
const POST_PROMPT = { name: 'fanpage-context', version: 2 } as const;
const MAX_SOURCES = 5;
const FOCUS_RUNS = 3;
const FOCUS_PRODUCTS = 3;
/** The playground has no conversation: only recent runs count as "the product being discussed". */
const PLAYGROUND_FOCUS_WINDOW_MS = 30 * 60_000;

const errorClass = (error: unknown): string =>
  error instanceof Error ? error.name : 'unknown error';

/**
 * The bot's reply pipeline, one customer turn: retrieve FAQs and focus products → agent loop
 * (catalog, action and output tools, free-text answer, optional `send_message`) → outcome
 * (handoff / answered / fallback) → ai_runs metering. Serves the dashboard playground, Messenger
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
    @Inject(PROMPT_VERSION_OPTION) @Optional() promptVersion?: 13 | 14,
    @Inject(CONVERSATION_SUMMARY_REPOSITORY)
    @Optional()
    private readonly summaries?: ConversationSummaryRepository,
  ) {
    this.#forcedPrompt =
      promptVersion === 13 ? PROMPT_RETAIL : promptVersion === 14 ? PROMPT_LODGING : undefined;
  }

  async playground(
    ws: WorkspaceId,
    botId: string,
    input: PlaygroundRequest,
  ): Promise<PlaygroundResponse> {
    return this.reply(ws, botId, input, { conversationId: null, isTest: true });
  }

  async reply(
    ws: WorkspaceId,
    botId: string,
    input: PlaygroundRequest,
    options: ReplyOptions = { conversationId: null, isTest: false },
  ): Promise<ReplyResult> {
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
    const catalog = this.catalog;

    // Products already discussed (the last runs of this conversation) need no new search.
    // A comment reply has no conversation to remember, so it never shares one across customers.
    const conversationKey = options.conversationId ?? playgroundConversationId(botId);
    const remembers = options.conversationId !== null || options.isTest;
    const focusIds =
      catalog && remembers
        ? await this.runs.recentProductIds(ws, conversationKey, {
            runs: FOCUS_RUNS,
            limit: FOCUS_PRODUCTS,
            ...(options.conversationId === null
              ? { since: new Date(Date.now() - PLAYGROUND_FOCUS_WINDOW_MS) }
              : {}),
          })
        : [];
    const focus =
      catalog && focusIds.length ? await catalog.getBotProductsByIds(ws, scope, focusIds) : [];
    // The pictures the bot may send. The model only gets ids and labels, never URLs; the list grows
    // with every product whose details a tool returns this turn.
    const libraryMatches = libraryImages(media, query);
    const initialAllowed = buildAllowlist(
      productImages(focus),
      libraryMatches,
      focus.some((p) => p.accommodation) ? query : '',
    );
    const allowlist = new ImageAllowlist(initialAllowed);
    const carryIds = carriedProductIds(options.carry ?? []);
    if (catalog && carryIds.length)
      allowlist.add(productImages(await catalog.getBotProductsByIds(ws, scope, carryIds)));

    const situations = [
      post
        ? `<originating_post>\n${JSON.stringify({ text: post.text, media: post.media, parentText: post.parentText }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')}\n</originating_post>`
        : '',
      guidance,
    ]
      .filter(Boolean)
      .join('\n\n');

    const actionViews = this.actions ? await this.actions.listForBot(ws, botId) : [];
    // A public comment reply has no private conversation: it never reads (or writes) the pending
    // key the owner's playground uses, confirm-required actions are refused for it, and it gets no
    // send_message (one public reply per comment).
    const isCommentReply = options.conversationId === null && !options.isTest;
    const storedPending =
      this.actions && actionViews.length && !isCommentReply
        ? await this.actions.getPending(ws, conversationKey)
        : null;
    // A pending call whose action was disabled meanwhile cannot be confirmed.
    const waiting = storedPending
      ? actionViews.find((a) => a.id === storedPending.actionId)
      : undefined;
    const pending = storedPending && waiting ? storedPending : null;
    const { definitions: actionDefinitions, byName } = actionTools(actionViews, pending);

    const actionState = newActionToolState();
    const actionContext = this.actions
      ? {
          facade: this.actions,
          ws,
          botId,
          conversationId: conversationKey,
          isTest: options.isTest,
          customerTexts,
          byName,
          keyFor: (actionId: string, args: Parameters<typeof idempotencyKey>[2]) =>
            idempotencyKey(conversationKey, actionId, args),
          state: actionState,
          // Only a call stored before this turn can be confirmed by it.
          confirmable: pending !== null,
          confirmationAvailable: !isCommentReply,
        }
      : null;
    const output = newOutputState();
    const tools = turnTools({
      ...(catalog ? { catalog: { ws, scope, catalog } } : {}),
      allowlist,
      output,
      ...(options.sink ? { sink: options.sink } : {}),
      sendMessage: !isCommentReply,
      actions: actionContext ? { definitions: actionDefinitions, context: actionContext } : null,
    });

    const postRules = post ? await this.#prompts.load(POST_PROMPT) : '';
    const template = [await this.#prompts.load(prompt), postRules].filter(Boolean).join('\n\n');
    // Byte-stable per bot: everything that changes per turn rides on the last user message.
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

    const meter = meteredGenerate((req) => this.llm.generate(req));
    const history = historyTurns(input, options.turnTimes);
    const summaryKey = options.conversationId;
    const stored =
      this.summaries && summaryKey && history.times
        ? await this.summaries.get(ws, summaryKey)
        : null;
    let loop: AgentLoopResult;
    try {
      const compact = await compactHistory(history.turns, {
        times: history.times,
        stored,
        summarize: createHistorySummarizer(meter.generate, {
          workspaceId: ws,
          tier: bot.modelTier,
        }),
        onError: (error) =>
          this.#logger.warn(
            `History summary failed (${errorClass(error)}), using the full history`,
          ),
      });
      if (compact.save && this.summaries && summaryKey)
        await this.summaries.put(ws, summaryKey, compact.save);

      const base: GenerateRequest = {
        workspaceId: ws,
        tier: bot.modelTier,
        messages: [
          { role: 'system', content: system },
          ...withTurnContext(compact.turns, {
            profile: renderBusinessProfile(bot),
            sources,
            situations,
            focus: focusBlock(focus),
            pending: pending && waiting ? pendingBlock(waiting, pending) : '',
            images: imagesBlock(initialAllowed),
            phoneKnown: input.phoneKnown === true,
            now: new Date(),
          }),
        ],
        maxOutputTokens: 2_000,
        tools: tools.definitions,
        promptCacheKey: `${botId}:${conversationKey}`,
        // Only the Hermes provider accepts images; any other provider throws, so a customer image
        // is never silently dropped (the caller decides how to degrade).
        ...(input.images?.length ? { images: input.images } : {}),
      };
      loop = await runAgentLoop({
        base,
        tools: tools.runnable,
        generate: meter.generate,
        isTerminal: (call) => call.name === HANDOFF_TOOL,
        ...(options.shouldInterrupt ? { shouldInterrupt: options.shouldInterrupt } : {}),
        ...(options.carry?.length ? { carry: options.carry } : {}),
        // The tool name and the error class only: a DB error message can embed customer words.
        onToolError: (name, error) =>
          this.#logger.warn(`Tool ${name} failed: ${errorClass(error)}`),
      });
    } catch (error) {
      // The confirmation question never reached the customer: their "ok" must not confirm it.
      if (this.actions && actionState.askedConfirmation)
        await this.actions.clearPending(ws, conversationKey);
      // Bill what the turn already consumed; the caller decides how to degrade.
      if (meter.last) {
        const failed = {
          ...this.#run(botId, bot.modelTier, options, prompt, post !== undefined, meter),
          retrieved: sources.map((s) => ({ faqId: s.faqId, score: s.score, used: false })),
          outcome: 'fallback' as const,
          guardrail: 'model_error',
          productIds: [],
        };
        await this.runs.record(ws, failed);
        recordAiRun(failed);
      }
      throw error;
    }

    const decision = decideReply({ loop, output, bot, actionFallback: actionState.fallback });
    const messages = turnMessages(output, decision);
    const interrupted = loop.outcome === 'interrupted';
    // A question that never reached the customer must not be confirmed by their next "ok".
    if (
      this.actions &&
      actionState.askedConfirmation &&
      (decision.outcome !== 'answered' || interrupted || !messages.length)
    ) {
      await this.actions.clearPending(ws, conversationKey);
    }

    const replyText = messages
      .map((m) => m.text)
      .filter(Boolean)
      .join('\n');
    const sentImages = messages.flatMap((m) => m.images);
    const used = quotedSources(replyText, sources);
    const run = {
      ...this.#run(botId, bot.modelTier, options, prompt, post !== undefined, meter),
      retrieved: sources.map((s) => ({ faqId: s.faqId, score: s.score, used: used.has(s.key) })),
      outcome: decision.outcome,
      guardrail: decision.guardrail,
      productIds: [
        ...new Set([
          ...loop.productIds,
          ...sentImages.flatMap((image) => productIdOfImage(image.id) ?? []),
        ]),
      ],
    };
    await this.runs.record(ws, run);
    recordAiRun(run);

    return {
      runId: run.id,
      reply: replyText,
      outcome: decision.outcome,
      guardrail: decision.guardrail,
      sources: sources.map((s) => ({
        faqId: s.faqId,
        question: s.question,
        score: s.score,
        used: used.has(s.key),
      })),
      // The joined view keeps its contract cap; every picture is listed under `messages`.
      images: sentImages.slice(0, 3).map(({ url, label }) => ({ url, label })),
      usage: meter.usage,
      provider: run.provider,
      model: run.model,
      latencyMs: meter.latencyMs,
      ...(actionState.calls.length ? { actions: actionState.calls } : {}),
      messages,
      steps: loop.steps,
      ...(interrupted ? { interrupted: true, carry: loop.followUps } : {}),
    };
  }

  /** The ai_runs fields shared by every outcome; usage and latency cover every model call made. */
  #run(
    botId: string,
    tier: string,
    options: ReplyOptions,
    prompt: { name: string; version: number },
    withPost: boolean,
    meter: ReturnType<typeof meteredGenerate>,
  ) {
    const promptVersion = `${prompt.name}@${prompt.version}`;
    return {
      id: newId(),
      botId,
      // A playground run is remembered under its stable id; a comment reply under none.
      conversationId:
        options.conversationId ?? (options.isTest ? playgroundConversationId(botId) : null),
      tier,
      provider: meter.last?.provider ?? 'none',
      model: meter.last?.model ?? 'none',
      promptVersion: withPost
        ? `${promptVersion}+${POST_PROMPT.name}@${POST_PROMPT.version}`
        : promptVersion,
      inputTokens: meter.usage.inputTokens,
      outputTokens: meter.usage.outputTokens,
      cachedTokens: meter.usage.cachedInputTokens,
      latencyMs: meter.latencyMs,
      isTest: options.isTest,
      createdAt: new Date(),
    };
  }
}
