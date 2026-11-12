import {
  maskOwnerSecrets,
  runAgentLoop,
  SECRET_REMOVED,
  type AgentLoopResult,
  type AgentStep,
  type ChatMessage,
  type ToolCall,
} from '@agent-sales/ai-core';
import type { AssistantUiAction, SendAssistantMessageRequest } from '@agent-sales/contracts';
import { newId } from '@agent-sales/shared';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import {
  AI_LLM_GATEWAY,
  isAiNotConfiguredError,
  isModelRateLimitedError,
  type LlmGatewayPort,
} from '../../ai/api/index.js';
import {
  AssistantBusyError,
  AssistantNotFoundError,
  AssistantRunIdTakenError,
} from '../domain/assistant.errors.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import {
  ASSISTANT_REPOSITORY,
  type AssistantRepository,
  type AssistantSettingsRecord,
  DEFAULT_ASSISTANT_SETTINGS,
  type MessageRecord,
  type NewMessage,
  type RunRecord,
  type StepRecord,
  type ThreadRecord,
} from '../domain/ports/assistant.repository.js';
import {
  ACCESS_DELEGATION,
  type AccessDelegation,
} from '../domain/ports/access-delegation.port.js';
import { ROUTE_INVOKER, type RouteInvoker } from '../domain/ports/route-invoker.port.js';
import { ASSISTANT_SQL_RUNNER, type SqlRunner } from '../domain/ports/sql-runner.port.js';
import { CompactionService, threadCacheKey } from './compaction.service.js';
import { CORE_TOOL_DEFINITIONS, coreTools, type ToolContext } from './core-tools.js';
import { DELEGATION_MARGIN_SECONDS, delegatedAuthorization } from './delegated-authorization.js';
import { buildImportBlock } from './import-block.js';
import { IMPORT_TOOL_DEFINITIONS, importTools } from './import-tools.js';
import { isVisibleMessage } from './mappers.js';
import { currentIndustry, industryOfBusiness } from './owner-access.js';
import { MEMORY_TOOL_DEFINITION, memoryTool, taintOnToolOutput } from './memory-tools.js';
import { buildTurnMessage } from './prompt-builder.js';
import { ROUTE_CATALOG, type RouteCatalog } from './route-catalog.js';
import { ROUTE_TOOL_DEFINITIONS, routeTools } from './route-tools.js';
import { planReview } from './review-trigger.js';
import { SCHEDULE_TOOL_DEFINITION, scheduleTool } from './schedule-tools.js';
import { SchedulesService } from './schedules.service.js';
import { SKILL_TOOL_DEFINITIONS, skillTools } from './skill-tools.js';
import { SkillsService } from './skills.service.js';
import { MAX_CHARTS_PER_TURN } from './sql/chart.js';
import { type NativeToolEntry, SQL_TOOLSET, sqlTools } from './sql/sql-tools.js';
import { stepDetail } from './step-detail.js';
import { disabledTools, enabledDefinitions, toolsetCacheSuffix } from './toolsets.js';
import { withTurnOutputBudget } from './turn-budget.js';

/** The assistant answers on the `pro` tier (ADR-024). */
export const TURN_TIER = 'pro' as const;
export const TURN_MAX_ROUNDS = 25;
export const TURN_BUDGET_MS = 90_000;
export const TURN_CALL_TIMEOUT_MS = 60_000;
/** An untitled thread takes this many characters of its first message as its title. */
export const TITLE_CHARS = 60;
/** Said when the turn ends without a usable answer, or the model failed. */
export const FALLBACK_REPLY = 'Dạ em chưa trả lời được lúc này, anh/chị thử lại giúp em nhé.';
/** The fallback when the turn drafted a proposal before the model failed (QA TinyMind N5). */
export const PROPOSAL_FALLBACK_REPLY =
  'Dạ em đã soạn đề xuất bên dưới, anh/chị xem và duyệt giúp em nhé.';
/**
 * Safety cap on the active messages the model sees; compaction normally keeps the history far
 * shorter (ruling 1b-R5). The window starts at a user, event or summary message, so an assistant
 * tool call and its results are never split.
 */
