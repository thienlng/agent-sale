import { describe, expect, it } from 'vitest';

import { handoffVerdict } from '../domain/handoff-guard.js';

const order = (customerText: string, reason: string) =>
  handoffVerdict({
    reason,
    customerText,
    offeredTools: ['search_products', 'prepare_order', 'send_message', 'handoff'],
    shopText: '',
    refused: 0,
  });

describe('handoff guard: order extras and reused details (S2-A, TM3-6, S3-C)', () => {
  it('refuses a handoff for an unknown extra or for details given before', () => {
    expect(
      order('shop có gói quà và viết thiệp giúp chị không', 'no data on gift wrapping'),
    ).toMatchObject({
      allow: false,
      topic: 'order_extra',
      tool: 'prepare_order',
    });
    expect(
      order('đặt thêm 1 bộ, cùng địa chỉ và số đt nhé', 'customer reuses details'),
    ).toMatchObject({
      allow: false,
      topic: 'order_extra',
    });
  });

  it('still lets a person request through', () => {
    expect(order('cho chị gặp nhân viên, gói quà thế nào', 'asks for staff')).toMatchObject({
      allow: true,
    });
  });
});
