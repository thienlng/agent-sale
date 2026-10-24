import { HermesLoginClient } from '@agent-sales/ai-core';
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

async function setup(transport: typeof fetch) {
  const secrets = SecretBox.insecureDevelopmentBox();
  const config = new InMemoryLlmConfigRepository();
  const real = new SdkLlmProviderFactory(secrets, false);
  const factory: LlmProviderFactory = {
    create: (c) => real.create(c),
    developmentFallback: () => null,
    hermesLogin: (c) => {
      const inner = real.hermesLogin(c);
      expect(inner).toBeInstanceOf(HermesLoginClient);
      // Same decrypted key and URL, injected transport.
      return new HermesLoginClient({ baseURL: c.baseUrl ?? '', apiKey: KEY, fetch: transport });
    },
  };
  const svc = new LlmAdminService(config, factory, secrets, new LlmRuntime(config, factory));
  const hermes = await svc.createProvider({
    name: 'hermes',
    kind: 'hermes',
    baseUrl: 'http://127.0.0.1:8788',
    apiKey: KEY,
  });
  const other = await svc.createProvider({ name: 'claude', kind: 'anthropic', apiKey: 'sk-x' });
  return { svc, hermes, other };
}

describe('LlmAdminService.hermesLogin', () => {
  it('passes the bridge status through and calls the right endpoint', async () => {
    const transport = vi.fn().mockResolvedValue(
      json({
        state: 'pending',
        verificationUrl: 'https://auth.openai.com/codex/device',
        userCode: 'ABCD-1234',
        expiresAt: '2026-10-24T10:00:00Z',
      }),
    );
    const { svc, hermes } = await setup(transport);
    const res = await svc.hermesLogin(hermes.id, 'start');
    expect(res).toMatchObject({ state: 'pending', userCode: 'ABCD-1234' });
    expect(transport.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8788/v1/auth/start');
  });

  it('rejects providers that are not Hermes and unknown ids', async () => {
    const { svc, other } = await setup(vi.fn());
    await expect(svc.hermesLogin(other.id, 'status')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(svc.hermesLogin('not-a-uuid', 'status')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('reports an unreachable bridge as a status', async () => {
    const { svc, hermes } = await setup(vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await svc.hermesLogin(hermes.id, 'status')).toEqual({ state: 'unreachable' });
  });

  it('maps bridge failures to API error codes', async () => {
    const limited = await setup(vi.fn().mockResolvedValue(json({ error: 'slow down' }, 429)));
    await expect(limited.svc.hermesLogin(limited.hermes.id, 'start')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    const down = await setup(vi.fn().mockResolvedValue(json({ error: 'x' }, 503)));
    await expect(down.svc.hermesLogin(down.hermes.id, 'start')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    const denied = await setup(vi.fn().mockResolvedValue(json({}, 401)));
    expect(await denied.svc.hermesLogin(denied.hermes.id, 'status')).toEqual({
      state: 'failed',
      code: 'bridge_key_rejected',
    });
  });
});
