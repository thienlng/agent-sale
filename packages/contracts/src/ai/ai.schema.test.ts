import { describe, expect, it } from 'vitest';

import { PlaygroundResponse } from './ai.schema.js';

const base = {
  runId: '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f',
  reply: 'Hi',
  outcome: 'answered',
  guardrail: null,
  sources: [],
  usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
  provider: 'fake',
  model: 'fake',
  latencyMs: 5,
};

describe('PlaygroundResponse harness v2 fields', () => {
  it('accepts messages, steps and interrupted', () => {
    const parsed = PlaygroundResponse.parse({
      ...base,
      messages: [
        {
          text: 'Hi',
          images: [{ id: 'i1', url: 'https://x.test/a.jpg', label: 'A' }],
          via: 'send_message',
        },
        { text: 'Bye', images: [], via: 'final' },
      ],
      steps: [{ kind: 'tool', name: 'search', ok: true, ms: 12 }, { kind: 'model' }],
      interrupted: true,
    });
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.interrupted).toBe(true);
  });

  it('still accepts a response without them', () => {
    const parsed = PlaygroundResponse.parse(base);
    expect(parsed.messages).toBeUndefined();
    expect(parsed.steps).toBeUndefined();
  });
});
