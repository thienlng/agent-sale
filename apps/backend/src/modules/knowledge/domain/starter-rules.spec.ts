import { CreateTrainingItemRequest } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';
import { STARTER_RULES, starterRuleRequests } from './starter-rules.js';

describe('starter rules', () => {
  it('ships 8-10 valid scenario requests with unique titles', () => {
    const requests = starterRuleRequests();
    expect(requests.length).toBeGreaterThanOrEqual(8);
    expect(requests.length).toBeLessThanOrEqual(10);
    for (const request of requests)
      expect(CreateTrainingItemRequest.safeParse(request).success).toBe(true);
    expect(new Set(requests.map((r) => r.title)).size).toBe(requests.length);
  });

  it('has exactly one after-order rule: a short thank-you', () => {
    const after = STARTER_RULES.filter((r) => r.section === 'after_order');
    expect(after.map((r) => r.title)).toEqual(['Sau khi chốt đơn']);
    expect(after[0]?.content).toContain('20 từ');
  });

  it('never tells the bot to order without confirmation or to skip asking the name', () => {
    const text = STARTER_RULES.map((r) => `${r.title} ${r.trigger} ${r.content}`)
      .join('\n')
      .toLowerCase();
    expect(text).not.toMatch(/không (cần )?(hỏi|xin) tên|bỏ qua tên|tự (động )?(tạo|lên) đơn/);
  });

  it('states no shop policy and has no language rule', () => {
    const text = STARTER_RULES.map((r) => `${r.title} ${r.trigger} ${r.content}`).join('\n');
    expect(text).not.toMatch(/COD|kiểm tra hàng/i);
    expect(text).not.toMatch(/Chỉ trả lời bằng tiếng Việt/);
    const payment = STARTER_RULES.find((r) => r.title === 'Khách hỏi về thanh toán');
    expect(payment?.content).toContain('chỉ trả lời theo thông tin cửa hàng đã cung cấp');
  });

  it('allows waiting only when the conversation is handed to staff', () => {
    const rule = STARTER_RULES.find((r) => r.title === 'Không bảo khách chờ');
    expect(rule?.content).toContain('trừ khi chuyển cuộc trò chuyện cho nhân viên');
  });

  it('puts no sample price in rule text, because rule text vouches for figures in replies', () => {
    expect(STARTER_RULES.map((r) => r.content).join('\n')).not.toMatch(/\d+\s*(k\b|[.,]\d{3})/i);
  });
});
