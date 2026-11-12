import {
  type AgentLoopResult,
  type AgentStep,
  type GenerateRequest,
  PROMPTS_DIR,
  PromptRegistry,
  runAgentLoop,
} from '@agent-sales/ai-core';
import {
  defaultOfferingKind,
  isRequestIndustry,
  type PlaygroundRequest,
  type PlaygroundResponse,
  requestProfileFor,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { aiTraceWriteFailures, recordAiRun } from '../../../common/metrics.js';
import { ACTION_FACADE, type ActionFacade } from '../../action/api/index.js';
import { BOT_FACADE, type BotFacade } from '../../bot/api/index.js';
import {
  CATALOG_FACADE,
  type CatalogFacade,
  COMMERCE_FACADE,
  type CommerceFacade,
} from '../../commerce/api/index.js';
import { CRM_FACADE, type CrmFacade } from '../../crm/api/index.js';
import {
  KNOWLEDGE_FACADE,
  type KnowledgeFacade,
  TRAINING_FACADE,
  type TrainingFacade,
} from '../../knowledge/api/index.js';
import {
  LODGING_BOT_FACADE,
  LODGING_CATALOG_FACADE,
  LODGING_FACADE,
  type LodgingBotFacade,
  type LodgingCatalogFacade,
  type LodgingFacade,
} from '../../lodging/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import type { AiFacade } from '../api/ai.facade.js';
import type { ReplyOptions, ReplyResult } from '../api/reply-options.js';
import { renderBusinessProfile } from '../domain/business-profile.js';
import { toSources } from '../domain/grounding.js';
import { navTargets } from '../domain/page-nav.js';
import {
  buildAllowlist,
  imagesBlock,
  libraryImages,
  productIdOfImage,
  productImages,
} from '../domain/image-allowlist.js';
import {
  AI_RUN_REPOSITORY,
  type AiRunRecord,
  type AiRunRepository,
} from '../domain/ports/ai-run.repository.js';
import {
  CONVERSATION_SUMMARY_REPOSITORY,
  type ConversationSummaryRepository,
} from '../domain/ports/conversation-summary.repository.js';
import {
  TURN_TRACE_REPOSITORY,
  type TurnStepRecord,
  type TurnTraceRecord,
  type TurnTraceRepository,
} from '../domain/ports/turn-trace.repository.js';
import { quotedSources } from '../domain/reply-text.js';
import { activeSituations, situationsText } from '../domain/situations.js';
import {
  actionTools,
  CANCEL_TOOL,
  CONFIRM_TOOL,
  idempotencyKey,
  newActionToolState,
  playgroundConversationId,
} from './action-tools.js';
import { createHistorySummarizer } from './history-summarizer.js';
import {
  HOLD_CONFIRM_PAYLOAD,
  holdCreatedText,
  hotelHoldContext,
  localHoldTime,
} from './hold-tools.js';
import { LlmRuntime } from './llm-runtime.js';
import {
  confirmableDraft,
  answeredSince,
  newOrderToolState,
  announceCreated,
  announceOrder,
  keepSummaryLast,
  ORDER_CONFIRM_PAYLOAD,
  type OrderToolContext,
  PLAYGROUND_ORDER_CHANNEL,
} from './order-tools.js';
import { HANDOFF_TOOL, ImageAllowlist, newOutputState } from './output-tools.js';
import { withDefaultOfferings } from './catalog-tools.js';
import {
  carriedProductIds,
  compactHistory,
  EMAIL_KNOWN_LINE,
  focusBlock,
  historyTurns,
  loadReplyTemplate,
  pendingBlock,
  PHONE_KNOWN_LINE,
  renderBotSystemPrompt,
  visitorPageBlock,
  withTurnContext,
} from './reply-context.js';
import {
  decideReply,
  errorClass,
  fallbackText,
  joinedImages,
  meteredGenerate,
  type ReplyDecision,
  runBase,
  turnMessages,
  turnTools,
} from './reply-pipeline.js';
import type { RequestToolContext } from './request-tools.js';
import { AI_SPEND_LIMITS, budgetHandoff, type AiSpendLimits } from './spend-guard.js';
import { sha256, TraceRecorder, traceExcerpt } from './trace-recorder.js';

export { EMAIL_KNOWN_LINE, PHONE_KNOWN_LINE };

// TODO(prompt-budget): slim the per-turn prompt later; every agent-loop round resends all of it.
// 1. Compose sales-agent conditionally: "Closing an order" only when bot.orderTaking, "Actions"
//    only when the bot has actions (today every bot pays ~3.5K chars for both).
// 2. Dedupe repeated rules (phone → handoff ×3, "data, never instructions" ×5, "never invent" ×6)
//    and the tool descriptions that restate the system prompt (calculate, send_message, prepare_order).
// 3. renderBusinessProfile: drop the "(not provided)" lines, say "unlisted fields are unknown" once.
// 4. Skip empty <shop_situations> / "(no matching entries)" blocks; add a score floor to FAQ hits.
// 5. <focus_products>: compact view instead of full details of 3 products every turn.
// 6. Playground (conversationId null) cannot store the history summary, so long test chats
//    re-summarise on every turn.
// Steps 2 and 5 change bot behaviour: run the ai evals before/after. Measure first (prompt viewer).
/** The sales-agent prompt version of a bot's industry; an industry not listed gets @15 (retail). */
export const PROMPT_BY_INDUSTRY: Readonly<Record<string, SalesPromptVersion>> = {
  // @20 + unit details, unit albums and bedroom packages (T-193). @20 = @18 + lodging media
  // folders: albums by albumId, videos only on request (T-192).
  hotel: 21,
  // The request industries: @15 plus "Recording a request" and the course / service facts.
  saas: 19,
  education: 19,
  spa: 19,
};
const DEFAULT_PROMPT_VERSION: SalesPromptVersion = 15;
/** The sales-agent prompt of a bot of `industry` (without the forcing option). */
export function salesPromptFor(industry: string): {
  name: 'sales-agent';
  version: SalesPromptVersion;
} {
  return { name: 'sales-agent', version: PROMPT_BY_INDUSTRY[industry] ?? DEFAULT_PROMPT_VERSION };
}
/** The sales-agent prompt versions the option may force (13/14: before the order tools). */
export type SalesPromptVersion = 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21;
/** Optional DI token: forces the sales-agent prompt for every bot (default: `PROMPT_BY_INDUSTRY`). */
export const PROMPT_VERSION_OPTION = Symbol('PROMPT_VERSION_OPTION');
/** The current public base of Rapiz storage (`S3_PUBLIC_URL`); pictures are sent on it. */
export const MEDIA_PUBLIC_BASE = Symbol('MEDIA_PUBLIC_BASE');
const POST_PROMPT = { name: 'fanpage-context', version: 2 } as const;
const PAGE_PROMPT = { name: 'website-page', version: 2 } as const;
const MAX_SOURCES = 5;
const FOCUS_RUNS = 3;
const FOCUS_PRODUCTS = 3;
/** The playground has no conversation: only recent runs count as "the product being discussed". */
const PLAYGROUND_FOCUS_WINDOW_MS = 30 * 60_000;

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
  readonly #forcedPrompt: { name: 'sales-agent'; version: SalesPromptVersion } | undefined;

  constructor(
    @Inject(BOT_FACADE) private readonly bots: BotFacade,
    @Inject(KNOWLEDGE_FACADE) private readonly knowledge: KnowledgeFacade,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(LlmRuntime) private readonly llm: LlmRuntime,
    @Inject(AI_RUN_REPOSITORY) private readonly runs: AiRunRepository,
    @Inject(TRAINING_FACADE) @Optional() private readonly training?: TrainingFacade,
    @Inject(CATALOG_FACADE) @Optional() private readonly catalog?: CatalogFacade,
    @Inject(ACTION_FACADE) @Optional() private readonly actions?: ActionFacade,
    @Inject(PROMPT_VERSION_OPTION) @Optional() promptVersion?: SalesPromptVersion,
    @Inject(CONVERSATION_SUMMARY_REPOSITORY)
    @Optional()
    private readonly summaries?: ConversationSummaryRepository,
    @Inject(COMMERCE_FACADE) @Optional() private readonly commerce?: CommerceFacade,
    @Inject(LODGING_CATALOG_FACADE)
    @Optional()
    private readonly lodgingCatalog?: LodgingCatalogFacade,
    @Inject(LODGING_BOT_FACADE) @Optional() private readonly lodgingBot?: LodgingBotFacade,
    @Inject(LODGING_FACADE) @Optional() private readonly lodging?: LodgingFacade,
    @Inject(MEDIA_PUBLIC_BASE) @Optional() private readonly mediaBase?: string,
    @Inject(CRM_FACADE) @Optional() private readonly crm?: CrmFacade,
    @Inject(TURN_TRACE_REPOSITORY) @Optional() private readonly traces?: TurnTraceRepository,
    @Inject(AI_SPEND_LIMITS) @Optional() private readonly spend: AiSpendLimits = {},
  ) {
    this.#forcedPrompt = promptVersion
      ? { name: 'sales-agent', version: promptVersion }
      : undefined;
  }

  async conversationSummary(
    ws: WorkspaceId,
    conversationId: string,
  ): Promise<{ summary: string; coveredUntil: string } | null> {
    const found = await this.summaries?.get(ws, conversationId);
    return found
      ? { summary: found.summary, coveredUntil: found.coveredUntil.toISOString() }
      : null;
  }

  async playground(
    ws: WorkspaceId,
    botId: string,
    input: PlaygroundRequest,
    actor?: { userId: string },
  ): Promise<PlaygroundResponse> {
    // Owner-side spend (audit #15): the user's run rate and the account's tokens of the day.
    const owner = this.spend.owner;
    const accountId = owner && actor ? await this.workspaces.accountOf(ws) : null;
    if (owner && actor && accountId) await owner.playgroundRun(accountId, actor.userId);
    return this.#turn(ws, botId, input, { conversationId: null, isTest: true }, accountId);
  }

  async reply(
    ws: WorkspaceId,
    botId: string,
    input: PlaygroundRequest,
    options: ReplyOptions = { conversationId: null, isTest: false },
  ): Promise<ReplyResult> {
    return this.#turn(ws, botId, input, options, null);
  }

  /** One turn; `accountId` set = an owner-side run charged to the account's daily tokens. */
  async #turn(
    ws: WorkspaceId,
    botId: string,
    input: PlaygroundRequest,
    options: ReplyOptions,
    accountId: string | null,
  ): Promise<ReplyResult> {
    const startedAt = new Date();
    const bot = await this.bots.getBot(ws, botId);
    // A conversation over its hourly model budget (audit #15): no model call, staff take over.
    const budget = options.conversationId ? this.spend.conversation : undefined;
    if (budget && options.conversationId && (await budget.exhausted(ws, options.conversationId))) {
      this.#logger.warn(`Conversation model budget spent, handing off (bot ${botId})`);
      return budgetHandoff(bot);
    }
    const prompt = this.#forcedPrompt ?? salesPromptFor(bot.industry);
    const workspace = await this.workspaces.getById(ws);
    const customerTexts = input.messages.filter((m) => m.role === 'customer').map((m) => m.content);

    // The last two customer messages: short follow-ups ("còn size 42 ko") need the earlier one.
    const post = input.postContext;
    const page = input.pageContext;
    // What the visitor has on screen resolves short questions ("400k là sao?") to that section.
    const query = [
      post?.text.slice(0, 2000),
      ...(page?.sections.map((section) => section.text) ?? []),
      ...customerTexts.slice(-2),
    ]
      .filter(Boolean)
      .join('\n');
    const hits = await this.knowledge.searchFaqs(ws, botId, query, MAX_SOURCES);
    const sources = toSources(hits, bot.placeholders);
    const trainingItems = this.training ? await this.training.list(ws, botId) : [];
    const scenarios = activeSituations(trainingItems.filter((item) => item.kind === 'scenario'));
    const guidance = situationsText(scenarios);
    const media = trainingItems.filter((item) => item.kind === 'media');
    const scope = { botId, catalogMode: bot.catalogMode };
    // Hotel bots sell lodging properties instead of commerce products (T-160): their selection
    // lives in lodging and catalogMode is ignored.
    // In a request business a product without an offering reads as one of the industry's kind.
    const catalog: CatalogFacade | undefined =
      bot.industry === 'hotel'
        ? this.lodgingCatalog
        : withDefaultOfferings(this.catalog, defaultOfferingKind(bot.industry));

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
    const allowlist = new ImageAllowlist(initialAllowed, this.mediaBase);
    allowlist.addMedia(focus);
    const carryIds = carriedProductIds(options.carry ?? []);
    if (catalog && carryIds.length)
      allowlist.addProducts(await catalog.getBotProductsByIds(ws, scope, carryIds));

    const situations = [
      post
        ? `<originating_post>\n${JSON.stringify({ text: post.text, media: post.media, parentText: post.parentText }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')}\n</originating_post>`
        : '',
      page ? visitorPageBlock(page) : '',
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
    const recorder = new TraceRecorder({
      actionIdOf: (name) =>
        name === CONFIRM_TOOL || name === CANCEL_TOOL
          ? (pending?.actionId ?? null)
          : (byName.get(name)?.id ?? null),
      actionStatus: () => ({
        count: actionState.calls.length,
        last: actionState.calls.at(-1)?.statusCode ?? null,
      }),
    });

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
    // Orders need a private conversation: never for a public comment reply. Hotel bots sell
    // lodging properties, which commerce orders cannot hold (T-160). A request industry converts
    // through record_request, never an order, even with order taking on (ESV-R7).
    const orders: OrderToolContext | null =
      this.commerce &&
      bot.orderTaking &&
      !isCommentReply &&
      bot.industry !== 'hotel' &&
      !isRequestIndustry(bot.industry)
        ? {
            facade: this.commerce,
            ws,
            bot,
            conversationId: conversationKey,
            channel: options.channel ?? PLAYGROUND_ORDER_CHANNEL,
            ...(options.sink ? { sink: options.sink } : {}),
            output,
            confirmable: await confirmableDraft(
              this.commerce,
              ws,
              conversationKey,
              answeredSince(input.messages, options.turnTimes, startedAt),
              (error) => this.#logger.warn(`Order draft check failed: ${errorClass(error)}`),
            ),
            state: newOrderToolState(),
            onError: (error: unknown) =>
              this.#logger.warn(`Order draft drop failed: ${errorClass(error)}`),
          }
        : null;
    const holds =
      this.lodgingBot && this.lodgingCatalog && bot.industry === 'hotel'
        ? await hotelHoldContext({
            facade: this.lodgingBot,
            catalog: this.lodgingCatalog,
            ws,
            bot,
            conversationId: conversationKey,
            channel: options.channel ?? PLAYGROUND_ORDER_CHANNEL,
            contactId: options.contactId ?? null,
            ...(this.lodging ? { lodging: this.lodging } : {}),
            ...(options.sink ? { sink: options.sink } : {}),
            output,
            privateChat: !isCommentReply,
            answered: answeredSince(input.messages, options.turnTimes, startedAt),
            warn: (message) => this.#logger.warn(message),
          })
        : null;
    // A bot of a request industry records its requests on the CRM customer itself (ADR-020).
    const requestProfile = requestProfileFor(bot.industry);
    // The products the turn knows by name: an empty course or service is filled from them.
    const seenNames = new Map(focus.map((p) => [p.id, p.name]));
    // A website visitor's turn: the products the bot may show as cards (focus and catalog results).
    const shownable = new Map(focus.map((p) => [p.id, p]));
    const requestTool: RequestToolContext | null =
      this.crm && requestProfile
        ? {
            facade: this.crm,
            ws,
            profile: requestProfile,
            isTest: options.isTest,
            customerTexts,
            calls: actionState.calls,
            catalogNames: () => [...seenNames.values()],
            onError: (error) => this.#logger.warn(`Request tool failed: ${errorClass(error)}`),
          }
        : null;
    const seenProducts = new Set<string>();
    const tools = turnTools({
      ...(catalog ? { catalog: { ws, scope, catalog } } : {}),
      allowlist,
      onProducts: (products) =>
        products.forEach((p) => {
          seenProducts.add(p.id);
          seenNames.set(p.id, p.name);
        }),
      onListed: (products) => products.forEach((p) => shownable.set(p.id, p)),
      output,
      ...(options.sink ? { sink: options.sink } : {}),
      sendMessage: !isCommentReply,
      website:
        page && !isCommentReply
          ? {
              products: shownable,
              navigation: navTargets(page),
              language: bot.language === 'en' ? 'en' : 'vi',
            }
          : null,
      actions: actionContext ? { definitions: actionDefinitions, context: actionContext } : null,
      orders,
      holds,
      requests: requestTool,
      // Channels pass what the conversation already received; the playground sends its own list.
      sentMediaUrls: options.sentMediaUrls ?? input.sentMediaUrls ?? [],
    });

    const contextPrompts = [...(post ? [POST_PROMPT] : []), ...(page ? [PAGE_PROMPT] : [])];
    const template = await loadReplyTemplate(this.#prompts, [prompt, ...contextPrompts]);
    // Byte-stable per bot: everything that changes per turn rides on the last user message.
    const system = renderBotSystemPrompt(bot, workspace, template);

    // Every call is charged as it completes, so interrupted or undelivered turns count too.
    const meter = meteredGenerate(async (req) => {
      const res = await this.llm.generate(req);
      await Promise.all([
        budget && options.conversationId
          ? budget.charge(ws, options.conversationId, res.usage)
          : undefined,
        accountId ? this.spend.owner?.charge(accountId, res.usage) : undefined,
      ]).catch(() => this.#logger.warn('Model spend not counted'));
      return res;
    });
    const promptVersion = [prompt, ...contextPrompts]
      .map((p) => `${p.name}@${p.version}`)
      .join('+');
    const history = historyTurns(input, options.turnTimes);
    const summaryKey = options.conversationId;
    const stored =
      this.summaries && summaryKey && history.times
        ? await this.summaries.get(ws, summaryKey)
        : null;
    const steps: AgentStep[] = [];
    let loop: AgentLoopResult | null = null;
    let historySummarized = false;
    // Everything the trace keeps, from data already in scope (spec §4.4); excerpts are redacted.
    const traceOf = (
      run: { id: string; conversationId: string | null },
      loopOutcome: TurnTraceRecord['loopOutcome'],
      replyText: string,
      messagesSent: number,
    ): { trace: TurnTraceRecord; steps: TurnStepRecord[] } => ({
      trace: {
        runId: run.id,
        botId,
        conversationId: run.conversationId,
        startedAt,
        channel: options.channel ?? null,
        commentReply: isCommentReply,
        historyTurns: history.turns.length,
        historySummarized,
        customerImages: input.images?.length ?? 0,
        queryExcerpt: traceExcerpt(query),
        replyExcerpt: traceExcerpt(replyText),
        scenarioIds: scenarios.map((item) => item.id),
        focusProductIds: focusIds.slice(0, FOCUS_PRODUCTS),
        actionIds: actionViews.map((a) => a.id).slice(0, 20),
        pendingAction: pending !== null,
        offeredTools: tools.definitions.map((d) => d.name).sort(),
        systemPromptSha: sha256(system),
        situationsSha: sha256(guidance),
        modelCalls: loop?.modelCalls ?? meter.calls,
        loopOutcome,
        messagesSent,
        messagesUndelivered: recorder.undelivered,
      },
      steps: recorder.steps(),
    });
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
      historySummarized = compact.turns.length !== history.turns.length;
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
            emailKnown: input.emailKnown === true,
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
        tools: recorder.wrap(tools.runnable),
        // Once a message went out, an empty final answer is fine: no gateway retry for it.
        generate: (req) => meter.generate(output.sent.length ? { ...req, allowEmpty: true } : req),
        onStep: (step) => {
          // The shop bot keeps no tool arguments or results in its steps (only the trace's
          // allowlisted detail); the owner-assistant debug fields stay out of its result.
          const { input: _in, result: _out, usage: _u, requested: _r, ...kept } = step;
          steps.push(kept);
          recorder.onStep(step);
        },
        isTerminal: (call) => call.name === HANDOFF_TOOL,
        ...(options.shouldInterrupt ? { shouldInterrupt: options.shouldInterrupt } : {}),
        ...(options.carry?.length ? { carry: options.carry } : {}),
        // The tool name and the error class only: a DB error message can embed customer words.
        onToolError: (name, error) =>
          this.#logger.warn(`Tool ${name} failed: ${errorClass(error)}`),
      });
    } catch (error) {
      // A created order (or hold) counts as delivered: its code must still reach the customer.
      if (!output.sent.length && !orders?.state.orderCreated && !holds?.state.created) {
        // Nothing reached the customer: their "ok" must not confirm an unasked question, the turn
        // is billed for what it consumed, and the caller decides how to degrade.
        if (this.actions && actionState.askedConfirmation)
          await this.actions.clearPending(ws, conversationKey);
        if (meter.last) {
          const failed = {
            ...runBase({ botId, tier: bot.modelTier, options, promptVersion, meter }),
            retrieved: sources.map((s) => ({ faqId: s.faqId, score: s.score, used: false })),
            outcome: 'fallback' as const,
            guardrail: 'model_error',
            productIds: [...seenProducts],
          };
          await this.#record(ws, failed, () => traceOf(failed, 'error', '', 0));
        }
        throw error;
      }
      // Messages were already delivered: report them, so the caller neither retries nor repeats them.
      this.#logger.warn(`Model call failed after messages were sent (${errorClass(error)})`);
    }

    let decision: ReplyDecision = loop
      ? decideReply({ loop, output, bot, actionFallback: actionState.fallback })
      : { outcome: 'answered', guardrail: 'model_error', final: fallbackText(bot) };
    const droppedFinal = Boolean(decision.final);
    decision = keepSummaryLast(
      decision,
      output.sent,
      holds ? HOLD_CONFIRM_PAYLOAD : ORDER_CONFIRM_PAYLOAD,
    );
    const finalDropped = droppedFinal && !decision.final;
    // An order was created: its code reaches the customer exactly once, whatever cut the turn short.
    const orderCode = orders?.state.orderCode;
    if (orderCode) {
      const sentTexts = output.sent.map((m) => m.text);
      decision = announceOrder(decision, { orderCode, sentTexts, fallback: fallbackText(bot) });
    }
    const held = holds?.state.created;
    if (held) {
      decision = announceCreated(decision, {
        code: held.code,
        line: holdCreatedText(held.code, held.expiresAt),
        sentTexts: output.sent.map((m) => m.text),
        fallback: fallbackText(bot),
        // The code alone is not enough: the customer must also read until when it is held.
        alsoRequired: [localHoldTime(held.expiresAt)?.time].filter((t) => t !== undefined),
      });
    }
    const messages = turnMessages(output, decision);
    const interrupted = loop?.outcome === 'interrupted';
    // A question that never reached the customer must not be confirmed by their next "ok".
    if (
      this.actions &&
      actionState.askedConfirmation &&
      (decision.outcome !== 'answered' ||
        decision.guardrail === 'model_error' ||
        interrupted ||
        finalDropped ||
        !messages.length)
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
      ...runBase({ botId, tier: bot.modelTier, options, promptVersion, meter }),
      retrieved: sources.map((s) => ({ faqId: s.faqId, score: s.score, used: used.has(s.key) })),
      outcome: decision.outcome,
      guardrail: decision.guardrail,
      productIds: [
        ...new Set([
          ...(loop?.productIds ?? seenProducts),
          ...sentImages.flatMap((image) => productIdOfImage(image.id) ?? []),
        ]),
      ],
    };
    await this.#record(ws, run, () =>
      traceOf(run, loop?.outcome ?? 'error', replyText, messages.length),
    );

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
      images: joinedImages(sentImages),
      usage: meter.usage,
      provider: run.provider,
      model: run.model,
      latencyMs: meter.latencyMs,
      ...(actionState.calls.length ? { actions: actionState.calls } : {}),
      messages,
      steps,
      ...(interrupted && loop ? { interrupted: true, carry: loop.followUps } : {}),
      ...(actionState.askedConfirmation ? { askedConfirmation: true } : {}),
      // A placed hold is binding like an order: the caller must never drop its final message.
      ...(orders?.state.orderCreated || held ? { orderCreated: true } : {}),
    };
  }

  async discardPendingConfirmation(ws: WorkspaceId, conversationId: string): Promise<void> {
    await this.actions?.clearPending(ws, conversationId);
  }

  /**
   * Writes the run; an interrupted one is not counted as a fallback in the outcome metric. Then the
   * turn trace, best-effort in its own transaction: a failure is logged (error class only) and
   * counted, never thrown (Ruling C5-R5). The trace is built inside the guard too, so a failure
   * while building it never fails a reply or hides the original model error.
   */
  async #record(
    ws: WorkspaceId,
    run: AiRunRecord,
    buildTrace?: () => { trace: TurnTraceRecord; steps: TurnStepRecord[] },
  ): Promise<void> {
    await this.runs.record(ws, run);
    recordAiRun({ ...run, outcome: run.guardrail === 'interrupted' ? 'interrupted' : run.outcome });
    if (!buildTrace || !this.traces) return;
    try {
      const trace = buildTrace();
      await this.traces.record(ws, trace.trace, trace.steps);
    } catch (error) {
      aiTraceWriteFailures.inc();
      this.#logger.warn(`Turn trace not recorded (${errorClass(error)})`);
    }
  }
}
