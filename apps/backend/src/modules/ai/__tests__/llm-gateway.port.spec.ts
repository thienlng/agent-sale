import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { AiModule } from '../ai.module.js';
import { AI_LLM_GATEWAY, type LlmGatewayPort } from '../api/index.js';
import { LlmRuntime } from '../application/llm-runtime.js';

describe('LlmGatewayPort (contract)', () => {
  it('is provided by the module as the LlmRuntime', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AiModule] }).compile();
    const gateway = moduleRef.get<LlmGatewayPort>(AI_LLM_GATEWAY);
    expect(gateway).toBe(moduleRef.get(LlmRuntime));
    expect(typeof gateway.generate).toBe('function');
  });
});
