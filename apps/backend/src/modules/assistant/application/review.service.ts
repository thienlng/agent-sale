import {
  PROMPTS_DIR,
  PromptRegistry,
  runAgentLoop,
  scanUntrustedText,
  type AgentLoopResult,
  type PromptRef,
  type RunnableTool,
  type ToolCall,
  type ToolDefinition,
} from '@agent-sales/ai-core';
import { newId, type UserId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import { ACCOUNT_FACADE, type AccountFacade } from '../../account/api/index.js';
import { AI_LLM_GATEWAY, type LlmGatewayPort } from '../../ai/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import { AssistantForbiddenError } from '../domain/assistant.errors.js';
import { isKnownStore } from '../domain/memory-store.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import {
  ASSISTANT_REPOSITORY,
  type AssistantRepository,
  type JobRecord,
  type MemoryStoreRecord,
  type MessageRecord,
  type OwnerKey,
  type ReviewScope,
  type StepRecord,
  type ThreadRecord,
} from '../domain/ports/assistant.repository.js';
import { threadCacheKey } from './compaction.service.js';
import { CORE_TOOL_DEFINITIONS, coreTools, SESSION_SEARCH_TOOL } from './core-tools.js';
import { MEMORY_TOOL_DEFINITION, memoryTool } from './memory-tools.js';
import { resolveOwnerScope } from './owner-access.js';
import { renderMemoryBlock } from './prompt-builder.js';
import { REVIEW_IDLE_MS } from './review-trigger.js';
import { SKILL_TOOL_DEFINITIONS, skillManageDefinition, skillTools } from './skill-tools.js';
import { SkillsService } from './skills.service.js';

/** The pinned review instruction (`packages/ai-core/prompts/assistant-review@1.md`). */
export const REVIEW_PROMPT = { name: 'assistant-review', version: 1 } as const satisfies PromptRef;
/** The review runs on the chat tier (spec §11). */
export const REVIEW_TIER = 'pro' as const;
/**
 * Appended to the thread's cache key: the review sends the thread's system prompt but its own
 * tool list, so it keeps a cache bucket of its own across reviews of the thread.
 */
export const REVIEW_CACHE_SUFFIX = ':review';
export const REVIEW_MAX_ROUNDS = 8;
export const REVIEW_BUDGET_MS = 120_000;
/** The run stops before its next model call once its input tokens (cached included) reach this. */
export const REVIEW_INPUT_TOKEN_LIMIT = 200_000;
/** The transcript the review reads: the thread's last active messages. */
export const REVIEW_TRANSCRIPT_MESSAGES = 24;
/** A tool result in the transcript is cut to this many characters. */
export const REVIEW_TOOL_RESULT_CHARS = 300;
/** Tool-call arguments in the transcript are cut to this many characters. */
export const REVIEW_TOOL_ARGS_CHARS = 120;
/** A failed review is tried once more (`attempts < 2`), this long after the failure. */
export const REVIEW_MAX_ATTEMPTS = 2;
export const REVIEW_RETRY_DELAY_MS = 10 * 60_000;
/**
 * A write needs the lease to last at least this much longer; otherwise the job may be claimed
 * again while this attempt still writes, and the run stops instead.
 */
export const LEASE_SAFETY_MS = 30_000;
/** Pending suggestions an owner can have at most. */
export const SUGGESTION_LIMIT = 5;
export const SUGGEST_TOOL = 'suggest';
/** Appended to the last tool result at 80 % of the budget. */
export const REVIEW_WRAP_UP_NOTICE = 'Time is almost up: make your last change now, then stop.';

const FOCUS: Record<ReviewScope, string> = {
  memory:
    'memory: who the owner is, their preferences and expectations. Touch skills only when a ' +
    'correction clearly belongs in one.',
  skills:
    'skills: how to do the classes of task this conversation covered. Touch memory only for a ' +
    'clear personal preference.',
  combined: 'memory and skills: act on whichever has real signal.',
};

const registry = new PromptRegistry(PROMPTS_DIR);

/** `<` is escaped so a result cannot open or close a prompt tag. */
const json = (value: unknown): string => JSON.stringify(value).replaceAll('<', '\\u003c');
const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);
const cut = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

/** A role tag such as `[owner]` or `[tool result x]` anywhere in a line. */
const ROLE_TAG = /\[(\s*(?:owner|assistant|summary|event|tool)\b[^\]\r\n]*)\]/gi;

