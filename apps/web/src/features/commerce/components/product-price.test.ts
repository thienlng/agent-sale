import type { OfferingDetails } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n';

import { priceLabel } from './product-price';

const offering = (priceNote: string): OfferingDetails => ({
  kind: 'service',
  durationMinutes: null,
  sessions: null,
  period: '',
  format: null,
  level: '',
  schedule: '',
  audience: '',
  outcomes: [],
  priceNote,
});
const label = (priceNote: string, prices: number[]) =>
  priceLabel(
    {
      priceMin: Math.min(...prices),
      priceMax: Math.max(...prices),
      offering: offering(priceNote),
      variants: prices.map((price) => ({ price })),
    },
    true,
    i18n.t.bind(i18n),
  ).replace(/\s/g, ' ');

describe('priceLabel', () => {
  it('reads a "từ" note as a prefix (MS-28)', () => {
    expect(label('từ', [150_000])).toBe('Từ 150.000 ₫');
    expect(label('Từ', [150_000, 300_000])).toBe('Từ 150.000 ₫');
  });

  it('writes "Liên hệ" with one casing whatever the note says', () => {
    expect(label('liên hệ', [0])).toBe('Liên hệ');
    expect(label('', [0])).toBe('Liên hệ');
    expect(label('theo lộ trình', [0])).toBe('Theo lộ trình');
  });

  it('says when some packages are priced on request', () => {
    expect(label('', [0, 2_000_000, 9_000_000])).toBe('2.000.000 ₫ – 9.000.000 ₫ · có gói liên hệ');
    expect(label('liên hệ', [500_000])).toBe('500.000 ₫ · có gói liên hệ');
  });

  it('keeps any other note after the price', () => {
    expect(label('giá tham khảo', [100_000])).toBe('100.000 ₫ (giá tham khảo)');
  });
});
