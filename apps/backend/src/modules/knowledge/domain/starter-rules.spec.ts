import { CreateTrainingItemRequest } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';
import { STARTER_RULES, starterRuleRequests, starterRulesFor } from './starter-rules.js';

describe('starter rules', () => {
  const STYLE_TITLES = [
    'Xưng hô lịch sự',
    'Cách gọi khách',
    'Trả lời ngắn gọn',
    'Không bảo khách chờ',
  ];

  it('ships valid scenario requests with unique titles', () => {
    const requests = starterRuleRequests();
    expect(requests.length).toBeGreaterThanOrEqual(4);
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

  it('no longer seeds style rules: they are personality settings now', () => {
    for (const industry of ['retail', 'hotel', 'other', 'spa'])
      for (const rule of starterRulesFor(industry)) expect(STYLE_TITLES).not.toContain(rule.title);
  });

  it('keeps the non-style rules for retail and other industries', () => {
    const expected = [
      'Cách nói giá',
      'Khách quan tâm sản phẩm',
      'Khách hỏi về thanh toán',
      'Sau khi chốt đơn',
    ];
    for (const industry of ['retail', 'fashion', 'other'])
      expect(starterRulesFor(industry).map((r) => r.title)).toEqual(expected);
  });

  it('gives hotels availability, booking, bargaining and directions situations', () => {
    const rules = starterRulesFor('hotel');
    expect(rules.map((r) => r.title)).toEqual([
      'Hỏi còn phòng/căn',
      'Muốn đặt phòng/căn',
      'Mặc cả giá',
      'Hỏi đường đi',
      'Sau khi chốt đơn',
    ]);
    expect(rules.find((r) => r.title === 'Mặc cả giá')?.content).toMatch(/không tự giảm giá/i);
    expect(rules.find((r) => r.title === 'Hỏi còn phòng/căn')?.content).toContain('số điện thoại');
    for (const rule of rules)
      expect(
        CreateTrainingItemRequest.safeParse({ ...rule, kind: 'scenario', enabled: true }).success,
      ).toBe(true);
  });

  it('gives SaaS businesses pricing, demo/trial, missing-feature, bargaining and security situations', () => {
    const rules = starterRulesFor('saas');
    expect(rules.map((r) => r.title)).toEqual([
      'Cách nói giá',
      'Khách muốn xem demo hoặc dùng thử',
      'Hỏi tính năng chưa có',
      'Mặc cả giá',
      'Hỏi về bảo mật dữ liệu',
      'Sau khi ghi nhận yêu cầu',
    ]);
    expect(rules.find((r) => r.title === 'Hỏi tính năng chưa có')?.content).toMatch(
      /không khẳng định là có/,
    );
    expect(rules.map((r) => r.content).join('\n')).not.toMatch(/\d+\s*(k\b|[.,]\d{3})/i);
    for (const rule of rules)
      expect(
        CreateTrainingItemRequest.safeParse({ ...rule, kind: 'scenario', enabled: true }).success,
      ).toBe(true);
  });

  it('puts no sample price in rule text, because rule text vouches for figures in replies', () => {
    expect(STARTER_RULES.map((r) => r.content).join('\n')).not.toMatch(/\d+\s*(k\b|[.,]\d{3})/i);
  });
});
