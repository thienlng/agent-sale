import { FakeLlmProvider, type GenerateRequest } from '@agent-sales/ai-core';

import { DEV_FAKE_PROVIDER } from '../../domain/llm-config.js';

const ENTRY = /\[(kb:\d+)\]\nQ: [^\n]*\nA: ([^\n]*)/;
const HANDOFF = /nhan vien|nguoi that|human|staff/;

/**
 * Development/test stand-in for a real model, used for tiers without a route
 * outside production. Deterministic free text: answers with the best knowledge
 * entry verbatim, calls the `handoff` tool when the customer asks for a human,
 * otherwise says it has no information.
 */
export function groundedFakeProvider(): FakeLlmProvider {
  return new FakeLlmProvider(DEV_FAKE_PROVIDER, (req: GenerateRequest) => {
    const lastUser = req.messages.findLast((m) => m.role === 'user')?.content ?? '';
    const customer = (
      /<customer>\n([\s\S]*?)\n<\/customer>(?![\s\S]*<customer>)/.exec(lastUser)?.[1] ?? lastUser
    )
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/đ/gi, 'd')
      .toLowerCase();
    const usage = {
      inputTokens: Math.ceil(lastUser.length / 4),
      outputTokens: 20,
      cachedInputTokens: 0,
    };
    const handedOver = req.messages.some((m) => m.role === 'tool' && m.name === 'handoff');
    const canHandOff = req.tools?.some((t) => t.name === 'handoff') && req.toolChoice !== 'none';
    if (HANDOFF.test(customer) && canHandOff && !handedOver) {
      return {
        text: 'Dạ em chuyển nhân viên hỗ trợ ạ.',
        stopReason: 'tool_use',
        toolCalls: [{ id: 'fake-handoff', name: 'handoff', input: { reason: 'customer asked' } }],
        usage,
      };
    }
    const entry = ENTRY.exec(lastUser);
    return { text: entry ? (entry[2] ?? '') : 'Dạ em chưa có thông tin này ạ.', usage };
  });
}
