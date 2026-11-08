import type { Database } from '@agent-sales/db';
import { newId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { KnowledgeExportSource } from '../infrastructure/export/knowledge.export.js';

const ws = newId();

describe('KnowledgeExportSource', () => {
  it('exports nothing without a database', () => {
    expect(new KnowledgeExportSource(null).exportTables(ws)).toEqual([]);
  });

  it('declares its files with unique snake_case headers', () => {
    // exportTable only touches the database when rows() is iterated.
    const tables = new KnowledgeExportSource({} as Database).exportTables(ws);
    expect(tables.map((t) => t.file)).toEqual(['knowledge_items.csv', 'training_items.csv']);
    for (const t of tables) {
      expect(new Set(t.columns).size).toBe(t.columns.length);
      for (const c of t.columns) expect(c).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(t.columns[0]).toBe('id');
      for (const m of t.mediaColumns ?? []) expect(t.columns).toContain(m);
    }
  });
});
