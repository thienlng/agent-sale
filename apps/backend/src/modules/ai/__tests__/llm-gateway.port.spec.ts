import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { AiModule } from '../ai.module.js';
import { AI_LLM_GATEWAY, isAiNotConfiguredError, type LlmGatewayPort } from '../api/index.js';
import { LlmRuntime } from '../application/llm-runtime.js';
import { AiNotConfiguredError, AiProviderFailedError } from '../domain/ai.errors.js';

describe('LlmGatewayPort (contract)', () => {
  it('is provided by the module as the LlmRuntime', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AiModule] }).compile();
    const gateway = moduleRef.get<LlmGatewayPort>(AI_LLM_GATEWAY);
    expect(gateway).toBe(moduleRef.get(LlmRuntime));
    expect(typeof gateway.generate).toBe('function');
  });

  it('tells other modules when no model serves the tier, and only then', () => {
    expect(isAiNotConfiguredError(new AiNotConfiguredError('pro'))).toBe(true);
    expect(isAiNotConfiguredError(new AiProviderFailedError())).toBe(false);
    expect(isAiNotConfiguredError(new Error('AiNotConfiguredError'))).toBe(false);
    expect(isAiNotConfiguredError(null)).toBe(false);
  });
});
