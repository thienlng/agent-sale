import {
  buildCompactionPrompt,
  COMPACTION_SUMMARY_PREFIX,
  planCompaction,
  PRUNED_TOOL_TEXT,
  shouldCompact,
  type CompactionMessage,
  type GenerateResponse,
} from '@agent-sales/ai-core';
import { newId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { AI_LLM_GATEWAY, type LlmGatewayPort } from '../../ai/api/index.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import {
  ASSISTANT_REPOSITORY,
  type AssistantRepository,
  type MessageRecord,
  type RunRecord,
  type ThreadRecord,
} from '../domain/ports/assistant.repository.js';
import { ThreadPromptService } from './thread-prompt.service.js';

/** Context window the trigger assumes for the routed model (ruling 1b-R5). */
export const ASSISTANT_CONTEXT_TOKENS = 128_000;
/** Reserved for the model's output when the trigger measures the window (ruling 1b-R5). */
export const ASSISTANT_MAX_OUTPUT_TOKENS = 16_000;
/** The summariser runs on the cheap tier (spec §7). */
export const COMPACTION_TIER = 'basic' as const;
/** After a failed compaction the thread keeps its full history this long (spec §9). */
export const COMPACTION_COOLDOWN_MS = 10 * 60_000;
/** Anti-thrash: skip when the last two compactions each saved less than this (%). */
export const COMPACTION_MIN_SAVED_PCT = 10;
/**
 * The summariser call (with the gateway's retries) is cut after this, so the owner's turn still
 * has most of its 90 s budget.
 */
export const COMPACTION_TIMEOUT_MS = 30_000;
/** Upper bound for the summary the model writes. */
export const COMPACTION_MAX_OUTPUT_TOKENS = 4_000;

/** The prompt-cache key of a thread; stable across compactions (`cache_root_id`). */
export const threadCacheKey = (scope: OwnerScope, thread: ThreadRecord): string =>
  `asst:${scope.ownerUserId}:${thread.cacheRootId ?? thread.id}`;

const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

const toCompactionMessage = (m: MessageRecord): CompactionMessage => ({
  id: m.id,
  role: m.role,
  content: m.content,
  isSummary: m.isSummary,
  ...(m.toolCalls ? { toolCalls: m.toolCalls } : {}),
});

/**
 * The prompt size of the run's average model call. Runs store usage summed over every call of
 * the loop, so the sum overstates the context of any one call; the per-call average stands in
 * for "the last call" of spec §9 (ruling T6-1).
 */
export function lastPromptTokens(run: RunRecord | null): number {
  if (!run) return 0;
  return Math.round((run.inputTokens + run.cachedTokens) / Math.max(1, run.rounds));
}

const chars = (rows: { content: string }[]): number =>
  rows.reduce((sum, m) => sum + m.content.length, 0);

/**
 * Auto-compaction of an owner's thread (spec §9): when the last turn's prompt nears the window
 * or the thread has too many active messages, the middle of the history is summarised on tier
 * `basic` into one summary row (the head and the tail stay), the pending proposals are
 * re-injected into the summary, and the thread's frozen system prompt is rebuilt with fresh
 * memory. The summary is for the model only; the owner never sees it. A failure leaves the
 * history as it was and starts a 10-minute cooldown.
 */
@Injectable()
export class CompactionService {
  readonly #log = new Logger(CompactionService.name);

  constructor(
    @Inject(ASSISTANT_REPOSITORY) private readonly repo: AssistantRepository,
    @Inject(AI_LLM_GATEWAY) private readonly gateway: LlmGatewayPort,
    @Inject(ThreadPromptService) private readonly prompts: ThreadPromptService,
  ) {}

