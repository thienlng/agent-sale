import type { GenerateRequest, GenerateResponse, ToolCall } from '@agent-sales/ai-core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  AGENT_BUDGET_MS,
  AGENT_MAX_ROUNDS,
  WRAP_UP_NOTICE,
  runAgentLoop,
} from '../application/agent-loop.js';
import type { RunnableTool } from '../application/tool-runner.js';

const usage = { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0 };
const reply = (text: string, toolCalls: ToolCall[] = []): GenerateResponse => ({
  text,
  toolCalls,
  stopReason: toolCalls.length ? 'tool_use' : 'end',
  usage,
  provider: 'fake',
  model: 'm',
  latencyMs: 10,
});
const tc = (id: string, name = 'lookup', input: unknown = {}): ToolCall => ({ id, name, input });
const base = {
  workspaceId: 'w',
  tier: 'smart',
  messages: [{ role: 'user', content: 'hi' }],
} as unknown as GenerateRequest;
const lookup: RunnableTool = {
  name: 'lookup',
  readOnly: true,
  schema: z.object({}),
  run: async () => ({ content: 'found', trusted: 'T', productIds: ['p1'] }),
};
const script = (...rs: GenerateResponse[]) => {
  const q = [...rs];
  return vi.fn(async (_req: GenerateRequest) => q.shift() ?? reply('end'));
};

