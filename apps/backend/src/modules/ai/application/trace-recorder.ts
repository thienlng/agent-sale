import { createHash } from 'node:crypto';

import { type AgentStep, redactSensitive, type RunnableTool } from '@agent-sales/ai-core';

import type { TurnStepRecord } from '../domain/ports/turn-trace.repository.js';
import { errorClass } from './reply-pipeline.js';
import { MAX_ERROR_CODE_CHARS, toolDetail } from './trace-detail.js';

/** Steps kept per turn; one more `limit` marker step says the rest was dropped. */
export const MAX_TRACE_STEPS = 60;

interface Slot {
  done: boolean;
  detail: Record<string, unknown> | null;
  errorCode: string | null;
  ms: number;
}

const cutCode = (code: string | null): string | null =>
  code === null ? null : code.slice(0, MAX_ERROR_CODE_CHARS);

/**
 * Collects one shop-bot turn's trace: wraps the turn's tools (input, result content and duration →
 * the allowlisted `toolDetail`) and records the loop's `onStep` events. A tool step takes the
 * oldest unconsumed detail of the same tool name (FIFO), so steps the runner produced without
 * running the tool (unknown name, invalid arguments) usually get none. Known limit: an invalid
 * call followed by a valid one of the same tool in one batch takes the valid call's detail.
 * Wrapping never changes what a tool returns or throws.
 */
export class TraceRecorder {
  readonly #actionIdOf: (name: string) => string | null;
  readonly #actionStatus: (() => { count: number; last: number | null }) | undefined;
  readonly #now: () => number;
  readonly #slots = new Map<string, Slot[]>();
  readonly #steps: TurnStepRecord[] = [];
  #dropped = false;
  #undelivered = 0;

  constructor(opts: {
    actionIdOf(name: string): string | null;
    /**
     * Executed action calls so far and the last one's HTTP status: an action's failure result
     * carries no status, so the recorder reads it from here when the call executed one.
     */
    actionStatus?: () => { count: number; last: number | null };
    now?: () => number;
  }) {
    this.#actionIdOf = (name) => opts.actionIdOf(name);
    this.#actionStatus = opts.actionStatus;
    this.#now = opts.now ?? Date.now;
  }

  wrap(tools: readonly RunnableTool[]): RunnableTool[] {
    return tools.map((tool) => ({
      ...tool,
      run: async (input: unknown) => {
        const slot: Slot = { done: false, detail: null, errorCode: null, ms: 0 };
        const queue = this.#slots.get(tool.name) ?? [];
        queue.push(slot);
        this.#slots.set(tool.name, queue);
        const start = this.#now();
        const before = this.#actionStatus?.().count;
        try {
          const out = await tool.run(input);
          this.#fill(slot, tool.name, input, out.content, before);
          return out;
        } catch (error) {
          slot.errorCode = cutCode(errorClass(error));
          throw error;
        } finally {
          slot.ms = this.#now() - start;
          slot.done = true;
        }
      },
    }));
  }

  #fill(slot: Slot, name: string, input: unknown, content: string, before?: number): void {
    try {
      const { detail, errorCode } = toolDetail(name, input, content, this.#actionIdOf);
      slot.detail = detail;
      slot.errorCode = cutCode(errorCode);
      if (detail && 'statusCode' in detail && detail.statusCode === null && before !== undefined) {
        const now = this.#actionStatus?.();
        if (now && now.count > before) detail.statusCode = now.last;
      }
      if (name === 'send_message' && detail?.delivered === false) this.#undelivered += 1;
    } catch {
      // A detail is best-effort: never let it change the tool's result.
      slot.detail = null;
    }
  }

  onStep(step: AgentStep): void {
    if (this.#steps.length >= MAX_TRACE_STEPS) {
      this.#dropped = true;
      return;
    }
    let slot: Slot | undefined;
    if (step.kind === 'tool' && step.name) {
      const queue = this.#slots.get(step.name);
      const at = queue?.findIndex((s) => s.done) ?? -1;
      if (queue && at >= 0) slot = queue.splice(at, 1)[0];
    }
    this.#steps.push({
      idx: this.#steps.length,
      kind: step.kind,
      toolName: step.kind === 'tool' ? (step.name ?? null) : null,
      ok: step.ok ?? null,
      errorCode: slot?.errorCode ?? null,
      ms: step.ms === undefined ? null : Math.round(step.ms),
      detail: slot?.detail ?? null,
    });
  }

  /** `send_message` calls the sink reported as not delivered. */
  get undelivered(): number {
    return this.#undelivered;
  }

  steps(): TurnStepRecord[] {
    const out = this.#steps.map((s) => ({ ...s }));
    if (this.#dropped) {
      out.push({
        idx: out.length,
        kind: 'limit',
        toolName: null,
        ok: null,
        errorCode: 'trace_steps_dropped',
        ms: null,
        detail: null,
      });
    }
    return out;
  }
}

/** Max chars of the query and reply excerpts kept in a trace. */
export const TRACE_EXCERPT_MAX = 300;

/** A redacted, ≤ 300-char excerpt; null when nothing is left. */
export function traceExcerpt(text: string): string | null {
  return redactSensitive(text, TRACE_EXCERPT_MAX) || null;
}

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
