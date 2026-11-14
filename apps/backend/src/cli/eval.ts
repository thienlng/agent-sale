/* eslint-disable no-console -- CLI entrypoint */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { parseModelOverride, type ModelOverride } from '../modules/ai/evals/model-override.js';
import { loadCases } from '../modules/ai/evals/load.js';
import {
  buildReport,
  mergeRepeats,
  renderMarkdown,
  renderText,
} from '../modules/ai/evals/report.js';
import type { SalesPromptVersion } from '../modules/ai/application/playground.service.js';
import {
  type CaseResult,
  runCase,
  runCaseFake,
  type RunOptions,
} from '../modules/ai/evals/runner.js';
import { liveRuntime } from './eval-live.js';

/**
 * `pnpm --filter @agent-sales/backend eval [--live] [--model m[@effort]] [--repeat n] [--group g] [--id x]
 *   [--prompt-version n] [--out dir]`
 *
 * T-145: runs the cases in `apps/backend/evals/` through the production reply pipeline
 * (`PlaygroundService`, the default prompt) and checks the outcome. Fake mode (default)
 * replays each case's `fake_turns` (scripted model turns) and needs no network. `--live` uses the LLM
 * configured in the database (DATABASE_SYSTEM_URL; the tier of each case's bot, `smart` by
 * default) and never falls back to the development fake. Writes report.json and report.md to
 * `--out` (default: a new temp directory). Exit code 1 when a critical case fails.
 * `--prompt-version n` forces `sales-agent@n` for every case (default: the industry's prompt,
 * `PROMPT_BY_INDUSTRY`), e.g. to compare saas on `@15` and `@19`.
 * `--model` (with `--live`) points every tier at one model of the configured provider, with no
 * fallback, to compare models without touching the admin configuration. `--repeat n` runs each case
 * n times: a case passes only when every run passed; mixed cases are listed as flaky. The report
 * also gives latency (P50/P95), model calls and tokens. See docs/qa/model-selection/README.md.
 * Fixtures are synthetic; nothing but the case text and the reply is written.
 */
const { values } = parseArgs({
  options: {
    live: { type: 'boolean', default: false },
    group: { type: 'string' },
    id: { type: 'string' },
    out: { type: 'string' },
    'prompt-version': { type: 'string' },
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

const PROMPT_VERSIONS: readonly SalesPromptVersion[] = [
  13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
];
const forced = values['prompt-version'];
const opts: RunOptions = {};
if (forced !== undefined) {
  const n = Number(forced);
  if (!PROMPT_VERSIONS.includes(n as SalesPromptVersion)) {
    console.error(`--prompt-version must be one of ${PROMPT_VERSIONS.join(', ')}`);
    process.exit(1);
  }
  opts.promptVersion = n as SalesPromptVersion;
}

const ids = values.id?.split(',').map((x) => x.trim()) ?? [];
const cases = loadCases().filter(
  (c) => (!values.group || c.group === values.group) && (!ids.length || ids.includes(c.id)),
);
if (!cases.length) {
  console.error('no eval case matches the --group / --id filter');
  process.exit(1);
}

let close: (() => Promise<void>) | undefined;
let runOne: typeof runCaseFake;
if (values.live) {
  const live = liveRuntime(override);
  close = live.close;
  runOne = (c) => runCase(c, live.llm, opts);
} else {
  runOne = (c) => runCaseFake(c, opts);
}

try {
  const startedAt = new Date().toISOString();
  const runsPerCase: CaseResult[][] = [];
  // Sequential: a live run should not hammer the provider, and the report keeps file order.
  for (const c of cases) {
    const runs: CaseResult[] = [];
    for (let i = 0; i < repeat; i += 1) runs.push(await runOne(c));
    runsPerCase.push(runs);
  }
  const report = buildReport(
    values.live ? 'live' : 'fake',
    mergeRepeats(runsPerCase),
    startedAt,
    runsPerCase.flat(),
  );
  console.log(renderText(report));

  const dir = values.out ? resolve(values.out) : mkdtempSync(join(tmpdir(), 'rapiz-evals-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(dir, 'report.md'), renderMarkdown(report));
  console.log(`\nReports written to ${dir}`);
  if (report.gate === 'fail') process.exitCode = 1;
} finally {
  await close?.();
}
