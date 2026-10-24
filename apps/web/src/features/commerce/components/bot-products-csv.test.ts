import type { ProductDto } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import { csvCell, formatProductsCsv } from './bot-products-csv';

const product = (patch: Partial<ProductDto>): ProductDto => ({
  id: '00000000-0000-4000-8000-000000000001',
  code: 'SP01',
  name: 'Áo thun',
  description: 'Cotton, "form rộng"',
  category: null,
  status: 'active',
  visibleToBot: true,
  botInstructions: '',
  variants: [],
  priceMin: 150000,
  priceMax: 180000,
  available: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  ...patch,
});

describe('formatProductsCsv', () => {
  it('writes a BOM, a header row and one quoted row per product', () => {
    const csv = formatProductsCsv([product({})], {
      code: 'Mã',
      name: 'Tên',
      priceMin: 'Giá min',
      priceMax: 'Giá max',
      description: 'Mô tả',
      updatedAt: 'Cập nhật',
    });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split('\r\n')).toEqual([
      '"Mã","Tên","Giá min","Giá max","Mô tả","Cập nhật"',
      '"SP01","Áo thun","150000","180000","Cotton, ""form rộng""","2026-01-02T00:00:00.000Z"',
    ]);
  });

  it('defuses spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-5')).toBe(`"'-5"`);
  });
});
