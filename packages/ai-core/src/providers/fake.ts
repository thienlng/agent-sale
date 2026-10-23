import type { GenerateRequest, GenerateResponse, LlmProvider, ModelTarget } from '../gateway.js';

/**
 * Deterministic provider for tests and evals: replies are scripted by a
 * function of the request, so no network and no cost. Also used to simulate
 * provider failures for fallback tests.
 */
export class FakeLlmProvider implements LlmProvider {
  readonly name: string;
  readonly calls: GenerateRequest[] = [];

  constructor(
    name = 'fake',
    private readonly script: (
      req: GenerateRequest,
    ) => Partial<GenerateResponse> | Error = () => ({}),
  ) {
    this.name = name;
  }

  async generate(request: GenerateRequest, target: ModelTarget): Promise<GenerateResponse> {
    this.calls.push(request);
    const out = this.script(request);
    if (out instanceof Error) throw out;
    return {
      text: out.text ?? 'ok',
      toolCalls: out.toolCalls ?? [],
      stopReason: out.stopReason ?? 'end',
      usage: out.usage ?? { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
      provider: this.name,
      model: target.model,
      latencyMs: 1,
    };
  }
}
