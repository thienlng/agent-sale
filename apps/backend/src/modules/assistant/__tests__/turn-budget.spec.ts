import { runToolBatch, type RunnableTool, type ToolCall } from '@agent-sales/ai-core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  TURN_BUDGET_EXHAUSTED_CONTENT,
  TURN_TOOL_OUTPUT_CHARS,
  withTurnOutputBudget,
} from '../application/turn-budget.js';

const tool = (name: string, size: number, readOnly = true): RunnableTool => ({
  name,
  readOnly,
  schema: z.object({ n: z.number().optional() }),
  run: vi.fn(() => Promise.resolve({ content: 'x'.repeat(size) })),
});
let seq = 0;
const call = (name: string, input: unknown = {}): ToolCall => ({ id: `c${seq++}`, name, input });

describe('withTurnOutputBudget', () => {
  it('shares one counter across every tool; the crossing result is cut, later ones are refused', async () => {
    const big = tool('route_read', 15_000);
    const mem = tool('memory', 9_000, false);
    const tools = withTurnOutputBudget([big, mem]);

    const first = await runToolBatch([call('route_read'), call('route_read')], tools, {
      maxResultChars: 100_000,
    });
    expect(first.results.map((r) => r.content.length)).toEqual([15_000, 15_000]);

    const second = await runToolBatch([call('memory'), call('memory')], tools, {
      maxResultChars: 100_000,
    });
    // 30 000 used: the first memory result gets the last 10 000; the second is refused unrun.
    expect(second.results[0]!.content).toHaveLength(9_000);
    expect(second.results[1]!.content).toHaveLength(1_000);
    expect(second.results[1]!.content.endsWith('…[truncated]')).toBe(true);
    expect(mem.run).toHaveBeenCalledTimes(2);

    const third = await runToolBatch([call('route_read'), call('memory')], tools);
    expect(third.results.map((r) => [r.content, r.ok])).toEqual([
      [TURN_BUDGET_EXHAUSTED_CONTENT, false],
      [TURN_BUDGET_EXHAUSTED_CONTENT, false],
    ]);
    expect(big.run).toHaveBeenCalledTimes(2);
    expect(mem.run).toHaveBeenCalledTimes(2);
    expect(JSON.parse(TURN_BUDGET_EXHAUSTED_CONTENT)).toEqual({
      ok: false,
      errorCode: 'turn_budget_exhausted',
    });
  });

  it('never counts or refuses the UI tools (QA N1)', async () => {
    const big = tool('route_read', 50_000);
    const fill = tool('ui_fill_form', 300, false);
    const tools = withTurnOutputBudget([big, fill], 1_000);
    expect(tools[1]).toBe(fill);
    await runToolBatch([call('route_read')], tools, { maxResultChars: 100_000 });
    const after = await runToolBatch([call('ui_fill_form'), call('route_read')], tools);
    expect(after.results.map((r) => r.content)).toEqual([
      'x'.repeat(300),
      TURN_BUDGET_EXHAUSTED_CONTENT,
    ]);
  });

  it('counts validation errors, and refuses calls with bad arguments once the budget is gone', async () => {
    // The loop's own text for these bad arguments, measured on the bare tool.
    const plain = await runToolBatch([call('small', { n: 'nope' })], [tool('small', 10)]);
    const errorChars = plain.results[0]!.content.length;
    expect(plain.results[0]!.content).toContain('invalid_arguments');

    const small = tool('small', 10);
    const tools = withTurnOutputBudget([small], errorChars + 15);
    const bad = await runToolBatch([call('small', { n: 'nope' })], tools);
    expect(bad.results[0]!.content).toBe(plain.results[0]!.content);
    expect(bad.allInvalid).toBe(true);
    // errorChars + 10 used: 5 left, so the next error does not fit and is replaced.
    expect((await runToolBatch([call('small')], tools)).results[0]!.content).toHaveLength(10);
    const after = await runToolBatch([call('small', { n: 'nope' }), call('small')], tools);
    expect(after.results.map((r) => r.content)).toEqual([
      TURN_BUDGET_EXHAUSTED_CONTENT,
      TURN_BUDGET_EXHAUSTED_CONTENT,
    ]);
    expect(small.run).toHaveBeenCalledTimes(1);
  });

  it('passes valid parsed input through to the tool and keeps its flags', async () => {
    const run = vi.fn((input: unknown) =>
      Promise.resolve({ content: JSON.stringify(input), trusted: 't', ok: false }),
    );
    const [wrapped] = withTurnOutputBudget([
      { name: 'x', readOnly: false, schema: z.object({ q: z.string().trim() }), run },
    ]);
    expect(wrapped!.readOnly).toBe(false);
    const out = await runToolBatch([call('x', { q: ' a ' })], [wrapped!]);
    expect(run).toHaveBeenCalledWith({ q: 'a' });
    expect(out.results[0]).toMatchObject({ ok: false, content: '{"q":"a"}' });
    expect(out.trusted).toEqual(['t']);
    expect(TURN_TOOL_OUTPUT_CHARS).toBe(40_000);
  });
});
