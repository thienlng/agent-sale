import { describe, expect, it } from 'vitest';

import { fillPlaceholders, foldVietnamese, placeholdersIn } from './text.js';

describe('foldVietnamese', () => {
  it('removes diacritics, maps đ, lowercases and collapses spaces', () => {
    expect(foldVietnamese('  Giá  bao NHIÊU? Đổi trả ')).toBe('gia bao nhieu? doi tra');
    expect(foldVietnamese('Cửa hàng ở đâu')).toBe('cua hang o dau');
  });
});

describe('placeholders', () => {
  const text = 'Địa chỉ: {{store.address}}. Giờ mở cửa: {{ store.hours }}. Lại {{store.address}}';

  it('lists unique placeholder names', () => {
    expect(placeholdersIn(text)).toEqual(['store.address', 'store.hours']);
  });

  it('fills known values and leaves unknown or empty ones untouched', () => {
    expect(fillPlaceholders(text, { 'store.address': '12 Lê Lợi', 'store.hours': '' })).toBe(
      'Địa chỉ: 12 Lê Lợi. Giờ mở cửa: {{ store.hours }}. Lại 12 Lê Lợi',
    );
  });
});
