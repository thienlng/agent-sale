import { z } from 'zod';

import {
  INVALID_JSON_INPUT_KEY,
  type ChatMessage,
  type GenerateRequest,
  type GenerateResponse,
  type LlmProvider,
  type ModelTarget,
  type ToolCall,
} from './gateway.js';

const PROTOCOL =
  'To use tools, reply with only {"tool_calls":[{"name":"<tool name>","arguments":{…}}]} (one or more calls). When you have what you need, reply in the final format instead. Never mix both.';
const NO_TOOLS = 'Tools are no longer available: reply in the final format now.';

const ToolCalls = z.object({
  tool_calls: z
    .array(z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()) }))
    .min(1),
});

/** The JSON object inside a ```json fence or surrounded by prose, or the text itself. */
function jsonCandidates(text: string): string[] {
  const trimmed = text.trim();
  const out = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)?.[1];
  if (fenced) out.push(fenced.trim());
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) out.push(trimmed.slice(start, end + 1));
  return out;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function toolsSection(request: GenerateRequest): string {
  if (request.toolChoice === 'none') return NO_TOOLS;
  const defs = (request.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: z.toJSONSchema(t.input),
  }));
  return `<tools>\n${JSON.stringify(defs)}\n</tools>\n${PROTOCOL}`;
}

const attr = (v: string | undefined) => (v ?? '').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

function renderMessages(messages: ChatMessage[], section: string): ChatMessage[] {
  const out: ChatMessage[] = [];
  let sectionAdded = false;
  let afterToolResult = false;
  for (const m of messages) {
    if (m.role !== 'tool') afterToolResult = false;
    if (m.role === 'system' && !sectionAdded) {
      sectionAdded = true;
      out.push({ role: 'system', content: `${m.content}\n\n${section}` });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      const calls = m.toolCalls.map((c) => ({ name: c.name, arguments: c.input }));
      out.push({ role: 'assistant', content: JSON.stringify({ tool_calls: calls }) });
    } else if (m.role === 'tool') {
      const block = `<tool_result name="${attr(m.name)}" id="${attr(m.toolCallId)}">\n${m.content.replaceAll('<', '&lt;')}\n</tool_result>`;
      const last = out[out.length - 1];
      if (afterToolResult && last)
        out[out.length - 1] = { ...last, content: `${last.content}\n${block}` };
      else out.push({ role: 'user', content: block });
      afterToolResult = true;
      continue;
    } else out.push(m);
  }
  if (!sectionAdded) out.unshift({ role: 'system', content: section });
  return out;
}

function parseToolCalls(text: string, allowed: Set<string>): ToolCall[] | null {
  for (const candidate of jsonCandidates(text)) {
    let json: unknown;
    try {
      json = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!isObject(json) || !Array.isArray(json.tool_calls) || json.tool_calls.length === 0)
      continue;
    const calls: ToolCall[] = [];
    for (const [i, raw] of json.tool_calls.entries()) {
      if (!isObject(raw) || typeof raw.name !== 'string' || !allowed.has(raw.name)) {
        calls.length = 0;
        break;
      }
      const input = isObject(raw.arguments) ? raw.arguments : { [INVALID_JSON_INPUT_KEY]: true };
      calls.push({
        id: `emu_${i}_${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`,
        name: raw.name,
        input,
      });
    }
    if (calls.length) return calls;
  }
  return null;
}

/**
 * Gives a provider without native function calling a tool protocol in plain text: the tools
 * are described in the system message and the model answers `{"tool_calls":[…]}` to use them.
 * The inner provider never sees `tools` / `toolChoice`.
 */
export class EmulatedToolsProvider implements LlmProvider {
  readonly name: string;
  readonly listModels?: () => Promise<string[]>;

  constructor(private readonly inner: LlmProvider) {
    this.name = inner.name;
    if (inner.listModels) {
      const list = inner.listModels.bind(inner);
      this.listModels = () => list();
    }
  }

  async generate(request: GenerateRequest, target: ModelTarget): Promise<GenerateResponse> {
    if (!request.tools?.length) return this.inner.generate(request, target);
    const { tools, toolChoice, responseFormat, ...rest } = request;
    const final = toolChoice === 'none';
    const forward: GenerateRequest = {
      ...rest,
      messages: renderMessages(request.messages, toolsSection(request)),
      ...(responseFormat
        ? { responseFormat: final ? responseFormat : z.union([ToolCalls, responseFormat]) }
        : {}),
    };
    const res = await this.inner.generate(forward, target);
    if (final) return res;
    const calls = parseToolCalls(res.text, new Set(tools.map((t) => t.name)));
    return calls ? { ...res, text: '', toolCalls: calls, stopReason: 'tool_use' } : res;
  }
}
