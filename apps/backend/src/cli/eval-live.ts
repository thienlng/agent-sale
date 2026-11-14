/* eslint-disable no-console -- CLI helper */
import { createDb } from '@agent-sales/db';

import { SecretBox } from '../common/security/secret-box.js';
import { LlmRuntime } from '../modules/ai/application/llm-runtime.js';
import {
  type ModelOverride,
  ModelOverrideConfigRepository,
} from '../modules/ai/evals/model-override.js';
import { SdkLlmProviderFactory } from '../modules/ai/infrastructure/llm/sdk-provider-factory.js';
import { DrizzleLlmConfigRepository } from '../modules/ai/infrastructure/persistence/llm-config.drizzle-repository.js';

/**
 * The LLM of a `--live` eval: the providers and tier routes of the database (DATABASE_SYSTEM_URL),
 * optionally forced onto one model. Production mode: a tier without a route fails instead of
 * silently answering with the development fake. Exits the process when the database URL is missing.
 */
export function liveRuntime(override?: ModelOverride): {
  llm: LlmRuntime;
  close: () => Promise<void>;
} {
  const url = process.env['DATABASE_SYSTEM_URL'];
  if (!url) {
    console.error('--live needs DATABASE_SYSTEM_URL (the LLM providers live in the database)');
    process.exit(1);
  }
  const { db, close } = createDb({ url, max: 1 });
  const key = process.env['SECRETS_ENCRYPTION_KEY'];
  if (!key)
    console.warn('warning: SECRETS_ENCRYPTION_KEY is not set; using the insecure development key');
  const secrets = key ? SecretBox.fromBase64(key) : SecretBox.insecureDevelopmentBox();
  const stored = new DrizzleLlmConfigRepository(db);
  const config = override ? new ModelOverrideConfigRepository(stored, override) : stored;
  return { llm: new LlmRuntime(config, new SdkLlmProviderFactory(secrets, true)), close };
}
