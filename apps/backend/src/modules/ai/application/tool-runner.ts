import type { ToolCall } from '@agent-sales/ai-core';
import type { ZodType } from 'zod';
import { repairArguments, repairToolName } from './tool-repair.js';

export interface RunnableTool {
  name: string;
  readOnly: boolean;
  schema: ZodType;
  /** `ok: false` marks a handled failure (an error result for the model, not a throw). */
  run(
    input: unknown,
  ): Promise<{ content: string; trusted?: string; productIds?: string[]; ok?: boolean }>;
}

export interface ToolBatchResult {
  /** `name` is the resolved tool name (null for an unknown tool); `ms` is that tool's own run time. */
  results: {
    call: ToolCall;
    name: string | null;
    content: string;
    ok: boolean;
    ms: number;
  }[];
  trusted: string[];
  productIds: string[];
  /** Every call of the batch was unknown or had invalid arguments. */
  allInvalid: boolean;
}

export const MAX_PARALLEL_TOOLS = 8;
export const MAX_TOOL_RESULT_CHARS = 12_000;
const TRUNCATED_SUFFIX = '…[truncated]';

interface Slot {
  call: ToolCall;
  content: string;
  ok: boolean;
  invalid: boolean;
  name: string | null;
  ms: number;
  trusted?: string;
  productIds?: string[];
  pending?: { tool: RunnableTool; input: unknown };
}

const zodDetail = (error: { issues: { path: PropertyKey[]; message: string }[] }): string =>
  error.issues.map((i) => `${i.path.map(String).join('.') || 'input'}: ${i.message}`).join('; ');

/**
 * Validates and runs one model-requested batch: names and arguments are repaired first, read-only
 * calls then run in parallel (bounded), writes one by one in the requested order. Results come back
 * in call order; the model only ever sees capped, value-free error JSON.
 */
export async function runToolBatch(
  calls: ToolCall[],
  tools: readonly RunnableTool[],
  opts: {
    onError?(name: string, e: unknown): void;
    maxParallel?: number;
    maxResultChars?: number;
    now?: () => number;
  } = {},
): Promise<ToolBatchResult> {
  const cap = opts.maxResultChars ?? MAX_TOOL_RESULT_CHARS;
  const parallel = Math.max(1, opts.maxParallel ?? MAX_PARALLEL_TOOLS);
  const now = opts.now ?? Date.now;
  const names = tools.map((t) => t.name);

  const slots: Slot[] = calls.map((call) => {
    const resolved = repairToolName(call.name, names);
    const tool = resolved ? tools.find((t) => t.name === resolved) : undefined;
    if (!tool) {
      return {
        call,
        name: null,
        ms: 0,
        invalid: true,
        ok: false,
        content: JSON.stringify({ error: 'unknown_tool', available: names }),
      };
    }
    const args = repairArguments(call.input);
    const invalidArgs = (detail: string): Slot => ({
      call,
      name: tool.name,
      ms: 0,
      invalid: true,
      ok: false,
      content: JSON.stringify({ error: 'invalid_arguments', detail }),
    });
    if (!args.ok) return invalidArgs(args.detail);
    const parsed = tool.schema.safeParse(args.value);
    if (!parsed.success) return invalidArgs(zodDetail(parsed.error));
    return {
      call,
      name: tool.name,
      ms: 0,
      invalid: false,
      ok: true,
      content: '',
      pending: { tool, input: parsed.data },
    };
  });

  const execute = async (slot: Slot): Promise<void> => {
    if (!slot.pending) return;
    const { tool, input } = slot.pending;
    const startedAt = now();
    try {
      const out = await tool.run(input);
      slot.content = out.content;
      if (out.trusted) slot.trusted = out.trusted;
      if (out.productIds) slot.productIds = out.productIds;
      if (out.ok === false) slot.ok = false;
    } catch (e) {
      opts.onError?.(tool.name, e);
      // Never the error message: it may carry internals the model must not see.
      slot.content = '{"error":"tool_failed"}';
      slot.ok = false;
    } finally {
      slot.ms = now() - startedAt;
    }
  };

  const reads = slots.filter((s) => s.pending?.tool.readOnly);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < reads.length) {
      const slot = reads[next++] as Slot;
      await execute(slot);
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, reads.length) }, worker));
  for (const slot of slots) if (slot.pending && !slot.pending.tool.readOnly) await execute(slot);

  const productIds = new Set<string>();
  const trusted: string[] = [];
  for (const s of slots) {
    if (s.content.length > cap) s.content = s.content.slice(0, cap) + TRUNCATED_SUFFIX;
    if (s.trusted) trusted.push(s.trusted);
    for (const id of s.productIds ?? []) productIds.add(id);
  }
  return {
    results: slots.map(({ call, name, content, ok, ms }) => ({ call, name, content, ok, ms })),
    trusted,
    productIds: [...productIds],
    allInvalid: slots.length > 0 && slots.every((s) => s.invalid),
  };
}
