import { FakeLlmProvider, type GenerateRequest } from '@agent-sales/ai-core';

const ENTRY = /\[(kb:\d+)\]\nQ: [^\n]*\nA: ([^\n]*)/;
const HANDOFF = /nhan vien|nguoi that|human|staff/;

/**
 * Development/test stand-in for a real model, used for tiers without a route
 * outside production. Deterministic: answers with the best knowledge entry
 * verbatim, asks for a human when the customer does, otherwise "unknown".
 */
export function groundedFakeProvider(): FakeLlmProvider {
  return new FakeLlmProvider('dev-fake', (req: GenerateRequest) => {
    const last = req.messages.at(-1)?.content ?? '';
    const customer = last
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/đ/gi, 'd')
      .toLowerCase();
    const entry = ENTRY.exec(last);
    const reply = HANDOFF.test(customer)
      ? { outcome: 'handoff', reply: 'Dạ em chuyển nhân viên hỗ trợ ạ.', sources: [] }
      : entry
        ? { outcome: 'answer', reply: entry[2], sources: [entry[1]] }
        : { outcome: 'unknown', reply: 'Dạ em chưa có thông tin này ạ.', sources: [] };
    return {
      text: JSON.stringify(reply),
      usage: { inputTokens: Math.ceil(last.length / 4), outputTokens: 20, cachedInputTokens: 0 },
    };
  });
}
