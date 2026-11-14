/* eslint-disable no-console -- CLI entrypoint */
import { parseArgs } from 'node:util';

import type { GenerateRequest, GenerateResponse } from '@agent-sales/ai-core';

import type { LlmGatewayPort } from '../modules/ai/api/index.js';
import { parseModelOverride, type ModelOverride } from '../modules/ai/evals/model-override.js';
import { percentile } from '../modules/ai/evals/report.js';
import {
  fakeAssistantModel,
  loadAssistantCases,
  runAssistantCase,
} from '../modules/assistant/evals/assistant-eval.js';
import { liveRuntime } from './eval-live.js';

/**
 * `pnpm --filter @agent-sales/backend eval:assistant [--live] [--model m[@effort]] [--repeat n] [--id x]`
 *
 * T-172: runs the owner assistant cases in `apps/backend/evals/assistant/` through the real chat
 * turn on in-memory stores and checks the proposal each one leaves. Fake mode (default) replays
 * the case's `fake_turns`; `--live` uses the LLM configured in the database
 * (DATABASE_SYSTEM_URL). `--model` and `--repeat` work as in `eval` (a case passes only when every
 * run passed). Exit code 1 when a critical case fails.
 */
const { values } = parseArgs({
  options: {
    live: { type: 'boolean', default: false },
    id: { type: 'string' },
    model: { type: 'string' },
    repeat: { type: 'string', default: '1' },
  },
});

const repeat = Number(values.repeat);
if (!Number.isInteger(repeat) || repeat < 1 || repeat > 10) {
  console.error('--repeat must be a whole number from 1 to 10');
  process.exit(1);
}
let override: ModelOverride | undefined;
if (values.model !== undefined) {
  if (!values.live) {
    console.error('--model needs --live (fake mode replays scripted turns)');
    process.exit(1);
  }
  try {
    override = parseModelOverride(values.model);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const cases = loadAssistantCases().filter((c) => !values.id || c.id === values.id);
if (!cases.length) {
  console.error('no assistant eval case matches --id');
  process.exit(1);
}

let close: (() => Promise<void>) | undefined;
let live: LlmGatewayPort | undefined;
if (values.live) {
  const runtime = liveRuntime(override);
  close = runtime.close;
  live = runtime.llm;
}

/** Wall time of each chat turn, and the calls and tokens of every model call. */
const turnMs: number[] = [];
const models = new Set<string>();
let modelCalls = 0;
let inputTokens = 0;
let outputTokens = 0;
const metered = (gateway: LlmGatewayPort): LlmGatewayPort => ({
  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const res = await gateway.generate(req);
    modelCalls += 1;
    inputTokens += res.usage.inputTokens;
    outputTokens += res.usage.outputTokens;
    models.add(`${res.provider}/${res.model}`);
    return res;
  },
});

try {
  let criticalFailed = false;
  let passed = 0;
  const flaky: string[] = [];
  for (const c of cases) {
    const runs = [];
    for (let i = 0; i < repeat; i += 1) {
      const started = Date.now();
      runs.push(await runAssistantCase(c, metered(live ?? fakeAssistantModel(c))));
      turnMs.push(Date.now() - started);
    }
    const ok = runs.filter((r) => r.ok).length;
    const shown = runs.find((r) => !r.ok) ?? runs.at(-1);
    if (!shown) continue;
    const tally = repeat > 1 ? ` (${ok}/${repeat} runs)` : '';
    console.log(
      `${ok === repeat ? 'PASS' : 'FAIL'} ${c.id}${shown.critical ? ' (critical)' : ''}${tally}`,
    );
    for (const p of shown.problems) console.log(`  - ${p}`);
    if (ok === repeat) passed += 1;
    else if (ok > 0) flaky.push(c.id);
    if (ok < repeat && shown.critical) criticalFailed = true;
  }
  const sec = (v: number | null) => (v === null ? 'n/a' : `${(v / 1000).toFixed(1)} s`);
  console.log(`\nTotal: ${passed}/${cases.length}${criticalFailed ? ' · CRITICAL FAILED' : ''}`);
  console.log(`Model: ${[...models].sort().join(', ') || 'none'} · ${repeat} run(s) per case`);
  console.log(
    `Turn time: P50 ${sec(percentile(turnMs, 50))}, P95 ${sec(percentile(turnMs, 95))} · ${modelCalls} model calls · tokens in ${inputTokens}, out ${outputTokens}`,
  );
  if (flaky.length) console.log(`Flaky (mixed results): ${flaky.join(', ')}`);
  if (criticalFailed) process.exitCode = 1;
} finally {
  await close?.();
}
