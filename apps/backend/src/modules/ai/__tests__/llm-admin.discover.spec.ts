import { FakeLlmProvider, type LlmProvider } from '@agent-sales/ai-core';
import { newId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { SecretBox } from '../../../common/security/secret-box.js';
import { LlmAdminService } from '../application/llm-admin.service.js';
import { LlmRuntime } from '../application/llm-runtime.js';
import type { LlmProviderFactory } from '../application/ports/llm-provider-factory.js';
import { DEFAULT_PROVIDER_OPTIONS, type LlmProviderConfig } from '../domain/llm-config.js';
import { InMemoryLlmConfigRepository } from '../infrastructure/persistence/llm-config.in-memory-repository.js';

const secrets = SecretBox.insecureDevelopmentBox();

/** Records the config the factory was asked to build and returns the given provider. */
function setup(provider: LlmProvider) {
  const created: LlmProviderConfig[] = [];
  const factory: LlmProviderFactory = {
    create: (config) => {
      created.push(config);
      return provider;
    },
    developmentFallback: () => null,
    hermesLogin: () => {
      throw new Error('not used in these tests');
    },
    listModels: () => Promise.reject(new Error('not used in these tests')),
  };
  const config = new InMemoryLlmConfigRepository();
  const runtime = new LlmRuntime(config, factory);
  return { admin: new LlmAdminService(config, factory, secrets, runtime, true), config, created };
}

function listing(models: string[] | Error): LlmProvider {
  return Object.assign(new FakeLlmProvider('p', () => ({ text: '' })), {
    listModels: async () => {
      if (models instanceof Error) throw models;
      return models;
    },
  });
}

async function storedProvider(config: InMemoryLlmConfigRepository, baseUrl: string) {
  const now = new Date();
  const stored: LlmProviderConfig = {
    id: newId(),
    name: 'selfhost',
    kind: 'openai_compatible',
    baseUrl,
    apiKeyCipher: secrets.seal('stored-key'),
    apiKeyHint: '-key',
    options: DEFAULT_PROVIDER_OPTIONS,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
  };
  await config.saveProvider(stored);
  return stored;
}

describe('LlmAdminService.discoverModels', () => {
  it('lists models for settings that are not saved yet', async () => {
    const { admin, created } = setup(listing(['a', 'b']));
    const res = await admin.discoverModels({
      kind: 'openai_compatible',
      baseUrl: 'http://vllm:8000/v1',
      apiKey: 'draft-key',
    });
    expect(res).toMatchObject({ ok: true, models: ['a', 'b'], error: null });
    expect(secrets.open(created[0]?.apiKeyCipher ?? '')).toBe('draft-key');
  });

  it('reports a failure instead of throwing', async () => {
    const { admin } = setup(listing(new Error('401 Incorrect API key')));
    const res = await admin.discoverModels({ kind: 'anthropic', apiKey: 'bad' });
    expect(res).toMatchObject({ ok: false, models: [], error: '401 Incorrect API key' });
  });

  it('reuses the stored key while the host is unchanged', async () => {
    const { admin, config, created } = setup(listing([]));
    const stored = await storedProvider(config, 'http://vllm:8000/v1');
    await admin.discoverModels({ providerId: stored.id });
    expect(secrets.open(created[0]?.apiKeyCipher ?? '')).toBe('stored-key');
  });

  it('never sends the stored key to a different host', async () => {
    const { admin, config, created } = setup(listing([]));
    const stored = await storedProvider(config, 'http://vllm:8000/v1');
    await admin.discoverModels({ providerId: stored.id, baseUrl: 'http://evil.example/v1' });
    expect(created[0]?.apiKeyCipher).toBeNull();
  });

  it('says so when the server type cannot list models', async () => {
    const { admin } = setup(new FakeLlmProvider('hermes', () => ({ text: '' })));
    const res = await admin.discoverModels({ kind: 'hermes', baseUrl: 'http://127.0.0.1:8788' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/cannot list/);
  });
});