export const HISTORY_MAX_MESSAGES = 200;
/** However long a compaction took, the model keeps at least this much of the turn budget. */
export const MIN_ANSWER_BUDGET_MS = 30_000;
/** Appended to the last tool result at 80% of the turn budget (the shop bot's text says customer). */
export const OWNER_WRAP_UP_NOTICE = 'Time is almost up: answer the owner now with what you have.';
const byName = (a: { name: string }, b: { name: string }) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
/** Every tool the model is offered, sorted by name so the tool list stays cache-stable. */
export const TURN_TOOL_DEFINITIONS = [
  ...CORE_TOOL_DEFINITIONS,
  MEMORY_TOOL_DEFINITION,
  ...SKILL_TOOL_DEFINITIONS,
  ...ROUTE_TOOL_DEFINITIONS,
  ...IMPORT_TOOL_DEFINITIONS,
  SCHEDULE_TOOL_DEFINITION,
].sort(byName);
/** The turn's tools without `schedule` (a report thread): no schedule created from a schedule (core §12). */
export const TURN_TOOL_DEFINITIONS_NO_SCHEDULE = TURN_TOOL_DEFINITIONS.filter(
  (t) => t.name !== SCHEDULE_TOOL_DEFINITION.name,
);

export interface TurnResult {
  /** The visible messages of the turn (the owner's text, then the answer). */
  messages: MessageRecord[];
  run: RunRecord & { steps: StepRecord[] };
  /** The owner's text carried secrets; the stored message and the model saw them masked. */
  secretsRemoved: boolean;
}

const row = (over: Partial<NewMessage> & Pick<NewMessage, 'role' | 'content'>): NewMessage => ({
  id: newId(),
  toolCalls: null,
  toolCallId: null,
  toolName: null,
  pageContext: null,
  uiActions: [],
  runId: null,
  ...over,
});

/** The model-only tail of an approval event (QA N9): the route and the created record's id. */
function eventMeta(meta: unknown): string {
  const m = meta as { routeKey?: unknown; resultId?: unknown } | null;
  if (typeof m?.routeKey !== 'string' || typeof m.resultId !== 'string') return '';
  return ` (${m.routeKey} → id ${m.resultId})`;
}

/** A stored message as the model sees it; `event` rows read as user messages. */
function toChatMessage(m: MessageRecord): ChatMessage {
  switch (m.role) {
    case 'assistant':
      return {
        role: 'assistant',
        content: m.content,
        ...(m.toolCalls?.length ? { toolCalls: m.toolCalls as ToolCall[] } : {}),
      };
    case 'tool':
      return {
        role: 'tool',
        content: m.content,
        toolCallId: m.toolCallId ?? '',
        name: m.toolName ?? '',
      };
    case 'event':
      return { role: 'user', content: `[event] ${m.content}${eventMeta(m.pageContext)}` };
    default:
      return { role: 'user', content: m.content };
  }
}

/** A follow-up of the loop (assistant tool calls, tool results) as a stored row. */
function toRow(m: ChatMessage, runId: string): NewMessage {
  if (m.role === 'tool') {
    return row({
      role: 'tool',
      content: m.content,
      toolCallId: m.toolCallId ?? null,
      toolName: m.name ?? null,
      runId,
    });
  }
  return row({
    role: 'assistant',
    content: m.content,
    toolCalls: m.toolCalls?.length ? m.toolCalls : null,
    runId,
  });
}

/**
 * A step keeps its kind, tool name, ok, duration and, for a failed tool, the error code its result
 * named (`turn_budget_exhausted`, `http_400`, …), plus a redacted debug detail (`stepDetail`).
 */
const toStepRecord = (runId: string, idx: number, s: AgentStep): StepRecord => ({
  runId,
  idx,
  kind: s.kind,
  toolName: s.name ?? null,
  ok: s.ok ?? null,
  ms: s.ms === undefined ? null : Math.round(s.ms),
  errorCode: s.errorCode ?? null,
  detail: stepDetail(s),
});

/** The last `max` messages, from the first user, event or compaction summary message on. */
export function capHistory(messages: MessageRecord[], max = HISTORY_MAX_MESSAGES): MessageRecord[] {
  const window = messages.slice(-max);
  const start = window.findIndex((m) => m.role === 'user' || m.role === 'event' || m.isSummary);
  return start < 0 ? [] : window.slice(start);
}

/** A fill_form carries at most this many values (the contract's cap, like a form). */
const MAX_FILL_VALUES = 30;

/**
 * One fill_form per form, in first-call order: a form's calls merge their values in call order,
 * so a later value for the same field wins and a correcting call keeps the earlier fields (QA5 #1).
 */
