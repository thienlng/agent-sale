import type { GenerateRequest, GenerateResponse, ToolCall } from '@agent-sales/ai-core';
import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { MAX_TOOL_ROUNDS, runToolLoop } from '../application/tool-loop.js';

const base: GenerateRequest = {
  workspaceId: workspaceId('01900000-0000-7000-8000-000000000001'),
  tier: 'smart',
  messages: [{ role: 'user', content: 'hi' }],
};

const tool = (id: string, name = 'search_products'): ToolCall => ({ id, name, input: { q: id } });
const response = (over: Partial<GenerateResponse> = {}): GenerateResponse => ({
  text: '',
  toolCalls: [],
  stopReason: 'end',
  usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 1 },
  provider: 'fake',
  model: 'm',
  latencyMs: 100,
  ...over,
});
const calling = (...calls: ToolCall[]) =>
  response({ toolCalls: calls, stopReason: 'tool_use', text: 'thinking' });

function loop(script: GenerateResponse[], execute?: (call: ToolCall) => Promise<never> | object) {
  const requests: GenerateRequest[] = [];
  const queue = [...script];
  const executed: ToolCall[] = [];
  return {
    requests,
    executed,
    run: () =>
      runToolLoop({
        base,
        generate: async (req) => {
          // Snapshot: the loop reuses arrays.
          requests.push({ ...req, messages: [...req.messages] });
          const next = queue.shift();
          if (!next) throw new Error('script exhausted');
          return next;
        },
        execute: async (call) => {
          executed.push(call);
          const out = execute ? await execute(call) : {};
          return { content: `{"r":"${call.id}"}`, trusted: `t-${call.id}`, ...out };
        },
      }),
  };
}

describe('runToolLoop', () => {
  it('returns the first response untouched when no tool is called', async () => {
    const l = loop([response({ text: '{"reply":"hi"}' })]);
    const out = await l.run();
    expect(out.res.text).toBe('{"reply":"hi"}');
    expect(out.messages).toEqual([]);
    expect(out.modelCalls).toBe(1);
    expect(out.limitHit).toBe(false);
    expect(l.requests[0]?.messages).toEqual(base.messages);
  });

  it('runs two rounds then answers, appending assistant and tool messages in order', async () => {
    const l = loop(
      [
        calling(tool('a'), tool('b', 'product_details')),
        calling(tool('c')),
        response({ text: 'final' }),
      ],
      (call) =>
        call.id === 'a'
          ? { productIds: ['p1'] }
          : call.id === 'c'
            ? { productIds: ['p1', 'p2'] }
            : {},
    );
    const out = await l.run();
    expect(out.res.text).toBe('final');
    expect(out.modelCalls).toBe(3);
    expect(out.limitHit).toBe(false);
    expect(out.messages).toEqual([
      {
        role: 'assistant',
        content: 'thinking',
        toolCalls: [tool('a'), tool('b', 'product_details')],
      },
      { role: 'tool', content: '{"r":"a"}', toolCallId: 'a', name: 'search_products' },
      { role: 'tool', content: '{"r":"b"}', toolCallId: 'b', name: 'product_details' },
      { role: 'assistant', content: 'thinking', toolCalls: [tool('c')] },
      { role: 'tool', content: '{"r":"c"}', toolCallId: 'c', name: 'search_products' },
    ]);
    expect(out.trusted).toEqual(['t-a', 't-b', 't-c']);
    expect(out.productIds).toEqual(['p1', 'p2']);
    // Each request carries base + the follow-ups so far; base is never mutated.
    expect(l.requests.map((r) => r.messages.length)).toEqual([1, 4, 6]);
    expect(base.messages).toHaveLength(1);
    expect(l.requests[2]?.toolChoice).toBeUndefined();
  });

  it('sums usage and latency over every model call', async () => {
    const l = loop([calling(tool('a')), calling(tool('b')), response({ text: 'x' })]);
    const out = await l.run();
    expect(out.res.usage).toEqual({ inputTokens: 30, outputTokens: 15, cachedInputTokens: 3 });
    expect(out.res.latencyMs).toBe(300);
    expect(out.res.stopReason).toBe('end');
  });

  it('caps at 4 rounds: the next call forbids tools and its answer is returned', async () => {
    const l = loop([
      calling(tool('1')),
      calling(tool('2')),
      calling(tool('3')),
      calling(tool('4')),
      response({ text: 'forced answer' }),
    ]);
    const out = await l.run();
    expect(MAX_TOOL_ROUNDS).toBe(4);
    expect(out.res.text).toBe('forced answer');
    expect(out.limitHit).toBe(false);
    expect(out.modelCalls).toBe(5);
    expect(l.requests.map((r) => r.toolChoice)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      'none',
    ]);
  });

  it('flags limitHit and does not execute the calls of the forced response', async () => {
    const l = loop([
      calling(tool('1')),
      calling(tool('2')),
      calling(tool('3')),
      calling(tool('4')),
      calling(tool('5')),
    ]);
    const out = await l.run();
    expect(out.limitHit).toBe(true);
    expect(l.executed.map((c) => c.id)).toEqual(['1', '2', '3', '4']);
    expect(out.res.toolCalls).toHaveLength(1);
    expect(out.modelCalls).toBe(5);
  });

  it('turns an executor failure into {"error":"tool_failed"} and keeps going', async () => {
    const l = loop([calling(tool('a'), tool('b')), response({ text: 'ok' })], (call) => {
      if (call.id === 'a') return Promise.reject(new Error('secret internals at db:5432'));
      return { content: '{"fine":true}', trusted: 't' };
    });
    const out = await l.run();
    expect(out.res.text).toBe('ok');
    const tools = out.messages.filter((m) => m.role === 'tool');
    expect(tools.map((m) => m.content)).toEqual(['{"error":"tool_failed"}', '{"fine":true}']);
    expect(JSON.stringify(out.messages)).not.toContain('secret');
    expect(out.trusted).toEqual(['t']);
  });
});
