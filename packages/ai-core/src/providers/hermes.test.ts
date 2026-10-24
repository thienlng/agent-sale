import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { HermesProvider } from './hermes.js';

const request = {
  workspaceId: workspaceId('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10'),
  tier: 'smart' as const,
  messages: [{ role: 'user' as const, content: 'hello' }],
  responseFormat: z.object({ reply: z.string() }),
};

describe('HermesProvider', () => {
  it('sends explicit bounded context and the bridge credential, mapping usage', async () => {
    const transport = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          version: 1,
          text: '{"reply":"hello"}',
          model: 'configured-model',
          usage: { inputTokens: 12, outputTokens: 4, cachedInputTokens: 0 },
        }),
      ),
    );
    const provider = new HermesProvider({
      baseURL: 'http://127.0.0.1:8788',
      apiKey: 'private-bridge-key',
      fetch: transport,
    });
    const result = await provider.generate(request, { model: 'configured-model', effort: 'low' });
    expect(result).toMatchObject({
      provider: 'hermes',
      model: 'configured-model',
      stopReason: 'end',
      usage: { inputTokens: 12 },
    });
    expect(transport.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8788/v1/generate');
    const init = transport.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({ Authorization: 'Bearer private-bridge-key' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      version: 1,
      workspaceId: request.workspaceId,
      messages: request.messages,
      model: 'configured-model',
      responseSchema: { type: 'object' },
    });
  });

  it('does not expose provider response bodies or credentials on bridge failures', async () => {
    const provider = new HermesProvider({
      baseURL: 'http://127.0.0.1:8788',
      apiKey: 'secret',
      fetch: async () => new Response('sensitive upstream detail', { status: 401 }),
    });
    await expect(provider.generate(request, { model: 'm' })).rejects.toThrow(
      'Hermes bridge unavailable (401)',
    );
  });

  it('rejects malformed responses and arbitrary tool execution before returning a reply', async () => {
    const transport = vi.fn().mockResolvedValue(new Response('{"text":"hi"}'));
    const provider = new HermesProvider({
      baseURL: 'http://127.0.0.1:8788',
      apiKey: 'secret',
      fetch: transport,
    });
    await expect(provider.generate(request, { model: 'm' })).rejects.toThrow(
      'Invalid Hermes bridge response',
    );
    await expect(
      provider.generate(
        { ...request, tools: [{ name: 'shell', description: 'bad', input: z.object({}) }] },
        { model: 'm' },
      ),
    ).rejects.toThrow('Hermes bridge tools are not enabled');
  });

  it('requires a private bridge credential and disallows URL credentials', () => {
    expect(() => new HermesProvider({ baseURL: 'http://127.0.0.1:8788' })).toThrow(
      'Hermes bridge key is required',
    );
    expect(
      () => new HermesProvider({ baseURL: 'http://user:pass@localhost:8788', apiKey: 's' }),
    ).toThrow('Invalid Hermes bridge URL');
  });
});