/**
 * Text that is data, not the owner speaking (assistant replies, summaries, events, tool output,
 * all of which may quote customers): one line (line breaks become ` ⏎ `) and every role tag
 * turned into `(…)`, so nothing in it can pass for an `[owner]` line.
 */
export function asData(text: string): string {
  return text.replace(/\r\n|[\r\n\u2028\u2029]/g, ' ⏎ ').replace(ROLE_TAG, '($1)');
}

/**
 * One transcript line per message: role and text; tool calls by name, tool results cut short.
 * Only owner messages keep their text as written; everything else is flattened by `asData`.
 */
function transcriptLine(m: MessageRecord): string {
  switch (m.role) {
    case 'user':
      return m.isSummary
        ? `[summary of earlier messages] ${asData(m.content)}`
        : `[owner] ${m.content}`;
    case 'event':
      return `[event] ${asData(m.content)}`;
    case 'tool':
      return `[tool result ${asData(m.toolName ?? '')}] ${asData(cut(m.content, REVIEW_TOOL_RESULT_CHARS))}`;
    case 'assistant': {
      const calls = ((m.toolCalls ?? []) as ToolCall[]).map(
        (c) =>
          `${asData(c.name)}(${asData(cut(JSON.stringify(c.input ?? {}), REVIEW_TOOL_ARGS_CHARS))})`,
      );
      const text = asData(m.content.trim());
      return [`[assistant]${text ? ` ${text}` : ''}`, ...calls.map((c) => `  called ${c}`)].join(
        '\n',
      );
    }
  }
}

/**
 * The digest the review reads: the last 24 active messages, oldest first, one line each (tool
 * results cut to 300 chars). A `</transcript` in the text cannot close the prompt's tag.
 */
export function reviewTranscript(active: MessageRecord[]): string {
  return active
    .slice(-REVIEW_TRANSCRIPT_MESSAGES)
    .map(transcriptLine)
    .join('\n')
    .replaceAll('</transcript', '<\\/transcript');
}

/**
 * The review's user instruction: the transcript, the owner's memory as it is now (the thread's
 * system prompt holds a snapshot from thread start or the last compaction) and the focus of the
 * job's scope.
 */
export async function buildReviewInstruction(
  active: MessageRecord[],
  scope: ReviewScope,
  memory: readonly MemoryStoreRecord[] = [],
): Promise<string> {
  const template = await registry.load(REVIEW_PROMPT);
  const block = renderMemoryBlock(memory).replaceAll('</memory', '<\\/memory');
  return registry.render(template, {
    transcript: reviewTranscript(active),
    memory: block || '(nothing yet)',
    focus: FOCUS[scope],
  });
}

const SuggestInput = z.object({
  kind: z.enum(['schedule', 'skill', 'setup']),
  dedup_key: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9:_-]*$/, 'lowercase letters, digits, ":", "_" and "-"'),
  title: z.string().trim().min(1).max(200),
  payload: z.record(z.string().max(60), z.unknown()).default({}),
});
/** A suggestion's payload, as JSON, is at most this long. */
export const SUGGESTION_PAYLOAD_CHARS = 2_000;

export const SUGGEST_TOOL_DEFINITION: ToolDefinition = {
  name: SUGGEST_TOOL,
  description:
    'Save one suggestion card for the owner (they accept or dismiss it). kind: schedule (a report ' +
    'or check they ask for repeatedly), skill (a procedure worth saving) or setup (something to ' +
    'set up once). dedup_key: a stable lowercase key for the idea (e.g. "schedule:weekly-revenue"); ' +
    'a key used before is ignored. title: one short Vietnamese line. payload: for skill ' +
    '{name, description, body} (the skill the owner saves on accept); for setup {path} (the /app ' +
    'page to open); for schedule small JSON details. At most 5 pending per owner. No customer ' +
    'data or outside links.',
  input: SuggestInput,
};

/** The `suggest` tool: ≤ 5 pending per owner, a known `dedup_key` (any status) is ignored. */
export function suggestTool(ctx: { scope: OwnerKey; repo: AssistantRepository }): RunnableTool {
  return {
    name: SUGGEST_TOOL,
    readOnly: false,
    schema: SuggestInput,
    async run(input) {
      const x = input as z.output<typeof SuggestInput>;
      const fail = (errorCode: string) => ({ content: json({ ok: false, errorCode }), ok: false });
      const payload = JSON.stringify(x.payload);
      if (payload.length > SUGGESTION_PAYLOAD_CHARS) return fail('payload_too_large');
      const scan = scanUntrustedText(`${x.title}\n${payload}`);
      if (!scan.ok) return fail(`unsafe:${scan.issues.join(',')}`);
      const pending = await ctx.repo.listSuggestions(ctx.scope, { status: 'pending' });
      if (pending.length >= SUGGESTION_LIMIT) return fail('suggestion_limit');
      const saved = await ctx.repo.upsertSuggestion(ctx.scope, {
        id: newId(),
        kind: x.kind,
        dedupKey: x.dedup_key,
        title: x.title,
        payload: x.payload,
      });
      if (!saved) return fail('already_suggested');
      return { content: json({ ok: true, message: 'Suggestion saved for the owner.' }) };
    },
  };
}

