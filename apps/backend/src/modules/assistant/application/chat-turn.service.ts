import {
  runAgentLoop,
  type AgentLoopResult,
  type AgentStep,
  type ChatMessage,
  type ToolCall,
} from '@agent-sales/ai-core';
import type { AssistantUiAction, SendAssistantMessageRequest } from '@agent-sales/contracts';
import { newId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { AI_LLM_GATEWAY, isAiNotConfiguredError, type LlmGatewayPort } from '../../ai/api/index.js';
import {
  AssistantBusyError,
  AssistantNotFoundError,
  AssistantRunIdTakenError,
} from '../domain/assistant.errors.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import {
  ASSISTANT_REPOSITORY,
  type AssistantRepository,
  type MessageRecord,
  type NewMessage,
  type RunRecord,
  type StepRecord,
} from '../domain/ports/assistant.repository.js';
import { CORE_TOOL_DEFINITIONS, coreTools, type ToolContext } from './core-tools.js';
import { isVisibleMessage } from './mappers.js';
import { MEMORY_TOOL_DEFINITION, memoryTool } from './memory-tools.js';
import { buildTurnMessage } from './prompt-builder.js';
import { SKILL_TOOL_DEFINITIONS, SkillCatalog, skillTools } from './skill-tools.js';

/** The assistant answers on the `pro` tier (ADR-022). */
export const TURN_TIER = 'pro' as const;
export const TURN_MAX_ROUNDS = 25;
export const TURN_BUDGET_MS = 90_000;
export const TURN_CALL_TIMEOUT_MS = 60_000;
/** An untitled thread takes this many characters of its first message as its title. */
export const TITLE_CHARS = 60;
/** Said when the turn ends without a usable answer, or the model failed. */
export const FALLBACK_REPLY = 'Dạ em chưa trả lời được lúc này, anh/chị thử lại giúp em nhé.';
/**
 * The model sees at most this many active messages of the thread (1a cap; compaction is 1b). The
 * window starts at a user message, so an assistant tool call and its results are never split.
 */
export const HISTORY_MAX_MESSAGES = 40;
/** Appended to the last tool result at 80% of the turn budget (the shop bot's text says customer). */
export const OWNER_WRAP_UP_NOTICE = 'Time is almost up: answer the owner now with what you have.';
/** Every tool the model is offered, sorted by name so the tool list stays cache-stable. */
export const TURN_TOOL_DEFINITIONS = [
  ...CORE_TOOL_DEFINITIONS,
  MEMORY_TOOL_DEFINITION,
  ...SKILL_TOOL_DEFINITIONS,
].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

export interface TurnResult {
  /** The visible messages of the turn (the owner's text, then the answer). */
  messages: MessageRecord[];
  run: RunRecord & { steps: StepRecord[] };
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
      return { role: 'user', content: `[event] ${m.content}` };
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

/** Steps keep no arguments or results: kind, tool name, ok and duration only. */
const toStepRecord = (runId: string, idx: number, s: AgentStep): StepRecord => ({
  runId,
  idx,
  kind: s.kind,
  toolName: s.name ?? null,
  ok: s.ok ?? null,
  ms: s.ms === undefined ? null : Math.round(s.ms),
  errorCode: null,
});

/** The last `max` messages, from the first user (or event) message on. */
export function capHistory(messages: MessageRecord[], max = HISTORY_MAX_MESSAGES): MessageRecord[] {
  const window = messages.slice(-max);
  const start = window.findIndex((m) => m.role === 'user' || m.role === 'event');
  return start < 0 ? [] : window.slice(start);
}

/** At most the last navigate and the last spotlight of the turn, navigate first. */
export function finalUiActions(actions: AssistantUiAction[]): AssistantUiAction[] {
  const navigate = actions.findLast((a) => a.type === 'navigate');
  const spotlight = actions.findLast((a) => a.type === 'spotlight');
  return [...(navigate ? [navigate] : []), ...(spotlight ? [spotlight] : [])];
}

const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

/**
 * One chat turn of the owner assistant: start the run (one at a time per owner, idempotent by
 * the client `turnId`), store the owner's message, run the shared agent loop on the `pro` tier
 * with the core, memory and skill tools, store the tool exchange and the answer, and finish the run with its
 * usage. Steps are written as they happen so `GET /assistant/runs/{id}` shows progress.
 */
@Injectable()
export class ChatTurnService {
  readonly #log = new Logger(ChatTurnService.name);

