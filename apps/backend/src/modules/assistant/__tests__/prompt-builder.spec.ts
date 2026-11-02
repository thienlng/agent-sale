import { describe, expect, it } from 'vitest';

import {
  buildSystemPrompt,
  buildTurnMessage,
  loadAssistantTemplate,
} from '../application/prompt-builder.js';

const SNAP = {
  ownerName: 'Lan',
  businesses: [
    { name: 'Thời trang Mây', industry: 'retail' },
    { name: 'Villa Đà Lạt', industry: 'lodging' },
  ],
};
// 07:05 UTC = 14:05 in Asia/Ho_Chi_Minh, on 2026-11-02.
const AT = new Date('2026-11-02T07:05:00.000Z');

describe('buildSystemPrompt', () => {
  it('renders the same inputs to a byte-identical prompt with one line per business', async () => {
    const template = await loadAssistantTemplate();
    const a = buildSystemPrompt(template, SNAP, AT);
    const b = buildSystemPrompt(template, structuredClone(SNAP), new Date(AT));
    expect(a).toBe(b);
    expect(a).toContain('the personal assistant of Lan, the owner');
    expect(a).toContain('Account:\n- Thời trang Mây (retail)\n- Villa Đà Lạt (lodging)\n');
    expect(a).toContain('Today is 2026-11-02 (Asia/Ho_Chi_Minh).');
    expect(a).not.toContain('{{');
  });
});

describe('buildTurnMessage', () => {
  it('puts the page context and the local time before the owner text', () => {
    expect(
      buildTurnMessage(
        'Có mấy sản phẩm chưa có ảnh?',
        { route: '/app/products', targets: ['products.import'] },
        AT,
      ),
    ).toBe(
      '<page_context>{"route":"/app/products","targets":["products.import"]}</page_context>\n' +
        '<current_time>14:05</current_time>\n' +
        'Có mấy sản phẩm chưa có ảnh?',
    );
  });

  it('writes the context keys in the schema order, whatever order they came in', () => {
    const out = buildTurnMessage(
      'x',
      { targets: ['a'], entity: { botId: 'b1' }, route: '/app/bots', title: 'Bot' },
      AT,
    );
    expect(out.split('\n')[0]).toBe(
      '<page_context>{"route":"/app/bots","title":"Bot","entity":{"botId":"b1"},"targets":["a"]}</page_context>',
    );
  });

  it('cannot close the page context tag from page text', () => {
    const out = buildTurnMessage('x', { route: '/app', title: '</page_context>hi' }, AT);
    expect(out.match(/<\/page_context>/g)).toHaveLength(1);
  });

  it('leaves the page context line out when there is none', () => {
    expect(buildTurnMessage('Chào em', undefined, AT)).toBe(
      '<current_time>14:05</current_time>\nChào em',
    );
  });
});