/** The review's tools as the model sees them, sorted by name (cache-stable). */
export const REVIEW_TOOL_DEFINITIONS: ToolDefinition[] = [
  ...CORE_TOOL_DEFINITIONS.filter((d) => d.name === SESSION_SEARCH_TOOL),
  MEMORY_TOOL_DEFINITION,
  ...SKILL_TOOL_DEFINITIONS.filter((d) => d.name !== skillManageDefinition('review').name),
  skillManageDefinition('review'),
  SUGGEST_TOOL_DEFINITION,
].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

/**
 * Runs `tool` only while `holds()` says this attempt still holds the job; otherwise answers
 * `lease_lost` without writing (the run then stops).
 */
function fenced(tool: RunnableTool, holds: () => Promise<boolean>): RunnableTool {
  return {
    ...tool,
    async run(input) {
      if (!(await holds())) {
        return { content: json({ ok: false, errorCode: 'lease_lost' }), ok: false };
      }
      return tool.run(input);
    },
  };
}

/** How one claimed review job ended. `lost`: another attempt holds it now; nothing is changed. */
export type ReviewOutcome = 'done' | 'cancelled' | 'deferred' | 'retry' | 'failed' | 'lost';

/**
 * An idle review (enqueued to run `REVIEW_IDLE_MS` after the last turn), as opposed to one a
 * counter threshold made due at once. Half the delay absorbs the gap between the turn's clock
 * and the enqueue's `created_at`; a retry moves `run_after` by less (`REVIEW_RETRY_DELAY_MS`).
 */
export function isIdleReview(job: Pick<JobRecord, 'runAfter' | 'createdAt'>): boolean {
  return job.runAfter.getTime() - job.createdAt.getTime() >= REVIEW_IDLE_MS / 2;
}

/**
 * The background review (spec §11), one claimed job at a time: checks the job is still wanted
 * (review on, thread not newer than the job, owner still an active owner), then runs the agent
 * loop on the thread's frozen system prompt plus `assistant-review@1` (the last 24 messages as a
 * digest, non-owner text flattened so it cannot pass for an owner line, and the memory as it is
 * now) with memory (origin `review`), skills_list, load_skill, skill_manage (actor `review`),
 * session_search and suggest. 8 rounds, 120 s, 200 000 input tokens. Every write first checks
 * that this attempt still holds the job (`attempts` and a live lease). Recorded as an
 * `assistant_runs` row of kind `review` with its steps; never writes to the transcript. Logs
 * carry the job id and error class only.
 */
@Injectable()
export class ReviewService {
  readonly #log = new Logger(ReviewService.name);

  constructor(
    @Inject(ASSISTANT_REPOSITORY) private readonly repo: AssistantRepository,
    @Inject(AI_LLM_GATEWAY) private readonly gateway: LlmGatewayPort,
    @Inject(SkillsService) private readonly skills: SkillsService,
    @Inject(ACCOUNT_FACADE) private readonly account: AccountFacade,
    @Inject(WORKSPACE_FACADE) private readonly workspace: WorkspaceFacade,
  ) {}

