import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { runToolBatch, type RunnableTool } from '../application/tool-runner.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const call = (id: string, name: string, input: unknown = {}) => ({ id, name, input });

function tool(
  name: string,
  readOnly: boolean,
  run: RunnableTool['run'] = async () => ({ content: `${name}-ok` }),
  schema: z.ZodType = z.object({}),
): RunnableTool {
  return { name, readOnly, schema, run };
}

describe('runToolBatch', () => {
  it('repairs names and arguments before running', async () => {
    const run = vi.fn(async (i: unknown) => ({ content: JSON.stringify(i) }));
    const t = tool('search_products', true, run, z.object({ query: z.string() }));
    const out = await runToolBatch([call('1', 'Search-Products', '{query:"x",}')], [t]);
    expect(run).toHaveBeenCalledWith({ query: 'x' });
    expect(out.results[0]).toMatchObject({ ok: true, content: '{"query":"x"}' });
    expect(out.allInvalid).toBe(false);
  });

  it('answers unknown tools with the available names', async () => {
    const out = await runToolBatch([call('1', 'nope_nothing')], [tool('a_tool', true)]);
    expect(JSON.parse(out.results[0]!.content)).toEqual({
      error: 'unknown_tool',
      available: ['a_tool'],
    });
    expect(out.results[0]!.ok).toBe(false);
    expect(out.allInvalid).toBe(true);
  });

  it('reports invalid arguments with the zod message and no values', async () => {
    const t = tool('t', true, undefined, z.object({ n: z.number() }));
    const out = await runToolBatch([call('1', 't', { n: 'secret-value' })], [t]);
    const body = JSON.parse(out.results[0]!.content);
    expect(body.error).toBe('invalid_arguments');
    expect(body.detail).toContain('n');
    expect(out.results[0]!.content).not.toContain('secret-value');
    expect(out.allInvalid).toBe(true);
  });

  it('runs valid calls next to invalid ones (not allInvalid)', async () => {
    const out = await runToolBatch(
      [call('1', 'zzzzzzzz'), call('2', 'ok_tool')],
      [tool('ok_tool', true)],
    );
    expect(out.results.map((r) => r.ok)).toEqual([false, true]);
    expect(out.allInvalid).toBe(false);
  });

  it('runs read-only calls in parallel, bounded, results in call order', async () => {
    let active = 0;
    let peak = 0;
    const t = tool(
      'r',
      true,
      async (i) => {
        active += 1;
        peak = Math.max(peak, active);
        await sleep(((i as { d: number }).d as number) * 5);
        active -= 1;
        return { content: String((i as { d: number }).d) };
      },
      z.object({ d: z.number() }),
    );
    const calls = Array.from({ length: 12 }, (_, k) => call(String(k), 'r', { d: 12 - k }));
    const out = await runToolBatch(calls, [t]);
    expect(peak).toBe(8);
    expect(out.results.map((r) => r.content)).toEqual(
      calls.map((c) => String((c.input as { d: number }).d)),
    );
    const t2 = await runToolBatch(calls.slice(0, 4), [t], { maxParallel: 2 });
    expect(t2.results).toHaveLength(4);
  });

  it('runs writes sequentially in requested order after read-only calls', async () => {
    const log: string[] = [];
    const w = (name: string) =>
      tool(name, false, async () => {
        log.push(`${name}:start`);
        await sleep(10);
        log.push(`${name}:end`);
        return { content: name };
      });
    const r = tool('r', true, async () => {
      await sleep(30);
      log.push('r:end');
      return { content: 'r' };
    });
    const out = await runToolBatch(
      [call('1', 'w1'), call('2', 'r'), call('3', 'w2')],
      [w('w1'), w('w2'), r],
    );
    expect(log).toEqual(['r:end', 'w1:start', 'w1:end', 'w2:start', 'w2:end']);
    expect(out.results.map((x) => x.content)).toEqual(['w1', 'r', 'w2']);
  });

  it('truncates long content', async () => {
    const t = tool('big', true, async () => ({ content: 'x'.repeat(13_000) }));
    const out = await runToolBatch([call('1', 'big')], [t]);
    expect(out.results[0]!.content).toBe('x'.repeat(12_000) + '…[truncated]');
    const small = await runToolBatch([call('1', 'big')], [t], { maxResultChars: 10 });
    expect(small.results[0]!.content).toBe('x'.repeat(10) + '…[truncated]');
  });

  it('turns an executor throw into tool_failed and reports name only', async () => {
    const onError = vi.fn();
    const err = new Error('db password leaked');
    const t = tool('boom', false, async () => {
      throw err;
    });
    const out = await runToolBatch([call('1', 'boom')], [t], { onError });
    expect(out.results[0]).toMatchObject({ ok: false, content: '{"error":"tool_failed"}' });
    expect(onError).toHaveBeenCalledWith('boom', err);
    expect(out.allInvalid).toBe(false);
  });

  it('collects trusted text and unique product ids in call order', async () => {
    const a = tool('a', true, async () => ({
      content: 'a',
      trusted: 'TA',
      productIds: ['p1', 'p2'],
    }));
    const b = tool('b', true, async () => ({
      content: 'b',
      trusted: 'TB',
      productIds: ['p2', 'p3'],
    }));
    const out = await runToolBatch([call('1', 'a'), call('2', 'b')], [a, b]);
    expect(out.trusted).toEqual(['TA', 'TB']);
    expect(out.productIds).toEqual(['p1', 'p2', 'p3']);
  });
});
