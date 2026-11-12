/* eslint-disable no-console -- CLI entrypoint */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { createDb } from '@agent-sales/db';

import { SecretBox } from '../common/security/secret-box.js';
import { LlmRuntime } from '../modules/ai/application/llm-runtime.js';
import { SdkLlmProviderFactory } from '../modules/ai/infrastructure/llm/sdk-provider-factory.js';
import { DrizzleLlmConfigRepository } from '../modules/ai/infrastructure/persistence/llm-config.drizzle-repository.js';
import { loadCases } from '../modules/ai/evals/load.js';
import { buildReport, renderMarkdown, renderText } from '../modules/ai/evals/report.js';
import type { SalesPromptVersion } from '../modules/ai/application/playground.service.js';
import { runCase, runCaseFake, type RunOptions } from '../modules/ai/evals/runner.js';

/**
 * `pnpm --filter @agent-sales/backend eval [--live] [--group g] [--id x] [--prompt-version n] [--out dir]`
 *
 * T-145: runs the cases in `apps/backend/evals/` through the production reply pipeline
 * (`PlaygroundService`, the default prompt) and checks the outcome. Fake mode (default)
 * replays each case's `fake_turns` (scripted model turns) and needs no network. `--live` uses the LLM
 * configured in the database (DATABASE_SYSTEM_URL; the tier of each case's bot, `smart` by
 * default) and never falls back to the development fake. Writes report.json and report.md to
 * `--out` (default: a new temp directory). Exit code 1 when a critical case fails.
 * `--prompt-version n` forces `sales-agent@n` for every case (default: the industry's prompt,
 * `PROMPT_BY_INDUSTRY`), e.g. to compare saas on `@15` and `@19`.
 * Fixtures are synthetic; nothing but the case text and the reply is written.
 */
const { values } = parseArgs({
  options: {
    live: { type: 'boolean', default: false },
    group: { type: 'string' },
    id: { type: 'string' },
    out: { type: 'string' },
    'prompt-version': { type: 'string' },
  },
});

const PROMPT_VERSIONS: readonly SalesPromptVersion[] = [
  13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
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

const cases = loadCases().filter(
  (c) => (!values.group || c.group === values.group) && (!values.id || c.id === values.id),
);
if (!cases.length) {
  console.error('no eval case matches the --group / --id filter');
  process.exit(1);
}

let close: (() => Promise<void>) | undefined;
let runOne: typeof runCaseFake;
if (values.live) {
  const url = process.env['DATABASE_SYSTEM_URL'];
  if (!url) {
    console.error('--live needs DATABASE_SYSTEM_URL (the LLM providers live in the database)');
    process.exit(1);
  }
  const { db, close: closeDb } = createDb({ url, max: 1 });
  close = closeDb;
  const key = process.env['SECRETS_ENCRYPTION_KEY'];
  if (!key)
    console.warn('warning: SECRETS_ENCRYPTION_KEY is not set; using the insecure development key');
  const secrets = key ? SecretBox.fromBase64(key) : SecretBox.insecureDevelopmentBox();
  // production = true: a tier without a route fails instead of silently answering with the dev fake.
  const llm = new LlmRuntime(
    new DrizzleLlmConfigRepository(db),
    new SdkLlmProviderFactory(secrets, true),
  );
  runOne = (c) => runCase(c, llm, opts);
} else {
  runOne = (c) => runCaseFake(c, opts);
}

try {
  const startedAt = new Date().toISOString();
  const results = [];
  // Sequential: a live run should not hammer the provider, and the report keeps file order.
  for (const c of cases) results.push(await runOne(c));
  const report = buildReport(values.live ? 'live' : 'fake', results, startedAt);
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