  /** Runs a claimed `review` job to its end (done, cancelled, retried or failed). */
  async run(job: JobRecord): Promise<ReviewOutcome> {
    const key: OwnerKey = { accountId: job.accountId, ownerUserId: job.ownerUserId as UserId };
    try {
      if (await this.#deferIdle(key, job)) return 'deferred';
      const ready = await this.#prepare(key, job);
      if (!ready) {
        await this.repo.cancelJob(key, { id: job.id, attempts: job.attempts });
        return 'cancelled';
      }
      const held = await this.#review(key, job, ready.scope, ready.thread);
      if (!held) return 'lost';
      await this.repo.resetReviewCounters(key, ready.thread.id, { reviewedAt: new Date() });
      return (await this.repo.finishJob(key, job, { status: 'done' })) ? 'done' : 'lost';
    } catch (error) {
      this.#log.warn(`assistant review job ${job.id} failed (${errorClass(error)})`);
      if (job.attempts < REVIEW_MAX_ATTEMPTS) {
        const retried = await this.repo.retryJob(key, job, {
          runAfter: new Date(Date.now() + REVIEW_RETRY_DELAY_MS),
          errorCode: 'review_failed',
        });
        return retried ? 'retry' : 'lost';
      }
      const failed = await this.repo.finishJob(key, job, {
        status: 'failed',
        errorCode: 'review_failed',
      });
      return failed ? 'failed' : 'lost';
    }
  }

  /**
   * An idle review whose thread got a message after it was enqueued, and has not been quiet for
   * `REVIEW_IDLE_MS` since, is pushed back instead of run: this attempt is cancelled and a new
   * idle job is queued for `REVIEW_IDLE_MS` after the last message, so its trigger is kept. A
   * review a counter made due is never pushed back or cancelled by later messages (approvals,
   * events, more turns): it reviews the thread as it is when it runs.
   */
  async #deferIdle(key: OwnerKey, job: JobRecord): Promise<boolean> {
    if (job.kind !== 'review' || !job.threadId || !isIdleReview(job)) return false;
    const thread = await this.repo.getThread(key, job.threadId);
    if (!thread) return false;
    const last = thread.lastMessageAt.getTime();
    if (last <= job.createdAt.getTime() || Date.now() - last >= REVIEW_IDLE_MS) return false;
    const cancelled = await this.repo.cancelJob(key, { id: job.id, attempts: job.attempts });
    if (cancelled === 0) return true;
    await this.repo.enqueueJob(key, {
      id: newId(),
      threadId: job.threadId,
      kind: 'review',
      reviewScope: job.reviewScope ?? 'combined',
      runAfter: new Date(last + REVIEW_IDLE_MS),
    });
    return true;
  }

