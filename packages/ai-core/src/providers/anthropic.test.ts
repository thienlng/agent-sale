import type Anthropic from '@anthropic-ai/sdk';
import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { GenerateRequest } from '../gateway.js';
import { AnthropicProvider } from './anthropic.js';

const ws = workspaceId('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10');

/** Records the request body and answers with a canned message; no network. */
function stubClient(reply: Record<string, unknown>) {
  const bodies: Array<Record<string, unknown>> = [];
  const client = {
    beta: {
      messages: {
        create: async (body: Record<string, unknown>) => {
          bodies.push(body);
          return reply;
        },
      },
    },
  } as unknown as Anthropic;
  return { client, bodies };
}

const okReply = {
  model: 'claude-haiku-5-5',
  stop_reason: 'end_turn',
  content: [
    { type: 'thinking', thinking: '', signature: 'x' },
    { type: 'text', text: 'Dạ ' },
    { type: 'text', text: 'em chào anh/chị' },
  ],
  usage: {
    input_tokens: 40,
    cache_creation_input_tokens: 10,
    cache_read_input_tokens: 900,
    output_tokens: 12,
  },
};

const request: GenerateRequest = {
  workspaceId: ws,
  tier: 'smart',
  messages: [
    { role: 'system', content: 'frame' },
    { role: 'system', content: 'bot instructions' },
    { role: 'user', content: 'hi' },
  ],
};

describe('AnthropicProvider', () => {
  it('caches the system prefix, joins text blocks and maps usage', async () => {
    const { client, bodies } = stubClient(okReply);
    const res = await new AnthropicProvider({ client }).generate(request, {
      model: 'claude-haiku-5-5',
      effort: 'low',
    });

    expect(res.text).toBe('Dạ em chào anh/chị');
    expect(res.stopReason).toBe('end');
    expect(res.usage).toEqual({ inputTokens: 50, outputTokens: 12, cachedInputTokens: 900 });
    const body = bodies[0]!;
    expect(body.system).toEqual([
      { type: 'text', text: 'frame' },
      { type: 'text', text: 'bot instructions', cache_control: { type: 'ephemeral' } },
    ]);
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.output_config).toEqual({ effort: 'low' });
    // Haiku has no server-side refusal fallback.
    expect(body).not.toHaveProperty('fallbacks');
  });

  it('opts into the server-side refusal fallback on models that support it', async () => {
    const { client, bodies } = stubClient({ ...okReply, model: 'claude-sonnet-5-5' });
    await new AnthropicProvider({ client }).generate(request, { model: 'claude-sonnet-5-5' });
    expect(bodies[0]).toMatchObject({
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  });

  it('sends a JSON schema when a response format is requested', async () => {
    const { client, bodies } = stubClient(okReply);
    await new AnthropicProvider({ client }).generate(
      { ...request, responseFormat: z.object({ reply: z.string() }) },
      { model: 'claude-haiku-5-5' },
    );
    const config = bodies[0]!.output_config as { format: { type: string; schema: object } };
    expect(config.format.type).toBe('json_schema');
    expect(config.format.schema).toMatchObject({ type: 'object', required: ['reply'] });
  });

  it('reports a provider refusal as stopReason refusal', async () => {
    const { client } = stubClient({ ...okReply, stop_reason: 'refusal', content: [] });
    const res = await new AnthropicProvider({ client }).generate(request, {
      model: 'claude-haiku-5-5',
    });
    expect(res.stopReason).toBe('refusal');
    expect(res.text).toBe('');
  });

  it('rejects system messages after the conversation started', async () => {
    const { client } = stubClient(okReply);
    await expect(
      new AnthropicProvider({ client }).generate(
        {
          ...request,
          messages: [
            { role: 'user', content: 'hi' },
            { role: 'system', content: 'late' },
          ],
        },
        { model: 'claude-haiku-5-5' },
      ),
    ).rejects.toThrow('system messages must come first');
  });

  it('lists model ids', async () => {
    const client = {
      models: {
        list: async function* () {
          yield { id: 'claude-sonnet-5-5' };
          yield { id: 'claude-haiku-5-5' };
        },
      },
    } as unknown as Anthropic;
    expect(await new AnthropicProvider({ client }).listModels()).toEqual([
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
    ]);
  });
});
