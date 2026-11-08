import type { Database } from '@agent-sales/db';
import { newId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { CommerceExportSource } from '../infrastructure/export/commerce.export.js';

const ws = newId();

describe('CommerceExportSource', () => {
  it('exports nothing without a database', () => {
    expect(new CommerceExportSource(null).exportTables(ws)).toEqual([]);
  });

  it('declares its files with unique snake_case headers', () => {
    // exportTable only touches the database when rows() is iterated.
    const tables = new CommerceExportSource({} as Database).exportTables(ws);
    expect(tables.map((t) => t.file)).toEqual([
      'products.csv',
      'product_variants.csv',
      'orders.csv',
      'order_items.csv',
      'stay_requests.csv',
    ]);
    for (const t of tables) {
      expect(new Set(t.columns).size).toBe(t.columns.length);
      for (const c of t.columns) expect(c).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(t.columns[0]).toBe('id');
      for (const m of t.mediaColumns ?? []) expect(t.columns).toContain(m);
    }
  });
});
