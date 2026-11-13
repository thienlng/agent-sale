import { describe, expect, it } from 'vitest';

import { sellableTotal } from '../application/catalog.service.js';

describe('product "Có thể bán" (TM-6)', () => {
  it('counts an oversold variant as 0 instead of hiding another variant’s stock', () => {
    // Đỏ: on hand 5, staff sold 7 → -2; Xanh: 3 available.
    expect(sellableTotal([{ stock: [{ available: -2 }] }, { stock: [{ available: 3 }] }])).toBe(3);
  });

  it('clamps per warehouse row: a negative row does not eat another warehouse’s stock', () => {
    expect(sellableTotal([{ stock: [{ available: -4 }, { available: 2 }] }])).toBe(2);
  });

  it('sums ordinary stock unchanged', () => {
    expect(sellableTotal([{ stock: [{ available: 1 }, { available: 2 }] }, { stock: [] }])).toBe(3);
  });
});
