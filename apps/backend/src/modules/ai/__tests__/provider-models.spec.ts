import { describe, expect, it, vi } from 'vitest';

import { SecretBox } from '../../../common/security/secret-box.js';
import { LlmAdminService } from '../application/llm-admin.service.js';
import { LlmRuntime } from '../application/llm-runtime.js';
import type { LlmProviderFactory } from '../application/ports/llm-provider-factory.js';
import { SdkLlmProviderFactory } from '../infrastructure/llm/sdk-provider-factory.js';
import { InMemoryLlmConfigRepository } from '../infrastructure/persistence/llm-config.in-memory-repository.js';

const KEY = 'k'.repeat(40);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Runs the real factory mapping (kind, URL, decrypted key) against a stubbed global fetch. */
async function setup(response: Response | Error) {
  const secrets = SecretBox.insecureDevelopmentBox();
  const config = new InMemoryLlmConfigRepository();
  const factory: LlmProviderFactory = new SdkLlmProviderFactory(secrets, false);
  const svc = new LlmAdminService(config, factory, secrets, new LlmRuntime(config, factory), true);
  const stub = vi
    .fn()
    .mockImplementation(() =>
      response instanceof Error ? Promise.reject(response) : Promise.resolve(response.clone()),
    );
  vi.stubGlobal('fetch', stub);
  return { svc, stub };
}

describe('LlmAdminService.listModels', () => {
  it('maps the Hermes bridge list', async () => {
    const { svc, stub } = await setup(json({ version: 1, models: [{ id: 'gpt-6-sol' }] }));
    const p = await svc.createProvider({
      name: 'h',
      kind: 'hermes',
      baseUrl: 'http://127.0.0.1:8788',
      apiKey: KEY,
    });
    expect(await svc.listModels(p.id)).toEqual({ data: [{ id: 'gpt-6-sol' }], state: 'ok' });
    expect(stub.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8788/v1/models');
    expect(stub.mock.calls[0]?.[1]).toMatchObject({ headers: { Authorization: `Bearer ${KEY}` } });
    vi.unstubAllGlobals();
  });

  it('reports auth_required when the bridge is signed out', async () => {
    const { svc } = await setup(json({ error: 'MODEL_AUTH_REQUIRED' }, 503));
    const p = await svc.createProvider({
      name: 'h',
      kind: 'hermes',
      baseUrl: 'http://x:1',
      apiKey: KEY,
    });
    expect(await svc.listModels(p.id)).toEqual({ data: [], state: 'auth_required' });
    vi.unstubAllGlobals();
  });

  it('maps OpenAI-shaped lists and caps at 30', async () => {
    const data = Array.from({ length: 80 }, (_, i) => ({ id: `m${i}` }));
    const { svc, stub } = await setup(json({ data }));
    const p = await svc.createProvider({
      name: 'o',
      kind: 'openai_compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-1',
    });
    const res = await svc.listModels(p.id);
    expect(res.state).toBe('ok');
    expect(res.data).toHaveLength(30);
    expect(stub.mock.calls[0]?.[0]).toBe('https://api.example.com/v1/models');
    vi.unstubAllGlobals();
  });

  it('degrades to unavailable on errors and for an Anthropic provider without a key', async () => {
    const { svc } = await setup(new Error('ECONNREFUSED'));
    const o = await svc.createProvider({
      name: 'o',
      kind: 'openai_compatible',
      baseUrl: 'http://x:1/v1',
    });
    expect(await svc.listModels(o.id)).toEqual({ data: [], state: 'unavailable' });
    const a = await svc.createProvider({ name: 'a', kind: 'anthropic' });
    expect(await svc.listModels(a.id)).toEqual({ data: [], state: 'unavailable' });
    vi.unstubAllGlobals();
  });

  it('404s for unknown providers', async () => {
    const { svc } = await setup(json({}));
    await expect(svc.listModels('not-a-uuid')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    vi.unstubAllGlobals();
  });
});
