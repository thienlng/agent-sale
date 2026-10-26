import { describe, expect, it, vi } from 'vitest';

import { listProviderModels } from './model-list.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('listProviderModels', () => {
  it('lists Hermes bridge models with the bearer key and no redirects', async () => {
    const f = vi.fn().mockResolvedValue(json({ version: 1, models: [{ id: 'a' }, { id: 'b' }] }));
    const res = await listProviderModels({
      kind: 'hermes',
      baseURL: 'http://127.0.0.1:8788/',
      apiKey: 'bridge-key',
      fetch: f,
    });
    expect(res).toEqual({ state: 'ok', models: [{ id: 'a' }, { id: 'b' }] });
    expect(f.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8788/v1/models');
    expect(f.mock.calls[0]?.[1]).toMatchObject({
      redirect: 'error',
      headers: { Authorization: 'Bearer bridge-key' },
    });
  });

  it('maps MODEL_AUTH_REQUIRED to auth_required and other failures to unavailable', async () => {
    const base = { kind: 'hermes' as const, baseURL: 'http://x', apiKey: 'k' };
    expect(
      await listProviderModels({
        ...base,
        fetch: vi.fn().mockResolvedValue(json({ error: 'MODEL_AUTH_REQUIRED' }, 503)),
      }),
    ).toEqual({ state: 'auth_required', models: [] });
    for (const f of [
      vi.fn().mockResolvedValue(json({ error: 'x' }, 502)),
      vi.fn().mockResolvedValue(json({ error: 'OTHER' }, 503)),
      vi.fn().mockResolvedValue(json({ nope: 1 })),
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED http://secret')),
    ])
      expect(await listProviderModels({ ...base, fetch: f })).toEqual({
        state: 'unavailable',
        models: [],
      });
  });

  it('reads the OpenAI shape from {baseUrl}/models, deduplicates and caps at 30', async () => {
    const data = Array.from({ length: 50 }, (_, i) => ({ id: `m${i % 40}` }));
    const f = vi.fn().mockResolvedValue(json({ object: 'list', data }));
    const res = await listProviderModels({
      kind: 'openai_compatible',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-1',
      fetch: f,
    });
    expect(res.state).toBe('ok');
    expect(res.models).toHaveLength(30);
    expect(res.models[0]).toEqual({ id: 'm0' });
    expect(f.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/models');
  });

  it('allows keyless OpenAI-compatible servers but not keyless Anthropic/Hermes', async () => {
    const f = vi.fn().mockResolvedValue(json({ data: [{ id: 'q' }] }));
    expect(
      (
        await listProviderModels({
          kind: 'openai_compatible',
          baseURL: 'http://v:8000/v1',
          fetch: f,
        })
      ).state,
    ).toBe('ok');
    expect((await listProviderModels({ kind: 'anthropic', fetch: f })).state).toBe('unavailable');
    expect(
      (await listProviderModels({ kind: 'hermes', baseURL: 'http://x', fetch: f })).state,
    ).toBe('unavailable');
  });

  it('lists Anthropic models with x-api-key', async () => {
    const f = vi.fn().mockResolvedValue(json({ data: [{ id: 'claude-x' }] }));
    const res = await listProviderModels({ kind: 'anthropic', apiKey: 'sk-ant', fetch: f });
    expect(res.models).toEqual([{ id: 'claude-x' }]);
    expect(String(f.mock.calls[0]?.[0])).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/models/);
    expect(f.mock.calls[0]?.[1]).toMatchObject({ headers: { 'x-api-key': 'sk-ant' } });
  });

  it('rejects unsafe base URLs without calling fetch', async () => {
    const f = vi.fn();
    for (const baseURL of ['ftp://x', 'http://u:p@x', 'http://x?a=1', 'nope'])
      expect(
        (await listProviderModels({ kind: 'openai_compatible', baseURL, fetch: f })).state,
      ).toBe('unavailable');
    expect(f).not.toHaveBeenCalled();
  });
});