  constructor(
    @Inject(ASSISTANT_REPOSITORY) private readonly repo: AssistantRepository,
    @Inject(AI_LLM_GATEWAY) private readonly gateway: LlmGatewayPort,
    @Inject(SkillCatalog) private readonly skills: SkillCatalog,
  ) {}

  async send(
    scope: OwnerScope,
    threadId: string,
    req: SendAssistantMessageRequest,
  ): Promise<TurnResult> {
    const thread = await this.repo.getThread(scope, threadId);
    if (!thread) throw new AssistantNotFoundError('thread', threadId);
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
      return await this.#answer(scope, thread, req);
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
    return { messages, run };
  }

  async #answer(
    scope: OwnerScope,
    thread: { id: string; title: string; systemPrompt: string },
    req: SendAssistantMessageRequest,
  ): Promise<TurnResult> {
    const runId = req.turnId;
    const [user] = await this.repo.appendMessages(scope, thread.id, [
      row({ role: 'user', content: req.text, pageContext: req.pageContext ?? null, runId }),
    ]);
    if (!user) throw new Error('assistant user message was not stored');
    if (!thread.title.trim()) {
      const title = Array.from(req.text).slice(0, TITLE_CHARS).join('').trim();
      await this.repo.updateThread(scope, thread.id, { title });
    }

    const stored = await this.repo.listMessages(scope, thread.id, { activeOnly: true });
    const turnText = buildTurnMessage(req.text, req.pageContext, new Date());
    const history = capHistory(stored).map((m) =>
      m.id === user.id ? { role: 'user' as const, content: turnText } : toChatMessage(m),
    );

    const ctx: ToolContext = {
      scope,
      repo: this.repo,
      uiActions: [],
      ...(req.pageContext ? { page: req.pageContext } : {}),
    };
    const pending: Promise<void>[] = [];
    let idx = 0;
    let result: AgentLoopResult | undefined;
    let failure: unknown;
    try {
      result = await runAgentLoop({
        base: {
          workspaceId: scope.businessId,
          tier: TURN_TIER,
          messages: [{ role: 'system', content: thread.systemPrompt }, ...history],
          tools: TURN_TOOL_DEFINITIONS,
          promptCacheKey: `asst:${scope.ownerUserId}:${thread.id}`,
          timeoutMs: TURN_CALL_TIMEOUT_MS,
        },
        tools: [
          ...coreTools(ctx),
          memoryTool({ scope, repo: this.repo }),
          ...skillTools(this.skills),
        ],
        generate: (r) => this.gateway.generate(r),
        maxRounds: TURN_MAX_ROUNDS,
        budgetMs: TURN_BUDGET_MS,
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
      const [answer] = await this.repo.appendMessages(scope, thread.id, [
        // No answer, so no UI action: the owner sees the apology only.
        row({ role: 'assistant', content: FALLBACK_REPLY, runId }),
      ]);
      await this.repo.finishRun(scope, runId, {
        status: 'failed',
        guardrail: 'model_error',
        finishedAt: new Date(),
      });
      return this.#result(scope, runId, [user, ...(answer ? [answer] : [])]);
    }

    const text = result.res?.text.trim() ?? '';
    const answered = result.outcome === 'done' && text.length > 0;
    const added = await this.repo.appendMessages(scope, thread.id, [
      ...result.followUps.map((m) => toRow(m, runId)),
      row({
        role: 'assistant',
        content: answered ? text : FALLBACK_REPLY,
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
    return this.#result(scope, runId, [user, ...added]);
  }

  async #result(scope: OwnerScope, runId: string, rows: MessageRecord[]): Promise<TurnResult> {
    const run = await this.repo.getRun(scope, runId);
    if (!run) throw new AssistantNotFoundError('run', runId);
    return { messages: rows.filter(isVisibleMessage), run };
  }
}