function mergedFills(actions: AssistantUiAction[]): AssistantUiAction[] {
  const byForm = new Map<string, Record<string, string | number>>();
  for (const a of actions) {
    if (a.type !== 'fill_form') continue;
    byForm.set(a.formId, { ...byForm.get(a.formId), ...a.values });
  }
  return [...byForm].map(([formId, values]) => ({
    type: 'fill_form' as const,
    formId,
    values: Object.fromEntries(Object.entries(values).slice(-MAX_FILL_VALUES)),
  }));
}

/**
 * The answer's UI actions: the last navigate, one merged fill_form per form, up to
 * `MAX_CHARTS_PER_TURN` charts in call order, then the last spotlight. The page opens, its form
 * is filled, the charts show inside the answer, then a control is highlighted.
 */
export function finalUiActions(actions: AssistantUiAction[]): AssistantUiAction[] {
  const last = (type: AssistantUiAction['type']) => {
    const found = actions.findLast((a) => a.type === type);
    return found ? [found] : [];
  };
  const charts = actions.filter((a) => a.type === 'chart').slice(0, MAX_CHARTS_PER_TURN);
  return [...last('navigate'), ...mergedFills(actions), ...charts, ...last('spotlight')];
}

const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

/** A turn with no answer: point at the proposal card it drafted, else apologise. */
const fallback = (proposalIds: readonly string[]): string =>
  proposalIds.length > 0 ? PROPOSAL_FALLBACK_REPLY : FALLBACK_REPLY;

/**
 * One chat turn of the owner assistant: start the run (one at a time per owner, idempotent by
 * the client `turnId`), store the owner's message, compact the thread when due (never failing the
 * turn), run the shared agent loop on the `pro` tier
 * with the core, memory, skill and route tools, store the tool exchange and the answer, and finish
 * the run with its usage. Route tools read with a delegated token of the owner, minted from the
 * owner's `authorization` for the turn budget plus a margin (memory only, QA N-3);
 * writes become proposals. Steps are written as they happen so `GET /assistant/runs/{id}` shows progress.
 */
@Injectable()
export class ChatTurnService {
  readonly #log = new Logger(ChatTurnService.name);

  constructor(
    @Inject(ASSISTANT_REPOSITORY) private readonly repo: AssistantRepository,
    @Inject(AI_LLM_GATEWAY) private readonly gateway: LlmGatewayPort,
    @Inject(SkillsService) private readonly skills: SkillsService,
    @Inject(ROUTE_INVOKER) private readonly invoker: RouteInvoker,
    @Inject(CompactionService) private readonly compaction: CompactionService,
    @Inject(SchedulesService) private readonly schedules: SchedulesService,
    @Inject(ASSISTANT_SQL_RUNNER)
    @Optional()
    private readonly sqlRunner: SqlRunner | null = null,
    @Inject(ACCESS_DELEGATION)
    @Optional()
    private readonly delegation: AccessDelegation | null = null,
  ) {}