  /**
   * Compacts the thread if it needs it. Returns the updated thread after a compaction, else
   * null (not needed, skipped, nothing to summarise, or failed). Never throws for a model or
   * storage failure of the compaction itself.
   */
  async maybeCompact(
    scope: OwnerScope,
    thread: ThreadRecord,
    lastRun: RunRecord | null,
    opts: { ownerName?: () => Promise<string | null>; now?: Date } = {},
  ): Promise<ThreadRecord | null> {
    const now = opts.now ?? new Date();
    if (
      thread.compactionFailedAt &&
      now.getTime() - thread.compactionFailedAt.getTime() < COMPACTION_COOLDOWN_MS
    ) {
      return null;
    }
    const pcts = thread.compactionSavedPcts.slice(-2);
    if (pcts.length === 2 && pcts.every((p) => p < COMPACTION_MIN_SAVED_PCT)) return null;

    const active = await this.repo.listMessages(scope, thread.id, { activeOnly: true });
    const due = shouldCompact({
      lastInputTokens: lastPromptTokens(lastRun),
      activeMessages: active.length,
      contextTokens: ASSISTANT_CONTEXT_TOKENS,
      maxOutputTokens: ASSISTANT_MAX_OUTPUT_TOKENS,
    });
    if (!due) return null;
    const plan = planCompaction(active.map(toCompactionMessage));
    if (!plan) return null;

    try {
      const summarised = new Set(plan.summarizeIds);
      const transcript = active.filter((m) => summarised.has(m.id)).map(toCompactionMessage);
      const text = await this.#summarise(scope, thread, plan.previousSummary, transcript);

      const pending = (await this.repo.listProposals(scope, thread.id)).filter(
        (p) => p.status === 'pending' && p.expiresAt.getTime() > now.getTime(),
      );
      const content =
        COMPACTION_SUMMARY_PREFIX +
        text +
        (pending.length
          ? `\n\nPending proposals (still waiting for the owner's approval):\n${pending
              .map((p) => `- ${p.summary} (id: ${p.id})`)
              .join('\n')}`
          : '');

      const ownerName = opts.ownerName ? await opts.ownerName() : null;
      const systemPrompt = await this.prompts.build(scope, ownerName, thread.promptVersion, now);

      // Savings over the active history: summarised rows go, pruned tool rows shrink, the summary comes.
      const pruned = new Set(plan.pruneToolIds);
      const before = chars(active);
      const after =
        active
          .filter((m) => !summarised.has(m.id))
          .reduce(
            (sum, m) => sum + (pruned.has(m.id) ? PRUNED_TOOL_TEXT.length : m.content.length),
            0,
          ) + content.length;
      const savedPct = before > 0 ? Math.round((1 - after / before) * 1000) / 10 : 0;

      await this.repo.applyCompaction(scope, thread.id, {
        deactivateIds: plan.summarizeIds,
        prunedToolIds: plan.pruneToolIds,
        summary: {
          id: newId(),
          // A user row, so the model reads it and the history may start at it.
          role: 'user',
          content,
          toolCalls: null,
          toolCallId: null,
          toolName: null,
          pageContext: null,
          uiActions: [],
          runId: null,
        },
        savedPct,
        systemPrompt,
      });
      return await this.repo.getThread(scope, thread.id);
    } catch (error) {
      this.#log.warn(`assistant thread ${thread.id}: compaction failed (${errorClass(error)})`);
      await this.repo.markCompactionFailed(scope, thread.id, now).catch((e: unknown) => {
        this.#log.warn(
          `assistant thread ${thread.id}: compaction failure not saved (${errorClass(e)})`,
        );
      });
      return null;
    }
  }

  /** One summariser call on tier `basic`, recorded as a `compaction` run; empty text throws. */
  async #summarise(
    scope: OwnerScope,
    thread: ThreadRecord,
    previousSummary: string | null,
    transcript: CompactionMessage[],
  ): Promise<string> {
    const prompt = buildCompactionPrompt(previousSummary, transcript);
    const runId = newId();
    const started = Date.now();
    let res: GenerateResponse;
    try {
      res = await this.gateway.generate({
        workspaceId: scope.businessId,
        tier: COMPACTION_TIER,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        promptCacheKey: threadCacheKey(scope, thread),
        maxOutputTokens: COMPACTION_MAX_OUTPUT_TOKENS,
        timeoutMs: COMPACTION_TIMEOUT_MS,
        signal: AbortSignal.timeout(COMPACTION_TIMEOUT_MS),
      });
    } catch (error) {
      await this.#record(scope, thread, runId, {
        status: 'failed',
        guardrail: 'model_error',
        latencyMs: Date.now() - started,
      });
      throw error;
    }
    const text = res.text.trim();
    await this.#record(scope, thread, runId, {
      status: text ? 'done' : 'failed',
      outcome: text ? 'done' : 'empty',
      guardrail: text ? null : 'empty_summary',
      latencyMs: Date.now() - started,
      provider: res.provider,
      model: res.model,
      inputTokens: res.usage.inputTokens,
      cachedTokens: res.usage.cachedInputTokens,
      outputTokens: res.usage.outputTokens,
      rounds: 1,
    });
    if (!text) throw new Error('assistant compaction summary is empty');
    return text;
  }

  async #record(
    scope: OwnerScope,
    thread: ThreadRecord,
    runId: string,
    r: {
      status: 'done' | 'failed';
      latencyMs: number;
      outcome?: string | null;
      guardrail?: string | null;
      provider?: string;
      model?: string;
      inputTokens?: number;
      cachedTokens?: number;
      outputTokens?: number;
      rounds?: number;
    },
  ): Promise<void> {
    await this.repo
      .recordRun(scope, {
        id: runId,
        threadId: thread.id,
        kind: 'compaction',
        tier: COMPACTION_TIER,
        promptVersion: thread.promptVersion,
        status: r.status,
        provider: r.provider ?? null,
        model: r.model ?? null,
        inputTokens: r.inputTokens ?? 0,
        cachedTokens: r.cachedTokens ?? 0,
        outputTokens: r.outputTokens ?? 0,
        latencyMs: Math.round(r.latencyMs),
        rounds: r.rounds ?? 0,
        outcome: r.outcome ?? null,
        guardrail: r.guardrail ?? null,
      })
      .catch((e: unknown) => {
        // The trace is best effort; the compaction itself does not depend on it.
        this.#log.warn(`assistant run ${runId}: compaction run not saved (${errorClass(e)})`);
      });
  }
}
