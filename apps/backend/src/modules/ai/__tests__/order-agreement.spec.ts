import { describe, expect, it } from 'vitest';

import { isOrderAgreement } from '../domain/order-agreement.js';

describe('isOrderAgreement (R5-1)', () => {
  it('reads a plain yes to the order summary as agreement', () => {
    for (const text of [
      '✅ Đặt hàng',
      'Ok đúng rồi, chị xác nhận đặt đơn',
      'Đúng rồi em, tạo đơn luôn giúp chị',
      'chốt đơn nhé',
      'ok chot don luon',
      'Vâng, lên đơn cho anh',
      'ok\nđúng rồi em',
    ])
      expect(isOrderAgreement(text), text).toBe(true);
  });

  it('never reads a change, a refusal, a question or a number as agreement', () => {
    for (const text of [
      '',
      'ok đổi sang 2 bộ nhé',
      'thôi không đặt nữa',
      'dừng đơn lại em',
      'dung don lai',
      'đúng rồi, ship mấy ngày?',
      'ok lấy 3 cái',
      '✏️ Sửa thông tin',
      'ok\nà đổi địa chỉ giúp chị',
    ])
      expect(isOrderAgreement(text), text).toBe(false);
  });
});
