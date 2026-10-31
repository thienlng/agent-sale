import { workspaceId } from '@agent-sales/shared';
import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { GenerateRequest } from '../gateway.js';
import { OpenAiCompatibleProvider } from './openai-compatible.js';

const ws = workspaceId('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10');

function stubClient(reply: Record<string, unknown>) {
  const bodies: Array<Record<string, unknown>> = [];
  const options: Array<Record<string, unknown>> = [];
  const client = {
    chat: {
      completions: {
        create: async (body: Record<string, unknown>, opts?: Record<string, unknown>) => {
          bodies.push(body);
          options.push(opts ?? {});
          return reply;
        },
      },
    },
  } as unknown as OpenAI;
  return { client, bodies, options };
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

  it('lists model ids sorted, across pages', async () => {
    const client = {
      models: {
        list: async function* () {
          yield { id: 'qwen3-32b' };
          yield { id: 'llama-3.3-70b' };
        },
      },
    } as unknown as OpenAI;
    const provider = new OpenAiCompatibleProvider({ baseURL: 'x', client });
    expect(await provider.listModels()).toEqual(['llama-3.3-70b', 'qwen3-32b']);
  });

  describe('native tools', () => {
    const tools = [
      {
        name: 'search_products',
        description: 'd',
        input: z.object({ query: z.string().optional() }),
      },
    ];
    const toolReply = (args: string) => ({
      ...okReply,
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            refusal: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'search_products', arguments: args },
              },
            ],
          },
        },
      ],
    });

    it('sends tools with tool_choice auto, or none when asked', async () => {
      const a = stubClient(okReply);
      const provider = new OpenAiCompatibleProvider({ baseURL: 'x', client: a.client });
      await provider.generate({ ...request, tools }, { model: 'm' });
      expect(a.bodies[0]).toMatchObject({
        tools: [
          {
            type: 'function',
            function: {
              name: 'search_products',
              description: 'd',
              parameters: z.toJSONSchema(tools[0]!.input),
            },
          },
        ],
        tool_choice: 'auto',
      });
      await provider.generate({ ...request, tools, toolChoice: 'none' }, { model: 'm' });
      expect(a.bodies[1]).toMatchObject({ tool_choice: 'none' });
    });

    it('maps tool calls in the response', async () => {
      const { client } = stubClient(toolReply('{"query":"thú gỗ"}'));
      const res = await new OpenAiCompatibleProvider({ baseURL: 'x', client }).generate(
        { ...request, tools },
        { model: 'm' },
      );
      expect(res.toolCalls).toEqual([
        { id: 'c1', name: 'search_products', input: { query: 'thú gỗ' } },
      ]);
      expect(res.stopReason).toBe('tool_use');
      expect(res.text).toBe('');
    });

    it('marks malformed arguments instead of throwing', async () => {
      const { client } = stubClient(toolReply('{oops'));
      const res = await new OpenAiCompatibleProvider({ baseURL: 'x', client }).generate(
        { ...request, tools },
        { model: 'm' },
      );
      expect(res.toolCalls).toEqual([
        { id: 'c1', name: 'search_products', input: { __invalidJson: true } },
      ]);
    });

    it('maps assistant tool calls and tool results in the history', async () => {
      const { client, bodies } = stubClient(okReply);
      await new OpenAiCompatibleProvider({ baseURL: 'x', client }).generate(
        {
          ...request,
          tools,
          messages: [
            ...request.messages,
            {
              role: 'assistant',
              content: '',
              toolCalls: [{ id: 'c1', name: 'search_products', input: { query: 'x' } }],
            },
            { role: 'tool', toolCallId: 'c1', name: 'search_products', content: '{"rows":[]}' },
          ],
        },
        { model: 'm' },
      );
      expect((bodies[0]!.messages as unknown[]).slice(2)).toEqual([
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'search_products', arguments: '{"query":"x"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'c1', content: '{"rows":[]}' },
      ]);
    });

    it('refuses a tool message without toolCallId', async () => {
      const { client, bodies } = stubClient(okReply);
      await expect(
        new OpenAiCompatibleProvider({ baseURL: 'x', client }).generate(
          {
            ...request,
            tools,
            messages: [
              ...request.messages,
              { role: 'tool', name: 'search_products', content: '{}' },
            ],
          },
          { model: 'm' },
        ),
      ).rejects.toThrow('openai-compatible provider: tool message without toolCallId');
      expect(bodies).toHaveLength(0);
    });

    it('still sends response_format together with tools', async () => {
      const { client, bodies } = stubClient(okReply);
      await new OpenAiCompatibleProvider({ baseURL: 'x', client }).generate(
        { ...request, tools, responseFormat: z.object({ reply: z.string() }) },
        { model: 'm' },
      );
      expect(bodies[0]).toHaveProperty('tools');
      expect(bodies[0]).toHaveProperty('response_format');
    });

    it('throws for emulated providers', async () => {
      const { client } = stubClient(okReply);
      await expect(
        new OpenAiCompatibleProvider({
          name: 'selfhost',
          baseURL: 'x',
          client,
          tools: 'emulated',
        }).generate({ ...request, tools }, { model: 'm' }),
      ).rejects.toThrow('selfhost provider: tools must be emulated');
    });
  });

  it('sends prompt_cache_key and forwards signal and timeout to the SDK call', async () => {
    const { client, bodies, options } = stubClient(okReply);
    const controller = new AbortController();
    const provider = new OpenAiCompatibleProvider({ baseURL: 'x', client });
    await provider.generate(
      { ...request, promptCacheKey: 'bot-1', signal: controller.signal, timeoutMs: 9_000 },
      { model: 'qwen3-32b' },
    );
    expect(bodies[0]!.prompt_cache_key).toBe('bot-1');
    expect(options[0]).toEqual({ signal: controller.signal, timeout: 9_000 });
    await provider.generate(request, { model: 'qwen3-32b' });
    expect(bodies[1]).not.toHaveProperty('prompt_cache_key');
    expect(options[1]).toEqual({});
  });

  it('rejects images as a non-retryable invalid_request', async () => {
    const { client } = stubClient(okReply);
    await expect(
      new OpenAiCompatibleProvider({ baseURL: 'x', client }).generate(
        { ...request, images: [{ mimeType: 'image/png', base64: 'AA==' }] },
        { model: 'm' },
      ),
    ).rejects.toMatchObject({ kind: 'invalid_request' });
  });
});
