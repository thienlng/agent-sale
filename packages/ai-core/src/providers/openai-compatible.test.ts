import { workspaceId } from '@agent-sales/shared';
import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { GenerateRequest } from '../gateway.js';
import { OpenAiCompatibleProvider } from './openai-compatible.js';

const ws = workspaceId('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10');

function stubClient(reply: Record<string, unknown>) {
  const bodies: Array<Record<string, unknown>> = [];
  const client = {
    chat: {
      completions: {
        create: async (body: Record<string, unknown>) => {
          bodies.push(body);
          return reply;
        },
      },
    },
  } as unknown as OpenAI;
  return { client, bodies };
}

const okReply = {
  model: 'qwen3-32b',
  choices: [{ finish_reason: 'stop', message: { content: 'Dạ em chào anh/chị', refusal: null } }],
  usage: {
    prompt_tokens: 1000,
    completion_tokens: 12,
    prompt_tokens_details: { cached_tokens: 900 },
  },
};

const request: GenerateRequest = {
  workspaceId: ws,
  tier: 'smart',
  messages: [
    { role: 'system', content: 'frame' },
    { role: 'user', content: 'hi' },
  ],
};

describe('OpenAiCompatibleProvider', () => {
  it('calls chat completions with the target model and maps usage', async () => {
    const { client, bodies } = stubClient(okReply);
    const provider = new OpenAiCompatibleProvider({ name: 'selfhost', baseURL: 'x', client });
    const res = await provider.generate(request, { model: 'qwen3-32b', effort: 'low' });

    expect(res).toMatchObject({
      text: 'Dạ em chào anh/chị',
      stopReason: 'end',
      provider: 'selfhost',
      model: 'qwen3-32b',
      usage: { inputTokens: 100, outputTokens: 12, cachedInputTokens: 900 },
    });
    expect(bodies[0]).toMatchObject({ model: 'qwen3-32b', messages: request.messages });
    // Effort is not forwarded unless the server is known to accept it.
    expect(bodies[0]).not.toHaveProperty('reasoning_effort');
  });

  it('sends a strict json_schema response format by default', async () => {
    const { client, bodies } = stubClient(okReply);
    await new OpenAiCompatibleProvider({ baseURL: 'x', client }).generate(
      { ...request, responseFormat: z.object({ reply: z.string() }) },
      { model: 'm' },
    );
    expect(bodies[0]!.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'reply', strict: true, schema: { type: 'object', required: ['reply'] } },
    });
  });

  it('falls back to json_object or nothing for servers without json_schema', async () => {
    const a = stubClient(okReply);
    await new OpenAiCompatibleProvider({
      baseURL: 'x',
      client: a.client,
      structuredOutput: 'json_object',
    }).generate({ ...request, responseFormat: z.object({}) }, { model: 'm' });
    expect(a.bodies[0]!.response_format).toEqual({ type: 'json_object' });

    const b = stubClient(okReply);
    await new OpenAiCompatibleProvider({
      baseURL: 'x',
      client: b.client,
      structuredOutput: 'none',
    }).generate({ ...request, responseFormat: z.object({}) }, { model: 'm' });
    expect(b.bodies[0]).not.toHaveProperty('response_format');
  });

  it('forwards reasoning effort when enabled and maps refusals and length stops', async () => {
    const { client, bodies } = stubClient({
      ...okReply,
      choices: [{ finish_reason: 'length', message: { content: 'Dạ', refusal: null } }],
    });
    const res = await new OpenAiCompatibleProvider({
      baseURL: 'x',
      client,
      sendReasoningEffort: true,
    }).generate(request, { model: 'm', effort: 'medium' });
    expect(bodies[0]).toMatchObject({ reasoning_effort: 'medium' });
    expect(res.stopReason).toBe('max_tokens');

    const refused = stubClient({
      ...okReply,
      choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'no' } }],
    });
    const r2 = await new OpenAiCompatibleProvider({
      baseURL: 'x',
      client: refused.client,
    }).generate(request, { model: 'm' });
    expect(r2.stopReason).toBe('refusal');
    expect(r2.text).toBe('');
  });
});
