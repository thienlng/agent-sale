import { workspaceId } from '@agent-sales/shared';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { SecretBox } from '../../../../common/security/secret-box.js';
import type { LlmProviderConfig } from '../../domain/llm-config.js';
import { SdkLlmProviderFactory } from './sdk-provider-factory.js';

const secrets = new SecretBox(randomBytes(32));
const hermes: LlmProviderConfig = {
  id: 'p1',
  name: 'hermes',
  kind: 'hermes',
  baseUrl: 'http://127.0.0.1:8788',
  apiKeyCipher: secrets.seal('bridge-key'),
  apiKeyHint: 'ey',
  options: { timeoutMs: 20_000 } as LlmProviderConfig['options'],
  isEnabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function stubBridge(health: unknown) {
  const posts: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/health')) return new Response(JSON.stringify(health));
      posts.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          version: 1,
          text: '{"tool_calls":[{"name":"get_time","arguments":{}}]}',
          model: 'm',
          usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
        }),
      );
    }),
  );
  return posts;
}

const request = {
  workspaceId: workspaceId('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10'),
  tier: 'smart' as const,
  messages: [{ role: 'user' as const, content: 'time?' }],
  tools: [{ name: 'get_time', description: 'Time', input: z.object({}) }],
};

describe('SdkLlmProviderFactory hermes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses native tools when the bridge reports nativeTools: true', async () => {
    const posts = stubBridge({ status: 'up', nativeTools: true });
    await new SdkLlmProviderFactory(secrets, false)
      .create(hermes)
      .generate(request, { model: 'm' });
    expect(posts[0]?.tools).toHaveLength(1);
  });

  it('keeps the emulation when the bridge does not report native tools', async () => {
    const posts = stubBridge({ status: 'up' });
    const result = await new SdkLlmProviderFactory(secrets, false)
      .create(hermes)
      .generate(request, { model: 'm' });
    expect(posts[0]).not.toHaveProperty('tools');
    expect(result.toolCalls).toHaveLength(1);
  });
});
