import type {
  ChatMessage,
  GenerateRequest,
  GenerateResponse,
  ToolCall,
  Usage,
} from '@agent-sales/ai-core';
import { runToolBatch, type RunnableTool } from './tool-runner.js';

export const AGENT_MAX_ROUNDS = 10;
export const AGENT_BUDGET_MS = 120_000;
export const WRAP_UP_NOTICE =
  '[System: time is almost up — answer the customer now with what you have.]';

const WRAP_UP_FRACTION = 0.8;
const MIN_CALL_TIMEOUT_MS = 15_000;
const MAX_CALL_TIMEOUT_MS = 60_000;
const INTERRUPT_POLL_MS = 500;
const MAX_INVALID_BATCHES = 3;

export interface AgentStep {
  kind: 'model_call' | 'tool' | 'wrap_up' | 'interrupted' | 'limit' | 'invalid_tools' | 'budget';
  name?: string;
  ok?: boolean;
  ms?: number;
}

export type AgentOutcome = 'done' | 'interrupted' | 'limit' | 'invalid_tools' | 'budget';

export interface AgentLoopInput {
  base: GenerateRequest;
  tools: readonly RunnableTool[];
  generate(req: GenerateRequest): Promise<GenerateResponse>;
  shouldInterrupt?: () => Promise<boolean>;
  /** Messages of an interrupted earlier run, appended after `base.messages`. */
  carry?: ChatMessage[];
  /** A terminal call (e.g. handoff) ends the turn after its batch ran. */
  isTerminal?(call: ToolCall): boolean;
  maxRounds?: number;
  budgetMs?: number;
  now?: () => number;
  onStep?(s: AgentStep): void;
  onToolError?(name: string, e: unknown): void;
}

export interface AgentLoopResult {
  res: GenerateResponse | null;
  /** Carry plus this run's assistant tool calls and tool results, in order. */
  followUps: ChatMessage[];
  trusted: string[];
  productIds: string[];
  modelCalls: number;
  outcome: AgentOutcome;
  steps: AgentStep[];
}

const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
});

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const INTERRUPTED = Symbol('interrupted');

/**
 * Hermes-style agent loop: model call, run the requested tools, feed results back, until the model
 * answers without tools. Bounded by rounds and a wall-clock budget, interruptible between and
 * during model calls, and stopped after repeated invalid-only tool batches.
 */
export async function runAgentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  const now = input.now ?? Date.now;
  const maxRounds = input.maxRounds ?? AGENT_MAX_ROUNDS;
  const budgetMs = input.budgetMs ?? AGENT_BUDGET_MS;
  const start = now();
  const followUps: ChatMessage[] = [...(input.carry ?? [])];
  const trusted: string[] = [];
  const productIds = new Set<string>();
  const steps: AgentStep[] = [];
  const step = (s: AgentStep): void => {
    steps.push(s);
    input.onStep?.(s);
  };
  let modelCalls = 0;
  let rounds = 0;
  let invalidStreak = 0;
  let wrapped = false;
  let usage: Usage | undefined;
  let latencyMs = 0;

  const finish = (outcome: AgentOutcome, res: GenerateResponse | null): AgentLoopResult => ({
    res: res && usage ? { ...res, usage, latencyMs } : res,
    followUps,
    trusted,
    productIds: [...productIds],
    modelCalls,
    outcome,
    steps,
  });

  const callModel = async (
    req: GenerateRequest,
  ): Promise<GenerateResponse | typeof INTERRUPTED> => {
    const controller = new AbortController();
    let interrupted = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const aborted = new Promise<typeof INTERRUPTED>((resolve) => {
      if (!input.shouldInterrupt) return;
      let busy = false;
      timer = setInterval(() => {
        if (busy) return;
        busy = true;
        input
          .shouldInterrupt?.()
          .then((yes) => {
            if (yes && !interrupted) {
              interrupted = true;
              controller.abort();
              resolve(INTERRUPTED);
            }
          })
          .catch(() => undefined)
          .finally(() => {
            busy = false;
          });
      }, INTERRUPT_POLL_MS);
    });
    try {
      const call = input.generate({ ...req, signal: controller.signal });
      call.catch(() => undefined); // an aborted call may reject after we stopped waiting
      return await Promise.race([call, aborted]);
    } catch (error) {
      if (interrupted) return INTERRUPTED;
      throw error;
    } finally {
      if (timer) clearInterval(timer);
    }
  };

  for (;;) {
    if (await input.shouldInterrupt?.()) {
      step({ kind: 'interrupted' });
      return finish('interrupted', null);
    }
    const elapsed = now() - start;
    if (elapsed >= budgetMs) {
      step({ kind: 'budget' });
      return finish('budget', null);
    }
    const finalCall = rounds >= maxRounds;
    const callStart = now();
    const out = await callModel({
      ...input.base,
      messages: [...input.base.messages, ...followUps],
      timeoutMs: clamp((budgetMs - elapsed) / 2, MIN_CALL_TIMEOUT_MS, MAX_CALL_TIMEOUT_MS),
      ...(finalCall ? { toolChoice: 'none' as const } : {}),
    });
    if (out === INTERRUPTED) {
      step({ kind: 'interrupted' });
      return finish('interrupted', null);
    }
    modelCalls += 1;
    usage = usage ? addUsage(usage, out.usage) : out.usage;
    latencyMs += out.latencyMs;
    step({ kind: 'model_call', ms: now() - callStart });

    if (out.toolCalls.length === 0) return finish('done', out);
    if (finalCall) {
      step({ kind: 'limit' });
      return finish('limit', out);
    }
    rounds += 1;

    followUps.push({ role: 'assistant', content: out.text, toolCalls: out.toolCalls });
    const toolStart = now();
    const batch = await runToolBatch(out.toolCalls, input.tools, {
      ...(input.onToolError ? { onError: input.onToolError } : {}),
    });
    const ms = now() - toolStart;
    for (const r of batch.results) step({ kind: 'tool', name: r.call.name, ok: r.ok, ms });
    trusted.push(...batch.trusted);
    for (const id of batch.productIds) productIds.add(id);
    const toolMessages: ChatMessage[] = batch.results.map((r) => ({
      role: 'tool',
      content: r.content,
      toolCallId: r.call.id,
      name: r.call.name,
    }));
    if (!wrapped && now() - start >= budgetMs * WRAP_UP_FRACTION) {
      wrapped = true;
      const last = toolMessages[toolMessages.length - 1];
      if (last) last.content = `${last.content}\n\n${WRAP_UP_NOTICE}`;
      step({ kind: 'wrap_up' });
    }
    followUps.push(...toolMessages);

    if (input.isTerminal && out.toolCalls.some((c) => input.isTerminal?.(c))) {
      return finish('done', out);
    }
    invalidStreak = batch.allInvalid ? invalidStreak + 1 : 0;
    if (invalidStreak >= MAX_INVALID_BATCHES) {
      step({ kind: 'invalid_tools' });
      return finish('invalid_tools', out);
    }
  }
}