describe('runAgentLoop', () => {
  it('constants', () => {
    expect(AGENT_MAX_ROUNDS).toBe(10);
    expect(AGENT_BUDGET_MS).toBe(120_000);
  });

  it('answers directly', async () => {
    const generate = script(reply('hello'));
    const out = await runAgentLoop({ base, tools: [lookup], generate });
    expect(out.outcome).toBe('done');
    expect(out.res?.text).toBe('hello');
    expect(out.modelCalls).toBe(1);
    expect(out.followUps).toEqual([]);
  });

  it('runs tools, feeds results back, sums usage and collects grounding', async () => {
    const generate = script(reply('', [tc('1')]), reply('final'));
    const out = await runAgentLoop({ base, tools: [lookup], generate });
    expect(out.outcome).toBe('done');
    expect(out.modelCalls).toBe(2);
    expect(out.res?.usage.inputTokens).toBe(2);
    expect(out.res?.latencyMs).toBe(20);
    expect(out.trusted).toEqual(['T']);
    expect(out.productIds).toEqual(['p1']);
    expect(out.followUps.map((m) => m.role)).toEqual(['assistant', 'tool']);
    const second = generate.mock.calls[1]![0];
    expect(second.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect(out.steps.map((s) => s.kind)).toEqual(['model_call', 'tool', 'model_call']);
  });

  it('appends carry after base messages and returns it in followUps', async () => {
    const carry = [{ role: 'assistant' as const, content: 'c' }];
    const generate = script(reply('x'));
    const out = await runAgentLoop({ base, tools: [], generate, carry });
    expect(generate.mock.calls[0]![0].messages).toEqual([...base.messages, ...carry]);
    expect(out.followUps).toEqual(carry);
  });

  it('interrupts before a model call', async () => {
    const generate = script(reply('x'));
    const out = await runAgentLoop({
      base,
      tools: [],
      generate,
      shouldInterrupt: async () => true,
    });
    expect(out.outcome).toBe('interrupted');
    expect(out.res).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it('interrupts after a tool batch and keeps the follow-ups', async () => {
    let n = 0;
    const generate = script(reply('', [tc('1')]), reply('never'));
    const out = await runAgentLoop({
      base,
      tools: [lookup],
      generate,
      shouldInterrupt: async () => ++n >= 2,
    });
    expect(out.outcome).toBe('interrupted');
    expect(out.followUps.map((m) => m.role)).toEqual(['assistant', 'tool']);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('aborts an in-flight call when interrupted during it', async () => {
    let signal: AbortSignal | undefined;
    const generate = vi.fn(
      (req: GenerateRequest) =>
        new Promise<GenerateResponse>((_res, rej) => {
          signal = req.signal;
          req.signal?.addEventListener('abort', () => rej(new Error('aborted')));
        }),
    );
    let calls = 0;
    const out = await runAgentLoop({
      base,
      tools: [],
      generate,
      shouldInterrupt: async () => ++calls > 1,
    });
    expect(out.outcome).toBe('interrupted');
    expect(signal?.aborted).toBe(true);
  });

  it('passes timeoutMs = clamp(remaining/2, 15s, 60s)', async () => {
    let t = 0;
    const generate = vi.fn(async (_r: GenerateRequest) => {
      t += 50_000;
      return generate.mock.calls.length < 3 ? reply('', [tc(String(t))]) : reply('done');
    });
    await runAgentLoop({ base, tools: [lookup], generate, now: () => t });
    const timeouts = generate.mock.calls.map((c) => c[0].timeoutMs);
    expect(timeouts).toEqual([60_000, 35_000, 15_000]);
  });

  it('adds the wrap-up notice once at 80% of the budget', async () => {
    let t = 0;
    const generate = vi.fn(async (_r: GenerateRequest) => {
      t += 50_000;
      return generate.mock.calls.length < 4 ? reply('', [tc(String(t))]) : reply('done');
    });
    const out = await runAgentLoop({
      base,
      tools: [lookup],
      generate,
      now: () => t,
      budgetMs: 180_000,
    });
    const tools = out.followUps.filter((m) => m.role === 'tool');
    expect(tools.map((m) => m.content.includes(WRAP_UP_NOTICE))).toEqual([false, false, true]);
    expect(out.steps.filter((s) => s.kind === 'wrap_up')).toHaveLength(1);
    expect(tools[2]!.content).toBe(`found\n\n${WRAP_UP_NOTICE}`);
  });

  it('starts no new call once the budget is spent', async () => {
    let t = 0;
    const generate = vi.fn(async (_r: GenerateRequest) => {
      t += 130_000;
      return reply('', [tc('1')]);
    });
    const out = await runAgentLoop({ base, tools: [lookup], generate, now: () => t });
    expect(out.outcome).toBe('budget');
    expect(out.res).toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('forces a tool-free final call after maxRounds', async () => {
    const generate = script(reply('', [tc('1')]), reply('', [tc('2')]), reply('wrapped'));
    const out = await runAgentLoop({ base, tools: [lookup], generate, maxRounds: 2 });
    expect(out.outcome).toBe('done');
    expect(out.res?.text).toBe('wrapped');
    expect(generate.mock.calls[2]![0].toolChoice).toBe('none');
    expect(generate.mock.calls[1]![0].toolChoice).toBeUndefined();
  });

  it('reports limit when the final call still asks for tools', async () => {
    const generate = vi.fn(async () => reply('', [tc('x')]));
    const out = await runAgentLoop({ base, tools: [lookup], generate, maxRounds: 2 });
    expect(out.outcome).toBe('limit');
    expect(generate).toHaveBeenCalledTimes(3);
    expect(out.steps.at(-1)?.kind).toBe('limit');
  });

  it('stops after 3 consecutive invalid-only batches, a valid batch resets', async () => {
    const bad = (id: string) => reply('', [tc(id, 'ghost_tool_name')]);
    const stop = await runAgentLoop({
      base,
      tools: [lookup],
      generate: script(bad('1'), bad('2'), bad('3'), reply('no')),
    });
    expect(stop.outcome).toBe('invalid_tools');
    expect(stop.modelCalls).toBe(3);
    const reset = await runAgentLoop({
      base,
      tools: [lookup],
      generate: script(bad('1'), bad('2'), reply('', [tc('3')]), bad('4'), bad('5'), reply('fine')),
    });
    expect(reset.outcome).toBe('done');
  });

  it('finishes after a terminal call batch with that response', async () => {
    const handoff: RunnableTool = {
      name: 'handoff',
      readOnly: false,
      schema: z.object({}),
      run: async () => ({ content: 'ok' }),
    };
    const generate = script(reply('bye', [tc('1', 'handoff'), tc('2')]), reply('never'));
    const out = await runAgentLoop({
      base,
      tools: [lookup, handoff],
      generate,
      isTerminal: (c) => c.name === 'handoff',
    });
    expect(out.outcome).toBe('done');
    expect(out.res?.text).toBe('bye');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(out.followUps.filter((m) => m.role === 'tool')).toHaveLength(2);
  });

  it('forwards tool errors by name', async () => {
    const boom: RunnableTool = {
      ...lookup,
      run: async () => {
        throw new Error('x');
      },
    };
    const onToolError = vi.fn();
    const out = await runAgentLoop({
      base,
      tools: [boom],
      generate: script(reply('', [tc('1')]), reply('ok')),
      onToolError,
    });
    expect(onToolError).toHaveBeenCalledWith('lookup', expect.any(Error));
    expect(out.followUps[1]!.content).toBe('{"error":"tool_failed"}');
    expect(out.steps.find((s) => s.kind === 'tool')?.ok).toBe(false);
  });
});