  /**
   * The native entries of the deferred catalog for this turn: `sql_schema` and `sql_query` when
   * the SQL lane is configured (`sqlRunner` is null without DATABASE_ASSISTANT_SQL_URL) and the owner has not turned the `sql` toolset off (1c settings).
   * They are reached through tool_search / tool_describe / tool_call, so the tool list is unchanged.
   */
  #nativeTools(
    scope: OwnerScope,
    runId: string,
    uiActions: AssistantUiAction[],
    disabledToolsets: readonly string[],
  ): NativeToolEntry[] {
    if (!this.sqlRunner) return [];
    if (disabledToolsets.includes(SQL_TOOLSET)) return [];
    return sqlTools({
      scope,
      runner: this.sqlRunner,
      uiActions,
      charts: { count: 0 },
      runId,
      log: (line) => this.#log.warn(line),
    });
  }

  /** The routes the assistant may use; tests replace it. */
  catalog: RouteCatalog = ROUTE_CATALOG;

  async send(
    scope: OwnerScope,
    threadId: string,
    req: SendAssistantMessageRequest,
    authorization: string,
    ownerName?: () => Promise<string | null>,
  ): Promise<TurnResult> {
    const thread = await this.repo.getThread(scope, threadId);
    if (!thread) throw new AssistantNotFoundError('thread', threadId);
    const importBlock = await this.#importBlock(scope, threadId, req.importBatchId);
    const started = await this.repo.startRun(scope, {
      id: req.turnId,
      threadId,
      tier: TURN_TIER,
      // The thread's own (frozen) prompt version: older threads keep assistant@1.
      promptVersion: thread.promptVersion,
    });
    if (started === 'busy') throw new AssistantBusyError();
    if (started === 'duplicate') return this.#replay(scope, threadId, req.turnId);
    try {
      return await this.#answer(scope, thread, req, authorization, ownerName, importBlock);
    } catch (error) {
      await this.repo
        .finishRun(scope, req.turnId, { status: 'failed', finishedAt: new Date() })
        .catch(() => undefined);
      throw error;
    }
  }

  /**
   * A retried turn: the first attempt's visible messages and run, nothing runs again. While the
   * first attempt still runs, 409 `assistant_busy`.
   */
  async #replay(scope: OwnerScope, threadId: string, runId: string): Promise<TurnResult> {
    const run = await this.repo.getRun(scope, runId);
    if (!run || run.threadId !== threadId) throw new AssistantRunIdTakenError();
    // The first attempt is still answering: its messages are not complete yet.
    if (run.status === 'running') throw new AssistantBusyError();
    const messages = (await this.repo.listMessages(scope, threadId)).filter(
      (m) => m.runId === runId && isVisibleMessage(m),
    );
    // Recomputed from the stored (already masked) owner message.
    const owner = messages.find((m) => m.role === 'user');
    return { messages, run, secretsRemoved: owner?.content.includes(SECRET_REMOVED) ?? false };
  }

  /**
   * The `<import_batch>` block of a message that carries a batch; the batch must be the owner's,
   * of this thread and of a business in scope (404 before the turn starts).
   */
  async #importBlock(
    scope: OwnerScope,
    threadId: string,
    batchId: string | undefined,
  ): Promise<string | undefined> {
    if (!batchId) return undefined;
    const batch = await this.repo.getImportBatch(scope, batchId);
    if (
      !batch ||
      batch.threadId !== threadId ||
      !scope.businessIds.some((b) => b === batch.businessId)
    ) {
      throw new AssistantNotFoundError('import batch', batchId);
    }
    return buildImportBlock(batch);
  }

  async #answer(
    scope: OwnerScope,
    initial: ThreadRecord,
    req: SendAssistantMessageRequest,
    authorization: string,
    ownerName: (() => Promise<string | null>) | undefined,
    importBlock: string | undefined,
  ): Promise<TurnResult> {
    const startedAt = Date.now();
    const runId = req.turnId;
    let thread = initial;
    // Pasted keys never reach storage or the model (spec C5 §7.2): only the masked text is used.
    const masked = maskOwnerSecrets(req.text);
    const text = masked.text;
    const secretsRemoved = masked.removed > 0;
    // The import block is stored with the owner's text, so later turns replay it unchanged;
    // the web never sees it (`toMessageDtos`).
    const content = importBlock ? `${importBlock}\n${text}` : text;
    const [user] = await this.repo.appendMessages(scope, thread.id, [
      row({ role: 'user', content, pageContext: req.pageContext ?? null, runId }),
    ]);
    if (!user) throw new Error('assistant user message was not stored');
    if (!thread.title.trim()) {
      const title = Array.from(text).slice(0, TITLE_CHARS).join('').trim();
      await this.repo.updateThread(scope, thread.id, { title });
    }

    thread = (await this.#compact(scope, thread, ownerName)) ?? thread;
    const settings = await this.#settings(scope);
    const off = disabledTools(settings.disabledToolsets);

    const stored = await this.repo.listMessages(scope, thread.id, { activeOnly: true });
    const turnText = buildTurnMessage(
      text,
      req.pageContext,
      new Date(),
      scope.businessId,
      importBlock,
    );
    const history = capHistory(stored).map((m) =>
      m.id === user.id ? { role: 'user' as const, content: turnText } : toChatMessage(m),
    );

    const ctx: ToolContext = {
      scope,
      repo: this.repo,
      uiActions: [],
      ...(req.pageContext ? { page: req.pageContext } : {}),
    };
    // The turn's proposals; the web reads them per thread, so the answer carries no field.
    const proposalIds: string[] = [];
    const native = this.#nativeTools(scope, runId, ctx.uiActions, settings.disabledToolsets);
    const industry = currentIndustry(scope);
    // No schedule created from a schedule (core §12); the `schedule` toolset setting applies too.
    const withSchedule = thread.origin !== 'schedule';
    const pending: Promise<void>[] = [];
    let idx = 0;
    let result: AgentLoopResult | undefined;
    let failure: unknown;
    // A compaction at the start of the turn spends part of the turn's budget.
    const budgetMs = Math.max(TURN_BUDGET_MS - (Date.now() - startedAt), MIN_ANSWER_BUDGET_MS);
    // The owner's token may expire mid-turn (15 min): route tools use one minted for this turn.
    const turnAuth = await delegatedAuthorization(
      this.delegation,
      authorization,
      Math.ceil(budgetMs / 1000) + DELEGATION_MARGIN_SECONDS,
    );
    const turnTaint = { tainted: false };
    try {
      result = await runAgentLoop({
        base: {
          workspaceId: scope.businessId,
          tier: TURN_TIER,
          messages: [{ role: 'system', content: thread.systemPrompt }, ...history],
          // The owner's disabled toolsets are left out (spec §6); the rest keep their order.
          tools: enabledDefinitions(
            withSchedule ? TURN_TOOL_DEFINITIONS : TURN_TOOL_DEFINITIONS_NO_SCHEDULE,
            settings.disabledToolsets,
          ),
          // Stable across compactions: the root is the thread id, kept in cache_root_id. The
          // disabled set is a sorted suffix, so a smaller tool list gets its own cache entry.
          promptCacheKey:
            threadCacheKey(scope, thread) + toolsetCacheSuffix(settings.disabledToolsets),
          timeoutMs: TURN_CALL_TIMEOUT_MS,
        },
        // One output budget for the whole turn, shared by every tool and its validation errors.
        tools: withTurnOutputBudget(
          // Once a tool returned data this turn, memory writes wait for the owner's approval.
          taintOnToolOutput(
            [
              ...coreTools(ctx),
              memoryTool({ scope, repo: this.repo, tainted: () => turnTaint.tainted }),
              // skill_manage as the chat actor; patches need a load_skill in this same turn.
              ...skillTools({
                scope,
                skills: this.skills,
                actor: 'assistant',
                runId,
                loadedSkills: new Set<string>(),
              }),
              ...routeTools({
                scope,
                repo: this.repo,
                invoker: this.invoker,
                catalog: this.catalog,
                authorization: turnAuth,
                threadId: thread.id,
                runId,
                proposalIds,
                native,
                ...(req.pageContext ? { page: req.pageContext } : {}),
                ...(industry ? { industry } : {}),
              }),
              // Product import (T-173): previews read; a proposal waits for the owner.
              ...importTools({
                scope,
                repo: this.repo,
                invoker: this.invoker,
                authorization: turnAuth,
                threadId: thread.id,
                runId,
                proposalIds,
                industryOf: (businessId) => industryOfBusiness(scope, businessId),
              }),
              ...(withSchedule
                ? [
                    scheduleTool({
                      scope,
                      repo: this.repo,
                      schedules: this.schedules,
                      threadId: thread.id,
                      runId,
                      proposalIds,
                    }),
                  ]
                : []),
            ].filter((tool) => !off.has(tool.name)),
            turnTaint,
          ),
        ),
        generate: (r) => this.gateway.generate(r),
        maxRounds: TURN_MAX_ROUNDS,
        budgetMs,
        wrapUpNotice: OWNER_WRAP_UP_NOTICE,
        onStep: (s) => {
          // Written at once so polling sees the run progress; awaited after the loop.
          pending.push(
            this.repo.addStep(scope, toStepRecord(runId, idx++, s)).catch((e: unknown) => {
              this.#log.warn(`assistant run ${runId}: step not saved (${errorClass(e)})`);
            }),
          );
        },
        onToolError: (name, e) => {
          this.#log.warn(`assistant run ${runId}: tool ${name} failed (${errorClass(e)})`);
        },
      });
    } catch (error) {
      failure = error;
    } finally {
      await Promise.all(pending);
    }

    if (!result) {
      this.#log.warn(`assistant run ${runId}: model call failed (${errorClass(failure)})`);
      if (isAiNotConfiguredError(failure)) {
        await this.repo.finishRun(scope, runId, {
          status: 'failed',
          guardrail: 'ai_unavailable',
          finishedAt: new Date(),
        });
        throw failure;
      }
      // The failed model call is a step too, so the run shows why it failed (QA ERR-m).
      await this.repo
        .addStep(scope, {
          runId,
          idx,
          kind: 'model_call',
          toolName: null,
          ok: false,
          ms: null,
          errorCode: isModelRateLimitedError(failure) ? 'model_rate_limited' : 'model_unavailable',
        })
        .catch((e: unknown) => {
          this.#log.warn(`assistant run ${runId}: step not saved (${errorClass(e)})`);
        });
      const [answer] = await this.repo.appendMessages(scope, thread.id, [
        // No answer, so no UI action: the owner sees the apology, or the drafted card.
        row({ role: 'assistant', content: fallback(proposalIds), runId }),
      ]);
      await this.repo.finishRun(scope, runId, {
        status: 'failed',
        guardrail: 'model_error',
        finishedAt: new Date(),
      });
      return this.#result(scope, runId, [user, ...(answer ? [answer] : [])], secretsRemoved);
    }

    const replyText = result.res?.text.trim() ?? '';
    const answered = result.outcome === 'done' && replyText.length > 0;
    const added = await this.repo.appendMessages(scope, thread.id, [
      ...result.followUps.map((m) => toRow(m, runId)),
      row({
        role: 'assistant',
        content: answered ? replyText : fallback(proposalIds),
        uiActions: answered ? finalUiActions(ctx.uiActions) : [],
        runId,
      }),
    ]);
    await this.repo.finishRun(scope, runId, {
      status: 'done',
      outcome: result.outcome,
      rounds: result.modelCalls,
      latencyMs: Math.round(result.latencyMs),
      inputTokens: result.usage.inputTokens,
      cachedTokens: result.usage.cachedInputTokens,
      outputTokens: result.usage.outputTokens,
      provider: result.res?.provider ?? null,
      model: result.res?.model ?? null,
      finishedAt: new Date(),
    });
    // Only a turn that answered counts toward the background review (spec §11).
    if (answered) await this.#scheduleReview(scope, thread, result, settings);
    return this.#result(scope, runId, [user, ...added], secretsRemoved);
  }

  /**
   * The review triggers (spec §11), after a turn that answered: +1 owner turn and the turn's
   * tool rounds on the thread's counters, also when the assistant wrote memory or a skill in the
   * turn (QA fix: resetting there lost the learning of correction threads). `planReview` then
   * enqueues at most one review job (an existing queued one is updated, so each turn pushes an
   * idle review back, but never a review that is already due); a review that runs now resets
   * the counters, and later messages never cancel it. Never for schedule threads or when the
   * owner turned review off. A failure here is logged and never fails the turn.
   */
  async #scheduleReview(
    scope: OwnerScope,
    thread: ThreadRecord,
    result: AgentLoopResult,
    settings: AssistantSettingsRecord,
  ): Promise<void> {
    if (thread.origin === 'schedule' || !settings.reviewEnabled) return;
    try {
      const toolRounds = result.followUps.filter((m) => m.role === 'assistant').length;
      const counters = await this.repo.bumpReviewCounters(scope, thread.id, {
        ownerTurns: 1,
        toolRounds,
      });
      const plan = planReview(counters);
      if (!plan) return;
      await this.repo.enqueueJob(scope, {
        id: newId(),
        threadId: thread.id,
        kind: 'review',
        reviewScope: plan.scope,
        runAfter: new Date(Date.now() + plan.delayMs),
      });
      if (plan.delayMs === 0) await this.repo.resetReviewCounters(scope, thread.id);
    } catch (error) {
      this.#log.warn(`assistant thread ${thread.id}: review not scheduled (${errorClass(error)})`);
    }
  }

  /** The owner's settings; when they cannot be read, the defaults (every toolset on). */
  async #settings(scope: OwnerScope): Promise<AssistantSettingsRecord> {
    try {
      return await this.repo.getSettings(scope);
    } catch (error) {
      this.#log.warn(`assistant settings not read (${errorClass(error)})`);
      return DEFAULT_ASSISTANT_SETTINGS;
    }
  }

  /** Compacts the thread when due; any failure keeps the full history and the turn goes on. */
  async #compact(
    scope: OwnerScope,
    thread: ThreadRecord,
    ownerName: (() => Promise<string | null>) | undefined,
  ): Promise<ThreadRecord | null> {
    try {
      const lastRun = await this.repo.getLastChatRun(scope, thread.id);
      return await this.compaction.maybeCompact(scope, thread, lastRun, {
        ...(ownerName ? { ownerName } : {}),
      });
    } catch (error) {
      this.#log.warn(`assistant thread ${thread.id}: compaction skipped (${errorClass(error)})`);
      return null;
    }
  }

  async #result(
    scope: OwnerScope,
    runId: string,
    rows: MessageRecord[],
    secretsRemoved: boolean,
  ): Promise<TurnResult> {
    const run = await this.repo.getRun(scope, runId);
    if (!run) throw new AssistantNotFoundError('run', runId);
    return { messages: rows.filter(isVisibleMessage), run, secretsRemoved };
  }
}