  /**
   * The thread and the owner's scope, or null when the job is no longer wanted: not a review,
   * review turned off, thread gone or a schedule thread, or the owner is no longer an active
   * owner of the account. A newer message does not cancel it (see `#deferIdle`).
   */
  async #prepare(
    key: OwnerKey,
    job: JobRecord,
  ): Promise<{ scope: OwnerScope; thread: ThreadRecord } | null> {
    if (job.kind !== 'review' || !job.threadId) return null;
    const settings = await this.repo.getSettings(key);
    if (!settings.reviewEnabled) return null;
    const thread = await this.repo.getThread(key, job.threadId);
    if (!thread || thread.origin === 'schedule') return null;
    const scope = await this.#ownerScope(key, thread);
    return scope ? { scope, thread } : null;
  }

  /**
   * The same checks as a request (`resolveOwnerScope`), on the thread's business when the owner
   * is still a member of it, else on any business of the account they belong to.
   */
  async #ownerScope(key: OwnerKey, thread: ThreadRecord): Promise<OwnerScope | null> {
    const memberships = (await this.workspace.listMemberships(key.ownerUserId)).filter(
      (m) => m.accountId === key.accountId,
    );
    const businessId =
      memberships.find((m) => m.workspaceId === thread.businessId)?.workspaceId ??
      memberships[0]?.workspaceId ??
      (thread.businessId as WorkspaceId | null);
    if (!businessId) return null;
    try {
      const scope = await resolveOwnerScope(
        { account: this.account, workspace: this.workspace },
        key.ownerUserId,
        businessId,
      );
      return scope.accountId === key.accountId ? scope : null;
    } catch (error) {
      if (error instanceof AssistantForbiddenError) return null;
      throw error;
    }
  }

  /** True while this attempt holds the job: same `attempts`, running, lease not about to lapse. */
  async #holds(key: OwnerKey, job: JobRecord): Promise<boolean> {
    const now = await this.repo.getJob(key, job.id);
    return (
      now !== null &&
      now.status === 'running' &&
      now.attempts === job.attempts &&
      now.leaseUntil !== null &&
      now.leaseUntil.getTime() - Date.now() > LEASE_SAFETY_MS
    );
  }

  /** The agent loop and its run record. False when the lease was lost during the run. */
  async #review(
    key: OwnerKey,
    job: JobRecord,
    scope: OwnerScope,
    thread: ThreadRecord,
  ): Promise<boolean> {
    const [active, memory] = await Promise.all([
      this.repo.listMessages(scope, thread.id, { activeOnly: true }),
      this.repo.getMemory(scope),
    ]);
    const instruction = await buildReviewInstruction(
      active,
      job.reviewScope ?? 'combined',
      memory.filter((m) => isKnownStore(m.store, scope.businessIds)),
    );

    let lost = false;
    let inputTokens = 0;
    const holds = async (): Promise<boolean> => {
      if (lost) return false;
      if (!(await this.#holds(key, job))) lost = true;
      return !lost;
    };
    const runId = newId();
    const [sessionSearch] = coreTools({ scope, repo: this.repo, uiActions: [] }).filter(
      (t) => t.name === SESSION_SEARCH_TOOL,
    );
    const tools: RunnableTool[] = [
      ...(sessionSearch ? [sessionSearch] : []),
      fenced(memoryTool({ scope, repo: this.repo, origin: 'review' }), holds),
      ...skillTools({
        scope: key,
        skills: this.skills,
        actor: 'review',
        runId,
        loadedSkills: new Set<string>(),
      }).map((t) => (t.readOnly ? t : fenced(t, holds))),
      fenced(suggestTool({ scope: key, repo: this.repo }), holds),
    ];

    const started = Date.now();
    let result: AgentLoopResult;
    try {
      result = await runAgentLoop({
        base: {
          workspaceId: scope.businessId,
          tier: REVIEW_TIER,
          messages: [
            { role: 'system', content: thread.systemPrompt },
            { role: 'user', content: instruction },
          ],
          tools: REVIEW_TOOL_DEFINITIONS,
          // Its own bucket: the review's tool list differs from the chat's, and providers cache
          // tools with the prefix, so sharing the chat's key would only churn both.
          promptCacheKey: `${threadCacheKey(scope, thread)}${REVIEW_CACHE_SUFFIX}`,
        },
        tools,
        generate: async (r) => {
          const res = await this.gateway.generate(r);
          inputTokens += res.usage.inputTokens + res.usage.cachedInputTokens;
          return res;
        },
        // Checked before every model call: the token budget, or a lost lease, ends the run.
        shouldInterrupt: () => Promise.resolve(lost || inputTokens >= REVIEW_INPUT_TOKEN_LIMIT),
        maxRounds: REVIEW_MAX_ROUNDS,
        budgetMs: REVIEW_BUDGET_MS,
        wrapUpNotice: REVIEW_WRAP_UP_NOTICE,
        onToolError: (name, e) => {
          this.#log.warn(`assistant review run ${runId}: tool ${name} failed (${errorClass(e)})`);
        },
      });
    } catch (error) {
      await this.#record(scope, thread, runId, {
        status: 'failed',
        guardrail: 'model_error',
        latencyMs: Date.now() - started,
      });
      throw error;
    }
    await this.#record(
      scope,
      thread,
      runId,
      {
        status: 'done',
        outcome: inputTokens >= REVIEW_INPUT_TOKEN_LIMIT ? 'token_budget' : result.outcome,
        guardrail: lost ? 'lease_lost' : null,
        latencyMs: Math.round(result.latencyMs),
        provider: result.res?.provider ?? null,
        model: result.res?.model ?? null,
        inputTokens: result.usage.inputTokens,
        cachedTokens: result.usage.cachedInputTokens,
        outputTokens: result.usage.outputTokens,
        rounds: result.modelCalls,
      },
      result.steps.map((s, idx) => ({
        runId,
        idx,
        kind: s.kind,
        toolName: s.name ?? null,
        ok: s.ok ?? null,
        ms: s.ms === undefined ? null : Math.round(s.ms),
        errorCode: null,
      })),
    );
    return !lost;
  }

  /** The `review` run and its steps; best effort (the review's writes do not depend on it). */
  async #record(
    scope: OwnerScope,
    thread: ThreadRecord,
    runId: string,
    r: {
      status: 'done' | 'failed';
      latencyMs: number;
      outcome?: string | null;
      guardrail?: string | null;
      provider?: string | null;
      model?: string | null;
      inputTokens?: number;
      cachedTokens?: number;
      outputTokens?: number;
      rounds?: number;
    },
    steps: StepRecord[] = [],
  ): Promise<void> {
    try {
      await this.repo.recordRun(scope, {
        id: runId,
        threadId: thread.id,
        kind: 'review',
        tier: REVIEW_TIER,
        promptVersion: `${REVIEW_PROMPT.name}@${REVIEW_PROMPT.version}`,
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
      });
      for (const step of steps) await this.repo.addStep(scope, step);
    } catch (error) {
      this.#log.warn(`assistant review run ${runId}: run not saved (${errorClass(error)})`);
    }
  }
}
