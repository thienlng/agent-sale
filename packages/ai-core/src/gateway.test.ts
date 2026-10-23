import { workspaceId } from '@agent-sales/shared';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { LlmGateway, type GenerateRequest } from './gateway.js';
import { PromptRegistry } from './prompts.js';
import { FakeLlmProvider } from './providers/fake.js';

const ws = workspaceId('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10');
const req: GenerateRequest = {
  workspaceId: ws,
  tier: 'smart',
  messages: [{ role: 'user', content: 'hi' }],
};

describe('LlmGateway', () => {
  it('routes a tier to its provider/model and records usage', async () => {
    const primary = new FakeLlmProvider('primary', () => ({ text: 'hello' }));
    const recorded: string[] = [];
    const gw = new LlmGateway([primary], tiers('primary'), {
      record: async (_r, res) => {
        recorded.push(`${res.provider}/${res.model}`);
      },
    });
    const res = await gw.generate(req);
    expect(res.text).toBe('hello');
    expect(recorded).toEqual(['primary/model-a']);
  });

  it('falls back to the secondary provider when the primary fails', async () => {
    const primary = new FakeLlmProvider('primary', () => new Error('rate limited'));
    const backup = new FakeLlmProvider('backup', () => ({ text: 'from backup' }));
    const gw = new LlmGateway([primary, backup], tiers('primary', 'backup'));
    const res = await gw.generate(req);
    expect(res.provider).toBe('backup');
  });

  it('runs the admission hook before calling any provider', async () => {
    const primary = new FakeLlmProvider('primary');
    const gw = new LlmGateway([primary], tiers('primary'), {
      admit: async () => {
        throw new Error('over budget');
      },
    });
    await expect(gw.generate(req)).rejects.toThrow('over budget');
    expect(primary.calls).toHaveLength(0);
  });
});

describe('PromptRegistry', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts');

  it('loads a pinned version and renders placeholders', async () => {
    const reg = new PromptRegistry(dir);
    const tpl = await reg.load({ name: 'sales-agent', version: 1 });
    const out = reg.render(tpl, {
      'workspace.name': 'Shop ABC',
      'bot.customerPronoun': 'anh/chị',
      'bot.selfPronoun': 'em',
      'bot.mission': 'Sell shoes',
    });
    expect(out).toContain('Shop ABC');
    expect(out).not.toContain('{{');
  });

  it('refuses to render with a missing placeholder', () => {
    const reg = new PromptRegistry(dir);
    expect(() => reg.render('Hi {{name}}', {})).toThrow('name');
  });
});

function tiers(provider: string, fallbackProvider?: string) {
  const p = {
    provider,
    model: 'model-a',
    ...(fallbackProvider ? { fallback: { provider: fallbackProvider, model: 'model-b' } } : {}),
  };
  return { basic: p, smart: p, pro: p, neo: p };
}
