import { runAgentLoop, type GenerateResponse, type RunnableTool } from '@agent-sales/ai-core';
import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MAX_TRACE_STEPS, TraceRecorder } from '../application/trace-recorder.js';

const search: RunnableTool = {
  name: 'search_products',
  readOnly: true,
  schema: z.object({ query: z.string() }),
  run: async (input) => {
    const { query } = input as { query: string };
    const rows = query === 'none' ? [] : [{ id: `${query}-1` }];
    return { content: JSON.stringify({ rows, details: [] }) };
  },
};

const broken: RunnableTool = {
  name: 'calculate',
  readOnly: true,
  schema: z.object({ expression: z.string() }),
  run: async () => {
    throw new TypeError('boom');
  },
};

const toolUse = (calls: { name: string; input: object }[]): GenerateResponse =>
  ({
    text: '',
    stopReason: 'tool_use',
    toolCalls: calls.map((c, i) => ({ id: `c${i}`, name: c.name, input: c.input })),
    usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
    latencyMs: 1,
    provider: 'fake',
    model: 'fake',
  }) as unknown as GenerateResponse;
const answer = { ...toolUse([]), text: 'Dạ', stopReason: 'end', toolCalls: [] } as GenerateResponse;

async function run(script: GenerateResponse[], tools: RunnableTool[]) {
  const recorder = new TraceRecorder({ actionIdOf: () => null });
  const queue = [...script];
  await runAgentLoop({
    base: {
      workspaceId: workspaceId(newId()),
      tier: 'smart',
      messages: [{ role: 'user', content: 'hi' }],
    },
    tools: recorder.wrap(tools),
    generate: async () => queue.shift() ?? answer,
    onStep: (s) => recorder.onStep(s),
  });
  return recorder.steps();
}

describe('TraceRecorder', () => {
  it('matches two calls of one tool to their steps in order (FIFO)', async () => {
    const steps = await run(
      [
        toolUse([
          { name: 'search_products', input: { query: 'ao' } },
          { name: 'search_products', input: { query: 'none' } },
        ]),
        answer,
      ],
      [search],
    );
    expect(steps.map((s) => [s.idx, s.kind, s.toolName])).toEqual([
      [0, 'model_call', null],
      [1, 'tool', 'search_products'],
      [2, 'tool', 'search_products'],
      [3, 'model_call', null],
    ]);
    expect(steps[1]?.detail).toMatchObject({ query: 'ao', resultCount: 1 });
    expect(steps[2]?.detail).toMatchObject({ query: 'none', resultCount: 0 });
  });

  it('gives an unknown or invalid tool step no detail', async () => {
    const steps = await run(
      [
        toolUse([
          { name: 'no_such_tool', input: {} },
          { name: 'search_products', input: { query: 42 } },
        ]),
        answer,
      ],
      [search],
    );
    const tools = steps.filter((s) => s.kind === 'tool');
    expect(tools).toHaveLength(2);
    expect(tools.every((s) => s.detail === null && s.ok === false)).toBe(true);
  });

  it('records a throwing tool with its error class and keeps the runner behaviour', async () => {
    const recorder = new TraceRecorder({ actionIdOf: () => null });
    const [wrapped] = recorder.wrap([broken]);
    await expect(wrapped?.run({ expression: '1' })).rejects.toThrow('boom');
    recorder.onStep({ kind: 'tool', name: 'calculate', ok: false, ms: 3 });
    expect(recorder.steps()).toEqual([
      {
        idx: 0,
        kind: 'tool',
        toolName: 'calculate',
        ok: false,
        errorCode: 'TypeError',
        ms: 3,
        detail: null,
      },
    ]);
  });

  it('keeps 60 steps and then one limit marker', () => {
    const recorder = new TraceRecorder({ actionIdOf: () => null });
    for (let i = 0; i < 75; i++) recorder.onStep({ kind: 'model_call', ms: 1 });
    const steps = recorder.steps();
    expect(steps).toHaveLength(MAX_TRACE_STEPS + 1);
    expect(steps.at(-1)).toMatchObject({
      idx: MAX_TRACE_STEPS,
      kind: 'limit',
      errorCode: 'trace_steps_dropped',
    });
  });

  it('reads the HTTP status of an executed action call from the action state', async () => {
    const calls: { statusCode: number | null }[] = [];
    const action: RunnableTool = {
      name: 'action_1',
      readOnly: false,
      schema: z.object({}),
      run: async () => {
        calls.push({ statusCode: 401 });
        return { content: JSON.stringify({ ok: false, errorCode: 'http_4xx' }) };
      },
    };
    const recorder = new TraceRecorder({
      actionIdOf: () => 'act-1',
      actionStatus: () => ({ count: calls.length, last: calls.at(-1)?.statusCode ?? null }),
    });
    const [wrapped] = recorder.wrap([action]);
    await wrapped?.run({});
    recorder.onStep({ kind: 'tool', name: 'action_1', ok: true, ms: 1 });
    expect(recorder.steps()[0]).toMatchObject({
      errorCode: 'http_4xx',
      detail: { actionId: 'act-1', statusCode: 401, errorCode: 'http_4xx' },
    });
  });
});
