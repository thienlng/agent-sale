import { describe, expect, it } from 'vitest';

import type { TierRouteConfig } from '../domain/llm-config.js';
import { ModelOverrideConfigRepository, parseModelOverride } from '../evals/model-override.js';
import { parseCase } from '../evals/load.js';
import { buildReport, mergeRepeats, percentile, renderText } from '../evals/report.js';
import { runCaseFake } from '../evals/runner.js';
import { InMemoryLlmConfigRepository } from '../infrastructure/persistence/llm-config.in-memory-repository.js';

const MINIMAL = `
id: sample
group: g
bot: { profile: { fields: { warranty: "Bảo hành 6 tháng" }, notes: "" } }
conversation:
  - customer: "bảo hành bao lâu"
expect:
  outcome: answered
  contains_any: ["6 tháng"]
fake_turns:
  - text: "Dạ bảo hành 6 tháng ạ."
`;

describe('eval --model override', () => {
  it('parses a model with an optional effort and rejects bad specs', () => {
    expect(parseModelOverride('gpt-6.1-terra')).toEqual({ model: 'gpt-6.1-terra', effort: null });
    expect(parseModelOverride('gpt-6.1-sol@medium')).toEqual({
      model: 'gpt-6.1-sol',
      effort: 'medium',
    });
    expect(() => parseModelOverride('')).toThrow();
    expect(() => parseModelOverride('m@extreme')).toThrow(/effort/);
    expect(() => parseModelOverride('m@low@high')).toThrow();
  });

  it('points every route at the model on its primary provider, drops the fallback, refuses writes', async () => {
    const inner = new InMemoryLlmConfigRepository();
    const route: TierRouteConfig = {
      tier: 'smart',
      primary: { providerId: 'p1', model: 'gpt-6-luna', effort: 'low' },
      fallback: { providerId: 'p2', model: 'other', effort: null },
      updatedBy: null,
      updatedAt: new Date(0),
    };
    await inner.saveRoute(route);
    const keepEffort = new ModelOverrideConfigRepository(inner, { model: 'terra', effort: null });
    expect(await keepEffort.listRoutes()).toEqual([
      { ...route, primary: { providerId: 'p1', model: 'terra', effort: 'low' }, fallback: null },
    ]);
    const high = new ModelOverrideConfigRepository(inner, { model: 'sol', effort: 'high' });
    expect((await high.listRoutes())[0]?.primary).toEqual({
      providerId: 'p1',
      model: 'sol',
      effort: 'high',
    });
    await expect(high.saveRoute()).rejects.toThrow(/read-only/);
    // The stored configuration is untouched.
    expect((await inner.listRoutes())[0]).toEqual(route);
  });
});

describe('eval --repeat and run stats', () => {
  it('takes the nearest-rank percentile', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });

  it('passes a repeated case only when every run passed, and lists mixed cases as flaky', async () => {
    const ok = await runCaseFake(parseCase(MINIMAL));
    const a = { ...ok, latencyMs: 1000, inputTokens: 10, outputTokens: 2, modelCalls: 1 };
    const aFail = { ...a, pass: false, reply: 'sai', latencyMs: 3000 };
    const b = { ...a, id: 'b' };
    const c = { ...a, id: 'c', pass: false };
    const merged = mergeRepeats([
      [a, aFail],
      [b, b],
      [c, c],
    ]);
    expect(merged.map((r) => [r.id, r.pass, r.repeats])).toEqual([
      ['sample', false, { passed: 1, total: 2 }],
      ['b', true, { passed: 2, total: 2 }],
      ['c', false, { passed: 0, total: 2 }],
    ]);
    // The failing run is the one shown.
    expect(merged[0]?.reply).toBe('sai');

    const report = buildReport('live', merged, undefined, [a, aFail, b, b, c, c]);
    expect(report.repeat).toBe(2);
    expect(report.flaky).toEqual(['sample']);
    expect(report.passed).toBe(1);
    expect(report.stats).toMatchObject({
      runs: 6,
      modelCalls: 6,
      inputTokens: 60,
      outputTokens: 12,
      latencyP50Ms: 1000,
      latencyP95Ms: 3000,
    });
    const text = renderText(report);
    expect(text).toContain('FAIL sample (1/2 runs)');
    expect(text).toContain('Flaky (mixed results): sample');
    expect(text).toContain('2 run(s) per case');
  });

  it('keeps a single run unchanged', async () => {
    const ok = await runCaseFake(parseCase(MINIMAL));
    expect(mergeRepeats([[ok]])).toEqual([ok]);
    const report = buildReport('fake', [ok]);
    expect(report.repeat).toBe(1);
    expect(report.flaky).toEqual([]);
    expect(report.stats.runs).toBe(1);
  });
});
