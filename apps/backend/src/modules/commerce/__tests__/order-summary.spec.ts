import { describe, expect, it } from 'vitest';

import {
  buildOrderSummary,
  formatSummaryPhone,
  type OrderSummaryInput,
  SUMMARY_MAX_CHARS,
} from '../domain/order-summary.js';

const base: OrderSummaryInput = {
  lines: [
    { productName: 'Thú gỗ xếp thăng bằng', variantName: '', qty: 2, lineTotal: 1_760_000 },
    { productName: 'Tháp cầu vồng', variantName: '', qty: 1, lineTotal: 460_000 },
  ],
  shippingFee: 30_000,
  total: 2_250_000,
  recipient: { name: 'Lan', phone: '0912345678', address: '12 Lý Thường Kiệt, Hoàn Kiếm, Hà Nội' },
  note: null,
};

describe('buildOrderSummary', () => {
  it('renders the fixed Vietnamese summary with vi-VN money', () => {
    expect(buildOrderSummary(base)).toBe(
      [
        'Dạ em tóm tắt đơn của mình ạ:',
        '• Thú gỗ xếp thăng bằng ×2 — 1.760.000đ',
        '• Tháp cầu vồng ×1 — 460.000đ',
        'Phí ship: 30.000đ',
        'Tổng: 2.250.000đ',
        'Người nhận: Lan · 0912 345 678',
        'Địa chỉ: 12 Lý Thường Kiệt, Hoàn Kiếm, Hà Nội',
      ].join('\n'),
    );
  });

  it('says the shop tells the fee later when there is no default fee', () => {
    const text = buildOrderSummary({ ...base, shippingFee: null, total: 2_220_000 });
    expect(text).toContain('Phí ship: shop báo sau');
    expect(text).toContain('Tổng: 2.220.000đ');
  });

  it('adds the note only when present', () => {
    expect(buildOrderSummary({ ...base, note: '  ' })).not.toContain('Ghi chú');
    expect(buildOrderSummary({ ...base, note: 'Giao giờ hành chính' })).toMatch(
      /\nGhi chú: Giao giờ hành chính$/,
    );
  });

  it('names the variant next to the product', () => {
    const text = buildOrderSummary({
      ...base,
      lines: [{ productName: 'Áo thun', variantName: 'Trắng / L', qty: 1, lineTotal: 150_000 }],
    });
    expect(text).toContain('• Áo thun (Trắng / L) ×1 — 150.000đ');
  });

  it('folds long product lists and stays within the message limit', () => {
    const lines = Array.from({ length: 20 }, (_, i) => ({
      productName: `Sản phẩm số ${i + 1} ${'rất dài '.repeat(30)}`,
      variantName: 'Size XL',
      qty: 99,
      lineTotal: 99_000_000,
    }));
    const text = buildOrderSummary({
      ...base,
      lines,
      recipient: { ...base.recipient, address: 'đ'.repeat(300) },
      note: 'g'.repeat(300),
    });
    expect(text.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
    const listed = text.split('\n').filter((l) => l.startsWith('• ')).length;
    expect(text).toContain(`… và ${20 - listed} sản phẩm khác`);
    expect(text).toContain('Tổng: 2.250.000đ');
  });

  it('never guesses a pronoun for the customer', () => {
    expect(buildOrderSummary(base)).not.toMatch(/(^|\s)(anh|chị|bạn)(\s|$)/iu);
  });

  it('formats a national mobile number in groups', () => {
    expect(formatSummaryPhone('0912345678')).toBe('0912 345 678');
    expect(formatSummaryPhone('+84912345678')).toBe('+84912345678');
  });
});
