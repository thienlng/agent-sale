import type { GenerateRequest, GenerateResponse } from '@agent-sales/ai-core';

/** The runtime LLM gateway (tier routes from the platform LLM configuration) for other modules' agents. */
export interface LlmGatewayPort {
  generate(request: GenerateRequest): Promise<GenerateResponse>;
}
export const AI_LLM_GATEWAY = Symbol('AI_LLM_GATEWAY');
