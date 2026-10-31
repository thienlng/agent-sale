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
  const options: Array<Record<string, unknown>> = [];
  const client = {
    beta: {
      messages: {
        create: async (body: Record<string, unknown>, opts?: Record<string, unknown>) => {
          bodies.push(body);
          options.push(opts ?? {});
          return reply;
        },
      },
    },
  } as unknown as Anthropic;
  return { client, bodies, options };
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
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }],
      },
    ]);
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

  describe('native tools', () => {
    const tools = [
      {
        name: 'search_products',
        description: 'd',
        input: z.object({ query: z.string().optional() }),
      },
    ];
    const model = { model: 'claude-haiku-5-5' };

    it('sends tools with tool_choice auto, or none when asked', async () => {
      const { client, bodies } = stubClient(okReply);
      const provider = new AnthropicProvider({ client });
      await provider.generate({ ...request, tools }, model);
      expect(bodies[0]).toMatchObject({
        tools: [
          {
            name: 'search_products',
            description: 'd',
            input_schema: z.toJSONSchema(tools[0]!.input),
          },
        ],
        tool_choice: { type: 'auto' },
      });
      await provider.generate({ ...request, tools, toolChoice: 'none' }, model);
      expect(bodies[1]).toMatchObject({ tool_choice: { type: 'none' } });
    });

    it('maps tool_use blocks to tool calls', async () => {
      const { client } = stubClient({
        ...okReply,
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 't1', name: 'search_products', input: { query: 'x' } }],
      });
      const res = await new AnthropicProvider({ client }).generate({ ...request, tools }, model);
      expect(res.toolCalls).toEqual([{ id: 't1', name: 'search_products', input: { query: 'x' } }]);
      expect(res.stopReason).toBe('tool_use');
      expect(res.text).toBe('');
    });

    it('maps assistant tool calls and groups consecutive tool results', async () => {
      const { client, bodies } = stubClient(okReply);
      await new AnthropicProvider({ client }).generate(
        {
          ...request,
          tools,
          messages: [
            { role: 'user', content: 'hi' },
            {
              role: 'assistant',
              content: 'Để em tìm',
              toolCalls: [
                { id: 't1', name: 'search_products', input: { query: 'x' } },
                { id: 't2', name: 'search_products', input: { query: 'y' } },
              ],
            },
            { role: 'tool', toolCallId: 't1', name: 'search_products', content: 'r1' },
            { role: 'tool', toolCallId: 't2', name: 'search_products', content: 'r2' },
          ],
        },
        model,
      );
      expect(bodies[0]!.messages).toEqual([
        {
          role: 'user',
          content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }],
        },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Để em tìm' },
            { type: 'tool_use', id: 't1', name: 'search_products', input: { query: 'x' } },
            { type: 'tool_use', id: 't2', name: 'search_products', input: { query: 'y' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: 'r1' },
            {
              type: 'tool_result',
              tool_use_id: 't2',
              content: 'r2',
              cache_control: { type: 'ephemeral' },
            },
          ],
        },
      ]);
    });

    it('refuses a tool message without toolCallId', async () => {
      const { client, bodies } = stubClient(okReply);
      await expect(
        new AnthropicProvider({ client }).generate(
          {
            ...request,
            tools,
            messages: [
              { role: 'user', content: 'hi' },
              { role: 'tool', name: 'search_products', content: 'r1' },
            ],
          },
          model,
        ),
      ).rejects.toThrow('anthropic provider: tool message without toolCallId');
      expect(bodies).toHaveLength(0);
    });

    it('omits the text block when the assistant turn has no text', async () => {
      const { client, bodies } = stubClient(okReply);
      await new AnthropicProvider({ client }).generate(
        {
          ...request,
          tools,
          messages: [
            { role: 'user', content: 'hi' },
            {
              role: 'assistant',
              content: '',
              toolCalls: [{ id: 't1', name: 'search_products', input: {} }],
            },
          ],
        },
        model,
      );
      expect((bodies[0]!.messages as Array<{ content: unknown }>)[1]!.content).toEqual([
        { type: 'tool_use', id: 't1', name: 'search_products', input: {} },
      ]);
    });
  });

  it('puts at most 4 cache breakpoints: system + the last two user/tool messages', async () => {
    const { client, bodies } = stubClient(okReply);
    await new AnthropicProvider({ client }).generate(
      {
        ...request,
        messages: [
          { role: 'system', content: 'frame' },
          { role: 'user', content: 'one' },
          { role: 'assistant', content: 'a' },
          { role: 'user', content: 'two' },
          { role: 'assistant', content: 'b' },
          { role: 'user', content: 'three' },
        ],
      },
      { model: 'claude-haiku-5-5' },
    );
    const body = bodies[0]!;
    const blocks = [
      ...(body.system as Array<Record<string, unknown>>),
      ...(body.messages as Array<{ content: unknown }>).flatMap((m) =>
        Array.isArray(m.content) ? (m.content as Array<Record<string, unknown>>) : [],
      ),
    ];
    expect(blocks.filter((b) => b.cache_control)).toHaveLength(3);
    const msgs = body.messages as Array<{ content: unknown }>;
    expect(msgs[0]!.content).toBe('one');
    expect(Array.isArray(msgs[2]!.content)).toBe(true);
    expect(Array.isArray(msgs[4]!.content)).toBe(true);
  });

  it('passes the abort signal and timeout to the SDK call', async () => {
    const { client, options } = stubClient(okReply);
    const controller = new AbortController();
    await new AnthropicProvider({ client }).generate(
      { ...request, signal: controller.signal, timeoutMs: 7_000 },
      { model: 'claude-haiku-5-5' },
    );
    expect(options[0]).toEqual({ signal: controller.signal, timeout: 7_000 });
  });

  it('never puts cache_control on an empty text block', async () => {
    const { client, bodies } = stubClient(okReply);
    await new AnthropicProvider({ client }).generate(
      {
        ...request,
        messages: [
          { role: 'system', content: 'frame' },
          { role: 'user', content: 'one' },
          { role: 'assistant', content: 'a' },
          { role: 'user', content: '' },
        ],
      },
      { model: 'claude-haiku-5-5' },
    );
    const msgs = bodies[0]!.messages as Array<{ content: unknown }>;
    expect(msgs[2]!.content).toBe('');
    expect(msgs[0]!.content).toEqual([
      { type: 'text', text: 'one', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('does not put cache_control on an empty system block', async () => {
    const { client, bodies } = stubClient(okReply);
    await new AnthropicProvider({ client }).generate(
      {
        ...request,
        messages: [
          { role: 'system', content: 'frame' },
          { role: 'system', content: '' },
          { role: 'user', content: 'hi' },
        ],
      },
      { model: 'claude-haiku-5-5' },
    );
    const system = bodies[0]!.system as Array<Record<string, unknown>>;
    expect(system.some((b) => b.cache_control)).toBe(false);
  });
});
