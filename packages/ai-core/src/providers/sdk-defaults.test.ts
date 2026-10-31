import { beforeEach, describe, expect, it, vi } from 'vitest';

const ctor = vi.hoisted(() => ({ openai: [] as unknown[], anthropic: [] as unknown[] }));

vi.mock('openai', () => ({
  default: class {
    constructor(options: unknown) {
      ctor.openai.push(options);
    }
  },
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor(options: unknown) {
      ctor.anthropic.push(options);
    }
  },
}));
vi.mock('@anthropic-ai/sdk/helpers/zod', () => ({ zodOutputFormat: () => ({}) }));

import { AnthropicProvider } from './anthropic.js';
import { OpenAiCompatibleProvider } from './openai-compatible.js';

describe('SDK client defaults', () => {
  beforeEach(() => {
    ctor.openai.length = 0;
    ctor.anthropic.length = 0;
  });

  it('disables SDK-level retries so the gateway owns them', () => {
    new OpenAiCompatibleProvider({ baseURL: 'http://x' });
    new AnthropicProvider({ apiKey: 'k' });
    expect(ctor.openai[0]).toMatchObject({ maxRetries: 0 });
    expect(ctor.anthropic[0]).toMatchObject({ maxRetries: 0 });
  });

  it('keeps maxRetries as an explicit opt-in', () => {
    new OpenAiCompatibleProvider({ baseURL: 'http://x', maxRetries: 2 });
    new AnthropicProvider({ apiKey: 'k', maxRetries: 2 });
    expect(ctor.openai[0]).toMatchObject({ maxRetries: 2 });
    expect(ctor.anthropic[0]).toMatchObject({ maxRetries: 2 });
  });
});
