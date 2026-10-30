import type {
  ChatMessage,
  GenerateRequest,
  GenerateResponse,
  ToolCall,
  Usage,
} from '@agent-sales/ai-core';

/** Rounds (model calls that asked for tools) per customer turn. */
export const MAX_TOOL_ROUNDS = 4;

export interface ToolLoopResult {
  /** The final response; usage and latency are summed over every model call of the turn. */
  res: GenerateResponse;
  /** Follow-up messages added after `base.messages`: assistant tool calls and tool results, in order. */
  messages: ChatMessage[];
  /** Grounding text of every tool result. */
  trusted: string[];
  productIds: string[];
  modelCalls: number;
  /** The provider kept calling tools although the round budget was spent. */
  limitHit: boolean;
}

export interface ToolLoopInput {
  /** Messages, tools and response format of the turn. */
  base: GenerateRequest;
  generate(req: GenerateRequest): Promise<GenerateResponse>;
  execute(call: ToolCall): Promise<{ content: string; trusted: string; productIds?: string[] }>;
}

const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
});

/**
 * One generic loop for catalog and action tools: generate, run the requested tools, feed the
 * results back. After `MAX_TOOL_ROUNDS` rounds one last call forbids tools (`toolChoice: 'none'`);
 * the final reply is parsed by the caller.
 */
export async function runToolLoop(input: ToolLoopInput): Promise<ToolLoopResult> {
  const messages: ChatMessage[] = [];
  const trusted: string[] = [];
  const productIds = new Set<string>();
  let rounds = 0;
  let modelCalls = 1;
  let limitHit = false;

  let res = await input.generate(input.base);
  let usage = res.usage;
  let latencyMs = res.latencyMs;

  while (res.toolCalls.length > 0) {
    if (rounds >= MAX_TOOL_ROUNDS) {
      limitHit = true;
      break;
    }
    rounds += 1;
    messages.push({ role: 'assistant', content: res.text, toolCalls: res.toolCalls });
    for (const call of res.toolCalls) {
      let content: string;
      try {
        const out = await input.execute(call);
        content = out.content;
        if (out.trusted) trusted.push(out.trusted);
        for (const id of out.productIds ?? []) productIds.add(id);
      } catch {
        // Never the error message: it may carry internals the model must not see.
        content = '{"error":"tool_failed"}';
      }
      messages.push({ role: 'tool', content, toolCallId: call.id, name: call.name });
    }
    res = await input.generate({
      ...input.base,
      messages: [...input.base.messages, ...messages],
      ...(rounds >= MAX_TOOL_ROUNDS ? { toolChoice: 'none' as const } : {}),
    });
    modelCalls += 1;
    usage = addUsage(usage, res.usage);
    latencyMs += res.latencyMs;
  }

  return {
    res: { ...res, usage, latencyMs },
    messages,
    trusted,
    productIds: [...productIds],
    modelCalls,
    limitHit,
  };
}
