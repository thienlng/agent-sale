/* eslint-disable no-console -- CLI entrypoint */
import { parseArgs } from 'node:util';

import { createDb } from '@agent-sales/db';

import { SecretBox } from '../common/security/secret-box.js';
import { LlmRuntime } from '../modules/ai/application/llm-runtime.js';
import { SdkLlmProviderFactory } from '../modules/ai/infrastructure/llm/sdk-provider-factory.js';
import { DrizzleLlmConfigRepository } from '../modules/ai/infrastructure/persistence/llm-config.drizzle-repository.js';
import type { LlmGatewayPort } from '../modules/ai/api/index.js';
import {
  fakeAssistantModel,
  loadAssistantCases,
  runAssistantCase,
} from '../modules/assistant/evals/assistant-eval.js';

/**
 * `pnpm --filter @agent-sales/backend eval:assistant [--live] [--id x]`
 *
 * T-172: runs the owner assistant cases in `apps/backend/evals/assistant/` through the real chat
 * turn on in-memory stores and checks the proposal each one leaves. Fake mode (default) replays
 * the case's `fake_turns`; `--live` uses the LLM configured in the database
 * (DATABASE_SYSTEM_URL). Exit code 1 when a critical case fails.
 */
const { values } = parseArgs({
  options: {
    live: { type: 'boolean', default: false },
    id: { type: 'string' },
  },
});

const cases = loadAssistantCases().filter((c) => !values.id || c.id === values.id);
if (!cases.length) {
  console.error('no assistant eval case matches --id');
  process.exit(1);
}

let close: (() => Promise<void>) | undefined;
let live: LlmGatewayPort | undefined;
if (values.live) {
  const url = process.env['DATABASE_SYSTEM_URL'];
  if (!url) {
    console.error('--live needs DATABASE_SYSTEM_URL (the LLM providers live in the database)');
    process.exit(1);
  }
  const { db, close: closeDb } = createDb({ url, max: 1 });
  close = closeDb;
  const key = process.env['SECRETS_ENCRYPTION_KEY'];
  const secrets = key ? SecretBox.fromBase64(key) : SecretBox.insecureDevelopmentBox();
  live = new LlmRuntime(
    new DrizzleLlmConfigRepository(db),
    new SdkLlmProviderFactory(secrets, true),
  );
}

try {
  let criticalFailed = false;
  for (const c of cases) {
    const result = await runAssistantCase(c, live ?? fakeAssistantModel(c));
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${c.id}${result.critical ? ' (critical)' : ''}`);
    for (const p of result.problems) console.log(`  - ${p}`);
    if (!result.ok && result.critical) criticalFailed = true;
  }
  if (criticalFailed) process.exitCode = 1;
} finally {
  await close?.();
}
