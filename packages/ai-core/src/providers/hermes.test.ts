import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { INVALID_JSON_INPUT_KEY } from '../gateway.js';
import {
  HERMES_MIN_TIMEOUT_MS,
  HermesAutoToolsProvider,
  HermesProvider,
  probeHermesNativeTools,
} from './hermes.js';

const plain = {
  workspaceId: workspaceId('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10'),
  tier: 'smart' as const,
  messages: [{ role: 'user' as const, content: 'hello' }],
};
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

  it('never times out before the bridge run budget, even with a shorter configured timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const ok = new Response(
      JSON.stringify({
        version: 1,
        text: 'ok',
        model: 'm',
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
      }),
    );
    const provider = new HermesProvider({
      baseURL: 'http://127.0.0.1:8788',
      apiKey: 'k',
      timeoutMs: 20_000,
      fetch: async () => ok,
    });
    await provider.generate(request, { model: 'm' });
    expect(timeout).toHaveBeenCalledWith(HERMES_MIN_TIMEOUT_MS);
    timeout.mockRestore();
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

  it('rejects malformed responses before returning a reply', async () => {
    const transport = vi.fn().mockResolvedValue(new Response('{"text":"hi"}'));
    const provider = new HermesProvider({
      baseURL: 'http://127.0.0.1:8788',
      apiKey: 'secret',
      fetch: transport,
    });
    await expect(provider.generate(request, { model: 'm' })).rejects.toThrow(
      'Invalid Hermes bridge response',
    );
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

describe('HermesProvider images', () => {
  const ok = () =>
    new Response(
      JSON.stringify({
        version: 1,
        text: 'ok',
        model: 'm',
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
      }),
    );
  const png = { mimeType: 'image/png' as const, base64: 'iVBORw0KGgo=' };

  it('serializes images and omits the field without them', async () => {
    const transport = vi.fn().mockImplementation(async () => ok());
    const provider = new HermesProvider({
      baseURL: 'http://127.0.0.1:8788',
      apiKey: 'private-bridge-key',
      fetch: transport,
    });
    await provider.generate({ ...request, images: [png] }, { model: 'm' });
    await provider.generate(request, { model: 'm' });
    const withImages = JSON.parse(String((transport.mock.calls[0]?.[1] as RequestInit).body));
    const without = JSON.parse(String((transport.mock.calls[1]?.[1] as RequestInit).body));
    expect(withImages.images).toEqual([png]);
    expect(without).not.toHaveProperty('images');
  });

  it('keeps the text cap but allows image bytes beyond it', async () => {
    const transport = vi.fn().mockImplementation(async () => ok());
    const provider = new HermesProvider({
      baseURL: 'http://127.0.0.1:8788',
      apiKey: 'private-bridge-key',
      fetch: transport,
    });
    const big = { mimeType: 'image/png' as const, base64: 'A'.repeat(1_000_000) };
    await expect(
      provider.generate({ ...request, images: [big] }, { model: 'm' }),
    ).resolves.toMatchObject({ text: 'ok' });
    const longText = {
      ...request,
      messages: [{ role: 'user' as const, content: 'x'.repeat(260_000) }],
    };
    await expect(provider.generate({ ...longText, images: [big] }, { model: 'm' })).rejects.toThrow(
      'exceeds bridge limit',
    );
    await expect(provider.generate(longText, { model: 'm' })).rejects.toThrow(
      'exceeds bridge limit',
    );
  });
});

describe('HermesProvider native tools', () => {
  const tool = {
    name: 'get_time',
    description: 'Current time',
    input: z.object({ tz: z.string() }),
  };
  const reply = (extra: Record<string, unknown> = {}) =>
    new Response(
      JSON.stringify({
        version: 1,
        text: '',
        toolCalls: [],
        stopReason: 'end',
        model: 'm',
        usage: { inputTokens: 3, outputTokens: 2, cachedInputTokens: 1 },
        ...extra,
      }),
    );
  const make = (fetchImpl: typeof fetch) =>
    new HermesProvider({ baseURL: 'http://127.0.0.1:8788', apiKey: 'k', fetch: fetchImpl });
  const bodyOf = (transport: ReturnType<typeof vi.fn>, call = 0) =>
    JSON.parse(String((transport.mock.calls[call]?.[1] as RequestInit).body));

  it('forwards tools, toolChoice and the cache key as bridge contract v2', async () => {
    const transport = vi.fn().mockImplementation(async () => reply({ text: 'hi' }));
    await make(transport).generate(
      {
        ...plain,
        tools: [tool],
        toolChoice: 'none',
        promptCacheKey: 'bot:conv',
      },
      { model: 'm' },
    );
    const body = bodyOf(transport);
    expect(body.tools).toEqual([
      {
        name: 'get_time',
        description: 'Current time',
        parameters: expect.objectContaining({
          type: 'object',
          properties: { tz: { type: 'string' } },
        }),
      },
    ]);
    expect(body.toolChoice).toBe('none');
    expect(body.promptCacheKey).toBe('bot:conv');
  });

  it('omits the v2 fields when the request has none', async () => {
    const transport = vi.fn().mockImplementation(async () => reply({ text: 'hi' }));
    await make(transport).generate(request, { model: 'm' });
    const body = bodyOf(transport);
    for (const key of ['tools', 'toolChoice', 'promptCacheKey'])
      expect(body).not.toHaveProperty(key);
  });

  it('parses native tool calls with JSON arguments and reports tool_use', async () => {
    const transport = vi.fn().mockResolvedValue(
      reply({
        stopReason: 'tool_use',
        toolCalls: [
          { id: 'call_1', name: 'get_time', arguments: '{"tz":"UTC"}' },
          { id: 'call_2', name: 'get_time', arguments: '{not json' },
        ],
      }),
    );
    const result = await make(transport).generate({ ...request, tools: [tool] }, { model: 'm' });
    expect(result.stopReason).toBe('tool_use');
    expect(result.text).toBe('');
    expect(result.toolCalls).toEqual([
      { id: 'call_1', name: 'get_time', input: { tz: 'UTC' } },
      { id: 'call_2', name: 'get_time', input: { [INVALID_JSON_INPUT_KEY]: true } },
    ]);
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 2, cachedInputTokens: 1 });
  });

  it('rejects an empty reply that carries no tool call', async () => {
    const transport = vi.fn().mockResolvedValue(reply());
    await expect(make(transport).generate(request, { model: 'm' })).rejects.toThrow(
      'Invalid Hermes bridge response',
    );
  });

  it('serializes assistant tool calls and tool results into the history', async () => {
    const transport = vi.fn().mockImplementation(async () => reply({ text: 'done' }));
    await make(transport).generate(
      {
        ...plain,
        tools: [tool],
        messages: [
          { role: 'user', content: 'time?' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'call_1', name: 'get_time', input: { tz: 'UTC' } }],
          },
          { role: 'tool', content: '12:00', toolCallId: 'call_1', name: 'get_time' },
        ],
      },
      { model: 'm' },
    );
    expect(bodyOf(transport).messages).toEqual([
      { role: 'user', content: 'time?' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'get_time', arguments: '{"tz":"UTC"}' }],
      },
      { role: 'tool', content: '12:00', toolCallId: 'call_1', name: 'get_time' },
    ]);
  });

  it('uses the per-call timeout when given, else the bridge floor', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const transport = vi.fn().mockImplementation(async () => reply({ text: 'hi' }));
    const provider = make(transport);
    await provider.generate({ ...request, timeoutMs: 25_000 }, { model: 'm' });
    expect(timeout).toHaveBeenLastCalledWith(25_000);
    await provider.generate(request, { model: 'm' });
    expect(timeout).toHaveBeenLastCalledWith(HERMES_MIN_TIMEOUT_MS);
    timeout.mockRestore();
  });

  it('aborts the fetch when the caller signal fires', async () => {
    const controller = new AbortController();
    const hanging = vi.fn().mockImplementation(
      (_url: unknown, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const pending = make(hanging).generate(
      { ...request, signal: controller.signal },
      { model: 'm' },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('classifies bridge failures', async () => {
    const status = (code: number, headers: Record<string, string> = {}) =>
      make(async () => new Response('x', { status: code, headers })).generate(request, {
        model: 'm',
      });
    await expect(status(429)).rejects.toMatchObject({ kind: 'rate_limit' });
    await expect(status(401)).rejects.toMatchObject({ kind: 'auth' });
    await expect(status(503)).rejects.toMatchObject({ kind: 'overloaded' });
    await expect(status(400)).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(status(502)).rejects.toMatchObject({ kind: 'unknown', status: 502 });
  });
});

describe('probeHermesNativeTools', () => {
  const probe = (fetchImpl: typeof fetch) =>
    probeHermesNativeTools({ baseURL: 'http://127.0.0.1:8788', fetch: fetchImpl });

  it('is true only when /health says nativeTools: true', async () => {
    await expect(
      probe(async () => new Response('{"status":"up","nativeTools":true}')),
    ).resolves.toBe(true);
    await expect(
      probe(async () => new Response('{"status":"up","nativeTools":false}')),
    ).resolves.toBe(false);
    await expect(probe(async () => new Response('{"status":"up"}'))).resolves.toBe(false);
  });

  it('assumes emulated on any failure and checks with a 2 s timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await expect(probe(async () => new Response('{}', { status: 500 }))).resolves.toBe(false);
    await expect(probe(async () => Promise.reject(new Error('down')))).resolves.toBe(false);
    await expect(probe(async () => new Response('not json'))).resolves.toBe(false);
    expect(timeout).toHaveBeenCalledWith(2_000);
    timeout.mockRestore();
  });
});

describe('HermesAutoToolsProvider', () => {
  const tool = { name: 'get_time', description: 'Time', input: z.object({}) };
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  const bridge = (health: unknown) =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/health')) return new Response(JSON.stringify(health));
      sent.push({ url: target, body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({
          version: 1,
          text: '{"tool_calls":[{"name":"get_time","arguments":{}}]}',
          model: 'm',
          usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
        }),
      );
    }) as typeof fetch;
  const run = (health: unknown) =>
    new HermesAutoToolsProvider({
      baseURL: 'http://127.0.0.1:8788',
      apiKey: 'k',
      fetch: bridge(health),
    }).generate({ ...plain, tools: [tool] }, { model: 'm' });

  it('passes tools natively when the bridge says nativeTools: true', async () => {
    sent.length = 0;
    await run({ status: 'up', nativeTools: true });
    expect(sent[0]?.body.tools).toHaveLength(1);
  });

  it('emulates tools in text when the bridge is old or unreachable', async () => {
    for (const health of [{ status: 'up' }, { status: 'up', nativeTools: false }]) {
      sent.length = 0;
      const result = await run(health);
      expect(sent[0]?.body).not.toHaveProperty('tools');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.stopReason).toBe('tool_use');
    }
  });

  it('probes /health once', async () => {
    let probes = 0;
    const counting = (async (url: string | URL | Request) => {
      if (String(url).endsWith('/health')) {
        probes += 1;
        return new Response('{"nativeTools":true}');
      }
      return new Response(
        JSON.stringify({
          version: 1,
          text: 'hi',
          model: 'm',
          usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
        }),
      );
    }) as typeof fetch;
    const provider = new HermesAutoToolsProvider({
      baseURL: 'http://127.0.0.1:8788',
      apiKey: 'k',
      fetch: counting,
    });
    await provider.generate(request, { model: 'm' });
    await provider.generate(request, { model: 'm' });
    expect(probes).toBe(1);
  });
});
