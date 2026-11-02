import type { RunnableTool } from '@agent-sales/ai-core';
import { z } from 'zod';

/** All tool output the model sees in one turn, together, is never longer than this. */
export const TURN_TOOL_OUTPUT_CHARS = 40_000;
/** What every tool call returns once the turn's output budget is used up. */
export const TURN_BUDGET_EXHAUSTED_CONTENT = JSON.stringify({
  ok: false,
  errorCode: 'turn_budget_exhausted',
});
const TRUNCATED = '…[truncated]';

/** Marks a call whose arguments arrive after the budget is used up. */
const EXHAUSTED = Symbol('turn_budget_exhausted');

/** The text the agent loop shows for invalid arguments (`runToolBatch`), to charge its length. */
const invalidArgumentsContent = (issues: readonly { path: PropertyKey[]; message: string }[]) =>
  JSON.stringify({
    error: 'invalid_arguments',
    detail: issues
      .map((i) => `${i.path.map(String).join('.') || 'input'}: ${i.message}`)
      .join('; '),
  });

/**
 * Puts every tool of one turn behind one shared output counter (spec §6: ≤ 40 000 chars of tool
 * output per turn). It counts each result the tools return (core, memory, skills, route tools)
 * and the validation errors the loop writes for bad arguments. The result that crosses the limit
 * is cut to what is left; every later call returns `{ok:false,errorCode:'turn_budget_exhausted'}`
 * without running. Per-tool caps (e.g. the route tools' 8 000 chars) still apply inside.
 */
export function withTurnOutputBudget(
  tools: readonly RunnableTool[],
  limit = TURN_TOOL_OUTPUT_CHARS,
): RunnableTool[] {
  let used = 0;
  const exhausted = () => ({ content: TURN_BUDGET_EXHAUSTED_CONTENT, ok: false });

  return tools.map((tool) => ({
    name: tool.name,
    readOnly: tool.readOnly,
    // The loop validates before it runs a tool, so the counter sees validation errors here.
    schema: z.unknown().transform((value, zctx) => {
      if (used >= limit) return EXHAUSTED;
      const parsed = tool.schema.safeParse(value);
      if (parsed.success) return parsed.data as unknown;
      const shown = invalidArgumentsContent(parsed.error.issues);
      // An error that no longer fits is replaced like any other result.
      if (used + shown.length > limit) {
        used = limit;
        return EXHAUSTED;
      }
      used += shown.length;
      for (const issue of parsed.error.issues) {
        zctx.addIssue({ code: 'custom', message: issue.message, path: [...issue.path] });
      }
      return z.NEVER;
    }),
    async run(input) {
      if (input === EXHAUSTED || used >= limit) return exhausted();
      const out = await tool.run(input);
      const room = limit - used;
      if (out.content.length <= room) {
        used += out.content.length;
        return out;
      }
      used = limit;
      if (room <= TRUNCATED.length) return exhausted();
      return { ...out, content: out.content.slice(0, room - TRUNCATED.length) + TRUNCATED };
    },
  }));
}
