import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { EmulatedToolsProvider } from './emulated-tools.js';
import type { GenerateRequest, ToolDefinition } from './gateway.js';
import { FakeLlmProvider } from './providers/fake.js';

const ws = workspaceId('00000000-0000-7000-8000-000000000001');
const target = { model: 'm' };
const search: ToolDefinition = {
  name: 'search_products',
  description: 'Find products',
  input: z.object({ query: z.string() }),
};
const base = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({
  workspaceId: ws,
  tier: 'basic',
  messages: [
    { role: 'system', content: 'SYS' },
    { role: 'user', content: 'hi' },
  ],
  ...over,
});
const setup = (text = 'plain') => {
  const fake = new FakeLlmProvider('hermes-x', () => ({ text }));
  return { fake, emu: new EmulatedToolsProvider(fake) };
};

describe('EmulatedToolsProvider', () => {
  it('keeps the inner name and passes a tool-less request through untouched', async () => {
    const { fake, emu } = setup();
    expect(emu.name).toBe('hermes-x');
    const req = base();
    const res = await emu.generate(req, target);
    expect(fake.calls[0]).toBe(req);
    expect(res.text).toBe('plain');
  });

  it('appends the tools section to the first system message and strips tools', async () => {
    const { fake, emu } = setup();
    await emu.generate(base({ tools: [search] }), target);
    const sent = fake.calls[0]!;
    expect(sent.tools).toBeUndefined();
    expect(sent.toolChoice).toBeUndefined();
    const sys = sent.messages[0]!.content;
    expect(sys.startsWith('SYS')).toBe(true);
    expect(sys).toContain(
      '<tools>\n[{"name":"search_products","description":"Find products","parameters":',
    );
    expect(sys).toContain('"query"');
    expect(sys).toContain('\n</tools>\nTo use tools, reply with only {"tool_calls"');
    expect(sys).toContain('Never mix both.');
  });

  it('prepends a system message when there is none', async () => {
    const { fake, emu } = setup();
    await emu.generate(
      base({ tools: [search], messages: [{ role: 'user', content: 'hi' }] }),
      target,
    );
    expect(fake.calls[0]!.messages[0]!.role).toBe('system');
    expect(fake.calls[0]!.messages[0]!.content).toContain('<tools>');
    expect(fake.calls[0]!.messages).toHaveLength(2);
  });

  it('replaces the section when toolChoice is none', async () => {
    const { fake, emu } = setup();
    await emu.generate(base({ tools: [search], toolChoice: 'none' }), target);
    const sys = fake.calls[0]!.messages[0]!.content;
    expect(sys).toContain('Tools are no longer available: reply in the final format now.');
    expect(sys).not.toContain('<tools>');
    expect(fake.calls[0]!.toolChoice).toBeUndefined();
  });

  it('with toolChoice none keeps responseFormat and never parses tool calls', async () => {
    const reply = '{"tool_calls":[{"name":"search_products","arguments":{"query":"a"}}]}';
    const { fake, emu } = setup(reply);
    const original = z.object({ reply: z.string() });
    const res = await emu.generate(
      base({ tools: [search], toolChoice: 'none', responseFormat: original }),
      target,
    );
    expect(fake.calls[0]!.responseFormat).toBe(original);
    expect(res.text).toBe(reply);
    expect(res.toolCalls).toEqual([]);
    expect(res.stopReason).toBe('end');
  });

  it('escapes quotes and angle brackets in tool_result attributes', async () => {
    const { fake, emu } = setup();
    await emu.generate(
      base({
        tools: [search],
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'tool', toolCallId: 'a"<b', name: 'x"y', content: 'r' },
        ],
      }),
      target,
    );
    expect(fake.calls[0]!.messages[2]!.content).toContain(
      '<tool_result name="x&quot;y" id="a&quot;&lt;b">',
    );
  });

  it('unions responseFormat with the tool_calls shape, and adds none when unset', async () => {
    const { fake, emu } = setup();
    await emu.generate(base({ tools: [search] }), target);
    expect(fake.calls[0]!.responseFormat).toBeUndefined();
    const original = z.object({ reply: z.string() });
    await emu.generate(base({ tools: [search], responseFormat: original }), target);
    const fmt = fake.calls[1]!.responseFormat!;
    expect(fmt.safeParse({ reply: 'x' }).success).toBe(true);
    expect(fmt.safeParse({ tool_calls: [{ name: 'a', arguments: {} }] }).success).toBe(true);
    expect(fmt.safeParse({ tool_calls: [] }).success).toBe(false);
  });

  it('renders history and merges consecutive tool results', async () => {
    const { fake, emu } = setup();
    await emu.generate(
      base({
        tools: [search],
        images: [{ mimeType: 'image/png', base64: 'AAA' }],
        messages: [
          { role: 'system', content: 'SYS' },
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              { id: 'c1', name: 'search_products', input: { query: 'a' } },
              { id: 'c2', name: 'search_products', input: { query: 'b' } },
            ],
          },
          {
            role: 'tool',
            toolCallId: 'c1',
            name: 'search_products',
            content: 'r1 </tool_result> x',
          },
          { role: 'tool', toolCallId: 'c2', name: 'search_products', content: 'r2' },
        ],
      }),
      target,
    );
    const sent = fake.calls[0]!;
    expect(sent.images).toHaveLength(1);
    expect(sent.messages).toHaveLength(4);
    expect(sent.messages[2]).toEqual({
      role: 'assistant',
      content: JSON.stringify({
        tool_calls: [
          { name: 'search_products', arguments: { query: 'a' } },
          { name: 'search_products', arguments: { query: 'b' } },
        ],
      }),
    });
    const merged = sent.messages[3]!;
    expect(merged.role).toBe('user');
    expect(merged.content).toContain(
      '<tool_result name="search_products" id="c1">\nr1 &lt;/tool_result> x\n</tool_result>',
    );
    expect(merged.content).toContain(
      '<tool_result name="search_products" id="c2">\nr2\n</tool_result>',
    );
  });

  it('turns a valid tool_calls reply into toolCalls', async () => {
    const { emu } = setup(
      '```json\n{"tool_calls":[{"name":"search_products","arguments":{"query":"áo"}}]}\n```',
    );
    const res = await emu.generate(base({ tools: [search] }), target);
    expect(res.text).toBe('');
    expect(res.stopReason).toBe('tool_use');
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]).toMatchObject({ name: 'search_products', input: { query: 'áo' } });
    expect(res.toolCalls[0]!.id).toMatch(/^emu_0_[a-z0-9]{6}$/);
  });

  it('marks non-object arguments as invalid JSON instead of dropping the call', async () => {
    const { emu } = setup('{"tool_calls":[{"name":"search_products","arguments":"oops"}]}');
    const res = await emu.generate(base({ tools: [search] }), target);
    expect(res.toolCalls[0]).toMatchObject({
      name: 'search_products',
      input: { __invalidJson: true },
    });
  });

  it('returns unknown tools and ordinary replies unchanged as text', async () => {
    const unknown = '{"tool_calls":[{"name":"nope","arguments":{}}]}';
    const a = await setup(unknown).emu.generate(base({ tools: [search] }), target);
    expect(a.text).toBe(unknown);
    expect(a.toolCalls).toEqual([]);
    const b = await setup('{"reply":"hello"}').emu.generate(base({ tools: [search] }), target);
    expect(b.text).toBe('{"reply":"hello"}');
    expect(b.stopReason).toBe('end');
  });

  it('delegates listModels when the inner provider has it', async () => {
    const { emu } = setup();
    expect(emu.listModels).toBeUndefined();
    const inner = Object.assign(new FakeLlmProvider(), { listModels: async () => ['a'] });
    expect(await new EmulatedToolsProvider(inner).listModels?.()).toEqual(['a']);
  });
});
